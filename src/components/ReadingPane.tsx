import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, Pencil, X } from 'lucide-react';
import type { Block } from '../types';
import { usePlayer } from '../state/player';
import { toSpeech } from '../lib/text/normalize';

/**
 * The reading column.
 *
 * Only a window of blocks around the current one is rendered. A 300-page book
 * is tens of thousands of blocks, and mounting them all would cost more than
 * the extraction did. The window is wide enough that ordinary scrolling never
 * reaches its edge before the next re-render moves it.
 */

const WINDOW_BEFORE = 25;
const WINDOW_AFTER = 45;

export function ReadingPane() {
  const blocks = usePlayer((s) => s.blocks);
  const playQueue = usePlayer((s) => s.playQueue);
  const position = usePlayer((s) => s.position);
  const chunks = usePlayer((s) => s.chunks);
  const chunkIndex = usePlayer((s) => s.chunkIndex);
  const charIndex = usePlayer((s) => s.charIndex);
  const status = usePlayer((s) => s.status);
  const chapters = usePlayer((s) => s.chapters);
  const goToBlock = usePlayer((s) => s.goToBlock);
  const addBookmark = usePlayer((s) => s.addBookmark);
  const editBlock = usePlayer((s) => s.editBlock);

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  // An open editor belongs to one block. If playback has moved on, the editor
  // is stale, so it is derived here rather than cleared from an effect.
  const [editingAt, setEditingAt] = useState<number | null>(null);

  const currentBlockId = playQueue?.ids[position];
  const activeEditor = editingAt === currentBlockId ? editing : null;

  const window = useMemo(() => {
    if (!playQueue) return [] as { block: Block; queueIndex: number }[];
    const from = Math.max(0, position - WINDOW_BEFORE);
    const to = Math.min(playQueue.ids.length, position + WINDOW_AFTER);
    const out: { block: Block; queueIndex: number }[] = [];
    for (let i = from; i < to; i++) {
      const block = blocks[playQueue.ids[i]];
      if (block) out.push({ block, queueIndex: i });
    }
    return out;
  }, [blocks, playQueue, position]);

  // Follow along, but never yank the page while someone is reading ahead.
  useLayoutEffect(() => {
    const el = currentRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    const box = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const comfortable = box.top > view.top + view.height * 0.15 && box.bottom < view.bottom - 40;
    if (!comfortable) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentBlockId]);

  const chapterStartIds = useMemo(
    () => new Set(chapters.map((c) => c.startBlock)),
    [chapters],
  );

  if (!playQueue) return null;

  return (
    <div className="reading-scroll" ref={scrollRef}>
      <div className="page-column">
        {window.map(({ block, queueIndex }) => {
          const isCurrent = queueIndex === position;
          // The opening chapter needs no marker; the title bar already says
          // which book this is and the reader has not gone anywhere yet.
          const startsChapter = chapterStartIds.has(block.id)
            ? chapters.find((c) => c.startBlock === block.id)
            : undefined;
          const chapterTitle = startsChapter && startsChapter.index > 0 ? startsChapter.title : null;

          if (activeEditor === block.id) {
            return (
              <div key={block.id} className="blk">
                <textarea
                  className="edit-area"
                  rows={Math.min(14, Math.ceil(draft.length / 70) + 2)}
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    className="btn primary"
                    onClick={() => { void editBlock(block.id, draft); setEditing(null); }}
                  >
                    <Check size={15} /> Save correction
                  </button>
                  <button className="btn ghost" onClick={() => setEditing(null)}>
                    <X size={15} /> Cancel
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={block.id}
              ref={isCurrent ? currentRef : undefined}
              className={`blk ${block.type}${isCurrent ? ' current' : ''}`}
              onDoubleClick={() => goToBlock(block.id)}
              title="Double-click to start reading here"
            >
              {chapterTitle && block.type !== 'heading' && (
                <span className="chapter-rule">{chapterTitle}</span>
              )}
              {block.type === 'footnote' && <span className="blk-tag">Note {block.noteRef ?? ''}</span>}
              {block.type === 'table' && <span className="blk-tag">Table</span>}
              {block.type === 'caption' && <span className="blk-tag">Caption</span>}
              {block.edited && <span className="blk-tag">Edited</span>}

              {isCurrent && status === 'playing' && chunks[chunkIndex]
                ? renderWithHighlight(block.text, chunks[chunkIndex].offset, chunks[chunkIndex].text, charIndex)
                : block.text}

              <div className="blk-tools">
                <button
                  className="btn ghost icon"
                  title="Bookmark this passage"
                  onClick={() => { goToBlock(block.id); void addBookmark(); }}
                >
                  <Bookmark size={14} />
                </button>
                <button
                  className="btn ghost icon"
                  title="Correct the extracted text"
                  onClick={() => {
                    setEditing(block.id);
                    setEditingAt(currentBlockId ?? block.id);
                    setDraft(block.text);
                  }}
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Marks the sentence being spoken, and the word inside it.
 *
 * The boundary event indexes the speech-normalised string, which is a
 * different length from what is on screen, so the position is carried across
 * proportionally. It lands within a word or two, which is all the eye needs.
 */
function renderWithHighlight(
  text: string,
  offset: number,
  chunkText: string,
  charIndex: number,
) {
  const end = Math.min(text.length, offset + chunkText.length);
  const before = text.slice(0, offset);
  const live = text.slice(offset, end);
  const after = text.slice(end);

  const spokenLength = toSpeech(chunkText).length || 1;
  const scaled = Math.round((charIndex / spokenLength) * live.length);

  let wordStart = Math.min(live.length - 1, Math.max(0, scaled));
  while (wordStart > 0 && !/\s/.test(live[wordStart - 1])) wordStart--;
  let wordEnd = wordStart;
  while (wordEnd < live.length && !/\s/.test(live[wordEnd])) wordEnd++;

  return (
    <>
      {before}
      <mark className="chunk-live">
        {live.slice(0, wordStart)}
        <span className="word-live">{live.slice(wordStart, wordEnd)}</span>
        {live.slice(wordEnd)}
      </mark>
      {after}
    </>
  );
}
