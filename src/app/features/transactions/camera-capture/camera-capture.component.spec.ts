import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CameraCaptureComponent } from './camera-capture.component';
import { AIImportService } from '../../../core/services/ai-import.service';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { ImportResult } from '../../../models';

describe('CameraCaptureComponent', () => {
  let importService: jasmine.SpyObj<AIImportService>;
  let strategyService: jasmine.SpyObj<AIStrategyService>;
  let pwaService: jasmine.SpyObj<PwaService>;
  let offlineQueue: jasmine.SpyObj<OfflineQueueService>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CameraCaptureComponent>>;
  let router: jasmine.SpyObj<Router>;

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
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    router = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [CameraCaptureComponent],
      providers: [
        { provide: AIImportService, useValue: importService },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: PwaService, useValue: pwaService },
        { provide: OfflineQueueService, useValue: offlineQueue },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: router },
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

      // isOnline is a signal, so going offline re-evaluates on the same instance.
      const component = build().componentInstance;
      component.isOnline.set(false);
      expect(component.processingMode()).toBe('offline');
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
      expect(strategyService.processReceipt).not.toHaveBeenCalled();
    });

    it('queues images when offline', async () => {
      pwaService.isOnline.and.returnValue(false);
      const component = build().componentInstance;
      withImages(component, 2);
      await component.processImage();
      expect(offlineQueue.queueImage).toHaveBeenCalledTimes(2);
      expect(dialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ queued: true }));
    });

    it('shows an error when no AI provider is available', async () => {
      strategyService.canUseCloud.and.returnValue(false);
      strategyService.canUseNative.and.returnValue(false);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(component.error()).toContain('AI service is not available');
    });

    it('processes a single image and navigates to review', async () => {
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(strategyService.processReceipt).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/import/file'], jasmine.any(Object));
    });

    it('falls back to the import service when strategy yields nothing', async () => {
      strategyService.processReceipt.and.resolveTo({ transactions: [], confidence: 0 } as never);
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(importService.importFromImage).toHaveBeenCalled();
    });

    it('falls back to the import service when strategy throws', async () => {
      strategyService.processReceipt.and.rejectWith(new Error('boom'));
      const component = build().componentInstance;
      withImages(component, 1);
      await component.processImage();
      expect(importService.importFromImage).toHaveBeenCalled();
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
      strategyService.processReceipt.and.resolveTo({ transactions: [], confidence: 0 } as never);
      importService.importFromImage.and.resolveTo({ ...importResult, transactions: [] });
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
});
