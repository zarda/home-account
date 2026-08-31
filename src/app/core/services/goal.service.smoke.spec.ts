// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  deleteDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';

import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { GoalService, GOAL_CONTRIBUTION_BELOW_ZERO } from './goal.service';
import { Goal } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * Integration smoke test for GoalService against the emulators.
 *
 * The unit spec stubs runTransaction, so it proves the arithmetic but not
 * that the writes clear goalCreateValid/goalUpdateValid in firestore.rules —
 * a transactional update that drops or mistypes one field is invisible to a
 * spy and a permission error in production. Only the emulator enforces the
 * real rules.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('GoalService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: GoalService;

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `goal-service-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GoalService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } }
      ]
    });
    service = TestBed.inject(GoalService);
  });

  it('rounds a full life cycle through the real rules', async () => {
    const id = await service.createGoal({
      kind: 'project',
      name: 'Japan trip',
      targetAmount: 2000,
      currency: 'USD',
      targetDate: new Date(2027, 3, 1),
      items: [
        { name: 'Flights', amount: 800, done: false },
        { name: 'Hotel', amount: 1200, done: false }
      ]
    });

    try {
      await service.contribute(id, 25.5);
      await service.contribute(id, -10);
      await expectAsync(service.contribute(id, -100)).toBeRejectedWithError(
        GOAL_CONTRIBUTION_BELOW_ZERO
      );

      await service.toggleItem(id, 0, true);
      await service.updateGoal(id, { name: 'Japan trip 2027', targetDate: null });

      const stored = await getDoc(doc(firestore, `users/${uid}/goals/${id}`));
      expect(stored.exists()).toBeTrue();
      const data = stored.data() as Goal & { targetDate?: Timestamp };
      expect(data.name).toBe('Japan trip 2027');
      expect(data.contributedAmount).toBe(15.5);
      expect(data.items?.[0].done).toBeTrue();
      expect(data.items?.[1].done).toBeFalse();
      expect('targetDate' in data).toBeFalse();

      await service.deleteGoal(id);
      const gone = await getDoc(doc(firestore, `users/${uid}/goals/${id}`));
      expect(gone.exists()).toBeFalse();
    } finally {
      await deleteDoc(doc(firestore, `users/${uid}/goals/${id}`)).catch(() => undefined);
    }
  }, 30000);

  it('restores at a chosen id with the contributed amount intact', async () => {
    const id = 'smoke-goal-restore';

    try {
      await service.createGoal(
        { kind: 'saving', name: 'Emergency fund', targetAmount: 3000, currency: 'USD' },
        { id, contributedAmount: 750 }
      );

      const stored = await getDoc(doc(firestore, `users/${uid}/goals/${id}`));
      expect(stored.exists()).toBeTrue();
      expect((stored.data() as Goal).contributedAmount).toBe(750);
    } finally {
      await deleteDoc(doc(firestore, `users/${uid}/goals/${id}`)).catch(() => undefined);
    }
  }, 30000);
});
