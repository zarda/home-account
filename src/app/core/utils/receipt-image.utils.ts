/**
 * Make a receipt photo fit the size a receipt photo is allowed to be.
 *
 * The ceiling is 2 MB — `MAX_RECEIPT_BYTES`, mirrored in storage.rules — and
 * until this existed nothing in the app ever made an image meet it. The camera
 * door happened to be safe because it captures at quality 0.85; every door that
 * takes an *existing* file handed over the original, and a phone photo is 2–5 MB.
 * So an import read the receipt perfectly, then lost the whole transaction at
 * the upload (#334).
 *
 * Deliberately not applied to what the model reads. The reader is sent the
 * original bytes, because small print is exactly what a downscale destroys and
 * reading the receipt correctly is the entire point of the feature. This runs
 * on the copy that gets stored, where legibility to a human at full zoom is the
 * bar.
 */
import { createCanvas } from './pdf-raster.utils';

/**
 * Longest edge of a stored receipt, in pixels.
 *
 * A receipt is a tall strip of small print; 2000px down its long edge keeps
 * item lines readable when zoomed, and is where the file size starts falling
 * fast enough to matter. `pdf-raster.utils.ts` caps its pages the same way and
 * for the same reason.
 */
export const MAX_RECEIPT_EDGE = 2000;

/**
 * Qualities to try, in order. Stops at the first that fits, so a photo that
 * only just overshoots is not re-encoded down to the floor.
 */
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

/** Thrown when the image cannot be decoded at all — an HEIC on a browser that cannot read one. */
export const RECEIPT_IMAGE_UNREADABLE = 'RECEIPT_IMAGE_UNREADABLE';

/** Seam so the decode can be exercised without a real image decoder. */
export async function decodeImage(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Seam for the encode, which jsdom-less Karma can drive but a stub cannot fake through canvas. */
export function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality));
}

/** The name a re-encoded copy keeps: the original's, with a .jpg extension. */
function jpegName(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, '');
  return `${stem || 'receipt'}.jpg`;
}

/**
 * Draw `bitmap` at `edge` on its longest side and encode it, stepping quality
 * down until it fits or the steps run out. Returns null when none fit.
 */
async function encodeWithin(
  bitmap: ImageBitmap,
  edge: number,
  maxBytes: number
): Promise<Blob | null> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(RECEIPT_IMAGE_UNREADABLE);
  }

  try {
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of QUALITY_STEPS) {
      const blob = await encodeCanvas(canvas, quality);
      if (blob && blob.size <= maxBytes) {
        return blob;
      }
    }
    return null;
  } finally {
    // Zeroing the dimensions is what actually frees the backing store in
    // WebKit; dropping the reference alone leaves it to the collector, which
    // is too late when the next photo of the same receipt is already decoding.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * A copy of `file` that fits `maxBytes`, or the file itself when it already does.
 *
 * Returning the original untouched matters: most receipts are already small,
 * and re-encoding them would spend quality for nothing. Only an oversized image
 * is redrawn, and then only as far as it must be — the first quality that fits
 * wins, and the edge is halved once more only if the whole ladder failed.
 *
 * Throws `RECEIPT_IMAGE_UNREADABLE` when the image cannot be decoded or cannot
 * be squeezed under the ceiling, so the caller can say which of those happened
 * rather than reporting an unexplained failure.
 */
export async function prepareReceiptImage(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    throw new Error(RECEIPT_IMAGE_UNREADABLE);
  }

  try {
    const fitted =
      (await encodeWithin(bitmap, MAX_RECEIPT_EDGE, maxBytes)) ??
      (await encodeWithin(bitmap, Math.round(MAX_RECEIPT_EDGE / 2), maxBytes));
    if (!fitted) {
      throw new Error(RECEIPT_IMAGE_UNREADABLE);
    }
    return new File([fitted], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
