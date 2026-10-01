/**
 * What the two cleanup triggers delete when a household's member document or
 * the household itself is deleted, decided from the deleted document alone.
 * No I/O and nothing from an SDK: the handler
 * (./household-ledger-cleanup-handler) runs a plan over injected reads and
 * deletes, and the Admin deps (./household-ledger-cleanup-admin-deps) make
 * them — the invite callable's split.
 *
 * Both triggers are backstops. The app's own paths take a member's shared
 * copies out when it leaves or is removed, and a household's plans out when
 * it is dissolved. These finish what an interrupted run leaves behind: the
 * copies an owner's purge after a removal did not reach, which any member can
 * still list until they go, and whatever stays under a dissolved household
 * whose authors never come back to clear it.
 *
 * Every sweep is held to the deleted document's generation, the household's
 * `createdAt` it names, as every list the app makes is. Nothing of another
 * generation under the same id is reached, which a recursive delete of the
 * household's path could not promise.
 */

import { Stamp, StoredDoc, sameStamp, stampOf } from './household-invite';

/** The generation a copy, a budget, a goal and a contribution carry. */
export const GENERATION_FIELD = 'gen';

/** A copy's author. */
export const COPY_MEMBER_FIELD = 'memberUid';

/** A member document's generation: the household's `createdAt` it joined. */
export const MEMBER_GENERATION_FIELD = 'since';

/** A household's own generation: the time of its create. */
export const HOUSEHOLD_GENERATION_FIELD = 'createdAt';

/**
 * Documents listed per query, and so deleted per commit: a commit holds at
 * most 500 writes.
 */
export const CLEANUP_BATCH_SIZE = 500;

/**
 * The gRPC statuses a later delivery can outlast: an overloaded or
 * unreachable backend, a deadline, a contended commit, the server's own
 * failure. Any other status (a refusal, a missing index, a bad argument)
 * answers a retry the same way for the whole retry window, so it is logged
 * and the event let go.
 */
const TRANSIENT_CODES: ReadonlySet<number> = new Set([
  1, // CANCELLED
  2, // UNKNOWN
  4, // DEADLINE_EXCEEDED
  8, // RESOURCE_EXHAUSTED
  10, // ABORTED
  13, // INTERNAL
  14, // UNAVAILABLE
]);

export interface Equality {
  readonly field: string;
  readonly value: unknown;
}

export type Sweep =
  /** Every document of `collection` whose fields hold each of `where`. */
  | { readonly kind: 'where'; readonly collection: string; readonly where: readonly Equality[] }
  /**
   * The same, in the `child` collection under every document id of
   * `parent`, one whose own document is already gone included: a goal's
   * delete never reaches its contributions, which a later commit clears, and
   * a run cut off between the two leaves them under a goal no query finds.
   */
  | {
      readonly kind: 'nested';
      readonly parent: string;
      readonly child: string;
      readonly where: readonly Equality[];
    };

/** The deleted document as its trigger delivers it: the path's ids and the data it last held. */
export type DeletedDocument =
  | {
      readonly kind: 'member';
      readonly householdId: string;
      readonly uid: string;
      readonly data: StoredDoc;
    }
  | { readonly kind: 'household'; readonly householdId: string; readonly data: StoredDoc };

/**
 * The member whose copies a sweep deletes, in the generation it left. A
 * member removed and invited back joins the same generation again (an invite
 * admits to the household's createdAt), and its copies from then on are as
 * live as anyone's; with retries a delivery can arrive after that.
 */
export interface MemberGuard {
  readonly householdId: string;
  readonly uid: string;
  readonly generation: Stamp;
}

export type CleanupPlan =
  | { readonly kind: 'skip'; readonly reason: 'no-document' | 'no-generation' }
  | {
      readonly kind: 'sweep';
      /** In order: whatever sits under a document goes before the document. */
      readonly sweeps: readonly Sweep[];
      /** Stops the sweep before any page is deleted once this member is back. */
      readonly unlessMember?: MemberGuard;
    };

/**
 * The stored Timestamp itself, untouched, so a query compares it exactly;
 * null for anything else. A map with numeric seconds and nanoseconds is not
 * one: a stored Timestamp comes back from the SDK as an object with methods,
 * and no document of a generation holds a map where its stamp belongs.
 */
export function generationOf(value: unknown): Stamp | null {
  const stamp = stampOf(value);
  if (!stamp) return null;
  return typeof (stamp as { toMillis?: unknown }).toMillis === 'function' ? stamp : null;
}

export function planCleanup(deleted: DeletedDocument): CleanupPlan {
  if (!deleted.data) return { kind: 'skip', reason: 'no-document' };
  const field = deleted.kind === 'member' ? MEMBER_GENERATION_FIELD : HOUSEHOLD_GENERATION_FIELD;
  const generation = generationOf(deleted.data[field]);
  if (!generation) return { kind: 'skip', reason: 'no-generation' };

  const household = `households/${deleted.householdId}`;
  const ofGeneration: Equality[] = [{ field: GENERATION_FIELD, value: generation }];

  if (deleted.kind === 'member') {
    return {
      kind: 'sweep',
      // The member's copies only, in the order of the (gen, memberUid)
      // composite the app's own purge lists them by. Its rows are its own:
      // taking the household's key off them is its client's job.
      sweeps: [
        {
          kind: 'where',
          collection: `${household}/ledger`,
          where: [...ofGeneration, { field: COPY_MEMBER_FIELD, value: deleted.uid }],
        },
      ],
      unlessMember: { householdId: deleted.householdId, uid: deleted.uid, generation },
    };
  }

  return {
    kind: 'sweep',
    sweeps: [
      { kind: 'where', collection: `${household}/ledger`, where: ofGeneration },
      { kind: 'where', collection: `${household}/budgets`, where: ofGeneration },
      { kind: 'nested', parent: `${household}/goals`, child: 'contributions', where: ofGeneration },
      { kind: 'where', collection: `${household}/goals`, where: ofGeneration },
      // Last: each member document's delete fires the member trigger, which
      // then finds its copies already gone.
      {
        kind: 'where',
        collection: `${household}/members`,
        where: [{ field: MEMBER_GENERATION_FIELD, value: generation }],
      },
    ],
  };
}

/** Whether the member document, read now, holds the guarded member again in the same generation. */
export function memberReturned(guard: MemberGuard, since: unknown): boolean {
  return sameStamp(generationOf(since), guard.generation);
}

/** Whether a later delivery of the event may succeed where this one failed. */
export function isTransientError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'number' && TRANSIENT_CODES.has(code);
}
