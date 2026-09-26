import { Timestamp } from '@angular/fire/firestore';
import {
  Category,
  LEDGER_COPY_FIELDS,
  LEDGER_PROJECTION_VERSION,
  LEDGER_SNAPSHOT_MAX_LENGTH,
  LedgerCopy,
  LedgerCopyProjection,
  Transaction,
  TransactionType,
  householdOfShareKey,
} from '../../models';
import { defaultCategories } from './category-merge.utils';
import { fallbackCategoryFor } from './categorization.utils';

/** Where a row counts in a household budget: see LedgerCopy.bucket. */
export interface LedgerBucket {
  bucket: string;
  bucketGroup: string;
}

/** What projectRow reads of a row: its identity and the fields a copy reveals. */
export type ProjectableRow = Pick<
  Transaction,
  'id' | 'userId' | 'type' | 'amount' | 'currency' | 'date' | 'description' | 'categoryId'
>;

interface Catalog {
  byId: ReadonlyMap<string, Category>;
  fallback: Readonly<Record<TransactionType, Category>>;
}

let catalog: Catalog | null = null;

/**
 * The built-ins by id, built once. Only read here: every snapshot copies its
 * fields out, so no caller is handed a catalog row.
 */
function builtIns(): Catalog {
  if (!catalog) {
    const byId = new Map(defaultCategories().map(category => [category.id, category]));
    const fallbackOf = (type: TransactionType): Category => {
      const id = fallbackCategoryFor(type);
      const row = byId.get(id);
      if (!row) throw new Error(`The built-in categories hold no ${id}`);
      return row;
    };
    catalog = { byId, fallback: { expense: fallbackOf('expense'), income: fallbackOf('income') } };
  }
  return catalog;
}

function indexById(categories: readonly Category[]): ReadonlyMap<string, Category> {
  return new Map(categories.map(category => [category.id, category]));
}

/**
 * The built-in a category counts under. A built-in id counts as itself,
 * whatever an override stored for it; any other id climbs its parents through
 * the account's categories to the nearest built-in. A missing category, a
 * missing parent, a cycle or a custom top-level category counts as the row
 * type's catch-all.
 */
function bucketCategory(
  categoryId: string,
  byId: ReadonlyMap<string, Category>,
  type: TransactionType
): Category {
  const { byId: builtInById, fallback } = builtIns();
  const seen = new Set<string>();
  let id: string | undefined = categoryId;
  while (id !== undefined && !seen.has(id)) {
    const builtIn = builtInById.get(id);
    if (builtIn) return builtIn;
    seen.add(id);
    id = byId.get(id)?.parentId;
  }
  return fallback[type];
}

function bucketFromBuiltIn(builtIn: Category): LedgerBucket {
  // A built-in's group is the catalog's, never an override's stored parent:
  // a household budget names catalog ids.
  return { bucket: builtIn.id, bucketGroup: builtIn.parentId ?? builtIn.id };
}

/**
 * Where a row in this category counts in a household budget: the built-in
 * category it maps to and that built-in's top-level group. `type` is the
 * row's own, which picks the catch-all when the category leads to no
 * built-in; a custom category may be of either type, and a missing one has
 * none.
 */
export function bucketOf(
  categoryId: string,
  mergedCategories: readonly Category[],
  type: TransactionType
): LedgerBucket {
  return bucketFromBuiltIn(bucketCategory(categoryId, indexById(mergedCategories), type));
}

/**
 * `text` cut to at most `max` UTF-16 code units, whole characters only, so
 * no surrogate pair is split and the cut is the same on every projection.
 */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = '';
  for (const character of text) {
    if (cut.length + character.length > max) break;
    cut += character;
  }
  return cut;
}

/**
 * The copy of a row, as a household sees it, without the stamp the writer
 * has the server add. The revealed fields are the row's own values, not
 * converted or rebuilt, because the rules compare each with the source row.
 *
 * The author is the row's owner (`userId`): the rules place the source row
 * under the author's own transactions, so no other account can write a copy
 * of it.
 *
 * The category is snapshotted from `mergedCategories` (the built-ins
 * overlaid with the account's own, mergeCategories): a built-in's name stays
 * its translation key so each viewer reads it in their language, and a
 * custom category's is the author's text. A category the list does not hold
 * is shown as the built-in it counts under. Each string is cut to
 * LEDGER_SNAPSHOT_MAX_LENGTH, the bound the rules hold a snapshot to.
 */
export function projectRow(
  row: ProjectableRow,
  mergedCategories: readonly Category[],
  gen: Timestamp
): LedgerCopyProjection {
  const byId = indexById(mergedCategories);
  const builtIn = bucketCategory(row.categoryId, byId, row.type);
  const shown = byId.get(row.categoryId) ?? byId.get(builtIn.id) ?? builtIn;
  return {
    memberUid: row.userId,
    sourceId: row.id,
    gen,
    pv: LEDGER_PROJECTION_VERSION,
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    description: row.description,
    categoryId: row.categoryId,
    category: {
      name: clampText(shown.name, LEDGER_SNAPSHOT_MAX_LENGTH.name),
      icon: clampText(shown.icon, LEDGER_SNAPSHOT_MAX_LENGTH.icon),
      color: clampText(shown.color, LEDGER_SNAPSHOT_MAX_LENGTH.color),
    },
    ...bucketFromBuiltIn(builtIn),
  };
}

/** Every copy field a projection decides; the goal link and the stamp are not the row's. */
const PROJECTED_FIELDS = LEDGER_COPY_FIELDS.filter(
  (field): field is keyof LedgerCopyProjection => field !== 'goalId' && field !== 'updatedAt'
);

/**
 * The projected fields every projection version sets alike: the copy's
 * author, row and generation, and the revealed fields the rules hold equal to
 * the row's. The category snapshot and the bucket are derived, so a later
 * version may derive them its own way.
 */
const VERSION_INDEPENDENT_FIELDS = [
  'memberUid', 'sourceId', 'gen',
  'type', 'amount', 'currency', 'date', 'description', 'categoryId',
] as const satisfies readonly (keyof LedgerCopyProjection)[];

/**
 * Told apart and compared as household.service.ts judges a membership's
 * stamps, so a copy's generation and a membership's are equal by one test.
 */
function isStamp(value: unknown): value is Timestamp {
  return !!value && typeof (value as Timestamp).toMillis === 'function';
}

function sameStamp(a: unknown, b: unknown): boolean {
  return isStamp(a) && isStamp(b) && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
}

/**
 * Equal as Firestore stores them. A copy read back holds other Timestamp and
 * map instances than a fresh projection, so instants compare by value and
 * maps and lists by their entries.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isStamp(a) || isStamp(b)) return sameStamp(a, b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((item, index) => sameValue(item, b[index]));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => sameValue(left[key], right[key]));
  }
  return false;
}

/**
 * Whether a copy has to be rewritten to match its row's projection. No copy
 * at all differs, and so does one an older projection version wrote (or one
 * with no version), whatever its fields hold. A copy of this version differs
 * when any projected field does; the household goal link and the stamp never
 * count, since a projection never sets them.
 *
 * A copy a newer version wrote differs only when a field every version sets
 * alike does (VERSION_INDEPENDENT_FIELDS): its category snapshot and bucket
 * are left as that version derived them, so two builds of one account never
 * rewrite each other's copies back and forth.
 */
export function copyDiffers(
  previous: Partial<LedgerCopy> | null | undefined,
  next: LedgerCopyProjection
): boolean {
  if (!previous) return true;
  if (typeof previous.pv !== 'number' || previous.pv < next.pv) return true;
  const fields = previous.pv > next.pv ? VERSION_INDEPENDENT_FIELDS : PROJECTED_FIELDS;
  return fields.some(field => !sameValue(previous[field], next[field]));
}

/**
 * The households a row's `sharedWith` names, each once, in the order they
 * first appear. A key of another kind, and anything that is not a key, is
 * left out: the field is stored data.
 */
export function normalizeShares(sharedWith: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(sharedWith)) return [];
  const ids: string[] = [];
  for (const key of sharedWith) {
    const id = householdOfShareKey(key);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
