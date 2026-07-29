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
    createTransaction({
      id: 't1',
      description: 'Cafe',
      receiptUrl: 'https://x/1a.jpg',
      receiptUrls: ['https://x/1a.jpg', 'https://x/1b.jpg'],
      receiptCount: 2,
    }),
    // A legacy row: single receiptUrl, no array.
    createTransaction({ id: 't2', description: 'Market', receiptUrl: 'https://x/2.jpg' }),
  ];

  function build() {
    const fixture = TestBed.createComponent(ReceiptImageManagerComponent);
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    transactionService = jasmine.createSpyObj('TransactionService', [
      'getTransactionsWithReceipts', 'removeReceiptAt', 'removeAllReceipts',
    ]);
    transactionService.getTransactionsWithReceipts.and.returnValue(of(transactions));
    transactionService.removeReceiptAt.and.resolveTo(undefined);
    transactionService.removeAllReceipts.and.resolveTo(undefined);

    receiptToNote = jasmine.createSpyObj('ReceiptToNoteService', ['convertReceiptToNote']);
    receiptToNote.convertReceiptToNote.and.resolveTo('details');

    quota = jasmine.createSpyObj(
      'ReceiptQuotaService',
      ['refreshCount', 'hasUnlimitedImages', 'imageLimit', 'isAtLimit'],
      { imageCount: signal<number | null>(3) }
    );
    quota.refreshCount.and.resolveTo(3);
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

  it('groups one entry per image and refreshes the quota count', async () => {
    const component = build();
    await component.ngOnInit();

    expect(component.groups().length).toBe(2);
    // The multi-image transaction renders one tile per image, keyed by slot.
    expect(component.groups()[0].images).toEqual([
      { url: 'https://x/1a.jpg', slot: 0 },
      { url: 'https://x/1b.jpg', slot: 1 },
    ]);
    // A legacy row renders exactly one tile at slot 0.
    expect(component.groups()[1].images).toEqual([{ url: 'https://x/2.jpg', slot: 0 }]);
    expect(component.isLoading()).toBeFalse();
    expect(quota.refreshCount).toHaveBeenCalled();
  });

  it('removes one image by slot and keeps its siblings and group', async () => {
    const component = build();
    await component.ngOnInit();
    const group = component.groups()[0];

    await component.removeImage(group, group.images[1]);

    expect(transactionService.removeReceiptAt).toHaveBeenCalledWith('t1', 1);
    // The group stays, holding the surviving image.
    expect(component.groups()[0].images).toEqual([{ url: 'https://x/1a.jpg', slot: 0 }]);
    expect(component.groups().length).toBe(2);
    expect(notifications.success).toHaveBeenCalledWith('receiptImages.removed');
  });

  it('drops the whole group when its last image is removed', async () => {
    const component = build();
    await component.ngOnInit();
    const group = component.groups()[1];

    await component.removeImage(group, group.images[0]);

    expect(transactionService.removeReceiptAt).toHaveBeenCalledWith('t2', 0);
    expect(component.groups().map(g => g.transaction.id)).toEqual(['t1']);
  });

  it('keeps the image when the removal is not confirmed', async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
    const component = build();
    await component.ngOnInit();
    const group = component.groups()[0];

    await component.removeImage(group, group.images[0]);

    expect(transactionService.removeReceiptAt).not.toHaveBeenCalled();
    expect(component.groups()[0].images.length).toBe(2);
  });

  it('removes a whole group at once after a count-aware confirmation', async () => {
    const component = build();
    await component.ngOnInit();

    await component.removeAllImages(component.groups()[0]);

    expect(transactionService.removeAllReceipts).toHaveBeenCalledWith('t1');
    expect(component.groups().map(g => g.transaction.id)).toEqual(['t2']);
    expect(notifications.success).toHaveBeenCalledWith('receiptImages.removedAll');
  });

  it('converts one image by slot, leaving the first untouched', async () => {
    const component = build();
    await component.ngOnInit();
    const group = component.groups()[0];

    await component.convertToNote(group, group.images[1]);

    expect(receiptToNote.convertReceiptToNote).toHaveBeenCalledWith(group.transaction, 1);
    expect(component.groups()[0].images).toEqual([{ url: 'https://x/1a.jpg', slot: 0 }]);
    expect(notifications.success).toHaveBeenCalledWith('receiptImages.converted');
  });

  it('carries the appended note into a second conversion of the same transaction', async () => {
    receiptToNote.convertReceiptToNote.and.resolveTo('first details');
    const component = build();
    await component.ngOnInit();

    await component.convertToNote(component.groups()[0], component.groups()[0].images[0]);

    // The second conversion must see the note the first one wrote — not the
    // note the dialog loaded with — or its append would overwrite it.
    receiptToNote.convertReceiptToNote.calls.reset();
    receiptToNote.convertReceiptToNote.and.resolveTo('first details\n\nsecond details');
    await component.convertToNote(component.groups()[0], component.groups()[0].images[0]);

    const passed = receiptToNote.convertReceiptToNote.calls.mostRecent().args[0];
    expect(passed.note).toBe('first details');
  });

  it('reports a missing AI provider without dropping the image', async () => {
    receiptToNote.convertReceiptToNote.and.rejectWith(new Error(RECEIPT_TO_NOTE_AI_UNAVAILABLE));
    const component = build();
    await component.ngOnInit();
    const group = component.groups()[0];

    await component.convertToNote(group, group.images[0]);

    expect(component.groups()[0].images.length).toBe(2);
    expect(notifications.error).toHaveBeenCalledWith('receiptImages.convertFailedNoAi');
  });

  it('busy state is per image, not per transaction', async () => {
    const component = build();
    await component.ngOnInit();

    expect(component.isBusy('t1', 0)).toBeFalse();
    // While slot 1 converts, slot 0 stays actionable.
    let release!: (value: string) => void;
    receiptToNote.convertReceiptToNote.and.returnValue(
      new Promise<string>(resolve => (release = resolve))
    );
    const group = component.groups()[0];
    const conversion = component.convertToNote(group, group.images[1]);

    expect(component.isBusy('t1', 1)).toBeTrue();
    expect(component.isBusy('t1', 0)).toBeFalse();

    release('done');
    await conversion;
    expect(component.isBusy('t1', 1)).toBeFalse();
  });
});
