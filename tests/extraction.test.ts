import { describe, expect, it } from 'vitest';
import { assembleBook } from '../src/lib/pdf/assemble';
import { fixture, loadPdf } from './loadPdf';

/**
 * End-to-end structural tests against real PDFs whose layout we control:
 * a single-column novel with running heads and an outline, and a two-column
 * journal article with footnotes and a table.
 */

describe('novel: single column, running heads, publisher outline', () => {
  it('reads the book in order and strips the furniture', async () => {
    const { pages, marks, maxColumns, numPages } = await loadPdf(fixture('novel.pdf'));
    expect(numPages).toBe(24);
    expect(maxColumns).toBe(1);

    const book = assembleBook(pages, marks);
    const text = book.blocks.map((b) => b.text).join('\n');

    // Running heads and folios must not reach the narration.
    expect(text).not.toMatch(/THE LEDGER OF SMALL RAINS/);
    expect(book.blocks.some((b) => /^\d{1,2}$/.test(b.text.trim()))).toBe(false);
    expect(book.headersStripped).toBeGreaterThan(20);

    // The outline gives six chapters; nothing should have been invented.
    expect(marks.length).toBe(6);
    expect(book.chapters.length).toBe(6);
    expect(book.chapters.every((c) => c.source === 'outline')).toBe(true);
    expect(book.chapters[0].title).toMatch(/Chapter ONE/);

    // Chapters must partition the book with no gaps.
    for (let i = 1; i < book.chapters.length; i++) {
      expect(book.chapters[i].startBlock).toBe(book.chapters[i - 1].endBlock);
    }
    expect(book.chapters[book.chapters.length - 1].endBlock).toBe(book.blocks.length);
  });

  it('rejoins words broken across a line break', async () => {
    const { pages, marks } = await loadPdf(fixture('novel.pdf'));
    const book = assembleBook(pages, marks);
    const text = book.blocks.map((b) => b.text).join(' ');

    expect(book.stats.hyphensJoined).toBeGreaterThan(30);
    // No paragraph should still carry a hyphen followed by a lowercase letter.
    expect(text).not.toMatch(/[a-z]-\s+[a-z]/);
    // The source words survive intact somewhere in the output.
    expect(text).toMatch(/settlement/);
    expect(text).toMatch(/announcement/);
  });

  it('breaks paragraphs where the typesetter did', async () => {
    const { pages, marks } = await loadPdf(fixture('novel.pdf'));
    const book = assembleBook(pages, marks);
    const paragraphs = book.blocks.filter((b) => b.type === 'paragraph');

    expect(paragraphs.length).toBeGreaterThan(60);
    // A fused page would show up as one enormous block.
    const longest = Math.max(...paragraphs.map((p) => p.words));
    expect(longest).toBeLessThan(220);
    const median = paragraphs.map((p) => p.words).sort((a, b) => a - b)[paragraphs.length >> 1];
    expect(median).toBeGreaterThan(12);
  });
});

describe('journal: two columns, footnotes, a table', () => {
  it('detects both columns and reads them one after the other', async () => {
    const { pages, marks, maxColumns } = await loadPdf(fixture('journal.pdf'));
    expect(maxColumns).toBe(2);

    const book = assembleBook(pages, marks);
    const text = book.blocks.map((b) => b.text).join('\n');

    expect(text).not.toMatch(/JOURNAL OF EAST AFRICAN/);
    expect(text).not.toMatch(/VOL\. 12/);
    // Column interleaving shows up as sentences fused across the gutter.
    expect(book.blocks.filter((b) => b.type === 'paragraph').length).toBeGreaterThan(20);
  });

  it('lifts footnotes out of the prose and into their own blocks', async () => {
    const { pages, marks } = await loadPdf(fixture('journal.pdf'));
    const book = assembleBook(pages, marks);

    const notes = book.blocks.filter((b) => b.type === 'footnote');
    expect(notes.length).toBeGreaterThan(3);
    expect(notes.some((n) => /Reserve Bulletin/.test(n.text))).toBe(true);

    // Note text must not also appear inside a paragraph.
    const prose = book.blocks.filter((b) => b.type === 'paragraph').map((b) => b.text).join(' ');
    expect(prose).not.toMatch(/Reserve Bulletin/);

    // Notes sit at the end of their chapter, after the body they annotate.
    for (const note of notes) {
      const chapter = book.chapters[note.chapter];
      const bodyAfter = book.blocks
        .slice(note.id + 1, chapter.endBlock)
        .filter((b) => b.type === 'paragraph');
      expect(bodyAfter.length).toBe(0);
    }
  });

  it('finds the table and keeps it out of the prose', async () => {
    const { pages, marks } = await loadPdf(fixture('journal.pdf'));
    const book = assembleBook(pages, marks);

    expect(book.stats.tables).toBeGreaterThan(0);
    const tables = book.blocks.filter((b) => b.type === 'table');
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.some((t) => /Machakos/.test(t.text))).toBe(true);

    const prose = book.blocks.filter((b) => b.type === 'paragraph').map((b) => b.text).join(' ');
    expect(prose).not.toMatch(/Machakos/);
  });
});

describe('encrypted and scanned files', () => {
  it('refuses an encrypted PDF without the password and opens it with one', async () => {
    await expect(loadPdf(fixture('locked.pdf'))).rejects.toThrow();
    const { numPages, pages } = await loadPdf(fixture('locked.pdf'), 'swahili');
    expect(numPages).toBe(3);
    expect(pages[0].chars).toBeGreaterThan(200);
  });

  it('recognises an image-only PDF as having no text layer', async () => {
    const { pages } = await loadPdf(fixture('scanned.pdf'));
    // Every page is a photograph: nothing to narrate without OCR.
    expect(pages.every((p) => p.chars < 100)).toBe(true);
  });
});
