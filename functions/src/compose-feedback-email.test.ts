import test from 'node:test';
import assert from 'node:assert/strict';

import { composeFeedbackEmail, FeedbackMailInput } from './compose-feedback-email';

const wellFormed: FeedbackMailInput = {
  feedbackId: 'entry-1',
  userId: 'user-1',
  userEmail: 'person@example.com',
  category: 'bug',
  message: 'the chart is upside down',
  appVersion: '1.23.129',
  platform: 'web',
  locale: 'en',
  createdAt: '2026-08-15T08:00:00.000Z',
};

void test('the subject names the category and the entry id', () => {
  const mail = composeFeedbackEmail(wellFormed);
  assert.equal(mail.subject, '[home-account] feedback: bug (entry-1)');
});

void test('the body carries every field', () => {
  const mail = composeFeedbackEmail(wellFormed);
  assert.match(mail.text, /Category: bug/);
  assert.match(mail.text, /the chart is upside down/);
  assert.match(mail.text, /App version: 1\.23\.129/);
  assert.match(mail.text, /Platform: web/);
  assert.match(mail.text, /Locale: en/);
  assert.match(mail.text, /User id: user-1/);
  assert.match(mail.text, /Account email: person@example\.com/);
  assert.match(mail.text, /Created at: 2026-08-15T08:00:00\.000Z/);
});

void test('the message survives verbatim, line breaks included', () => {
  const mail = composeFeedbackEmail({
    ...wellFormed,
    message: 'line one\nline two\n\nline four',
  });
  assert.ok(mail.text.includes('line one\nline two\n\nline four'));
});

void test('a missing account email renders as unknown', () => {
  const mail = composeFeedbackEmail({ ...wellFormed, userEmail: undefined });
  assert.match(mail.text, /Account email: unknown/);
});

// Entries written before the rules deploy turned validation on can be
// shaped arbitrarily; the mail renders instead of throwing.
void test('non-string fields render as unknown', () => {
  const mail = composeFeedbackEmail({
    ...wellFormed,
    category: 42,
    message: { nested: true },
    appVersion: undefined,
    platform: null,
    locale: '',
    createdAt: undefined,
  });
  assert.match(mail.subject, /feedback: unknown \(entry-1\)/);
  assert.match(mail.text, /Category: unknown/);
  assert.match(mail.text, /App version: unknown/);
  assert.match(mail.text, /Platform: unknown/);
  assert.match(mail.text, /Locale: unknown/);
  assert.match(mail.text, /Created at: unknown/);
});

void test('a newline smuggled into the category cannot break the subject line', () => {
  const mail = composeFeedbackEmail({
    ...wellFormed,
    category: 'bug\r\nBcc: spam@example.com',
  });
  assert.ok(!mail.subject.includes('\n'));
  assert.ok(!mail.subject.includes('\r'));
});

void test('an oversized message is clamped and says how much was stored', () => {
  const mail = composeFeedbackEmail({ ...wellFormed, message: 'y'.repeat(5000) });
  assert.match(mail.text, /\[truncated: 5000 characters stored\]/);
  assert.ok(mail.text.length < 5000);
});
