import {
  CLEANUP_BATCH_SIZE,
  DeletedDocument,
  Equality,
  MemberGuard,
  Sweep,
  isTransientError,
  memberReturned,
  planCleanup,
} from './household-ledger-cleanup';

/**
 * The cleanup triggers' body, with every read and delete injected, so a unit
 * test drives each branch over fakes. The Admin SDK deps are
 * ./household-ledger-cleanup-admin-deps, and index.ts only wires them in.
 * What is deleted is decided in ./household-ledger-cleanup.
 *
 * Both triggers are delivered again after a failure (retry: true), so every
 * step may run twice or be cut off anywhere: each sweep lists what is left
 * and deletes that, and a delete of a document already gone is no error.
 */

export interface CleanupLog {
  info(message: string, context: Record<string, unknown>): void;
  warn(message: string, context: Record<string, unknown>): void;
  error(message: string, error: unknown, context: Record<string, unknown>): void;
}

export interface HouseholdLedgerCleanupDeps {
  /**
   * The paths of at most `limit` documents directly in `collection` whose
   * fields equal each of `where`, filtered by the query, in the order given.
   */
  find(collection: string, where: readonly Equality[], limit: number): Promise<string[]>;
  /**
   * Every document id in `collection`, one whose document is gone but still
   * has documents under it included.
   */
  childIds(collection: string): Promise<string[]>;
  /** The member document's `since` as stored now; undefined when there is none. */
  memberSince(householdId: string, uid: string): Promise<unknown>;
  /** Deletes each path, in commits of at most CLEANUP_BATCH_SIZE. */
  remove(paths: readonly string[]): Promise<void>;
  log: CleanupLog;
}

export interface CleanupResult {
  /**
   * swept: everything planned is gone (a re-delivery sweeps nothing and says
   * so too); member-back: the member rejoined the generation, so the rest of
   * its copies stay; skipped: no generation to sweep; failed: a permanent
   * failure, logged.
   */
  outcome: 'swept' | 'member-back' | 'skipped' | 'failed';
  /** Documents deleted by this delivery. */
  deleted: number;
}

/** Thrown to end the sweep once the guarded member is back. */
class MemberBack {}

function contextOf(deleted: DeletedDocument): Record<string, unknown> {
  return deleted.kind === 'member'
    ? { trigger: 'member', householdId: deleted.householdId, uid: deleted.uid }
    : { trigger: 'household', householdId: deleted.householdId };
}

export async function handleHouseholdLedgerCleanup(
  deps: HouseholdLedgerCleanupDeps,
  deleted: DeletedDocument
): Promise<CleanupResult> {
  const context = contextOf(deleted);
  const plan = planCleanup(deleted);
  if (plan.kind === 'skip') {
    deps.log.warn('household cleanup skipped: the deleted document names no generation', {
      ...context,
      reason: plan.reason,
    });
    return { outcome: 'skipped', deleted: 0 };
  }

  const tally = { deleted: 0 };
  try {
    for (const sweep of plan.sweeps) await run(deps, sweep, plan.unlessMember, tally);
  } catch (error) {
    if (error instanceof MemberBack) {
      deps.log.info('household cleanup stopped: the member is back in the same generation', {
        ...context,
        deleted: tally.deleted,
      });
      return { outcome: 'member-back', deleted: tally.deleted };
    }
    if (isTransientError(error)) {
      // Rethrown, so the event is delivered again and the sweep resumes from
      // what is left.
      deps.log.warn('household cleanup interrupted; it runs again on the next delivery', {
        ...context,
        deleted: tally.deleted,
        code: (error as { code: number }).code,
      });
      throw error;
    }
    // Let go: a retry would meet the same refusal for the whole retry window.
    // The error goes positionally so the logger keeps its stack.
    deps.log.error('household cleanup failed', error, { ...context, deleted: tally.deleted });
    return { outcome: 'failed', deleted: tally.deleted };
  }

  if (tally.deleted > 0) {
    deps.log.info('household cleanup swept what was left', { ...context, deleted: tally.deleted });
  }
  return { outcome: 'swept', deleted: tally.deleted };
}

async function run(
  deps: HouseholdLedgerCleanupDeps,
  sweep: Sweep,
  guard: MemberGuard | undefined,
  tally: { deleted: number }
): Promise<void> {
  if (sweep.kind === 'where') {
    await sweepWhere(deps, sweep.collection, sweep.where, guard, tally);
    return;
  }
  for (const id of await deps.childIds(sweep.parent)) {
    await sweepWhere(deps, `${sweep.parent}/${id}/${sweep.child}`, sweep.where, guard, tally);
  }
}

/**
 * Lists a page, deletes it and lists again, until a page comes back short.
 * The guard is read after each listing and before its delete, as the app's
 * own purge reads it before each commit.
 */
async function sweepWhere(
  deps: HouseholdLedgerCleanupDeps,
  collection: string,
  where: readonly Equality[],
  guard: MemberGuard | undefined,
  tally: { deleted: number }
): Promise<void> {
  const removed = new Set<string>();
  for (;;) {
    const page = await deps.find(collection, where, CLEANUP_BATCH_SIZE);
    if (page.length === 0) return;
    // Read before the check below: a member back in the generation may have
    // shared a swept row again, whose copy takes the same path.
    if (guard && memberReturned(guard, await deps.memberSince(guard.householdId, guard.uid))) {
      throw new MemberBack();
    }
    // Every page is listed after the last one's delete answered, so a path
    // seen again, with nobody back to write it, means the deletes are not
    // landing; listing on would never end.
    if (page.some(path => removed.has(path))) {
      throw new Error(`${collection} still lists documents this sweep deleted`);
    }
    await deps.remove(page);
    tally.deleted += page.length;
    for (const path of page) removed.add(path);
    if (page.length < CLEANUP_BATCH_SIZE) return;
  }
}
