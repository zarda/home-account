import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import {
  AI_CLOUD_UNAVAILABLE,
  AI_NO_PROVIDER,
  AI_QUEUE_WRITE_FAILED,
  AI_QUEUE_WRITE_PARTIAL,
  AI_QUEUED_OFFLINE,
} from '../../../core/utils/ai-error.utils';
import { ImportResult } from '../../../models';
import { ProcessingResult } from '../../../core/services/ai-strategy.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DuplicateDetectionService } from '../../../core/services/duplicate-detection.service';
import {
  channels,
  paintedBackground,
  paintedColor,
  ratio,
  withTheme,
} from '../../../core/services/testing';

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

    it('resolves each capture status name through the catalog', () => {
      const component = build().componentInstance;
      expect(component.processingStatusText()).toBe('');

      component.processingStatus.set({ name: 'analyzing' });
      expect(component.processingStatusText()).toBe('ai.scanning');

      component.processingStatus.set({ name: 'processingImages', count: 2 });
      expect(component.processingStatusText()).toBe('import.processingMultipleImages');
      expect(translationService.t).toHaveBeenCalledWith('import.processingMultipleImages', { count: 2 });

      component.processingStatus.set({ name: 'queueing' });
      expect(component.processingStatusText()).toBe('import.savingForLater');

      component.processingStatus.set(null);
      expect(component.processingStatusText()).toBe('');
    });

    it('reads connectivity from PwaService rather than a local copy', () => {
      const component = build().componentInstance;
      expect(component.isOnline()).toBeTrue();

      // PwaService's reachability probe demotes this behind the component's
      // back; nothing here should shadow it with navigator.onLine.
      pwaService.isOnline.and.returnValue(false);
      expect(component.isOnline()).toBeFalse();
      expect(component.willUseCloudAI()).toBeFalse();
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

    it('onImageCaptured leaves processingStatus untouched', async () => {
      // isProcessing only ever goes true inside processImage, so nothing
      // set here can render.
      const component = build().componentInstance;
      spyOn(component as unknown as { compressImage: (f: File) => Promise<File> }, 'compressImage').and.resolveTo(file());
      await component.onImageCaptured({ target: { files: [file()], value: '' } } as unknown as Event);
      expect(component.processingStatus()).toBeNull();
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
      expect(component.error()).toBe('import.noTransactionsInImages');
      expect(translationService.t).toHaveBeenCalledWith('import.noTransactionsInImages', { count: 1 });
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
        expect(again.error()).toBe('import.errorQueueWrite');
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
        const logSpy = spyOn(console, 'log');
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        expect(attempts.handle.succeeded).toHaveBeenCalledWith(jasmine.objectContaining({ diagnostics }));
        const navState = (router.navigate.calls.mostRecent().args[1] as { state: { importResult: ImportResult } }).state;
        expect(navState.importResult.diagnostics).toEqual(diagnostics);
        expect(logSpy).not.toHaveBeenCalledWith(jasmine.stringContaining('[Camera] Processed'));
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

    // The line under the preview comes from the same classifier the wizard
    // reads, so a failure the wizard names in the user's language is named
    // the same way here. The catalog is stubbed to echo its key.
    describe('the error line', () => {
      async function failWith(failure: Error): Promise<string | null> {
        spyOn(console, 'warn');
        strategyService.processMultipleImages.and.rejectWith(new Error('boom'));
        importService.importFromMultipleImages.and.rejectWith(failure);
        const component = build().componentInstance;
        withImages(component, 1);
        await component.processImage();
        return component.error();
      }

      // Three of the five were already translated here, so they are pins;
      // the two queue-write codes were shown as raw sentinel text.
      const sentinels: [string, string, boolean][] = [
        [AI_NO_PROVIDER, 'import.errorNoProvider', true],
        [AI_CLOUD_UNAVAILABLE, 'import.errorCloudUnavailable', true],
        [AI_QUEUED_OFFLINE, 'import.errorQueuedOffline', true],
        [AI_QUEUE_WRITE_FAILED, 'import.errorQueueWrite', false],
        [AI_QUEUE_WRITE_PARTIAL, 'import.errorQueueWritePartial', false],
      ];
      for (const [code, key, pin] of sentinels) {
        it(`says ${code} as ${key}${pin ? ' (pin)' : ''}`, async () => {
          expect(await failWith(new Error(code))).toBe(key);
        });
      }

      it('says a rejected key as import.errorInvalidKey rather than the provider\'s wording', async () => {
        expect(await failWith(new Error('401 Unauthorized'))).toBe('import.errorInvalidKey');
      });

      it('says an unreadable answer as import.errorAnswerIncomplete rather than the parser\'s wording', async () => {
        expect(await failWith(new SyntaxError("Expected ']' at position 502"))).toBe('import.errorAnswerIncomplete');
      });

      it('shows a failure the classifier has no key for as the provider wrote it (pin)', async () => {
        expect(await failWith(new Error('The upstream answered with something odd'))).toBe(
          'The upstream answered with something odd',
        );
      });

      it('falls back to the generic key when the failure carries no text (pin)', async () => {
        expect(await failWith(new Error(''))).toBe('import.errorProcessingFailed');
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

// A sibling suite, not a nested describe: the outer file overrides the
// template with a bare div (see its beforeEach above), so proving the
// overlay's [message] binding needs its own TestBed with the real template.
// Mirrors the technique import-history.component.spec.ts uses for its own
// transaction-shortcut suite.
describe('CameraCaptureComponent processing overlay', () => {
  let fixture: ComponentFixture<CameraCaptureComponent>;
  let component: CameraCaptureComponent;

  // A real (1x1, transparent) data URI rather than the other suite's fake
  // "blob:fake" string: this suite renders the real <img>, and a browser
  // that actually tries to load an invalid blob URL logs a resource error
  // the other suite, with its blanked template, never provokes.
  const onePixelGif = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  beforeEach(async () => {
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);

    const strategyService = jasmine.createSpyObj('AIStrategyService', [
      'canUseNative', 'canUseCloud', 'processReceipt', 'processMultipleImages', 'platform', 'receiptProvider',
    ]);
    // Neither provider available: the mode indicator falls to its "configure
    // AI" branch. The scan-badge cases switch one on before the first render,
    // since each computed reads its spy once and keeps the answer.
    strategyService.canUseNative.and.returnValue(false);
    strategyService.canUseCloud.and.returnValue(false);
    strategyService.receiptProvider.and.returnValue('openai');

    const pwaService = jasmine.createSpyObj('PwaService', ['isIOS', 'isStandalone', 'isOnline']);
    pwaService.isIOS.and.returnValue(false);
    pwaService.isStandalone.and.returnValue(false);
    pwaService.isOnline.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [CameraCaptureComponent],
      providers: [
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: AIImportService, useValue: jasmine.createSpyObj('AIImportService', ['importFromImage', 'importFromMultipleImages', 'convertStrategyResultToCategories']) },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: ReceiptAttemptService, useValue: attemptStub().service },
        { provide: PwaService, useValue: pwaService },
        { provide: OfflineQueueService, useValue: jasmine.createSpyObj('OfflineQueueService', ['queueImage']) },
        { provide: TranslationService, useValue: translationService },
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: DuplicateDetectionService, useValue: jasmine.createSpyObj('DuplicateDetectionService', ['checkDuplicates', 'markDuplicates']) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CameraCaptureComponent);
    component = fixture.componentInstance;
    component.capturedImages.set([
      { id: 'i0', file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), previewUrl: onePixelGif },
    ]);
  });

  function statusParagraph(): HTMLParagraphElement | null {
    return fixture.nativeElement.querySelector('.processing-overlay p');
  }

  it('renders the resolved status text while processing', () => {
    component.isProcessing.set(true);
    component.processingStatus.set({ name: 'analyzing' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.processing-overlay')).withContext('overlay present').toBeTruthy();
    expect(statusParagraph()?.textContent?.trim()).toBe('ai.scanning');
  });

  it('renders no status paragraph for a null status, rather than an empty one', () => {
    component.isProcessing.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.processing-overlay')).withContext('overlay present').toBeTruthy();
    expect(statusParagraph()).toBeNull();
  });

  it('binds the thumbnail alt to the shared receipt-image key', () => {
    fixture.detectChanges();

    const thumbnail = fixture.nativeElement.querySelector('img.thumbnail') as HTMLImageElement;
    expect(thumbnail.alt).toBe('receiptImages.imageNumber');
  });

  it("hides the process button's own spinner behind the overlay's", () => {
    component.isProcessing.set(true);
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('mat-dialog-actions button')
    ) as HTMLButtonElement[];
    const button = buttons.find((b) => b.querySelector('mat-spinner')) as HTMLButtonElement;
    expect(button.querySelector('mat-spinner')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the process button with its idle key while busy, and carries neither while idle', () => {
    // Retake, then process — the only two buttons mat-dialog-actions renders
    // once an image is captured.
    const processButton = () =>
      (Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button')) as HTMLButtonElement[])[1];

    component.isProcessing.set(true);
    fixture.detectChanges();
    expect(processButton().getAttribute('aria-busy')).toBe('true');
    expect(processButton().getAttribute('aria-label')).toBe('import.processWithAI');

    component.isProcessing.set(false);
    fixture.detectChanges();
    expect(processButton().getAttribute('aria-busy')).not.toBe('true');
    expect(processButton().hasAttribute('aria-label')).toBeFalse();
  });

  // The hint sits on the empty capture area, so these start with no image,
  // and on an iPhone, since nothing else shows it.
  function installHintOnIPhone(standalone: boolean): HTMLElement | null {
    const pwaService = TestBed.inject(PwaService) as jasmine.SpyObj<PwaService>;
    pwaService.isIOS.and.returnValue(true);
    pwaService.isStandalone.and.returnValue(standalone);
    component.capturedImages.set([]);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.ios-hint');
  }

  it('asks an iPhone browser tab to add the app to the Home Screen', () => {
    // A pin, and the partner that keeps the next case from passing on a
    // selector that matches nothing.
    expect(installHintOnIPhone(false)?.textContent).toContain('import.iosInstallHint');
  });

  it('asks nothing of an app that is already installed', () => {
    // A pin: the template already hides the hint once PwaService says the
    // app is installed. The defect was PwaService never saying so inside the
    // native app, which its own spec now covers.
    expect(installHintOnIPhone(true)).toBeNull();
  });

  // The badge says where the receipt is read: on the device, or by the cloud
  // provider it names, whichever that is. Its label is 14px text, so it
  // reads at 4.5:1, on one opaque fill of the badge's own, since
  // painted-contrast cannot composite a gradient.
  for (const mode of ['native', 'cloud'] as const) {
    it(`holds the ${mode} scan badge's label at AA on a fill of its own, in both themes`, () => {
      const strategyService = TestBed.inject(AIStrategyService) as jasmine.SpyObj<AIStrategyService>;
      strategyService.canUseNative.and.returnValue(mode === 'native');
      strategyService.canUseCloud.and.returnValue(true);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector(`.mode-indicator.${mode}`) as HTMLElement | null;
      expect(badge).withContext(`the ${mode} badge renders`).not.toBeNull();
      const label = badge!.querySelector('span') as HTMLElement;
      const glyph = badge!.querySelector('mat-icon') as HTMLElement;

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          const style = getComputedStyle(badge!);
          expect(style.backgroundImage).withContext(`${theme} no gradient`).toBe('none');
          expect(channels(style.backgroundColor).alpha).withContext(`${theme} an opaque fill`).toBe(1);
          expect(ratio(paintedColor(label), paintedBackground(label)))
            .withContext(`${theme} ${mode} label on its badge`)
            .toBeGreaterThanOrEqual(4.5);
          expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
            .withContext(`${theme} ${mode} glyph on its badge`)
            .toBeGreaterThanOrEqual(3);
        });
      }
    });
  }

  // The handle sits on the photo, and a receipt is white paper: the veil
  // under the glyph has to hold the glyph at AA over white by itself, at
  // rest, since nothing hovers on a phone.
  it("holds the drag handle's glyph at AA over a white receipt, on a veil with no rest fade, in both themes", () => {
    fixture.detectChanges();
    const item = fixture.nativeElement.querySelector('.image-item') as HTMLElement;
    const handle = item.querySelector('.drag-handle') as HTMLElement;
    const glyph = handle.querySelector('mat-icon') as HTMLElement;
    item.style.background = 'rgb(255, 255, 255)';

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        const veil = channels(getComputedStyle(handle).backgroundColor);
        expect(veil.rgb).withContext(`${theme} the veil is black`).toEqual([0, 0, 0]);
        expect(veil.alpha).withContext(`${theme} the veil's strength`).toBeGreaterThanOrEqual(0.6);
        expect(getComputedStyle(handle).opacity).withContext(`${theme} no rest fade`).toBe('1');
        expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
          .withContext(`${theme} glyph over white paper`)
          .toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
