// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a Storage
// instance built from root `firebase/storage` is incompatible with the `ref()`
// StorageService calls via @angular/fire — they must come from the same copy.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import { getStorage, connectStorageEmulator, FirebaseStorage, Storage } from '@angular/fire/storage';
import { StorageService } from './storage.service';

/**
 * Integration smoke test for StorageService against the Firebase emulators.
 *
 * Unlike the mocked unit tests, this exercises the real upload → download-URL →
 * delete round-trip through the Firebase SDK, and verifies that storage.rules
 * actually scope receipts to the owning user.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage`.)
 */
describe('StorageService (emulator smoke test)', () => {
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let storage: FirebaseStorage;
  let service: StorageService;
  let uid: string;

  // Minimal JPEG-typed payload; the emulator checks contentType/size, not pixels.
  const imageFile = () =>
    new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'receipt.jpg', { type: 'image/jpeg' });

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        StorageService,
        { provide: Storage, useValue: storage }
      ]
    });
    service = TestBed.inject(StorageService);
  });

  it('uploads a receipt and returns a usable download URL', async () => {
    const url = await service.uploadReceipt(uid, 'smoke-upload', imageFile());

    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    expect(url).toContain('demo-home-account');
  });

  it('deletes the stored receipt and treats a second delete as a no-op', async () => {
    await service.uploadReceipt(uid, 'smoke-delete', imageFile());

    await expectAsync(service.deleteReceipt(uid, 'smoke-delete')).toBeResolved();
    // Object is gone now — deleteReceipt swallows object-not-found.
    await expectAsync(service.deleteReceipt(uid, 'smoke-delete')).toBeResolved();
  });

  it('enforces storage.rules: writing to another user\'s path is rejected', async () => {
    await expectAsync(
      service.uploadReceipt('a-different-user', 'smoke-denied', imageFile())
    ).toBeRejected();
  });
});
