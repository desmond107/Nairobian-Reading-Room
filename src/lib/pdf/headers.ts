import type { Line } from './layout';

/**
 * Running heads, folios and footers.
 *
 * The reliable signal is repetition: a phrase that sits in the top or bottom
 * band of a quarter of the book's pages is furniture, not prose. Numbers are
 * masked before counting so "Page 12" and "Page 13" collapse to one form.
 */

export interface BandLine {
  page: number;
  index: number;
  text: string;
  top: boolean;
}

/** Fraction of page height treated as the header and footer bands. */
const BAND = 0.085;

/** Collapses digits and roman numerals so folio variants count as one phrase. */
function signature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/\b[ivxlcdm]+\b/g, '#')
    .replace(/[^a-z#]+/g, ' ')
    .trim();
}

/** A line that is nothing but a page number, in digits or roman numerals. */
function isFolio(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /^[-–—[(]?\s*\d{1,4}\s*[-–—\])]?$/.test(t) ||
    /^[ivxlcdm]{1,7}$/i.test(t) ||
    /^page\s+\d{1,4}(\s+of\s+\d{1,4})?$/i.test(t) ||
    /^\d{1,4}\s*[|·•]\s*.{0,40}$/.test(t) ||
    /^.{0,40}\s*[|·•]\s*\d{1,4}$/.test(t)
  );
}

/** Collects the lines sitting in the header and footer bands of one page. */
export function bandLines(lines: Line[], page: number, pageHeight: number): BandLine[] {
  const out: BandLine[] = [];
  const topEdge = pageHeight * BAND;
  const bottomEdge = pageHeight * (1 - BAND);
  lines.forEach((l, index) => {
    if (l.y <= topEdge) out.push({ page, index, text: l.text, top: true });
    else if (l.y >= bottomEdge) out.push({ page, index, text: l.text, top: false });
  });
  return out;
}

/**
 * Decides which band lines are furniture, given every page's candidates.
 * Returns a set of "page:index" keys for the caller to drop.
 */
export function findRunningHeads(all: BandLine[], pageCount: number): Set<string> {
  const pagesBySig = new Map<string, Set<number>>();
  for (const b of all) {
    for (const key of keysFor(b.text)) {
      let set = pagesBySig.get(key);
      if (!set) pagesBySig.set(key, (set = new Set()));
      set.add(b.page);
    }
  }

  // Repeating on a quarter of the book, or on three pages of a short one.
  const threshold = Math.max(3, Math.floor(pageCount * 0.25));
  const repeating = new Set<string>();
  for (const [sig, pages] of pagesBySig) {
    if (pages.size >= threshold) repeating.add(sig);
  }

  const drop = new Set<string>();
  for (const b of all) {
    // A bare page number never needs to repeat to be recognised.
    if (isFolio(b.text) || keysFor(b.text).some((k) => repeating.has(k))) {
      drop.add(`${b.page}:${b.index}`);
    }
  }
  return drop;
}

/**
 * The forms of a band line worth counting.
 *
 * Whether a running head arrives as one line or two depends on the page's
 * column layout, so "Journal of X" and "Journal of X — Vol. 12" have to be
 * recognised as the same furniture. Counting the leading and trailing words
 * separately catches both halves without matching unrelated prose.
 */
function keysFor(text: string): string[] {
  const sig = signature(text);
  if (!sig || sig.length < 2) return [];
  const words = sig.split(' ').filter(Boolean);
  const keys = [sig];
  if (words.length > 4) {
    keys.push(words.slice(0, 4).join(' '), words.slice(-4).join(' '));
  }
  return keys;
}
