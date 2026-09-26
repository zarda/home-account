import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { INVITE_MAIL_DEADLINE_MS } from './household-invite-handler';
import { MAX_EMAIL_LENGTH, MAX_HOUSEHOLDS_PER_ACCOUNT } from './household-invite';

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
