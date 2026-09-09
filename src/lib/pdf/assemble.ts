import type { Block, Chapter, ExtractionQuality } from '../../types';
import { countWords } from '../text/normalize';
import { buildBlocks, documentBodySize, type PageStats, type RawBlock } from './blocks';
import { buildChapters, chapterStarts, type Mark } from './chapters';
import { bandLines, findRunningHeads, type BandLine } from './headers';
import type { Line } from './layout';

/**
 * Everything between "we have the geometry" and "we have a book".
 *
 * Kept free of pdf.js and of the DOM so the whole structural pipeline —
 * running heads, paragraphs, footnotes, chapters — can be exercised directly
 * against real page geometry in tests.
 */

export interface PageInput {
  page: number;
  width: number;
  height: number;
  lines: Line[];
  /** Characters of text found, used to judge whether the page was scanned. */
  chars: number;
}

export interface AssembleResult {
  blocks: Block[];
  chapters: Chapter[];
  bodySize: number;
  headersStripped: number;
  stats: PageStats;
}

export function assembleBook(pages: PageInput[], marks: Mark[]): AssembleResult {
  const bodySize = documentBodySize(pages.map((p) => p.lines));

  const bands: BandLine[] = [];
  for (const p of pages) bands.push(...bandLines(p.lines, p.page, p.height));
  const drop = findRunningHeads(bands, pages.length);

  const stats: PageStats = { hyphensJoined: 0, notes: 0, tables: 0 };
  const raw: RawBlock[] = [];
  for (const p of pages) {
    const kept = p.lines.filter((_, i) => !drop.has(`${p.page}:${i}`));
    raw.push(...buildBlocks(kept, p.page, p.height, bodySize, stats));
  }

  return { ...finishBook(raw, marks), bodySize, headersStripped: drop.size, stats };
}

/**
 * Numbers the blocks and settles the chapter layout. Footnotes are lifted to
 * the end of the chapter they belong to; the play queue can move them back
 * inline later, but the stored order stays stable so bookmarks keep working.
 */
export function finishBook(
  raw: RawBlock[],
  marks: Mark[],
): { blocks: Block[]; chapters: Chapter[] } {
  const starts = chapterStarts(raw, marks);

  const chapterOf = new Int32Array(raw.length);
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s].index;
    const to = s + 1 < starts.length ? starts[s + 1].index : raw.length;
    for (let i = from; i < to; i++) chapterOf[i] = s;
  }

  const ordered: { block: RawBlock; chapter: number }[] = [];
  for (let s = 0; s < starts.length; s++) {
    const body: { block: RawBlock; chapter: number }[] = [];
    const notes: { block: RawBlock; chapter: number }[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (chapterOf[i] !== s) continue;
      (raw[i].type === 'footnote' ? notes : body).push({ block: raw[i], chapter: s });
    }
    ordered.push(...body, ...notes);
  }

  const blocks: Block[] = ordered.map((entry, id) => ({
    id,
    type: entry.block.type,
    text: entry.block.text,
    page: entry.block.page,
    chapter: entry.chapter,
    words: countWords(entry.block.text),
    noteRef: entry.block.noteRef,
  }));

  const chapters = buildChapters(blocks, starts.map((s) => ({ title: s.title, source: s.source })));
  return { blocks, chapters };
}

/** Diagnostics shown in the extraction report. */
export function qualityReport(
  pages: PageInput[],
  result: AssembleResult,
  extras: { scannedPages: number[]; columnsDetected: number; imagesFound: number; ocr: boolean },
): ExtractionQuality {
  const withText = pages.filter((p) => p.chars >= 100).length;
  return {
    textCoverage: extras.ocr ? 1 : pages.length ? withText / pages.length : 0,
    scannedPages: extras.scannedPages,
    columnsDetected: extras.columnsDetected,
    headersStripped: result.headersStripped,
    footnotesFound: result.stats.notes,
    tablesFound: result.stats.tables,
    imagesFound: extras.imagesFound,
    hyphensJoined: result.stats.hyphensJoined,
  };
}
