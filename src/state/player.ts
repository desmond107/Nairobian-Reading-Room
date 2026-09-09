import { create } from 'zustand';
import type {
  Block, Bookmark, BookMeta, Chapter, Progress, Settings,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import * as db from '../lib/store/db';
import { buildQueue, positionOf, type PlayQueue } from '../lib/book/queue';
import { chunkBlock, scaledPause, type Chunk } from '../lib/tts/chunker';
import { toSpeech } from '../lib/text/normalize';
import { SpeechCancelled, type TTSEngine, type Voice } from '../lib/tts/engine';
import { WebSpeechEngine } from '../lib/tts/webspeech';
import { CloudEngine, type CloudProvider } from '../lib/tts/cloud';

/**
 * Playback is a single async loop that walks the queue, speaking one chunk at
 * a time and resting between them. Everything the UI can do — pause, skip,
 * jump to a chapter, change the voice — either parks that loop or bumps a
 * generation counter to retire it and start a fresh one.
 *
 * Keeping it as one loop rather than a bag of event handlers is what makes the
 * pauses reliable: the rest after a full stop is just an await, and it happens
 * in exactly one place.
 */

export type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
  status: Status;
  error: string | null;

  library: BookMeta[];
  progressByBook: Record<string, Progress>;
  queueIds: string[];

  book: BookMeta | null;
  blocks: Block[];
  chapters: Chapter[];
  bookmarks: Bookmark[];
  playQueue: PlayQueue | null;

  /** Index into playQueue.ids. */
  position: number;
  /** Index into the current block's chunks. */
  chunkIndex: number;
  chunks: Chunk[];
  /** Character offset inside the current chunk, from the boundary event. */
  charIndex: number;

  settings: Settings;
  voices: Voice[];
  voiceError: string | null;

  /** Words per minute measured from actual playback, null until we have data. */
  measuredWpm: number | null;

  init: () => Promise<void>;
  openBook: (id: string, resume?: boolean) => Promise<void>;
  closeBook: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  skipChunk: (delta: number) => void;
  skipBlock: (delta: number) => void;
  goToChapter: (index: number) => void;
  goToBlock: (blockId: number, offset?: number) => void;
  seekFraction: (fraction: number) => void;

  setSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshVoices: () => Promise<void>;

  addBookmark: (note?: string) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  editBlock: (blockId: number, text: string) => Promise<void>;

  addToQueue: (bookId: string) => Promise<void>;
  removeFromQueue: (bookId: string) => Promise<void>;
  reorderQueue: (from: number, to: number) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  removeBook: (bookId: string) => Promise<void>;
}

// ---- Module-level playback machinery -----------------------------------
// Deliberately outside the store: these are not render inputs, and putting a
// live engine or a timer in React state causes far more trouble than it saves.

let engine: TTSEngine | null = null;
let engineKey = '';
let generation = 0;
let resumeWaiters: (() => void)[] = [];
let saveTimer: number | null = null;
let spokenWords = 0;
let spokenMs = 0;
let segmentStart = 0;

function getEngine(settings: Settings): TTSEngine {
  const key = `${settings.engine}:${settings.apiKeys[settings.engine] ?? ''}`;
  if (engine && engineKey === key) return engine;
  engine?.dispose();
  engine =
    settings.engine === 'webspeech'
      ? new WebSpeechEngine()
      : new CloudEngine(settings.engine as CloudProvider, settings.apiKeys[settings.engine] ?? '');
  engineKey = key;
  return engine;
}

/** Resolves when playback is running again, used to park the loop on pause. */
function waitForResume(): Promise<void> {
  return new Promise((resolve) => resumeWaiters.push(resolve));
}

function releaseWaiters(): void {
  const waiters = resumeWaiters;
  resumeWaiters = [];
  for (const w of waiters) w();
}

/**
 * The rest between two chunks. This is where the pacing lives: the silence
 * after a full stop, a paragraph, a chapter title.
 *
 * It has to end early when the reader skips or stops, or a press of the skip
 * button would sit for up to a second before anything happened. Polling the
 * generation counter is what makes the transport feel immediate.
 */
function rest(ms: number, mine: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let poll = 0;
    const done = () => {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    poll = window.setInterval(() => {
      if (generation !== mine) done();
    }, 50);
  });
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** Rebuilds the queue after a settings change, holding the reading position. */
  const rebuildQueue = (state: Pick<PlayerState, 'blocks' | 'chapters' | 'settings'>, holdBlock?: number) => {
    if (!state.blocks.length) return { playQueue: null, position: 0 };
    const playQueue = buildQueue(state.blocks, state.chapters, state.settings);
    const position = holdBlock === undefined ? 0 : positionOf(playQueue, holdBlock);
    return { playQueue, position };
  };

  const chunksFor = (position: number): Chunk[] => {
    const { blocks, playQueue, settings, chapters } = get();
    if (!playQueue || position < 0 || position >= playQueue.ids.length) return [];
    const block = blocks[playQueue.ids[position]];
    if (!block) return [];
    const opensChapter = chapters.some((c) => c.startBlock === block.id);
    return chunkBlock(block, settings, opensChapter);
  };

  const persistPosition = async () => {
    const { book, playQueue, position, chunks, chunkIndex } = get();
    if (!book || !playQueue) return;
    const blockId = playQueue.ids[position];
    if (blockId === undefined) return;
    const progress: Progress = {
      bookId: book.id,
      block: blockId,
      offset: chunks[chunkIndex]?.offset ?? 0,
      fraction: playQueue.totalWords
        ? playQueue.cumulativeWords[position] / playQueue.totalWords
        : 0,
      updatedAt: Date.now(),
    };
    await db.saveProgress(progress);
    set((s) => ({ progressByBook: { ...s.progressByBook, [book.id]: progress } }));
  };

  const schedulePersist = () => {
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void persistPosition();
    }, 4000);
  };

  /** The playback loop. One instance per generation. */
  const run = async (mine: number) => {
    const engineFor = () => getEngine(get().settings);

    while (generation === mine) {
      const state = get();
      const { playQueue } = state;
      if (!playQueue) break;

      if (state.position >= playQueue.ids.length) {
        set({ status: 'idle' });
        await persistPosition();
        void advanceToNextInQueue();
        return;
      }

      let chunks = state.chunks;
      if (!chunks.length || chunks[0]?.blockId !== playQueue.ids[state.position]) {
        chunks = chunksFor(state.position);
        set({ chunks });
      }

      if (state.chunkIndex >= chunks.length) {
        set({ position: state.position + 1, chunkIndex: 0, chunks: [], charIndex: 0 });
        continue;
      }

      const chunk = chunks[state.chunkIndex];
      const settings = state.settings;
      const opts = {
        voiceId: settings.engine === 'webspeech' ? settings.voiceURI : settings.cloudVoice[settings.engine] ?? null,
        rate: settings.rate,
        pitch: settings.pitch,
        volume: settings.volume,
      };

      const active = engineFor();
      // Fetch the next clip while this one plays, so cloud voices stay gapless.
      const next = chunks[state.chunkIndex + 1];
      if (next && active.prefetch) active.prefetch(toSpeech(next.text), opts);

      segmentStart = performance.now();
      try {
        await active.speak(toSpeech(chunk.text), opts, (charIndex) => {
          if (generation === mine) set({ charIndex });
        });
      } catch (err) {
        if (generation !== mine || err instanceof SpeechCancelled) return;
        set({ status: 'error', error: err instanceof Error ? err.message : 'Playback failed' });
        return;
      }
      if (generation !== mine) return;

      // Measure the real speaking rate; it is what makes "time left" honest.
      spokenMs += performance.now() - segmentStart;
      spokenWords += chunk.words;
      if (spokenMs > 20_000) {
        set({ measuredWpm: Math.round((spokenWords / spokenMs) * 60_000) });
      }

      set({ chunkIndex: get().chunkIndex + 1, charIndex: 0 });
      schedulePersist();

      await rest(scaledPause(chunk.pauseAfter, settings), mine);
      if (generation !== mine) return;

      // Parked here while paused; resume() releases us.
      while (get().status === 'paused' && generation === mine) await waitForResume();
    }
  };

  /** When a book ends, roll on to the next one in the reading queue. */
  const advanceToNextInQueue = async () => {
    const { queueIds, book } = get();
    if (!book) return;
    const at = queueIds.indexOf(book.id);
    if (at < 0 || at + 1 >= queueIds.length) return;
    await get().openBook(queueIds[at + 1], false);
    get().play();
  };

  return {
    status: 'idle',
    error: null,
    library: [],
    progressByBook: {},
    queueIds: [],
    book: null,
    blocks: [],
    chapters: [],
    bookmarks: [],
    playQueue: null,
    position: 0,
    chunkIndex: 0,
    chunks: [],
    charIndex: 0,
    settings: DEFAULT_SETTINGS,
    voices: [],
    voiceError: null,
    measuredWpm: null,

    async init() {
      const [settings, library, queueIds, progressByBook] = await Promise.all([
        db.loadSettings(),
        db.listBooks(),
        db.loadQueue(),
        db.allProgress(),
      ]);
      set({ settings, library, queueIds, progressByBook });
      await get().refreshVoices();
    },

    async refreshLibrary() {
      const [library, progressByBook] = await Promise.all([db.listBooks(), db.allProgress()]);
      set({ library, progressByBook });
    },

    async openBook(id, resume = true) {
      generation++;
      engine?.cancel();
      set({ status: 'loading', error: null, charIndex: 0, chunks: [], chunkIndex: 0 });

      const meta = get().library.find((b) => b.id === id) ?? null;
      const [blocks, chapters, bookmarks, progress] = await Promise.all([
        db.loadBlocks(id),
        db.loadChapters(id),
        db.listBookmarks(id),
        db.loadProgress(id),
      ]);

      const settings = get().settings;
      const playQueue = buildQueue(blocks, chapters, settings);
      const position = resume && progress ? positionOf(playQueue, progress.block) : 0;

      spokenWords = 0;
      spokenMs = 0;
      set({
        book: meta, blocks, chapters, bookmarks, playQueue,
        position, chunkIndex: 0, chunks: [], charIndex: 0,
        status: 'idle', measuredWpm: null,
      });
    },

    closeBook() {
      generation++;
      engine?.cancel();
      void persistPosition();
      set({
        book: null, blocks: [], chapters: [], bookmarks: [], playQueue: null,
        position: 0, chunkIndex: 0, chunks: [], charIndex: 0, status: 'idle',
      });
    },

    play() {
      const { status, playQueue } = get();
      if (!playQueue) return;
      if (status === 'paused') {
        set({ status: 'playing' });
        getEngine(get().settings).resume();
        releaseWaiters();
        return;
      }
      if (status === 'playing') return;
      set({ status: 'playing', error: null });
      const mine = ++generation;
      void run(mine);
    },

    pause() {
      if (get().status !== 'playing') return;
      set({ status: 'paused' });
      engine?.pause();
      void persistPosition();
    },

    stop() {
      generation++;
      engine?.cancel();
      releaseWaiters();
      set({ status: 'idle', chunkIndex: 0, charIndex: 0 });
      void persistPosition();
    },

    skipChunk(delta) {
      const { chunks, chunkIndex, position, playQueue } = get();
      if (!playQueue) return;
      const target = chunkIndex + delta;
      if (target >= 0 && target < chunks.length) {
        restartAt(position, target);
        return;
      }
      // Ran off the end of the block: step to the neighbouring one.
      get().skipBlock(delta > 0 ? 1 : -1);
    },

    skipBlock(delta) {
      const { position, playQueue } = get();
      if (!playQueue) return;
      const target = Math.min(playQueue.ids.length - 1, Math.max(0, position + delta));
      restartAt(target, 0);
    },

    goToChapter(index) {
      const { playQueue, chapters } = get();
      if (!playQueue || !chapters[index]) return;
      restartAt(playQueue.chapterEntry[index] ?? 0, 0);
    },

    goToBlock(blockId, offset = 0) {
      const { playQueue } = get();
      if (!playQueue) return;
      const position = positionOf(playQueue, blockId);
      const chunks = chunksFor(position);
      // Land on the chunk containing the saved character offset.
      let chunkIndex = 0;
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].offset <= offset) chunkIndex = i;
        else break;
      }
      restartAt(position, chunkIndex);
    },

    seekFraction(fraction) {
      const { playQueue } = get();
      if (!playQueue) return;
      const targetWords = playQueue.totalWords * Math.min(1, Math.max(0, fraction));
      // Cumulative words is sorted, so a binary search lands the position.
      let lo = 0;
      let hi = playQueue.cumulativeWords.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (playQueue.cumulativeWords[mid] <= targetWords) lo = mid;
        else hi = mid - 1;
      }
      restartAt(lo, 0);
    },

    async setSettings(patch) {
      const previous = get().settings;
      const settings = { ...previous, ...patch };
      set({ settings });
      await db.saveSettings(settings);

      // A live rate change should not restart the sentence.
      if (patch.rate !== undefined && engine?.setRate) engine.setRate(patch.rate);

      const engineChanged =
        patch.engine !== undefined && patch.engine !== previous.engine;
      const keysChanged = patch.apiKeys !== undefined;
      if (engineChanged || keysChanged) await get().refreshVoices();

      // Anything that changes what gets read needs the queue rebuilt.
      const structural =
        patch.footnoteMode !== undefined ||
        patch.readCaptions !== undefined ||
        patch.describeImages !== undefined ||
        patch.readTables !== undefined;

      const state = get();
      if (structural && state.playQueue) {
        const held = state.playQueue.ids[state.position];
        const rebuilt = rebuildQueue(state, held);
        set({ ...rebuilt, chunks: [], chunkIndex: 0 });
      }

      // Voice, engine and pitch changes only take effect on a new utterance.
      const needsRestart =
        engineChanged || patch.voiceURI !== undefined || patch.cloudVoice !== undefined ||
        patch.pitch !== undefined || structural;
      if (needsRestart && get().status === 'playing') {
        restartAt(get().position, get().chunkIndex);
      }
    },

    async refreshVoices() {
      try {
        const list = await getEngine(get().settings).voices();
        set({ voices: list, voiceError: null });
        const { settings } = get();
        if (settings.engine === 'webspeech' && !settings.voiceURI && list.length) {
          const preferred =
            list.find((v) => v.isDefault && v.lang.startsWith('en')) ??
            list.find((v) => v.lang.startsWith('en')) ??
            list[0];
          await get().setSettings({ voiceURI: preferred.id });
        }
      } catch (err) {
        set({ voices: [], voiceError: err instanceof Error ? err.message : 'Could not list voices' });
      }
    },

    async addBookmark(note = '') {
      const { book, blocks, playQueue, position, chunks, chunkIndex } = get();
      if (!book || !playQueue) return;
      const blockId = playQueue.ids[position];
      const block = blocks[blockId];
      if (!block) return;
      const offset = chunks[chunkIndex]?.offset ?? 0;
      const mark: Bookmark = {
        id: `${book.id}-${blockId}-${offset}-${Date.now()}`,
        bookId: book.id,
        block: blockId,
        offset,
        excerpt: block.text.slice(offset, offset + 180).trim(),
        note,
        createdAt: Date.now(),
      };
      await db.saveBookmark(mark);
      set({ bookmarks: [...get().bookmarks, mark].sort((a, b) => a.block - b.block) });
    },

    async removeBookmark(id) {
      await db.deleteBookmark(id);
      set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) });
    },

    async editBlock(blockId, text) {
      const { book, blocks } = get();
      if (!book) return;
      const next = blocks.map((b) =>
        b.id === blockId
          ? { ...b, text, edited: true, words: text.split(/\s+/).filter(Boolean).length }
          : b,
      );
      set({ blocks: next, chunks: [] });
      await db.saveBlocks(book.id, next);
      const state = get();
      set(rebuildQueue({ ...state, blocks: next }, blockId));
    },

    async addToQueue(bookId) {
      if (get().queueIds.includes(bookId)) return;
      const ids = [...get().queueIds, bookId];
      set({ queueIds: ids });
      await db.saveQueue(ids);
    },

    async removeFromQueue(bookId) {
      const ids = get().queueIds.filter((i) => i !== bookId);
      set({ queueIds: ids });
      await db.saveQueue(ids);
    },

    async reorderQueue(from, to) {
      const ids = [...get().queueIds];
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      set({ queueIds: ids });
      await db.saveQueue(ids);
    },

    async removeBook(bookId) {
      if (get().book?.id === bookId) get().closeBook();
      await db.deleteBook(bookId);
      await get().removeFromQueue(bookId);
      await get().refreshLibrary();
    },
  };

  /** Retires the current loop and restarts playback at an exact spot. */
  function restartAt(position: number, chunkIndex: number) {
    const wasPlaying = get().status === 'playing' || get().status === 'paused';
    generation++;
    engine?.cancel();
    releaseWaiters();
    set({ position, chunkIndex, chunks: [], charIndex: 0 });
    void persistPosition();
    if (wasPlaying) {
      set({ status: 'playing' });
      const mine = ++generation;
      void run(mine);
    }
  }
});

/** Flushes the reading position when the tab goes away. */
export function installPositionGuard(): () => void {
  const flush = () => {
    const s = usePlayer.getState();
    if (!s.book || !s.playQueue) return;
    const blockId = s.playQueue.ids[s.position];
    if (blockId === undefined) return;
    void db.saveProgress({
      bookId: s.book.id,
      block: blockId,
      offset: s.chunks[s.chunkIndex]?.offset ?? 0,
      fraction: s.playQueue.totalWords
        ? s.playQueue.cumulativeWords[s.position] / s.playQueue.totalWords
        : 0,
      updatedAt: Date.now(),
    });
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHide);
  };
}
