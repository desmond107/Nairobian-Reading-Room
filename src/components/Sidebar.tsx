import { useMemo, useState } from 'react';
import { Bookmark, ListMusic, Trash2, X } from 'lucide-react';
import { usePlayer } from '../state/player';
import { duration, effectiveWpm } from '../lib/format';

type Tab = 'chapters' | 'bookmarks' | 'queue';

/** Chapter list, saved passages, and the multi-book reading queue. */
export function Sidebar({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('chapters');
  const chapters = usePlayer((s) => s.chapters);
  const bookmarks = usePlayer((s) => s.bookmarks);
  const blocks = usePlayer((s) => s.blocks);
  const playQueue = usePlayer((s) => s.playQueue);
  const position = usePlayer((s) => s.position);
  const settings = usePlayer((s) => s.settings);
  const measuredWpm = usePlayer((s) => s.measuredWpm);
  const goToChapter = usePlayer((s) => s.goToChapter);
  const goToBlock = usePlayer((s) => s.goToBlock);
  const removeBookmark = usePlayer((s) => s.removeBookmark);
  const library = usePlayer((s) => s.library);
  const queueIds = usePlayer((s) => s.queueIds);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const book = usePlayer((s) => s.book);

  const wpm = effectiveWpm(measuredWpm, settings.baseWpm, settings.rate);
  const currentChapter = playQueue ? blocks[playQueue.ids[position]]?.chapter ?? 0 : 0;

  const queueBooks = useMemo(
    () => queueIds.map((id) => library.find((b) => b.id === id)).filter(Boolean),
    [queueIds, library],
  );

  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={`tab${tab === 'chapters' ? ' active' : ''}`} onClick={() => setTab('chapters')}>
          Chapters
        </button>
        <button className={`tab${tab === 'bookmarks' ? ' active' : ''}`} onClick={() => setTab('bookmarks')}>
          Marks {bookmarks.length > 0 && `(${bookmarks.length})`}
        </button>
        <button className={`tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>
          Up next
        </button>
      </div>

      <div className="sidebar-body">
        {tab === 'chapters' && (
          chapters.length === 0 ? (
            <div className="empty">No chapters detected in this book.</div>
          ) : (
            chapters.map((chapter) => (
              <button
                key={chapter.index}
                className={`nav-item${chapter.index === currentChapter ? ' active' : ''}`}
                onClick={() => goToChapter(chapter.index)}
              >
                {chapter.title}
                <span className="meta">
                  Page {chapter.page} · {duration((chapter.words / wpm) * 60)}
                  {chapter.source === 'heuristic' && ' · inferred'}
                </span>
              </button>
            ))
          )
        )}

        {tab === 'bookmarks' && (
          bookmarks.length === 0 ? (
            <div className="empty">
              <Bookmark size={22} strokeWidth={1.4} />
              <p>Nothing saved yet. Press B while listening to mark the passage you are on.</p>
            </div>
          ) : (
            bookmarks.map((mark) => (
              <div key={mark.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <button
                  className="nav-item"
                  style={{ flex: 1 }}
                  onClick={() => goToBlock(mark.block, mark.offset)}
                >
                  {mark.excerpt || 'Saved passage'}
                  <span className="meta">
                    Page {blocks[mark.block]?.page ?? '?'}
                    {mark.note && ` · ${mark.note}`}
                  </span>
                </button>
                <button
                  className="btn ghost icon"
                  onClick={() => void removeBookmark(mark.id)}
                  aria-label="Delete bookmark"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )
        )}

        {tab === 'queue' && (
          queueBooks.length === 0 ? (
            <div className="empty">
              <ListMusic size={22} strokeWidth={1.4} />
              <p>Queue books from your library and they will play one after another.</p>
            </div>
          ) : (
            queueBooks.map((entry) => {
              const item = entry!;
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <button
                    className={`nav-item${item.id === book?.id ? ' active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => onOpenBook(item.id)}
                  >
                    {item.title}
                    <span className="meta">
                      {item.pages} pages · {duration((item.words / wpm) * 60)}
                      {item.id === book?.id && ' · playing'}
                    </span>
                  </button>
                  <button
                    className="btn ghost icon"
                    onClick={() => void removeFromQueue(item.id)}
                    aria-label="Remove from queue"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })
          )
        )}
      </div>
    </aside>
  );
}
