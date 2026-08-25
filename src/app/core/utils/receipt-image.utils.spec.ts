import {
  MAX_RECEIPT_EDGE,
  RECEIPT_IMAGE_UNREADABLE,
  encodeCanvas,
  prepareReceiptImage,
} from './receipt-image.utils';

/**
 * Real canvases and a real encoder: these run in Chrome, and the thing under
 * test is exactly the browser's decode/encode behaviour. A stubbed canvas
 * would prove the arithmetic and nothing about whether a photo actually comes
 * back smaller.
 *
 * Noise rather than flat colour, because a flat image compresses to almost
 * nothing at any quality and every step of the ladder would fit.
 */
async function noisyImage(width: number, height: number): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = Math.floor(Math.random() * 256);
    pixels.data[i + 1] = Math.floor(Math.random() * 256);
    pixels.data[i + 2] = Math.floor(Math.random() * 256);
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const blob = (await encodeCanvas(canvas, 1))!;
  return new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
}

/** The dimensions a produced file actually has, read back through the decoder. */
async function dimensionsOf(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

describe('receipt-image.utils', () => {
  describe('prepareReceiptImage', () => {
    it('returns a file that already fits untouched', async () => {
      // Not merely equal — the same object. Re-encoding a receipt that was
      // never too big would spend quality for nothing.
      const small = new File(['x'.repeat(1000)], 'receipt.jpg', { type: 'image/jpeg' });

      expect(await prepareReceiptImage(small, 2000)).toBe(small);
    });

    it('brings an oversized photo under the ceiling as a JPEG', async () => {
      const photo = await noisyImage(2400, 1600);
      const cap = Math.round(photo.size / 4);

      const prepared = await prepareReceiptImage(photo, cap);

      expect(prepared.size).toBeLessThanOrEqual(cap);
      expect(prepared.type).toBe('image/jpeg');
      expect(prepared).not.toBe(photo);
    });

    it('names the copy after the original, as a .jpg', async () => {
      const photo = await noisyImage(2400, 1600);
      const named = new File([photo], 'IMG_4821.HEIC', { type: 'image/jpeg' });

      const prepared = await prepareReceiptImage(named, Math.round(named.size / 4));

      expect(prepared.name).toBe('IMG_4821.jpg');
    });

    it('caps the longest edge and keeps the shape', async () => {
      // A generous cap, so the first quality fits and the edge stays where the
      // ladder put it rather than at the halved fallback.
      const photo = await noisyImage(3000, 1000);

      const prepared = await prepareReceiptImage(photo, Math.round(photo.size / 2));
      const { width, height } = await dimensionsOf(prepared);

      expect(width).toBe(MAX_RECEIPT_EDGE);
      expect(height).toBeCloseTo(MAX_RECEIPT_EDGE / 3, -1);
    });

    it('caps the height of a receipt-shaped photo, which is the tall one', async () => {
      // The case this exists for: a receipt is a strip, and capping the wrong
      // edge would leave a 4000px-tall image at full width.
      const photo = await noisyImage(1000, 3000);

      const prepared = await prepareReceiptImage(photo, Math.round(photo.size / 2));
      const { width, height } = await dimensionsOf(prepared);

      expect(height).toBe(MAX_RECEIPT_EDGE);
      expect(width).toBeCloseTo(MAX_RECEIPT_EDGE / 3, -1);
    });

    it('stops at the first quality that fits rather than the floor', async () => {
      const photo = await noisyImage(2400, 1600);

      // What the bottom of the ladder would have produced, at the same edge.
      const canvas = document.createElement('canvas');
      canvas.width = MAX_RECEIPT_EDGE;
      canvas.height = Math.round((1600 / 2400) * MAX_RECEIPT_EDGE);
      const bitmap = await createImageBitmap(photo);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const floor = (await encodeCanvas(canvas, 0.4))!;

      // A cap this loose is met by the first step, so the answer must be
      // visibly better than the floor.
      const prepared = await prepareReceiptImage(photo, Math.round(photo.size / 2));

      expect(prepared.size).toBeGreaterThan(floor.size);
    });

    it('names the failure when the image cannot be decoded', async () => {
      // An HEIC on a browser that cannot read one arrives here looking like
      // any other file; "attach failed" would say nothing a user could act on.
      const notAnImage = new File(['x'.repeat(5000)], 'receipt.heic', { type: 'image/heic' });

      await expectAsync(prepareReceiptImage(notAnImage, 1000)).toBeRejectedWithError(
        RECEIPT_IMAGE_UNREADABLE
      );
    });

    it('gives up by name when nothing fits the ceiling', async () => {
      // One byte is not achievable at any quality or edge; the point is that
      // the caller is told which failure this was.
      const photo = await noisyImage(1200, 800);

      await expectAsync(prepareReceiptImage(photo, 1)).toBeRejectedWithError(
        RECEIPT_IMAGE_UNREADABLE
      );
    });
  });
});
