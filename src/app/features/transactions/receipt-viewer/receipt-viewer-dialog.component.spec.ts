import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import {
  ReceiptViewerDialogComponent,
  ReceiptViewerDialogData,
  openReceiptViewer,
} from './receipt-viewer-dialog.component';
import { ReceiptTranslationService } from '../../../core/services/receipt-translation.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NoteTranslation } from '../../../core/services/llm-provider.interface';
import { createTransaction } from '../../../core/services/testing/test-data';
import { Transaction } from '../../../models';

describe('ReceiptViewerDialogComponent', () => {
  let fixture: ComponentFixture<ReceiptViewerDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<ReceiptViewerDialogComponent>>;
  let available: ReturnType<typeof signal<boolean>>;
  let translate: jasmine.Spy;
  let failureKey: jasmine.Spy;
  let dialogData: ReceiptViewerDialogData;

  const FIRST = 'https://example.com/receipt-0.jpg';
  const SECOND = 'https://example.com/receipt-2.jpg';
  const THIRD = 'https://example.com/receipt-3.jpg';

  const answer: NoteTranslation = {
    text: 'Rice ball 150\nGreen tea 120',
    sourceLanguage: 'Japanese',
  };

  /** Two live images with a tombstone between them: slots 0 and 2, never 0 and 1. */
  function twoImages(): Transaction {
    return createTransaction({ description: 'Family Mart', receiptUrls: [FIRST, '', SECOND] });
  }

  /** The same shape one image longer: slots 0, 2 and 3. */
  function threeImages(): Transaction {
    return createTransaction({
      description: 'Family Mart',
      receiptUrls: [FIRST, '', SECOND, THIRD],
    });
  }

  /** A translation held open, so the in-flight state can be asserted. */
  function pendingTranslation(): {
    resolve: (value: NoteTranslation) => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: (value: NoteTranslation) => void;
    let reject!: (error: unknown) => void;
    translate.and.returnValue(
      new Promise<NoteTranslation>((res, rej) => {
        resolve = res;
        reject = rej;
      })
    );
    return { resolve, reject };
  }

  function open(data: ReceiptViewerDialogData): void {
    dialogData = data;
    fixture = TestBed.createComponent(ReceiptViewerDialogComponent);
    fixture.detectChanges();
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function imageSource(): string | null {
    return query('img.receipt-image')?.getAttribute('src') ?? null;
  }

  function click(selector: string): void {
    (query(selector) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj<MatDialogRef<ReceiptViewerDialogComponent>>('MatDialogRef', [
      'close',
    ]);
    available = signal(true);
    translate = jasmine.createSpy('translate').and.resolveTo(answer);
    failureKey = jasmine.createSpy('failureKey').and.returnValue('noteTranslation.failed');

    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    // Key, plus any parameters it was given: the counter and the alt text
    // exist to say which image this is, and a resolver answering with the
    // bare key would pass whether or not the numbers ever reached it.
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${JSON.stringify(params)}` : key
    );

    await TestBed.configureTestingModule({
      imports: [ReceiptViewerDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        {
          provide: ReceiptTranslationService,
          useValue: { available, translate, failureKey },
        },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();
  });

  it('shows the first stored image, named by its place in the set', () => {
    open({ transaction: twoImages() });

    expect(imageSource()).toBe(FIRST);
    expect(query('img.receipt-image')?.getAttribute('alt'))
      .toBe('receiptImages.imageNumber|{"index":1,"total":2}');
    expect(query('.viewer-subtitle')?.textContent).toContain('Family Mart');
  });

  it('opens on the slot it was asked for, which is not the index of that number', () => {
    open({ transaction: threeImages(), slot: 3 });

    // Slot 3 is the third live image, because slot 1 is a tombstone.
    expect(imageSource()).toBe(THIRD);
    expect(query('img.receipt-image')?.getAttribute('alt'))
      .toBe('receiptImages.imageNumber|{"index":3,"total":3}');
  });

  it('opens on the first image when the slot it was given is no longer stored', () => {
    open({ transaction: twoImages(), slot: 1 });

    expect(imageSource()).toBe(FIRST);
  });

  it('walks the live slots and stops at each end', () => {
    open({ transaction: threeImages() });

    expect((query('.previous-button') as HTMLButtonElement).disabled).toBeTrue();
    expect(query('.previous-button')?.getAttribute('aria-label')).toBe('receiptViewer.previous');
    expect(query('.next-button')?.getAttribute('aria-label')).toBe('receiptViewer.next');
    expect(query('.image-counter')?.textContent)
      .toContain('receiptImages.imageNumber|{"index":1,"total":3}');
    // The alt on the image already says this; the counter would only repeat
    // it for a screen reader if it were not hidden from one.
    expect(query('.image-counter')?.getAttribute('aria-hidden')).toBe('true');

    click('.next-button');
    expect(imageSource()).toBe(SECOND);
    expect((query('.previous-button') as HTMLButtonElement).disabled).toBeFalse();

    click('.next-button');
    expect(imageSource()).toBe(THIRD);
    expect((query('.next-button') as HTMLButtonElement).disabled).toBeTrue();

    click('.previous-button');
    expect(imageSource()).toBe(SECOND);
    expect(query('.image-counter')?.textContent)
      .toContain('receiptImages.imageNumber|{"index":2,"total":3}');
  });

  it('moves focus onto Previous when Next reaches the last image and disables itself', async () => {
    open({ transaction: threeImages() });
    (query('.next-button') as HTMLButtonElement).focus();

    click('.next-button');
    click('.next-button');
    await settle();

    // The button the click landed on just disabled itself, so without this
    // focus is on <body> and the keyboard has to walk the whole dialog
    // again to reach either arrow.
    expect(document.activeElement).toBe(query('.previous-button'));
  });

  it('moves focus onto Next when Previous reaches the first image and disables itself', async () => {
    open({ transaction: threeImages() });
    click('.next-button');
    (query('.previous-button') as HTMLButtonElement).focus();

    click('.previous-button');
    await settle();

    expect(document.activeElement).toBe(query('.next-button'));
  });

  it('leaves the arrows out when there is nowhere to go', () => {
    open({ transaction: createTransaction({ receiptUrl: FIRST }) });

    expect(query('.image-nav')).toBeNull();
    expect(query('.previous-button')).toBeNull();
    expect(query('.next-button')).toBeNull();
    expect(imageSource()).toBe(FIRST);
  });

  it('renders nothing but the header and close button for a transaction with no live image', () => {
    open({ transaction: createTransaction({ receiptUrls: ['', ''] }) });

    expect(query('img.receipt-image')).toBeNull();
    expect(query('.image-nav')).toBeNull();
    expect(query('.receipt-lens')).toBeNull();
    expect(query('.open-in-new-tab-link')).toBeNull();
    expect(query('.close-button')).not.toBeNull();
  });

  it('names the dialog through the header', () => {
    open({ transaction: twoImages() });

    expect(query('.dialog-header-text')?.textContent).toContain('receiptViewer.title');
    expect(query('.dialog-header-icon')?.textContent).toContain('receipt_long');
  });

  it('hides the decorative arrow and translate icons from assistive tech', () => {
    open({ transaction: threeImages() });

    const icons = Array.from(fixture.nativeElement.querySelectorAll('mat-icon')) as HTMLElement[];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('asks for nothing until the user asks', () => {
    open({ transaction: twoImages() });

    expect(translate).not.toHaveBeenCalled();
    expect(query('.translate-button')).not.toBeNull();
  });

  it('offers the disabled button and names the fix when no provider can see', () => {
    available.set(false);
    open({ transaction: twoImages() });

    expect((query('.translate-button') as HTMLButtonElement).disabled).toBeTrue();
    expect(query('.no-provider-hint')?.textContent).toContain('receiptViewer.noVisionProvider');
  });

  it('spins while the model reads the photo, then shows the text beside it', async () => {
    const transaction = twoImages();
    const pending = pendingTranslation();
    open({ transaction });

    click('.translate-button');
    expect(query('app-loading-spinner')).not.toBeNull();
    expect(query('app-loading-spinner')?.textContent).toContain('noteTranslation.translating');
    expect(translate).toHaveBeenCalledOnceWith(transaction, 0);

    pending.resolve(answer);
    await settle();

    expect(query('app-loading-spinner')).toBeNull();
    expect(query('.translation-panel')?.getAttribute('role')).toBe('status');
    expect(query('.translation-marker')?.textContent)
      .toContain('noteTranslation.marker|{"language":"Japanese"}');
    expect(query('.translated-text')?.textContent).toContain('Rice ball 150');
    // The photo is what is being read: it stays on screen beside the reading.
    expect(imageSource()).toBe(FIRST);
  });

  it('moves focus onto Hide translation when the panel replaces the button', async () => {
    open({ transaction: twoImages() });
    const button = query('.translate-button') as HTMLButtonElement;
    button.focus();

    button.click();
    fixture.detectChanges();
    await settle();

    // The button the click landed on is gone by the time the answer
    // arrives, so without this focus is on <body> and the keyboard has to
    // walk the whole dialog again to reach the lens.
    expect(document.activeElement).toBe(query('.hide-translation-button'));
  });

  it('leaves focus alone when the reader moved it away while the model answered', async () => {
    const pending = pendingTranslation();
    open({ transaction: twoImages() });
    const button = query('.translate-button') as HTMLButtonElement;
    button.focus();

    button.click();
    fixture.detectChanges();

    // Nothing in this dialog sits outside it the way the edit form's own
    // textarea sits outside the note lens, but the same principle holds:
    // wherever the reader's focus already is when the answer lands is
    // theirs, not this dialog's to take back.
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    pending.resolve(answer);
    await settle();

    const focused = document.activeElement;
    outside.remove();
    expect(focused).toBe(outside);
  });

  it('keeps the translation readable line by line', async () => {
    open({ transaction: twoImages() });
    click('.translate-button');
    await settle();

    expect(getComputedStyle(query('.translated-text')!).whiteSpace).toBe('pre-wrap');
  });

  it('translates the image the reader is looking at, not the one it opened on', async () => {
    const transaction = threeImages();
    open({ transaction });

    click('.next-button');
    click('.translate-button');
    await settle();

    expect(translate).toHaveBeenCalledOnceWith(transaction, 2);
  });

  it('puts the panel away on demand and leaves the photo where it was', async () => {
    open({ transaction: twoImages() });
    click('.translate-button');
    await settle();

    click('.hide-translation-button');

    expect(query('.translation-panel')).toBeNull();
    expect(query('.translate-button')).not.toBeNull();
    expect(imageSource()).toBe(FIRST);
  });

  it('hands focus back to Translate when the translation is hidden', async () => {
    open({ transaction: twoImages() });
    click('.translate-button');
    await settle();

    click('.hide-translation-button');

    expect(document.activeElement).toBe(query('.translate-button'));
  });

  it('shows the failure the service names and retries on demand', async () => {
    const failure = new Error('receipt image download failed');
    failureKey.and.returnValue('receiptViewer.failedDownload');
    translate.and.rejectWith(failure);
    open({ transaction: twoImages() });

    click('.translate-button');
    await settle();

    expect(failureKey).toHaveBeenCalledWith(failure);
    const error = query('.translation-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('receiptViewer.failedDownload');
    // A failed reading says nothing about the photo, which is still the thing
    // the reader opened this for.
    expect(imageSource()).toBe(FIRST);

    translate.and.resolveTo(answer);
    click('.retry-button');
    await settle();

    expect(translate).toHaveBeenCalledTimes(2);
    expect(query('.translation-error')).toBeNull();
    expect(query('.translated-text')?.textContent).toContain('Rice ball 150');
  });

  it('disables Retry too when no provider can see', async () => {
    translate.and.rejectWith(new Error('offline'));
    open({ transaction: twoImages() });

    click('.translate-button');
    await settle();

    available.set(false);
    fixture.detectChanges();

    expect((query('.retry-button') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('moves focus onto Retry when the failure replaces the button', async () => {
    translate.and.rejectWith(new Error('offline'));
    open({ transaction: twoImages() });
    const button = query('.translate-button') as HTMLButtonElement;
    button.focus();

    button.click();
    fixture.detectChanges();
    await settle();

    expect(document.activeElement).toBe(query('.retry-button'));
  });

  it('leaves the translation behind with the image it was read from', async () => {
    open({ transaction: twoImages() });
    click('.translate-button');
    await settle();
    expect(query('.translation-panel')).not.toBeNull();

    click('.next-button');

    expect(query('.translation-panel')).toBeNull();
    expect(query('.translate-button')).not.toBeNull();
  });

  it('ignores an answer that arrives for an image the reader has moved off', async () => {
    const pending = pendingTranslation();
    open({ transaction: twoImages() });

    click('.translate-button');
    click('.next-button');
    pending.resolve(answer);
    await settle();

    expect(query('.translation-panel')).toBeNull();
    expect(query('app-loading-spinner')).toBeNull();
    expect(query('.translate-button')).not.toBeNull();
  });

  it('drops a superseded rejection instead of raising an alarm over the image now shown', async () => {
    const pending = pendingTranslation();
    open({ transaction: twoImages() });

    click('.translate-button');
    click('.next-button');
    pending.reject(new Error('stale rate limit'));
    await settle();

    expect(failureKey).not.toHaveBeenCalled();
    expect(query('.translation-error')).toBeNull();
  });

  it('offers the image it is showing in a new tab', () => {
    open({ transaction: twoImages() });

    const link = query('.open-in-new-tab-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(FIRST);
    expect(link.getAttribute('target')).toBe('_blank');
    // A new tab opened from the app must not get a handle back to it.
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.textContent).toContain('receiptViewer.openInNewTab');

    click('.next-button');

    expect(query('.open-in-new-tab-link')?.getAttribute('href')).toBe(SECOND);
  });

  it('closes from the header', () => {
    open({ transaction: twoImages() });

    click('.dialog-header-close');

    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('closes from the actions row', () => {
    open({ transaction: twoImages() });

    click('.close-button');

    expect(dialogRef.close).toHaveBeenCalled();
  });

  describe('openReceiptViewer', () => {
    it('opens the viewer wide enough for a photo, and never wider than the screen', () => {
      const dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
      const data: ReceiptViewerDialogData = { transaction: twoImages(), slot: 2 };

      openReceiptViewer(dialog, data);

      expect(dialog.open).toHaveBeenCalledOnceWith(ReceiptViewerDialogComponent, {
        width: 'min(720px, calc(100vw - 32px))',
        data,
      });
    });
  });
});
