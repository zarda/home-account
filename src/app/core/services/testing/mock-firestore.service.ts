import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

// Simple spy implementation that works without jasmine in production builds
interface SpyCall {
  args: unknown[];
}

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
  private _getPageSpy = new SimpleSpy();
  private _addDocumentSpy = new SimpleSpy();
  private _setDocumentSpy = new SimpleSpy();
  private _updateDocumentSpy = new SimpleSpy();
  private _deleteDocumentSpy = new SimpleSpy();
  private _runTransactionSpy = new SimpleSpy();
  private _txUpdateSpy = new SimpleSpy();
  private _txSetSpy = new SimpleSpy();

  get getDocumentSpy() { return this._getDocumentSpy; }
  get getCollectionSpy() { return this._getCollectionSpy; }
  get getPageSpy() { return this._getPageSpy; }
  get addDocumentSpy() { return this._addDocumentSpy; }
  get setDocumentSpy() { return this._setDocumentSpy; }
  get updateDocumentSpy() { return this._updateDocumentSpy; }
  get deleteDocumentSpy() { return this._deleteDocumentSpy; }
  get runTransactionSpy() { return this._runTransactionSpy; }
  get txUpdateSpy() { return this._txUpdateSpy; }
  get txSetSpy() { return this._txSetSpy; }

  /**
   * Invoked at the start of every runTransaction call, before the callback's
   * first read. Tests use it to mutate the seeded documents between a
   * service's optimistic read and its transaction — the shape of a rival
   * client committing in that window. Set it to undefined inside the hook for
   * a one-shot rival.
   */
  beforeTransaction?: () => void;

  // Set mock data for a document path
  setMockDocument(path: string, data: unknown): void {
    this.mockData.set(path, data);
  }

  // Set mock data for a collection path
  setMockCollection(path: string, data: unknown[]): void {
    this.mockCollections.set(path, data);
  }

  // Clear all mock data
  clearMocks(): void {
    this.mockData.clear();
    this.mockCollections.clear();
    this._getDocumentSpy.reset();
    this._getCollectionSpy.reset();
    this._getPageSpy.reset();
    this._addDocumentSpy.reset();
    this._setDocumentSpy.reset();
    this._updateDocumentSpy.reset();
    this._deleteDocumentSpy.reset();
    this._runTransactionSpy.reset();
    this._txUpdateSpy.reset();
    this._txSetSpy.reset();
    this.beforeTransaction = undefined;
  }

  async getDocument<T>(path: string): Promise<T | null> {
    this._getDocumentSpy.call(path);
    return (this.mockData.get(path) as T) ?? null;
  }

  async getCollection<T>(collectionPath: string, options?: unknown): Promise<T[]> {
    this._getCollectionSpy.call(collectionPath, options);
    return (this.mockCollections.get(collectionPath) as T[]) ?? [];
  }

  async countDocuments(collectionPath: string, options?: unknown): Promise<number> {
    this._getCollectionSpy.call(collectionPath, options);
    return (this.mockCollections.get(collectionPath) ?? []).length;
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
    this._getCollectionSpy.call(collectionPath, options);
    const data = (this.mockCollections.get(collectionPath) as T[]) ?? [];
    return of(data);
  }

  subscribeToDocument<T>(path: string): Observable<T | null> {
    this._getDocumentSpy.call(path);
    const data = (this.mockData.get(path) as T) ?? null;
    return of(data);
  }

  async addDocument<T>(collectionPath: string, data: T): Promise<string> {
    this._addDocumentSpy.call(collectionPath, data);
    const id = `mock-id-${Date.now()}`;
    return id;
  }

  async setDocument<T>(path: string, data: T, merge = false): Promise<void> {
    this._setDocumentSpy.call(path, data, merge);
    this.mockData.set(path, data);
  }

  async updateDocument<T>(path: string, data: Partial<T>): Promise<void> {
    this._updateDocumentSpy.call(path, data);
    const existing = this.mockData.get(path) as T;
    if (existing) {
      this.mockData.set(path, { ...existing, ...data });
    }
  }

  async deleteDocument(path: string): Promise<void> {
    this._deleteDocumentSpy.call(path);
    this.mockData.delete(path);
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
    this._runTransactionSpy.call();
    this.beforeTransaction?.();

    const buffered: (() => void)[] = [];
    const tx = {
      get: async (ref: { path: string }) => {
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
