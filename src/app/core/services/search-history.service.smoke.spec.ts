// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  getDocs,
  Firestore
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { MAX_RECENT_SEARCHES, SearchHistoryService } from './search-history.service';

/**
 * Integration smoke test for SearchHistoryService against the Firestore
 * emulator: the full lifecycle of `users/{uid}/savedSearches` — recording,
 * case-insensitive dedupe, pruning past the recents cap, pinning, and
 * deletion — with real document writes, server ordering, and the timestamp
 * stamping the unit-level mock cannot exercise.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('SearchHistoryService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let service: SearchHistoryService;

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `search-history-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    // A fresh anonymous user per run keeps the collection isolated; no
    // cross-run cleanup needed.
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SearchHistoryService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid } }
      ]
    });
    service = TestBed.inject(SearchHistoryService);
  });

  // The service state is signal-based off a live subscription; a one-shot
  // reload keeps each assertion deterministic instead of racing onSnapshot.
  async function reload(): Promise<void> {
    await firstValueFrom(service.loadSearches());
  }

  // Timestamp.now() has millisecond resolution; consecutive writes need a
  // beat between them for a strict lastUsedAt order.
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));

  it('runs the full record / dedupe / pin / prune / delete lifecycle', async () => {
    // Record two queries; newest-first order by lastUsedAt.
    await service.recordRecent('starbucks');
    await settle();
    await service.recordRecent('utilities');
    await reload();

    expect(service.recentSearches().map(s => s.query)).toEqual(['utilities', 'starbucks']);
    const first = service.recentSearches()[1];
    expect(first.createdAt).toBeDefined();
    expect(first.updatedAt).toBeDefined();

    // Re-recording dedupes case-insensitively: no new doc, recency refreshed.
    await settle();
    await service.recordRecent('STARBUCKS');
    await reload();

    expect(service.recentSearches().map(s => s.query)).toEqual(['starbucks', 'utilities']);
    expect(service.recentSearches().length).toBe(2);

    // Pinning an existing query converts it in place.
    await service.saveSearch('utilities', 'Bills');
    await reload();

    expect(service.savedSearches().map(s => s.label)).toEqual(['Bills']);
    expect(service.recentSearches().map(s => s.query)).toEqual(['starbucks']);

    // Filling the history past the cap prunes the oldest unpinned entry
    // ("starbucks") but never the pinned one.
    for (let i = 0; i < MAX_RECENT_SEARCHES; i++) {
      await settle();
      await service.recordRecent(`filler query ${i}`);
      await reload();
    }

    expect(service.recentSearches().length).toBe(MAX_RECENT_SEARCHES);
    expect(service.recentSearches().some(s => s.query === 'starbucks')).toBeFalse();
    expect(service.savedSearches().map(s => s.query)).toEqual(['utilities']);

    const snapshot = await getDocs(collection(firestore, `users/${uid}/savedSearches`));
    expect(snapshot.size).toBe(MAX_RECENT_SEARCHES + 1);

    // Deleting removes the document for real.
    const pinnedId = service.savedSearches()[0].id;
    await service.deleteSearch(pinnedId);
    await reload();

    expect(service.savedSearches()).toEqual([]);
    const afterDelete = await getDocs(collection(firestore, `users/${uid}/savedSearches`));
    expect(afterDelete.size).toBe(MAX_RECENT_SEARCHES);
  });
});
