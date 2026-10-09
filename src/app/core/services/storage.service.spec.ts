import { TestBed } from '@angular/core/testing';
import { Storage } from '@angular/fire/storage';
import { StorageService, MAX_RECEIPT_BYTES } from './storage.service';
import { IMPORT_FILE_MAX_BYTES } from './share-intake.service';
import { RECEIPT_IMAGE_UNREADABLE } from '../utils/receipt-image.utils';
import storageRules from '../../../../storage.rules';

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

  // The stored-photo ceiling lives twice: here, and in storage.rules, which is
  // what actually refuses an oversized upload. Nothing else ties the two
  // together, so the rules file is read as text and every size clause in it is
  // held to the constant.
  describe('the storage.rules size ceiling', () => {
    /** Multiplies a `2 * 1024 * 1024` expression out; anything but digits and `*` is refused, never evaluated. */
    function product(expression: string): number {
      if (!/^[\d\s*]+$/.test(expression)) {
        throw new Error(`Not a plain product: ${expression}`);
      }
      return expression
        .split('*')
        .map(factor => Number(factor.trim()))
        .reduce((total, factor) => total * factor, 1);
    }

    const ceilings = Array.from(
      storageRules.matchAll(/request\.resource\.size\s*<=\s*([^\n&|;)]+)/g),
      match => match[1].trim()
    );

    it('finds the size clauses it is meant to check', () => {
      // Every mention of the size has to be a clause the pattern reads: one
      // rewritten as `<` or with its operands reversed would otherwise drop
      // out of the check below while the rules raise its ceiling.
      const mentions = storageRules.match(/request\.resource\.size\b/g) ?? [];
      expect(ceilings.length).toBeGreaterThan(0);
      expect(ceilings.length)
        .withContext('a request.resource.size clause not written as <= …')
        .toBe(mentions.length);
    });

    it('holds every size clause to MAX_RECEIPT_BYTES', () => {
      expect(ceilings.map(product)).toEqual(ceilings.map(() => MAX_RECEIPT_BYTES));
    });

    it('keeps the intake ceiling for originals at or above the stored-photo ceiling', () => {
      expect(IMPORT_FILE_MAX_BYTES).toBeGreaterThanOrEqual(MAX_RECEIPT_BYTES);
    });

    it('caps an imported file at 10 MB, the figure the refusal and the docs state', () => {
      expect(IMPORT_FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
    });
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
