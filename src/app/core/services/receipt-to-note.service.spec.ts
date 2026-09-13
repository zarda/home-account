import { TestBed } from '@angular/core/testing';

import {
  ReceiptToNoteService,
  RECEIPT_TO_NOTE_AI_UNAVAILABLE,
  RECEIPT_TO_NOTE_NO_DETAILS,
  RECEIPT_TO_NOTE_DOWNLOAD_FAILED,
} from './receipt-to-note.service';
import { TransactionService } from './transaction.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { ReceiptImageService, RECEIPT_IMAGE_DOWNLOAD_FAILED } from './receipt-image.service';
import { ParsedReceipt } from './gemini.service';
import { createTransaction } from './testing';

describe('ReceiptToNoteService', () => {
  let service: ReceiptToNoteService;
  let transactionMock: jasmine.SpyObj<TransactionService>;
  let cloudMock: jasmine.SpyObj<CloudLLMProviderService>;
  let receiptImageMock: jasmine.SpyObj<ReceiptImageService>;

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
      'removeReceiptAt',
    ]);
    transactionMock.updateTransaction.and.resolveTo();
    transactionMock.removeReceiptAt.and.resolveTo();

    cloudMock = jasmine.createSpyObj<CloudLLMProviderService>('CloudLLMProviderService', [
      'hasAnyCloudProvider',
      'parseReceipt',
    ]);
    cloudMock.hasAnyCloudProvider.and.returnValue(true);
    cloudMock.parseReceipt.and.resolveTo(receipt());

    receiptImageMock = jasmine.createSpyObj<ReceiptImageService>('ReceiptImageService', [
      'loadAsDataUrl',
    ]);
    receiptImageMock.loadAsDataUrl.and.resolveTo('data:image/jpeg;base64,aW1n');

    TestBed.configureTestingModule({
      providers: [
        ReceiptToNoteService,
        { provide: TransactionService, useValue: transactionMock },
        { provide: CloudLLMProviderService, useValue: cloudMock },
        { provide: ReceiptImageService, useValue: receiptImageMock },
      ],
    });

    service = TestBed.inject(ReceiptToNoteService);
  });

  it('writes the receipt details to the note, then removes the image', async () => {
    const transaction = transactionWithReceipt();
    const callOrder: string[] = [];
    transactionMock.updateTransaction.and.callFake(async () => { callOrder.push('update'); });
    transactionMock.removeReceiptAt.and.callFake(async () => { callOrder.push('remove'); });

    const note = await service.convertReceiptToNote(transaction);

    expect(note).toBe('Latte — 5.00\nBagel — 7.00\nTotal 12.00');
    expect(receiptImageMock.loadAsDataUrl).toHaveBeenCalledWith(transaction, 0);
    expect(cloudMock.parseReceipt).toHaveBeenCalledWith('data:image/jpeg;base64,aW1n');
    expect(transactionMock.updateTransaction).toHaveBeenCalledWith('txn-1', { note });
    expect(transactionMock.removeReceiptAt).toHaveBeenCalledWith('txn-1', 0);
    // The note must be persisted before the image is deleted
    expect(callOrder).toEqual(['update', 'remove']);
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
    expect(transactionMock.removeReceiptAt).not.toHaveBeenCalled();
  });

  it('keeps the image when the AI extracts nothing', async () => {
    cloudMock.parseReceipt.and.resolveTo(receipt({ receiptDetails: undefined, items: [] }));

    await expectAsync(service.convertReceiptToNote(transactionWithReceipt()))
      .toBeRejectedWithError(RECEIPT_TO_NOTE_NO_DETAILS);
    expect(transactionMock.removeReceiptAt).not.toHaveBeenCalled();
  });

  it('rejects with the download error when the loader fails', async () => {
    receiptImageMock.loadAsDataUrl.and.rejectWith(new Error(RECEIPT_IMAGE_DOWNLOAD_FAILED));

    await expectAsync(service.convertReceiptToNote(transactionWithReceipt()))
      .toBeRejectedWithError(RECEIPT_TO_NOTE_DOWNLOAD_FAILED);
    expect(transactionMock.removeReceiptAt).not.toHaveBeenCalled();
  });

  it('rejects a transaction without a stored image', async () => {
    await expectAsync(service.convertReceiptToNote(createTransaction({ id: 'txn-2' })))
      .toBeRejectedWithError(RECEIPT_TO_NOTE_NO_DETAILS);
  });

  it('defaults to the first live image when the first slot is tombstoned', async () => {
    const transaction = transactionWithReceipt({
      receiptUrl: 'https://storage.example.com/u1.jpg',
      receiptUrls: ['', 'https://storage.example.com/u1.jpg'],
      receiptCount: 1,
    });

    await service.convertReceiptToNote(transaction);

    expect(receiptImageMock.loadAsDataUrl).toHaveBeenCalledWith(transaction, 1);
    expect(transactionMock.removeReceiptAt).toHaveBeenCalledWith('txn-1', 1);
  });
});
