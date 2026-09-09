import { useEffect, useState } from 'react';
import { ArrowLeft, PanelLeft, TriangleAlert, X } from 'lucide-react';
import { usePlayer } from '../state/player';
import { PlayerBar } from './PlayerBar';
import { ReadingPane } from './ReadingPane';
import { Sidebar } from './Sidebar';

/** The reading screen: navigation, the text column, and the transport. */
export function Reader({
  onBack,
  onOpenBook,
  onOpenSettings,
}: {
  onBack: () => void;
  onOpenBook: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const book = usePlayer((s) => s.book);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const blocks = usePlayer((s) => s.blocks);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const play = usePlayer((s) => s.play);
  const pause = usePlayer((s) => s.pause);
  const skipChunk = usePlayer((s) => s.skipChunk);
  const skipBlock = usePlayer((s) => s.skipBlock);
  const addBookmark = usePlayer((s) => s.addBookmark);
  const setSettings = usePlayer((s) => s.setSettings);
  const settings = usePlayer((s) => s.settings);

  // Keyboard shortcuts, skipped whenever the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (status === 'playing') pause();
          else play();
          break;
        case 'ArrowRight': e.preventDefault(); skipChunk(1); break;
        case 'ArrowLeft': e.preventDefault(); skipChunk(-1); break;
        case 'ArrowDown': e.preventDefault(); skipBlock(1); break;
        case 'ArrowUp': e.preventDefault(); skipBlock(-1); break;
        case 'b': case 'B': void addBookmark(); break;
        case '+': case '=':
          void setSettings({ rate: Math.min(2, Number((settings.rate + 0.05).toFixed(2))) });
          break;
        case '-': case '_':
          void setSettings({ rate: Math.max(0.5, Number((settings.rate - 0.05).toFixed(2))) });
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, play, pause, skipChunk, skipBlock, addBookmark, setSettings, settings.rate]);

  if (!book) return null;

  return (
    <>
      <div className="topbar">
        <button className="btn ghost icon" onClick={onBack} title="Back to library">
          <ArrowLeft size={17} />
        </button>
        <button
          className="btn ghost icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title="Toggle chapter list"
          aria-pressed={sidebarOpen}
        >
          <PanelLeft size={17} />
        </button>
        <div className="brand" style={{ minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book.title}
            <small>{book.author || `${book.pages} pages`}</small>
          </span>
        </div>
        <span className="spacer" />
        {blocks.length === 0 && status !== 'loading' && (
          <span className="badge bad"><TriangleAlert size={11} /> no text extracted</span>
        )}
      </div>

      <div className="reader">
        {sidebarOpen && <Sidebar onOpenBook={onOpenBook} />}
        <div className="reading-pane">
          {error && (
            <div style={{ padding: '12px 24px 0' }}>
              <div className="error-bar">
                <TriangleAlert size={15} />
                <span className="spacer">{error}</span>
                <button className="btn ghost icon" onClick={() => play()} aria-label="Dismiss and retry">
                  <X size={15} />
                </button>
              </div>
            </div>
          )}
          {status === 'loading' ? (
            <div className="empty">Loading the book…</div>
          ) : blocks.length === 0 ? (
            <div className="empty">
              <p>
                No readable text came out of this PDF. It is most likely a scan without
                a text layer. Remove it and add it again to run optical recognition.
              </p>
            </div>
          ) : (
            <ReadingPane />
          )}
          <PlayerBar onOpenSettings={onOpenSettings} />
        </div>
      </div>
    </>
  );
}
