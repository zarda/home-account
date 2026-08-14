/** The image extensions every intake gate accepts — the single source for the MIME-or-extension tests. */
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/**
 * MIME-or-extension image test. A shared photo can arrive typed
 * application/octet-stream (or blank), and a predicate anchored on the MIME
 * alone routes it out of the image path — so the extension gets a vote, the
 * same fallback isAcceptedShare and detectFileType already apply.
 */
export function looksLikeImageFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith('image/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_FILE_EXTENSIONS.includes(extension);
}

/**
 * Read a file into a base64 data URL.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
