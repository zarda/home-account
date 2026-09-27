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
