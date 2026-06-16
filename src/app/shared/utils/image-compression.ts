/**
 * Browser image compression helper.
 *
 * Resizes an image to fit within a maximum dimension and re-encodes it
 * (JPEG by default). When `maxBytes` is provided it will progressively lower
 * the quality — and, if needed, the dimensions — until the result fits, which
 * is used to keep receipt uploads under the Storage size limit.
 *
 * On any failure it resolves with the original file rather than throwing, so
 * callers can always fall back to the untouched upload.
 */
export interface CompressImageOptions {
  /** Longest edge of the output image, in pixels. Defaults to 1920. */
  maxDimension?: number;
  /** Initial JPEG quality (0–1). Defaults to 0.85. */
  quality?: number;
  /** Output mime type. Defaults to 'image/jpeg'. */
  mimeType?: string;
  /** Optional hard byte cap; quality/size are reduced to fit when set. */
  maxBytes?: number;
}

const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_QUALITY = 0.85;
const DEFAULT_MIME_TYPE = 'image/jpeg';

function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) {
    return { width, height };
  }
  if (width > height) {
    return { width: max, height: Math.round((height / width) * max) };
  }
  return { width: Math.round((width / height) * max), height: max };
}

export function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const initialQuality = options.quality ?? DEFAULT_QUALITY;
  const mimeType = options.mimeType ?? DEFAULT_MIME_TYPE;
  const maxBytes = options.maxBytes;

  return new Promise<File>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const render = (w: number, h: number, quality: number): Promise<Blob | null> =>
          new Promise((res) => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
              res(null);
              return;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => res(blob), mimeType, quality);
          });

        (async () => {
          let { width, height } = fitWithin(img.width, img.height, maxDimension);
          let quality = initialQuality;
          let blob = await render(width, height, quality);

          // Best-effort: shrink quality first, then dimensions, until under cap.
          if (maxBytes) {
            let attempts = 0;
            while (blob && blob.size > maxBytes && attempts < 6) {
              if (quality > 0.4) {
                quality = Math.max(0.3, quality - 0.15);
              } else {
                width = Math.round(width * 0.8);
                height = Math.round(height * 0.8);
              }
              blob = await render(width, height, quality);
              attempts++;
            }
          }

          if (!blob) {
            resolve(file); // Canvas unavailable — fall back to the original.
            return;
          }

          resolve(new File([blob], file.name, { type: mimeType, lastModified: Date.now() }));
        })().catch(() => resolve(file));
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
