import { Injectable, effect, inject, untracked } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';

import { AuthService } from './auth.service';

/**
 * The database the share-target service worker writes into. The DB name,
 * store names, version, and row shape are duplicated verbatim in
 * public/share-target-sw.js — a service worker cannot import TypeScript.
 * Change them together.
 */
export const SHARE_STASH_DB = 'homeaccount-share-intake';
export const SHARE_STASH_STORE = 'pending';
export const SHARE_STASH_SESSION_STORE = 'session';
/**
 * v2 added `userId` to stashed rows plus the `session` store the worker
 * reads to stamp them. Rows written by v1 carry no owner and cannot be
 * safely attributed to anyone, so the upgrade drops them — guessing an
 * owner is the defect the version exists to fix (the offline queue's
 * v1→v2 made the same call).
 */
const SHARE_STASH_VERSION = 2;
/** How long an ownerless share stays claimable by the next session to sign in. */
export const SHARE_CLAIM_WINDOW_MS = 30 * 60 * 1000;

/** One shared file, exactly as the worker stashed it. */
export interface StashedShare {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  receivedAt: number;
  /**
   * The account signed in when the share arrived. Absent when nobody was —
   * the worker cannot see auth state, so ownerless rows are legal by
   * construction and governed by the claim window above.
   */
  userId?: string;
}

/**
 * App-side owner of the share stash. Opens per call and closes right after:
 * the worker opens this database too, and a held connection would block a
 * future versionchange — which is also why there are no blocked/blocking
 * handlers here, unlike the offline queue's long-lived connection.
 *
 * Reads are scoped to the signed-in account: a row stamped with another
 * account's uid is invisible, and an ownerless row is visible only while
 * fresh enough to plausibly belong to whoever is signing in now. Expired
 * ownerless rows are deleted in passing rather than surfaced — the policy
 * is documented in docs/share-import.md.
 */
@Injectable({ providedIn: 'root' })
export class ShareStashStore {
  private authService = inject(AuthService);

  constructor() {
    // The worker stamps new rows with whatever the session row holds; only
    // the app can know the session, so the app keeps that row current.
    effect(() => {
      const userId = this.authService.userId();
      untracked(() => void this.publishSessionOwner(userId));
    });
  }

  private async open(): Promise<IDBPDatabase> {
    return openDB(SHARE_STASH_DB, SHARE_STASH_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains(SHARE_STASH_STORE)) {
          db.createObjectStore(SHARE_STASH_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SHARE_STASH_SESSION_STORE)) {
          db.createObjectStore(SHARE_STASH_SESSION_STORE, { keyPath: 'id' });
        }
        if (oldVersion > 0 && oldVersion < 2) {
          // Pre-ownership rows: unattributable, so dropped, not guessed at.
          transaction.objectStore(SHARE_STASH_STORE).clear();
        }
      }
    });
  }

  private visibleTo(row: StashedShare, userId: string | null, now: number): boolean {
    if (row.userId) return row.userId === userId;
    return now - row.receivedAt <= SHARE_CLAIM_WINDOW_MS;
  }

  private isExpired(row: StashedShare, now: number): boolean {
    return !row.userId && now - row.receivedAt > SHARE_CLAIM_WINDOW_MS;
  }

  /** Rows the signed-in session may see; expired ownerless rows are deleted in passing. */
  async readAll(): Promise<StashedShare[]> {
    const db = await this.open();
    try {
      const tx = db.transaction(SHARE_STASH_STORE, 'readwrite');
      const rows = (await tx.store.getAll()) as StashedShare[];
      const now = Date.now();
      const userId = this.authService.userId();
      for (const row of rows) {
        if (this.isExpired(row, now)) void tx.store.delete(row.id);
      }
      await tx.done;
      return rows.filter(row => this.visibleTo(row, userId, now));
    } finally {
      db.close();
    }
  }

  async count(): Promise<number> {
    return (await this.readAll()).length;
  }

  /**
   * Visible rows, deleted in the same transaction that read them, so a
   * share the worker stashes mid-consume is never half-taken.
   */
  async consume(): Promise<StashedShare[]> {
    const db = await this.open();
    try {
      const tx = db.transaction(SHARE_STASH_STORE, 'readwrite');
      const rows = (await tx.store.getAll()) as StashedShare[];
      const now = Date.now();
      const userId = this.authService.userId();
      const consumed: StashedShare[] = [];
      for (const row of rows) {
        if (this.visibleTo(row, userId, now)) {
          consumed.push(row);
          void tx.store.delete(row.id);
        } else if (this.isExpired(row, now)) {
          void tx.store.delete(row.id);
        }
      }
      await tx.done;
      return consumed;
    } finally {
      db.close();
    }
  }

  /**
   * Everything, both stores — the account-deletion cascade's door. Scoping
   * lives in the reads; there is deliberately no sign-out hook (state is
   * cleared from the owning service, not from signOut()), and erasure is
   * device-scoped.
   */
  async clearAll(): Promise<void> {
    const db = await this.open();
    try {
      const tx = db.transaction([SHARE_STASH_STORE, SHARE_STASH_SESSION_STORE], 'readwrite');
      void tx.objectStore(SHARE_STASH_STORE).clear();
      void tx.objectStore(SHARE_STASH_SESSION_STORE).delete('current');
      await tx.done;
    } finally {
      db.close();
    }
  }

  private async publishSessionOwner(userId: string | null): Promise<void> {
    // IndexedDB being unavailable must never break an auth transition.
    try {
      const db = await this.open();
      try {
        if (userId) {
          await db.put(SHARE_STASH_SESSION_STORE, { id: 'current', userId });
        } else {
          await db.delete(SHARE_STASH_SESSION_STORE, 'current');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      console.warn('[ShareStash] Could not publish the session owner:', error);
    }
  }
}
