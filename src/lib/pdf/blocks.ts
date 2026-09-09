import type { BlockType } from '../../types';
import { cleanExtracted, countWords } from '../text/normalize';
import { joinFrags, lineSpacing, median, percentile, type Line } from './layout';

/**
 * Turns one page's ordered lines into narratable blocks.
 *
 * The hard problems here are the ones that make TTS sound broken: paragraphs
 * fused into one wall of speech, words split across a line break read as two
 * words, and footnote digits pronounced in the middle of a sentence.
 */

export interface RawBlock {
  type: BlockType;
  text: string;
  page: number;
  /** Footnote marker this paragraph referenced, or that this note carries. */
  noteRef?: string;
  /** Rows counted while parsing, so a skipped table can still be announced. */
  rows?: number;
}

export interface PageStats {
  hyphensJoined: number;
  notes: number;
  tables: number;
}

type Kind = 'body' | 'heading' | 'table' | 'note' | 'caption' | 'list';

const BOLD_RE = /bold|black|heavy|semibold|demibold/i;
const HEADING_WORD =
  /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|conclusion|appendix|interlude|coda|acknowledg)/i;
const LIST_RE = /^([•\-–]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/;
const CAPTION_RE = /^(fig(ure)?|table|plate|chart|exhibit|diagram|map|source|photo)\b[\s.:]?\s*\d*/i;
const NOTE_START_RE = /^(\d{1,3}[.)\]]?\s+|[*†‡§]{1,3}\s*)/;

/** A fragment small enough, and short enough, to be a superscript note marker. */
function isMarkerFrag(str: string, size: number, lineSize: number): boolean {
  return size < lineSize * 0.84 && /^[0-9]{1,3}$|^[*†‡§]{1,2}$/.test(str.trim());
}

/**
 * Rebuilds a line without its superscript footnote markers, returning the
 * markers it removed. Leaving them in makes a voice read "the treaty failed 14"
 * mid-sentence.
 */
function stripMarkers(line: Line): { text: string; refs: string[] } {
  const refs: string[] = [];
  const kept = line.frags.filter((f) => {
    if (isMarkerFrag(f.str, f.size, line.size)) {
      refs.push(f.str.trim());
      return false;
    }
    return true;
  });
  if (!refs.length) return { text: line.text, refs };
  return { text: joinFrags(kept, line.size), refs };
}

/** Scores a line as a heading. Books signal headings with size, weight and brevity. */
function headingScore(line: Line, bodySize: number, left: number, right: number): number {
  const t = line.text.trim();
  if (!t) return 0;
  let score = 0;

  if (line.size >= bodySize * 1.35) score += 3;
  else if (line.size >= bodySize * 1.15) score += 2;
  else if (line.size >= bodySize * 1.05) score += 1;

  if (BOLD_RE.test(line.font)) score += 1;
  if (t.length <= 70) score += 1;
  else score -= 3;
  if (!/[.,;:]$/.test(t)) score += 1;
  if (t === t.toUpperCase() && /[A-Z]/.test(t) && t.length > 2) score += 1;
  if (HEADING_WORD.test(t)) score += 3;
  // Roman or spelled numerals alone on a line are almost always chapter marks.
  if (/^([IVXLC]{1,7}|\d{1,3})$/.test(t)) score += 2;

  const width = right - left;
  const lineCentre = (line.x + line.right) / 2;
  const colCentre = (left + right) / 2;
  if (width > 0 && Math.abs(lineCentre - colCentre) < width * 0.06 && line.right - line.x < width * 0.85) {
    score += 1;
  }
  return score;
}

/** A row with wide internal gaps, or mostly numbers, reads as tabular. */
function tableScore(line: Line, bodySize: number): boolean {
  if (line.maxGap > bodySize * 2.2) return true;
  const tokens = line.text.trim().split(/\s+/);
  if (tokens.length >= 3) {
    const numeric = tokens.filter((t) => /^[\d.,%$()\-–]+$/.test(t)).length;
    if (numeric / tokens.length >= 0.6) return true;
  }
  return false;
}

/**
 * Finds where a page's footnote apparatus begins. Notes are set smaller than
 * body text and live below it, usually opening with their own marker.
 */
function noteStartIndex(lines: Line[], bodySize: number, pageHeight: number): number {
  const floor = pageHeight * 0.58;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.y < floor) continue;
    if (l.size >= bodySize * 0.92) continue;
    if (!NOTE_START_RE.test(l.text.trim())) continue;
    // Everything after this point must stay small, or it was a false alarm.
    const rest = lines.slice(i);
    const smallShare = rest.filter((r) => r.size < bodySize * 0.94).length / rest.length;
    if (smallShare > 0.7) return i;
  }
  return -1;
}

/**
 * Joins two lines of one paragraph, healing words broken across the break.
 * A trailing hyphen before a lowercase continuation is a soft break and the
 * hyphen goes; before a capital it is a real compound and the hyphen stays.
 */
function joinWrapped(acc: string, next: string, stats: PageStats): string {
  const a = acc.replace(/\s+$/, '');
  const b = next.replace(/^\s+/, '');
  if (!a) return b;
  if (!b) return a;

  if (/[\p{L}\p{N}]-$/u.test(a)) {
    if (/^[\p{Ll}]/u.test(b)) {
      stats.hyphensJoined++;
      return a.slice(0, -1) + b;
    }
    // "Anglo-" + "Saxon": keep the hyphen, drop the space.
    return a + b;
  }
  return `${a} ${b}`;
}

/**
 * The main per-page pass. `bodySize` comes from the whole document so a page
 * of nothing but large display type is not mistaken for body text.
 *
 * The page is handled one column at a time. Footnotes are found by looking for
 * small type low on the page, and on a two-column page the ordered line list
 * runs "column one, its notes, column two" — so a whole-page search would put
 * the note boundary before the second column and swallow it entirely.
 */
export function buildBlocks(
  lines: Line[],
  page: number,
  pageHeight: number,
  bodySize: number,
  stats: PageStats,
): RawBlock[] {
  if (!lines.length) return [];
  const out: RawBlock[] = [];
  for (const segment of columnRuns(lines)) {
    out.push(...buildSegment(segment, page, pageHeight, bodySize, stats));
  }
  return out;
}

/** Splits the ordered lines into contiguous runs belonging to one column. */
function columnRuns(lines: Line[]): Line[][] {
  const runs: Line[][] = [];
  let current: Line[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].column === lines[i - 1].column) current.push(lines[i]);
    else { runs.push(current); current = [lines[i]]; }
  }
  runs.push(current);
  return runs;
}

function buildSegment(
  lines: Line[],
  page: number,
  pageHeight: number,
  bodySize: number,
  stats: PageStats,
): RawBlock[] {
  const blocks: RawBlock[] = [];
  if (!lines.length) return blocks;

  const spacing = lineSpacing(lines);
  const noteFrom = noteStartIndex(lines, bodySize, pageHeight);

  // Strip superscript note markers up front. The paragraph-break test asks
  // whether a line ends a sentence, and a trailing marker digit makes
  // "...entirely away.14" look like a line that stops mid-clause, which fuses
  // the paragraph into the next one.
  const stripped = lines.map(stripMarkers);

  // Column edges, taken from percentiles so one stray line cannot skew them.
  const byColumn = new Map<number, Line[]>();
  for (const l of lines) {
    const arr = byColumn.get(l.column) ?? [];
    arr.push(l);
    byColumn.set(l.column, arr);
  }
  const edges = new Map<number, [number, number]>();
  for (const [col, ls] of byColumn) {
    edges.set(col, [percentile(ls.map((l) => l.x), 0.1), percentile(ls.map((l) => l.right), 0.9)]);
  }

  // Pass one: label every line.
  const kinds: Kind[] = lines.map((l, i) => {
    if (noteFrom >= 0 && i >= noteFrom) return 'note';
    const [left, right] = edges.get(l.column) ?? [0, 0];
    if (CAPTION_RE.test(l.text.trim()) && l.size <= bodySize * 1.05) return 'caption';
    if (headingScore(l, bodySize, left, right) >= 4) return 'heading';
    if (tableScore(l, bodySize)) return 'table';
    if (LIST_RE.test(l.text.trim())) return 'list';
    return 'body';
  });

  // A lone wide-gapped line is usually justified text, not a table. Demote any
  // tabular run shorter than three lines.
  for (let i = 0; i < kinds.length; ) {
    if (kinds[i] !== 'table') { i++; continue; }
    let j = i;
    while (j < kinds.length && kinds[j] === 'table') j++;
    if (j - i < 3) for (let k = i; k < j; k++) kinds[k] = 'body';
    else stats.tables++;
    i = j;
  }

  // Pass two: gather runs into blocks.
  let i = 0;
  while (i < lines.length) {
    const kind = kinds[i];

    if (kind === 'table') {
      let j = i;
      while (j < lines.length && kinds[j] === 'table') j++;
      const rows = j - i;
      const text = lines.slice(i, j).map((l) => cleanExtracted(l.text)).join('; ');
      blocks.push({ type: 'table', text, page, rows });
      i = j;
      continue;
    }

    if (kind === 'heading') {
      // Consecutive heading lines are one title spilling over two lines.
      let j = i;
      let text = '';
      while (j < lines.length && kinds[j] === 'heading' && j - i < 3) {
        text = text ? `${text} ${lines[j].text.trim()}` : lines[j].text.trim();
        j++;
      }
      blocks.push({ type: 'heading', text: cleanExtracted(text), page });
      i = j;
      continue;
    }

    if (kind === 'note') {
      // Each note begins at its own marker; blank markers continue the previous.
      let j = i;
      let text = '';
      let ref: string | undefined;
      const start = stripped[i];
      const m = start.text.trim().match(NOTE_START_RE);
      ref = m ? m[0].trim().replace(/[.)\]]$/, '') : undefined;
      text = m ? start.text.trim().slice(m[0].length) : start.text.trim();
      j = i + 1;
      while (j < lines.length && kinds[j] === 'note' && !NOTE_START_RE.test(lines[j].text.trim())) {
        text = joinWrapped(text, lines[j].text, stats);
        j++;
      }
      const cleaned = cleanExtracted(text);
      if (cleaned) {
        stats.notes++;
        blocks.push({ type: 'footnote', text: cleaned, page, noteRef: ref });
      }
      i = j;
      continue;
    }

    if (kind === 'caption') {
      blocks.push({ type: 'caption', text: cleanExtracted(stripped[i].text), page });
      i++;
      continue;
    }

    // Body and list runs, split into paragraphs.
    const type: BlockType = kind === 'list' ? 'list' : 'paragraph';
    const [left, right] = edges.get(lines[i].column) ?? [0, 0];
    const colWidth = right - left;
    let text = '';
    const refs: string[] = [];
    let j = i;

    while (j < lines.length && (kinds[j] === kind || (kind === 'body' && kinds[j] === 'list' && j > i))) {
      refs.push(...stripped[j].refs);
      text = text ? joinWrapped(text, stripped[j].text, stats) : stripped[j].text.trim();

      const next = lines[j + 1];
      if (!next || kinds[j + 1] !== kinds[j]) { j++; break; }
      if (next.column !== lines[j].column) { j++; break; }

      const gap = next.y - lines[j].y;
      const endsSentence = /[.!?]["'”’)\]]?$/.test(stripped[j].text.trim());
      const shortLine = colWidth > 0 && lines[j].right < right - lineSpacingSlack(bodySize);
      const indented = colWidth > 0 && next.x > left + bodySize * 0.7;

      // Any one of these is how a book announces a new paragraph.
      const paragraphBreak =
        gap > spacing * 1.5 ||
        (endsSentence && shortLine) ||
        (endsSentence && indented) ||
        (kind === 'list' && LIST_RE.test(next.text.trim()));

      if (paragraphBreak) { j++; break; }
      j++;
    }

    const cleaned = cleanExtracted(text);
    if (cleaned) {
      blocks.push({ type, text: cleaned, page, noteRef: refs[0] });
    }
    i = j;
  }

  return blocks.filter((b) => b.text.length > 0);
}

/** How far short of the margin a line must fall to count as a paragraph end. */
function lineSpacingSlack(bodySize: number): number {
  return bodySize * 2.2;
}

/** Document-wide body font size, weighted by how much text is set in it. */
export function documentBodySize(allLines: Line[][]): number {
  const weighted: number[] = [];
  for (const page of allLines) {
    for (const l of page) {
      // Round to a tenth so near-identical sizes cluster.
      const s = Math.round(l.size * 10) / 10;
      const weight = Math.min(4, Math.ceil(l.text.length / 20));
      for (let i = 0; i < weight; i++) weighted.push(s);
    }
  }
  return median(weighted) || 10;
}

export { countWords };
