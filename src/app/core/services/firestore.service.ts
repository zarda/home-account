import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  startAfter,
  startAt,
  endBefore,
  getCountFromServer,
  getDocsFromServer,
  getAggregateFromServer,
  count,
  sum,
  writeBatch,
  waitForPendingWrites,
  serverTimestamp,
  AggregateField,
  TransactionOptions,
  QueryConstraint,
  QueryDocumentSnapshot,
  DocumentData,
  CollectionReference,
  DocumentReference,
  Timestamp,
  onSnapshot,
  QuerySnapshot,
  runTransaction,
  Transaction as FirestoreTransaction
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface QueryOptions {
  where?: { field: string; op: WhereFilterOp; value: unknown }[];
  orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
  limit?: number;
  startAfter?: unknown;
}

// Options for cursor-based page fetches (getPage). Exactly one cursor mode is
// honored, in this precedence order: endBeforeDoc (backward page), then
// startAfterDoc (forward page), then startAtValues (re-anchor by field values),
// else the page starts at the beginning of the query.
export interface PageQueryOptions {
  where?: QueryOptions['where'];
  orderBy?: QueryOptions['orderBy'];
  limit: number;
  startAfterDoc?: QueryDocumentSnapshot<DocumentData>;
  endBeforeDoc?: QueryDocumentSnapshot<DocumentData>;
  startAtValues?: unknown[];
}

/**
 * One emission of subscribeToDocumentWithMetadata. The server confirmed it
 * only when both flags are false.
 */
export interface DocumentWithMetadata<T> {
  /** The document with its id merged in, or null when it does not exist. */
  data: T | null;
  /** True while the listener is not in sync with the server. */
  fromCache: boolean;
  /** True when `data` includes a local write the server has not committed yet. */
  hasPendingWrites: boolean;
}

export interface PageResult<T> {
  items: T[];
  // Raw snapshots parallel to items, for use as cursors in subsequent pages.
  snapshots: QueryDocumentSnapshot<DocumentData>[];
}

type WhereFilterOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

/**
 * How a commitBatch set or update stamps `updatedAt`. A stamp overwrites
 * any `updatedAt` the op's data carries, a `serverTimestamp()` included.
 * - 'client', the default: `Timestamp.now()`, the device clock, as
 *   setDocument and updateDocument stamp it.
 * - 'server': `serverTimestamp()`, the commit's own time, for a document
 *   whose rules pin `updatedAt` to request.time.
 * - false: no stamp, and the data is sent exactly as given, for a document
 *   whose rules allow no `updatedAt`.
 */
export type BatchStamp = 'client' | 'server' | false;

/**
 * One write in a commitBatch commit. Any sentinel an op carries
 * (serverTimestamp, arrayUnion, arrayRemove, deleteField) must be built
 * from '@angular/fire/firestore', never from the root 'firebase/firestore':
 * the root import loads a second copy of the SDK, whose sentinels the
 * client this app runs does not recognise.
 */
export type BatchOp =
  | { op: 'set'; path: string; data: DocumentData; merge?: boolean; stamp?: BatchStamp }
  | { op: 'update'; path: string; data: DocumentData; stamp?: BatchStamp }
  | { op: 'delete'; path: string };

/** What an aggregateFromServer call asks for; at least one part. */
export interface AggregateFields {
  /** Count the matching documents. */
  count?: boolean;
  /** Sum this field over the matching documents. */
  sum?: string;
}

/** An aggregateFromServer answer: exactly the parts that were asked for. */
export interface AggregateTotals {
  count?: number;
  sum?: number;
}

// A type alias rather than an interface: only an alias is assignable to the
// SDK's index-signature AggregateSpec.
export type AggregateRequest = Partial<Record<'count' | 'sum', AggregateField<number>>>;

/**
 * Refuses a request for neither a count nor a sum. It builds no SDK object,
 * so the mock applies the same check.
 */
export function assertAggregateAsks(fields: AggregateFields): void {
  if (!fields.count && !fields.sum) {
    throw new Error('aggregateFromServer needs a count or sum to ask for');
  }
}

/** The aggregation a request asks the server for, one field per part. */
export function aggregateSpecOf(fields: AggregateFields): AggregateRequest {
  assertAggregateAsks(fields);
  const spec: AggregateRequest = {};
  if (fields.count) spec.count = count();
  if (fields.sum) spec.sum = sum(fields.sum);
  return spec;
}

/** The server's answer, cut to the parts the request asked for. */
export function aggregateTotalsOf(fields: AggregateFields, data: AggregateTotals): AggregateTotals {
  return {
    ...(fields.count ? { count: data.count } : {}),
    ...(fields.sum ? { sum: data.sum } : {})
  };
}

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private firestore = inject(Firestore);
  private injector = inject(EnvironmentInjector);

  // Get a collection reference
  getCollectionRef<T = DocumentData>(path: string): CollectionReference<T> {
    return collection(this.firestore, path) as CollectionReference<T>;
  }

  // Get a document reference
  getDocRef<T = DocumentData>(path: string): DocumentReference<T> {
    return doc(this.firestore, path) as DocumentReference<T>;
  }

  // Get a single document by path
  async getDocument<T>(path: string): Promise<T | null> {
    const docRef = doc(this.firestore, path);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as T;
    }
    return null;
  }

  // Like getDocument, but answered by the server as the rules stand now, or
  // not at all: it rejects when the rules refuse the read or the server
  // cannot be reached. Neither getDoc nor getDocFromServer can promise that.
  // Both join a listener already attached to the document and answer with
  // what it last heard, which can be a local write the server will refuse
  // or a state the server has since moved past; getDocFromServer only
  // refuses an answer the listener marks as from the cache. A transaction's
  // read always goes to the server, and this one is abandoned before it
  // commits, so it writes nothing.
  //
  // It makes one attempt: the transaction runner would otherwise retry an
  // unreachable server with backoff, and a read gains nothing from that. A
  // request the browser fails at once rejects 'unavailable' at once. No
  // client timeout bounds the attempt, though (the SDK's request timeout is
  // dropped by the transport it ships with), so on a network that silently
  // drops traffic it waits as long as the browser does. A caller that needs
  // a bounded wait has to add its own deadline.
  async getDocumentFromServer<T>(path: string): Promise<T | null> {
    const readOnly = new Error('read only');
    let found: T | null = null;
    try {
      await this.runTransaction(async tx => {
        const snap = await tx.get(doc(this.firestore, path));
        found = snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
        throw readOnly;
      }, { maxAttempts: 1 });
    } catch (error) {
      if (error !== readOnly) throw error;
    }
    return found;
  }

  // Get all documents from a collection with optional query options
  async getCollection<T>(collectionPath: string, options?: QueryOptions): Promise<T[]> {
    const collectionRef = collection(this.firestore, collectionPath);
    const constraints = this.buildQueryConstraints(options);
    const q = query(collectionRef, ...constraints);
    const querySnap = await getDocs(q);

    return querySnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as T[];
  }

  // Like getCollection, but answered by the server or not at all: with the
  // persistent cache enabled, getDocs falls back to whatever the cache holds
  // when the server is unreachable, which silently shrinks reads that must
  // see the whole collection. This variant rejects ('unavailable') instead —
  // for reads whose caller has to fail loudly rather than accept a subset.
  async getCollectionFromServer<T>(collectionPath: string, options?: QueryOptions): Promise<T[]> {
    const collectionRef = collection(this.firestore, collectionPath);
    const constraints = this.buildQueryConstraints(options);
    const q = query(collectionRef, ...constraints);
    const querySnap = await getDocsFromServer(q);

    return querySnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as T[];
  }

  // One-shot page fetch for cursor-based windowed lists. Returns the raw
  // document snapshots alongside the mapped items so callers can page from
  // exact document cursors — these disambiguate equal orderBy values via the
  // implicit document-ID tiebreaker, which value cursors cannot do.
  async getPage<T>(collectionPath: string, options: PageQueryOptions): Promise<PageResult<T>> {
    const collectionRef = collection(this.firestore, collectionPath);
    const constraints: QueryConstraint[] = [];

    for (const w of options.where ?? []) {
      constraints.push(where(w.field, w.op, w.value));
    }
    for (const o of options.orderBy ?? []) {
      constraints.push(orderBy(o.field, o.direction ?? 'asc'));
    }

    if (options.endBeforeDoc) {
      // Backward page: the `limit` docs immediately preceding the cursor,
      // still returned in query order (no client-side reversal needed).
      constraints.push(endBefore(options.endBeforeDoc), limitToLast(options.limit));
    } else if (options.startAfterDoc) {
      constraints.push(startAfter(options.startAfterDoc), limit(options.limit));
    } else if (options.startAtValues) {
      constraints.push(startAt(...options.startAtValues), limit(options.limit));
    } else {
      constraints.push(limit(options.limit));
    }

    const querySnap = await getDocs(query(collectionRef, ...constraints));
    return {
      items: querySnap.docs.map(d => ({ id: d.id, ...d.data() })) as T[],
      snapshots: querySnap.docs
    };
  }

  // Count documents matching a query without downloading them
  // (server-side aggregation, billed as one read per 1000 matches)
  async countDocuments(collectionPath: string, options?: QueryOptions): Promise<number> {
    const collectionRef = collection(this.firestore, collectionPath);
    const constraints = this.buildQueryConstraints(options);
    const q = query(collectionRef, ...constraints);
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  }

  // A count and a sum over a query in one server-side aggregation, billed as
  // countDocuments is. It is answered by the server or rejects: no cache or
  // listener ever answers it. The server sums numbers only and skips any
  // other value the field holds.
  async aggregateFromServer(
    collectionPath: string,
    options: QueryOptions | undefined,
    fields: AggregateFields
  ): Promise<AggregateTotals> {
    const spec = aggregateSpecOf(fields);
    const collectionRef = collection(this.firestore, collectionPath);
    const q = query(collectionRef, ...this.buildQueryConstraints(options));
    const snapshot = await getAggregateFromServer(q, spec);
    return aggregateTotalsOf(fields, snapshot.data());
  }

  // Real-time subscription to a collection
  subscribeToCollection<T>(
    collectionPath: string,
    options?: QueryOptions
  ): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
      // Run within injection context to prevent AngularFire warnings
      return runInInjectionContext(this.injector, () => {
        const collectionRef = collection(this.firestore, collectionPath);
        const constraints = this.buildQueryConstraints(options);
        const q = query(collectionRef, ...constraints);

        const unsubscribe = onSnapshot(
          q,
          (snapshot: QuerySnapshot) => {
            const data = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })) as T[];
            subscriber.next(data);
          },
          (error) => {
            subscriber.error(error);
          }
        );

        return () => unsubscribe();
      });
    });
  }

  // Real-time subscription to a single document
  subscribeToDocument<T>(path: string): Observable<T | null> {
    return new Observable<T | null>((subscriber) => {
      // Run within injection context to prevent AngularFire warnings
      return runInInjectionContext(this.injector, () => {
        const docRef = doc(this.firestore, path);

        const unsubscribe = onSnapshot(
          docRef,
          (snapshot) => {
            if (snapshot.exists()) {
              subscriber.next({ id: snapshot.id, ...snapshot.data() } as T);
            } else {
              subscriber.next(null);
            }
          },
          (error) => {
            subscriber.error(error);
          }
        );

        return () => unsubscribe();
      });
    });
  }

  // Like subscribeToDocument, but each emission carries the snapshot's
  // metadata, so a caller can tell a server-confirmed answer from a guess.
  // A null from the cache means only "nothing cached": an uncached document
  // reads null while offline. And fromCache false alone is not confirmation:
  // it says the listener is in sync, while a latency-compensated local write
  // (a pending delete included) emits with fromCache false and
  // hasPendingWrites true. Metadata-only changes are delivered too, so the
  // move from cache or pending to confirmed is heard even when the data is
  // unchanged.
  subscribeToDocumentWithMetadata<T>(path: string): Observable<DocumentWithMetadata<T>> {
    return new Observable<DocumentWithMetadata<T>>((subscriber) => {
      // Run within injection context to prevent AngularFire warnings
      return runInInjectionContext(this.injector, () => {
        const docRef = doc(this.firestore, path);

        const unsubscribe = onSnapshot(
          docRef,
          { includeMetadataChanges: true },
          (snapshot) => {
            subscriber.next({
              data: snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null,
              fromCache: snapshot.metadata.fromCache,
              hasPendingWrites: snapshot.metadata.hasPendingWrites
            });
          },
          (error) => {
            subscriber.error(error);
          }
        );

        return () => unsubscribe();
      });
    });
  }

  // Add a new document with auto-generated ID
  async addDocument<T extends DocumentData>(
    collectionPath: string,
    data: T
  ): Promise<string> {
    const collectionRef = collection(this.firestore, collectionPath);
    const docRef = await addDoc(collectionRef, {
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    return docRef.id;
  }

  // Set a document with a specific ID
  async setDocument<T extends DocumentData>(
    path: string,
    data: T,
    merge = false
  ): Promise<void> {
    const docRef = doc(this.firestore, path);
    await setDoc(docRef, {
      ...data,
      updatedAt: Timestamp.now()
    }, { merge });
  }

  // Update an existing document
  async updateDocument<T extends DocumentData>(
    path: string,
    data: Partial<T>
  ): Promise<void> {
    const docRef = doc(this.firestore, path);
    await updateDoc(docRef, {
      ...data,
      updatedAt: Timestamp.now()
    } as DocumentData);
  }

  // Delete a document
  async deleteDocument(path: string): Promise<void> {
    const docRef = doc(this.firestore, path);
    await deleteDoc(docRef);
  }

  // Commits the ops as one batch: every write lands or none does, and a
  // single refused write refuses the whole commit. The writes are issued in
  // the order given before this returns, so a write issued after the call
  // cannot overtake them in the local cache or the persistent mutation
  // queue. The promise settles only when the server accepts or refuses the
  // commit; offline it stays pending until the connection returns. The
  // server refuses a commit of more than 500 writes. An op the SDK refuses
  // before sending, such as one carrying an undefined value or naming no
  // document, rejects the promise and is never thrown; nothing in the batch
  // is sent.
  //
  // Nothing may be awaited before batch.commit(): the ordering above holds
  // only while every write is issued before this first returns.
  async commitBatch(ops: readonly BatchOp[]): Promise<void> {
    const batch = writeBatch(this.firestore);
    for (const op of ops) {
      const ref = doc(this.firestore, op.path);
      if (op.op === 'delete') {
        batch.delete(ref);
      } else if (op.op === 'update') {
        batch.update(ref, this.stamped(op));
      } else {
        batch.set(ref, this.stamped(op), { merge: op.merge ?? false });
      }
    }
    return batch.commit();
  }

  private stamped(op: Exclude<BatchOp, { op: 'delete' }>): DocumentData {
    const stamp = op.stamp ?? 'client';
    if (stamp === false) return op.data;
    return { ...op.data, updatedAt: stamp === 'server' ? serverTimestamp() : Timestamp.now() };
  }

  // Run an atomic read-then-write transaction. All reads see fresh server
  // data and the writes only commit if none of the read documents changed
  // underneath; note this requires the network and rejects while offline.
  async runTransaction<T>(
    updateFn: (transaction: FirestoreTransaction) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    return runTransaction(this.firestore, updateFn, options);
  }

  // Resolves once the server has answered, accepting or refusing, every
  // write this client issued before the call; writes issued later are not
  // waited for. Offline it stays pending until the connection returns.
  async waitForPendingWrites(): Promise<void> {
    return waitForPendingWrites(this.firestore);
  }

  // Helper to build query constraints from options
  private buildQueryConstraints(options?: QueryOptions): QueryConstraint[] {
    const constraints: QueryConstraint[] = [];

    if (options?.where) {
      for (const w of options.where) {
        constraints.push(where(w.field, w.op, w.value));
      }
    }

    if (options?.orderBy) {
      for (const o of options.orderBy) {
        constraints.push(orderBy(o.field, o.direction ?? 'asc'));
      }
    }

    if (options?.limit) {
      constraints.push(limit(options.limit));
    }

    if (options?.startAfter) {
      constraints.push(startAfter(options.startAfter));
    }

    return constraints;
  }

  // Generate a unique ID
  generateId(collectionPath: string): string {
    const collectionRef = collection(this.firestore, collectionPath);
    return doc(collectionRef).id;
  }

  // Batch write helper - returns timestamp for use in operations
  getTimestamp(): Timestamp {
    return Timestamp.now();
  }

  // Convert Date to Firestore Timestamp
  dateToTimestamp(date: Date): Timestamp {
    return Timestamp.fromDate(date);
  }

  // Convert Firestore Timestamp to Date
  timestampToDate(timestamp: Timestamp): Date {
    return timestamp.toDate();
  }
}
