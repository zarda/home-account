import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { openDB } from 'idb';
import {
  SHARE_CLAIM_WINDOW_MS,
  SHARE_STASH_DB,
  SHARE_STASH_SESSION_STORE,
  SHARE_STASH_STORE,
  ShareStashStore,
  StashedShare
} from './share-stash.store';
import { AuthService } from './auth.service';

/**
 * Runs against the browser's real IndexedDB: the store's whole job is to
 * read rows the share-target service worker wrote with the raw IDB API, so
 * a mocked database would prove nothing about the shared schema.
 *
 * Nothing here calls deleteDB: it blocks on any connection a suite still
 * holds open, which is a documented source of flakiness in the offline
 * queue's spec. What is asserted is the shape the app opens and the
 * behavior over seeded rows, not a migration replay.
 */
describe('ShareStashStore', () => {
  let store: ShareStashStore;
  let userId: ReturnType<typeof signal<string | null>>;

  beforeEach(async () => {
    userId = signal<string | null>('user-a');
    TestBed.configureTestingModule({
      providers: [ShareStashStore, { provide: AuthService, useValue: { userId } }]
    });
    store = TestBed.inject(ShareStashStore);
    // Also creates the database and stores on the first run.
    await store.clearAll();
  });

  /** Flushes the session-publishing effect. */
  async function settle(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
    }
  }

  /**
   * Seeds the way the service worker writes: raw rows keyed by id. Opened
   * versionless so the seed rides whatever version the app created.
   */
  async function seed(id: string, overrides: Partial<StashedShare> = {}): Promise<void> {
    const db = await openDB(SHARE_STASH_DB);
    await db.put(SHARE_STASH_STORE, {
      id,
      name: `${id}.png`,
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: Date.now(),
      userId: 'user-a',
      ...overrides
    } satisfies StashedShare);
    db.close();
  }

  async function rawIds(): Promise<string[]> {
    const db = await openDB(SHARE_STASH_DB);
    const rows = (await db.getAll(SHARE_STASH_STORE)) as StashedShare[];
    db.close();
    return rows.map(row => row.id).sort();
  }

  it('reads back what was stashed', async () => {
    await seed('s1');
    await seed('s2');

    expect(await store.count()).toBe(2);
    const rows = await store.readAll();
    expect(rows.map(r => r.id).sort()).toEqual(['s1', 's2']);
    expect(rows[0].blob instanceof Blob).toBeTrue();
  });

  it('clearAll empties the stash', async () => {
    await seed('s1');

    await store.clearAll();

    expect(await store.count()).toBe(0);
    expect(await store.readAll()).toEqual([]);
  });

  describe('account isolation', () => {
    // The regression #253 reports: the stash is one device-global IndexedDB,
    // and without an owner recorded a receipt shared by one account was
    // surfaced to — and consumed by — whoever signed in next.
    it('hides one account\'s stashed shares from another', async () => {
      await seed('a1', { userId: 'user-a' });
      userId.set('user-b');

      expect(await store.count()).toBe(0);
      expect(await store.readAll()).toEqual([]);
    });

    it('gives them back when the owning account returns', async () => {
      await seed('a1', { userId: 'user-a' });
      userId.set('user-b');
      expect(await store.count()).toBe(0);

      userId.set('user-a');

      expect((await store.readAll()).map(r => r.id)).toEqual(['a1']);
    });

    it('consume removes exactly the rows it returned and leaves foreign rows', async () => {
      await seed('mine', { userId: 'user-a' });
      await seed('theirs', { userId: 'user-b' });

      const consumed = await store.consume();

      expect(consumed.map(r => r.id)).toEqual(['mine']);
      expect(await rawIds()).toEqual(['theirs']);
    });

    it('counts only the visible rows', async () => {
      await seed('mine', { userId: 'user-a' });
      await seed('theirs', { userId: 'user-b' });

      expect(await store.count()).toBe(1);
    });
  });

  describe('the claim window', () => {
    it('lets the next session claim a fresh ownerless share', async () => {
      // A share made while nobody was signed in: no owner recorded.
      await seed('fresh', { userId: undefined });

      const consumed = await store.consume();

      expect(consumed.map(r => r.id)).toEqual(['fresh']);
    });

    it('deletes an ownerless share past the window instead of surfacing it', async () => {
      await seed('stale', {
        userId: undefined,
        receivedAt: Date.now() - SHARE_CLAIM_WINDOW_MS - 1000
      });

      expect(await store.readAll()).toEqual([]);
      // Janitored, not merely hidden: the bytes are gone.
      expect(await rawIds()).toEqual([]);
    });

    it('never expires a share that has an owner', async () => {
      await seed('old-but-owned', {
        userId: 'user-a',
        receivedAt: Date.now() - SHARE_CLAIM_WINDOW_MS * 10
      });

      expect((await store.readAll()).map(r => r.id)).toEqual(['old-but-owned']);
    });
  });

  describe('the session row', () => {
    it('publishes the signed-in account for the worker to stamp', async () => {
      userId.set('user-a');
      await settle();

      const db = await openDB(SHARE_STASH_DB);
      const row = await db.get(SHARE_STASH_SESSION_STORE, 'current');
      db.close();
      expect(row).toEqual({ id: 'current', userId: 'user-a' });
    });

    it('removes the session row at sign-out', async () => {
      userId.set('user-a');
      await settle();
      userId.set(null);
      await settle();

      const db = await openDB(SHARE_STASH_DB);
      const row = await db.get(SHARE_STASH_SESSION_STORE, 'current');
      db.close();
      expect(row).toBeUndefined();
    });
  });

  describe('schema', () => {
    it('opens with the pending and session stores', async () => {
      const db = await openDB(SHARE_STASH_DB);
      const names = Array.from(db.objectStoreNames).sort();
      db.close();
      expect(names).toEqual([SHARE_STASH_STORE, SHARE_STASH_SESSION_STORE].sort());
    });
  });
});
