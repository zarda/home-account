import { Timestamp } from '@angular/fire/firestore';
import { optionalTimestamp, reviveTimestamp } from './backup-revive.utils';

describe('backup-revive.utils', () => {
  describe('reviveTimestamp', () => {
    it('revives the shape JSON.stringify leaves behind', () => {
      const revived = reviveTimestamp({ seconds: 1_700_000_000, nanoseconds: 250_000_000 });

      expect(revived).toBeInstanceOf(Timestamp);
      expect(revived!.toMillis()).toBe(1_700_000_000_250);
    });

    it('passes a live Timestamp through untouched', () => {
      // A smoke spec hands a door records read straight from Firestore.
      const stamp = Timestamp.fromMillis(1_700_000_000_000);

      expect(reviveTimestamp(stamp)).toBe(stamp);
    });

    it('reads an ISO instant', () => {
      expect(reviveTimestamp('2026-08-01T10:30:00.000Z')!.toMillis())
        .toBe(Date.UTC(2026, 7, 1, 10, 30));
    });

    it('answers null for a slot with nothing readable in it', () => {
      // The caller decides: a required stamp falls back, an optional one is
      // dropped. Inventing today's date here would silently restamp a record.
      expect(reviveTimestamp(undefined)).toBeNull();
      expect(reviveTimestamp(null)).toBeNull();
      expect(reviveTimestamp({})).toBeNull();
      expect(reviveTimestamp('not a date')).toBeNull();
    });
  });

  describe('optionalTimestamp', () => {
    it('contributes the field when the value is readable', () => {
      const fields = optionalTimestamp('createdAt', { seconds: 1_600_000_000, nanoseconds: 0 });

      expect(Object.keys(fields)).toEqual(['createdAt']);
      expect(fields['createdAt'].toMillis()).toBe(1_600_000_000_000);
    });

    it('contributes nothing at all when it is not', () => {
      // Firestore rejects an explicit undefined, so an absent optional cannot
      // simply be spread through as one.
      expect(optionalTimestamp('createdAt', undefined)).toEqual({});
      expect('createdAt' in optionalTimestamp('createdAt', 'rubbish')).toBeFalse();
    });
  });
});
