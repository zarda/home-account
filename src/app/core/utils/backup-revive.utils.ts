import { Timestamp } from '@angular/fire/firestore';
import { parseDateInput } from './transaction-date.utils';

/**
 * Turn whatever a backup carries in a timestamp slot back into a Timestamp.
 *
 * A backup is a plain `JSON.stringify` of stored documents, so a Timestamp
 * reaches a restore door as the `{ seconds, nanoseconds }` it serialises to,
 * with no `toDate` on it — while every rule guarding these collections checks
 * `is timestamp`. A door that wrote the plain object through would be denied
 * on every row, which is a failure mode the emulator sees and mocked unit
 * specs do not.
 *
 * A value that is already a Timestamp passes through untouched, so a door is
 * callable both from a parsed file and from live records a smoke spec holds.
 *
 * Null when the slot holds nothing readable, so a caller decides: a required
 * stamp has to fall back to something, an optional one is simply dropped
 * rather than invented.
 */
export function reviveTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value;
  const parsed = parseDateInput(value);
  return parsed ? Timestamp.fromDate(parsed) : null;
}

/**
 * The optional-timestamp half, shaped for a spread.
 *
 * `{ ...optionalTimestamp('createdAt', record.createdAt) }` contributes the
 * field when the file carries a readable one and nothing at all when it does
 * not — Firestore rejects an explicit `undefined` outright, so an absent
 * optional cannot simply be passed along.
 */
export function optionalTimestamp(
  field: string,
  value: unknown,
): Record<string, Timestamp> {
  const revived = reviveTimestamp(value);
  return revived ? { [field]: revived } : {};
}
