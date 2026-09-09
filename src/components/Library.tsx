import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Check, FileText, GripVertical, ListMusic, Lock, LoaderCircle,
  Plus, ScanText, Trash2, TriangleAlert, Upload, X,
} from 'lucide-react';
import type { BookMeta, ExtractProgress } from '../types';
import { importPdf } from '../lib/book/import';
import { CancelledError, PasswordRequiredError } from '../lib/pdf/extract';
import { usePlayer } from '../state/player';
import { duration, effectiveWpm, fileSize, percent } from '../lib/format';
import { Modal } from './Modal';

/** One file being ingested, tracked so several can run back to back. */
interface Job {
  id: string;
  name: string;
  message: string;
  fraction: number;
  error?: string;
  done?: boolean;
}

/** A prompt that a background task is waiting on. */
interface Ask<T> {
  resolve: (value: T) => void;
  detail: string;
}

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const library = usePlayer((s) => s.library);
  const queueIds = usePlayer((s) => s.queueIds);
  const progressByBook = usePlayer((s) => s.progressByBook);
  const settings = usePlayer((s) => s.settings);
  const refreshLibrary = usePlayer((s) => s.refreshLibrary);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const reorderQueue = usePlayer((s) => s.reorderQueue);
  const removeBook = usePlayer((s) => s.removeBook);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [passwordAsk, setPasswordAsk] = useState<Ask<string | null> | null>(null);
  const [ocrAsk, setOcrAsk] = useState<Ask<boolean> | null>(null);
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<BookMeta | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragIndex = useRef<number | null>(null);

  const update = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const ingest = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (!pdfs.length) return;

      for (const file of pdfs) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        setJobs((prev) => [...prev, { id, name: file.name, message: 'Queued', fraction: 0 }]);
        try {
          await importPdf(file, {
            onProgress: (p: ExtractProgress) => {
              // Reading is the bulk of the work; structuring is the last fifth.
              const base = p.phase === 'scanning' || p.phase === 'ocr' ? 0 : 0.8;
              const span = p.phase === 'scanning' || p.phase === 'ocr' ? 0.8 : 0.2;
              const fraction = p.pages ? base + (p.page / p.pages) * span : 0;
              update(id, { message: p.message, fraction });
            },
            onPassword: (retry) =>
              new Promise<string | null>((resolve) => {
                setPassword('');
                setPasswordAsk({
                  resolve,
                  detail: retry
                    ? 'That password was not accepted. Try again.'
                    : `"${file.name}" is encrypted. Enter its password to read it.`,
                });
              }),
            onNeedsOcr: (pages) =>
              new Promise<boolean>((resolve) => {
                setOcrAsk({
                  resolve,
                  detail: `"${file.name}" looks scanned: ${pages} pages have images but no text layer. Recognising the text takes a few seconds per page and downloads a language model on first use.`,
                });
              }),
          });
          update(id, { message: 'Added to your library', fraction: 1, done: true });
          await refreshLibrary();
          // Clear finished rows after a beat so the shelf is the focus again.
          setTimeout(() => setJobs((prev) => prev.filter((j) => j.id !== id)), 2600);
        } catch (err) {
          const message =
            err instanceof PasswordRequiredError
              ? 'Skipped: the password was not provided'
              : err instanceof CancelledError
                ? 'Cancelled'
                : err instanceof Error
                  ? err.message
                  : 'Could not read this PDF';
          update(id, { error: message, message, fraction: 0 });
        }
      }
    },
    [refreshLibrary, update],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void ingest(Array.from(e.dataTransfer.files));
  };

  const queueBooks = useMemo(
    () => queueIds.map((id) => library.find((b) => b.id === id)).filter((b): b is BookMeta => !!b),
    [queueIds, library],
  );

  const wpm = effectiveWpm(null, settings.baseWpm, settings.rate);

  return (
    <div className="library">
      <div className="library-inner">
        <div
          className={`dropzone${dragOver ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <Upload size={26} strokeWidth={1.6} color="var(--accent)" />
          <h2>Drop a book in</h2>
          <p>PDFs are read on this device. Nothing is uploaded.</p>
          <button className="btn primary" onClick={() => fileInput.current?.click()}>
            <Plus size={15} /> Choose PDFs
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              void ingest(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>

        {jobs.length > 0 && (
          <div className="import-list">
            {jobs.map((job) => (
              <div className="import-row" key={job.id}>
                {job.error ? (
                  <TriangleAlert size={17} color="var(--danger)" />
                ) : job.done ? (
                  <Check size={17} color="var(--ok)" />
                ) : (
                  <LoaderCircle size={17} className="spin" color="var(--accent)" />
                )}
                <div className="grow">
                  <div className="name">{job.name}</div>
                  <div className="status">{job.message}</div>
                  {!job.error && (
                    <div className="bar">
                      <span style={{ width: percent(job.fraction) }} />
                    </div>
                  )}
                </div>
                {job.error && (
                  <button
                    className="btn ghost icon"
                    onClick={() => setJobs((p) => p.filter((j) => j.id !== job.id))}
                    aria-label="Dismiss"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {queueBooks.length > 0 && (
          <>
            <div className="section-head">
              <h3>Up next</h3>
              <span className="count">
                {queueBooks.length} book{queueBooks.length === 1 ? '' : 's'} · plays straight through
              </span>
            </div>
            <div className="import-list">
              {queueBooks.map((book, index) => {
                const left = book.words * (1 - (progressByBook[book.id]?.fraction ?? 0));
                return (
                  <div
                    className="import-row"
                    key={book.id}
                    draggable
                    onDragStart={() => { dragIndex.current = index; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex.current !== null && dragIndex.current !== index) {
                        void reorderQueue(dragIndex.current, index);
                      }
                      dragIndex.current = null;
                    }}
                  >
                    <GripVertical size={15} color="var(--ink-faint)" />
                    <div className="grow">
                      <div className="name">{book.title}</div>
                      <div className="status">
                        {index === 0 ? 'Next up' : `Position ${index + 1}`} · about {duration((left / wpm) * 60)} left
                      </div>
                    </div>
                    <button className="btn ghost" onClick={() => onOpen(book.id)}>Open</button>
                    <button
                      className="btn ghost icon"
                      onClick={() => void removeFromQueue(book.id)}
                      aria-label={`Remove ${book.title} from the queue`}
                    >
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="section-head">
          <h3>Library</h3>
          <span className="count">{library.length} book{library.length === 1 ? '' : 's'}</span>
        </div>

        {library.length === 0 ? (
          <div className="empty">
            <BookOpen size={26} strokeWidth={1.4} />
            <p>Your shelf is empty. Add a PDF above to start listening.</p>
          </div>
        ) : (
          <div className="shelf">
            {library.map((book) => {
              const fraction = progressByBook[book.id]?.fraction ?? 0;
              const inQueue = queueIds.includes(book.id);
              return (
                <div className="book-card" key={book.id}>
                  <button className="book-cover" onClick={() => onOpen(book.id)} aria-label={`Open ${book.title}`}>
                    {book.cover ? (
                      <img src={book.cover} alt="" />
                    ) : (
                      <FileText size={30} color="var(--ink-faint)" />
                    )}
                  </button>
                  <div className="book-body">
                    <div className="book-title">{book.title}</div>
                    <div className="book-sub">
                      {book.author || 'Unknown author'} · {book.pages} pages · {fileSize(book.fileSize)}
                    </div>
                    <div className="book-sub" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {book.ocr && <span className="badge warn"><ScanText size={11} /> OCR</span>}
                      {book.quality && book.quality.columnsDetected > 1 && (
                        <span className="badge">{book.quality.columnsDetected} columns</span>
                      )}
                      {book.quality && book.quality.textCoverage < 0.8 && !book.ocr && (
                        <span className="badge bad"><TriangleAlert size={11} /> sparse text</span>
                      )}
                      {fraction > 0.01 && <span className="badge">{percent(fraction)} read</span>}
                    </div>
                    {fraction > 0.01 && (
                      <div className="book-progress"><span style={{ width: percent(fraction) }} /></div>
                    )}
                  </div>
                  <div className="card-actions">
                    <button className="btn" style={{ flex: 1 }} onClick={() => onOpen(book.id)}>
                      {fraction > 0.01 ? 'Resume' : 'Listen'}
                    </button>
                    <button
                      className={`btn ghost icon${inQueue ? ' active' : ''}`}
                      title={inQueue ? 'In the reading queue' : 'Add to the reading queue'}
                      onClick={() => void (inQueue ? removeFromQueue(book.id) : addToQueue(book.id))}
                    >
                      {inQueue ? <Check size={15} color="var(--accent)" /> : <ListMusic size={15} />}
                    </button>
                    <button
                      className="btn ghost icon danger"
                      title="Remove from library"
                      onClick={() => setConfirmDelete(book)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <footer className="colophon">
          <p className="colophon-name">
            Nairobian Reading Room
            <span>PDF to audio platform. A quiet way to hear your books.</span>
          </p>
          <p className="colophon-legal">
            Developed by Desmond Kinoti ·{' '}
            <a href="mailto:desmond@nubigo.com">desmond@nubigo.com</a>
            <br />
            Copyright © {new Date().getFullYear()} Desmond Kinoti. All rights reserved.
          </p>
        </footer>
      </div>

      {passwordAsk && (
        <Modal title="Password required" onClose={() => { passwordAsk.resolve(null); setPasswordAsk(null); }}>
          <p><Lock size={13} style={{ verticalAlign: -2 }} /> {passwordAsk.detail}</p>
          <input
            type="password"
            autoFocus
            value={password}
            placeholder="Document password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { passwordAsk.resolve(password); setPasswordAsk(null); }
            }}
          />
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => { passwordAsk.resolve(null); setPasswordAsk(null); }}>
              Skip this book
            </button>
            <button className="btn primary" onClick={() => { passwordAsk.resolve(password); setPasswordAsk(null); }}>
              Unlock
            </button>
          </div>
        </Modal>
      )}

      {ocrAsk && (
        <Modal title="This book needs OCR" onClose={() => { ocrAsk.resolve(false); setOcrAsk(null); }}>
          <p>{ocrAsk.detail}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => { ocrAsk.resolve(false); setOcrAsk(null); }}>
              Import without OCR
            </button>
            <button className="btn primary" onClick={() => { ocrAsk.resolve(true); setOcrAsk(null); }}>
              <ScanText size={15} /> Recognise the text
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Remove this book?" onClose={() => setConfirmDelete(null)}>
          <p>
            "{confirmDelete.title}" and its saved position, bookmarks and extracted text
            will be deleted from this device. The original file on your computer is untouched.
          </p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Keep it</button>
            <button
              className="btn primary"
              onClick={() => { void removeBook(confirmDelete.id); setConfirmDelete(null); }}
            >
              <Trash2 size={15} /> Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
