/** Core domain types shared across extraction, storage and playback. */

export type BlockType =
  | 'heading'      // chapter / section title
  | 'paragraph'    // ordinary body prose
  | 'caption'      // figure or table caption
  | 'table'        // tabular region (usually skipped)
  | 'image'        // graphic region (usually skipped or described)
  | 'footnote'     // note text lifted from the foot of a page
  | 'list';        // bulleted or numbered item

/** One narratable (or deliberately skipped) unit of the book. */
export interface Block {
  /** Index into the book's flat block array. Stable, used for positions. */
  id: number;
  type: BlockType;
  /** Cleaned, display-ready text. Speech normalisation happens at speak time. */
  text: string;
  /** 1-based page this block starts on. */
  page: number;
  /** Index into the book's chapter array. */
  chapter: number;
  /** Number of words, cached for progress + time estimates. */
  words: number;
  /** Footnote marker this block belongs to, for endnote-style playback. */
  noteRef?: string;
  /** Set when the user has hand-corrected the text. */
  edited?: boolean;
}

export interface Chapter {
  index: number;
  title: string;
  /** First block belonging to this chapter. */
  startBlock: number;
  /** One past the last block. Filled in once extraction completes. */
  endBlock: number;
  page: number;
  words: number;
  /** How the chapter was found — outline entries are trustworthy, heuristics less so. */
  source: 'outline' | 'heuristic';
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  fileName: string;
  fileSize: number;
  pages: number;
  words: number;
  addedAt: number;
  /** Data URL of the rendered first page. */
  cover?: string;
  /** True when text came from OCR rather than the PDF text layer. */
  ocr?: boolean;
  /** Extraction diagnostics surfaced in the UI. */
  quality?: ExtractionQuality;
}

export interface ExtractionQuality {
  /** 0-1: share of pages that produced a usable amount of text. */
  textCoverage: number;
  /** Pages that looked scanned (image-only). */
  scannedPages: number[];
  columnsDetected: number;
  headersStripped: number;
  footnotesFound: number;
  tablesFound: number;
  imagesFound: number;
  hyphensJoined: number;
}

export interface Progress {
  bookId: string;
  block: number;
  /** Character offset inside the block, so resume lands mid-paragraph. */
  offset: number;
  /** Exact share of the book already read, so the shelf needs no guesswork. */
  fraction: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  block: number;
  offset: number;
  excerpt: string;
  note: string;
  createdAt: number;
}

export type FootnoteMode = 'inline' | 'endOfChapter' | 'skip';
export type EngineKind = 'webspeech' | 'elevenlabs' | 'google' | 'openai';

export interface Settings {
  engine: EngineKind;
  voiceURI: string | null;
  /** Voice id for whichever cloud engine is selected. */
  cloudVoice: Record<string, string>;
  apiKeys: Record<string, string>;
  rate: number;
  pitch: number;
  volume: number;
  footnoteMode: FootnoteMode;
  describeImages: boolean;
  readTables: boolean;
  readCaptions: boolean;
  announceChapters: boolean;
  /** Multiplier on the punctuation pause table. */
  pauseScale: number;
  /** Fallback words-per-minute before we have measured the real rate. */
  baseWpm: number;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'webspeech',
  voiceURI: null,
  cloudVoice: {},
  apiKeys: {},
  rate: 1,
  pitch: 1,
  volume: 1,
  footnoteMode: 'endOfChapter',
  describeImages: false,
  readTables: false,
  readCaptions: true,
  announceChapters: true,
  pauseScale: 1,
  baseWpm: 165,
  theme: 'dark',
};

/** Progress reported while a PDF is being ingested. */
export interface ExtractProgress {
  phase: 'loading' | 'scanning' | 'analysing' | 'ocr' | 'done';
  page: number;
  pages: number;
  message: string;
}
