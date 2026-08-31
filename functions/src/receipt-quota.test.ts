import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_FREE_LIMIT,
  FALLBACK_PREMIUM_LIMIT,
  RC_FREE_TIER_RECEIPT_IMAGE_LIMIT,
  RC_PREMIUM_RECEIPT_IMAGE_LIMIT,
  TemplateParameters,
  TierLimits,
  limitForTier,
  limitsFromTemplate,
  receiptOwnerOf,
  receiptPrefixFor,
} from './receipt-quota';

function template(free?: string, premium?: string): TemplateParameters {
  const parameters: TemplateParameters = {};
  if (free !== undefined) {
    parameters[RC_FREE_TIER_RECEIPT_IMAGE_LIMIT] = { defaultValue: { value: free } };
  }
  if (premium !== undefined) {
    parameters[RC_PREMIUM_RECEIPT_IMAGE_LIMIT] = { defaultValue: { value: premium } };
  }
  return parameters;
}

const fallbacks: TierLimits = { free: FALLBACK_FREE_LIMIT, premium: FALLBACK_PREMIUM_LIMIT };

void test('the fallbacks mirror the in-app defaults', () => {
  assert.equal(FALLBACK_FREE_LIMIT, 200);
  assert.equal(FALLBACK_PREMIUM_LIMIT, 0);
});

void test('receiptPrefixFor scopes the listing to one owner', () => {
  assert.equal(receiptPrefixFor('user-1'), 'users/user-1/receipts/');
});

void test('every object the prefix listing counts resolves to that same owner', () => {
  const uid = 'user-1';
  // '/x' makes the doubled separator of 'users/user-1/receipts//x'. The prefix
  // listing counts that object, so the guard has to admit it.
  for (const name of ['tx-1', 'tx-1_2', 'nested/deep.jpg', '/x']) {
    assert.equal(receiptOwnerOf(`${receiptPrefixFor(uid)}${name}`), uid);
  }
});

void test('slot 0 and its suffixed siblings resolve to one owner', () => {
  assert.equal(receiptOwnerOf('users/user-1/receipts/tx-1'), 'user-1');
  assert.equal(receiptOwnerOf('users/user-1/receipts/tx-1_1'), 'user-1');
  assert.equal(receiptOwnerOf('users/user-1/receipts/tx-1_4'), 'user-1');
  assert.equal(receiptOwnerOf('users/user-1/receipts/rec-rule-9-1750000000000_2'), 'user-1');
});

void test('a foreign prefix is not a receipt', () => {
  assert.equal(receiptOwnerOf('exports/user-1/receipts/tx-1'), null);
  assert.equal(receiptOwnerOf('/users/user-1/receipts/tx-1'), null);
  assert.equal(receiptOwnerOf('Users/user-1/receipts/tx-1'), null);
});

void test('a sibling collection under the same user is not a receipt', () => {
  assert.equal(receiptOwnerOf('users/user-1/transactions/tx-1'), null);
  assert.equal(receiptOwnerOf('users/user-1/receipts-archive/tx-1'), null);
});

void test('a name missing segments is not a receipt', () => {
  assert.equal(receiptOwnerOf(''), null);
  assert.equal(receiptOwnerOf('users'), null);
  assert.equal(receiptOwnerOf('users/user-1'), null);
  assert.equal(receiptOwnerOf('users/user-1/receipts'), null);
  assert.equal(receiptOwnerOf('users/user-1/receipts/'), null);
  assert.equal(receiptOwnerOf('users//receipts/tx-1'), null);
  // Long enough to pass the length check, but 'receipts' is in the wrong slot.
  assert.equal(receiptOwnerOf('users/user-1/b/receipts/tx-1'), null);
});

// A uid is opaque; a relative segment would redirect the quota write.
void test('a relative path segment is not an owner', () => {
  assert.equal(receiptOwnerOf('users/./receipts/tx-1'), null);
  assert.equal(receiptOwnerOf('users/../receipts/tx-1'), null);
});

void test('limitsFromTemplate reads both parameters', () => {
  assert.deepEqual(limitsFromTemplate(template('50', '5000')), { free: 50, premium: 5000 });
});

void test('an empty template falls back on both keys', () => {
  assert.deepEqual(limitsFromTemplate({}), fallbacks);
});

// The two keys are independent: a typo in one must not drag the other down.
void test('an unusable value falls back per key', () => {
  assert.deepEqual(limitsFromTemplate(template('unlimited', '5000')), {
    free: FALLBACK_FREE_LIMIT,
    premium: 5000,
  });
  assert.deepEqual(limitsFromTemplate(template('50', 'unlimited')), {
    free: 50,
    premium: FALLBACK_PREMIUM_LIMIT,
  });
});

void test('a non-numeric, blank, or infinite value falls back', () => {
  for (const value of ['', '   ', 'abc', 'true', '12abc', 'Infinity', 'NaN']) {
    assert.deepEqual(limitsFromTemplate(template(value, value)), fallbacks, value);
  }
});

void test('a negative value falls back', () => {
  assert.deepEqual(limitsFromTemplate(template('-1', '-1')), fallbacks);
});

// 0 is the unlimited sentinel for premium only. A free limit of 0 would lock
// every free account out of its own feature, so it is treated as unusable.
void test('zero is a premium value and a free fallback', () => {
  assert.deepEqual(limitsFromTemplate(template('0', '0')), {
    free: FALLBACK_FREE_LIMIT,
    premium: 0,
  });
});

void test('a fractional value falls back — a limit counts whole images', () => {
  assert.deepEqual(limitsFromTemplate(template('12.5', '12.5')), fallbacks);
});

// Only defaultValue is readable server-side: conditions are evaluated against
// a client's context, which a trigger does not have.
void test('a parameter with no explicit default falls back', () => {
  assert.deepEqual(
    limitsFromTemplate({
      [RC_FREE_TIER_RECEIPT_IMAGE_LIMIT]: { defaultValue: { useInAppDefault: true } },
      [RC_PREMIUM_RECEIPT_IMAGE_LIMIT]: { conditionalValues: { ios: { value: '5000' } } },
    }),
    fallbacks
  );
});

void test('a malformed parameter entry falls back rather than throwing', () => {
  const malformed = {
    [RC_FREE_TIER_RECEIPT_IMAGE_LIMIT]: null,
    [RC_PREMIUM_RECEIPT_IMAGE_LIMIT]: { defaultValue: { value: 42 } },
  } as unknown as TemplateParameters;
  assert.deepEqual(limitsFromTemplate(malformed), fallbacks);
});

void test('the premium tier keeps its limit, sentinel included', () => {
  assert.equal(limitForTier('premium', { free: 200, premium: 5000 }), 5000);
  assert.equal(limitForTier('premium', { free: 200, premium: 0 }), 0);
});

void test('the free tier gets the free limit', () => {
  assert.equal(limitForTier('free', { free: 200, premium: 0 }), 200);
});

// No subscription record means the free tier, and so does anything the client
// union does not cover — an unreadable tier must not hand out the paid limit.
void test('an unknown or absent tier gets the free limit', () => {
  const limits: TierLimits = { free: 200, premium: 0 };
  for (const tier of [undefined, null, '', 'Premium', 'PREMIUM', 'gold', 1, true, {}]) {
    assert.equal(limitForTier(tier, limits), 200, String(tier));
  }
});
