import type { Timestamp } from '@angular/fire/firestore';
import { HouseholdIndexEntry, HouseholdMembership } from '../../models';

/**
 * An index document (users/{uid}/households/{hid}) as a read or a listener
 * hands it over: each field stored data, so none is trusted to hold its type.
 */
export type HouseholdIndexData = { id: string } & Partial<Record<Exclude<keyof HouseholdIndexEntry, 'id'>, unknown>>;

/**
 * A Timestamp as Firestore hands one over. Its seconds and nanoseconds are
 * checked as well as its method, since a generation is compared by both, as
 * the rules compare it. A stamp still on its way (a server timestamp read
 * before the server answered) is null, never one.
 */
export function isStamp(value: unknown): value is Timestamp {
  const stamp = value as Timestamp | null | undefined;
  return !!stamp && typeof stamp.toMillis === 'function'
    && typeof stamp.seconds === 'number' && typeof stamp.nanoseconds === 'number';
}

/** Two stamps to the nanosecond, as the rules compare a generation. */
export function sameStamp(a: unknown, b: unknown): boolean {
  return isStamp(a) && isStamp(b) && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
}

/**
 * One index entry as the app reads a membership. HouseholdService and
 * LedgerShareService both read the index through this, so the page and the
 * copies judge a membership live or ended alike.
 */
export function toMembership(entry: HouseholdIndexData): HouseholdMembership {
  return {
    householdId: entry.id,
    name: typeof entry.name === 'string' ? entry.name : '',
    role: entry.role === 'owner' ? 'owner' : 'member',
    since: isStamp(entry.since) ? entry.since : null,
    joinedAt: isStamp(entry.joinedAt) ? entry.joinedAt : null,
    // Present at all, a stamp still on its way included, the ending is under way.
    ended: entry.endedAt !== undefined
  };
}

/**
 * Memberships earliest joined first; one whose join is still being stamped
 * comes last. The household switcher and the share controls both list them
 * in this order.
 */
export function joinedFirst(a: HouseholdMembership, b: HouseholdMembership): number {
  const at = (m: HouseholdMembership) => (m.joinedAt ? m.joinedAt.toMillis() : Number.POSITIVE_INFINITY);
  return at(a) - at(b) || a.householdId.localeCompare(b.householdId);
}

/**
 * `items` in runs of at most `size` (a positive count), in order, the last
 * run holding what is left. The household services write, read and filter
 * by id in runs, each within a bound the rules or Firestore set.
 */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * `text` cut to at most `max` UTF-16 code units, so no rule bounding its
 * size() at `max` refuses it for its length, and every cut of one string is
 * the same. A cut never ends on a high surrogate: one that opens a pair
 * would split a character, and a lone one has no UTF-8 form, the form
 * Firestore stores a string in. What the cut keeps is the text as given.
 */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
