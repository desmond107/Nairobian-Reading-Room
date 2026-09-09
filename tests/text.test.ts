import { describe, expect, it } from 'vitest';
import { cleanExtracted, countWords, romanToInt, toSpeech } from '../src/lib/text/normalize';
import { chunkBlock, splitSentences } from '../src/lib/tts/chunker';
import { DEFAULT_SETTINGS, type Block } from '../src/types';

const block = (text: string, patch: Partial<Block> = {}): Block => ({
  id: 0, type: 'paragraph', text, page: 1, chapter: 0, words: countWords(text), ...patch,
});

describe('cleanExtracted', () => {
  it('expands ligatures a PDF font emitted as single glyphs', () => {
    expect(cleanExtracted('the ﬁrst ﬂight of ﬃve')).toBe('the first flight of ffive');
  });

  it('removes zero-width characters and soft hyphens', () => {
    expect(cleanExtracted('under­stand​ing')).toBe('understanding');
  });

  it('folds exotic spaces to ordinary ones', () => {
    expect(cleanExtracted('a b c　d')).toBe('a b c d');
  });

  it('reattaches punctuation the layout detached', () => {
    expect(cleanExtracted('He waited , then left .')).toBe('He waited, then left.');
  });

  it('drops the dot leaders from a table of contents', () => {
    expect(cleanExtracted('Chapter One . . . . . . . 14')).toBe('Chapter One 14');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'The rains came late that year, and the valley waited.';
    expect(cleanExtracted(prose)).toBe(prose);
  });
});

describe('toSpeech', () => {
  it('says Latin abbreviations as words', () => {
    expect(toSpeech('Some fruit, e.g. mangoes')).toContain('for example');
    expect(toSpeech('The result, i.e. failure')).toContain('that is');
  });

  it('reads references rather than spelling them', () => {
    expect(toSpeech('see pp. 14')).toContain('pages 14');
    expect(toSpeech('Vol. 12')).toContain('volume 12');
  });

  it('turns number ranges into spoken ranges', () => {
    expect(toSpeech('pages 14-24')).toContain('14 to 24');
  });

  it('replaces symbols that would otherwise be skipped', () => {
    expect(toSpeech('growth of 12%')).toContain('12 percent');
    expect(toSpeech('cost $40 million')).toContain('40 million dollars');
    expect(toSpeech('tea & coffee')).toContain('and');
  });

  it('collapses a URL rather than spelling it out', () => {
    expect(toSpeech('see https://example.com/a/b?c=1 for more')).toBe('see link for more');
  });

  it('strips superscript note markers', () => {
    expect(toSpeech('the treaty failed¹')).toBe('the treaty failed');
  });

  it('stops long capitals being spelled letter by letter', () => {
    expect(toSpeech('the UNESCO report')).toContain('Unesco');
    // Short acronyms are still read as letters, which is what listeners expect.
    expect(toSpeech('the UN report')).toContain('UN');
  });

  it('keeps a dash aside as a pause instead of a silent gap', () => {
    expect(toSpeech('the road — a bad one — washed away')).toContain(', a bad one, washed');
  });
});

describe('splitSentences', () => {
  it('splits on sentence ends and keeps the offsets', () => {
    const text = 'The rains came. The valley waited. Nobody spoke.';
    const parts = splitSentences(text);
    expect(parts.map((p) => p.text)).toEqual([
      'The rains came.', 'The valley waited.', 'Nobody spoke.',
    ]);
    for (const p of parts) expect(text.slice(p.offset, p.offset + p.text.length)).toBe(p.text);
  });

  it('does not split on a title or an initial', () => {
    expect(splitSentences('Mr. Ndungu kept the ledger.').length).toBe(1);
    expect(splitSentences('J. R. R. Tolkien wrote it.').length).toBe(1);
    expect(splitSentences('See vol. 12 for the rest.').length).toBe(1);
  });

  it('does not split inside a decimal number', () => {
    expect(splitSentences('The rate was 3.5 per cent that year.').length).toBe(1);
  });

  it('keeps a closing quotation mark with its sentence', () => {
    const parts = splitSentences('"You write too much." He said nothing.');
    expect(parts[0].text).toBe('"You write too much."');
    expect(parts.length).toBe(2);
  });

  it('loses no text', () => {
    const text = 'One. Two! Three? Four... Five.';
    const joined = splitSentences(text).map((p) => p.text).join(' ');
    expect(joined.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
});

describe('chunkBlock', () => {
  it('rests longer at a paragraph end than at a full stop', () => {
    const chunks = chunkBlock(block('One thing happened. Then another thing happened.'), DEFAULT_SETTINGS);
    expect(chunks.length).toBe(2);
    expect(chunks[1].pauseAfter).toBeGreaterThan(chunks[0].pauseAfter);
  });

  it('rests longest of all at a chapter opening', () => {
    const heading = chunkBlock(block('Chapter Four', { type: 'heading' }), DEFAULT_SETTINGS, true);
    const midChapter = chunkBlock(block('Chapter Four', { type: 'heading' }), DEFAULT_SETTINGS, false);
    expect(heading[0].pauseAfter).toBeGreaterThan(midChapter[0].pauseAfter);
  });

  it('does not rest where a paragraph was cut off by the page', () => {
    const chunks = chunkBlock(block('the sentence simply stops here and'), DEFAULT_SETTINGS);
    expect(chunks[chunks.length - 1].pauseAfter).toBeLessThan(200);
  });

  it('breaks an over-long sentence at a clause boundary', () => {
    const long = `${'the valley waited for the rains, '.repeat(14)}and then they came.`;
    const chunks = chunkBlock(block(long), DEFAULT_SETTINGS);
    expect(chunks.length).toBeGreaterThan(1);
    // Every piece must be short enough for a browser voice to finish it.
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(280);
    // And no text may be lost in the process.
    const rebuilt = chunks.map((c) => c.text).join(' ').replace(/\s+/g, '');
    expect(rebuilt).toBe(long.replace(/\s+/g, ''));
  });

  it('announces a skipped table instead of reading the numbers', () => {
    const table = block('District 1961; Kiambu 412; Nyeri 298', { type: 'table' });
    const chunks = chunkBlock(table, DEFAULT_SETTINGS);
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toMatch(/Table with 3 rows, skipped/);
  });

  it('reads a table when asked to', () => {
    const table = block('District 1961; Kiambu 412', { type: 'table' });
    const chunks = chunkBlock(table, { ...DEFAULT_SETTINGS, readTables: true });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join(' ')).toContain('Kiambu');
  });

  it('labels a footnote so it is not mistaken for the prose', () => {
    const note = block('See Otieno, Reserve Bulletin.', { type: 'footnote', noteRef: '4' });
    expect(chunkBlock(note, DEFAULT_SETTINGS)[0].text).toBe('Note 4.');
  });

  it('keeps every chunk pointing back at its place in the block', () => {
    const text = 'First sentence here. Second sentence here. Third one here.';
    for (const c of chunkBlock(block(text), DEFAULT_SETTINGS)) {
      expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    }
  });
});

describe('romanToInt', () => {
  it('reads chapter numerals', () => {
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('iv')).toBe(4);
    expect(romanToInt('MCMXCIV')).toBe(1994);
  });
  it('rejects anything that is not a numeral', () => {
    expect(romanToInt('hello')).toBe(0);
  });
});
