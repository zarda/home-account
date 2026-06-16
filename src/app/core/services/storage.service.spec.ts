import { TestBed } from '@angular/core/testing';
import { Storage } from '@angular/fire/storage';
import { StorageService, MAX_RECEIPT_BYTES } from './storage.service';

/**
 * StorageService wraps the Firebase Storage modular SDK (ref/uploadBytes/
 * getDownloadURL/deleteObject). As with FirestoreService, those thin
 * pass-throughs are exercised end-to-end via TransactionService tests using a
 * MockStorageService; here we unit test the deterministic logic (the size
 * guard) that runs before any network call.
 */
describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        StorageService,
        // Stub the Storage instance — the size-guard path never touches it.
        { provide: Storage, useValue: {} }
      ]
    });
    service = TestBed.inject(StorageService);
  });

  it('creates the service', () => {
    expect(service).toBeTruthy();
  });

  it('caps the receipt size at 2 MB', () => {
    expect(MAX_RECEIPT_BYTES).toBe(2 * 1024 * 1024);
  });

  it('rejects an oversized receipt before attempting an upload', async () => {
    const oversized = {
      size: MAX_RECEIPT_BYTES + 1,
      type: 'image/jpeg',
      name: 'big.jpg'
    } as File;

    await expectAsync(
      service.uploadReceipt('uid', 'txn-1', oversized)
    ).toBeRejectedWithError(/limit/);
  });
});
