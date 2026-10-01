import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { deletedHousehold, deletedMember } from './household-ledger-cleanup-events';
import { planCleanup } from './household-ledger-cleanup';

const HID = 'household1';
const SAM = 'sam-uid';
const GEN = new Timestamp(1_790_000_000, 123_456_000);

/** The snapshot a document-deleted event carries: the document as last stored. */
function snapshotOf(fields: Record<string, unknown>) {
  return { data: () => fields };
}

test('a member event names the member, its household and the member document as stored', () => {
  const fields = { since: GEN, role: 'member' };
  assert.deepEqual(
    deletedMember({ params: { householdId: HID, uid: SAM }, data: snapshotOf(fields) }),
    { kind: 'member', householdId: HID, uid: SAM, data: fields }
  );
});

test('a household event names the household and the household document as stored', () => {
  const fields = { createdAt: GEN, ownerUid: SAM };
  assert.deepEqual(deletedHousehold({ params: { householdId: HID }, data: snapshotOf(fields) }), {
    kind: 'household',
    householdId: HID,
    data: fields,
  });
});

test('an event without a snapshot is passed on with no data, which the cleanup skips', () => {
  const member = deletedMember({ params: { householdId: HID, uid: SAM }, data: undefined });
  const household = deletedHousehold({ params: { householdId: HID }, data: undefined });

  assert.deepEqual(member, { kind: 'member', householdId: HID, uid: SAM, data: undefined });
  assert.deepEqual(household, { kind: 'household', householdId: HID, data: undefined });
  assert.deepEqual(planCleanup(member), { kind: 'skip', reason: 'no-document' });
  assert.deepEqual(planCleanup(household), { kind: 'skip', reason: 'no-document' });
});
