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
  updateMetadata,
  deleteObject,
  FirebaseStorage,
  Storage
} from '@angular/fire/storage';
import { StorageService, MAX_RECEIPT_BYTES } from './storage.service';
import {
  setDocumentAsOwner,
  deleteDocumentAsOwner,
  integerField,
  timestampField
} from './testing';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

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

  /**
   * A photo far too large for the ceiling, in the shape a phone produces:
   * portrait, and noisy enough that JPEG cannot compress it away. The
   * fixtures above are four bytes and prove nothing about the size path.
   */
  const oversizedPhoto = async (): Promise<File> => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 2000;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = Math.floor(Math.random() * 256);
      pixels.data[i + 1] = Math.floor(Math.random() * 256);
      pixels.data[i + 2] = Math.floor(Math.random() * 256);
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 1)
    );
    return new File([blob!], 'IMG_0042.jpg', { type: 'image/jpeg' });
  };

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

  it('uploads a photo that was too large, having made it fit', async () => {
    // The bug this covers (#334): a phone photo is 2-5 MB, the ceiling is 2,
    // and nothing used to close that gap — so the upload failed and the
    // import lost the whole transaction. What lands must be under the real
    // rule, which is enforced by the emulator here and not by the client.
    const photo = await oversizedPhoto();
    expect(photo.size).toBeGreaterThan(MAX_RECEIPT_BYTES);

    await expectAsync(service.uploadReceipt(uid, 'smoke-oversized-ok', photo)).toBeResolved();

    const stored = await service.downloadReceipt(uid, 'smoke-oversized-ok');
    expect(stored.size).toBeLessThanOrEqual(MAX_RECEIPT_BYTES);
    expect(stored.size).toBeGreaterThan(0);
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

  describe('metadata updates', () => {
    // The only door to storage.rules' `allow update` branch a test can open.
    // The storage emulator routes every upload through `create` — an existing
    // object at the path included — and leaves `update` to metadata writes
    // alone, so no upload here reaches the branch production takes for every
    // overwrite. These two cases stand in for it: that it exists at all, and
    // that it is still scoped to the owner.
    //
    // The denial half needs a second account rather than a second path. The
    // rule is only reached with a full `resource` when the object exists, so a
    // write aimed at a stranger's empty path would be denied for the object
    // being absent and would prove nothing about the owner check.
    let strangerApp: FirebaseApp;
    let strangerStorage: FirebaseStorage;

    beforeAll(async () => {
      strangerApp = initializeApp(
        {
          apiKey: 'fake-api-key',
          projectId: 'demo-home-account',
          storageBucket: 'demo-home-account.appspot.com'
        },
        `smoke-stranger-${Date.now()}`
      );

      const strangerAuth = getAuth(strangerApp);
      connectAuthEmulator(strangerAuth, AUTH_URL, { disableWarnings: true });

      strangerStorage = getStorage(strangerApp);
      connectStorageEmulator(strangerStorage, STORAGE_HOST, STORAGE_PORT);

      await signInAnonymously(strangerAuth);
    });

    afterAll(async () => {
      await deleteApp(strangerApp).catch(() => undefined);
    });

    it('lets the owner update the metadata of their own receipt', async () => {
      const name = 'smoke-metadata-owner';
      await service.uploadReceipt(uid, name, imageFile());

      await expectAsync(
        updateMetadata(ref(storage, `users/${uid}/receipts/${name}`), {
          customMetadata: { rotated: 'true' }
        })
      ).toBeResolved();
    });

    it('denies the same update to a different signed-in user', async () => {
      const name = 'smoke-metadata-stranger';
      await service.uploadReceipt(uid, name, imageFile());

      await expectAsync(
        updateMetadata(ref(strangerStorage, `users/${uid}/receipts/${name}`), {
          customMetadata: { rotated: 'true' }
        })
      ).toBeRejectedWithError(/storage\/unauthorized/);
    });
  });
});

/**
 * Enforcement tests for the receipt-image quota in storage.rules (#137).
 *
 * The quota used to live in the client alone, which fails open: a raw SDK
 * client ignored the tier limit entirely. The rule reads the count the
 * storage triggers maintain at users/{uid}/quota/receiptImages, so only the
 * emulator — with firestore and storage running together, cross-service reads
 * live — can show that it holds.
 *
 * A suite of its own with its own app and its own anonymous account: these
 * cases put the account at its limit, and the suite above uploads freely as
 * the account it signs in as. Specs run in random order, so sharing a uid
 * would let one suite's quota state decide the other's outcomes.
 *
 * The triggers are not running here (the functions emulator is not part of
 * the smoke run), so the quota document is seeded out of band through the
 * emulator's owner credential — which is also the only way to write it, the
 * rules denying every client write by design.
 */
describe('storage.rules receipt quota (emulator smoke test)', () => {
  const STORAGE_HOST = '127.0.0.1';
  const STORAGE_PORT = 9199;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let storage: FirebaseStorage;
  let uid: string;

  const uploaded: string[] = [];
  const receiptBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  const quotaPath = () => `users/${uid}/quota/receiptImages`;

  /** The document shape the triggers write. `limit: 0` means unlimited. */
  const seedQuota = (count: number, limit: number) =>
    setDocumentAsOwner(quotaPath(), {
      count: integerField(count),
      limit: integerField(limit),
      updatedAt: timestampField()
    });

  const upload = (name: string) => {
    uploaded.push(name);
    return uploadBytes(ref(storage, `users/${uid}/receipts/${name}`), receiptBytes, {
      contentType: 'image/jpeg'
    });
  };

  /**
   * The rule refused it, rather than merely: something went wrong. A bare
   * rejection would let a downed emulator or a misconfigured bucket read as
   * the quota holding, and these cases exist precisely to say it holds.
   */
  const expectDeniedByRules = (write: Promise<unknown>) =>
    expectAsync(write).toBeRejectedWithError(/storage\/unauthorized/);

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `smoke-quota-${Date.now()}`
    );

    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE_HOST, STORAGE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  });

  afterAll(async () => {
    await deleteDocumentAsOwner(quotaPath()).catch(() => undefined);
    await Promise.allSettled(
      uploaded.map(name => deleteObject(ref(storage, `users/${uid}/receipts/${name}`)))
    );
    await deleteApp(app).catch(() => undefined);
  });

  it('allows an upload while the quota document does not exist yet', async () => {
    // The triggers create the document on the first object event, so every
    // account has a window with no document at all — and an account whose
    // objects were all deleted goes back to having none. Denying here would
    // lock every new user out of their first receipt.
    await deleteDocumentAsOwner(quotaPath());

    await expectAsync(upload('quota-bootstrap')).toBeResolved();
  });

  it('allows a new upload below the limit', async () => {
    await seedQuota(3, 200);

    await expectAsync(upload('quota-under-limit')).toBeResolved();
  });

  it('denies a new upload at the limit', async () => {
    // The case the client-side check could not make: this rejection comes
    // from the rule, with no app code in the path at all.
    await seedQuota(200, 200);

    await expectDeniedByRules(upload('quota-at-limit'));
  });

  it('denies a new upload past the limit', async () => {
    // A count above the limit is reachable: the limit can be lowered, and a
    // recount can land after several objects arrived.
    await seedQuota(250, 200);

    await expectDeniedByRules(upload('quota-over-limit'));
  });

  it('still allows overwriting an existing object at the limit', async () => {
    // Replacing a receipt does not grow the count, so it must not consult
    // the quota — otherwise an account at its limit could never re-shoot a
    // blurred photo.
    await seedQuota(3, 200);
    await upload('quota-overwrite');

    await seedQuota(200, 200);

    await expectAsync(upload('quota-overwrite')).toBeResolved();
  });

  it('still allows deleting an object at the limit', async () => {
    // Deleting is how an account gets back under its limit; a rule that
    // blocked it would make the limit a trap with no way out.
    await seedQuota(3, 200);
    await upload('quota-delete');

    await seedQuota(200, 200);

    await expectAsync(
      deleteObject(ref(storage, `users/${uid}/receipts/quota-delete`))
    ).toBeResolved();
  });

  it('treats limit 0 as unlimited', async () => {
    // The premium tier's sentinel, stored verbatim because neither JSON nor
    // a rules expression carries an infinity. Read as a number it would deny
    // every upload the paying accounts make.
    await seedQuota(9999, 0);

    await expectAsync(upload('quota-unlimited')).toBeResolved();
  });

  it('follows the document as it changes, with nothing cached', async () => {
    // The rule reads the count per request. If anything memoised it, an
    // account would stay blocked after deleting receipts until some opaque
    // window expired.
    await seedQuota(200, 200);
    await expectDeniedByRules(upload('quota-rewritten'));

    await seedQuota(1, 200);
    await expectAsync(upload('quota-rewritten')).toBeResolved();
  });
});
