import { TestBed } from '@angular/core/testing';
import { openDB } from 'idb';
import {
  SHARE_STASH_DB,
  SHARE_STASH_STORE,
  ShareStashStore,
  StashedShare
} from './share-stash.store';

/**
 * Runs against the browser's real IndexedDB: the store's whole job is to
 * read rows the share-target service worker wrote with the raw IDB API, so
 * a mocked database would prove nothing about the shared schema.
 */
describe('ShareStashStore', () => {
  let store: ShareStashStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [ShareStashStore] });
    store = TestBed.inject(ShareStashStore);
    // Also creates the database and store on the first run.
    await store.clear();
  });

  /** Seeds the way the service worker writes: raw rows keyed by id. */
  async function seed(id: string, name: string): Promise<void> {
    const db = await openDB(SHARE_STASH_DB, 1);
    await db.put(SHARE_STASH_STORE, {
      id,
      name,
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: 1
    } satisfies StashedShare);
    db.close();
  }

  it('reads back what was stashed', async () => {
    await seed('s1', 'a.png');
    await seed('s2', 'b.png');

    expect(await store.count()).toBe(2);
    const rows = await store.readAll();
    expect(rows.map(r => r.id).sort()).toEqual(['s1', 's2']);
    expect(rows[0].blob instanceof Blob).toBeTrue();
  });

  it('clear empties the stash', async () => {
    await seed('s1', 'a.png');

    await store.clear();

    expect(await store.count()).toBe(0);
    expect(await store.readAll()).toEqual([]);
  });
});
