import type { EngineKind } from '../../types';
import { SpeechCancelled, type BoundaryHandler, type SpeakOptions, type TTSEngine, type Voice } from './engine';

/**
 * The browser's built-in synthesiser. Free, offline on most platforms, and
 * quirky enough to need three separate workarounds:
 *
 *  - Voices arrive asynchronously, sometimes after a `voiceschanged` event and
 *    sometimes only after the first `getVoices()` call primes the list.
 *  - Chrome silently stops speaking after roughly fifteen seconds unless the
 *    queue is nudged, so a keep-alive timer pings `resume()` while active.
 *  - A cancelled utterance can still fire `onend`, so each utterance is tagged
 *    and late events from a stale one are ignored.
 */
export class WebSpeechEngine implements TTSEngine {
  readonly kind: EngineKind = 'webspeech';
  readonly name = 'Browser voices';
  readonly hasBoundaries = true;

  private synth = window.speechSynthesis;
  private token = 0;
  private keepAlive: number | null = null;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  async voices(): Promise<Voice[]> {
    const read = () => this.synth.getVoices();
    let list = read();
    if (!list.length) {
      list = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const done = (v: SpeechSynthesisVoice[]) => {
          clearTimeout(timer);
          this.synth.removeEventListener('voiceschanged', onChange);
          resolve(v);
        };
        const onChange = () => done(read());
        this.synth.addEventListener('voiceschanged', onChange);
        // Safari populates the list only after a getVoices call settles.
        const timer = setTimeout(() => done(read()), 1500);
      });
    }
    return list.map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      engine: this.kind as EngineKind,
      isDefault: v.default,
    }));
  }

  speak(text: string, opts: SpeakOptions, onBoundary?: BoundaryHandler): Promise<void> {
    const myToken = ++this.token;
    return new Promise<void>((resolve, reject) => {
      const utter = new SpeechSynthesisUtterance(text);
      const voice = opts.voiceId
        ? this.synth.getVoices().find((v) => v.voiceURI === opts.voiceId)
        : undefined;
      if (voice) utter.voice = voice;
      // The spec allows 0.1–10 but real voices distort outside this band.
      utter.rate = Math.min(2, Math.max(0.5, opts.rate));
      utter.pitch = Math.min(2, Math.max(0, opts.pitch));
      utter.volume = Math.min(1, Math.max(0, opts.volume));

      utter.onboundary = (e) => {
        if (myToken !== this.token) return;
        if (onBoundary && typeof e.charIndex === 'number') onBoundary(e.charIndex);
      };
      utter.onend = () => {
        if (myToken !== this.token) return;
        this.stopKeepAlive();
        resolve();
      };
      utter.onerror = (e) => {
        if (myToken !== this.token) return;
        this.stopKeepAlive();
        // "interrupted" and "canceled" are our own stop() landing here.
        if (e.error === 'interrupted' || e.error === 'canceled') reject(new SpeechCancelled());
        else reject(new Error(`Speech failed: ${e.error}`));
      };

      // A leftover paused queue swallows the next utterance entirely.
      if (this.synth.paused) this.synth.resume();
      this.synth.speak(utter);
      this.startKeepAlive();
    });
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAlive = window.setInterval(() => {
      if (this.synth.speaking && !this.synth.paused) {
        // Pausing and resuming resets Chrome's internal watchdog.
        this.synth.pause();
        this.synth.resume();
      }
    }, 10_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== null) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }

  pause(): void {
    this.stopKeepAlive();
    if (this.synth.speaking) this.synth.pause();
  }

  resume(): void {
    if (this.synth.paused) {
      this.synth.resume();
      this.startKeepAlive();
    }
  }

  cancel(): void {
    this.token++;
    this.stopKeepAlive();
    this.synth.cancel();
  }

  dispose(): void {
    this.cancel();
  }
}
