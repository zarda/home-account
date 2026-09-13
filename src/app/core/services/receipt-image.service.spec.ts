import { TestBed } from '@angular/core/testing';

import { ReceiptImageService, RECEIPT_IMAGE_DOWNLOAD_FAILED } from './receipt-image.service';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { createTransaction, MockAuthService } from './testing';

describe('ReceiptImageService', () => {
  let service: ReceiptImageService;
  let storageMock: jasmine.SpyObj<StorageService>;
  let fetchSpy: jasmine.Spy;

  const transactionWithReceipt = (overrides = {}) =>
    createTransaction({
      id: 'txn-1',
      receiptUrl: 'https://storage.example.com/receipt.jpg',
      ...overrides,
    });

  beforeEach(() => {
    storageMock = jasmine.createSpyObj<StorageService>('StorageService', ['downloadReceipt']);
    storageMock.downloadReceipt.and.resolveTo(new Blob(['img'], { type: 'image/jpeg' }));

    fetchSpy = spyOn(window, 'fetch').and.resolveTo(
      new Response(new Blob(['img'], { type: 'image/jpeg' }), { status: 200 })
    );

    TestBed.configureTestingModule({
      providers: [
        ReceiptImageService,
        { provide: StorageService, useValue: storageMock },
        { provide: AuthService, useClass: MockAuthService },
      ],
    });

    (TestBed.inject(AuthService) as unknown as MockAuthService).setAuthenticated(true);
    service = TestBed.inject(ReceiptImageService);
  });

  it('downloads through the Storage SDK and encodes the result as a data URL', async () => {
    const dataUrl = await service.loadAsDataUrl(transactionWithReceipt(), 0);

    // Downloaded through the Storage SDK — a plain fetch of the download
    // URL would hit the browser's CORS-header-less cached <img> response
    expect(storageMock.downloadReceipt).toHaveBeenCalledWith('test-user-123', 'txn-1', 0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('falls back to a cache-bypassing fetch when the SDK download fails', async () => {
    storageMock.downloadReceipt.and.rejectWith(new Error('storage/object-not-found'));

    const dataUrl = await service.loadAsDataUrl(transactionWithReceipt(), 0);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.example.com/receipt.jpg',
      { cache: 'no-store' }
    );
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('re-types a non-image blob so it can be parsed back out of the data URL', async () => {
    storageMock.downloadReceipt.and.resolveTo(
      new Blob(['img'], { type: 'application/octet-stream' })
    );

    const dataUrl = await service.loadAsDataUrl(transactionWithReceipt(), 0);

    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('throws when both the Storage SDK and the fallback fetch fail', async () => {
    storageMock.downloadReceipt.and.rejectWith(new Error('storage/object-not-found'));
    fetchSpy.and.resolveTo(new Response(null, { status: 404 }));

    await expectAsync(service.loadAsDataUrl(transactionWithReceipt(), 0))
      .toBeRejectedWithError(RECEIPT_IMAGE_DOWNLOAD_FAILED);
  });

  it('downloads the requested slot of a multi-image transaction', async () => {
    const transaction = transactionWithReceipt({
      receiptUrls: ['https://storage.example.com/u0.jpg', 'https://storage.example.com/u1.jpg'],
      receiptCount: 2,
    });

    await service.loadAsDataUrl(transaction, 1);

    expect(storageMock.downloadReceipt).toHaveBeenCalledWith('test-user-123', 'txn-1', 1);
  });

  it('uses the requested slot\'s stored URL for the fallback fetch', async () => {
    storageMock.downloadReceipt.and.rejectWith(new Error('storage/object-not-found'));
    const transaction = transactionWithReceipt({
      receiptUrls: ['https://storage.example.com/u0.jpg', 'https://storage.example.com/u1.jpg'],
      receiptCount: 2,
    });

    await service.loadAsDataUrl(transaction, 1);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.example.com/u1.jpg',
      { cache: 'no-store' }
    );
  });
});
