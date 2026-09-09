import { useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { EngineKind, FootnoteMode } from '../types';
import { usePlayer } from '../state/player';

/** Voice choice, pacing, and what counts as narratable content. */
export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const settings = usePlayer((s) => s.settings);
  const voices = usePlayer((s) => s.voices);
  const voiceError = usePlayer((s) => s.voiceError);
  const setSettings = usePlayer((s) => s.setSettings);
  const refreshVoices = usePlayer((s) => s.refreshVoices);
  const book = usePlayer((s) => s.book);

  const [keyDraft, setKeyDraft] = useState('');
  const isCloud = settings.engine !== 'webspeech';
  const currentKey = settings.apiKeys[settings.engine] ?? '';

  const engines: { id: EngineKind; label: string }[] = [
    { id: 'webspeech', label: 'Browser' },
    { id: 'elevenlabs', label: 'ElevenLabs' },
    { id: 'google', label: 'Google' },
    { id: 'openai', label: 'OpenAI' },
  ];

  const footnoteModes: { id: FootnoteMode; label: string; hint: string }[] = [
    { id: 'inline', label: 'Inline', hint: 'Each note is read right after the paragraph that cites it.' },
    { id: 'endOfChapter', label: 'End of chapter', hint: 'Notes are collected and read once the chapter finishes.' },
    { id: 'skip', label: 'Skip', hint: 'Notes are kept on screen but never spoken.' },
  ];

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h3>Reading settings</h3>
        <span className="spacer" />
        <button className="btn ghost icon" onClick={onClose} aria-label="Close settings">
          <X size={17} />
        </button>
      </div>

      <div className="drawer-body">
        <div className="field">
          <label htmlFor="engine">Voice engine</label>
          <div className="seg" id="engine">
            {engines.map((e) => (
              <button
                key={e.id}
                className={settings.engine === e.id ? 'on' : ''}
                onClick={() => void setSettings({ engine: e.id })}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {settings.engine === 'webspeech'
              ? 'Uses the voices installed on this device. Free, works offline, and quality depends on your operating system.'
              : 'Sends each sentence to the provider and plays the audio it returns. Your key is stored in this browser only.'}
          </p>
        </div>

        {isCloud && (
          <div className="field">
            <label htmlFor="apikey">API key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="apikey"
                type="password"
                placeholder={currentKey ? 'Key saved on this device' : 'Paste your key'}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button
                className="btn"
                disabled={!keyDraft}
                onClick={() => {
                  void setSettings({ apiKeys: { ...settings.apiKeys, [settings.engine]: keyDraft } });
                  setKeyDraft('');
                }}
              >
                Save
              </button>
            </div>
            <p className="hint">
              Charges are billed by the provider per character, so a full book costs real money.
              Browser voices are free.
            </p>
          </div>
        )}

        <div className="field">
          <label htmlFor="voice">Voice</label>
          {voiceError ? (
            <div className="error-bar">
              <TriangleAlert size={15} />
              <span>{voiceError}</span>
              <button className="btn ghost" onClick={() => void refreshVoices()}>Retry</button>
            </div>
          ) : (
            <select
              id="voice"
              value={
                settings.engine === 'webspeech'
                  ? settings.voiceURI ?? ''
                  : settings.cloudVoice[settings.engine] ?? ''
              }
              onChange={(e) => {
                const value = e.target.value;
                void (settings.engine === 'webspeech'
                  ? setSettings({ voiceURI: value })
                  : setSettings({ cloudVoice: { ...settings.cloudVoice, [settings.engine]: value } }));
              }}
            >
              <option value="">System default</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.name} — {v.lang}</option>
              ))}
            </select>
          )}
          {settings.engine === 'webspeech' && voices.length > 0 && (
            <p className="hint">
              Voices marked "premium", "enhanced" or "natural" sound markedly better over a full book.
              On macOS more can be added in System Settings, Spoken Content.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="pitch">Pitch — {settings.pitch.toFixed(2)}</label>
          <input
            id="pitch"
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            style={{ width: '100%' }}
            value={settings.pitch}
            onChange={(e) => void setSettings({ pitch: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="volume">Volume — {Math.round(settings.volume * 100)}%</label>
          <input
            id="volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            style={{ width: '100%' }}
            value={settings.volume}
            onChange={(e) => void setSettings({ volume: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="pause">Pause length — {settings.pauseScale.toFixed(1)}x</label>
          <input
            id="pause"
            type="range"
            min={0}
            max={2}
            step={0.1}
            style={{ width: '100%' }}
            value={settings.pauseScale}
            onChange={(e) => void setSettings({ pauseScale: Number(e.target.value) })}
          />
          <p className="hint">
            Scales the rests at commas, full stops, paragraph ends and chapter breaks.
            Set to zero for continuous speech.
          </p>
        </div>

        <div className="field">
          <label htmlFor="footnotes">Footnotes</label>
          <div className="seg" id="footnotes">
            {footnoteModes.map((m) => (
              <button
                key={m.id}
                className={settings.footnoteMode === m.id ? 'on' : ''}
                onClick={() => void setSettings({ footnoteMode: m.id })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="hint">{footnoteModes.find((m) => m.id === settings.footnoteMode)?.hint}</p>
        </div>

        <div className="field">
          <label>What gets narrated</label>
          <Toggle
            label="Announce chapters"
            sub="A longer pause and the chapter title when a new one starts."
            on={settings.announceChapters}
            onChange={(v) => void setSettings({ announceChapters: v })}
          />
          <Toggle
            label="Read figure captions"
            sub="Captions are short and often carry the point of the figure."
            on={settings.readCaptions}
            onChange={(v) => void setSettings({ readCaptions: v })}
          />
          <Toggle
            label="Read table contents"
            sub="Off by default: tables read as a stream of numbers. Skipped tables are still announced."
            on={settings.readTables}
            onChange={(v) => void setSettings({ readTables: v })}
          />
          <Toggle
            label="Describe images"
            sub="Announces where a figure sits in the text."
            on={settings.describeImages}
            onChange={(v) => void setSettings({ describeImages: v })}
          />
        </div>

        <div className="field">
          <label>Appearance</label>
          <div className="seg">
            <button className={settings.theme === 'dark' ? 'on' : ''} onClick={() => void setSettings({ theme: 'dark' })}>
              Dark
            </button>
            <button className={settings.theme === 'light' ? 'on' : ''} onClick={() => void setSettings({ theme: 'light' })}>
              Light
            </button>
          </div>
        </div>

        {book?.quality && (
          <div className="field">
            <label>Extraction report</label>
            <dl className="quality-grid">
              <dt>Pages with text</dt>
              <dd>{Math.round(book.quality.textCoverage * 100)}%</dd>
              <dt>Columns found</dt>
              <dd>{book.quality.columnsDetected}</dd>
              <dt>Running heads removed</dt>
              <dd>{book.quality.headersStripped}</dd>
              <dt>Hyphenated words rejoined</dt>
              <dd>{book.quality.hyphensJoined}</dd>
              <dt>Footnotes lifted</dt>
              <dd>{book.quality.footnotesFound}</dd>
              <dt>Tables detected</dt>
              <dd>{book.quality.tablesFound}</dd>
            </dl>
            {book.quality.textCoverage < 0.85 && !book.ocr && (
              <p className="hint">
                Some pages had little or no text layer. Where a paragraph reads wrongly,
                the pencil beside it lets you correct the text and the fix is saved.
              </p>
            )}
          </div>
        )}

        <div className="field about">
          <label>About</label>
          <p className="about-name">Nairobian Reading Room</p>
          <p className="hint">PDF to audio platform. A quiet way to hear your books.</p>
          <p className="hint">
            Developed by Desmond Kinoti ·{' '}
            <a href="mailto:desmond@nubigo.com">desmond@nubigo.com</a>
            <br />
            Copyright © {new Date().getFullYear()} Desmond Kinoti. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label, sub, on, onChange,
}: { label: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <div>
        <div className="label">{label}</div>
        <div className="sub">{sub}</div>
      </div>
      <button
        className={`switch${on ? ' on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
      />
    </div>
  );
}
