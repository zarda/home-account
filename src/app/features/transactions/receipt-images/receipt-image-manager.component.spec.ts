import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';

import { ReceiptImageManagerComponent } from './receipt-image-manager.component';
import { ReceiptViewerDialogComponent } from '../receipt-viewer/receipt-viewer-dialog.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import {
  ReceiptToNoteService,
  RECEIPT_TO_NOTE_AI_UNAVAILABLE,
} from '../../../core/services/receipt-to-note.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { createTransaction, createTranslationStub, createLocaleFormatStub } from '../../../core/services/testing';
import { LocaleFormatService } from '../../../core/services/locale-format.service';

const managedTransactions = [
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
      'getTransactionsWithReceiptsOnce', 'removeReceiptAt', 'removeAllReceipts',
    ]);
    transactionService.getTransactionsWithReceiptsOnce.and.resolveTo(transactions);
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

  it('loads with no live listener to fall back to', async () => {
    // The mock stubs only the one-shot method; a regression to the listener
    // would call an undefined spy and throw before ngOnInit resolves.
    const component = build();
    await component.ngOnInit();

    expect(component.groups().length).toBe(2);
  });

  // Template is blanked in this suite (no thumbnail to click), so the door
  // is proved at method level — the DOM click is the list spec's job.
  it('opens the receipt viewer on the image the thumbnail belongs to', async () => {
    const component = build();
    await component.ngOnInit();
    const group = component.groups()[0];

    component.openReceipt(group, group.images[1]);

    expect(dialog.open).toHaveBeenCalledWith(
      ReceiptViewerDialogComponent,
      jasmine.objectContaining({ data: { transaction: group.transaction, slot: 1 } })
    );
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

/**
 * Every case above compiles the dialog with `{ imports: [], template: '' }`
 * and drives it by calling methods, so the list a user actually sees has
 * never rendered: the loading/empty/list three-way gate, one tile per image,
 * the remove-all control that only exists on a multi-image row, and the
 * per-tile spinner that replaces both actions while that slot is busy.
 */
describe('ReceiptImageManagerComponent, through its own template', () => {
  let fixture: ComponentFixture<ReceiptImageManagerComponent>;
  let component: ReceiptImageManagerComponent;
  let transactionsSpy: jasmine.SpyObj<TransactionService>;
  let quotaSpy: jasmine.SpyObj<ReceiptQuotaService>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<ReceiptImageManagerComponent>>;
  let atLimit: ReturnType<typeof signal<boolean>>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const groups = () => Array.from(el().querySelectorAll('.receipt-group')) as HTMLElement[];
  const tiles = (group: HTMLElement) =>
    Array.from(group.querySelectorAll('.image-tile')) as HTMLElement[];

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(ReceiptImageManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.ngOnInit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    atLimit = signal(false);
    transactionsSpy = jasmine.createSpyObj('TransactionService', [
      'getTransactionsWithReceiptsOnce', 'removeReceiptAt', 'removeAllReceipts',
    ]);
    transactionsSpy.getTransactionsWithReceiptsOnce.and.resolveTo(managedTransactions);
    transactionsSpy.removeReceiptAt.and.resolveTo(undefined);
    transactionsSpy.removeAllReceipts.and.resolveTo(undefined);

    // `isAtLimit` is a signal on the real service, and it has to stay one
    // here: an undeclared change-detection strategy is OnPush, so only a
    // signal read in the template re-renders the view when it flips.
    quotaSpy = jasmine.createSpyObj(
      'ReceiptQuotaService',
      ['refreshCount', 'hasUnlimitedImages', 'imageLimit'],
      { imageCount: signal<number | null>(3), isAtLimit: atLimit }
    );
    quotaSpy.refreshCount.and.resolveTo(3);
    quotaSpy.hasUnlimitedImages.and.returnValue(false);
    quotaSpy.imageLimit.and.returnValue(200);

    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    const toNote = jasmine.createSpyObj('ReceiptToNoteService', ['convertReceiptToNote']);
    toNote.convertReceiptToNote.and.resolveTo('details');
    const dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    dialogSpy.open.and.returnValue({ afterClosed: () => of(true) } as never);

    await TestBed.configureTestingModule({
      imports: [ReceiptImageManagerComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MatDialog, useValue: dialogSpy },
        { provide: TransactionService, useValue: transactionsSpy },
        { provide: ReceiptToNoteService, useValue: toNote },
        { provide: ReceiptQuotaService, useValue: quotaSpy },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
      ],
    }).compileComponents();
  });

  it('shows the spinner before the first read comes back', () => {
    fixture = TestBed.createComponent(ReceiptImageManagerComponent);
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')).not.toBeNull();
    expect(el().querySelector('.receipt-list')).toBeNull();
    expect(el().querySelector('.empty-message')).toBeNull();
  });

  it('says the store is empty rather than showing a bare list', async () => {
    transactionsSpy.getTransactionsWithReceiptsOnce.and.resolveTo([]);
    await render();

    expect(text('.empty-message')).toBe('receiptImages.empty');
    expect(el().querySelector('.receipt-list')).toBeNull();
  });

  it('renders one group per row and one tile per image', async () => {
    await render();

    expect(groups().length).toBe(2);
    expect(tiles(groups()[0]).length).toBe(2);
    expect(tiles(groups()[1]).length).toBe(1);
    expect(groups()[0].querySelector('.item-description')?.textContent?.trim()).toBe('Cafe');
    expect(groups()[1].querySelector('.item-description')?.textContent?.trim()).toBe('Market');
  });

  it('numbers each thumbnail for a screen reader', async () => {
    await render();

    const images = Array.from(tiles(groups()[0]).map(t => t.querySelector('img') as HTMLImageElement));
    expect(images.map(i => i.alt)).toEqual([
      'receiptImages.imageNumber:{"index":1,"total":2}',
      'receiptImages.imageNumber:{"index":2,"total":2}',
    ]);
    expect(images[0].getAttribute('loading')).toBe('lazy');
  });

  it('offers remove-all only on a row that has more than one image', async () => {
    await render();

    expect(groups()[0].querySelector('.remove-all-btn')).not.toBeNull();
    expect(groups()[1].querySelector('.remove-all-btn')).toBeNull();
  });

  it('gives every tile its own convert and remove actions', async () => {
    await render();

    const actions = Array.from(tiles(groups()[0])[0].querySelectorAll('.tile-actions button')) as HTMLButtonElement[];
    expect(actions.map(b => b.getAttribute('aria-label')))
      .toEqual(['receiptImages.convertToNote', 'receiptImages.removeImage']);
  });

  it('replaces one busy slot\'s actions with a spinner, leaving its neighbour alone', async () => {
    await render();
    const busySlot = component.groups()[0].images[0].slot;
    // Driven through the component's own `busyKeys` signal rather than by
    // spying on `isBusy`: an undeclared change-detection strategy is OnPush
    // here, so only a signal read in the template re-renders the view.
    component.busyKeys.set(new Set([`t1:${busySlot}`]));
    fixture.detectChanges();

    expect(tiles(groups()[0])[0].querySelector('mat-spinner')).not.toBeNull();
    expect(tiles(groups()[0])[0].querySelector('.tile-actions button')).toBeNull();
    // A slot-scoped key locks that slot only: the second tile is still usable.
    expect(tiles(groups()[0])[1].querySelector('mat-spinner')).toBeNull();
    expect(tiles(groups()[0])[1].querySelectorAll('.tile-actions button').length).toBe(2);
  });

  it('locks the whole row, remove-all included, while a row-wide action runs', async () => {
    await render();
    component.busyKeys.set(new Set(['t1:*']));
    fixture.detectChanges();

    const row = groups()[0];
    expect((row.querySelector('.remove-all-btn') as HTMLButtonElement).disabled).toBeTrue();
    expect(
      (Array.from(row.querySelectorAll('.tile-actions button')) as HTMLButtonElement[])
        .every(b => b.disabled)
    ).toBeTrue();
  });

  it('opens the viewer from a thumbnail a user clicks', async () => {
    await render();
    const opened = spyOn(component, 'openReceipt');

    (tiles(groups()[0])[0].querySelector('.thumbnail-link') as HTMLButtonElement).click();

    expect(opened).toHaveBeenCalled();
  });

  it('carries the usage line, and marks it when the quota is full', async () => {
    await render();
    expect(text('.usage-line span')).toBe(component.usageText());
    expect(el().querySelector('.usage-line')?.classList).not.toContain('at-limit');

    atLimit.set(true);
    fixture.detectChanges();

    expect(el().querySelector('.usage-line')?.classList).toContain('at-limit');
  });

  it('closes from the header X and from the actions bar', async () => {
    await render();

    (el().querySelector('.dialog-header-close') as HTMLButtonElement).click();
    expect(dialogRefSpy.close).toHaveBeenCalled();

    dialogRefSpy.close.calls.reset();
    (el().querySelector('mat-dialog-actions button') as HTMLButtonElement).click();
    expect(dialogRefSpy.close).toHaveBeenCalled();
  });
});
