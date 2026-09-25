/**
 * The `code` a Firestore or Functions error carries (`permission-denied`,
 * `functions/not-found`, ...), or undefined for anything else. Read
 * structurally: a listener's error arrives typed `unknown`.
 */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A rules refusal. A listener also receives one when access it held is
 * withdrawn, so it can mean "no longer shared" rather than "broken".
 */
export const isRefused = (error: unknown): boolean => errorCode(error) === 'permission-denied';
