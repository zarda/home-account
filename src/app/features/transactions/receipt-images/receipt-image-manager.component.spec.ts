import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';

import { ReceiptImageManagerComponent } from './receipt-image-manager.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import {
  ReceiptToNoteService,
  RECEIPT_TO_NOTE_AI_UNAVAILABLE,
} from '../../../core/services/receipt-to-note.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { createTransaction } from '../../../core/services/testing';

describe('ReceiptImageManagerComponent', () => {
  let transactionService: jasmine.SpyObj<TransactionService>;
  let receiptToNote: jasmine.SpyObj<ReceiptToNoteService>;
  let quota: jasmine.SpyObj<ReceiptQuotaService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let dialog: jasmine.SpyObj<MatDialog>;

  const transactions = [
    createTransaction({ id: 't1', description: 'Cafe', receiptUrl: 'https://x/1.jpg' }),
    createTransaction({ id: 't2', description: 'Market', receiptUrl: 'https://x/2.jpg' }),
  ];

  function build() {
    const fixture = TestBed.createComponent(ReceiptImageManagerComponent);
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    transactionService = jasmine.createSpyObj('TransactionService', [
      'getTransactionsWithReceipts', 'removeReceipt',
    ]);
    transactionService.getTransactionsWithReceipts.and.returnValue(of(transactions));
    transactionService.removeReceipt.and.resolveTo(undefined);

    receiptToNote = jasmine.createSpyObj('ReceiptToNoteService', ['convertReceiptToNote']);
    receiptToNote.convertReceiptToNote.and.resolveTo('details');

    quota = jasmine.createSpyObj(
      'ReceiptQuotaService',
      ['refreshCount', 'hasUnlimitedImages', 'imageLimit', 'isAtLimit'],
      { imageCount: signal<number | null>(2) }
    );
    quota.refreshCount.and.resolveTo(2);
    quota.hasUnlimitedImages.and.returnValue(false);
    quota.imageLimit.and.returnValue(200);
    quota.isAtLimit.and.returnValue(false);

    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [ReceiptImageManagerComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MatDialog, useValue: dialog },
        { provide: TransactionService, useValue: transactionService },
        { provide: ReceiptToNoteService, useValue: receiptToNote },
        { provide: ReceiptQuotaService, useValue: quota },
        { provide: TranslationService, useValue: translation },
        { provide: NotificationService, useValue: notifications },
      ],
    })
      .overrideComponent(ReceiptImageManagerComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  it('loads image-bearing transactions and refreshes the quota count', async () => {
    const component = build();
    await component.ngOnInit();

    expect(component.transactions().length).toBe(2);
    expect(component.isLoading()).toBeFalse();
    expect(quota.refreshCount).toHaveBeenCalled();
  });

  it('removes an image after confirmation and drops the row', async () => {
    const component = build();
    await component.ngOnInit();

    await component.removeImage(transactions[0]);

    expect(transactionService.removeReceipt).toHaveBeenCalledWith('t1');
    expect(component.transactions().map(t => t.id)).toEqual(['t2']);
    expect(notifications.success).toHaveBeenCalledWith('receiptImages.removed');
  });

  it('keeps the image when the removal is not confirmed', async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    const component = build();
    await component.ngOnInit();

    await component.removeImage(transactions[0]);

    expect(transactionService.removeReceipt).not.toHaveBeenCalled();
    expect(component.transactions().length).toBe(2);
  });

  it('converts an image to note text and drops the row', async () => {
    const component = build();
    await component.ngOnInit();

    await component.convertToNote(transactions[1]);

    expect(receiptToNote.convertReceiptToNote).toHaveBeenCalledWith(transactions[1]);
    expect(component.transactions().map(t => t.id)).toEqual(['t1']);
    expect(notifications.success).toHaveBeenCalledWith('receiptImages.converted');
  });

  it('reports a missing AI provider without dropping the row', async () => {
    receiptToNote.convertReceiptToNote.and.rejectWith(new Error(RECEIPT_TO_NOTE_AI_UNAVAILABLE));
    const component = build();
    await component.ngOnInit();

    await component.convertToNote(transactions[0]);

    expect(component.transactions().length).toBe(2);
    expect(notifications.error).toHaveBeenCalledWith('receiptImages.convertFailedNoAi');
  });
});
