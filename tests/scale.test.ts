import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleBook } from '../src/lib/pdf/assemble';
import { buildQueue } from '../src/lib/book/queue';
import { chunkBlock } from '../src/lib/tts/chunker';
import { DEFAULT_SETTINGS } from '../src/types';
import { fixture, loadPdf } from './loadPdf';

/**
 * A full-length book, to check the pipeline holds up at the size people
 * actually read. Regenerate the fixture with scripts/make-fixtures.py.
 */

const BIG = fixture('novel-300.pdf');
const describeBig = existsSync(BIG) ? describe : describe.skip;

describeBig('a 300-page book', () => {
  it('extracts, structures and queues without running out of memory', async () => {
    const before = process.memoryUsage().heapUsed;
    const started = Date.now();

    const { pages, marks, numPages } = await loadPdf(BIG);
    expect(numPages).toBe(300);

    const book = assembleBook(pages, marks);
    const queue = buildQueue(book.blocks, book.chapters, DEFAULT_SETTINGS);
    const elapsed = Date.now() - started;
    const grew = (process.memoryUsage().heapUsed - before) / (1024 * 1024);

    expect(book.chapters.length).toBe(25);
    expect(book.blocks.length).toBeGreaterThan(3000);
    expect(queue.totalWords).toBeGreaterThan(90_000);

    // Well inside what a browser tab can hold, and inside a reader's patience.
    expect(grew).toBeLessThan(400);
    expect(elapsed).toBeLessThan(60_000);
    console.log(
      `300 pages: ${book.blocks.length} blocks, ${queue.totalWords} words, ` +
      `${(elapsed / 1000).toFixed(1)}s, heap +${grew.toFixed(0)}MB`,
    );
  }, 120_000);

  it('chunks the whole book into utterances a voice can finish', async () => {
    const { pages, marks } = await loadPdf(BIG);
    const book = assembleBook(pages, marks);
    const queue = buildQueue(book.blocks, book.chapters, DEFAULT_SETTINGS);

    let chunks = 0;
    let longest = 0;
    for (const id of queue.ids) {
      for (const chunk of chunkBlock(book.blocks[id], DEFAULT_SETTINGS)) {
        chunks++;
        longest = Math.max(longest, chunk.text.length);
      }
    }
    expect(chunks).toBeGreaterThan(4000);
    // Anything past roughly 300 characters risks being cut off mid-sentence
    // by the Web Speech API.
    expect(longest).toBeLessThanOrEqual(300);
  }, 120_000);

  it('narrates nearly all of the book as prose', async () => {
    const { pages, marks } = await loadPdf(BIG);
    const book = assembleBook(pages, marks);

    const words = book.blocks.reduce((sum, b) => sum + b.words, 0);
    const prose = book.blocks
      .filter((b) => b.type === 'paragraph' || b.type === 'heading')
      .reduce((sum, b) => sum + b.words, 0);

    // The success bar: 95% of a typical book narrated without hand cleanup.
    expect(prose / words).toBeGreaterThan(0.95);

    // And none of the furniture leaked into it.
    const text = book.blocks.map((b) => b.text).join('\n');
    expect(text).not.toMatch(/THE LEDGER OF SMALL RAINS/);
    expect(book.blocks.some((b) => /^\d{1,3}$/.test(b.text.trim()))).toBe(false);
  }, 120_000);
});
