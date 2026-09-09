import type { TextItem } from 'pdfjs-dist/types/src/display/api';

/**
 * Geometry-first reconstruction of a page.
 *
 * pdf.js hands back text fragments in drawing order, which for a two-column
 * page interleaves the columns and makes the narration jump mid-sentence.
 * Everything here exists to recover the order a human eye would use: group
 * fragments into lines, find the gutters, then read column by column.
 */

/** A text fragment with a top-left origin, easier to reason about than PDF space. */
export interface Frag {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font: string;
  size: number;
}

/** A run of fragments sharing a baseline. */
export interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  /** Dominant font size on the line, used for heading and footnote tests. */
  size: number;
  font: string;
  frags: Frag[];
  /** Column this line was assigned to, left to right. */
  column: number;
  /** Largest horizontal gap between fragments — the tell-tale of a table row. */
  maxGap: number;
}

/**
 * Converts pdf.js text items into top-left anchored fragments and drops the
 * empty ones. `transform` is [a, b, c, d, e, f]; d is the vertical scale, which
 * is a far better font-size proxy than the reported `height`.
 */
export function toFrags(items: TextItem[], pageHeight: number): Frag[] {
  const out: Frag[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    const size = Math.abs(t[3]) || it.height || 10;
    out.push({
      str: it.str,
      x: t[4],
      y: pageHeight - t[5],
      w: it.width,
      h: it.height || size,
      font: it.fontName,
      size,
    });
  }
  return out;
}

/** Median of a numeric list; returns 0 for an empty list. */
export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Groups fragments into lines by baseline proximity. Tolerance scales with the
 * text size so footnotes and body text both cluster correctly.
 */
export function buildLines(frags: Frag[]): Line[] {
  if (!frags.length) return [];
  const sorted = [...frags].sort((a, b) => a.y - b.y || a.x - b.x);
  const bodySize = median(frags.map((f) => f.size)) || 10;
  const tol = Math.max(2, bodySize * 0.45);

  const groups: Frag[][] = [];
  let current: Frag[] = [sorted[0]];
  let baseline = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const f = sorted[i];
    if (Math.abs(f.y - baseline) <= tol) {
      current.push(f);
      // Track the running mean so a slowly drifting baseline stays one line.
      baseline = (baseline * (current.length - 1) + f.y) / current.length;
    } else {
      groups.push(current);
      current = [f];
      baseline = f.y;
    }
  }
  groups.push(current);

  return groups.map((g) => assembleLine(g, bodySize));
}

/**
 * Joins one line's fragments, inserting spaces where the horizontal gap says
 * there was one. PDF text runs frequently omit the space character entirely.
 */
function assembleLine(frags: Frag[], bodySize: number): Line {
  const g = [...frags].sort((a, b) => a.x - b.x);
  const sizes = g.map((f) => f.size);
  const size = median(sizes) || bodySize;
  // A space in most book faces is roughly a quarter of the point size.
  const spaceWidth = size * 0.25;

  let text = g[0].str;
  let maxGap = 0;
  for (let i = 1; i < g.length; i++) {
    const prev = g[i - 1];
    const gap = g[i].x - (prev.x + prev.w);
    if (gap > maxGap) maxGap = gap;
    const needsSpace =
      gap > spaceWidth * 0.6 && !/\s$/.test(text) && !/^\s/.test(g[i].str);
    text += (needsSpace ? ' ' : '') + g[i].str;
  }

  const last = g[g.length - 1];
  // The most common font on the line wins; italics inside a sentence shouldn't
  // change how the line is classified.
  const fontCounts = new Map<string, number>();
  for (const f of g) fontCounts.set(f.font, (fontCounts.get(f.font) ?? 0) + f.str.length);
  const font = [...fontCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return {
    text,
    x: g[0].x,
    y: median(g.map((f) => f.y)),
    right: last.x + last.w,
    size,
    font,
    frags: g,
    column: 0,
    maxGap,
  };
}

/**
 * A box that spans the page rather than sitting inside a column: a running
 * head, a title, a footnote block set across the full measure.
 *
 * Width alone is not enough. An article title is centred and often only half
 * the page wide, yet it still crosses the gutter, and treating it as body text
 * hides the gutter and collapses the page to one column. Anything centred on
 * the page centre is spanning by construction, because a column's own centre
 * is nowhere near the page's.
 */
function spansPage(x: number, right: number, pageWidth: number): boolean {
  const width = right - x;
  if (width > pageWidth * 0.72) return true;
  const offCentre = Math.abs((x + right) / 2 - pageWidth / 2);
  return width > pageWidth * 0.08 && offCentre < pageWidth * 0.05;
}

/**
 * Finds vertical gutters by projecting text boxes onto the x-axis and looking
 * for unbroken bands of whitespace.
 *
 * This works on fragments rather than lines, and the order matters. On a
 * two-column page the left and right columns share a baseline, so grouping
 * into lines first fuses them into single full-width lines and erases the
 * gutter before anything can look for it.
 *
 * Two kinds of box are left out of the projection. Full-width ones — running
 * heads, titles, a footnote block set across the measure — cross the gutter by
 * design. And anything in the header or footer band, because a centred page
 * number sits exactly in the gutter and is far too narrow to filter by width.
 */
export function detectColumns(
  frags: Frag[],
  pageWidth: number,
  pageHeight: number,
): [number, number][] {
  const single: [number, number][] = [[0, pageWidth]];
  const topEdge = pageHeight * 0.09;
  const bottomEdge = pageHeight * 0.91;
  const body = frags.filter(
    (f) => !spansPage(f.x, f.x + f.w, pageWidth) && f.y > topEdge && f.y < bottomEdge,
  );
  if (body.length < 12) return single;

  // Sweep the x-axis exactly rather than binning it. A gutter can be as narrow
  // as fifteen points, and rounding fragment edges onto a grid was enough to
  // close one and make a two-column page read as a single fused column.
  const events: { at: number; delta: number }[] = [];
  for (const f of body) {
    events.push({ at: f.x, delta: 1 });
    events.push({ at: f.x + f.w, delta: -1 });
  }
  events.sort((a, b) => a.at - b.at || b.delta - a.delta);

  // One or two stray boxes should not close a gutter on a page full of text.
  const noise = Math.floor(body.length * 0.01);
  const minGutter = pageWidth * 0.018;
  const lo = pageWidth * 0.2;
  const hi = pageWidth * 0.8;

  const gutters: number[] = [];
  let depth = 0;
  let clearFrom: number | null = null;
  for (const e of events) {
    const wasClear = depth <= noise;
    depth += e.delta;
    const isClear = depth <= noise;
    if (wasClear && !isClear && clearFrom !== null) {
      const mid = (clearFrom + e.at) / 2;
      if (e.at - clearFrom >= minGutter && mid > lo && mid < hi) gutters.push(mid);
      clearFrom = null;
    } else if (!wasClear && isClear) {
      clearFrom = e.at;
    }
  }
  if (!gutters.length) return single;

  // Merge gutters within 5% of each other; they are one physical gap.
  const merged: number[] = [];
  for (const gtr of gutters.sort((a, b) => a - b)) {
    if (!merged.length || gtr - merged[merged.length - 1] > pageWidth * 0.05) merged.push(gtr);
  }
  // Books are one, two, or occasionally three columns. More means we misread it.
  if (merged.length > 2) return single;

  const bounds: [number, number][] = [];
  let prev = 0;
  for (const gtr of merged) {
    bounds.push([prev, gtr]);
    prev = gtr;
  }
  bounds.push([prev, pageWidth]);

  // Reject the split if a column came out nearly empty; that "gutter" was a
  // margin and the page is single-column after all.
  const counts = bounds.map(
    (b) => body.filter((f) => f.x + f.w / 2 >= b[0] && f.x + f.w / 2 < b[1]).length,
  );
  if (counts.some((c) => c < body.length * 0.15)) return single;

  return bounds;
}

export interface PageLayout {
  lines: Line[];
  columns: number;
}

/**
 * Reconstructs one page: columns, then lines within each column, then reading
 * order.
 *
 * A full-width line cuts the page into horizontal bands. Everything above it
 * belongs to one run of columns and everything below to the next, which is
 * what keeps a spanning title above the columns it introduces and a footnote
 * block below the columns it annotates.
 */
export function layoutPage(frags: Frag[], pageWidth: number, pageHeight: number): PageLayout {
  if (!frags.length) return { lines: [], columns: 1 };

  const columns = detectColumns(frags, pageWidth, pageHeight);
  if (columns.length <= 1) {
    const lines = buildLines(frags).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const l of lines) l.column = 0;
    return { lines, columns: 1 };
  }

  const banners: Frag[] = [];
  const byColumn: Frag[][] = columns.map(() => []);
  for (const f of frags) {
    if (spansPage(f.x, f.x + f.w, pageWidth)) {
      banners.push(f);
      continue;
    }
    const centreX = f.x + f.w / 2;
    let idx = columns.findIndex((b) => centreX >= b[0] && centreX < b[1]);
    if (idx < 0) idx = centreX < columns[0][1] ? 0 : columns.length - 1;
    byColumn[idx].push(f);
  }

  const columnLines: Line[] = [];
  byColumn.forEach((group, index) => {
    for (const line of buildLines(group)) {
      line.column = index;
      columnLines.push(line);
    }
  });

  // Banner lines are built together so a running head split across the measure
  // stays one line, and read as part of the first column.
  const bannerLines = buildLines(banners);
  for (const l of bannerLines) l.column = 0;

  const ordered: Line[] = [];
  let remaining = columnLines.sort((a, b) => a.y - b.y);
  for (const banner of bannerLines.sort((a, b) => a.y - b.y)) {
    const above = remaining.filter((l) => l.y < banner.y);
    remaining = remaining.filter((l) => l.y >= banner.y);
    ordered.push(...sortBand(above), banner);
  }
  ordered.push(...sortBand(remaining));

  return { lines: ordered, columns: columns.length };
}

/** Within one horizontal band, read each column top to bottom, left to right. */
function sortBand(lines: Line[]): Line[] {
  return lines.sort((a, b) => a.column - b.column || a.y - b.y || a.x - b.x);
}

/** Typical vertical distance between consecutive body lines on a page. */
export function lineSpacing(lines: Line[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].y - lines[i - 1].y;
    if (g > 0 && g < 100) gaps.push(g);
  }
  return median(gaps) || 12;
}

/**
 * Joins fragments into a string, inserting the spaces the PDF omitted.
 * Shared by line assembly and by the footnote-marker stripper, so both agree
 * on where the word boundaries are.
 */
export function joinFrags(frags: Frag[], size: number): string {
  if (!frags.length) return '';
  const spaceWidth = size * 0.25;
  let text = frags[0].str;
  for (let i = 1; i < frags.length; i++) {
    const prev = frags[i - 1];
    const gap = frags[i].x - (prev.x + prev.w);
    const needsSpace =
      gap > spaceWidth * 0.6 && !/\s$/.test(text) && !/^\s/.test(frags[i].str);
    text += (needsSpace ? ' ' : '') + frags[i].str;
  }
  return text;
}

/** Percentile over a numeric list, used for column edge estimates. */
export function percentile(nums: number[], p: number): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[i];
}
