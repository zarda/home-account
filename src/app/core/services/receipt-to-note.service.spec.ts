import { TestBed } from '@angular/core/testing';

import {
  ReceiptToNoteService,
  RECEIPT_TO_NOTE_AI_UNAVAILABLE,
  RECEIPT_TO_NOTE_NO_DETAILS,
} from './receipt-to-note.service';
import { TransactionService } from './transaction.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { ParsedReceipt } from './gemini.service';
import { createTransaction, MockAuthService } from './testing';

describe('ReceiptToNoteService', () => {
  let service: ReceiptToNoteService;
  let transactionMock: jasmine.SpyObj<TransactionService>;
  let cloudMock: jasmine.SpyObj<CloudLLMProviderService>;
  let storageMock: jasmine.SpyObj<StorageService>;
  let fetchSpy: jasmine.Spy;

  const receipt = (overrides: Partial<ParsedReceipt> = {}): ParsedReceipt => ({
    merchant: 'Cafe',
    amount: 12,
    currency: 'USD',
    date: new Date(2026, 0, 1),
    items: [],
    receiptDetails: 'Latte — 5.00\nBagel — 7.00\nTotal 12.00',
    suggestedCategory: 'food',
    confidence: 0.9,
    ...overrides,
  });

  const transactionWithReceipt = (overrides = {}) =>
    createTransaction({
      id: 'txn-1',
      currency: 'USD',
      receiptUrl: 'https://storage.example.com/receipt.jpg',
      ...overrides,
    });

  beforeEach(() => {
    transactionMock = jasmine.createSpyObj<TransactionService>('TransactionService', [
      'updateTransaction',
      'removeReceipt',
    ]);
    transactionMock.updateTransaction.and.resolveTo();
    transactionMock.removeReceipt.and.resolveTo();

    cloudMock = jasmine.createSpyObj<CloudLLMProviderService>('CloudLLMProviderService', [
      'hasAnyCloudProvider',
      'parseReceipt',
    ]);
    cloudMock.hasAnyCloudProvider.and.returnValue(true);
    cloudMock.parseReceipt.and.resolveTo(receipt());

    storageMock = jasmine.createSpyObj<StorageService>('StorageService', ['downloadReceipt']);
    storageMock.downloadReceipt.and.resolveTo(new Blob(['img'], { type: 'image/jpeg' }));

    fetchSpy = spyOn(window, 'fetch').and.resolveTo(
      new Response(new Blob(['img'], { type: 'image/jpeg' }), { status: 200 })
    );

    TestBed.configureTestingModule({
      providers: [
        ReceiptToNoteService,
        { provide: TransactionService, useValue: transactionMock },
        { provide: CloudLLMProviderService, useValue: cloudMock },
        { provide: StorageService, useValue: storageMock },
        { provide: AuthService, useClass: MockAuthService },
      ],
    });

    (TestBed.inject(AuthService) as unknown as MockAuthService).setAuthenticated(true);
    service = TestBed.inject(ReceiptToNoteService);
  });

  it('writes the receipt details to the note, then removes the image', async () => {
    const callOrder: string[] = [];
    transactionMock.updateTransaction.and.callFake(async () => { callOrder.push('update'); });
    transactionMock.removeReceipt.and.callFake(async () => { callOrder.push('remove'); });

    const note = await service.convertReceiptToNote(transactionWithReceipt());

    expect(note).toBe('Latte — 5.00\nBagel — 7.00\nTotal 12.00');
    // Downloaded through the Storage SDK — a plain fetch of the download
    // URL would hit the browser's CORS-header-less cached <img> response
    expect(storageMock.downloadReceipt).toHaveBeenCalledWith('test-user-123', 'txn-1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cloudMock.parseReceipt).toHaveBeenCalledWith(jasmine.stringMatching(/^data:image\//));
    expect(transactionMock.updateTransaction).toHaveBeenCalledWith('txn-1', { note });
    expect(transactionMock.removeReceipt).toHaveBeenCalledWith('txn-1');
    // The note must be persisted before the image is deleted
    expect(callOrder).toEqual(['update', 'remove']);
  });

  it('falls back to a cache-bypassing fetch when the SDK download fails', async () => {
    storageMock.downloadReceipt.and.rejectWith(new Error('storage/object-not-found'));

    const note = await service.convertReceiptToNote(transactionWithReceipt());

    expect(note).toBe('Latte — 5.00\nBagel — 7.00\nTotal 12.00');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://storage.example.com/receipt.jpg',
      { cache: 'no-store' }
    );
  });

  it('appends the details after an existing note', async () => {
    const note = await service.convertReceiptToNote(
      transactionWithReceipt({ note: 'my note' })
    );
    expect(note).toBe('my note\n\nLatte — 5.00\nBagel — 7.00\nTotal 12.00');
  });

  it('falls back to the itemized list when the AI returns no receiptDetails', async () => {
    cloudMock.parseReceipt.and.resolveTo(receipt({
      receiptDetails: undefined,
      items: [{ name: 'Latte', amount: 5 }],
    }));

    const note = await service.convertReceiptToNote(transactionWithReceipt());
    expect(note).toBe('Latte — USD 5.00');
  });

  it('rejects without touching the transaction when no AI provider is configured', async () => {
    cloudMock.hasAnyCloudProvider.and.returnValue(false);

    await expectAsync(service.convertReceiptToNote(transactionWithReceipt()))
      .toBeRejectedWithError(RECEIPT_TO_NOTE_AI_UNAVAILABLE);
    expect(transactionMock.updateTransaction).not.toHaveBeenCalled();
    expect(transactionMock.removeReceipt).not.toHaveBeenCalled();
  });

  it('keeps the image when the AI extracts nothing', async () => {
    cloudMock.parseReceipt.and.resolveTo(receipt({ receiptDetails: undefined, items: [] }));

    await expectAsync(service.convertReceiptToNote(transactionWithReceipt()))
      .toBeRejectedWithError(RECEIPT_TO_NOTE_NO_DETAILS);
    expect(transactionMock.removeReceipt).not.toHaveBeenCalled();
  });

  it('rejects when both download paths fail', async () => {
    storageMock.downloadReceipt.and.rejectWith(new Error('storage/object-not-found'));
    fetchSpy.and.resolveTo(new Response(null, { status: 404 }));

    await expectAsync(service.convertReceiptToNote(transactionWithReceipt()))
      .toBeRejectedWithError(/Failed to download/);
    expect(transactionMock.removeReceipt).not.toHaveBeenCalled();
  });

  it('rejects a transaction without a stored image', async () => {
    await expectAsync(service.convertReceiptToNote(createTransaction({ id: 'txn-2' })))
      .toBeRejectedWithError(RECEIPT_TO_NOTE_NO_DETAILS);
  });
});
