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
  private _addDocumentSpy = new SimpleSpy();
  private _setDocumentSpy = new SimpleSpy();
  private _updateDocumentSpy = new SimpleSpy();
  private _deleteDocumentSpy = new SimpleSpy();

  get getDocumentSpy() { return this._getDocumentSpy; }
  get getCollectionSpy() { return this._getCollectionSpy; }
  get addDocumentSpy() { return this._addDocumentSpy; }
  get setDocumentSpy() { return this._setDocumentSpy; }
  get updateDocumentSpy() { return this._updateDocumentSpy; }
  get deleteDocumentSpy() { return this._deleteDocumentSpy; }

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
    this._addDocumentSpy.reset();
    this._setDocumentSpy.reset();
    this._updateDocumentSpy.reset();
    this._deleteDocumentSpy.reset();
  }

  async getDocument<T>(path: string): Promise<T | null> {
    this._getDocumentSpy.call(path);
    return (this.mockData.get(path) as T) ?? null;
  }

  async getCollection<T>(collectionPath: string, options?: unknown): Promise<T[]> {
    this._getCollectionSpy.call(collectionPath, options);
    return (this.mockCollections.get(collectionPath) as T[]) ?? [];
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
