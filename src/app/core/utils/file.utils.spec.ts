import { looksLikeImageFile } from './file.utils';

describe('looksLikeImageFile', () => {
  it('accepts an image by mime type alone', () => {
    const file = new File(['x'], 'camera-shot', { type: 'image/png' });
    expect(looksLikeImageFile(file)).toBeTrue();
  });

  it('accepts an image by extension when the type is generic', () => {
    // The shape a share from another iOS app arrives in: real image bytes,
    // application/octet-stream label.
    const file = new File(['x'], 'photo.jpg', { type: 'application/octet-stream' });
    expect(looksLikeImageFile(file)).toBeTrue();
  });

  it('accepts an uppercase extension', () => {
    const file = new File(['x'], 'IMG_0042.JPG', { type: '' });
    expect(looksLikeImageFile(file)).toBeTrue();
  });

  it('rejects a non-image with a non-image extension', () => {
    const file = new File(['x'], 'statement.csv', { type: 'text/csv' });
    expect(looksLikeImageFile(file)).toBeFalse();
  });

  it('rejects a generic file with no extension', () => {
    const file = new File(['x'], 'payload', { type: 'application/octet-stream' });
    expect(looksLikeImageFile(file)).toBeFalse();
  });
});
