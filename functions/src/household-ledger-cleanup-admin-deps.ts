import type { Firestore, Query } from 'firebase-admin/firestore';

import { CLEANUP_BATCH_SIZE, MEMBER_GENERATION_FIELD } from './household-ledger-cleanup';
import type { CleanupLog, HouseholdLedgerCleanupDeps } from './household-ledger-cleanup-handler';

export interface HouseholdLedgerCleanupAdminWiring {
  firestore: Firestore;
  log: CleanupLog;
}

/**
 * The Admin SDK behind the cleanup handler. What is deleted is decided in
 * ./household-ledger-cleanup; each dep here only lists, reads or deletes. The
 * Firestore handle comes in as an argument so a test can record how each
 * query and commit is made, which the handler's own fakes never see.
 */
export function householdLedgerCleanupAdminDeps({
  firestore,
  log,
}: HouseholdLedgerCleanupAdminWiring): HouseholdLedgerCleanupDeps {
  return {
    // Equalities in the order given, which the plan takes from the composite
    // that serves them. select() with no field lists references only: a
    // delete needs nothing of a document's data.
    find: async (collection, where, limit) => {
      let query: Query = firestore.collection(collection);
      for (const { field, value } of where) query = query.where(field, '==', value);
      const listed = await query.limit(limit).select().get();
      return listed.docs.map(doc => doc.ref.path);
    },

    // listDocuments, not a query: a goal deleted before its contributions has
    // no document for a query to find, and its id is still listed while
    // anything sits under it.
    childIds: async collection =>
      (await firestore.collection(collection).listDocuments()).map(ref => ref.id),

    memberSince: async (householdId, uid) => {
      const member = await firestore.doc(`households/${householdId}/members/${uid}`).get();
      return member.get(MEMBER_GENERATION_FIELD);
    },

    // One batch per commit rather than a BulkWriter: each commit either lands
    // or rejects, so a failure reaches the handler as the one error it
    // classifies, and a document already gone deletes without one.
    remove: async paths => {
      for (let start = 0; start < paths.length; start += CLEANUP_BATCH_SIZE) {
        const batch = firestore.batch();
        for (const path of paths.slice(start, start + CLEANUP_BATCH_SIZE)) {
          batch.delete(firestore.doc(path));
        }
        await batch.commit();
      }
    },

    log,
  };
}
