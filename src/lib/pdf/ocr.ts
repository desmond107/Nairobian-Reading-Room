import type { PDFPageProxy } from './pdfjs';

/**
 * Optical character recognition for scanned books.
 *
 * A photographed page has no text layer, so extraction returns almost nothing.
 * We render the page to a canvas and hand it to Tesseract. The worker is
 * created lazily and reused, because spinning one up costs several seconds and
 * a language model download.
 */

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(onStatus?: (s: string) => void): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then((mod) =>
      mod.createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (onStatus) onStatus(`${m.status} ${Math.round(m.progress * 100)}%`);
        },
      }),
    );
  }
  return workerPromise;
}

/** Frees the language model once a scanned book has finished ingesting. */
export async function releaseOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise;
  workerPromise = null;
  await w.terminate();
}

/**
 * Renders one page and recognises it. Scale 2 is the sweet spot: below it
 * accuracy on 9pt body text collapses, above it the canvas gets large enough
 * to matter on long books.
 */
export async function ocrPage(
  page: PDFPageProxy,
  onStatus?: (s: string) => void,
): Promise<string> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) return '';

  // White ground: Tesseract does badly on transparent pixels.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  try {
    const worker = await getWorker(onStatus);
    const { data } = await worker.recognize(canvas);
    return data.text ?? '';
  } catch {
    return '';
  } finally {
    // Release the backing store straight away; 300 of these would not fit.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Turns raw OCR output into paragraphs, healing the line wraps it leaves in. */
export function ocrToParagraphs(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const paras: string[] = [];
  let buf = '';
  for (const line of lines) {
    if (!line) {
      if (buf) { paras.push(buf); buf = ''; }
      continue;
    }
    if (!buf) { buf = line; continue; }
    if (/[\p{L}\p{N}]-$/u.test(buf) && /^[\p{Ll}]/u.test(line)) buf = buf.slice(0, -1) + line;
    else buf += ` ${line}`;
    // A line ending in a full stop and running short probably ends the paragraph.
    if (/[.!?]["')\]]?$/.test(line) && line.length < 45) { paras.push(buf); buf = ''; }
  }
  if (buf) paras.push(buf);
  return paras.filter((p) => p.length > 1);
}
