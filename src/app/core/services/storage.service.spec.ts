import { TestBed } from '@angular/core/testing';
import { Storage } from '@angular/fire/storage';
import { StorageService, MAX_RECEIPT_BYTES } from './storage.service';
import { RECEIPT_IMAGE_UNREADABLE } from '../utils/receipt-image.utils';

/**
 * Unit tests for StorageService. The thin Firebase Storage pass-throughs
 * (ref/uploadBytes/getDownloadURL/deleteObject) are covered end-to-end by the
 * emulator smoke test (storage.service.smoke.spec.ts); here we only unit test
 * the deterministic logic (the size guard) that runs before any network call.
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

  // An oversized image is no longer refused — it is compressed to fit, which
  // is what storage.service.smoke.spec.ts proves against real Storage. What is
  // still refused here is an oversized file nothing can decode, and it is
  // refused by name: "attach failed" told a user nothing they could act on.
  it('names an oversized file it cannot decode, rather than failing vaguely', async () => {
    const undecodable = new File(
      ['x'.repeat(MAX_RECEIPT_BYTES + 1)],
      'big.heic',
      { type: 'image/heic' }
    );

    await expectAsync(
      service.uploadReceipt('uid', 'txn-1', undecodable)
    ).toBeRejectedWithError(RECEIPT_IMAGE_UNREADABLE);
  });

  it('refuses the same file on a non-zero slot too', async () => {
    const undecodable = new File(
      ['x'.repeat(MAX_RECEIPT_BYTES + 1)],
      'big.heic',
      { type: 'image/heic' }
    );

    await expectAsync(
      service.uploadReceipt('uid', 'txn-1', undecodable, 2)
    ).toBeRejectedWithError(RECEIPT_IMAGE_UNREADABLE);
  });
});
