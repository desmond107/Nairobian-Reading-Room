import { useMemo, useRef } from 'react';
import {
  Bookmark, ChevronLeft, ChevronRight, Pause, Play, Settings as SettingsIcon,
  SkipBack, SkipForward, Square,
} from 'lucide-react';
import { usePlayer } from '../state/player';
import { duration, effectiveWpm, percent } from '../lib/format';

/**
 * Transport, scrubber and pacing.
 *
 * The scrubber is measured in words rather than blocks, because blocks vary
 * from a two-word heading to a 300-word paragraph and a block-based bar would
 * lurch. Words are a direct proxy for time, which is what the listener is
 * really tracking.
 */
export function PlayerBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const status = usePlayer((s) => s.status);
  const book = usePlayer((s) => s.book);
  const blocks = usePlayer((s) => s.blocks);
  const chapters = usePlayer((s) => s.chapters);
  const playQueue = usePlayer((s) => s.playQueue);
  const position = usePlayer((s) => s.position);
  const settings = usePlayer((s) => s.settings);
  const measuredWpm = usePlayer((s) => s.measuredWpm);
  const play = usePlayer((s) => s.play);
  const pause = usePlayer((s) => s.pause);
  const stop = usePlayer((s) => s.stop);
  const skipBlock = usePlayer((s) => s.skipBlock);
  const goToChapter = usePlayer((s) => s.goToChapter);
  const seekFraction = usePlayer((s) => s.seekFraction);
  const setSettings = usePlayer((s) => s.setSettings);
  const addBookmark = usePlayer((s) => s.addBookmark);

  const trackRef = useRef<HTMLDivElement>(null);

  const wordsDone = playQueue?.cumulativeWords[position] ?? 0;
  const totalWords = playQueue?.totalWords ?? 0;
  const fraction = totalWords ? wordsDone / totalWords : 0;
  const wpm = effectiveWpm(measuredWpm, settings.baseWpm, settings.rate);
  const secondsLeft = ((totalWords - wordsDone) / wpm) * 60;

  const block = playQueue ? blocks[playQueue.ids[position]] : undefined;
  const chapter = block ? chapters[block.chapter] : undefined;

  // Chapter ticks on the scrubber, so the shape of the book is visible.
  const marks = useMemo(() => {
    if (!playQueue || !totalWords) return [];
    return playQueue.chapterEntry
      .map((entry) => (playQueue.cumulativeWords[entry] ?? 0) / totalWords)
      .filter((f) => f > 0.004 && f < 0.996);
  }, [playQueue, totalWords]);

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    seekFraction((clientX - box.left) / box.width);
  };

  return (
    <div className="player">
      <div
        className="scrub"
        role="slider"
        tabIndex={0}
        aria-label="Position in book"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        onMouseDown={(e) => seekFromEvent(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') seekFraction(Math.min(1, fraction + 0.01));
          if (e.key === 'ArrowLeft') seekFraction(Math.max(0, fraction - 0.01));
        }}
      >
        <div className="scrub-track" ref={trackRef}>
          <div className="scrub-fill" style={{ width: percent(fraction) }} />
          {marks.map((m, i) => (
            <div key={i} className="scrub-mark" style={{ left: percent(m) }} />
          ))}
          <div className="scrub-knob" style={{ left: percent(fraction) }} />
        </div>
      </div>

      <div className="player-row">
        <div className="transport">
          <button
            className="round-btn"
            onClick={() => goToChapter(Math.max(0, (block?.chapter ?? 0) - 1))}
            title="Previous chapter"
          >
            <ChevronLeft size={18} />
          </button>
          <button className="round-btn" onClick={() => skipBlock(-1)} title="Previous paragraph">
            <SkipBack size={17} />
          </button>
          <button
            className="play-btn"
            onClick={() => (status === 'playing' ? pause() : play())}
            title={status === 'playing' ? 'Pause' : 'Play'}
          >
            {status === 'playing' ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button className="round-btn" onClick={() => skipBlock(1)} title="Next paragraph">
            <SkipForward size={17} />
          </button>
          <button
            className="round-btn"
            onClick={() => goToChapter(Math.min(chapters.length - 1, (block?.chapter ?? 0) + 1))}
            title="Next chapter"
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="round-btn"
            onClick={stop}
            title="Stop and rewind to the start of this paragraph"
            disabled={status === 'idle'}
          >
            <Square size={15} fill="currentColor" />
          </button>
        </div>

        <div className="now-playing">
          <div className="now-title">{chapter?.title ?? book?.title ?? ''}</div>
          <div className="now-meta">
            <span>Page {block?.page ?? 1} of {book?.pages ?? 1}</span>
            <span>{percent(fraction)}</span>
            <span>{duration(secondsLeft)} left</span>
            <span>{Math.round(wpm)} wpm{measuredWpm ? '' : ' est.'}</span>
          </div>
        </div>

        <button className="round-btn" onClick={() => void addBookmark()} title="Bookmark this spot (B)">
          <Bookmark size={17} />
        </button>

        <div className="rate-group">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={settings.rate}
            aria-label="Playback speed"
            onChange={(e) => void setSettings({ rate: Number(e.target.value) })}
          />
          <span className="rate-value">{settings.rate.toFixed(2)}x</span>
        </div>

        <button className="round-btn" onClick={onOpenSettings} title="Voice and reading settings">
          <SettingsIcon size={17} />
        </button>
      </div>
    </div>
  );
}
