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
  doc,
  getDocs,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { MAX_SEARCH_ANSWERS, SearchAnswerHistoryService } from './search-answer-history.service';
import { createTransaction } from './testing/test-data';
import { AggregateAnswer, SearchAnswerRecord, SearchRecord } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for SearchAnswerHistoryService against the Firestore
 * emulator: the full lifecycle of `users/{uid}/searchAnswers` — recording a
 * snapshot, identity dedupe, refresh clearing vanished optionals with real
 * deleteField sentinels, recency touch, cap pruning against server ordering,
 * and deletion — with the live security rules validating every write, which
 * the unit-level mock cannot exercise.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('SearchAnswerHistoryService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let service: SearchAnswerHistoryService;

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `search-answers-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SearchAnswerHistoryService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        // currentUser stays null: baseCurrencyOf(null) falls back to USD,
        // which is also what the fixtures compute in.
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } }
      ]
    });
    service = TestBed.inject(SearchAnswerHistoryService);
  });

  // Each test signs in a fresh anonymous user so its collection starts empty;
  // signInAnonymously reuses a signed-in anonymous user, hence the sign-out.
  async function freshUser(): Promise<void> {
    await auth.signOut().catch(() => undefined);
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  }

  // The service state is signal-based off a live subscription; a one-shot
  // reload keeps each assertion deterministic instead of racing onSnapshot.
  async function reload(): Promise<void> {
    await firstValueFrom(service.loadAnswers());
  }

  // Timestamp.now() has millisecond resolution; consecutive writes need a
  // beat between them for strict computedAt / lastUsedAt ordering.
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));

  const augustScope = () => ({
    startDate: new Date(2026, 7, 1),
    endDate: new Date(2026, 7, 31, 23, 59, 59, 999),
  });

  const sumAnswer = (overrides: Partial<AggregateAnswer> = {}): AggregateAnswer => ({
    operation: 'sum',
    value: 421.5,
    currency: 'USD',
    transactionCount: 17,
    scope: augustScope(),
    ...overrides,
  });

  // The collection holds both kinds now, so the aggregate-only assertions
  // below have to say which one they mean.
  const asAnswer = (record: SearchRecord | undefined): SearchAnswerRecord => {
    if (!record || record.kind !== 'aggregate') {
      throw new Error(`expected an aggregate record, got ${record?.kind ?? 'nothing'}`);
    }
    return record;
  };

  it('runs the record / dedupe / refresh / touch / delete lifecycle', async () => {
    await freshUser();

    // A recorded answer survives the round trip with day-key scope dates and
    // the automatic createdAt/updatedAt stamps.
    await service.recordAnswer('how much on food in august', { operation: 'sum', limit: 3 }, sumAnswer());
    await reload();

    expect(service.answers().length).toBe(1);
    const first = service.answers()[0];
    expect(first.query).toBe('how much on food in august');
    expect(first.scope).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' });
    expect(asAnswer(first).value).toBe(421.5);
    expect(asAnswer(first).currency).toBe('USD');
    expect(asAnswer(first).baseCurrency).toBe('USD');
    expect(first.createdAt).toBeDefined();
    expect(first.updatedAt).toBeDefined();
    const firstComputedAt = first.computedAt.toMillis();

    // The same question over the same scope refreshes the one record.
    await settle();
    await service.recordAnswer('  How MUCH on Food in August ', { operation: 'sum', limit: 3 }, sumAnswer({ value: 500 }));
    await reload();

    expect(service.answers().length).toBe(1);
    expect(service.answers()[0].id).toBe(first.id);
    expect(asAnswer(service.answers()[0]).value).toBe(500);
    expect(service.answers()[0].computedAt.toMillis()).toBeGreaterThan(firstComputedAt);

    // A count stores no currency field at all.
    await settle();
    await service.recordAnswer('how many coffees', { operation: 'count', limit: 3 }, sumAnswer({
      operation: 'count',
      value: 4,
      currency: undefined,
      transactionCount: 4,
    }));
    let raw = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    const countDoc = raw.docs.find(d => d.data()['query'] === 'how many coffees');
    expect(countDoc).toBeDefined();
    expect('currency' in (countDoc?.data() ?? {})).toBeFalse();

    // A max answer keeps the extreme row by id; refreshing it against a
    // window with no matches clears that id with a real deleteField — the
    // stored document must lose the field, not keep a stale row reference.
    await settle();
    await service.recordAnswer('biggest expense', { operation: 'max', limit: 3 }, sumAnswer({
      operation: 'max',
      value: 180,
      transactionCount: 12,
      extremeTransaction: createTransaction({ id: 'tx-1' }),
    }));
    await reload();
    const maxRecord = service.answers().find(r => r.query === 'biggest expense');
    expect(asAnswer(maxRecord).extremeTransactionId).toBe('tx-1');

    await settle();
    await service.refreshAnswer(maxRecord!.id, sumAnswer({
      operation: 'max',
      value: 0,
      transactionCount: 0,
      extremeTransaction: undefined,
    }));
    raw = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    const refreshed = raw.docs.find(d => d.id === maxRecord!.id)?.data() ?? {};
    expect('extremeTransactionId' in refreshed).toBeFalse();
    expect(refreshed['value']).toBe(0);
    expect((refreshed['computedAt'] as Timestamp).toMillis())
      .toBeGreaterThan(maxRecord!.computedAt.toMillis());

    // Touch advances recency and nothing else.
    const beforeTouch = (refreshed['computedAt'] as Timestamp).toMillis();
    await settle();
    await service.touch(maxRecord!.id);
    raw = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    const touched = raw.docs.find(d => d.id === maxRecord!.id)?.data() ?? {};
    expect((touched['lastUsedAt'] as Timestamp).toMillis()).toBeGreaterThan(beforeTouch);
    expect((touched['computedAt'] as Timestamp).toMillis()).toBe(beforeTouch);

    // Deleting removes the document for real.
    await service.deleteAnswer(maxRecord!.id);
    raw = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    expect(raw.docs.some(d => d.id === maxRecord!.id)).toBeFalse();
  });

  it('stores a goal-scoped answer through the real scope rules', async () => {
    await freshUser();

    // answerScopeValid is a closed allowlist: before goalId was added to it,
    // this write was rejected outright, and no unit spec could see that.
    await service.recordAnswer(
      'how much toward the japan trip',
      { operation: 'sum', limit: 3 },
      sumAnswer({ scope: { ...augustScope(), goalId: 'goal-alpha' } }),
    );
    await reload();

    expect(service.answers().length).toBe(1);
    expect(service.answers()[0].scope).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      goalId: 'goal-alpha',
    });
  });

  it('treats two goals as two questions, not one to dedupe', async () => {
    await freshUser();

    const ask = (goalId: string) => service.recordAnswer(
      'how much toward it',
      { operation: 'sum', limit: 3 },
      sumAnswer({ scope: { ...augustScope(), goalId } }),
    );

    await ask('goal-alpha');
    await settle();
    await ask('goal-beta');
    await reload();

    // The dedupe key is question + operation + limit + scope, so the goal
    // has to be part of the stored scope for these to stay distinct.
    expect(service.answers().length).toBe(2);
  });

  it('prunes the oldest record past the cap against server ordering', async () => {
    await freshUser();

    // Seed a full history through the raw SDK: valid documents with strictly
    // increasing lastUsedAt, oldest first, so seed-0 is the prune victim.
    const base = Date.now() - 1_000_000;
    await Promise.all(
      Array.from({ length: MAX_SEARCH_ANSWERS }, (_, i) =>
        setDoc(doc(firestore, `users/${uid}/searchAnswers/seed-${i}`), {
          userId: uid,
          schemaVersion: 2,
          kind: 'aggregate',
          query: `seed question ${i}`,
          operation: 'sum',
          limit: 3,
          scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
          baseCurrency: 'USD',
          value: i,
          currency: 'USD',
          transactionCount: 1,
          computedAt: Timestamp.fromMillis(base + i * 1000),
          lastUsedAt: Timestamp.fromMillis(base + i * 1000),
        })
      )
    );
    await reload();
    expect(service.answers().length).toBe(MAX_SEARCH_ANSWERS);

    await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

    const raw = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    expect(raw.size).toBe(MAX_SEARCH_ANSWERS);
    expect(raw.docs.some(d => d.id === 'seed-0')).toBeFalse();
    expect(raw.docs.some(d => d.data()['query'] === 'a brand new question')).toBeTrue();
  });

  // The unit spec proves the prune skips pinned records against a seeded
  // signal; this proves the pin survives a real write and that the eviction
  // lands on the next unpinned record in the server's own ordering.
  it('prunes past a pinned record against server ordering', async () => {
    await freshUser();

    // One over the cap, with the least recently used record pinned: the
    // pinned one stops occupying a slot, so exactly one eviction is due and
    // it must fall on seed-1 rather than on the pinned seed-0.
    const base = Date.now() - 1_000_000;
    await Promise.all(
      Array.from({ length: MAX_SEARCH_ANSWERS + 1 }, (_, i) =>
        setDoc(doc(firestore, `users/${uid}/searchAnswers/seed-${i}`), {
          userId: uid,
          schemaVersion: 2,
          kind: 'aggregate',
          query: `seed question ${i}`,
          operation: 'sum',
          limit: 3,
          scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
          baseCurrency: 'USD',
          value: i,
          currency: 'USD',
          transactionCount: 1,
          pinned: i === 0,
          computedAt: Timestamp.fromMillis(base + i * 1000),
          lastUsedAt: Timestamp.fromMillis(base + i * 1000),
        })
      )
    );
    await reload();

    await service.recordAnswer('a brand new question', { operation: 'sum', limit: 3 }, sumAnswer());

    const raw = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    expect(raw.docs.some(d => d.id === 'seed-0')).withContext('pinned survives').toBeTrue();
    expect(raw.docs.some(d => d.id === 'seed-1')).withContext('next oldest evicted').toBeFalse();
  });

  it('toggles the pin through the live rules', async () => {
    await freshUser();
    await service.recordAnswer('pin me', { operation: 'sum', limit: 3 }, sumAnswer());
    await reload();

    const record = service.answers()[0];
    expect(record.pinned).withContext('created unpinned').toBeFalse();

    await service.togglePin(record.id, true);
    await reload();

    expect(service.answers()[0].pinned).toBeTrue();
  });

  // #250 shipped because nothing drove the service's own write against the
  // real rules: the rules suite hand-builds its filter documents, so the one
  // recordFilter actually issues — dateless scope included — was rejected in
  // production only. This is the real call site.
  it('records a dateless filter interpretation through the real rules', async () => {
    await freshUser();

    await service.recordFilter('show all coffee purchases', { categoryId: 'food_coffee' });
    await reload();

    expect(service.answers().length).toBe(1);
    const record = service.answers()[0];
    expect(record.kind).toBe('filter');
    expect(record.query).toBe('show all coffee purchases');
    expect(record.scope).toEqual({ categoryId: 'food_coffee' });

    // Re-asking the same question refreshes recency on the same record —
    // the touch update must also clear the live rules.
    const before = record.lastUsedAt.toMillis();
    await settle();
    await service.recordFilter('show all coffee purchases', { categoryId: 'food_coffee' });
    await reload();

    expect(service.answers().length).toBe(1);
    expect(service.answers()[0].id).toBe(record.id);
    expect(service.answers()[0].lastUsedAt.toMillis()).toBeGreaterThan(before);
  });
});
