/**
 * Guards for values on their way into a Firestore document.
 *
 * The insight snapshots are the first thing in this app to persist a deep,
 * computed object rather than a hand-built flat record, which exposes a set of
 * SDK constraints that mocked unit tests cannot see:
 *
 * - `undefined` is rejected outright, and `ignoreUndefinedProperties` is not set
 *   on this app's Firestore instance, so one absent optional field fails the
 *   entire write;
 * - `NaN` and `Infinity` are rejected, so a single `0/0` ratio poisons a document;
 * - nested arrays are forbidden, which rules out a `number[][]` month series;
 * - a written `Date` comes back as a `Timestamp`, so a field's type silently
 *   changes across a round trip.
 *
 * `findSerializationIssues` turns all of that into an assertion a spec can make
 * before anything touches the network.
 */

export interface SerializationIssue {
  /** Dotted path to the offending value, e.g. `facts.trends[0].changeRatio`. */
  path: string;
  reason: string;
}

function describe(value: unknown): string | null {
  if (value === undefined) {
    return 'undefined is rejected by Firestore';
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return Number.isNaN(value) ? 'NaN is rejected by Firestore' : 'Infinity is rejected by Firestore';
  }
  if (typeof value === 'function') {
    return 'functions cannot be serialised';
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return `${typeof value} cannot be serialised`;
  }
  if (value instanceof Date) {
    return 'Date comes back as a Timestamp; store an ISO string instead';
  }
  if (value instanceof Map || value instanceof Set) {
    return 'Map and Set are not Firestore values; use a plain object or array';
  }
  if (
    value !== null
    && typeof value === 'object'
    && typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return 'Timestamp-like value; store an ISO string instead';
  }
  return null;
}

/**
 * Every reason the value could not be written to Firestore as-is, deepest paths
 * included. An empty array means the value is safe.
 */
export function findSerializationIssues(
  value: unknown,
  path = '',
  insideArray = false,
): SerializationIssue[] {
  const reason = describe(value);
  if (reason) {
    return [{ path: path || '(root)', reason }];
  }

  if (Array.isArray(value)) {
    if (insideArray) {
      return [{ path: path || '(root)', reason: 'Firestore forbids nested arrays' }];
    }
    return value.flatMap(
      (item, index) => findSerializationIssues(item, `${path}[${index}]`, true));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]) => findSerializationIssues(item, path ? `${path}.${key}` : key));
  }

  return [];
}

/**
 * JSON with object keys sorted at every depth.
 *
 * `JSON.stringify` follows insertion order, which makes a fingerprint depend on
 * the order the code happened to build its objects in. Sorting keys means two
 * structurally equal facts always hash the same, which is what #117's
 * "identical when regenerated" criterion rests on.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/**
 * Flatten to `path -> number | null`, for comparing two computations field by
 * field without knowing their shape in advance.
 */
export function flattenNumbers(
  value: unknown,
  path = '',
  into = new Map<string, number | null>(),
): Map<string, number | null> {
  if (typeof value === 'number') {
    into.set(path, value);
    return into;
  }
  if (value === null) {
    into.set(path, null);
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenNumbers(item, `${path}[${index}]`, into));
    return into;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      flattenNumbers(item, path ? `${path}.${key}` : key, into);
    }
  }
  return into;
}
