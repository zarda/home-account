import { Timestamp } from '@angular/fire/firestore';
import { chunked, clampText, isStamp, joinedFirst, sameStamp, toMembership } from './household-index.utils';

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

  describe('joinedFirst', () => {
    const membership = (householdId: string, joinedAt: Timestamp | null) =>
      toMembership({ id: householdId, since: GEN, joinedAt });

    it('lists the earliest joined first, a join still being stamped last, and a tie by household id', () => {
      const listed = [
        membership('h4', null),
        membership('h3', Timestamp.fromMillis(2_000)),
        membership('h2', Timestamp.fromMillis(1_000)),
        membership('h1', Timestamp.fromMillis(2_000)),
      ].sort(joinedFirst);

      expect(listed.map(entry => entry.householdId)).toEqual(['h2', 'h1', 'h3', 'h4']);
    });
  });

  describe('chunked', () => {
    it('cuts a list into runs of the size, in order, the last run holding what is left', () => {
      expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunked([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
      expect(chunked([1, 2], 4)).toEqual([[1, 2]]);
    });

    it('gives no run for an empty list, and leaves the list as it was', () => {
      const items = Object.freeze(['a', 'b', 'c']);
      expect(chunked([], 3)).toEqual([]);
      expect(chunked(items, 2)).toEqual([['a', 'b'], ['c']]);
      expect(items).toEqual(['a', 'b', 'c']);
    });
  });

  describe('clampText', () => {
    it('keeps a string at or under the bound whole, and cuts a longer one to the bound', () => {
      expect(clampText('abc', 3)).toBe('abc');
      expect(clampText('', 3)).toBe('');
      expect(clampText('abcdef', 3)).toBe('abc');
    });

    it('never cuts through a character written as a surrogate pair', () => {
      const pair = '\u{1F600}';
      expect(clampText('ab' + pair, 3)).toBe('ab');
      expect(clampText('a' + pair + 'b', 3)).toBe('a' + pair);
    });

    it('drops a lone high surrogate the cut would end on, and keeps what comes before it as given', () => {
      expect(clampText('ab\uD800c', 3)).toBe('ab');
      expect(clampText('\uD800b\uD801c', 3)).toBe('\uD800b');
    });

    it('keeps a lone low surrogate the cut ends on, since it opens no pair', () => {
      expect(clampText('ab\uDC00c', 3)).toBe('ab\uDC00');
    });
  });
});
