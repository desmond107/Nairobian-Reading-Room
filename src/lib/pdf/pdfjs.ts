import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * pdf.js does its parsing in its own worker, which is what keeps a 300-page
 * book from freezing the tab. Vite needs the `?url` import to emit the worker
 * as a real asset rather than inlining it.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type PDFDocumentProxy = pdfjs.PDFDocumentProxy;
export type PDFPageProxy = pdfjs.PDFPageProxy;
