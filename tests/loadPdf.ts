import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// The legacy build is the one that runs outside a browser.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageInput } from '../src/lib/pdf/assemble';
import { outlineMarks, type Mark } from '../src/lib/pdf/chapters';
import { layoutPage, toFrags } from '../src/lib/pdf/layout';

/**
 * Runs the same geometry pass the browser extractor runs, against a real PDF
 * on disk. Keeping this identical to `extractBook`'s first pass is what makes
 * the assembly tests meaningful.
 */

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): string {
  return resolve(here, 'fixtures', name);
}

export interface LoadedPdf {
  pages: PageInput[];
  marks: Mark[];
  maxColumns: number;
  numPages: number;
}

export async function loadPdf(path: string, password?: string): Promise<LoadedPdf> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({
    data,
    password,
    disableFontFace: true,
    // Node has no Worker; pdf.js falls back to running in-process.
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const pages: PageInput[] = [];
  let maxColumns = 1;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const frags = toFrags(content.items.filter((i: unknown) => 'str' in (i as object)) as never, viewport.height);
    const { lines: ordered, columns } = layoutPage(frags, viewport.width, viewport.height);
    maxColumns = Math.max(maxColumns, columns);
    pages.push({
      page: n,
      width: viewport.width,
      height: viewport.height,
      lines: ordered,
      chars: ordered.reduce((sum, l) => sum + l.text.trim().length, 0),
    });
    page.cleanup();
  }

  const marks = await outlineMarks(doc as never);
  const numPages = doc.numPages;
  await doc.loadingTask.destroy();
  return { pages, marks, maxColumns, numPages };
}
