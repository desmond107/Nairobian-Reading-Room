import { useEffect, useState } from 'react';
import { Headphones, Settings as SettingsIcon } from 'lucide-react';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { SettingsDrawer } from './components/SettingsDrawer';
import { installPositionGuard, usePlayer } from './state/player';

export default function App() {
  const init = usePlayer((s) => s.init);
  const openBook = usePlayer((s) => s.openBook);
  const closeBook = usePlayer((s) => s.closeBook);
  const book = usePlayer((s) => s.book);
  const theme = usePlayer((s) => s.settings.theme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void init().finally(() => setReady(true));
    return installPositionGuard();
  }, [init]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      {book ? (
        <Reader
          onBack={closeBook}
          onOpenBook={(id) => void openBook(id)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <>
          <div className="topbar">
            <div className="brand">
              <span className="brand-mark"><Headphones size={16} /></span>
              <span>
                Nairobian Reading Room
                <small>A quiet way to hear your books</small>
              </span>
            </div>
            <span className="spacer" />
            <button className="btn ghost icon" onClick={() => setSettingsOpen(true)} title="Settings">
              <SettingsIcon size={17} />
            </button>
          </div>
          {ready ? <Library onOpen={(id) => void openBook(id)} /> : <div className="empty">Opening your library…</div>}
        </>
      )}

      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
