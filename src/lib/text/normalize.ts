/**
 * Two-stage text cleanup.
 *
 * `cleanExtracted` runs once at ingest and produces the text we store and
 * display. `toSpeech` runs just before an utterance is queued and rewrites
 * things that synthesisers mispronounce. Keeping them separate means the
 * on-screen text still reads like the book while the audio reads like speech.
 *
 * Every exotic code point below is written as an escape on purpose: literal
 * zero-width and control characters in source are invisible and get mangled
 * by editors and diffs.
 */

/** Ligatures PDF fonts emit as one glyph, expanded back into letters. */
const LIGATURES: Record<string, string> = {
  '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi',
  '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st',
  '\u0132': 'IJ', '\u0133': 'ij', '\u0152': 'OE', '\u0153': 'oe',
};

/** Hyphen lookalikes, folded so the de-hyphenator only matches one shape. */
const HYPHENS = '\u2010\u2011\u2012\u2043\u2212\uff0d';

/** Every flavour of exotic space, folded to U+0020. */
const SPACES =
  '\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007' +
  '\u2008\u2009\u200a\u202f\u205f\u3000';

/** Zero-width joiners, soft hyphen and the BOM: layout artefacts, delete them. */
const INVISIBLES = '\u00ad\u200b\u200c\u200d\u2060\ufeff\ufffd';

/** Bullet variants, folded so list detection has a single shape to match. */
const BULLETS = '\u2023\u25cf\u25aa\u25e6\u00b7\u2219\u25cb\u25a0';

/** Quote and prime lookalikes mapped to their plain equivalents. */
const QUOTE_MAP: Record<string, string> = {
  '\u201a': ',', '\u201b': "'", '\u201e': '"',
  '\u2032': "'", '\u2033': '"', '\u02bc': "'",
};

const FOLD_RE = new RegExp(
  '[' +
    Object.keys(LIGATURES).join('') +
    HYPHENS + SPACES + INVISIBLES + BULLETS +
    Object.keys(QUOTE_MAP).join('') +
  ']',
  'g',
);

function fold(ch: string): string {
  if (ch in LIGATURES) return LIGATURES[ch];
  if (ch in QUOTE_MAP) return QUOTE_MAP[ch];
  if (HYPHENS.includes(ch)) return '-';
  if (SPACES.includes(ch)) return ' ';
  if (BULLETS.includes(ch)) return '\u2022';
  return '';
}

/** C0 and C1 control characters, minus the newline and tab we rely on. */
// eslint-disable-next-line no-control-regex -- stripping them is the point
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * Normalises glyphs, whitespace and stray control characters. Safe to run on
 * any extracted fragment; it never changes word order or drops words.
 */
export function cleanExtracted(raw: string): string {
  let s = raw.normalize('NFC');
  s = s.replace(FOLD_RE, fold);
  s = s.replace(CONTROL_RE, '');
  s = s.replace(/[ \t]+/g, ' ');
  // PDF spacing often detaches punctuation from the word it belongs to.
  s = s.replace(/\s+([,.;:!?%)\]}])/g, '$1');
  s = s.replace(/([([{])\s+/g, '$1');
  // Dot leaders from a table of contents: "Chapter One . . . . . 14".
  s = s.replace(/(?:\s*\.){4,}\s*/g, ' ');
  s = s.replace(/_{3,}/g, ' ');
  return s.trim();
}

/**
 * Abbreviations that end in a period without ending a sentence. Used by both
 * the sentence splitter and the speech rewriter.
 */
export const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'st', 'sr', 'jr', 'fr', 'gen',
  'col', 'lt', 'sgt', 'capt', 'cmdr', 'adm', 'maj', 'gov', 'pres', 'sen', 'rep',
  'vs', 'etc', 'al', 'ibid', 'cf', 'ca', 'circa', 'approx', 'est', 'inc', 'ltd',
  'co', 'corp', 'dept', 'univ', 'assn', 'bros', 'ed', 'eds', 'vol', 'vols',
  'no', 'nos', 'pp', 'p', 'ch', 'chap', 'fig', 'figs', 'sec', 'ref', 'trans',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  // Single letters are almost always initials in a name.
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
]);

/** Latin and reference abbreviations that sound wrong read letter by letter. */
const SPOKEN_PHRASES: [RegExp, string][] = [
  [/\be\.\s?g\.(?=\s|$)/gi, 'for example,'],
  [/\bi\.\s?e\.(?=\s|$)/gi, 'that is,'],
  [/\betc\.(?=\s|$)/gi, 'et cetera.'],
  [/\bcf\.(?=\s|$)/gi, 'compare'],
  [/\bviz\.(?=\s|$)/gi, 'namely'],
  [/\bvs\.?(?=\s|$)/gi, 'versus'],
  [/\bca\.\s(?=\d)/gi, 'circa '],
  [/\bfl\.\s(?=\d)/gi, 'flourished '],
  [/\bc\.\s(?=\d{3,4}\b)/gi, 'circa '],
  [/\bpp\.\s?(?=\d)/gi, 'pages '],
  [/\bp\.\s?(?=\d)/gi, 'page '],
  [/\bch\.\s?(?=\d)/gi, 'chapter '],
  [/\bvol\.\s?(?=\d|[IVX])/gi, 'volume '],
  [/\bfig\.\s?(?=\d)/gi, 'figure '],
  [/\bno\.\s?(?=\d)/gi, 'number '],
  [/\bB\.C\.E\./g, 'B C E'],
  [/\bC\.E\./g, 'C E'],
  [/\bB\.C\./g, 'B C'],
  [/\bA\.D\./g, 'A D'],
  [/\ba\.m\./gi, 'a m'],
  [/\bp\.m\./gi, 'p m'],
  [/\bU\.S\.A\./g, 'U S A'],
  [/\bU\.S\./g, 'U S'],
  [/\bU\.K\./g, 'U K'],
];

/** Symbols that should be spoken as words rather than skipped or spelled. */
const SYMBOLS: [RegExp, string][] = [
  [/(\d)\s*[-–]\s*(\d)/g, '$1 to $2'],       // page and year ranges
  [/\s[–—]\s/g, ', '],                  // dash aside becomes a pause
  [/—/g, ', '],
  [/&/g, ' and '],
  [/(\d)\s*%/g, '$1 percent'],
  [/\$\s?([\d,.]+)\s?(billion|million|trillion)\b/gi, '$1 $2 dollars'],
  [/\$\s?([\d,.]+)/g, '$1 dollars'],
  [/£\s?([\d,.]+)/g, '$1 pounds'],
  [/€\s?([\d,.]+)/g, '$1 euros'],
  [/°\s?C\b/g, ' degrees Celsius'],
  [/°\s?F\b/g, ' degrees Fahrenheit'],
  [/°/g, ' degrees'],
  [/×/g, ' by '],
  [/≠/g, ' not equal to '],
  [/≤/g, ' less than or equal to '],
  [/≥/g, ' greater than or equal to '],
  [/\s=\s/g, ' equals '],
  [/→/g, ' to '],
  [/½/g, ' one half'],
  [/¼/g, ' one quarter'],
  [/¾/g, ' three quarters'],
  [/\[\s*sic\s*\]/gi, ''],
];

/** Superscript digits and note daggers used as footnote markers. */
const SUPERSCRIPTS = /[¹²³⁰⁴-⁹†‡§¶]/g;

/**
 * Rewrites a display string into something a synthesiser reads naturally.
 * Called per chunk at playback time so settings changes take effect at once.
 */
export function toSpeech(text: string): string {
  let s = text;

  s = s.replace(SUPERSCRIPTS, ' ');

  // URLs and emails read as endless letter soup.
  s = s.replace(/\bhttps?:\/\/\S+/gi, 'link');
  s = s.replace(/\bwww\.\S+/gi, 'link');
  s = s.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, 'email address');

  for (const [re, rep] of SPOKEN_PHRASES) s = s.replace(re, rep);
  for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);

  // Straight quotes are safer: a curly quote glued to a letter can swallow it.
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Long all-caps words get spelled out letter by letter by some voices.
  s = s.replace(/\b[A-Z]{4,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());

  // Ellipses become a single pause rather than three separate full stops.
  s = s.replace(/\.\s?\.\s?\./g, '…');
  s = s.replace(/([,.;:!?])\1+/g, '$1');
  s = s.replace(/\s{2,}/g, ' ');

  return s.trim();
}

/** Word count used for progress bars and time-remaining estimates. */
export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** Roman numeral parser, for chapter titles like "Chapter XIV". */
export function romanToInt(s: string): number {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = map[t[i]];
    if (!v) return 0;
    total += v < (map[t[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}
