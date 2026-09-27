// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { ErrorHandler } from '@angular/core';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from '@angular/fire/auth';
import { getFirestore, connectFirestoreEmulator, Firestore, Timestamp } from '@angular/fire/firestore';
import * as lite from '@angular/fire/firestore/lite';
import { LedgerShareService } from './ledger-share.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { ledgerJournalKey, readLedgerJournal } from './ledger-journal';
import {
  EmulatorField,
  getDocumentAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { LEDGER_REQUIRED_FIELDS, Transaction, shareKey } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { unexpectedConsoleErrors } from './testing/firestore-transport-noise';
silenceFirebaseWarnings();

/**
 * LedgerShareService against the emulators, with firestore.rules live: each
 * passing case proves the service's commits are the ones the rules admit,
 * and that a peer reading the household's ledger as the page does (filtered
 * to the live generation) sees what the owner shared and nothing more.
 *
 * The owner runs the real service on a full client. Its second device, the
 * stale one, is a Lite client on the same app and account; the peer is a
 * Lite client of its own. One full client in the file keeps well inside the
 * connections Chrome allows one host. The household is formed and joined
 * with the commits HouseholdService makes, through the rules; only the
 * invite, which the callable writes, goes past them over REST.
 *
 * No case takes a client offline. A full client that disables its network
 * with a write queued stalls every other full client's traffic to the
 * emulator for tens of seconds (firestore.service.smoke.spec.ts, on
 * waitForPendingWrites), and the whole smoke run with it, so the offline
 * add, share and edit journey is not run here. ledger-share.service.spec.ts
 * shows from the mock's call-order log only that follow issues each copy
 * commit before it returns, behind the personal write issued before it.
 * That the commits then land in that order across an offline period rests
 * on the SDK's persistent mutation queue, which this suite does not prove.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('LedgerShareService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DATE_MS = Date.UTC(2026, 8, 20, 12);

  interface OwnerAccount {
    app: FirebaseApp;
    firestore: Firestore;
    /** The owner's second device: past every hook, and stale when a case says so. */
    lite: lite.Firestore;
    uid: string;
  }

  interface PeerAccount {
    app: FirebaseApp;
    db: lite.Firestore;
    uid: string;
  }

  let owner: OwnerAccount;
  let peer: PeerAccount;
  let service: LedgerShareService;
  /** The owner's personal writes, as the app makes them. */
  let rows: FirestoreService;
  let householdId: string;
  /** The household's generation as the peer reads it. */
  let gen: lite.Timestamp;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;
  let consoleError: jasmine.Spy;
  let consoleWarn: jasmine.Spy;

  function newApp(name: string): { app: FirebaseApp; auth: ReturnType<typeof getAuth> } {
    const app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `ledger-share-${name}-${Date.now()}`
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    return { app, auth };
  }

  function liteClient(app: FirebaseApp): lite.Firestore {
    const db = lite.getFirestore(app);
    lite.connectFirestoreEmulator(db, FIRESTORE_HOST, FIRESTORE_PORT);
    return db;
  }

  const rowsPath = () => `users/${owner.uid}/transactions`;
  const rowPath = (id: string) => `${rowsPath()}/${id}`;
  const copyId = (id: string) => `${owner.uid}_${id}`;
  const copyPath = (id: string) => `households/${householdId}/ledger/${copyId(id)}`;

  /**
   * A row the rules accept, with the fields a copy never reveals: a note,
   * tags and a place. `stamp` builds the timestamps of the client writing
   * it, which serialises only its own SDK's class.
   */
  function rowData(stamp: (ms: number) => unknown, overrides: Record<string, unknown> = {}) {
    return {
      userId: owner.uid,
      type: 'expense',
      amount: 12.5,
      currency: 'USD',
      amountInBaseCurrency: 12.5,
      exchangeRate: 1,
      categoryId: 'food_groceries',
      description: 'Ledger smoke',
      note: 'a private note',
      tags: ['private'],
      location: { name: 'Corner shop', country: 'GB' },
      date: stamp(DATE_MS),
      createdAt: stamp(DATE_MS),
      isRecurring: false,
      ...overrides
    };
  }

  /** A private row written through the app's own seam. */
  async function writeRow(overrides: Record<string, unknown> = {}): Promise<{ id: string; data: Transaction }> {
    const id = rows.generateId(rowsPath());
    const data = rowData(ms => Timestamp.fromMillis(ms), overrides);
    await rows.setDocument(rowPath(id), data);
    return { id, data: { id, ...data } as unknown as Transaction };
  }

  /** A row written on the owner's other device, past every hook. */
  async function writeRowPastHooks(overrides: Record<string, unknown> = {}): Promise<string> {
    const ref = lite.doc(lite.collection(owner.lite, rowsPath()));
    await lite.setDoc(ref, rowData(ms => lite.Timestamp.fromMillis(ms), overrides));
    return ref.id;
  }

  /** The household's ledger as the peer's page lists it: the live generation's copies. */
  async function peerView(): Promise<Map<string, lite.DocumentData>> {
    const snapshot = await lite.getDocs(lite.query(
      lite.collection(peer.db, `households/${householdId}/ledger`),
      lite.where('gen', '==', gen)
    ));
    return new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
  }

  async function eventually(check: () => Promise<boolean>, what: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * The owner forms a household and the peer joins it, with the commits
   * HouseholdService makes. The invite goes past the rules, as the callable
   * writes it, with the generation read back over REST so it keeps its
   * microseconds.
   */
  async function formWithPeer(): Promise<string> {
    const id = lite.doc(lite.collection(owner.lite, 'households')).id;
    const create = lite.writeBatch(owner.lite);
    create.set(lite.doc(owner.lite, `households/${id}`), {
      name: 'Home',
      ownerId: owner.uid,
      createdAt: lite.serverTimestamp(),
      updatedAt: lite.serverTimestamp()
    });
    create.set(lite.doc(owner.lite, `households/${id}/members/${owner.uid}`), {
      uid: owner.uid,
      displayName: 'Owner',
      role: 'owner',
      since: lite.serverTimestamp(),
      joinedAt: lite.serverTimestamp()
    });
    create.set(lite.doc(owner.lite, `users/${owner.uid}/households/${id}`), {
      since: lite.serverTimestamp(),
      role: 'owner',
      name: 'Home',
      joinedAt: lite.serverTimestamp()
    });
    await create.commit();

    const stored = await getDocumentAsOwner(`households/${id}`);
    const createdAt = stored?.['createdAt']?.['timestampValue'];
    if (typeof createdAt !== 'string') throw new Error(`households/${id} has no stored createdAt`);
    const inviteId = `${id}_${peer.uid}`;
    await setDocumentAsOwner(`householdInvites/${inviteId}`, {
      householdId: stringField(id),
      householdCreatedAt: { timestampValue: createdAt } as EmulatorField,
      householdName: stringField('Home'),
      inviterUid: stringField(owner.uid),
      inviterName: stringField('Owner'),
      inviterEmail: stringField('owner@example.test'),
      inviteeUid: stringField(peer.uid),
      inviteeEmail: stringField('peer@example.test'),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent')
    });

    const inviteRef = lite.doc(peer.db, `householdInvites/${inviteId}`);
    const invite = await lite.getDoc(inviteRef);
    const join = lite.writeBatch(peer.db);
    join.set(lite.doc(peer.db, `households/${id}/members/${peer.uid}`), {
      uid: peer.uid,
      displayName: 'Peer',
      role: 'member',
      since: invite.get('householdCreatedAt'),
      joinedAt: lite.serverTimestamp(),
      inviteId
    });
    join.delete(inviteRef);
    join.set(lite.doc(peer.db, `users/${peer.uid}/households/${id}`), {
      since: invite.get('householdCreatedAt'),
      role: 'member',
      name: invite.get('householdName'),
      joinedAt: lite.serverTimestamp()
    });
    await join.commit();
    return id;
  }

  /**
   * Nothing reached the error handler and the service logged nothing: a
   * refused or failed write of its own is a `[LedgerShareService]` warning.
   * The SDK's own transport lines are not faults (unexpectedConsoleErrors).
   */
  function expectQuiet(): void {
    expect(errorHandler.handleError.calls.allArgs().map(args => args.map(String)))
      .withContext('the error handler').toEqual([]);
    const errors = unexpectedConsoleErrors(consoleError.calls.allArgs());
    expect(errors).withContext(`console.error: ${JSON.stringify(errors)}`).toEqual([]);
    const warnings = consoleWarn.calls.allArgs()
      .filter(args => String(args[0]).startsWith('[LedgerShareService]'))
      .map(args => args.map(String));
    expect(warnings).withContext(`console.warn: ${JSON.stringify(warnings)}`).toEqual([]);
  }

  beforeAll(async () => {
    const ownerApp = newApp('owner');
    const firestore = getFirestore(ownerApp.app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
    const ownerCredential = await signInAnonymously(ownerApp.auth);
    owner = { app: ownerApp.app, firestore, lite: liteClient(ownerApp.app), uid: ownerCredential.user.uid };

    const peerApp = newApp('peer');
    const peerCredential = await signInAnonymously(peerApp.auth);
    peer = { app: peerApp.app, db: liteClient(peerApp.app), uid: peerCredential.user.uid };
  }, 30000);

  afterAll(async () => {
    for (const account of [owner, peer]) {
      await deleteApp(account.app).catch(() => undefined);
    }
  });

  beforeEach(async () => {
    localStorage.removeItem(ledgerJournalKey(owner.uid));
    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    TestBed.configureTestingModule({
      providers: [
        FirestoreService,
        { provide: Firestore, useValue: owner.firestore },
        { provide: AuthService, useValue: { userId: () => owner.uid } },
        { provide: PwaService, useValue: { isOnline: () => true } },
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    });
    service = TestBed.inject(LedgerShareService);
    rows = TestBed.inject(FirestoreService);
    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();

    householdId = await formWithPeer();
    gen = (await lite.getDoc(lite.doc(peer.db, `households/${householdId}`))).get('createdAt') as lite.Timestamp;
  }, 30000);

  afterEach(() => {
    localStorage.removeItem(ledgerJournalKey(owner.uid));
  });

  it('runs as accounts whose ids hold no underscore, which a copy id is split on', () => {
    expect(owner.uid).not.toContain('_');
    expect(peer.uid).not.toContain('_');
  });

  it('shares, edits, unshares and deletes a row, each as the peer sees it', async () => {
    const { id, data } = await writeRow();
    expect((await peerView()).size).toBe(0);

    await service.share([id], householdId);

    const shared = (await peerView()).get(copyId(id));
    expect(shared).withContext('the shared copy').toBeDefined();
    expect(Object.keys(shared ?? {}).sort()).toEqual([...LEDGER_REQUIRED_FIELDS].sort());
    expect(shared?.['amount']).toBe(12.5);
    expect(shared?.['description']).toBe('Ledger smoke');
    expect(shared?.['memberUid']).toBe(owner.uid);
    expect(shared?.['category']).toEqual({ name: 'categoryNames.groceries', icon: jasmine.any(String), color: jasmine.any(String) });

    // The edit as the app makes it: the personal write issued, then followed, then awaited.
    const before = { ...data, sharedWith: [shareKey(householdId)] };
    const change = { amount: 40, description: 'Edited', note: 'still private' };
    const write = rows.updateDocument(rowPath(id), change);
    service.follow(id, before, { ...before, ...change });
    await write;
    await eventually(async () => (await peerView()).get(copyId(id))?.['amount'] === 40, 'the peer to see the edit');
    expect((await peerView()).get(copyId(id))?.['description']).toBe('Edited');

    await service.unshare([id], householdId);
    expect((await peerView()).has(copyId(id))).withContext('the unshared copy').toBeFalse();
    expect((await rows.getDocument<Transaction>(rowPath(id)))?.sharedWith).toEqual([]);

    // A delete is one commit: the account's copy in every household it holds, and the row.
    await service.share([id], householdId);
    expect((await peerView()).has(copyId(id))).toBeTrue();
    const memberships = await service.membershipsOnce();
    await rows.commitBatch([
      ...memberships.map(membership => ({
        op: 'delete' as const,
        path: `households/${membership.householdId}/ledger/${copyId(id)}`
      })),
      { op: 'delete', path: rowPath(id) }
    ]);
    expect((await peerView()).has(copyId(id))).withContext('the deleted row\'s copy').toBeFalse();
    expect(readLedgerJournal(owner.uid)).toEqual({ rows: [], full: [] });
    expectQuiet();
  }, 30000);

  it('refuses a copy a stale second device writes from a row it read before an edit', async () => {
    const { id, data } = await writeRow();
    await service.share([id], householdId);
    const staleRef = lite.doc(owner.lite, copyPath(id));
    const stale = (await lite.getDoc(staleRef)).data();
    expect(stale?.['amount']).toBe(12.5);

    const before = { ...data, sharedWith: [shareKey(householdId)] };
    const write = rows.updateDocument(rowPath(id), { amount: 20 });
    service.follow(id, before, { ...before, amount: 20 });
    await write;
    await eventually(async () => (await peerView()).get(copyId(id))?.['amount'] === 20, 'the peer to see the edit');

    let refusal: unknown = null;
    try {
      await lite.setDoc(staleRef, { ...stale, updatedAt: lite.serverTimestamp() }, { merge: true });
    } catch (error) {
      refusal = error;
    }
    expect((refusal as { code?: string } | null)?.code).toBe('permission-denied');
    expect((await peerView()).get(copyId(id))?.['amount']).toBe(20);
    expectQuiet();
  }, 30000);

  it('repairs, in a full pass, rows written past the hooks', async () => {
    const edited = await writeRow();
    const unshared = await writeRow();
    const deleted = await writeRow();
    const untouched = await writeRow();
    await service.share([edited.id, unshared.id, deleted.id, untouched.id], householdId);
    expect((await peerView()).size).toBe(4);

    const key = shareKey(householdId);
    const rowRef = (id: string) => lite.doc(owner.lite, rowPath(id));
    await lite.updateDoc(rowRef(edited.id), { amount: 77, description: 'Changed past the hooks' });
    await lite.updateDoc(rowRef(unshared.id), { sharedWith: lite.arrayRemove(key) });
    await lite.deleteDoc(rowRef(deleted.id));
    const missing = await writeRowPastHooks({ sharedWith: [key] });
    // A row whose copy is of a generation the household no longer has.
    const otherGeneration = await writeRowPastHooks({ sharedWith: [key] });
    await setDocumentAsOwner(copyPath(otherGeneration), {
      memberUid: stringField(owner.uid),
      sourceId: stringField(otherGeneration),
      gen: timestampField(new Date(Date.UTC(2020, 0, 1)))
    });

    const report = await service.reconcile(householdId, 'full');

    expect(report).toEqual({ pass: 'full', written: 3, deleted: 3 });
    const view = await peerView();
    expect([...view.keys()].sort())
      .toEqual([edited.id, untouched.id, missing, otherGeneration].map(copyId).sort());
    expect(view.get(copyId(edited.id))?.['amount']).toBe(77);
    expect(view.get(copyId(edited.id))?.['description']).toBe('Changed past the hooks');
    expect(await getDocumentAsOwner(copyPath(unshared.id))).toBeNull();
    expect(await getDocumentAsOwner(copyPath(deleted.id))).toBeNull();
    expectQuiet();
  }, 30000);

  it('goes on from a check to a full pass when the counts disagree, and settles on the check once they agree', async () => {
    const first = await writeRow();
    const second = await writeRow({ amount: 30 });
    await service.share([first.id, second.id], householdId);
    expect(await service.reconcile(householdId, 'check')).toEqual({ pass: 'check', written: 0, deleted: 0 });

    // An amount changed past the hooks leaves the counts alike: the check
    // settles, and the drift waits for the journal or the weekly full pass.
    await lite.updateDoc(lite.doc(owner.lite, rowPath(first.id)), { amount: 99 });
    expect(await service.reconcile(householdId, 'check')).toEqual({ pass: 'check', written: 0, deleted: 0 });

    // A row shared past the hooks has no copy: the counts differ, and the
    // full pass writes that copy and the drifted one.
    const missing = await writeRowPastHooks({ sharedWith: [shareKey(householdId)] });
    expect(await service.reconcile(householdId, 'check')).toEqual({ pass: 'full', written: 2, deleted: 0 });
    const view = await peerView();
    expect(view.get(copyId(first.id))?.['amount']).toBe(99);
    expect(view.has(copyId(missing))).toBeTrue();
    expect(await service.reconcile(householdId, 'check')).toEqual({ pass: 'check', written: 0, deleted: 0 });
    expectQuiet();
  }, 30000);
});
