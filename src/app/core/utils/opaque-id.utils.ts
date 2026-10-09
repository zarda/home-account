/**
 * A row id that says nothing about where the row came from.
 *
 * Deterministic: the same kind and parts always give the same id, so a retried
 * write lands on the row it already created. 32 lower-case hex characters (128
 * bits of a SHA-256), domain-separated by kind so a recurring posting and a
 * queued scan never share an id.
 *
 * Digest input: `JSON.stringify([kind, ...parts])`, so boundaries and types
 * stay unambiguous.
 *
 * Hex, not base64: standard base64 can emit `/` (barred by `ledgerCopyId` and
 * Storage path segments), and base64url emits `_` (the receipt slot suffix
 * separator).
 */
export async function opaqueRowId(
  kind: 'rec' | 'scan',
  ...parts: (string | number)[]
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, ...parts]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
