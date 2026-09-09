import { describe, expect, it } from 'vitest';
import { buildQueue, positionOf } from '../src/lib/book/queue';
import { assembleBook } from '../src/lib/pdf/assemble';
import { DEFAULT_SETTINGS, type Block, type Chapter } from '../src/types';
import { fixture, loadPdf } from './loadPdf';

/** A chapter with one paragraph, one note-bearing paragraph, and two notes. */
function sample(): { blocks: Block[]; chapters: Chapter[] } {
  const raw: [Block['type'], string, string | undefined][] = [
    ['heading', 'Chapter One', undefined],
    ['paragraph', 'The opening paragraph.', undefined],
    ['paragraph', 'A paragraph that cites something.', '1'],
    ['caption', 'Figure 1. A river.', undefined],
    ['table', 'A 1; B 2; C 3', undefined],
    ['footnote', 'See Otieno.', '1'],
    ['footnote', 'An orphaned note.', '9'],
  ];
  const blocks: Block[] = raw.map(([type, text, noteRef], id) => ({
    id, type, text, page: 1, chapter: 0, words: text.split(' ').length, noteRef,
  }));
  const chapters: Chapter[] = [{
    index: 0, title: 'Chapter One', startBlock: 0, endBlock: blocks.length,
    page: 1, words: 0, source: 'heuristic',
  }];
  return { blocks, chapters };
}

describe('play queue', () => {
  it('reads notes at the end of the chapter by default', () => {
    const { blocks, chapters } = sample();
    const q = buildQueue(blocks, chapters, DEFAULT_SETTINGS);
    expect(q.ids).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('moves a note next to the paragraph that cites it in inline mode', () => {
    const { blocks, chapters } = sample();
    const q = buildQueue(blocks, chapters, { ...DEFAULT_SETTINGS, footnoteMode: 'inline' });
    // Note 5 carries ref "1" and follows block 2, which cites it.
    expect(q.ids.indexOf(5)).toBe(q.ids.indexOf(2) + 1);
    // The unmatched note still gets read, at the end.
    expect(q.ids[q.ids.length - 1]).toBe(6);
  });

  it('drops notes entirely in skip mode', () => {
    const { blocks, chapters } = sample();
    const q = buildQueue(blocks, chapters, { ...DEFAULT_SETTINGS, footnoteMode: 'skip' });
    expect(q.ids).not.toContain(5);
    expect(q.ids).not.toContain(6);
  });

  it('drops captions when the reader turns them off', () => {
    const { blocks, chapters } = sample();
    const q = buildQueue(blocks, chapters, { ...DEFAULT_SETTINGS, readCaptions: false });
    expect(q.ids).not.toContain(3);
  });

  it('counts words cumulatively so the scrubber tracks time', () => {
    const { blocks, chapters } = sample();
    const q = buildQueue(blocks, chapters, DEFAULT_SETTINGS);
    expect(q.cumulativeWords[0]).toBe(0);
    for (let i = 1; i < q.ids.length; i++) {
      expect(q.cumulativeWords[i]).toBeGreaterThanOrEqual(q.cumulativeWords[i - 1]);
    }
    expect(q.totalWords).toBe(blocks.reduce((sum, b) => sum + b.words, 0));
  });

  it('keeps a saved position valid after the settings change', () => {
    const { blocks, chapters } = sample();
    const withNotes = buildQueue(blocks, chapters, DEFAULT_SETTINGS);
    const saved = withNotes.ids[5];

    // The reader switches notes off; the saved block is no longer in the queue.
    const withoutNotes = buildQueue(blocks, chapters, { ...DEFAULT_SETTINGS, footnoteMode: 'skip' });
    const landed = positionOf(withoutNotes, saved);
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(landed).toBeLessThan(withoutNotes.ids.length);
  });

  it('marks where each chapter starts in the queue', () => {
    const { blocks, chapters } = sample();
    const q = buildQueue(blocks, chapters, DEFAULT_SETTINGS);
    expect(q.chapterEntry[0]).toBe(0);
  });
});

describe('play queue over a real book', () => {
  it('covers every narratable block exactly once', async () => {
    const { pages, marks } = await loadPdf(fixture('journal.pdf'));
    const book = assembleBook(pages, marks);

    for (const mode of ['inline', 'endOfChapter', 'skip'] as const) {
      const q = buildQueue(book.blocks, book.chapters, { ...DEFAULT_SETTINGS, footnoteMode: mode });
      expect(new Set(q.ids).size).toBe(q.ids.length);

      const expected = book.blocks.filter(
        (b) => (mode !== 'skip' || b.type !== 'footnote') && b.type !== 'image',
      ).length;
      expect(q.ids.length).toBe(expected);
    }
  });

  it('never reads a chapter out of order', async () => {
    const { pages, marks } = await loadPdf(fixture('novel.pdf'));
    const book = assembleBook(pages, marks);
    const q = buildQueue(book.blocks, book.chapters, DEFAULT_SETTINGS);
    let last = -1;
    for (const id of q.ids) {
      const chapter = book.blocks[id].chapter;
      expect(chapter).toBeGreaterThanOrEqual(last);
      last = chapter;
    }
  });
});
