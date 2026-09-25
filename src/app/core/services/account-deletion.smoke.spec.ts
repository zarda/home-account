// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from the root packages are incompatible with the service layer.
import { TestBed } from '@angular/core/testing';
import { createEnvironmentInjector, EnvironmentInjector, Provider } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import {
  getAuth,
  connectAuthEmulator,
  signInAnonymously,
  signOut,
  deleteUser,
  Auth
} from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDocsFromServer,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { openDB } from 'idb';

import { AccountDeletionService } from './account-deletion.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { HouseholdService } from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { PwaService } from './pwa.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { createTranslationStub } from './testing/translation-stub';
import { User } from '../../models';
import { SHARE_STASH_DB, SHARE_STASH_STORE, ShareStashStore } from './share-stash.store';
import { reminderSentStorageKey } from './reminder.service';
import { weeklyRecapStorageKeys } from '../utils/weekly-recap.utils';
import {
  EmulatorField,
  getDocumentAsOwner,
  patchFieldsAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * End-to-end smoke test for the account-deletion cascade against the
 * emulators.
 *
 * The unit spec proves ordering and partial-failure semantics with spies;
 * only a real backend proves that every subcollection actually empties, that
 * the amended rules permit the sweeps (the emulator enforces
 * firestore.rules), that the receipt object leaves Storage, and that the
 * auth user itself is gone at the end.
 *
 * The household cases prove the order the rules impose: a profile whose
 * pointer names a live membership cannot be deleted, so the cascade leaves
 * or dissolves first, and when that step fails before its leave or dissolve
 * commits, the profile and the auth user both stay for the retry. An invite
 * that arrives while the records are erased is swept before the auth user
 * goes. Every household write goes through the real
 * HouseholdService on both sides. The other account gets a service stack of
 * its own through a child EnvironmentInjector (the
 * transaction-receipts.smoke.spec.ts pattern) over a second app. Two full
 * clients is the most one file holds: each keeps a listen stream open,
 * Chrome allows six connections per host, and the admin REST reads and
 * writes need the rest. Invites are written past the rules, as the invite
 * callable writes them.
 *
 * Every case signs in an account of its own, since each ends with that
 * account erased or holding a household.
 *
 * The AuthService stub keeps the heavyweight real service out of the DI
 * graph: reauthentication is stubbed as a no-op because the anonymous user
 * signs in freshly here (recent login by construction) and anonymous
 * accounts cannot re-run a Google flow. deleteFirebaseUser only records its
 * call: the profile and most kinds are readable by their owner alone, and
 * the four a household shares are readable by a peer only while the pointer
 * names a live membership, which the cascade ends first. So the emptied
 * collections are only assertable while the session still exists. The real
 * deleteUser runs directly afterwards, once nothing readable is left to
 * check.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('AccountDeletionService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;

  const DAY_MS = 24 * 60 * 60 * 1000;

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: Storage;
  let uid: string;

  /** The account on the other side of each household case. */
  let other: { app: FirebaseApp; firestore: Firestore; uid: string; user: User };
  let otherInjector: EnvironmentInjector;
  let otherHousehold: HouseholdService;

  let service: AccountDeletionService;
  let firestoreService: FirestoreService;
  let storageService: StorageService;

  const RECEIPT_TX_ID = 'smoke-del-rx';
  const SHARED_TX_ID = 'smoke-del-shared';

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account', storageBucket: 'demo-home-account.appspot.com' },
      `account-deletion-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const otherApp = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `account-deletion-smoke-other-${Date.now()}`
    );
    const otherAuth = getAuth(otherApp);
    connectAuthEmulator(otherAuth, AUTH_URL, { disableWarnings: true });
    const otherFirestore = getFirestore(otherApp);
    connectFirestoreEmulator(otherFirestore, FIRESTORE_HOST, FIRESTORE_PORT);
    const otherUid = (await signInAnonymously(otherAuth)).user.uid;
    const otherProfile = {
      email: 'other@example.test',
      displayName: 'Other',
      createdAt: Timestamp.now(),
      lastLoginAt: Timestamp.now(),
      preferences: { baseCurrency: 'USD', language: 'en' }
    };
    other = {
      app: otherApp,
      firestore: otherFirestore,
      uid: otherUid,
      user: { id: otherUid, ...otherProfile } as User
    };
    await setDoc(doc(otherFirestore, `users/${otherUid}`), otherProfile);
  }, 30000);

  afterAll(async () => {
    for (const each of [app, other?.app]) {
      if (each) await deleteApp(each).catch(() => undefined);
    }
  });

  /** The other account's services, identical to the TestBed's but for its app and uid. */
  function otherStack(): Provider[] {
    return [
      HouseholdService,
      FirestoreService,
      { provide: Firestore, useValue: other.firestore },
      { provide: AuthService, useValue: { userId: () => other.uid, currentUser: () => other.user } },
      { provide: PwaService, useValue: { isOnline: () => true } },
      { provide: TranslationService, useValue: createTranslationStub() },
      {
        provide: HOUSEHOLD_INVITE_CALLABLE,
        useValue: () => Promise.reject(new Error('the functions emulator is not part of the smoke run'))
      }
    ];
  }

  beforeEach(async () => {
    await signOut(auth);
    uid = (await signInAnonymously(auth)).user.uid;
    // The rules clear a pointer only once its membership is gone, and an
    // earlier case may have left the other account's household live.
    await patchFieldsAsOwner(`users/${other.uid}`, { householdId: null });
  });

  function seedProfile(): Promise<void> {
    const now = Timestamp.now();
    return setDoc(doc(firestore, `users/${uid}`), {
      email: 'smoke@example.test',
      displayName: 'Smoke',
      createdAt: now,
      lastLoginAt: now,
      preferences: { baseCurrency: 'USD', language: 'en' }
    });
  }

  /** One valid document per subcollection, shaped to pass firestore.rules. */
  async function seedEverything(): Promise<void> {
    const now = Timestamp.now();

    await seedProfile();

    await seedTransaction(RECEIPT_TX_ID, 12.5, 'deletion smoke', { receiptUrl: await uploadReceipt() });

    await setDoc(doc(firestore, `users/${uid}/categories/smoke-del-cat`), {
      userId: uid,
      name: 'Custom',
      icon: 'star',
      color: '#FF0000',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: false
    });

    await setDoc(doc(firestore, `users/${uid}/budgets/smoke-del-budget`), {
      userId: uid,
      categoryId: 'food',
      name: 'Groceries',
      amount: 400,
      currency: 'USD',
      period: 'monthly',
      startDate: now,
      spent: 0,
      isActive: true,
      alertThreshold: 80
    });

    await setDoc(doc(firestore, `users/${uid}/recurring/smoke-del-rec`), {
      userId: uid,
      name: 'Salary',
      type: 'income',
      amount: 1000,
      currency: 'USD',
      categoryId: 'employment_salary',
      description: 'monthly salary',
      frequency: { type: 'monthly', interval: 1 },
      startDate: now,
      nextOccurrence: now,
      isActive: true
    });

    await setDoc(doc(firestore, `users/${uid}/goals/smoke-del-goal`), {
      userId: uid,
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true
    });

    await setDoc(doc(firestore, `users/${uid}/savedSearches/smoke-del-search`), {
      userId: uid,
      query: 'coffee',
      pinned: false,
      lastUsedAt: now
    });

    await setDoc(doc(firestore, `users/${uid}/searchAnswers/smoke-del-answer`), {
      userId: uid,
      schemaVersion: 2,
      kind: 'aggregate',
      query: 'how much on food in august',
      operation: 'sum',
      limit: 3,
      scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
      baseCurrency: 'USD',
      value: 421.5,
      currency: 'USD',
      transactionCount: 17,
      computedAt: now,
      lastUsedAt: now
    });

    await setDoc(doc(firestore, `users/${uid}/categoryMemory/starbucks`), {
      merchantKey: 'starbucks',
      categoryId: 'food_coffee',
      sampleDescription: 'STARBUCKS #123',
      count: 1
    });

    await setDoc(doc(firestore, `users/${uid}/tagMemory/starbucks`), {
      merchantKey: 'starbucks',
      tags: ['coffee'],
      suppressed: ['lunch'],
      sampleDescription: 'STARBUCKS #123',
      count: 1
    });

    await setDoc(doc(firestore, `users/${uid}/imports/smoke-del-import`), {
      userId: uid,
      importedAt: now,
      source: 'csv',
      fileType: 'bank_csv',
      fileName: 'statement.csv',
      status: 'completed'
    });

    await setDoc(doc(firestore, `users/${uid}/insightSnapshots/2026-07`), {
      userId: uid,
      monthKey: '2026-07',
      detectorVersion: 1,
      schemaVersion: 1,
      status: 'complete',
      fingerprint: { tx: 'abcd1234:10', count: 10, timeZone: 'Asia/Taipei', baseCurrency: 'USD' },
      totals: { income: 4000, expense: 1200, balance: 2800, count: 10 },
      byCategory: [{ categoryId: 'food_groceries', total: 800, count: 6 }],
      facts: { detectorVersion: 1, baseCurrency: 'USD' },
      cards: [],
      generatedAt: now,
      createdAt: now,
      revision: 1
    });

    await setDoc(doc(firestore, `users/${uid}/secrets/providers`), { gemini: 'g-key' });

    await setDoc(doc(firestore, `users/${uid}/feedback/smoke-del-feedback`), {
      userId: uid,
      category: 'idea',
      message: 'smoke feedback',
      appVersion: '1.23.129',
      platform: 'web',
      locale: 'en'
    });

    await setDoc(doc(firestore, `users/${uid}/securityEvents/smoke-del-event`), {
      userId: uid,
      type: 'signIn',
      occurredAt: now,
      platform: 'web'
    });
  }

  /** Every localStorage key the cascade's device-local steps own, for one uid. */
  function deviceKeys(userId: string): string[] {
    const recap = weeklyRecapStorageKeys(userId);
    return [reminderSentStorageKey(userId), recap.dismissed, recap.narrative];
  }

  async function uploadReceipt(): Promise<string> {
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'receipt.png', {
      type: 'image/png'
    });
    return storageService.uploadReceipt(uid, RECEIPT_TX_ID, file);
  }

  /**
   * A transaction shaped to pass firestore.rules. With no arguments it has no
   * receipt: the kind of row a household peer reads.
   */
  function seedTransaction(
    id = SHARED_TX_ID,
    amount = 8,
    description = 'household deletion smoke',
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const now = Timestamp.now();
    return setDoc(doc(firestore, `users/${uid}/transactions/${id}`), {
      userId: uid,
      type: 'expense',
      amount,
      currency: 'USD',
      amountInBaseCurrency: amount,
      exchangeRate: 1,
      categoryId: 'food_groceries',
      description,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      ...extra
    });
  }

  /**
   * A household's generation as stored, as the REST string read back: a
   * value rebuilt from a Date would lose the microseconds the join rule
   * compares.
   */
  async function storedGeneration(householdId: string): Promise<EmulatorField> {
    const createdAt = (await getDocumentAsOwner(`households/${householdId}`))?.['createdAt']?.['timestampValue'];
    if (typeof createdAt !== 'string') throw new Error(`households/${householdId} has no stored createdAt`);
    return { timestampValue: createdAt };
  }

  /** An invite as the callable writes it, past the rules that refuse every client create. */
  async function seedInvite(
    householdId: string,
    generation: EmulatorField,
    inviterUid: string,
    inviteeUid: string
  ): Promise<string> {
    const inviteId = `${householdId}_${inviteeUid}`;
    await setDocumentAsOwner(`householdInvites/${inviteId}`, {
      householdId: stringField(householdId),
      householdCreatedAt: generation,
      householdName: stringField('Home'),
      inviterUid: stringField(inviterUid),
      inviterName: stringField('Inviter'),
      inviterEmail: stringField('inviter@example.test'),
      inviteeUid: stringField(inviteeUid),
      inviteeEmail: stringField(`${inviteeUid}@example.test`),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent')
    });
    return inviteId;
  }

  /** The other account's read of this account's rows, which the rules decide by membership. */
  const otherReadsRows = () => getDocsFromServer(collection(other.firestore, `users/${uid}/transactions`));

  /**
   * Runs `look` when the cascade reaches its first record step: after the
   * household step, and before anything is erased.
   */
  function onFirstRecordStep(look: () => Promise<void>): void {
    const transactions = TestBed.inject(TransactionService);
    const erase = transactions.deleteAllTransactions.bind(transactions);
    spyOn(transactions, 'deleteAllTransactions').and.callFake(async () => {
      await look();
      return erase();
    });
  }

  let deleteFirebaseUserCalls = 0;

  beforeEach(() => {
    deleteFirebaseUserCalls = 0;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        {
          provide: AuthService,
          useValue: {
            userId: () => uid,
            currentUser: () => null,
            reauthenticate: async () => undefined,
            deleteFirebaseUser: async () => {
              deleteFirebaseUserCalls += 1;
            }
          }
        }
      ]
    });

    service = TestBed.inject(AccountDeletionService);
    firestoreService = TestBed.inject(FirestoreService);
    storageService = TestBed.inject(StorageService);
    otherInjector = createEnvironmentInjector(otherStack(), TestBed.inject(EnvironmentInjector));
    otherHousehold = otherInjector.get(HouseholdService);
  });

  afterEach(() => {
    otherInjector.destroy();
  });

  it('erases every subcollection, the receipt, the user document, and the auth user', async () => {
    await seedEverything();

    // The share stash is the one device-local store the cascade used to
    // skip. Seed it the way the service worker writes — raw rows, one owned
    // and one ownerless — and let the shareStash step erase both. The
    // store's session effect never fires here (nothing ticks), so the rows
    // are stamped explicitly.
    await TestBed.inject(ShareStashStore).clearAll(); // creates the schema
    const stashDb = await openDB(SHARE_STASH_DB);
    await stashDb.put(SHARE_STASH_STORE, {
      id: 'smoke-owned',
      name: 'mine.png',
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: Date.now(),
      userId: uid
    });
    await stashDb.put(SHARE_STASH_STORE, {
      id: 'smoke-ownerless',
      name: 'nobody.png',
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: Date.now()
    });
    stashDb.close();

    // The two localStorage-only steps, seeded for this account and for a
    // second one: erasure is per-uid, so the other account's device state has
    // to survive a cascade run beside it.
    const OTHER_UID = 'smoke-del-other';
    const mine = deviceKeys(uid);
    const theirs = deviceKeys(OTHER_UID);
    for (const key of [...mine, ...theirs]) {
      localStorage.setItem(key, 'seeded');
    }

    const report = await service.deleteAccount();

    expect(report.failed).toEqual([]);
    expect(report.ok).toBeTrue();
    expect(deleteFirebaseUserCalls).toBe(1);

    const subcollections = [
      'transactions',
      'categories',
      'budgets',
      'recurring',
      'goals',
      'savedSearches',
      'searchAnswers',
      'categoryMemory',
      'tagMemory',
      'imports',
      'insightSnapshots',
      'secrets',
      'feedback',
      'securityEvents'
    ];
    for (const name of subcollections) {
      const rows = await firestoreService.getCollection(`users/${uid}/${name}`);
      expect(rows).toEqual([], `expected users/{uid}/${name} to be empty`);
    }

    expect(await firestoreService.getDocument(`users/${uid}`)).toBeNull();
    await expectAsync(storageService.downloadReceipt(uid, RECEIPT_TX_ID)).toBeRejected();

    // Erasure is device-scoped: no rows survive, owned or ownerless.
    const stashAfter = await openDB(SHARE_STASH_DB);
    expect(await stashAfter.count(SHARE_STASH_STORE)).toBe(0);
    stashAfter.close();

    for (const key of mine) {
      expect(localStorage.getItem(key)).withContext(`${key} should be gone`).toBeNull();
    }
    for (const key of theirs) {
      expect(localStorage.getItem(key)).withContext(`${key} should survive`).toBe('seeded');
      localStorage.removeItem(key);
    }

    // The step the cascade invoked above, run for real now that the
    // owner-only reads are done: the emulator accepts deleting this
    // recently-signed-in user, and the session ends with it.
    const user = auth.currentUser;
    expect(user).not.toBeNull();
    await deleteUser(user!);
    expect(auth.currentUser).toBeNull();
  }, 60000);

  it('leaves a member\'s household first, with the invites addressed to it, which ends the owner\'s reads', async () => {
    await seedProfile();
    await seedTransaction();
    const householdId = await otherHousehold.create('Theirs');
    await seedInvite(householdId, await storedGeneration(householdId), other.uid, uid);
    // Still pending after the join, which deletes only the invite it
    // accepts. It arrived before the join: the callable refuses to invite a
    // live member of another household.
    const pending = await seedInvite(`elsewhere${Date.now()}`, timestampField(), 'someone-else', uid);
    await TestBed.inject(HouseholdService).accept(householdId);
    expect((await otherReadsRows()).size).toBe(1);

    // Looked at while the profile and the row are both still there, so a
    // refused read is the leave's doing and not the erasure's.
    let afterLeaving: { read: string; profile: unknown; row: unknown } | undefined;
    onFirstRecordStep(async () => {
      afterLeaving = {
        read: await otherReadsRows().then(() => 'allowed', (error: { code?: string }) => String(error.code)),
        profile: await getDocumentAsOwner(`users/${uid}`),
        row: await getDocumentAsOwner(`users/${uid}/transactions/${SHARED_TX_ID}`)
      };
    });

    const report = await service.deleteAccount();

    expect(report.failed).toEqual([]);
    expect(report.ok).toBeTrue();
    expect(deleteFirebaseUserCalls).toBe(1);
    expect(afterLeaving?.read).toBe('permission-denied');
    expect(afterLeaving?.profile).not.toBeNull();
    expect(afterLeaving?.row).not.toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${pending}`)).toBeNull();
    expect(await getDocumentAsOwner(`users/${uid}`)).toBeNull();
    // The household is the owner's, and outlives a member leaving it.
    expect(await getDocumentAsOwner(`households/${householdId}`)).not.toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${other.uid}`)).not.toBeNull();
  }, 60000);

  it('sweeps an invite that arrives while the records are erased', async () => {
    await seedProfile();
    // The callable admits an invite to an account with no live membership
    // for as long as its auth user exists, which is to the cascade's end.
    let late: string | undefined;
    onFirstRecordStep(async () => {
      late = await seedInvite(`late${Date.now()}`, timestampField(), 'someone-else', uid);
    });

    const report = await service.deleteAccount();

    expect(report.failed).toEqual([]);
    expect(deleteFirebaseUserCalls).toBe(1);
    expect(late).toBeDefined();
    expect(await getDocumentAsOwner(`householdInvites/${late}`)).toBeNull();
  }, 60000);

  it('dissolves an owner\'s household first, with every member and every invite it sent', async () => {
    await seedProfile();
    const householdId = await TestBed.inject(HouseholdService).create('Home');
    const generation = await storedGeneration(householdId);
    await seedInvite(householdId, generation, uid, other.uid);
    await otherHousehold.accept(householdId);
    const sent = await seedInvite(householdId, generation, uid, `ghost-${Date.now()}`);

    const report = await service.deleteAccount();

    expect(report.failed).toEqual([]);
    expect(report.ok).toBeTrue();
    expect(deleteFirebaseUserCalls).toBe(1);
    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${other.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${sent}`)).toBeNull();
    expect(await getDocumentAsOwner(`users/${uid}`)).toBeNull();
  }, 60000);

  it('keeps the profile, its pointer and the auth user for a retry when the household step fails', async () => {
    await seedProfile();
    const household = TestBed.inject(HouseholdService);
    const householdId = await household.create('Home');
    const deleteAll = spyOn(household, 'deleteAll').and.rejectWith(new Error('the household step failed'));

    const report = await service.deleteAccount();

    expect(report.ok).toBeFalse();
    expect(report.failed.map(f => f.step)).toEqual(['household', 'userDoc']);
    // The rules' refusal, not a fault of the step itself.
    expect((report.failed[1].error as { code?: string }).code).toBe('permission-denied');
    expect(deleteFirebaseUserCalls).toBe(0);
    expect((await getDocumentAsOwner(`users/${uid}`))?.['householdId']).toEqual(stringField(householdId));
    expect(await getDocumentAsOwner(`households/${householdId}`)).not.toBeNull();

    deleteAll.and.callThrough();
    const retry = await service.deleteAccount();

    expect(retry.failed).toEqual([]);
    expect(deleteFirebaseUserCalls).toBe(1);
    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`users/${uid}`)).toBeNull();
  }, 60000);
});
