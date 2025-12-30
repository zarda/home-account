/// <reference types="jasmine" />
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

/**
 * Mock FirestoreService for unit testing
 */
@Injectable()
export class MockFirestoreService {
  // Store for mock data
  private mockData = new Map<string, unknown>();
  private mockCollections = new Map<string, unknown[]>();

  // Spies for verifying calls
  getDocumentSpy = jasmine.createSpy('getDocument');
  getCollectionSpy = jasmine.createSpy('getCollection');
  addDocumentSpy = jasmine.createSpy('addDocument');
  setDocumentSpy = jasmine.createSpy('setDocument');
  updateDocumentSpy = jasmine.createSpy('updateDocument');
  deleteDocumentSpy = jasmine.createSpy('deleteDocument');

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
    this.getDocumentSpy.calls.reset();
    this.getCollectionSpy.calls.reset();
    this.addDocumentSpy.calls.reset();
    this.setDocumentSpy.calls.reset();
    this.updateDocumentSpy.calls.reset();
    this.deleteDocumentSpy.calls.reset();
  }

  async getDocument<T>(path: string): Promise<T | null> {
    this.getDocumentSpy(path);
    return (this.mockData.get(path) as T) ?? null;
  }

  async getCollection<T>(collectionPath: string, options?: unknown): Promise<T[]> {
    this.getCollectionSpy(collectionPath, options);
    return (this.mockCollections.get(collectionPath) as T[]) ?? [];
  }

  subscribeToCollection<T>(collectionPath: string, options?: unknown): Observable<T[]> {
    this.getCollectionSpy(collectionPath, options);
    const data = (this.mockCollections.get(collectionPath) as T[]) ?? [];
    return of(data);
  }

  subscribeToDocument<T>(path: string): Observable<T | null> {
    this.getDocumentSpy(path);
    const data = (this.mockData.get(path) as T) ?? null;
    return of(data);
  }

  async addDocument<T>(collectionPath: string, data: T): Promise<string> {
    this.addDocumentSpy(collectionPath, data);
    const id = `mock-id-${Date.now()}`;
    return id;
  }

  async setDocument<T>(path: string, data: T, merge = false): Promise<void> {
    this.setDocumentSpy(path, data, merge);
    this.mockData.set(path, data);
  }

  async updateDocument<T>(path: string, data: Partial<T>): Promise<void> {
    this.updateDocumentSpy(path, data);
    const existing = this.mockData.get(path) as T;
    if (existing) {
      this.mockData.set(path, { ...existing, ...data });
    }
  }

  async deleteDocument(path: string): Promise<void> {
    this.deleteDocumentSpy(path);
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
