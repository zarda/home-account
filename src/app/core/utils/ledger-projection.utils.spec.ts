import { Timestamp } from '@angular/fire/firestore';
import {
  Category,
  LEDGER_COPY_FIELDS,
  LEDGER_PROJECTION_VERSION,
  LEDGER_REQUIRED_FIELDS,
  LedgerCopy,
  LedgerCopyProjection,
  Transaction,
  TransactionType,
} from '../../models';
import { createCategory } from '../services/testing/test-data';
import { defaultCategories, mergeCategories } from './category-merge.utils';
import { bucketOf, copyDiffers, normalizeShares, projectRow } from './ledger-projection.utils';

const GEN = Timestamp.fromMillis(1_790_000_000_000);

function builtIn(id: string): Category {
  const row = defaultCategories().find(category => category.id === id);
  if (!row) throw new Error(`no built-in ${id}`);
  return row;
}

function custom(overrides: Partial<Category> & Pick<Category, 'id'>): Category {
  return createCategory({
    userId: 'u1',
    name: 'Custom',
    icon: 'star',
    color: '#123456',
    order: 1000,
    isDefault: false,
    ...overrides,
  });
}

/** An account's stored categories: custom ones of every shape, and two overridden built-ins. */
const STORED: readonly Category[] = [
  custom({ id: 'cust_under_group', name: 'Farmers market', parentId: 'food' }),
  custom({ id: 'cust_under_sub', name: 'Bakery', parentId: 'food_groceries' }),
  custom({ id: 'cust_grandchild', name: 'Sourdough', parentId: 'cust_under_group' }),
  custom({ id: 'cust_income_child', name: 'Stipend', type: 'income', parentId: 'employment' }),
  custom({ id: 'cust_top_expense', name: 'Hobby', type: 'expense' }),
  custom({ id: 'cust_top_income', name: 'Side gig', type: 'income' }),
  custom({ id: 'cust_top_both', name: 'Transfers', type: 'both' }),
  custom({ id: 'cust_cycle_a', parentId: 'cust_cycle_b' }),
  custom({ id: 'cust_cycle_b', parentId: 'cust_cycle_a' }),
  custom({ id: 'cust_self', parentId: 'cust_self' }),
  custom({ id: 'cust_orphan', parentId: 'deleted_parent' }),
  // Renamed and recoloured; the stored parent is not the catalog's.
  { ...builtIn('food_groceries'), userId: 'u1', name: 'Supermarket', color: '#00FF00', parentId: 'shopping' },
  // Soft-deleted.
  { ...builtIn('transport'), userId: 'u1', isActive: false },
];

const MERGED = mergeCategories(defaultCategories(), STORED);

/**
 * A row carrying every field a transaction holds, each private one set to a
 * value found nowhere else, so a projection that let any of them through would
 * show it. Typed as Required<Transaction>, so a field the model gains fails to
 * compile here until it is given a value.
 */
function fullRow(overrides: Partial<Transaction> = {}): Transaction {
  const row: Required<Transaction> = {
    id: 'tx1',
    userId: 'u1',
    type: 'expense',
    amount: 42.5,
    currency: 'EUR',
    amountInBaseCurrency: 987654.321,
    exchangeRate: 23456.789,
    baseCurrency: 'XAU',
    categoryId: 'food_restaurants',
    description: 'Weekly shop',
    note: 'SECRET-NOTE',
    date: Timestamp.fromMillis(1_780_000_000_123),
    createdAt: Timestamp.fromMillis(1_111_111_111_000),
    updatedAt: Timestamp.fromMillis(1_222_222_222_000),
    receiptUrl: 'https://SECRET-RECEIPT/0',
    receiptUrls: ['https://SECRET-RECEIPT/0', 'https://SECRET-RECEIPT/1'],
    receiptCount: 777,
    tags: ['SECRET-TAG'],
    isRecurring: true,
    recurringId: 'SECRET-RECURRING',
    location: { name: 'SECRET-PLACE', lat: 35.123456, lng: 139.654321, country: 'ZQ' },
    period: 'yearly',
    goalId: 'SECRET-GOAL',
    goalAmount: 55555.55,
    splitGroupId: 'SECRET-SPLIT',
    sharedWith: ['households/SECRET-HOUSEHOLD'],
  };
  return { ...row, ...overrides };
}

/** The value of every private field of fullRow(), as it would print. */
const SECRETS: readonly string[] = [
  'SECRET-NOTE', 'SECRET-RECEIPT', '777', 'SECRET-TAG', 'SECRET-RECURRING', 'SECRET-PLACE',
  '35.123456', '139.654321', '"ZQ"', 'yearly', 'SECRET-GOAL', '55555.55', 'SECRET-SPLIT',
  'SECRET-HOUSEHOLD', 'XAU', '987654.321', '23456.789', '1111111111', '1222222222',
];

/**
 * Every key projectRow must never output: each transaction field a household
 * must never see, the household-currency fields (hhCurrency, hhAmount) no
 * copy may carry, the row's id and userId (a copy names them sourceId and
 * memberUid), and the goalId and updatedAt a projection leaves to the copy's
 * writer.
 */
const PRIVATE_FIELDS: readonly string[] = [
  'id', 'userId', 'note', 'tags', 'location', 'receiptUrl', 'receiptUrls', 'receiptCount',
  'recurringId', 'isRecurring', 'splitGroupId', 'goalId', 'goalAmount', 'period',
  'baseCurrency', 'exchangeRate', 'amountInBaseCurrency', 'createdAt', 'updatedAt',
  'sharedWith', 'hhCurrency', 'hhAmount',
];

describe('ledger-projection.utils', () => {
  describe('bucketOf', () => {
    const CASES: readonly {
      name: string;
      categoryId: string;
      type: TransactionType;
      bucket: string;
      bucketGroup: string;
    }[] = [
      { name: 'a built-in group', categoryId: 'food', type: 'expense', bucket: 'food', bucketGroup: 'food' },
      { name: 'a built-in subcategory', categoryId: 'food_restaurants', type: 'expense',
        bucket: 'food_restaurants', bucketGroup: 'food' },
      { name: 'a built-in income subcategory', categoryId: 'employment_salary', type: 'income',
        bucket: 'employment_salary', bucketGroup: 'employment' },
      { name: 'a built-in, whatever the row\'s type', categoryId: 'food', type: 'income',
        bucket: 'food', bucketGroup: 'food' },
      { name: 'an overridden built-in, under its catalog group', categoryId: 'food_groceries', type: 'expense',
        bucket: 'food_groceries', bucketGroup: 'food' },
      { name: 'a soft-deleted built-in', categoryId: 'transport', type: 'expense',
        bucket: 'transport', bucketGroup: 'transport' },
      { name: 'a custom category under a built-in group', categoryId: 'cust_under_group', type: 'expense',
        bucket: 'food', bucketGroup: 'food' },
      { name: 'a custom category under a built-in subcategory', categoryId: 'cust_under_sub', type: 'expense',
        bucket: 'food_groceries', bucketGroup: 'food' },
      { name: 'a custom category two levels under a built-in', categoryId: 'cust_grandchild', type: 'expense',
        bucket: 'food', bucketGroup: 'food' },
      { name: 'a custom income category under a built-in', categoryId: 'cust_income_child', type: 'income',
        bucket: 'employment', bucketGroup: 'employment' },
      { name: 'a custom top-level expense category', categoryId: 'cust_top_expense', type: 'expense',
        bucket: 'other_expense', bucketGroup: 'other_expense' },
      { name: 'a custom top-level income category', categoryId: 'cust_top_income', type: 'income',
        bucket: 'other_income', bucketGroup: 'other_income' },
      { name: 'a custom category of both types on an income row', categoryId: 'cust_top_both', type: 'income',
        bucket: 'other_income', bucketGroup: 'other_income' },
      { name: 'a custom category of both types on an expense row', categoryId: 'cust_top_both', type: 'expense',
        bucket: 'other_expense', bucketGroup: 'other_expense' },
      { name: 'a missing category on an expense row', categoryId: 'deleted_category', type: 'expense',
        bucket: 'other_expense', bucketGroup: 'other_expense' },
      { name: 'a missing category on an income row', categoryId: 'deleted_category', type: 'income',
        bucket: 'other_income', bucketGroup: 'other_income' },
      { name: 'a parent cycle', categoryId: 'cust_cycle_a', type: 'expense',
        bucket: 'other_expense', bucketGroup: 'other_expense' },
      { name: 'a category that is its own parent', categoryId: 'cust_self', type: 'income',
        bucket: 'other_income', bucketGroup: 'other_income' },
      { name: 'a missing parent', categoryId: 'cust_orphan', type: 'expense',
        bucket: 'other_expense', bucketGroup: 'other_expense' },
    ];

    for (const { name, categoryId, type, bucket, bucketGroup } of CASES) {
      it(`maps ${name} to ${bucket} in ${bucketGroup}`, () => {
        expect(bucketOf(categoryId, MERGED, type)).toEqual({ bucket, bucketGroup });
      });
    }

    it('maps every built-in to itself, in its catalog group', () => {
      for (const category of defaultCategories()) {
        expect(bucketOf(category.id, MERGED, 'expense'))
          .withContext(category.id)
          .toEqual({ bucket: category.id, bucketGroup: category.parentId ?? category.id });
      }
    });

    it('knows a built-in the list it is handed does not hold', () => {
      expect(bucketOf('food_groceries', [], 'income')).toEqual({ bucket: 'food_groceries', bucketGroup: 'food' });
    });

    it('always answers with a built-in bucket in a top-level built-in group', () => {
      const builtIns = new Map(defaultCategories().map(category => [category.id, category]));

      for (const { categoryId, type } of CASES) {
        const { bucket, bucketGroup } = bucketOf(categoryId, MERGED, type);

        expect(builtIns.has(bucket)).withContext(categoryId).toBeTrue();
        expect(builtIns.has(bucketGroup)).withContext(categoryId).toBeTrue();
        expect(builtIns.get(bucketGroup)?.parentId).withContext(categoryId).toBeUndefined();
        expect(builtIns.get(bucket)?.parentId ?? bucket).withContext(categoryId).toBe(bucketGroup);
      }
    });
  });

  describe('projectRow', () => {
    it('holds only fields the copy may reveal', () => {
      const copy = projectRow(fullRow(), MERGED, GEN);

      for (const key of Object.keys(copy)) {
        expect(LEDGER_COPY_FIELDS as readonly string[]).withContext(key).toContain(key);
      }
      for (const field of PRIVATE_FIELDS) {
        expect(field in copy).withContext(field).toBeFalse();
      }
    });

    it('carries no private value, under any key', () => {
      const printed = JSON.stringify(projectRow(fullRow(), MERGED, GEN));

      for (const secret of SECRETS) {
        expect(printed).withContext(secret).not.toContain(secret);
      }
    });

    it('holds every required field but the stamp the writer adds, each set', () => {
      const copy = projectRow(fullRow(), MERGED, GEN);

      expect(Object.keys(copy).sort()).toEqual(LEDGER_REQUIRED_FIELDS.filter(field => field !== 'updatedAt').sort());
      for (const [key, value] of Object.entries(copy)) {
        expect(value).withContext(key).not.toBeUndefined();
      }
    });

    it('copies the revealed fields verbatim, so the rules\' equality with the source holds', () => {
      const row = fullRow({ type: 'income', categoryId: 'employment_salary', amount: 0.1 + 0.2 });
      const copy = projectRow(row, MERGED, GEN);

      expect(copy.type).toBe(row.type);
      expect(copy.amount).toBe(row.amount);
      expect(copy.currency).toBe(row.currency);
      expect(copy.date).toBe(row.date);
      expect(copy.description).toBe(row.description);
      expect(copy.categoryId).toBe(row.categoryId);
    });

    it('names the row\'s owner, the row, the generation and the projection version', () => {
      const copy = projectRow(fullRow({ id: 'tx9', userId: 'owner9' }), MERGED, GEN);

      expect(copy.memberUid).toBe('owner9');
      expect(copy.sourceId).toBe('tx9');
      expect(copy.gen).toBe(GEN);
      expect(copy.pv).toBe(LEDGER_PROJECTION_VERSION);
    });

    it('never carries the personal goal link, which is not the household\'s', () => {
      const copy: Partial<LedgerCopy> = projectRow(fullRow({ goalId: 'personal-goal' }), MERGED, GEN);

      expect('goalId' in copy).toBeFalse();
    });

    it('takes its bucket from bucketOf', () => {
      const copy = projectRow(fullRow({ categoryId: 'cust_under_sub' }), MERGED, GEN);

      expect({ bucket: copy.bucket, bucketGroup: copy.bucketGroup })
        .toEqual(bucketOf('cust_under_sub', MERGED, 'expense'));
    });

    const SNAPSHOTS: readonly {
      name: string;
      categoryId: string;
      type: TransactionType;
      merged: readonly Category[];
      category: LedgerCopy['category'];
    }[] = [
      { name: 'a built-in, as its translation key', categoryId: 'food_restaurants', type: 'expense', merged: MERGED,
        category: { name: 'categoryNames.restaurants', icon: 'restaurant', color: '#FF5722' } },
      { name: 'an overridden built-in, as the account stored it', categoryId: 'food_groceries', type: 'expense',
        merged: MERGED, category: { name: 'Supermarket', icon: 'shopping_cart', color: '#00FF00' } },
      { name: 'a custom category, as its own text', categoryId: 'cust_under_group', type: 'expense', merged: MERGED,
        category: { name: 'Farmers market', icon: 'star', color: '#123456' } },
      { name: 'a custom category with a broken parent, as itself', categoryId: 'cust_cycle_a', type: 'expense',
        merged: MERGED, category: { name: 'Custom', icon: 'star', color: '#123456' } },
      { name: 'a missing expense category, as the fallback built-in', categoryId: 'deleted_category',
        type: 'expense', merged: MERGED,
        category: { name: 'categoryNames.otherExpense', icon: 'more_horiz', color: '#9E9E9E' } },
      { name: 'a missing income category, as the fallback built-in', categoryId: 'deleted_category',
        type: 'income', merged: MERGED,
        category: { name: 'categoryNames.otherIncome', icon: 'attach_money', color: '#9C27B0' } },
      { name: 'a built-in the list does not hold, from the catalog', categoryId: 'food_groceries', type: 'expense',
        merged: [], category: { name: 'categoryNames.groceries', icon: 'shopping_cart', color: '#FF5722' } },
      { name: 'a missing category, as the account\'s override of the fallback', categoryId: 'deleted_category',
        type: 'expense',
        merged: mergeCategories(defaultCategories(), [{ ...builtIn('other_expense'), userId: 'u1', name: 'Misc' }]),
        category: { name: 'Misc', icon: 'more_horiz', color: '#9E9E9E' } },
    ];

    for (const { name, categoryId, type, merged, category } of SNAPSHOTS) {
      it(`snapshots ${name}`, () => {
        expect(projectRow(fullRow({ categoryId, type }), merged, GEN).category).toEqual(category);
      });
    }

    it('snapshots the category into an object of its own', () => {
      const first = projectRow(fullRow({ categoryId: 'food_restaurants' }), MERGED, GEN);
      first.category.name = 'changed';

      expect(projectRow(fullRow({ categoryId: 'food_restaurants' }), MERGED, GEN).category.name)
        .toBe('categoryNames.restaurants');
      expect(MERGED.find(category => category.id === 'food_restaurants')?.name).toBe('categoryNames.restaurants');
    });

    it('changes neither the row nor the categories', () => {
      const row = fullRow();
      const rowBefore = JSON.stringify(row);
      const mergedBefore = JSON.stringify(MERGED);

      projectRow(row, MERGED, GEN);

      expect(JSON.stringify(row)).toBe(rowBefore);
      expect(JSON.stringify(MERGED)).toBe(mergedBefore);
    });
  });

  describe('copyDiffers', () => {
    const base = (): LedgerCopyProjection => projectRow(fullRow(), MERGED, GEN);

    it('finds nothing between two projections of the same row', () => {
      expect(copyDiffers(base(), base())).toBeFalse();
    });

    it('finds nothing when the stored copy reads back as other instances of the same values', () => {
      const next = base();
      const stored: LedgerCopy = {
        ...next,
        gen: Timestamp.fromMillis(next.gen.toMillis()),
        date: new Timestamp(next.date.seconds, next.date.nanoseconds),
        category: { ...next.category },
        updatedAt: Timestamp.fromMillis(1_800_000_000_000),
      };

      expect(copyDiffers(stored, next)).toBeFalse();
    });

    it('ignores the household goal link and the stamp', () => {
      const next = base();

      expect(copyDiffers({ ...next, goalId: 'hg1', updatedAt: Timestamp.fromMillis(1) }, next)).toBeFalse();
      expect(copyDiffers({ ...next, goalId: 'hg1' }, { ...next })).toBeFalse();
    });

    it('differs from no copy at all', () => {
      expect(copyDiffers(null, base())).toBeTrue();
      expect(copyDiffers(undefined, base())).toBeTrue();
    });

    const next = base();
    /** One change to each projected field but the version, which the version tables below vary. */
    const CHANGES: readonly { field: keyof LedgerCopyProjection; value: unknown; name: string }[] = [
      { field: 'memberUid', value: 'u2', name: 'another author' },
      { field: 'sourceId', value: 'tx2', name: 'another row' },
      { field: 'gen', value: Timestamp.fromMillis(GEN.toMillis() + 1000), name: 'another generation' },
      { field: 'type', value: 'income', name: 'another type' },
      { field: 'amount', value: 42.51, name: 'another amount' },
      { field: 'currency', value: 'USD', name: 'another currency' },
      { field: 'date', value: Timestamp.fromMillis(next.date.toMillis() + 86_400_000), name: 'another day' },
      { field: 'date', value: new Timestamp(next.date.seconds, next.date.nanoseconds + 1), name: 'a nanosecond later' },
      { field: 'description', value: 'Weekly shop!', name: 'another description' },
      { field: 'categoryId', value: 'food_groceries', name: 'another category' },
      { field: 'category', value: { ...next.category, name: 'Renamed' }, name: 'a renamed category' },
      { field: 'category', value: { ...next.category, icon: 'star' }, name: 'another icon' },
      { field: 'category', value: { ...next.category, color: '#000000' }, name: 'another colour' },
      { field: 'bucket', value: 'food', name: 'another bucket' },
      { field: 'bucketGroup', value: 'shopping', name: 'another bucket group' },
    ];

    for (const { field, value, name } of CHANGES) {
      it(`finds ${name}`, () => {
        const previous = { ...next, [field]: value } as LedgerCopyProjection;

        expect(copyDiffers(previous, next)).toBeTrue();
        expect(copyDiffers(next, previous)).toBeTrue();
      });
    }

    it('compares every field of a copy but the goal link and the stamp', () => {
      const compared = new Set<string>([...CHANGES.map(change => change.field), 'pv']);

      expect([...compared].sort())
        .toEqual(LEDGER_COPY_FIELDS.filter(field => field !== 'goalId' && field !== 'updatedAt').sort());
    });

    it('differs from a stored copy that lacks a field', () => {
      const stored: Partial<LedgerCopy> = { ...next };
      delete stored.bucketGroup;

      expect(copyDiffers(stored, next)).toBeTrue();
    });

    const NOT_NEWER: readonly { name: string; pv: unknown }[] = [
      { name: 'an older projection version', pv: LEDGER_PROJECTION_VERSION - 1 },
      { name: 'no projection version', pv: undefined },
      { name: 'a projection version that is not a number', pv: String(LEDGER_PROJECTION_VERSION + 1) },
    ];

    for (const { name, pv } of NOT_NEWER) {
      it(`differs from a copy of ${name}, even when every other field matches`, () => {
        expect(copyDiffers({ ...next, pv } as Partial<LedgerCopy>, next)).toBeTrue();
      });
    }

    describe('against a copy a newer projection version wrote', () => {
      const newer = (change: Partial<LedgerCopyProjection> = {}): LedgerCopyProjection =>
        ({ ...next, ...change, pv: LEDGER_PROJECTION_VERSION + 1 });

      /** What a projection derives rather than copies, and so may derive its own way in a later version. */
      const DERIVED: readonly (keyof LedgerCopyProjection)[] = ['category', 'bucket', 'bucketGroup'];

      it('finds nothing while the row\'s own fields match', () => {
        expect(copyDiffers(newer(), next)).toBeFalse();
      });

      it('finds nothing when it snapshots and buckets the category its own way', () => {
        const stored = newer({ category: { name: 'Food shop', icon: 'store', color: '#010203' },
          bucket: 'food', bucketGroup: 'shopping' });

        expect(copyDiffers(stored, next)).toBeFalse();
      });

      for (const { field, value, name } of CHANGES) {
        const derived = DERIVED.includes(field);

        it(derived ? `leaves ${name} to the newer projection` : `still finds ${name}`, () => {
          expect(copyDiffers(newer({ [field]: value } as Partial<LedgerCopyProjection>), next)).toBe(!derived);
        });
      }
    });
  });

  describe('normalizeShares', () => {
    const CASES: readonly { name: string; sharedWith: readonly unknown[] | null | undefined; ids: string[] }[] = [
      { name: 'no field', sharedWith: undefined, ids: [] },
      { name: 'null', sharedWith: null, ids: [] },
      { name: 'an empty list', sharedWith: [], ids: [] },
      { name: 'household keys, in order', sharedWith: ['households/b', 'households/a'], ids: ['b', 'a'] },
      { name: 'a repeated key, kept where it first appears',
        sharedWith: ['households/b', 'households/a', 'households/b'], ids: ['b', 'a'] },
      { name: 'keys of other shapes, dropped',
        sharedWith: ['groups/g1', 'households/a', '', 'households/', 'households/x/y', 'a'], ids: ['a'] },
      { name: 'entries that are not strings, dropped', sharedWith: [null, 42, { id: 'x' }, 'households/a'], ids: ['a'] },
    ];

    for (const { name, sharedWith, ids } of CASES) {
      it(`reads ${name}`, () => {
        expect(normalizeShares(sharedWith as string[] | null | undefined)).toEqual(ids);
      });
    }

    it('reads a value that is not a list as no shares', () => {
      expect(normalizeShares('households/a' as unknown as string[])).toEqual([]);
    });

    it('leaves its input as it was', () => {
      const sharedWith = ['households/b', 'households/b', 'groups/g'];

      normalizeShares(sharedWith);

      expect(sharedWith).toEqual(['households/b', 'households/b', 'groups/g']);
    });
  });
});
