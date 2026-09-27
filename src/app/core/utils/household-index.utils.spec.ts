import { Timestamp } from '@angular/fire/firestore';
import { isStamp, sameStamp, toMembership } from './household-index.utils';

describe('household index utils', () => {
  const GEN = new Timestamp(1_790_000_000, 123_456_000);

  describe('isStamp', () => {
    it('takes a Timestamp, and nothing that only looks like one in part', () => {
      expect(isStamp(GEN)).toBeTrue();
      expect(isStamp(null)).toBeFalse();
      expect(isStamp(undefined)).toBeFalse();
      expect(isStamp({ toMillis: () => 0 })).toBeFalse();
      expect(isStamp({ seconds: 1, nanoseconds: 0 })).toBeFalse();
      expect(isStamp('2026-09-20')).toBeFalse();
    });
  });

  describe('sameStamp', () => {
    it('compares two stamps to the nanosecond', () => {
      expect(sameStamp(GEN, new Timestamp(GEN.seconds, GEN.nanoseconds))).toBeTrue();
      expect(sameStamp(GEN, new Timestamp(GEN.seconds, GEN.nanoseconds + 1000))).toBeFalse();
      expect(sameStamp(GEN, null)).toBeFalse();
      expect(sameStamp(null, null)).toBeFalse();
    });
  });

  describe('toMembership', () => {
    it('reads an entry as a membership, its stamps kept', () => {
      expect(toMembership({ id: 'h1', name: 'Home', role: 'owner', since: GEN, joinedAt: GEN })).toEqual({
        householdId: 'h1',
        name: 'Home',
        role: 'owner',
        since: GEN,
        joinedAt: GEN,
        ended: false
      });
    });

    it('reads a malformed field as its safe default, and a stamp on its way as null', () => {
      expect(toMembership({ id: 'h1', name: 7, role: 'admin', since: null, joinedAt: 'soon' })).toEqual({
        householdId: 'h1',
        name: '',
        role: 'member',
        since: null,
        joinedAt: null,
        ended: false
      });
    });

    it('reads an entry holding endedAt at all as ended, a stamp still on its way included', () => {
      expect(toMembership({ id: 'h1', since: GEN, endedAt: GEN }).ended).toBeTrue();
      expect(toMembership({ id: 'h1', since: GEN, endedAt: null }).ended).toBeTrue();
    });
  });
});
