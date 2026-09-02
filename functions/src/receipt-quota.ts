/**
 * The decisions behind the receipt-image quota, kept apart from the triggers
 * that act on them: this module has no imports and no I/O, so the parsing and
 * the per-tier arithmetic are unit-testable while the wiring (./index) stays
 * thin around them — the same split as ./compose-feedback-email.
 *
 * The quota was client-side only, which fails open: a raw SDK client ignored
 * the tier limit entirely. The count these helpers feed is the authoritative
 * one, written by the storage triggers and read by the rules that enforce it.
 */

/**
 * Remote Config parameter keys. These must stay identical to the client's
 * (src/app/core/services/remote-config.service.ts) or the two halves of the
 * quota would read different numbers and disagree about who is over it.
 */
export const RC_FREE_TIER_RECEIPT_IMAGE_LIMIT = 'free_tier_receipt_image_limit';
export const RC_PREMIUM_RECEIPT_IMAGE_LIMIT = 'premium_receipt_image_limit';

/** Mirrors FREE_TIER_RECEIPT_IMAGE_LIMIT in src/app/models/user.model.ts. */
export const FALLBACK_FREE_LIMIT = 200;

/**
 * 0 is the "unlimited" sentinel, matching the client's in-app default. It is
 * stored verbatim rather than expanded to Infinity: the limit is written to
 * Firestore and read back by security rules, and neither JSON nor a rules
 * expression carries an infinity.
 */
export const FALLBACK_PREMIUM_LIMIT = 0;

/** The per-tier limits in force, resolved from the template or the fallbacks. */
export interface TierLimits {
  free: number;
  /** 0 means unlimited. */
  premium: number;
}

/**
 * The subset of `RemoteConfigTemplate['parameters']` this module reads.
 * Declared structurally so the module keeps its no-import property; the
 * admin SDK's own type is assignable to it.
 */
export type TemplateParameters = Record<
  string,
  {
    defaultValue?: unknown;
    conditionalValues?: unknown;
  }
>;

/** Where one user's receipt objects live. The single source of that shape. */
export function receiptPrefixFor(userId: string): string {
  return `users/${userId}/receipts/`;
}

/**
 * The owner of a receipt object, or null when the name is not a receipt.
 *
 * Every object event in the bucket invokes the triggers — a v2 storage
 * trigger cannot filter by path prefix server-side — so this is the only
 * thing standing between an unrelated upload and a pointless recount.
 *
 * A name with extra segments under the prefix still resolves to its owner.
 * storage.rules only admits single-segment names, so a client cannot create
 * one, but `getFiles({ prefix })` would count it if something else did:
 * accepting it here keeps the guard and the count over the same set.
 */
export function receiptOwnerOf(objectName: string): string | null {
  const segments = objectName.split('/');
  if (segments.length < 4) return null;
  if (segments[0] !== 'users' || segments[2] !== 'receipts') return null;

  const userId = segments[1];
  // An empty owner or an empty name is a prefix, not an object.
  if (!userId || !segments.slice(3).join('/')) return null;
  // A uid is an opaque identifier, never a relative path segment: '..' here
  // would send the caller's `users/{userId}/quota/...` write somewhere else
  // entirely. storage.rules already pins the owner to request.auth.uid, so
  // this states that constraint rather than relying on it being inferred.
  if (userId === '.' || userId === '..') return null;
  return userId;
}

/**
 * A limit is a count of whole images, so only a non-negative integer is
 * usable. Number() alone would read '' and '  ' as 0 — a blank parameter
 * would silently become the unlimited sentinel.
 */
function readLimit(parameter: unknown): number | null {
  if (!parameter || typeof parameter !== 'object') return null;

  // Only defaultValue is readable here. conditionalValues are resolved
  // against a client's context (app, platform, audience), which a trigger
  // does not have and cannot fabricate.
  const defaultValue = (parameter as { defaultValue?: unknown }).defaultValue;
  if (!defaultValue || typeof defaultValue !== 'object') return null;

  // Remote Config stores every parameter value as a string, NUMBER-typed
  // parameters included.
  const raw = (defaultValue as { value?: unknown }).value;
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * The limits the template asks for, falling back per key so a typo in one
 * parameter cannot take the other down with it.
 */
export function limitsFromTemplate(parameters: TemplateParameters): TierLimits {
  const free = readLimit(parameters[RC_FREE_TIER_RECEIPT_IMAGE_LIMIT]);
  const premium = readLimit(parameters[RC_PREMIUM_RECEIPT_IMAGE_LIMIT]);

  return {
    // 0 is unusable for the free tier: it is the premium sentinel, and read
    // literally it would lock every free account out of the feature.
    free: free !== null && free > 0 ? free : FALLBACK_FREE_LIMIT,
    premium: premium ?? FALLBACK_PREMIUM_LIMIT,
  };
}

/**
 * The limit that applies to one account's tier.
 *
 * The tier arrives as `subscription.tier` off an arbitrary Firestore
 * document, so it is typed unknown: anything that is not exactly 'premium'
 * gets the free limit. That is the safe direction — an absent subscription
 * record already means the free tier, and a tier this function cannot read
 * must not hand out the paid allowance.
 */
export function limitForTier(tier: unknown, limits: TierLimits): number {
  return tier === 'premium' ? limits.premium : limits.free;
}
