import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';

/**
 * The database the share-target service worker writes into. The DB name,
 * store name, version, and row shape are duplicated verbatim in
 * public/share-target-sw.js — a service worker cannot import TypeScript.
 * Change them together.
 */
export const SHARE_STASH_DB = 'homeaccount-share-intake';
export const SHARE_STASH_STORE = 'pending';
const SHARE_STASH_VERSION = 1;

/** One shared file, exactly as the worker stashed it. */
export interface StashedShare {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  receivedAt: number;
}

/**
 * App-side reader for the share stash. Opens per call and closes right
 * after: the worker opens this database too, and a held connection would
 * block a future versionchange.
 */
@Injectable({ providedIn: 'root' })
export class ShareStashStore {
  private async open(): Promise<IDBPDatabase> {
    return openDB(SHARE_STASH_DB, SHARE_STASH_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SHARE_STASH_STORE)) {
          db.createObjectStore(SHARE_STASH_STORE, { keyPath: 'id' });
        }
      }
    });
  }

  async readAll(): Promise<StashedShare[]> {
    const db = await this.open();
    try {
      return (await db.getAll(SHARE_STASH_STORE)) as StashedShare[];
    } finally {
      db.close();
    }
  }

  async count(): Promise<number> {
    const db = await this.open();
    try {
      return await db.count(SHARE_STASH_STORE);
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await this.open();
    try {
      await db.clear(SHARE_STASH_STORE);
    } finally {
      db.close();
    }
  }
}
