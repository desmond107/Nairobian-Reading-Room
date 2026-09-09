import type { Block, Chapter, ExtractProgress, ExtractionQuality } from '../../types';
import { assembleBook, finishBook, qualityReport, type PageInput } from './assemble';
import { outlineMarks, type Mark } from './chapters';
import type { RawBlock } from './blocks';
import { layoutPage, toFrags } from './layout';
import { ocrPage, ocrToParagraphs, releaseOcr } from './ocr';
import { pdfjs, type PDFDocumentProxy } from './pdfjs';

/**
 * End-to-end ingest: bytes in, narratable blocks out.
 *
 * Two passes over the document. The first reads geometry only and is cheap
 * enough to run on every page of a long book; it also gives us the corpus-wide
 * statistics — body font size, repeated running heads — that the second pass
 * needs in order to judge any individual page correctly.
 *
 * Every page yields to the event loop before the next one starts, and pdf.js
 * page objects are released as we go, so a 300-page book scrolls through at
 * roughly constant memory instead of accumulating the whole document.
 */

export interface ExtractResult {
  blocks: Block[];
  chapters: Chapter[];
  quality: ExtractionQuality;
  title: string;
  author: string;
  pages: number;
  cover?: string;
  ocr: boolean;
}

export interface ExtractOptions {
  onProgress?: (p: ExtractProgress) => void;
  /** Called when the file is encrypted; resolve with the password or null. */
  onPassword?: (retry: boolean) => Promise<string | null>;
  /** Asked before a slow OCR pass; returning false keeps the sparse text. */
  onNeedsOcr?: (scannedPages: number) => Promise<boolean>;
  signal?: AbortSignal;
}

export class CancelledError extends Error {
  constructor() {
    super('Extraction cancelled');
    this.name = 'CancelledError';
  }
}

export class PasswordRequiredError extends Error {
  constructor() {
    super('This PDF is password protected');
    this.name = 'PasswordRequiredError';
  }
}

/** Below this many characters a page is assumed to have no real text layer. */
const SPARSE_PAGE_CHARS = 100;
/** Below this share of pages carrying text, the book is treated as scanned. */
const SCANNED_BOOK_RATIO = 0.6;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function extractBook(
  data: ArrayBuffer,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const { onProgress, onPassword, onNeedsOcr, signal } = opts;
  const check = () => {
    if (signal?.aborted) throw new CancelledError();
  };

  const report = (p: ExtractProgress) => onProgress?.(p);
  report({ phase: 'loading', page: 0, pages: 0, message: 'Opening document' });

  const pdf = await openDocument(data, onPassword);
  const pages = pdf.numPages;

  // ---- Pass one: geometry, page by page. -------------------------------
  const pageInputs: PageInput[] = [];
  const scannedPages: number[] = [];
  let columnsDetected = 1;
  let imagesFound = 0;
  let pagesWithText = 0;
  let cover: string | undefined;

  for (let n = 1; n <= pages; n++) {
    check();
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });

    if (n === 1) cover = await renderCover(page).catch(() => undefined);

    const content = await page.getTextContent({ disableNormalization: false });
    const frags = toFrags(content.items.filter((i) => 'str' in i) as never, viewport.height);
    const { lines: ordered, columns } = layoutPage(frags, viewport.width, viewport.height);
    columnsDetected = Math.max(columnsDetected, columns);

    const chars = ordered.reduce((sum, l) => sum + l.text.trim().length, 0);
    if (chars >= SPARSE_PAGE_CHARS) pagesWithText++;
    else {
      // Only a text-poor page is worth the cost of parsing its content stream.
      const imgs = await countImages(page);
      imagesFound += imgs;
      if (imgs > 0) scannedPages.push(n);
    }

    pageInputs.push({
      page: n,
      width: viewport.width,
      height: viewport.height,
      lines: ordered,
      chars,
    });

    page.cleanup();
    report({ phase: 'scanning', page: n, pages, message: `Reading page ${n} of ${pages}` });
    await yieldToUi();
  }

  // ---- Structure, then chapters. ---------------------------------------
  check();
  report({ phase: 'analysing', page: pages, pages, message: 'Finding chapters and running heads' });

  const textCoverage = pages ? pagesWithText / pages : 0;
  let usedOcr = false;
  let assembled: ReturnType<typeof assembleBook>;

  if (textCoverage < SCANNED_BOOK_RATIO && scannedPages.length > 0 && (await onNeedsOcr?.(scannedPages.length))) {
    const raw = await runOcr(pdf, pages, report, check);
    usedOcr = true;
    assembled = {
      ...finishBook(raw, []),
      bodySize: 0,
      headersStripped: 0,
      stats: { hyphensJoined: 0, notes: 0, tables: 0 },
    };
  } else {
    // The outline is authored metadata and beats anything we can infer.
    const marks: Mark[] = await outlineMarks(pdf);
    assembled = assembleBook(pageInputs, marks);
    await yieldToUi();
    check();
  }

  const meta = await readMetadata(pdf);
  await pdf.loadingTask.destroy();
  if (usedOcr) await releaseOcr();

  report({ phase: 'done', page: pages, pages, message: 'Ready' });

  return {
    blocks: assembled.blocks,
    chapters: assembled.chapters,
    pages,
    cover,
    ocr: usedOcr,
    title: meta.title,
    author: meta.author,
    quality: qualityReport(pageInputs, assembled, {
      scannedPages,
      columnsDetected,
      imagesFound,
      ocr: usedOcr,
    }),
  };
}

/**
 * Opens the document, prompting for a password when the file is encrypted.
 * pdf.js re-invokes `onPassword` itself when the password is wrong, so a
 * single pass through here covers every retry.
 */
async function openDocument(
  data: ArrayBuffer,
  onPassword?: (retry: boolean) => Promise<string | null>,
): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    // Fonts and rendering are irrelevant to text extraction.
    disableFontFace: true,
  });

  let abandoned = false;
  task.onPassword = (updatePassword: (pw: string) => void, reason: number) => {
    if (!onPassword) {
      abandoned = true;
      void task.destroy();
      return;
    }
    const wasWrong = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    onPassword(wasWrong).then((pw) => {
      if (pw === null) {
        abandoned = true;
        void task.destroy();
      } else {
        updatePassword(pw);
      }
    });
  };

  try {
    return await task.promise;
  } catch (err) {
    if (abandoned || err instanceof pdfjs.PasswordException) throw new PasswordRequiredError();
    throw err;
  }
}

/** Counts image-painting operators, the reliable signal for a scanned page. */
async function countImages(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>): Promise<number> {
  try {
    const ops = await page.getOperatorList();
    const wanted = new Set([
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject,
      pdfjs.OPS.paintImageXObjectRepeat,
    ]);
    let count = 0;
    for (const fn of ops.fnArray) if (wanted.has(fn)) count++;
    return count;
  } catch {
    return 0;
  }
}

/** OCR path: every page rendered and recognised, one at a time. */
async function runOcr(
  pdf: PDFDocumentProxy,
  pages: number,
  report: (p: ExtractProgress) => void,
  check: () => void,
): Promise<RawBlock[]> {
  const out: RawBlock[] = [];
  for (let n = 1; n <= pages; n++) {
    check();
    const page = await pdf.getPage(n);
    report({ phase: 'ocr', page: n, pages, message: `Recognising page ${n} of ${pages}` });
    const text = await ocrPage(page, (s) =>
      report({ phase: 'ocr', page: n, pages, message: `Page ${n} of ${pages}: ${s}` }),
    );
    page.cleanup();
    for (const para of ocrToParagraphs(text)) {
      out.push({ type: 'paragraph', text: para, page: n });
    }
    await yieldToUi();
  }
  return out;
}

/** First page as a small JPEG, used for the library shelf. */
async function renderCover(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
): Promise<string | undefined> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.4, 320 / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL('image/jpeg', 0.72);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

async function readMetadata(pdf: PDFDocumentProxy): Promise<{ title: string; author: string }> {
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as { Title?: string; Author?: string } | undefined;
    return {
      title: (info?.Title ?? '').trim(),
      author: (info?.Author ?? '').trim(),
    };
  } catch {
    return { title: '', author: '' };
  }
}
