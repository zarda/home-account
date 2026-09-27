import { StoredDoc } from './household-invite';
import { DeletedDocument } from './household-ledger-cleanup';

/**
 * What the cleanup triggers read from a Firestore document-deleted event: the
 * wildcards of the document path and the snapshot of the document as it was
 * last stored. Structural rather than the SDK's event type, so a unit test
 * builds one without the Functions runtime; index.ts hands the SDK's event
 * straight in.
 */
export interface DeletedDocumentEvent<Params> {
  readonly params: Params;
  /** Undefined when the event carries no snapshot, which the cleanup skips. */
  readonly data?: { data(): StoredDoc } | undefined;
}

/** A delete of households/{householdId}/members/{uid}, as the cleanup's input. */
export function deletedMember(
  event: DeletedDocumentEvent<{ readonly householdId: string; readonly uid: string }>
): DeletedDocument {
  return {
    kind: 'member',
    householdId: event.params.householdId,
    uid: event.params.uid,
    data: event.data?.data(),
  };
}

/**
 * A delete of households/{householdId}, as the cleanup's input.
 *
 * `uid` is refused because a member delete's params are a superset of these:
 * without it the member trigger could hand its event here and compile, and
 * every member delete would be read as a household's, find no `createdAt` and
 * be skipped as 'no-generation'.
 */
export function deletedHousehold(
  event: DeletedDocumentEvent<{ readonly householdId: string; readonly uid?: never }>
): DeletedDocument {
  return { kind: 'household', householdId: event.params.householdId, data: event.data?.data() };
}
