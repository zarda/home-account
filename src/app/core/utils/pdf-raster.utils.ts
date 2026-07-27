/**
 * Turn a PDF into page images so any vision-capable model can read it.
 *
 * Only Gemini accepts a PDF directly, so PDF import used to be Gemini-only —
 * a user with OpenAI or Claude configured was told their file was unsupported.
 * Rasterizing here removes the provider from the question entirely.
 */

import type { PDFPageProxy } from 'pdfjs-dist';

/** Where the worker is served from. See the note in `loadPdfjs`. */
export const PDF_WORKER_SRC = 'assets/pdf.worker.min.mjs';

/**
 * Most pages we will rasterize from one document.
 *
 * Each page becomes a full-size canvas and then a base64 string, both held in
 * memory at once, and every page is another image in the model request. A
 * statement long enough to exceed this is past the point where a single
 * request would succeed anyway — and on iOS the WebView is killed outright
 * rather than throwing something catchable.
 */
export const MAX_PDF_PAGES = 15;

/**
 * Render scale. 2× is enough for small print to survive OCR; beyond that the
 * canvas grows quadratically for no accuracy gain.
 */
export const PDF_RENDER_SCALE = 2;

/** Longest edge of a rendered page, in pixels. Caps A0-sized pages. */
const MAX_PAGE_EDGE = 2400;

export interface RasterizedPdf {
  /** Page images as base64 JPEG data, in document order. */
  pages: string[];
  /** Pages in the document, which may exceed the number rendered. */
  totalPages: number;
  /** True when the document was longer than MAX_PDF_PAGES. */
  truncated: boolean;
}

/**
 * Loaded on demand: pdfjs is about a megabyte, and the initial bundle budget
 * has nothing like that spare. Nothing imports it at module scope for the same
 * reason the provider SDKs do not.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  // The worker is copied to /assets by the build rather than resolved from
  // node_modules, so the service worker's lazy asset group covers it. A
  // root-level .mjs would match no glob in ngsw-config.json and the first
  // offline PDF import would fail with a worker error rather than a network
  // one.
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  return pdfjs;
}

/**
 * Render up to `MAX_PDF_PAGES` pages of `data` as base64 JPEGs.
 *
 * Each canvas is released before the next page is rendered. Holding all of
 * them would multiply peak memory by the page count, which is what makes a
 * long statement fatal on a phone.
 */
export async function rasterizePdf(data: ArrayBuffer): Promise<RasterizedPdf> {
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data }).promise;

  try {
    const totalPages = document.numPages;
    const renderCount = Math.min(totalPages, MAX_PDF_PAGES);
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= renderCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        pages.push(await renderPage(page));
      } finally {
        page.cleanup();
      }
    }

    return { pages, totalPages, truncated: totalPages > renderCount };
  } finally {
    await document.cleanup();
  }
}

async function renderPage(page: PDFPageProxy): Promise<string> {
  const unscaled = page.getViewport({ scale: 1 });
  const longestEdge = Math.max(unscaled.width, unscaled.height);
  // Never exceed MAX_PAGE_EDGE, however large the page claims to be.
  const scale = Math.min(PDF_RENDER_SCALE, MAX_PAGE_EDGE / longestEdge);
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not render the PDF page');
  }

  try {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    // Zeroing the dimensions is what actually frees the backing store in
    // WebKit; dropping the reference alone leaves it to the collector, which
    // is too late when the next page is already being rendered.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Seam so the renderer can be exercised without a real DOM canvas. */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
