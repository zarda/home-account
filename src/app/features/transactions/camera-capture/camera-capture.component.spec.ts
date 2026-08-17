import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CameraCaptureComponent } from './camera-capture.component';
import { AIImportService } from '../../../core/services/ai-import.service';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ImportResult } from '../../../models';
import {
  UNCATEGORIZED_CATEGORY_CONFIDENCE,
  UNRESOLVED_CATEGORY_CONFIDENCE,
} from '../../../core/utils/categorization.utils';
import { NotificationService } from '../../../core/services/notification.service';
import { DuplicateDetectionService } from '../../../core/services/duplicate-detection.service';

describe('CameraCaptureComponent', () => {
  let importService: jasmine.SpyObj<AIImportService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let strategyService: jasmine.SpyObj<AIStrategyService>;
  let pwaService: jasmine.SpyObj<PwaService>;
  let offlineQueue: jasmine.SpyObj<OfflineQueueService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translationService: jasmine.SpyObj<TranslationService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CameraCaptureComponent>>;
  let router: jasmine.SpyObj<Router>;
  let duplicateService: jasmine.SpyObj<DuplicateDetectionService>;

  const importResult: ImportResult = {
    source: 'image', fileType: 'receipt_image', fileName: 'a.jpg', fileSize: 1,
    transactions: [{ id: 't1', description: 'X', amount: 1, currency: 'USD', date: new Date(), type: 'expense', suggestedCategoryId: 'other_expense', categoryConfidence: 1, isDuplicate: false, selected: true }],
    confidence: 1, warnings: [], duplicates: [],
  };

  function file(name = 'r.jpg') {
    return new File(['x'], name, { type: 'image/jpeg' });
  }

  function build() {
    const fixture = TestBed.createComponent(CameraCaptureComponent);
    fixture.componentInstance.ngOnInit();
    return fixture;
  }

  beforeEach(async () => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    spyOn(URL, 'revokeObjectURL');

    importService = jasmine.createSpyObj('AIImportService', ['importFromImage', 'importFromMultipleImages']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    importService.importFromImage.and.resolveTo(importResult);
    importService.importFromMultipleImages.and.resolveTo(importResult);
    strategyService = jasmine.createSpyObj('AIStrategyService', [
      'canUseNative', 'canUseCloud', 'processReceipt', 'processMultipleImages', 'platform',
    ]);
    strategyService.canUseNative.and.returnValue(false);
    strategyService.canUseCloud.and.returnValue(true);
    strategyService.platform.and.returnValue('web');
    strategyService.processReceipt.and.resolveTo({ transactions: [{ description: 'X', amount: 1, currency: 'USD', date: new Date(), type: 'expense', confidence: 1 }], confidence: 1 } as never);
    strategyService.processMultipleImages.and.resolveTo({ transactions: [{ description: 'X', amount: 1, currency: 'USD', date: new Date(), type: 'expense', confidence: 1 }], confidence: 1 } as never);
    pwaService = jasmine.createSpyObj('PwaService', ['isIOS', 'isStandalone', 'isOnline']);
    pwaService.isIOS.and.returnValue(false);
    pwaService.isStandalone.and.returnValue(false);
    pwaService.isOnline.and.returnValue(true);
    offlineQueue = jasmine.createSpyObj('OfflineQueueService', ['queueImage']);
    offlineQueue.queueImage.and.resolveTo(undefined as never);
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    duplicateService = jasmine.createSpyObj('DuplicateDetectionService', ['checkDuplicates', 'markDuplicates']);
    duplicateService.checkDuplicates.and.resolveTo([]);
    duplicateService.markDuplicates.and.callFake(transactions => transactions);

    await TestBed.configureTestingModule({
      imports: [CameraCaptureComponent],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AIImportService, useValue: importService },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: PwaService, useValue: pwaService },
        { provide: OfflineQueueService, useValue: offlineQueue },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translationService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: router },
        { provide: DuplicateDetectionService, useValue: duplicateService },
      ],
    })
      .overrideComponent(CameraCaptureComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  function withImages(component: CameraCaptureComponent, n: number) {
    component.capturedImages.set(
      Array.from({ length: n }, (_, i) => ({ id: `i${i}`, file: file(`f${i}.jpg`), previewUrl: 'blob:fake' })),
    );
  }

  it('should create and detect platform on init', () => {
    const component = build().componentInstance;
    expect(component).toBeTruthy();
    expect(component.isOnline()).toBeTrue();
  });

  describe('computed signals', () => {
    it('reflects image presence and count limits', () => {
      const component = build().componentInstance;
      expect(component.hasImages()).toBeFalse();
      withImages(component, 3);
      expect(component.hasImages()).toBeTrue();
      expect(component.imageCount()).toBe(3);
      expect(component.canAddMore()).toBeTrue();
      withImages(component, 10);
      expect(component.canAddMore()).toBeFalse();
    });

    it('derives the processing mode', () => {
      // processingMode reads the (non-signal) strategy spies, so it settles
      // per instance — build a fresh component for each availability scenario.
      expect(build().componentInstance.processingMode()).toBe('cloud');

      strategyService.canUseNative.and.returnValue(true);
      expect(build().componentInstance.processingMode()).toBe('native');

      strategyService.canUseNative.and.returnValue(false);
      strategyService.canUseCloud.and.returnValue(false);
      expect(build().componentInstance.processingMode()).toBe('unavailable');

      pwaService.isOnline.and.returnValue(false);
      const component = build().componentInstance;
      expect(component.processingMode()).toBe('offline');
      expect(component.willUseCloudAI()).toBeFalse();
    });

    it('reads connectivity from PwaService rather than a local copy', () => {
      const component = build().componentInstance;
      expect(component.isOnline()).toBeTrue();

      // PwaService's reachability probe demotes this behind the component's
      // back; nothing here should shadow it with navigator.onLine.
      pwaService.isOnline.and.returnValue(false);
      expect(component.isOnline()).toBeFalse();
    });

    it('exposes legacy single-image accessors', () => {
      const component = build().componentInstance;
      expect(component.capturedImage()).toBeNull();
      expect(component.previewUrl()).toBeNull();
      withImages(component, 1);
      expect(component.capturedImage()).toBeTruthy();
      expect(component.previewUrl()).toBe('blob:fake');
    });
  });

  describe('image management', () => {
    it('onImageCaptured compresses and adds the image', async () => {
      const component = build().componentInstance;
      spyOn(component as unknown as { compressImage: (f: File) => Promise<File> }, 'compressImage').and.resolveTo(file());
      await component.onImageCaptured({ target: { files: [file()], value: '' } } as unknown as Event);
      expect(component.imageCount()).toBe(1);
    });

    it('onImageCaptured falls back to the original file on compression error', async () => {
      const component = build().componentInstance;
      spyOn(component as unknown as { compressImage: (f: File) => Promise<File> }, 'compressImage').and.rejectWith(new Error('x'));
      await component.onImageCaptured({ target: { files: [file()], value: '' } } as unknown as Event);
      expect(component.imageCount()).toBe(1);
    });

    it('onImageCaptured ignores an empty selection', async () => {
      const component = build().componentInstance;
      await component.onImageCaptured({ target: { files: [], value: '' } } as unknown as Event);
      expect(component.imageCount()).toBe(0);
    });

    it('onImageCaptured adds every file of a multi-selection in order', async () => {
      const component = build().componentInstance;
      spyOn(component as unknown as { compressImage: (f: File) => Promise<File> }, 'compressImage')
        .and.callFake((f: File) => Promise.resolve(f));
      await component.onImageCaptured({
        target: { files: [file('a.jpg'), file('b.jpg'), file('c.jpg')], value: '' },
      } as unknown as Event);
      expect(component.imageCount()).toBe(3);
      expect(component.capturedImages().map(i => i.file.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
      expect(component.error()).toBeNull();
    });

    it('onImageCaptured truncates at the photo cap and reports it', async () => {
      const component = build().componentInstance;
      spyOn(component as unknown as { compressImage: (f: File) => Promise<File> }, 'compressImage')
        .and.callFake((f: File) => Promise.resolve(f));
      withImages(component, 9);
      await component.onImageCaptured({
        target: { files: [file('a.jpg'), file('b.jpg')], value: '' },
      } as unknown as Event);
      expect(component.imageCount()).toBe(10);
      expect(component.error()).toBe('import.maxPhotosReached');
      expect(translationService.t).toHaveBeenCalledWith('import.maxPhotosReached', { count: 10 });
    });

    it('removeImage removes by id and revokes its url', () => {
      const component = build().componentInstance;
      withImages(component, 2);
      component.removeImage('i0');
      expect(component.imageCount()).toBe(1);
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('moveImageUp / moveImageDown reorder with boundaries', () => {
      const component = build().componentInstance;
      withImages(component, 3);
      component.moveImageUp(0); // no-op
      component.moveImageDown(2); // no-op
      component.moveImageUp(1);
      expect(component.capturedImages()[0].id).toBe('i1');
      component.moveImageDown(0);
      expect(component.capturedImages()[1].id).toBe('i1');
    });

    it('onImageDrop reorders via moveItemInArray', () => {
      const component = build().componentInstance;
      withImages(component, 3);
      component.onImageDrop(
        { previousIndex: 0, currentIndex: 2 } as unknown as Parameters<typeof component.onImageDrop>[0],
      );
      expect(component.capturedImages()[2].id).toBe('i0');
    });

    it('retake clears all images', () => {
      const component = build().componentInstance;
      withImages(component, 2);
      component.retake();
      expect(component.imageCount()).toBe(0);
    });
  });

  describe('processImage', () => {
    it('returns early when there are no images', async () => {
      const component = build().componentInstance;
      await component.processImage();
      expect(strategyService.processMultipleImages).not.toHaveBeenCalled();
    });

    it('queues images when offline', async () => {
      pwaService.isOnline.and.returnValue(false);
      const component = build().componentInstance;
      withImages(component, 2);
      await component.processImage();
      expect(offlineQueue.queueImage).toHaveBeenCalledTimes(2);
      expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ queued: true }));
      expect(translationService.t).toHaveBeenCalledWith('import.queuedForLater', { count: 2 });
      expect(notifications.success).toHaveBeenCalledWith('import.queuedForLater');
    });

    it('shows an error when no AI provider is available', async () => {
      strategyService.canUseCloud.and.returnValue(false);
      strategyService.canUseNative.and.returnValue(false);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(component.error()).toBe('import.errorNoProvider');
    });

    it('processes a single image through the multi-image pipeline and navigates to review', async () => {
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(strategyService.processMultipleImages).toHaveBeenCalled();
      expect(strategyService.processReceipt).not.toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/import/file'], jasmine.any(Object));
    });

    it('carries item notes and suggested category into the review payload', async () => {
      strategyService.processMultipleImages.and.resolveTo({
        transactions: [{
          description: 'Cafe', amount: 1200, currency: 'JPY', date: new Date(), type: 'expense',
          confidence: 0.9, notes: 'Latte — JPY 500\nMocha — JPY 700', suggestedCategoryId: 'food_coffee_&_drinks',
        }],
        confidence: 0.9,
      } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();

      const navState = (router.navigate.calls.mostRecent().args[1] as {
        state: { importResult: ImportResult };
      }).state;
      const transaction = navState.importResult.transactions[0];
      expect(transaction.notes).toBe('Latte — JPY 500\nMocha — JPY 700');
      expect(transaction.suggestedCategoryId).toBe('food_coffee_&_drinks');
      expect(transaction.categoryConfidence).toBe(0.9);
    });

    it('grades a category that resolved to nothing for review instead of confidently', async () => {
      strategyService.processMultipleImages.and.resolveTo({
        transactions: [{
          description: 'Cafe', amount: 1200, currency: 'JPY', date: new Date(), type: 'expense',
          // What an on-device scan reports when the model answered and the
          // catalog could not place it: Vision's character confidence, and no
          // category. The chip used to render this green.
          confidence: 0.9, receiptId: 1,
        }],
        confidence: 0.9,
      } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();

      const navState = (router.navigate.calls.mostRecent().args[1] as {
        state: { importResult: ImportResult };
      }).state;
      const transaction = navState.importResult.transactions[0];
      expect(transaction.suggestedCategoryId).toBe('other_expense');
      expect(transaction.categoryConfidence).toBe(UNRESOLVED_CATEGORY_CONFIDENCE);
      // A different question, a different number: the duplicate detector picks
      // which of two overlapping rows survives by comparing these.
      expect(transaction.imageMetadata?.confidenceScore).toBe(0.9);
    });

    it('grades a row nothing attempted to categorize at the floor', async () => {
      strategyService.processMultipleImages.and.resolveTo({
        transactions: [{
          description: 'Diner', amount: 15, currency: 'USD', date: new Date(), type: 'expense',
          confidence: 0.77, categoryAttempted: false,
        }],
        confidence: 0.77,
      } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();

      const navState = (router.navigate.calls.mostRecent().args[1] as {
        state: { importResult: ImportResult };
      }).state;
      const transaction = navState.importResult.transactions[0];
      expect(transaction.suggestedCategoryId).toBe('other_expense');
      expect(transaction.categoryConfidence).toBe(UNCATEGORIZED_CATEGORY_CONFIDENCE);
    });

    it('carries the review flag for an item-sum fallback amount', async () => {
      strategyService.processMultipleImages.and.resolveTo({
        transactions: [{
          description: 'Diner', amount: 15, currency: 'USD', date: new Date(), type: 'expense',
          confidence: 0.7, fieldConfidence: { amount: 0.5 },
        }],
        confidence: 0.7,
      } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();

      const navState = (router.navigate.calls.mostRecent().args[1] as {
        state: { importResult: ImportResult };
      }).state;
      const transaction = navState.importResult.transactions[0];
      expect(transaction.fieldConfidence).toEqual({ amount: 0.5 });
    });

    it('runs duplicate detection on strategy results and keeps receipt groups', async () => {
      strategyService.processMultipleImages.and.resolveTo({
        transactions: [
          { description: 'Store A', amount: 10, currency: 'USD', date: new Date(), type: 'expense', confidence: 0.9, receiptId: 1 },
          { description: 'Store B', amount: 20, currency: 'USD', date: new Date(), type: 'expense', confidence: 0.8, receiptId: 2 },
        ],
        confidence: 0.85,
      } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();

      expect(duplicateService.checkDuplicates).toHaveBeenCalled();
      const navState = (router.navigate.calls.mostRecent().args[1] as {
        state: { importResult: ImportResult };
      }).state;
      const metas = navState.importResult.transactions.map(t => t.imageMetadata?.receiptId);
      expect(metas).toEqual([1, 2]);
    });

    it('falls back to the import service when strategy yields nothing', async () => {
      strategyService.processMultipleImages.and.resolveTo({ transactions: [], confidence: 0 } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(importService.importFromMultipleImages).toHaveBeenCalled();
    });

    it('falls back to the import service when strategy throws', async () => {
      strategyService.processMultipleImages.and.rejectWith(new Error('boom'));
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(importService.importFromMultipleImages).toHaveBeenCalled();
    });

    it('processes multiple images', async () => {
      const component = build().componentInstance;
      withImages(component, 2);
      await component.processImage();
      expect(strategyService.processMultipleImages).toHaveBeenCalled();
    });

    it('falls back for multiple images when strategy throws', async () => {
      strategyService.processMultipleImages.and.rejectWith(new Error('boom'));
      const component = build().componentInstance;
      withImages(component, 2);
      await component.processImage();
      expect(importService.importFromMultipleImages).toHaveBeenCalled();
    });

    it('surfaces an error when no transactions are found', async () => {
      strategyService.processMultipleImages.and.resolveTo({ transactions: [], confidence: 0 } as never);
      importService.importFromMultipleImages.and.resolveTo({ ...importResult, transactions: [] });
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(component.error()).toContain('No transactions found');
    });
  });

  it('cancel revokes urls and closes the dialog', () => {
    const component = build().componentInstance;
    withImages(component, 1);
    component.cancel();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('ngOnDestroy revokes preview urls', () => {
    const fixture = build();
    withImages(fixture.componentInstance, 1);
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('registers no window connectivity listeners', () => {
    // These used to be added with .bind(this) and removed with a fresh
    // .bind(this), so every dialog left a live pair on window.
    const addEventListener = spyOn(window, 'addEventListener').and.callThrough();
    const fixture = build();
    fixture.destroy();

    const events = addEventListener.calls.allArgs().map(args => args[0]);
    expect(events).not.toContain('online');
    expect(events).not.toContain('offline');
  });
});
