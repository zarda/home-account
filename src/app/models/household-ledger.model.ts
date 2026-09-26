import { Timestamp } from '@angular/fire/firestore';
import { TransactionType } from './transaction.model';

/**
 * The category a copy shows, as its author's app held it when the copy was
 * written. The viewer renders `name` through the translation service, so a
 * built-in reads in the viewer's language and a custom category as typed.
 */
export interface LedgerCategorySnapshot {
  /** A translation key for a built-in; the author's own text for a custom category. */
  name: string;
  icon: string;
  color: string;
}

/**
 * households/{householdId}/ledger/{ledgerCopyId(memberUid, sourceId)}: what
 * a household sees of one row a member shares into it, and nothing more. The
 * revealed fields equal the source row's as its author's commit leaves it,
 * which the rules check against the row itself; the rest identify the copy,
 * snapshot its category and key it for the household's budgets.
 *
 * Everything else a transaction holds stays with its owner: the note,
 * receipts, tags, location, recurring and split links, the personal goal link
 * and the base-currency snapshot.
 */
export interface LedgerCopy {
  /** The row's owner, and the copy's only writer. */
  memberUid: string;
  /** The row's id under users/{memberUid}/transactions. */
  sourceId: string;
  /**
   * The household's `createdAt` when the copy was written. Members read only
   * copies of the live generation, so a household formed again under the same
   * id shows none of the dissolved one's.
   */
  gen: Timestamp;
  /** LEDGER_PROJECTION_VERSION of the app that wrote the copy. */
  pv: number;
  type: TransactionType;
  /** In `currency`, as entered; each viewer converts it at today's rate. */
  amount: number;
  currency: string;
  date: Timestamp;
  description: string;
  categoryId: string;
  category: LedgerCategorySnapshot;
  /**
   * The built-in category the row counts under in a household budget: the
   * row's own when it is a built-in, else its nearest built-in ancestor, else
   * the type's catch-all (bucketOf in ledger-projection.utils.ts).
   */
  bucket: string;
  /** The top-level built-in group `bucket` belongs to. */
  bucketGroup: string;
  /**
   * The household goal this copy counts toward. Set and cleared only by its
   * author's explicit link, never by a projection, and never the row's
   * personal goal.
   */
  goalId?: string;
  /** The server's time of the last write. */
  updatedAt: Timestamp;
}

/**
 * A copy's content as the row determines it: everything but the household goal
 * link, which only its author's link sets, and the stamp, which the server
 * sets as the copy is written.
 */
export type LedgerCopyProjection = Omit<LedgerCopy, 'goalId' | 'updatedAt'>;

/**
 * Every field a copy may hold. The rules' hasOnly on a copy holds the same
 * list, and the ledger contract check fails when the two differ.
 */
export const LEDGER_COPY_FIELDS = [
  'memberUid', 'sourceId', 'gen', 'pv',
  'type', 'amount', 'currency', 'date', 'description', 'categoryId',
  'category', 'bucket', 'bucketGroup',
  'goalId', 'updatedAt',
] as const satisfies readonly (keyof LedgerCopy)[];

/** Every field a copy must hold: all but the household goal link. */
export const LEDGER_REQUIRED_FIELDS = [
  'memberUid', 'sourceId', 'gen', 'pv',
  'type', 'amount', 'currency', 'date', 'description', 'categoryId',
  'category', 'bucket', 'bucketGroup',
  'updatedAt',
] as const satisfies readonly (keyof LedgerCopy)[];

/**
 * The version of the projection a copy was written by. Raising it makes every
 * copy an older version wrote differ from its row's projection (copyDiffers),
 * so the next full pass rewrites each one. A copy a newer version wrote keeps
 * that version's category snapshot and bucket, so a build rolled back leaves
 * them as they are: a projection is corrected by raising the version again,
 * never by lowering it.
 */
export const LEDGER_PROJECTION_VERSION = 1;

/**
 * Copy creates and updates per commit. The rules look up three documents for
 * each (the household, the author's member document and the source row as
 * the commit leaves it), and a commit may make at most 20 lookups.
 */
export const LEDGER_COMMIT_CHUNK = 5;

/**
 * An owner's deletes of other members' copies per commit, one lookup (the
 * household) each.
 */
export const LEDGER_PURGE_CHUNK = 10;

/**
 * Writes per commit that the rules judge without a lookup: an author's deletes
 * of its own copies and the arrayUnion/arrayRemove on its own rows. Under the
 * 500 writes a commit may hold.
 */
export const LEDGER_OWN_WRITE_CHUNK = 450;

/** The most copies the household view reads for one household and window. */
export const LEDGER_VIEW_CAP = 2000;

/** The most rows one bulk share or unshare takes. */
export const MAX_BULK_SHARE = 500;

/**
 * How often each membership's copies are diffed in full against the rows
 * that name it. The journal of pending copy writes lives on one device and
 * is lost with its site data, so this pass is what bounds a copy's drift.
 */
export const FULL_SWEEP_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const SHARE_KEY_PREFIX = 'households/';

/**
 * The key a row's `sharedWith` holds for a household. Namespaced so another
 * kind of share target can be added beside households without a migration.
 * A row holds at most MAX_HOUSEHOLDS_PER_ACCOUNT keys (household.model.ts),
 * one for each household its account can belong to.
 */
export function shareKey(householdId: string): string {
  return SHARE_KEY_PREFIX + householdId;
}

/**
 * The household a share key names, or null for anything that is not one: a
 * key of another namespace, a malformed key, or a value that is not a string
 * (sharedWith is stored data). The id must be one Firestore accepts as a
 * document id.
 */
export function householdOfShareKey(key: unknown): string | null {
  if (typeof key !== 'string' || !key.startsWith(SHARE_KEY_PREFIX)) return null;
  const id = key.slice(SHARE_KEY_PREFIX.length);
  if (id === '' || id === '.' || id === '..' || id.includes('/') || /^__.*__$/.test(id)) return null;
  return id;
}

/**
 * A copy's document id. The rules take the author of a copy that does not
 * exist from the part of its id before the first underscore, so an account
 * id holding one would be judged as another account; neither part may hold a
 * slash, which would change the path. Throws for such an id, or an empty
 * part, rather than name a copy the rules would judge as another's.
 */
export function ledgerCopyId(uid: string, txId: string): string {
  if (!uid || uid.includes('_') || uid.includes('/')) {
    throw new Error(`No ledger copy id for the account id "${uid}"`);
  }
  if (!txId || txId.includes('/')) {
    throw new Error(`No ledger copy id for the row id "${txId}"`);
  }
  return `${uid}_${txId}`;
}
