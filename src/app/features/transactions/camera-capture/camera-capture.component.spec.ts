import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CameraCaptureComponent } from './camera-capture.component';
import { AIImportService } from '../../../core/services/ai-import.service';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { ReceiptAttempt, ReceiptAttemptService } from '../../../core/services/receipt-attempt.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ImportResult } from '../../../models';
import { ProcessingResult } from '../../../core/services/ai-strategy.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DuplicateDetectionService } from '../../../core/services/duplicate-detection.service';

function attemptStub() {
  const handle = jasmine.createSpyObj<ReceiptAttempt>('ReceiptAttempt', ['succeeded', 'failed', 'queued']);
  const service = jasmine.createSpyObj<ReceiptAttemptService>('ReceiptAttemptService', ['begin']);
  service.begin.and.returnValue(handle);
  return { service, handle };
}

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
  let attempts: ReturnType<typeof attemptStub>;

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

    importService = jasmine.createSpyObj('AIImportService', ['importFromImage', 'importFromMultipleImages', 'convertStrategyResultToCategories']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    importService.importFromImage.and.resolveTo(importResult);
    importService.importFromMultipleImages.and.resolveTo(importResult);
    importService.convertStrategyResultToCategories.and.callFake((result: ProcessingResult) =>
      result.transactions.map((tx, i) => ({
        id: `row-${i}`, description: tx.description, amount: tx.amount, currency: tx.currency,
        date: tx.date, type: tx.type, suggestedCategoryId: tx.suggestedCategoryId ?? 'other_expense',
        categoryConfidence: tx.confidence, isDuplicate: false, selected: true,
        ...(tx.currencyFellBack ? { currencyFellBack: true } : {}),
        ...(tx.receiptCountry ? { receiptCountry: tx.receiptCountry } : {}),
      })));
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
    attempts = attemptStub();

    await TestBed.configureTestingModule({
      imports: [CameraCaptureComponent],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AIImportService, useValue: importService },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: ReceiptAttemptService, useValue: attempts.service },
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

    it('hands the strategy result to the shared converter and carries its rows, marks included, to review', async () => {
      const strategyResult = {
        transactions: [{
          description: 'Cafe', amount: 1200, currency: 'TWD', currencyFellBack: true, receiptCountry: 'JP',
          date: new Date(), type: 'expense', confidence: 0.9, source: 'cloud',
        }],
        source: 'cloud', confidence: 0.9, processingTimeMs: 1,
      } as ProcessingResult;
      strategyService.processMultipleImages.and.resolveTo(strategyResult);
      const component = build().componentInstance;
      withImages(component, 2);
      await component.processImage();

      expect(importService.convertStrategyResultToCategories).toHaveBeenCalledWith(strategyResult);
      const navState = (router.navigate.calls.mostRecent().args[1] as {
        state: { importResult: ImportResult };
      }).state;
      const [row] = navState.importResult.transactions;
      // The dialog's own converter used to drop both of these on the floor.
      expect(row.currencyFellBack).toBeTrue();
      expect(row.receiptCountry).toBe('JP');
      // The files ride along, or there is nothing to attach when the wizard confirms.
      expect(navState.importResult.sourceFiles?.length).toBe(2);
      expect(navState.importResult.fileType).toBe('receipt_image');
    });

    it('still runs duplicate detection over the converted rows', async () => {
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(duplicateService.checkDuplicates).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ description: 'X' })])
      );
      expect(duplicateService.markDuplicates).toHaveBeenCalled();
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

    describe('the attempt record', () => {
      // Five terminal branches, one handle. The dialog used to keep its own
      // de-dup flag and report an outcome with no why; the handle owns both.
      it('opens one handle per run over the files it will process', async () => {
        const component = build().componentInstance;
        withImages(component, 2);
        await component.processImage();
        expect(attempts.service.begin).toHaveBeenCalledTimes(1);
        const [door, kind, files] = attempts.service.begin.calls.mostRecent().args;
        expect(door).toBe('camera');
        expect(kind).toBe('receipt_image');
        expect(files.map(f => f.name)).toEqual(['f0.jpg', 'f1.jpg']);
      });

      it('reports queued when offline, and queue_write when the queue refuses', async () => {
        pwaService.isOnline.and.returnValue(false);
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        expect(attempts.handle.queued).toHaveBeenCalled();

        offlineQueue.queueImage.and.rejectWith(new Error('quota'));
        const again = build().componentInstance;
        withImages(again, 1);
        await again.processImage();
        expect(attempts.handle.failed).toHaveBeenCalledWith('queue_write');
      });

      it('reports no_provider when no engine is configured', async () => {
        strategyService.canUseCloud.and.returnValue(false);
        strategyService.canUseNative.and.returnValue(false);
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        expect(attempts.handle.failed).toHaveBeenCalledWith('no_provider');
      });

      it('reports nothing_extracted when both pipelines read nothing', async () => {
        strategyService.processMultipleImages.and.resolveTo({ transactions: [], confidence: 0 } as never);
        importService.importFromMultipleImages.and.resolveTo({ ...importResult, transactions: [] });
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        expect(attempts.handle.failed).toHaveBeenCalledWith('nothing_extracted');
      });

      it('reports success with the diagnostics the strategy produced', async () => {
        const diagnostics = { engine: 'native' as const, provider: null, durationMs: 900 };
        strategyService.processMultipleImages.and.resolveTo({
          transactions: [{ description: 'X', amount: 1, currency: 'USD', date: new Date(), type: 'expense', confidence: 1 }],
          confidence: 1, diagnostics,
        } as never);
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        expect(attempts.handle.succeeded).toHaveBeenCalledWith(jasmine.objectContaining({ diagnostics }));
        const navState = (router.navigate.calls.mostRecent().args[1] as { state: { importResult: ImportResult } }).state;
        expect(navState.importResult.diagnostics).toEqual(diagnostics);
      });

      it('reports the error when both the strategy and the fallback throw', async () => {
        const failure = new Error('503 service unavailable');
        strategyService.processMultipleImages.and.rejectWith(new Error('boom'));
        importService.importFromMultipleImages.and.rejectWith(failure);
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        expect(attempts.handle.failed).toHaveBeenCalledWith(failure);
        expect(component.error()).toBe('503 service unavailable');
      });
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
