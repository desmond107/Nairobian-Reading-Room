import type { Block, Settings } from '../../types';
import { ABBREVIATIONS } from '../text/normalize';

/**
 * Splits blocks into utterance-sized chunks and decides how long to rest
 * between them.
 *
 * Two forces set the chunk size. Prosody wants whole sentences, because a
 * synthesiser needs the full clause to place its intonation. Reliability wants
 * short ones, because the Web Speech API drops utterances that run past about
 * fifteen seconds. A sentence, split at clause boundaries only when it is too
 * long, satisfies both.
 */

export interface Chunk {
  /** Block this chunk came from, for progress and highlighting. */
  blockId: number;
  /** Character offset of the chunk inside that block's text. */
  offset: number;
  text: string;
  /** Silence to hold after this chunk, in milliseconds at 1x. */
  pauseAfter: number;
  words: number;
}

/** Longest utterance we will hand to a synthesiser in one go. */
const MAX_CHARS = 260;
/** Below this a trailing fragment is folded back into the previous chunk. */
const MIN_TAIL = 40;

const PAUSE = {
  clause: 130,     // a comma, or a forced split inside a long sentence
  semicolon: 210,
  sentence: 330,
  paragraph: 520,
  heading: 800,
  chapter: 1100,
};

/** Sentence-ending punctuation, allowing a closing quote or bracket after it. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/**
 * True when a period at `i` closes a sentence rather than an abbreviation,
 * an initial, a decimal, or an ellipsis.
 */
function isSentenceBoundary(text: string, i: number): boolean {
  const ch = text[i];
  if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') return false;

  // Skip closing quotes and brackets to find the real gap.
  let j = i + 1;
  while (j < text.length && /["'”’)\]]/.test(text[j])) j++;
  if (j >= text.length) return true;
  if (!/\s/.test(text[j])) return false;

  // The next sentence has to start like one.
  let k = j;
  while (k < text.length && /\s/.test(text[k])) k++;
  if (k >= text.length) return true;
  const next = text[k];
  if (!/[A-Z0-9"'“‘([À-ɏ]/.test(next)) return false;

  if (ch === '.') {
    // "Mr." and "vol." are not sentence ends; "1." mid-line is a list marker.
    const before = text.slice(Math.max(0, i - 14), i);
    const word = before.match(/([\p{L}]+)$/u)?.[1];
    if (word && ABBREVIATIONS.has(word.toLowerCase())) return false;
    if (/\d$/.test(before) && /^\s*\d/.test(text.slice(i + 1))) return false;
  }
  return true;
}

/** Splits a paragraph into sentences without losing any characters. */
export function splitSentences(text: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isSentenceBoundary(text, i)) continue;
    let end = i + 1;
    while (end < text.length && /["'”’)\]]/.test(text[end])) end++;
    const slice = text.slice(start, end).trim();
    if (slice) out.push({ text: slice, offset: start + (text.slice(start, end).length - text.slice(start, end).trimStart().length) });
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) {
    out.push({ text: tail, offset: text.length - text.slice(start).trimStart().length });
  }
  return out;
}

/**
 * Breaks an over-long sentence at the strongest punctuation available, then at
 * a word boundary if it has none. Returns pieces with their pause weights.
 */
function splitLongSentence(
  sentence: string,
  baseOffset: number,
): { text: string; offset: number; pause: number }[] {
  if (sentence.length <= MAX_CHARS) {
    return [{ text: sentence, offset: baseOffset, pause: PAUSE.sentence }];
  }

  const pieces: { text: string; offset: number; pause: number }[] = [];
  let cursor = 0;

  while (cursor < sentence.length) {
    const remaining = sentence.length - cursor;
    if (remaining <= MAX_CHARS) {
      pieces.push({ text: sentence.slice(cursor).trim(), offset: baseOffset + cursor, pause: PAUSE.sentence });
      break;
    }

    const window = sentence.slice(cursor, cursor + MAX_CHARS);
    // Strongest break first: a semicolon or colon reads as a real pause.
    let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '));
    let pause = PAUSE.semicolon;
    if (cut < MIN_TAIL) {
      cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' — '), window.lastIndexOf(' – '));
      pause = PAUSE.clause;
    }
    if (cut < MIN_TAIL) {
      cut = window.lastIndexOf(' ');
      pause = PAUSE.clause;
    }
    if (cut < MIN_TAIL) cut = MAX_CHARS - 1;

    const end = cursor + cut + 1;
    const piece = sentence.slice(cursor, end).trim();
    if (piece) pieces.push({ text: piece, offset: baseOffset + cursor, pause });
    cursor = end;
  }

  return pieces.filter((p) => p.text.length > 0);
}

/** Words in a string, cheap version used for pacing estimates. */
function wordsIn(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Chunks one block. `isChapterOpen` lengthens the rest after a chapter title,
 * which is the single biggest cue that an audiobook has moved on.
 */
export function chunkBlock(block: Block, settings: Settings, isChapterOpen = false): Chunk[] {
  const prefix = decorate(block, settings, isChapterOpen);
  const chunks: Chunk[] = [];

  if (prefix !== null) {
    chunks.push({
      blockId: block.id,
      offset: 0,
      text: prefix,
      pauseAfter: PAUSE.sentence,
      words: wordsIn(prefix),
    });
  }

  // Announcement-only blocks carry no prose of their own.
  if (block.type === 'table' && !settings.readTables) return chunks;
  if (block.type === 'image') return chunks;

  for (const sentence of splitSentences(block.text)) {
    for (const piece of splitLongSentence(sentence.text, sentence.offset)) {
      chunks.push({
        blockId: block.id,
        offset: piece.offset,
        text: piece.text,
        pauseAfter: piece.pause,
        words: wordsIn(piece.text),
      });
    }
  }

  if (chunks.length) {
    const last = chunks[chunks.length - 1];
    last.pauseAfter =
      block.type === 'heading'
        ? isChapterOpen ? PAUSE.chapter : PAUSE.heading
        : Math.max(last.pauseAfter, PAUSE.paragraph);
    // A paragraph that stops mid-clause was cut off by the page; do not rest.
    if (block.type === 'paragraph' && !SENTENCE_END.test(block.text.trim())) {
      last.pauseAfter = PAUSE.clause;
    }
  }

  return chunks;
}

/** The spoken label a non-prose block gets, or null when it needs none. */
function decorate(block: Block, settings: Settings, isChapterOpen: boolean): string | null {
  if (block.type === 'heading' && settings.announceChapters && isChapterOpen) return null;
  if (block.type === 'table') {
    const rows = block.text.split(';').length;
    return settings.readTables ? `Table, ${rows} rows.` : `Table with ${rows} rows, skipped.`;
  }
  if (block.type === 'image') return settings.describeImages ? `Figure. ${block.text}` : null;
  if (block.type === 'footnote') return `Note${block.noteRef ? ` ${block.noteRef}` : ''}.`;
  return null;
}

/** Scales a pause by the playback rate and the user's pacing preference. */
export function scaledPause(ms: number, settings: Settings): number {
  return Math.round((ms * settings.pauseScale) / Math.max(0.5, settings.rate));
}
