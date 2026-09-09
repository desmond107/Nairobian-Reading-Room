import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Block, Bookmark, BookMeta, Chapter, Progress, Settings } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';

/**
 * Everything lives in IndexedDB, on the reader's own machine. Nothing is
 * uploaded; the only network calls in the app are to a cloud voice provider
 * when the reader configures one.
 *
 * Blocks are stored as one record per book rather than one per block. A book
 * is always read whole, and a few thousand tiny records is markedly slower to
 * load than a single array.
 */

interface ReaderDB extends DBSchema {
  books: { key: string; value: BookMeta };
  blocks: { key: string; value: { bookId: string; blocks: Block[] } };
  chapters: { key: string; value: { bookId: string; chapters: Chapter[] } };
  files: { key: string; value: { bookId: string; blob: Blob } };
  progress: { key: string; value: Progress };
  bookmarks: { key: string; value: Bookmark; indexes: { byBook: string } };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'nairobi-reader';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null;

function db(): Promise<IDBPDatabase<ReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('books', { keyPath: 'id' });
        database.createObjectStore('blocks', { keyPath: 'bookId' });
        database.createObjectStore('chapters', { keyPath: 'bookId' });
        database.createObjectStore('files', { keyPath: 'bookId' });
        database.createObjectStore('progress', { keyPath: 'bookId' });
        const marks = database.createObjectStore('bookmarks', { keyPath: 'id' });
        marks.createIndex('byBook', 'bookId');
        database.createObjectStore('meta');
      },
    });
  }
  return dbPromise;
}

// ---- Books -------------------------------------------------------------

export async function listBooks(): Promise<BookMeta[]> {
  return (await db()).getAll('books').then((b) => b.sort((x, y) => y.addedAt - x.addedAt));
}

export async function saveBook(
  meta: BookMeta,
  blocks: Block[],
  chapters: Chapter[],
  file?: Blob,
): Promise<void> {
  const database = await db();
  const tx = database.transaction(['books', 'blocks', 'chapters', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').put(meta),
    tx.objectStore('blocks').put({ bookId: meta.id, blocks }),
    tx.objectStore('chapters').put({ bookId: meta.id, chapters }),
    file ? tx.objectStore('files').put({ bookId: meta.id, blob: file }) : Promise.resolve(),
    tx.done,
  ]);
}

export async function updateBook(meta: BookMeta): Promise<void> {
  await (await db()).put('books', meta);
}

export async function loadBlocks(bookId: string): Promise<Block[]> {
  const rec = await (await db()).get('blocks', bookId);
  return rec?.blocks ?? [];
}

export async function saveBlocks(bookId: string, blocks: Block[]): Promise<void> {
  await (await db()).put('blocks', { bookId, blocks });
}

export async function loadChapters(bookId: string): Promise<Chapter[]> {
  const rec = await (await db()).get('chapters', bookId);
  return rec?.chapters ?? [];
}

export async function loadFile(bookId: string): Promise<Blob | null> {
  const rec = await (await db()).get('files', bookId);
  return rec?.blob ?? null;
}

export async function deleteBook(bookId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ['books', 'blocks', 'chapters', 'files', 'progress', 'bookmarks'],
    'readwrite',
  );
  const marks = await tx.objectStore('bookmarks').index('byBook').getAllKeys(bookId);
  await Promise.all([
    tx.objectStore('books').delete(bookId),
    tx.objectStore('blocks').delete(bookId),
    tx.objectStore('chapters').delete(bookId),
    tx.objectStore('files').delete(bookId),
    tx.objectStore('progress').delete(bookId),
    ...marks.map((k) => tx.objectStore('bookmarks').delete(k)),
    tx.done,
  ]);
}

// ---- Position, bookmarks, queue ----------------------------------------

export async function saveProgress(p: Progress): Promise<void> {
  await (await db()).put('progress', p);
}

export async function loadProgress(bookId: string): Promise<Progress | null> {
  return (await (await db()).get('progress', bookId)) ?? null;
}

export async function allProgress(): Promise<Record<string, Progress>> {
  const rows = await (await db()).getAll('progress');
  return Object.fromEntries(rows.map((r) => [r.bookId, r]));
}

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const rows = await (await db()).getAllFromIndex('bookmarks', 'byBook', bookId);
  return rows.sort((a, b) => a.block - b.block);
}

export async function saveBookmark(mark: Bookmark): Promise<void> {
  await (await db()).put('bookmarks', mark);
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await db()).delete('bookmarks', id);
}

export async function loadQueue(): Promise<string[]> {
  return ((await (await db()).get('meta', 'queue')) as string[] | undefined) ?? [];
}

export async function saveQueue(ids: string[]): Promise<void> {
  await (await db()).put('meta', ids, 'queue');
}

// ---- Settings ----------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  const stored = (await (await db()).get('meta', 'settings')) as Partial<Settings> | undefined;
  // Merge rather than replace, so a new setting gets its default on upgrade.
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await (await db()).put('meta', settings, 'settings');
}

/** Rough storage footprint, shown in the library so the shelf can be pruned. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
