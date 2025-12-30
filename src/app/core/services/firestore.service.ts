import { Injectable, inject } from '@angular/core';
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
  startAfter,
  QueryConstraint,
  DocumentData,
  CollectionReference,
  DocumentReference,
  Timestamp,
  onSnapshot,
  QuerySnapshot
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface QueryOptions {
  where?: { field: string; op: WhereFilterOp; value: unknown }[];
  orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
  limit?: number;
  startAfter?: unknown;
}

type WhereFilterOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'array-contains-any' | 'in' | 'not-in';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private firestore = inject(Firestore);

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

  // Real-time subscription to a collection
  subscribeToCollection<T>(
    collectionPath: string,
    options?: QueryOptions
  ): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
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
  }

  // Real-time subscription to a single document
  subscribeToDocument<T>(path: string): Observable<T | null> {
    return new Observable<T | null>((subscriber) => {
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
