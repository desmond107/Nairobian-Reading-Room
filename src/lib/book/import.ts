import type { BookMeta, ExtractProgress } from '../../types';
import { extractBook, type ExtractOptions } from '../pdf/extract';
import * as db from '../store/db';

/** Turns a dropped file into a stored, playable book. */

export interface ImportHooks {
  onProgress?: (p: ExtractProgress) => void;
  onPassword?: (retry: boolean) => Promise<string | null>;
  onNeedsOcr?: (scannedPages: number) => Promise<boolean>;
  signal?: AbortSignal;
}

/** Strips the extension and tidies the separators publishers leave in filenames. */
function titleFromFileName(name: string): string {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function importPdf(file: File, hooks: ImportHooks = {}): Promise<BookMeta> {
  const data = await file.arrayBuffer();
  const options: ExtractOptions = {
    onProgress: hooks.onProgress,
    onPassword: hooks.onPassword,
    onNeedsOcr: hooks.onNeedsOcr,
    signal: hooks.signal,
  };
  const result = await extractBook(data, options);

  const words = result.blocks.reduce((sum, b) => sum + b.words, 0);
  const meta: BookMeta = {
    id: crypto.randomUUID(),
    // Embedded metadata is often a filename or a template leftover; only trust
    // it when it looks like a real title.
    title: result.title.length > 2 && !/^untitled|^microsoft word/i.test(result.title)
      ? result.title
      : titleFromFileName(file.name),
    author: result.author,
    fileName: file.name,
    fileSize: file.size,
    pages: result.pages,
    words,
    addedAt: Date.now(),
    cover: result.cover,
    ocr: result.ocr,
    quality: result.quality,
  };

  // The original bytes are kept so a book can be re-read with OCR later.
  await db.saveBook(meta, result.blocks, result.chapters, file);
  return meta;
}
