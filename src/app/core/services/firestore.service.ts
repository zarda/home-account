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

export interface PageResult<T> {
  items: T[];
  // Raw snapshots parallel to items, for use as cursors in subsequent pages.
  snapshots: QueryDocumentSnapshot<DocumentData>[];
}

type WhereFilterOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

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

  // Run an atomic read-then-write transaction. All reads see fresh server
  // data and the writes only commit if none of the read documents changed
  // underneath; note this requires the network and rejects while offline.
  async runTransaction<T>(
    updateFn: (transaction: FirestoreTransaction) => Promise<T>
  ): Promise<T> {
    return runTransaction(this.firestore, updateFn);
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
