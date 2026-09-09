import type { Block, Chapter } from '../../types';
import type { PDFDocumentProxy } from './pdfjs';
import { romanToInt } from '../text/normalize';

/**
 * Chapter markers, from the best source available.
 *
 * A PDF outline is authored by the publisher and is far more reliable than
 * anything we can infer, so it wins whenever it exists. Scanned reprints and
 * many self-published books have none, and there we fall back to headings.
 */

export interface Mark {
  title: string;
  page: number;
}

/** Reads the embedded bookmark tree and resolves each entry to a page number. */
export async function outlineMarks(pdf: PDFDocumentProxy): Promise<Mark[]> {
  let outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;
  try {
    outline = await pdf.getOutline();
  } catch {
    return [];
  }
  if (!outline?.length) return [];

  const marks: Mark[] = [];

  // Only the top two levels; deeper nesting is section detail, not chapters.
  const walk = async (items: typeof outline, depth: number): Promise<void> => {
    for (const item of items) {
      const page = await resolvePage(pdf, item.dest);
      if (page > 0 && item.title?.trim()) {
        marks.push({ title: item.title.trim().replace(/\s+/g, ' '), page });
      }
      if (depth < 1 && item.items?.length) await walk(item.items, depth + 1);
    }
  };
  await walk(outline, 0);

  marks.sort((a, b) => a.page - b.page);
  // Collapse entries landing on the same page; keep the first, it is the title.
  return marks.filter((m, i) => i === 0 || m.page !== marks[i - 1].page);
}

async function resolvePage(pdf: PDFDocumentProxy, dest: unknown): Promise<number> {
  try {
    let target = dest;
    if (typeof target === 'string') target = await pdf.getDestination(target);
    if (!Array.isArray(target) || !target.length) return 0;
    const ref = target[0];
    if (typeof ref === 'number') return ref + 1;
    const index = await pdf.getPageIndex(ref as never);
    return index + 1;
  } catch {
    return 0;
  }
}

const CHAPTER_RE =
  /^(chapter|chap\.?|part|book|section|canto|volume)\s+([0-9]{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
const FRONT_BACK_RE =
  /^(prologue|epilogue|introduction|preface|foreword|afterword|conclusion|appendix|epigraph|dedication|acknowledgements?|acknowledgments?|notes|bibliography|index|glossary|about the author)\b/i;

/** True when a heading reads like the opening of a chapter rather than a section. */
export function looksLikeChapter(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  if (CHAPTER_RE.test(t)) return true;
  if (FRONT_BACK_RE.test(t)) return true;
  // A bare numeral or roman numeral on its own line opens a chapter in novels.
  if (/^\d{1,3}$/.test(t)) return true;
  if (/^[IVXLCDM]{1,7}$/.test(t) && romanToInt(t) > 0) return true;
  return false;
}

/**
 * Chooses the chapter boundaries, as indices into the raw block list.
 *
 * Runs before footnotes are moved to the end of their chapter, so the indices
 * refer to reading order as it came off the page.
 */
export function chapterStarts(
  raw: { type: string; text: string; page: number }[],
  marks: Mark[],
): { index: number; title: string; source: 'outline' | 'heuristic' }[] {
  const starts: { index: number; title: string; source: 'outline' | 'heuristic' }[] = [];

  if (marks.length >= 2) {
    for (const mark of marks) {
      let first = -1;
      let heading = -1;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i].page !== mark.page) continue;
        if (first < 0) first = i;
        if (heading < 0 && raw[i].type === 'heading') heading = i;
      }
      if (first < 0) continue;
      starts.push({ index: heading >= 0 ? heading : first, title: mark.title, source: 'outline' });
    }
  } else {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].type !== 'heading') continue;
      if (!looksLikeChapter(raw[i].text)) continue;
      starts.push({ index: i, title: raw[i].text, source: 'heuristic' });
    }
    // A heading-poor book still deserves navigation. Fall back to even
    // sections, labelled with their opening words so the list is scannable —
    // a column of identical "Page 3" entries is no more use than no list.
    if (starts.length < 2 && raw.length) {
      starts.length = 0;
      // At least a few pages' worth per section: a short book chopped into
      // twelve pieces is noise, not navigation.
      const perChunk = Math.max(25, Math.ceil(raw.length / 12));
      for (let i = 0; i < raw.length; i += perChunk) {
        starts.push({ index: i, title: openingWords(raw[i]), source: 'heuristic' });
      }
    }
  }

  starts.sort((a, b) => a.index - b.index);
  const unique = starts.filter((s, i) => i === 0 || s.index !== starts[i - 1].index);
  if (!unique.length || unique[0].index > 0) {
    unique.unshift({ index: 0, title: 'Opening', source: 'heuristic' });
  }
  return unique;
}

/**
 * Turns finalised blocks plus their chapter stamps into the chapter list used
 * for navigation and time estimates.
 */
export function buildChapters(
  blocks: Block[],
  titles: { title: string; source: 'outline' | 'heuristic' }[],
): Chapter[] {
  const chapters: Chapter[] = titles.map((t, index) => ({
    index,
    title: t.title,
    source: t.source,
    startBlock: -1,
    endBlock: -1,
    page: 1,
    words: 0,
  }));

  for (const b of blocks) {
    const ch = chapters[b.chapter];
    if (!ch) continue;
    if (ch.startBlock < 0) {
      ch.startBlock = b.id;
      ch.page = b.page;
    }
    ch.endBlock = b.id + 1;
    ch.words += b.words;
  }

  // Chapters that ended up empty would break navigation; drop and renumber.
  const kept = chapters.filter((c) => c.startBlock >= 0);
  const remap = new Map<number, number>();
  kept.forEach((c, i) => {
    remap.set(c.index, i);
    c.index = i;
  });
  for (const b of blocks) b.chapter = remap.get(b.chapter) ?? 0;
  return kept;
}

/** A short label for a section that has no heading of its own. */
function openingWords(block: { text: string; page: number }): string {
  const words = block.text.trim().split(/\s+/).slice(0, 7).join(' ');
  if (words.length < 8) return `Page ${block.page}`;
  return `p.${block.page} — ${words}${block.text.trim().split(/\s+/).length > 7 ? '…' : ''}`;
}
