import { Timestamp } from '@angular/fire/firestore';
import {
  FULL_SWEEP_EVERY_MS,
  LEDGER_COMMIT_CHUNK,
  LEDGER_COPY_FIELDS,
  LEDGER_OWN_WRITE_CHUNK,
  LEDGER_PROJECTION_VERSION,
  LEDGER_PURGE_CHUNK,
  LEDGER_QUERY_SHAPES,
  LEDGER_REQUIRED_FIELDS,
  LEDGER_VIEW_CAP,
  LedgerCopy,
  MAX_BULK_SHARE,
  householdOfShareKey,
  ledgerCopyId,
  ledgerCopyPath,
  shareKey,
} from './household-ledger.model';
import { MAX_HOUSEHOLDS_PER_ACCOUNT, householdIndexPath } from './household.model';

/**
 * Every transaction field a household must never see, plus the
 * household-currency fields (hhCurrency, hhAmount) no copy may carry, since
 * each viewer converts at today's rate. None of them may ever be named by the
 * copy's field list, which the rules' hasOnly mirrors.
 */
const PRIVATE_FIELDS: readonly string[] = [
  'note', 'tags', 'location', 'receiptUrl', 'receiptUrls', 'receiptCount',
  'recurringId', 'isRecurring', 'splitGroupId', 'goalAmount', 'period',
  'baseCurrency', 'exchangeRate', 'amountInBaseCurrency', 'createdAt', 'userId',
  'sharedWith', 'hhCurrency', 'hhAmount',
];

describe('household-ledger.model', () => {
  describe('the copy fields', () => {
    // Typed as every key of a copy, the optional one included: the compiler
    // refuses a key missing from this literal and one the interface lacks, so
    // comparing its keys with the list ties the list to the interface both ways.
    const everyField: Required<LedgerCopy> = {
      memberUid: 'u1',
      sourceId: 'tx1',
      gen: Timestamp.fromMillis(1_790_000_000_000),
      pv: 1,
      type: 'expense',
      amount: 12.5,
      currency: 'EUR',
      date: Timestamp.fromMillis(1_790_100_000_000),
      description: 'Bread',
      categoryId: 'food_groceries',
      category: { name: 'categoryNames.groceries', icon: 'shopping_cart', color: '#FF5722' },
      bucket: 'food_groceries',
      bucketGroup: 'food',
      goalId: 'g1',
      updatedAt: Timestamp.fromMillis(1_790_200_000_000),
    };

    it('lists exactly the keys of a copy', () => {
      expect([...LEDGER_COPY_FIELDS as readonly string[]].sort()).toEqual(Object.keys(everyField).sort());
    });

    it('names each field once', () => {
      expect(new Set(LEDGER_COPY_FIELDS).size).toBe(LEDGER_COPY_FIELDS.length);
    });

    it('requires every field but the household goal link, in the same order', () => {
      expect([...LEDGER_REQUIRED_FIELDS]).toEqual(LEDGER_COPY_FIELDS.filter(field => field !== 'goalId'));
    });

    for (const field of PRIVATE_FIELDS) {
      it(`never names ${field}`, () => {
        expect(LEDGER_COPY_FIELDS as readonly string[]).not.toContain(field);
      });
    }
  });

  describe('the limits', () => {
    it('are the ones the rules and the contract check are written against', () => {
      expect(LEDGER_PROJECTION_VERSION).toBe(1);
      expect(LEDGER_COMMIT_CHUNK).toBe(5);
      expect(LEDGER_PURGE_CHUNK).toBe(10);
      expect(LEDGER_OWN_WRITE_CHUNK).toBe(450);
      expect(LEDGER_VIEW_CAP).toBe(2000);
      expect(MAX_BULK_SHARE).toBe(500);
      expect(FULL_SWEEP_EVERY_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('stamps a whole projection version', () => {
      expect(Number.isInteger(LEDGER_PROJECTION_VERSION)).toBeTrue();
      expect(LEDGER_PROJECTION_VERSION).toBeGreaterThan(0);
    });

    it('keeps a commit of copy writes within the 20 rule lookups a commit may make, at 3 each', () => {
      expect(LEDGER_COMMIT_CHUNK * 3).toBeLessThanOrEqual(20);
    });

    it('keeps a commit of the owner\'s deletes within the 20 rule lookups, at 1 each', () => {
      expect(LEDGER_PURGE_CHUNK).toBeLessThanOrEqual(20);
    });

    it('keeps a commit of the account\'s own writes under the 500 writes a commit may hold', () => {
      expect(LEDGER_OWN_WRITE_CHUNK).toBeLessThan(500);
    });

    it('lets a row name at most the ten households one account can belong to', () => {
      expect(MAX_HOUSEHOLDS_PER_ACCOUNT).toBe(10);
    });
  });

  describe('the query shapes', () => {
    const table = Object.entries(LEDGER_QUERY_SHAPES).map(([name, shape]) => ({
      name,
      collectionGroup: shape.collectionGroup,
      fields: shape.fields.map(([field, order]) => `${field} ${order}`),
    }));

    it('declares one shape for each list the household view and its sweeps make', () => {
      expect(table).toEqual([
        { name: 'ledgerByDate', collectionGroup: 'ledger', fields: ['gen ASCENDING', 'date DESCENDING'] },
        { name: 'ledgerByGoal', collectionGroup: 'ledger', fields: ['gen ASCENDING', 'goalId ASCENDING'] },
        { name: 'ledgerByMember', collectionGroup: 'ledger', fields: ['gen ASCENDING', 'memberUid ASCENDING'] },
        { name: 'activeBudgets', collectionGroup: 'budgets', fields: ['gen ASCENDING', 'isActive ASCENDING'] },
        { name: 'activeGoals', collectionGroup: 'goals', fields: ['gen ASCENDING', 'isActive ASCENDING'] },
        { name: 'contributionsByDate', collectionGroup: 'contributions', fields: ['gen ASCENDING', 'date DESCENDING'] },
      ]);
    });

    // A member may list only the live generation's documents, and the rules
    // prove that of a list only from an equality filter on gen.
    for (const { name, fields } of table) {
      it(`leads ${name} with the generation`, () => {
        expect(fields[0]).toBe('gen ASCENDING');
      });
    }

    it('declares no shape twice', () => {
      const keys = table.map(({ collectionGroup, fields }) => [collectionGroup, ...fields].join(','));
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('filters the ledger only on fields a copy holds', () => {
      for (const { collectionGroup, fields } of table) {
        if (collectionGroup !== 'ledger') continue;
        for (const field of fields.map(entry => entry.split(' ')[0])) {
          expect(LEDGER_COPY_FIELDS as readonly string[]).toContain(field);
        }
      }
    });
  });

  describe('share keys', () => {
    const IDS: readonly string[] = ['h1', 'AbCdEfGhIj0123456789', 'with_underscore', 'with-dash', 'ünï'];

    for (const id of IDS) {
      it(`round-trips ${id}`, () => {
        expect(shareKey(id)).toBe(`households/${id}`);
        expect(householdOfShareKey(shareKey(id))).toBe(id);
      });
    }

    const NOT_A_HOUSEHOLD: readonly { name: string; key: unknown }[] = [
      { name: 'a key of another namespace', key: 'groups/g1' },
      { name: 'the bare prefix', key: 'households/' },
      { name: 'the collection name alone', key: 'households' },
      { name: 'a deeper path', key: 'households/h1/ledger' },
      { name: 'a trailing slash', key: 'households/h1/' },
      { name: 'a leading slash', key: '/households/h1' },
      { name: 'another case', key: 'Households/h1' },
      { name: 'surrounding space', key: ' households/h1' },
      { name: 'the empty string', key: '' },
      { name: 'an id Firestore refuses (.)', key: 'households/.' },
      { name: 'an id Firestore refuses (..)', key: 'households/..' },
      { name: 'an id Firestore reserves', key: 'households/__h1__' },
      { name: 'a number', key: 42 },
      { name: 'null', key: null },
      { name: 'undefined', key: undefined },
      { name: 'a map', key: { households: 'h1' } },
    ];

    for (const { name, key } of NOT_A_HOUSEHOLD) {
      it(`reads no household from ${name}`, () => {
        expect(householdOfShareKey(key)).toBeNull();
      });
    }
  });

  describe('ledgerCopyId', () => {
    it('is the author, an underscore and the row', () => {
      expect(ledgerCopyId('u1', 'tx1')).toBe('u1_tx1');
    });

    // The rules name a copy's author as the id's first underscore-separated
    // segment (a missing copy has no memberUid to read), so the author is
    // recovered that way whatever the row id holds.
    for (const txId of ['tx1', 'tx_with_underscores', '_leading', 'trailing_']) {
      it(`hands the rules its author back for row ${txId}`, () => {
        const id = ledgerCopyId('AbC123xyz', txId);

        expect(id.split('_')[0]).toBe('AbC123xyz');
        expect(id.slice('AbC123xyz'.length + 1)).toBe(txId);
      });
    }

    const REFUSED: readonly { name: string; uid: string; txId: string }[] = [
      { name: 'an author holding an underscore', uid: 'u_1', txId: 'tx1' },
      { name: 'an empty author', uid: '', txId: 'tx1' },
      { name: 'an author holding a slash', uid: 'u/1', txId: 'tx1' },
      { name: 'an empty row id', uid: 'u1', txId: '' },
      { name: 'a row id holding a slash', uid: 'u1', txId: 'tx/1' },
    ];

    for (const { name, uid, txId } of REFUSED) {
      it(`refuses ${name}`, () => {
        expect(() => ledgerCopyId(uid, txId)).toThrowError(/ledger copy id/);
      });
    }
  });

  describe('paths', () => {
    it('places a copy in its household\'s ledger, at its copy id', () => {
      expect(ledgerCopyPath('h1', 'u1', 'tx1')).toBe('households/h1/ledger/u1_tx1');
    });

    it('refuses a copy path wherever it refuses the copy id', () => {
      expect(() => ledgerCopyPath('h1', 'u_1', 'tx1')).toThrowError(/ledger copy id/);
      expect(() => ledgerCopyPath('h1', 'u1', 'tx/1')).toThrowError(/ledger copy id/);
    });

    it('places an account\'s index of households under the account', () => {
      expect(householdIndexPath('u1')).toBe('users/u1/households');
    });
  });
});
