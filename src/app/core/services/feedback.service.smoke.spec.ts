// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the calls FirestoreService makes via @angular/fire.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  Firestore
} from '@angular/fire/firestore';
import { FeedbackService } from './feedback.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TranslationService } from './translation.service';

/**
 * Integration smoke test for the per-entry feedback delete against the
 * Firestore emulator and the real `firestore.rules`.
 *
 * This one exists because of what #306 actually was: the rules had permitted
 * an owner delete since the feature shipped, and the app never offered it. So
 * the claim the fix rests on — that the door can be opened with no rules
 * change and no deploy — is a claim about the *deployed* rules, and a mocked
 * FirestoreService cannot make it. What is checked here is that an owner's
 * delete is allowed, that a stranger's is not, and that update stays shut, so
 * opening the door did not widen anything else.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('FeedbackService delete (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let service: FeedbackService;

  // A second signed-in account, to prove the rule is about ownership rather
  // than merely about being authenticated.
  let strangerApp: FirebaseApp;
  let strangerFirestore: Firestore;

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `feedback-smoke-${Date.now()}`
    );
    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    // A fresh anonymous user per run keeps the collection isolated; no
    // cross-run cleanup needed.
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    strangerApp = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `feedback-smoke-stranger-${Date.now()}`
    );
    const strangerAuth = getAuth(strangerApp);
    connectAuthEmulator(strangerAuth, AUTH_URL, { disableWarnings: true });
    strangerFirestore = getFirestore(strangerApp);
    connectFirestoreEmulator(strangerFirestore, FIRESTORE_HOST, FIRESTORE_PORT);
    await signInAnonymously(strangerAuth);
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
    await deleteApp(strangerApp).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FeedbackService,
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid } },
        { provide: TranslationService, useValue: { currentLocale: () => 'en' } }
      ]
    });
    service = TestBed.inject(FeedbackService);
  });

  async function storedIds(): Promise<string[]> {
    const snapshot = await getDocs(collection(firestore, `users/${uid}/feedback`));
    return snapshot.docs.map(entry => entry.id);
  }

  it('lets the owner delete one entry and leaves the rest', async () => {
    const keep = await service.add('idea', 'a widget would be nice');
    const remove = await service.add('bug', 'the chart is upside down');

    expect(await storedIds()).toContain(remove);

    await service.delete(remove);

    // Read the collection, not a cached view: the point is that the document
    // is gone from the server, which is what the About list is reading.
    const remaining = await storedIds();
    expect(remaining).not.toContain(remove);
    expect(remaining).toContain(keep);
  });

  it('refuses a delete from another signed-in account', async () => {
    const id = await service.add('other', 'mine, not yours');

    await expectAsync(
      deleteDoc(doc(strangerFirestore, `users/${uid}/feedback/${id}`))
    ).toBeRejected();

    expect(await storedIds()).toContain(id);
  });

  // Opening the delete must not have loosened anything next to it: the
  // stored record still has to match the mail the operator was already sent.
  it('still refuses an update from the owner', async () => {
    const id = await service.add('bug', 'the original wording');

    await expectAsync(
      updateDoc(doc(firestore, `users/${uid}/feedback/${id}`), { message: 'rewritten' })
    ).toBeRejected();
  });

  it('refuses a create that a stranger addresses to this account', async () => {
    await expectAsync(
      setDoc(doc(strangerFirestore, `users/${uid}/feedback/planted`), {
        userId: uid,
        category: 'bug',
        message: 'planted',
        appVersion: '0.0.0',
        platform: 'web',
        locale: 'en'
      })
    ).toBeRejected();
  });
});
