import type { EngineKind } from '../../types';

/** A voice the user can pick, normalised across every backend. */
export interface Voice {
  id: string;
  name: string;
  lang: string;
  engine: EngineKind;
  /** Set for the platform's own preferred voice. */
  isDefault?: boolean;
}

export interface SpeakOptions {
  voiceId: string | null;
  rate: number;
  pitch: number;
  volume: number;
}

/** Progress inside a chunk, used to highlight the word being spoken. */
export type BoundaryHandler = (charIndex: number) => void;

export interface TTSEngine {
  readonly kind: EngineKind;
  readonly name: string;
  /** True when the engine reports word boundaries for live highlighting. */
  readonly hasBoundaries: boolean;
  voices(): Promise<Voice[]>;
  /** Speaks one chunk. Resolves when it finishes, rejects if cancelled. */
  speak(text: string, opts: SpeakOptions, onBoundary?: BoundaryHandler): Promise<void>;
  /** Optional warm-up of the next chunk while the current one plays. */
  prefetch?(text: string, opts: SpeakOptions): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  /** Live rate change without restarting the chunk, where supported. */
  setRate?(rate: number): void;
  dispose(): void;
}

export class SpeechCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SpeechCancelled';
  }
}
