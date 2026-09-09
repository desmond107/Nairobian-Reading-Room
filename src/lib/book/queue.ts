import type { Block, Chapter, Settings } from '../../types';

/**
 * The order blocks are actually read in.
 *
 * Stored block ids never move, because bookmarks and saved positions point at
 * them. What changes with settings is this derived list: which blocks are read
 * at all, and where the footnotes land. Switching footnote handling therefore
 * costs a recompute, not a re-extraction.
 */

export interface PlayQueue {
  /** Block ids in reading order. */
  ids: number[];
  /** Running word total before each entry, for progress and time left. */
  cumulativeWords: number[];
  totalWords: number;
  /** Queue positions that open a chapter, indexed by chapter number. */
  chapterEntry: number[];
}

function isAudible(block: Block, settings: Settings): boolean {
  switch (block.type) {
    case 'footnote':
      return settings.footnoteMode !== 'skip';
    case 'caption':
      return settings.readCaptions;
    case 'image':
      return settings.describeImages;
    case 'table':
      // Even a skipped table is announced, so the listener knows what was there.
      return true;
    default:
      return true;
  }
}

export function buildQueue(blocks: Block[], chapters: Chapter[], settings: Settings): PlayQueue {
  const ids: number[] = [];

  for (const chapter of chapters) {
    const range = blocks.slice(chapter.startBlock, chapter.endBlock);
    const body = range.filter((b) => b.type !== 'footnote' && isAudible(b, settings));
    const notes = range.filter((b) => b.type === 'footnote' && isAudible(b, settings));

    if (settings.footnoteMode !== 'inline' || !notes.length) {
      ids.push(...body.map((b) => b.id), ...notes.map((b) => b.id));
      continue;
    }

    // Inline mode: each note follows the paragraph that referenced it.
    const pending = new Map<string, Block[]>();
    const orphans: Block[] = [];
    for (const note of notes) {
      if (!note.noteRef) { orphans.push(note); continue; }
      const list = pending.get(note.noteRef) ?? [];
      list.push(note);
      pending.set(note.noteRef, list);
    }
    for (const b of body) {
      ids.push(b.id);
      const matched = b.noteRef ? pending.get(b.noteRef) : undefined;
      if (matched) {
        ids.push(...matched.map((n) => n.id));
        pending.delete(b.noteRef as string);
      }
    }
    // Anything we could not match still gets read, at the end of the chapter.
    for (const list of pending.values()) ids.push(...list.map((n) => n.id));
    ids.push(...orphans.map((n) => n.id));
  }

  const byId = new Map(blocks.map((b) => [b.id, b]));
  const cumulativeWords: number[] = new Array(ids.length);
  let running = 0;
  for (let i = 0; i < ids.length; i++) {
    cumulativeWords[i] = running;
    running += byId.get(ids[i])?.words ?? 0;
  }

  const chapterEntry: number[] = new Array(chapters.length).fill(0);
  const seen = new Set<number>();
  for (let i = 0; i < ids.length; i++) {
    const ch = byId.get(ids[i])?.chapter ?? 0;
    if (!seen.has(ch)) {
      seen.add(ch);
      chapterEntry[ch] = i;
    }
  }

  return { ids, cumulativeWords, totalWords: running, chapterEntry };
}

/** Queue position for a block id, or the nearest following one. */
export function positionOf(queue: PlayQueue, blockId: number): number {
  const exact = queue.ids.indexOf(blockId);
  if (exact >= 0) return exact;
  // The block was filtered out by the current settings; land after it.
  for (let i = 0; i < queue.ids.length; i++) if (queue.ids[i] > blockId) return i;
  return Math.max(0, queue.ids.length - 1);
}
