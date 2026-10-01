import test from 'node:test';
import assert from 'node:assert/strict';

import { deletedHousehold, deletedMember } from './household-ledger-cleanup-events';
// Safe to load: index's top level only sets global options, initializes the
// Admin app and declares secrets, none of which reaches the network.
import { onHouseholdDissolved, onHouseholdMemberDeleted } from './index';

/**
 * The cleanup triggers as they deploy: the endpoint each export carries is
 * what the Firebase CLI reads to create the trigger, so these hold the
 * deployed objects rather than restating their options. The handler's
 * "rethrown, so delivered again" holds only while retry is on.
 */
const DOCUMENT_DELETED = 'google.cloud.firestore.document.v1.deleted';

test('onHouseholdMemberDeleted fires on the delete of a member document and is retried', () => {
  const trigger = onHouseholdMemberDeleted.__endpoint.eventTrigger;
  assert.ok(trigger);
  assert.equal(trigger.eventType, DOCUMENT_DELETED);
  assert.deepEqual(trigger.eventFilterPathPatterns, {
    document: 'households/{householdId}/members/{uid}',
  });
  assert.equal(trigger.retry, true);
});

test('onHouseholdDissolved fires on the delete of a household document and is retried', () => {
  const trigger = onHouseholdDissolved.__endpoint.eventTrigger;
  assert.ok(trigger);
  assert.equal(trigger.eventType, DOCUMENT_DELETED);
  assert.deepEqual(trigger.eventFilterPathPatterns, { document: 'households/{householdId}' });
  assert.equal(trigger.retry, true);
});

/** The event each trigger's handler receives, as the SDK types it from the document path. */
type MemberTriggerEvent = Parameters<typeof onHouseholdMemberDeleted.run>[0];
type HouseholdTriggerEvent = Parameters<typeof onHouseholdDissolved.run>[0];

/** Whether an event of type E may be handed to the mapper M. */
type Accepts<M extends (event: never) => unknown, E> = [E] extends [Parameters<M>[0]]
  ? true
  : false;

test("each trigger's event fits its own mapper and not the other's", () => {
  // tsc is the check: the member trigger handing its event to deletedHousehold
  // would read a member document as a household's and skip every delete as
  // 'no-generation', so that call has to fail to compile rather than run.
  const memberToMember: Accepts<typeof deletedMember, MemberTriggerEvent> = true;
  const householdToHousehold: Accepts<typeof deletedHousehold, HouseholdTriggerEvent> = true;
  const memberToHousehold: Accepts<typeof deletedHousehold, MemberTriggerEvent> = false;
  const householdToMember: Accepts<typeof deletedMember, HouseholdTriggerEvent> = false;

  assert.deepEqual(
    [memberToMember, householdToHousehold, memberToHousehold, householdToMember],
    [true, true, false, false]
  );
});
