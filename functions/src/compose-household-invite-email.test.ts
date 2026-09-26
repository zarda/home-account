import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOUSEHOLD_PAGE_URL,
  HouseholdInviteMailInput,
  composeHouseholdInviteEmail,
} from './compose-household-invite-email';

const input: HouseholdInviteMailInput = {
  inviterEmail: 'alex@example.com',
  expiresAt: new Date(Date.UTC(2026, 9, 2, 12, 0, 0)),
  locale: 'en',
};

void test('the link is the fixed household page', () => {
  assert.equal(HOUSEHOLD_PAGE_URL, 'https://home-accounter.web.app/household');
});

for (const locale of ['en', 'ja', 'tc']) {
  void test(`the ${locale} mail carries the inviter's address, the expiry and the link`, () => {
    const mail = composeHouseholdInviteEmail({ ...input, locale });
    assert.ok(mail.subject.includes('alex@example.com'), mail.subject);
    assert.ok(mail.text.includes('alex@example.com'));
    assert.ok(mail.text.includes('2026-10-02'));
    assert.ok(mail.text.includes('https://home-accounter.web.app/household'));
  });
}

void test('each language is its own text', () => {
  const texts = ['en', 'ja', 'tc'].map(locale => composeHouseholdInviteEmail({ ...input, locale }));
  assert.equal(new Set(texts.map(mail => mail.subject)).size, 3);
  assert.equal(new Set(texts.map(mail => mail.text)).size, 3);
  assert.match(texts[1].text, /家計簿/);
  assert.match(texts[2].text, /家庭記帳/);
});

// Owner-typed text never reaches a mailbox: the household name and every
// display name stay in-app, even when a caller hands them over.
void test('no household name and no display name, even when they are passed in', () => {
  const invite = {
    ...input,
    householdName: 'Click here to claim your prize',
    inviterName: 'Totally Your Bank',
    inviteeName: 'Sam Example',
  };
  for (const locale of ['en', 'ja', 'tc']) {
    const mail = composeHouseholdInviteEmail({ ...invite, locale });
    for (const owned of [invite.householdName, invite.inviterName, invite.inviteeName]) {
      assert.ok(!mail.subject.includes(owned), `${locale} subject carries "${owned}"`);
      assert.ok(!mail.text.includes(owned), `${locale} body carries "${owned}"`);
    }
  }
});

void test('an unknown locale falls back to en', () => {
  const en = composeHouseholdInviteEmail(input);
  for (const locale of ['fr', '', 'EN', undefined, null, 42]) {
    assert.deepEqual(composeHouseholdInviteEmail({ ...input, locale }), en, String(locale));
  }
});

void test('the output is plain text: a subject and a text body, no markup', () => {
  for (const locale of ['en', 'ja', 'tc']) {
    const mail = composeHouseholdInviteEmail({ ...input, locale });
    assert.deepEqual(Object.keys(mail).sort(), ['subject', 'text']);
    assert.ok(!/<[a-z!/]/i.test(mail.subject + mail.text), locale);
  }
});

void test('the subject stays on one line', () => {
  const mail = composeHouseholdInviteEmail({
    ...input,
    inviterEmail: 'alex@example.com\r\nBcc: x@example.com',
  });
  assert.ok(!/[\r\n]/.test(mail.subject));
});

// The expiry is the UTC calendar day of the stored instant.
void test('the expiry is the UTC day of the instant', () => {
  const late = composeHouseholdInviteEmail({
    ...input,
    expiresAt: new Date(Date.UTC(2026, 9, 2, 23, 30, 0)),
  });
  assert.ok(late.text.includes('2026-10-02'));
  assert.ok(!late.text.includes('2026-10-03'));
});
