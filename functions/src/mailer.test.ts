import test from 'node:test';
import assert from 'node:assert/strict';

import { transportOptions } from './mailer';

void test('the transport carries no timeouts unless asked', () => {
  assert.deepEqual(
    transportOptions({ host: 'smtp.example.com', port: 465, user: 'u', pass: 'p' }),
    { host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'u', pass: 'p' } }
  );
});

void test('a timeout bounds every phase of the connection', () => {
  const smtp = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p', timeoutMs: 10_000 };
  assert.deepEqual(transportOptions(smtp), {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'u', pass: 'p' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    dnsTimeout: 10_000,
  });
});
