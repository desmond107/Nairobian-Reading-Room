import type { EngineKind } from '../../types';
import { SpeechCancelled, type SpeakOptions, type TTSEngine, type Voice } from './engine';

/**
 * Neural voices from a hosted API, for when browser voices are not good enough
 * for a whole book.
 *
 * All three providers work the same way: post text, get an audio file back,
 * play it. The interesting part is latency. A round trip is several hundred
 * milliseconds, which would leave a hole between every sentence, so the next
 * chunk is fetched while the current one is still playing. Keys live in this
 * browser only and are sent to the provider and nowhere else.
 */

export type CloudProvider = Extract<EngineKind, 'elevenlabs' | 'google' | 'openai'>;

const OPENAI_VOICES: Voice[] = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer',
].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), lang: 'en-US', engine: 'openai' as EngineKind }));

/** How many synthesised clips to keep around, to survive a skip-back. */
const CACHE_LIMIT = 8;

export class CloudEngine implements TTSEngine {
  readonly hasBoundaries = false;

  private audio = new Audio();
  private cache = new Map<string, Promise<string>>();
  private token = 0;

  readonly kind: CloudProvider;
  private apiKey: string;

  constructor(kind: CloudProvider, apiKey: string) {
    this.kind = kind;
    this.apiKey = apiKey;
    this.audio.preload = 'auto';
  }

  get name(): string {
    return { elevenlabs: 'ElevenLabs', google: 'Google Cloud TTS', openai: 'OpenAI' }[this.kind];
  }

  async voices(): Promise<Voice[]> {
    if (!this.apiKey) return this.kind === 'openai' ? OPENAI_VOICES : [];
    if (this.kind === 'openai') return OPENAI_VOICES;

    if (this.kind === 'elevenlabs') {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': this.apiKey },
      });
      if (!res.ok) throw new Error(await describeFailure(res, 'ElevenLabs'));
      const body = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
      return body.voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        lang: v.labels?.language ?? 'en',
        engine: this.kind,
      }));
    }

    const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(this.apiKey)}`);
    if (!res.ok) throw new Error(await describeFailure(res, 'Google'));
    const body = (await res.json()) as {
      voices: { name: string; languageCodes: string[]; ssmlGender: string }[];
    };
    return body.voices
      // Studio and Neural2 voices are the ones worth listening to for hours.
      .filter((v) => /Neural2|Studio|Wavenet|Chirp/i.test(v.name))
      .map((v) => ({
        id: v.name,
        name: `${v.name} (${v.ssmlGender.toLowerCase()})`,
        lang: v.languageCodes[0] ?? 'en-US',
        engine: this.kind,
      }));
  }

  prefetch(text: string, opts: SpeakOptions): void {
    // Failures here are not fatal; speak() will retry and surface the error.
    void this.fetchClip(text, opts).catch(() => undefined);
  }

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    const myToken = ++this.token;
    const url = await this.fetchClip(text, opts);
    if (myToken !== this.token) throw new SpeechCancelled();

    return new Promise<void>((resolve, reject) => {
      const audio = this.audio;
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
      };
      audio.onended = () => {
        if (myToken !== this.token) return;
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        if (myToken !== this.token) return;
        cleanup();
        reject(new Error('Could not play the synthesised audio'));
      };
      audio.src = url;
      // Rate is applied on playback, so a change takes effect without a refetch.
      audio.playbackRate = Math.min(2, Math.max(0.5, opts.rate));
      audio.volume = Math.min(1, Math.max(0, opts.volume));
      audio.play().catch(() => {
        cleanup();
        reject(new SpeechCancelled());
      });
    });
  }

  setRate(rate: number): void {
    this.audio.playbackRate = Math.min(2, Math.max(0.5, rate));
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    void this.audio.play().catch(() => undefined);
  }

  cancel(): void {
    this.token++;
    this.audio.pause();
    this.audio.removeAttribute('src');
  }

  dispose(): void {
    this.cancel();
    for (const pending of this.cache.values()) {
      void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    }
    this.cache.clear();
  }

  /** Synthesises a chunk, or returns the clip already fetched for it. */
  private fetchClip(text: string, opts: SpeakOptions): Promise<string> {
    const key = `${opts.voiceId ?? ''}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const pending = this.synthesise(text, opts);
    this.cache.set(key, pending);

    // Evict oldest first; the Map preserves insertion order.
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value as string;
      const dropped = this.cache.get(oldest);
      this.cache.delete(oldest);
      void dropped?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    }
    return pending;
  }

  private async synthesise(text: string, opts: SpeakOptions): Promise<string> {
    if (!this.apiKey) throw new Error(`Add your ${this.name} API key in Settings`);

    if (this.kind === 'elevenlabs') {
      const voice = opts.voiceId ?? '21m00Tcm4TlvDq8ikWAM';
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) throw new Error(await describeFailure(res, 'ElevenLabs'));
      return URL.createObjectURL(await res.blob());
    }

    if (this.kind === 'openai') {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: opts.voiceId ?? 'alloy', input: text }),
      });
      if (!res.ok) throw new Error(await describeFailure(res, 'OpenAI'));
      return URL.createObjectURL(await res.blob());
    }

    const name = opts.voiceId ?? 'en-US-Neural2-C';
    const languageCode = name.split('-').slice(0, 2).join('-') || 'en-US';
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { name, languageCode },
          audioConfig: { audioEncoding: 'MP3', pitch: (opts.pitch - 1) * 4 },
        }),
      },
    );
    if (!res.ok) throw new Error(await describeFailure(res, 'Google'));
    const body = (await res.json()) as { audioContent: string };
    return URL.createObjectURL(base64ToBlob(body.audioContent, 'audio/mpeg'));
  }
}

/** Turns an HTTP failure into something worth showing a user. */
async function describeFailure(res: Response, provider: string): Promise<string> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    detail = '';
  }
  if (res.status === 401 || res.status === 403) return `${provider} rejected the API key`;
  if (res.status === 429) return `${provider} rate limit reached, slow down or wait`;
  return `${provider} error ${res.status}${detail ? `: ${detail}` : ''}`;
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
