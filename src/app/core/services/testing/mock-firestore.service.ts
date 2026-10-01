import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { FieldValue, Timestamp, arrayRemove, arrayUnion } from '@angular/fire/firestore';
import {
  aggregateTotalsOf,
  assertAggregateAsks,
  type AggregateFields,
  type AggregateTotals,
  type BatchOp,
  type CollectionWithMetadata,
  type DocumentWithMetadata
} from '../firestore.service';

// Simple spy implementation that works without jasmine in production builds
interface SpyCall {
  args: unknown[];
}

type MockDoc = Record<string, unknown>;

/** What a deleteField() resolves to while a batch is applied. */
const DELETED = Symbol('deleted');

/** A refusal shaped as the SDK's: an Error carrying the Firestore code. */
function firestoreError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function isPlainMap(value: unknown): value is MockDoc {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Equality as arrayUnion and arrayRemove judge it: by value, at any depth. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isPlainMap(a) || isPlainMap(b)) {
    if (!isPlainMap(a) || !isPlainMap(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => key in b && sameValue(a[key], b[key]));
  }
  const isEqual = (a as { isEqual?: (other: unknown) => boolean }).isEqual;
  return a.constructor === b.constructor && typeof isEqual === 'function' && isEqual.call(a, b);
}

/**
 * The elements an arrayUnion or arrayRemove carries. The SDK keeps them in
 * a private field, so they are found by shape and then confirmed with the
 * SDK's own isEqual against a sentinel rebuilt from them.
 */
function sentinelElements(
  value: FieldValue,
  rebuild: (...elements: unknown[]) => FieldValue
): unknown[] | undefined {
  const elements = Object.values(value).find(Array.isArray) as unknown[] | undefined;
  return elements && value.isEqual(rebuild(...elements)) ? elements : undefined;
}

/** A sentinel applied to the value it lands on, as the server applies it. */
function resolveSentinel(value: FieldValue, current: unknown): unknown {
  const method = (value as unknown as { _methodName?: string })._methodName;
  if (method === 'serverTimestamp') return Timestamp.now();
  if (method === 'deleteField') return DELETED;
  if (method === 'arrayUnion') {
    const elements = sentinelElements(value, arrayUnion);
    if (elements) {
      const next = Array.isArray(current) ? [...current] : [];
      for (const element of elements) {
        if (!next.some(item => sameValue(item, element))) next.push(element);
      }
      return next;
    }
  }
  if (method === 'arrayRemove') {
    const elements = sentinelElements(value, arrayRemove);
    if (elements) {
      return Array.isArray(current) ? current.filter(item => !elements.some(e => sameValue(item, e))) : [];
    }
  }
  throw new Error(
    `MockFirestoreService.commitBatch cannot apply ${method ?? 'an unknown sentinel'}(); assert on batches instead`);
}

/**
 * A value as the server stores it when nothing is under it: every sentinel
 * resolved, at any depth. An undefined value is refused, as the SDK
 * refuses it, and so is a deleteField() where the SDK allows none.
 */
function resolveFresh(value: unknown, field: string): unknown {
  if (value === undefined) {
    throw firestoreError('invalid-argument', `Unsupported field value: undefined (found in field ${field})`);
  }
  if (value instanceof FieldValue) {
    const resolved = resolveSentinel(value, undefined);
    if (resolved === DELETED) {
      throw firestoreError('invalid-argument', `deleteField() cannot be used here (found in field ${field})`);
    }
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item, i) => resolveFresh(item, `${field}[${i}]`));
  if (isPlainMap(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveFresh(item, field ? `${field}.${key}` : key)]));
  }
  return value;
}

/** A merge set: nested maps merge into what is there, key by key. */
function mergeInto(existing: unknown, data: MockDoc, field: string): MockDoc {
  const next: MockDoc = isPlainMap(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(data)) {
    const path = field ? `${field}.${key}` : key;
    if (value instanceof FieldValue) {
      const resolved = resolveSentinel(value, next[key]);
      if (resolved === DELETED) delete next[key];
      else next[key] = resolved;
    } else if (isPlainMap(value)) {
      next[key] = mergeInto(next[key], value, path);
    } else {
      next[key] = resolveFresh(value, path);
    }
  }
  return next;
}

function readPath(doc: MockDoc, path: readonly string[]): unknown {
  let value: unknown = doc;
  for (const segment of path) value = isPlainMap(value) ? value[segment] : undefined;
  return value;
}

/** A copy of `doc` with the field at `path` set, or removed for DELETED. */
function writePath(doc: MockDoc, path: readonly string[], value: unknown): MockDoc {
  const [head, ...rest] = path;
  const next = { ...doc };
  const child = next[head];
  if (rest.length === 0) {
    if (value === DELETED) delete next[head];
    else next[head] = value;
  } else if (value !== DELETED || isPlainMap(child)) {
    next[head] = writePath(isPlainMap(child) ? child : {}, rest, value);
  }
  return next;
}

/** An update: each key is a dotted field path, and its value replaces what is there. */
function updateOf(existing: MockDoc, data: MockDoc): MockDoc {
  let next = existing;
  for (const [key, value] of Object.entries(data)) {
    const path = key.split('.');
    const resolved = value instanceof FieldValue
      ? resolveSentinel(value, readPath(next, path))
      : resolveFresh(value, key);
    next = writePath(next, path, resolved);
  }
  return next;
}

/**
 * One entry in the call-order log: the method and the document or
 * collection path it was given, or the ops of a batch.
 */
export interface MockFirestoreCall {
  method: string;
  path?: string;
  ops?: readonly BatchOp[];
}

type MockWhere = { field: string; op: string; value: unknown }[];

class SimpleSpy {
  calls: SpyCall[] = [];

  call = (...args: unknown[]): void => {
    this.calls.push({ args });
  };

  mostRecent(): SpyCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
  }
}

/**
 * Mock FirestoreService for unit testing
 */
@Injectable()
export class MockFirestoreService {
  // Store for mock data
  private mockData = new Map<string, unknown>();
  private mockCollections = new Map<string, unknown[]>();

  // Spies for verifying calls
  private _getDocumentSpy = new SimpleSpy();
  private _getCollectionSpy = new SimpleSpy();
  private _getCollectionFromServerSpy = new SimpleSpy();
  private _countDocumentsSpy = new SimpleSpy();
  private _subscribeToCollectionSpy = new SimpleSpy();
  private _subscribeToDocumentSpy = new SimpleSpy();
  private _getPageSpy = new SimpleSpy();
  private _addDocumentSpy = new SimpleSpy();
  private _setDocumentSpy = new SimpleSpy();
  private _updateDocumentSpy = new SimpleSpy();
  private _deleteDocumentSpy = new SimpleSpy();
  private _runTransactionSpy = new SimpleSpy();
  private _txUpdateSpy = new SimpleSpy();
  private _txSetSpy = new SimpleSpy();
  private _txGetSpy = new SimpleSpy();
  private _txDeleteSpy = new SimpleSpy();
  private _subscribeToDocumentWithMetadataSpy = new SimpleSpy();
  private _subscribeToCollectionWithMetadataSpy = new SimpleSpy();
  private _getDocumentFromServerSpy = new SimpleSpy();
  private _aggregateFromServerSpy = new SimpleSpy();
  private _commitBatchSpy = new SimpleSpy();
  private _commitOnlineSpy = new SimpleSpy();
  private _waitForPendingWritesSpy = new SimpleSpy();
  private mockAggregates = new Map<string, AggregateTotals>();

  get getDocumentSpy() { return this._getDocumentSpy; }
  get getCollectionSpy() { return this._getCollectionSpy; }
  get getCollectionFromServerSpy() { return this._getCollectionFromServerSpy; }
  get countDocumentsSpy() { return this._countDocumentsSpy; }
  get subscribeToCollectionSpy() { return this._subscribeToCollectionSpy; }
  get subscribeToDocumentSpy() { return this._subscribeToDocumentSpy; }
  get getPageSpy() { return this._getPageSpy; }
  get addDocumentSpy() { return this._addDocumentSpy; }
  get setDocumentSpy() { return this._setDocumentSpy; }
  get updateDocumentSpy() { return this._updateDocumentSpy; }
  get deleteDocumentSpy() { return this._deleteDocumentSpy; }
  get runTransactionSpy() { return this._runTransactionSpy; }
  get txUpdateSpy() { return this._txUpdateSpy; }
  get txSetSpy() { return this._txSetSpy; }
  get txGetSpy() { return this._txGetSpy; }
  get txDeleteSpy() { return this._txDeleteSpy; }
  get subscribeToDocumentWithMetadataSpy() { return this._subscribeToDocumentWithMetadataSpy; }
  get subscribeToCollectionWithMetadataSpy() { return this._subscribeToCollectionWithMetadataSpy; }
  get getDocumentFromServerSpy() { return this._getDocumentFromServerSpy; }
  get aggregateFromServerSpy() { return this._aggregateFromServerSpy; }
  get commitBatchSpy() { return this._commitBatchSpy; }
  get commitOnlineSpy() { return this._commitOnlineSpy; }
  get waitForPendingWritesSpy() { return this._waitForPendingWritesSpy; }

  /**
   * Every call to the data methods, in the order made, logged when the call
   * is made rather than when it settles: what a spec reads to pin that one
   * write was issued before another.
   */
  readonly callLog: MockFirestoreCall[] = [];

  /**
   * The ops of every batch that landed, one entry per commitBatch or
   * commitOnline call, in order. A refused batch is in the call log and the
   * spy, not here.
   */
  readonly batches: BatchOp[][] = [];

  /** For each entry of `batches`, whether commitOnline committed it, in a transaction, rather than commitBatch. */
  readonly transactional: boolean[] = [];

  /**
   * Invoked at the start of every runTransaction call, before the callback's
   * first read. Tests use it to mutate the seeded documents between a
   * service's optimistic read and its transaction — the shape of a rival
   * client committing in that window. Set it to undefined inside the hook for
   * a one-shot rival.
   */
  beforeTransaction?: () => void;

  /**
   * Judges each commitBatch and commitOnline call by its ops: a truthy
   * answer refuses the whole batch with that answer as the rejection, and
   * nothing in it applies, as the rules refuse a commit.
   */
  refuseBatch?: (ops: readonly BatchOp[]) => unknown;

  // Set mock data for a document path
  setMockDocument(path: string, data: unknown): void {
    this.mockData.set(path, data);
  }

  // Set mock data for a collection path
  setMockCollection(path: string, data: unknown[]): void {
    this.mockCollections.set(path, data);
  }

  /**
   * The answer aggregateFromServer gives for a collection path, whatever the
   * query's filters: for a figure a spec wants to name outright, such as
   * two sides of a check that disagree.
   */
  setMockAggregate(path: string, totals: AggregateTotals): void {
    this.mockAggregates.set(path, totals);
  }

  // Clear all mock data
  clearMocks(): void {
    this.mockData.clear();
    this.mockCollections.clear();
    this.mockAggregates.clear();
    this.callLog.length = 0;
    this.batches.length = 0;
    this.transactional.length = 0;
    this._getDocumentSpy.reset();
    this._getCollectionSpy.reset();
    this._getCollectionFromServerSpy.reset();
    this._countDocumentsSpy.reset();
    this._subscribeToCollectionSpy.reset();
    this._subscribeToDocumentSpy.reset();
    this._getPageSpy.reset();
    this._addDocumentSpy.reset();
    this._setDocumentSpy.reset();
    this._updateDocumentSpy.reset();
    this._deleteDocumentSpy.reset();
    this._runTransactionSpy.reset();
    this._txUpdateSpy.reset();
    this._txSetSpy.reset();
    this._txGetSpy.reset();
    this._txDeleteSpy.reset();
    this._subscribeToDocumentWithMetadataSpy.reset();
    this._subscribeToCollectionWithMetadataSpy.reset();
    this._getDocumentFromServerSpy.reset();
    this._aggregateFromServerSpy.reset();
    this._commitBatchSpy.reset();
    this._commitOnlineSpy.reset();
    this._waitForPendingWritesSpy.reset();
    this.beforeTransaction = undefined;
    this.refuseBatch = undefined;
  }

  private log(method: string, path?: string, ops?: readonly BatchOp[]): void {
    this.callLog.push({ method, ...(path === undefined ? {} : { path }), ...(ops ? { ops } : {}) });
  }

  async getDocument<T>(path: string): Promise<T | null> {
    this.log('getDocument', path);
    this._getDocumentSpy.call(path);
    return (this.mockData.get(path) as T) ?? null;
  }

  // Serves from the same store as getDocument — the split spy is what
  // matters, so specs can assert a read went to the server.
  async getDocumentFromServer<T>(path: string): Promise<T | null> {
    this.log('getDocumentFromServer', path);
    this._getDocumentFromServerSpy.call(path);
    return (this.mockData.get(path) as T) ?? null;
  }

  async getCollection<T>(collectionPath: string, options?: unknown): Promise<T[]> {
    this.log('getCollection', collectionPath);
    this._getCollectionSpy.call(collectionPath, options);
    return (this.mockCollections.get(collectionPath) as T[]) ?? [];
  }

  // Serves from the same store as getCollection — the split spy is what
  // matters, so specs can assert a read went through the server-only variant.
  async getCollectionFromServer<T>(collectionPath: string, options?: unknown): Promise<T[]> {
    this.log('getCollectionFromServer', collectionPath);
    this._getCollectionFromServerSpy.call(collectionPath, options);
    return (this.mockCollections.get(collectionPath) as T[]) ?? [];
  }

  // Its own spy, not getCollection's: a count is an aggregate query that
  // reads no documents, so a spec asserting "this path was swept" and one
  // asserting "this path was only counted" are different statements. Sharing
  // one spy made them indistinguishable, and five specs worked around it with
  // `spyOn` instead.
  async countDocuments(collectionPath: string, options?: unknown): Promise<number> {
    this.log('countDocuments', collectionPath);
    this._countDocumentsSpy.call(collectionPath, options);
    return (this.mockCollections.get(collectionPath) ?? []).length;
  }

  /**
   * Answers with the figures setMockAggregate named for the path, else
   * counts and sums the seeded collection. Only the `==` and
   * `array-contains` filters are applied; any other filter throws rather
   * than answer for documents the query would not match. A request for
   * neither a count nor a sum is refused, as the service refuses it.
   */
  async aggregateFromServer(
    collectionPath: string,
    options: { where?: MockWhere } | undefined,
    fields: AggregateFields
  ): Promise<AggregateTotals> {
    this.log('aggregateFromServer', collectionPath);
    this._aggregateFromServerSpy.call(collectionPath, options, fields);
    assertAggregateAsks(fields);
    const totals = this.mockAggregates.get(collectionPath) ?? this.seededTotals(collectionPath, options?.where, fields);
    return aggregateTotalsOf(fields, { count: totals.count ?? 0, sum: totals.sum ?? 0 });
  }

  private seededTotals(collectionPath: string, where: MockWhere | undefined, fields: AggregateFields): AggregateTotals {
    const docs = (this.mockCollections.get(collectionPath) ?? []) as Record<string, unknown>[];
    const matched = docs.filter(d => (where ?? []).every(w => {
      if (w.op === '==') return d[w.field] === w.value;
      if (w.op === 'array-contains') {
        const list = d[w.field];
        return Array.isArray(list) && list.includes(w.value);
      }
      throw new Error(
        `MockFirestoreService.aggregateFromServer does not filter by '${w.op}'; name the figures with setMockAggregate`);
    }));
    const field = fields.sum;
    // The server sums numbers only, and skips any other value.
    const sum = field
      ? matched.reduce((total, d) => {
        const value = d[field];
        return total + (typeof value === 'number' ? value : 0);
      }, 0)
      : 0;
    return { count: matched.length, sum };
  }

  // Cursor-paged reads over a collection seeded in query order via
  // setMockCollection. Snapshot "cursors" are {id} stubs — callers must treat
  // snapshots as opaque, so identity by id is enough here.
  async getPage<T>(
    collectionPath: string,
    options: {
      orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
      limit: number;
      startAfterDoc?: { id: string };
      endBeforeDoc?: { id: string };
      startAtValues?: unknown[];
    }
  ): Promise<{ items: T[]; snapshots: { id: string }[] }> {
    this.log('getPage', collectionPath);
    this._getPageSpy.call(collectionPath, options);
    const all = (this.mockCollections.get(collectionPath) as ({ id: string } & Record<string, unknown>)[]) ?? [];

    let slice: typeof all;
    if (options.endBeforeDoc) {
      const cursor = options.endBeforeDoc;
      const i = all.findIndex(d => d.id === cursor.id);
      const end = i === -1 ? 0 : i;
      slice = all.slice(Math.max(0, end - options.limit), end);
    } else {
      let start = 0;
      if (options.startAfterDoc) {
        const cursor = options.startAfterDoc;
        const i = all.findIndex(d => d.id === cursor.id);
        start = i === -1 ? all.length : i + 1;
      } else if (options.startAtValues) {
        const order = options.orderBy?.[0];
        const field = order?.field ?? 'id';
        const desc = order?.direction === 'desc';
        const target = this.normalizeCursorValue(options.startAtValues[0]);
        start = all.findIndex(d => {
          const v = this.normalizeCursorValue(d[field]);
          return desc ? v <= target : v >= target;
        });
        if (start === -1) start = all.length;
      }
      slice = all.slice(start, start + options.limit);
    }

    return {
      items: slice as T[],
      snapshots: slice.map(d => ({ id: d.id }))
    };
  }

  private normalizeCursorValue(value: unknown): number | string {
    const maybeTimestamp = value as { toMillis?: () => number };
    if (typeof maybeTimestamp?.toMillis === 'function') return maybeTimestamp.toMillis();
    return value as number | string;
  }

  subscribeToCollection<T>(collectionPath: string, options?: unknown): Observable<T[]> {
    this.log('subscribeToCollection', collectionPath);
    this._subscribeToCollectionSpy.call(collectionPath, options);
    const data = (this.mockCollections.get(collectionPath) as T[]) ?? [];
    return of(data);
  }

  subscribeToDocument<T>(path: string): Observable<T | null> {
    this.log('subscribeToDocument', path);
    this._subscribeToDocumentSpy.call(path);
    const data = (this.mockData.get(path) as T) ?? null;
    return of(data);
  }

  // Answers as the server would: a seeded document, or a confirmed absence.
  subscribeToDocumentWithMetadata<T>(path: string): Observable<DocumentWithMetadata<T>> {
    this.log('subscribeToDocumentWithMetadata', path);
    this._subscribeToDocumentWithMetadataSpy.call(path);
    const data = (this.mockData.get(path) as T) ?? null;
    return of({ data, fromCache: false, hasPendingWrites: false });
  }

  // Answers as the server would: the seeded collection, confirmed.
  subscribeToCollectionWithMetadata<T>(collectionPath: string, options?: unknown): Observable<CollectionWithMetadata<T>> {
    this.log('subscribeToCollectionWithMetadata', collectionPath);
    this._subscribeToCollectionWithMetadataSpy.call(collectionPath, options);
    const docs = (this.mockCollections.get(collectionPath) as T[]) ?? [];
    return of({ docs, fromCache: false, hasPendingWrites: false });
  }

  async addDocument<T>(collectionPath: string, data: T): Promise<string> {
    this.log('addDocument', collectionPath);
    this._addDocumentSpy.call(collectionPath, data);
    const id = `mock-id-${Date.now()}`;
    return id;
  }

  async setDocument<T>(path: string, data: T, merge = false): Promise<void> {
    this.log('setDocument', path);
    this._setDocumentSpy.call(path, data, merge);
    this.mockData.set(path, data);
  }

  async updateDocument<T>(path: string, data: Partial<T>): Promise<void> {
    this.log('updateDocument', path);
    this._updateDocumentSpy.call(path, data);
    const existing = this.mockData.get(path) as T;
    if (existing) {
      this.mockData.set(path, { ...existing, ...data });
    }
  }

  async deleteDocument(path: string): Promise<void> {
    this.log('deleteDocument', path);
    this._deleteDocumentSpy.call(path);
    this.mockData.delete(path);
  }

  /**
   * Applies the batch to the seeded documents as the server would hold it
   * once committed, and records it; or refuses all of it and applies
   * nothing, as a refused commit lands nothing. The ops are recorded as
   * given: the real service's updatedAt stamp is neither added nor applied.
   *
   * Applied as the server applies it:
   * - a set replaces the document; a merge set merges nested maps key by key;
   * - an update's keys are dotted field paths, and each replaces its field;
   * - serverTimestamp() is held as a Timestamp of the moment of the call;
   * - arrayUnion adds only elements not already there, arrayRemove removes
   *   every match, both compared by value; deleteField() removes the field.
   *
   * Refused whole:
   * - by refuseBatch, with its answer;
   * - 'not-found', for an update of a document missing at that point in the
   *   batch: never seeded with setMockDocument or set earlier in the batch,
   *   or deleted earlier in it. Only this document map counts: a row seeded
   *   through setMockCollection alone is not a document here;
   * - 'invalid-argument', for an undefined value, as the SDK refuses it;
   * - for any other sentinel, which the mock cannot apply.
   *
   * This mock's updateDocument and runTransaction's update apply none of
   * this: they spread the data over the document as given.
   */
  async commitBatch(ops: readonly BatchOp[]): Promise<void> {
    const given = [...ops];
    this.log('commitBatch', undefined, given);
    this._commitBatchSpy.call(given);
    this.land(given, false);
  }

  /**
   * FirestoreService.commitOnline's commit: applied, refused and recorded
   * exactly as commitBatch's is, and flagged in `transactional`. Its own
   * spy and log entry tell it from a batch; runTransaction's spies and
   * beforeTransaction are left alone, since it reads nothing.
   */
  async commitOnline(ops: readonly BatchOp[]): Promise<void> {
    const given = [...ops];
    this.log('commitOnline', undefined, given);
    this._commitOnlineSpy.call(given);
    this.land(given, true);
  }

  private land(given: BatchOp[], transactional: boolean): void {
    const refusal = this.refuseBatch?.(given);
    if (refusal) throw refusal;

    const next = new Map(this.mockData);
    for (const op of given) {
      const existing = next.get(op.path);
      if (op.op === 'delete') {
        next.delete(op.path);
      } else if (op.op === 'update') {
        if (existing === undefined || existing === null) {
          throw firestoreError('not-found', `No document to update: ${op.path}`);
        }
        next.set(op.path, updateOf(existing as MockDoc, op.data));
      } else {
        next.set(op.path, op.merge ? mergeInto(existing, op.data, '') : resolveFresh(op.data, ''));
      }
    }
    this.mockData = next;
    this.batches.push(given);
    this.transactional.push(transactional);
  }

  async waitForPendingWrites(): Promise<void> {
    this.log('waitForPendingWrites');
    this._waitForPendingWritesSpy.call();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  generateId(_collectionPath: string): string {
    return `mock-id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getDocRef(path: string): { path: string } {
    return { path };
  }

  /**
   * Mirrors FirestoreService.runTransaction closely enough for race tests:
   * reads inside the callback see the map as it is NOW (after any
   * beforeTransaction rival), and writes buffer until the callback resolves —
   * a thrown callback commits nothing, like a real aborted transaction.
   */
  async runTransaction<T>(
    updateFn: (tx: {
      get: (ref: { path: string }) => Promise<{
        exists: () => boolean;
        data: () => unknown;
        id: string;
      }>;
      set: (ref: { path: string }, data: unknown) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
      delete: (ref: { path: string }) => void;
    }) => Promise<T>
  ): Promise<T> {
    this.log('runTransaction');
    this._runTransactionSpy.call();
    this.beforeTransaction?.();

    const buffered: (() => void)[] = [];
    const tx = {
      get: async (ref: { path: string }) => {
        this._txGetSpy.call(ref.path);
        const data = this.mockData.get(ref.path);
        return {
          exists: () => data !== undefined && data !== null,
          data: () => data,
          id: ref.path.split('/').pop() ?? ref.path,
        };
      },
      set: (ref: { path: string }, data: unknown) => {
        this._txSetSpy.call(ref.path, data);
        buffered.push(() => this.mockData.set(ref.path, data));
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        this._txUpdateSpy.call(ref.path, data);
        buffered.push(() => {
          const existing = this.mockData.get(ref.path);
          if (existing) {
            this.mockData.set(ref.path, { ...(existing as Record<string, unknown>), ...data });
          }
        });
      },
      delete: (ref: { path: string }) => {
        this._txDeleteSpy.call(ref.path);
        buffered.push(() => this.mockData.delete(ref.path));
      },
    };

    const result = await updateFn(tx);
    for (const commit of buffered) commit();
    return result;
  }

  getTimestamp(): Timestamp {
    return Timestamp.now();
  }

  dateToTimestamp(date: Date): Timestamp {
    return Timestamp.fromDate(date);
  }

  timestampToDate(timestamp: Timestamp): Date {
    return timestamp.toDate();
  }
}
