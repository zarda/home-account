import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';

import { INVITE_MAIL_DEADLINE_MS } from './household-invite-handler';
import { MAX_EMAIL_LENGTH, MAX_HOUSEHOLDS_PER_ACCOUNT } from './household-invite';
import {
  COPY_MEMBER_FIELD,
  GENERATION_FIELD,
  HOUSEHOLD_GENERATION_FIELD,
  MEMBER_GENERATION_FIELD,
  planCleanup,
} from './household-ledger-cleanup';

/**
 * The app keeps copies of three of the invite callable's numbers: the mail
 * deadline, which says how long a provisional `failed` still reads as
 * sending; the longest address, which its invite form refuses past; and the
 * most households one account holds, which its create and join refuse past.
 * The app cannot import them from here (the handler pulls in the Functions
 * runtime), so each copy is read as source text and held to the original.
 * The tests run from lib/, two levels below the repository root.
 */
const APP = resolve(__dirname, '..', '..', 'src', 'app');

function clientConstant(file: string, name: string): number {
  const source = readFileSync(resolve(APP, file), 'utf8');
  const match = new RegExp(`\\bconst ${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(source);
  assert.ok(match, `${file} declares ${name} as a number literal`);
  return Number(match[1].replaceAll('_', ''));
}

void test("the app's mail deadline is the handler's", () => {
  assert.equal(
    clientConstant('core/services/household-invite-callable.ts', 'INVITE_MAIL_DEADLINE_MS'),
    INVITE_MAIL_DEADLINE_MS
  );
});

void test("the app's longest invite address is the callable's", () => {
  assert.equal(
    clientConstant('core/services/household.service.ts', 'INVITE_EMAIL_MAX_LENGTH'),
    MAX_EMAIL_LENGTH
  );
});

void test("the app's most households per account is the callable's", () => {
  assert.equal(
    clientConstant('models/household.model.ts', 'MAX_HOUSEHOLDS_PER_ACCOUNT'),
    MAX_HOUSEHOLDS_PER_ACCOUNT
  );
});

/**
 * The cleanup triggers query the household's collections by the fields the
 * app writes, so the names and the order of the equalities are the app's
 * too: LEDGER_QUERY_SHAPES in household-ledger.model.ts, each served by its
 * composite, and the generation fields of the member document, the household
 * and every per-generation document.
 */
const LEDGER_MODEL = 'models/household-ledger.model.ts';

interface ClientShape {
  collectionGroup: string;
  fields: string[];
}

/**
 * The entries of LEDGER_QUERY_SHAPES, read in the grammar
 * scripts/check-ledger-contract.mjs reads them in; that script is an ES module
 * outside this CommonJS workspace, so it is not imported. Held to the number
 * of shapes declared, so an entry written in a form this does not read fails
 * here rather than go unchecked.
 */
function clientQueryShapes(): Map<string, ClientShape> {
  const source = readFileSync(resolve(APP, LEDGER_MODEL), 'utf8');
  const start = source.indexOf('export const LEDGER_QUERY_SHAPES = {');
  assert.ok(start >= 0, `${LEDGER_MODEL} declares LEDGER_QUERY_SHAPES`);
  const block = source
    .slice(start, source.indexOf('} as const satisfies', start))
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const shapes = new Map<string, ClientShape>();
  for (const [, name, collectionGroup, fields] of block.matchAll(
    /([A-Za-z_$][\w$]*)\s*:\s*\{\s*collectionGroup\s*:\s*'([^']+)'\s*,\s*fields\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/g
  )) {
    shapes.set(name, {
      collectionGroup,
      fields: [...fields.matchAll(/\[\s*'([^']+)'\s*,\s*'[^']+'\s*\]/g)].map(([, field]) => field),
    });
  }
  const declared = (block.match(/\bcollectionGroup\s*:/g) ?? []).length;
  assert.ok(declared > 0, `${LEDGER_MODEL} lists its query shapes`);
  assert.equal(shapes.size, declared, `every query shape ${LEDGER_MODEL} declares is read`);
  for (const [name, shape] of shapes) assert.ok(shape.fields.length > 0, `${name} lists its fields`);
  return shapes;
}

/** Whether `iface` in `file` declares `field` with the type `type`. */
function declares(file: string, iface: string, field: string, type: string): boolean {
  const source = readFileSync(resolve(APP, file), 'utf8');
  const body = new RegExp(`export interface ${iface}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  assert.ok(body, `${file} declares ${iface}`);
  return new RegExp(`\\n\\s*${field}:\\s*${type};`).test(body[1]);
}

function declaresTimestamp(file: string, iface: string, field: string): boolean {
  return declares(file, iface, field, 'Timestamp');
}

const GEN = new Timestamp(1_790_000_000, 0);

void test("the member trigger's copy sweep filters as the app's ledgerByMember shape does", () => {
  const shape = clientQueryShapes().get('ledgerByMember');
  assert.ok(shape, 'the app declares ledgerByMember');
  const plan = planCleanup({ kind: 'member', householdId: 'h', uid: 'u', data: { since: GEN } });
  assert.equal(plan.kind, 'sweep');
  if (plan.kind !== 'sweep') return;
  const [sweep] = plan.sweeps;
  assert.equal(sweep.kind, 'where');
  if (sweep.kind !== 'where') return;
  assert.equal(sweep.collection.split('/').at(-1), shape.collectionGroup);
  assert.deepEqual(
    sweep.where.map(({ field }) => field),
    shape.fields
  );
  assert.deepEqual(shape.fields, [GENERATION_FIELD, COPY_MEMBER_FIELD]);
});

void test("the household trigger filters each collection on the field the app's lists lead with", () => {
  const shapes = [...clientQueryShapes().values()];
  const plan = planCleanup({ kind: 'household', householdId: 'h', data: { createdAt: GEN } });
  assert.equal(plan.kind, 'sweep');
  if (plan.kind !== 'sweep') return;
  const swept = new Set<string>();
  for (const sweep of plan.sweeps) {
    const collection = sweep.kind === 'where' ? sweep.collection.split('/').at(-1)! : sweep.child;
    swept.add(collection);
    for (const shape of shapes.filter(candidate => candidate.collectionGroup === collection)) {
      assert.equal(sweep.where[0].field, shape.fields[0], `${collection} is swept on its lists' generation`);
    }
  }
  // Every collection the app lists by generation is one the household trigger sweeps.
  for (const shape of shapes) assert.ok(swept.has(shape.collectionGroup), `${shape.collectionGroup} is swept`);
});

void test('the generation fields the triggers read are the ones the app writes', () => {
  assert.ok(declaresTimestamp('models/household.model.ts', 'HouseholdMember', MEMBER_GENERATION_FIELD));
  assert.ok(declaresTimestamp('models/household.model.ts', 'Household', HOUSEHOLD_GENERATION_FIELD));
  assert.ok(declaresTimestamp(LEDGER_MODEL, 'LedgerCopy', GENERATION_FIELD));
  for (const iface of ['HouseholdBudget', 'HouseholdGoal', 'HouseholdContribution']) {
    assert.ok(declaresTimestamp('models/household-plans.model.ts', iface, GENERATION_FIELD), iface);
  }
  assert.ok(declares(LEDGER_MODEL, 'LedgerCopy', COPY_MEMBER_FIELD, 'string'));
});
