// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a Storage
// instance built from root `firebase/storage` is incompatible with the `ref()`
// StorageService calls via @angular/fire — they must come from the same copy.
import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
  FirebaseStorage,
  Storage
} from '@angular/fire/storage';
import { StorageService, MAX_RECEIPT_BYTES } from './storage.service';

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

  // Payload whose bytes identify it, so slot↔object assertions compare content.
  const markedFile = (marker: number) =>
    new File([new Uint8Array([0xff, 0xd8, marker, 0xd9])], `receipt-${marker}.jpg`, {
      type: 'image/jpeg'
    });

  const markerOf = async (blob: Blob): Promise<number> =>
    new Uint8Array(await blob.arrayBuffer())[2];

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

  it('uploads several images for one transaction into distinct slots', async () => {
    const id = 'smoke-multi';
    const urls = await Promise.all([
      service.uploadReceipt(uid, id, markedFile(0x10), 0),
      service.uploadReceipt(uid, id, markedFile(0x11), 1),
      service.uploadReceipt(uid, id, markedFile(0x12), 2)
    ]);

    expect(new Set(urls).size).toBe(3);

    // Content proves the slot→object mapping instead of assuming it.
    expect(await markerOf(await service.downloadReceipt(uid, id, 0))).toBe(0x10);
    expect(await markerOf(await service.downloadReceipt(uid, id, 1))).toBe(0x11);
    expect(await markerOf(await service.downloadReceipt(uid, id, 2))).toBe(0x12);
  });

  it('keeps slot 0 at the unsuffixed legacy key', async () => {
    const id = 'smoke-legacy-slot';
    // The pre-slot call signature: what every object in production was
    // uploaded with. Slot 0 must resolve to the same object.
    await service.uploadReceipt(uid, id, markedFile(0x21));

    expect(await markerOf(await service.downloadReceipt(uid, id))).toBe(0x21);
    expect(await markerOf(await service.downloadReceipt(uid, id, 0))).toBe(0x21);
  });

  it('deletes one slot without touching the others', async () => {
    const id = 'smoke-slot-delete';
    await service.uploadReceipt(uid, id, markedFile(0x30), 0);
    await service.uploadReceipt(uid, id, markedFile(0x31), 1);
    await service.uploadReceipt(uid, id, markedFile(0x32), 2);

    await service.deleteReceipt(uid, id, 1);

    await expectAsync(service.downloadReceipt(uid, id, 1)).toBeRejected();
    expect(await markerOf(await service.downloadReceipt(uid, id, 0))).toBe(0x30);
    expect(await markerOf(await service.downloadReceipt(uid, id, 2))).toBe(0x32);
  });

  it('deleteReceiptSlots tolerates gaps', async () => {
    const id = 'smoke-slot-sweep';
    // Slot 1 deliberately missing — the shape a middle removal leaves behind.
    await service.uploadReceipt(uid, id, markedFile(0x40), 0);
    await service.uploadReceipt(uid, id, markedFile(0x42), 2);

    await expectAsync(service.deleteReceiptSlots(uid, id, [0, 1, 2])).toBeResolved();

    await expectAsync(service.downloadReceipt(uid, id, 0)).toBeRejected();
    await expectAsync(service.downloadReceipt(uid, id, 2)).toBeRejected();
  });

  it('storage.rules cover suffixed slot names too', async () => {
    // Owner check reaches a suffixed object name.
    await expectAsync(
      service.uploadReceipt('a-different-user', 'smoke-denied', imageFile(), 3)
    ).toBeRejected();

    // Size limit reaches a suffixed name: bypass the client-side guard and
    // upload raw bytes, proving `{fileName}` matched `_1` server-side rather
    // than falling through to the deny-all rule.
    const oversized = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    const suffixedRef = ref(storage, `users/${uid}/receipts/smoke-oversized_1`);
    await expectAsync(
      uploadBytes(suffixedRef, oversized, { contentType: 'image/jpeg' })
    ).toBeRejected();
  });
});
