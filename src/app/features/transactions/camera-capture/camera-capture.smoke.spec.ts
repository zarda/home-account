// Offline-capture smoke test: proves that photos captured while offline are
// persisted through the real OfflineQueueService into real IndexedDB, and
// that the dialog reports the queued batch. The unit spec mocks the queue;
// this spec exercises the storage layer end to end.
//
// The assertion targets IndexedDB rather than Firestore on purpose: queued
// images only reach Firestore later, when the offline-queue processor runs
// them through an AI provider, and no provider exists under the test
// harness. The queue→Firestore leg is covered separately by
// offline-queue-processor.service.smoke.spec.ts.
//
// Runs under `npm run smoke` alongside the emulator suites.
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
import { NotificationService } from '../../../core/services/notification.service';

describe('CameraCaptureComponent offline queue (smoke test)', () => {
  let queue: OfflineQueueService;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CameraCaptureComponent>>;

  beforeEach(async () => {
    const pwaService = jasmine.createSpyObj('PwaService', [
      'isIOS', 'isStandalone', 'isOnline', 'registerBackgroundSync',
    ]);
    pwaService.isIOS.and.returnValue(false);
    pwaService.isStandalone.and.returnValue(false);
    pwaService.isOnline.and.returnValue(false);

    // AI must stay inert: only the queue path may run.
    const importService = jasmine.createSpyObj('AIImportService', ['importFromImage', 'importFromMultipleImages']);
    const strategyService = jasmine.createSpyObj('AIStrategyService', [
      'canUseNative', 'canUseCloud', 'processReceipt', 'processMultipleImages', 'platform',
    ]);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [CameraCaptureComponent],
      providers: [
        OfflineQueueService,
        { provide: PwaService, useValue: pwaService },
        { provide: AIImportService, useValue: importService },
        { provide: AIStrategyService, useValue: strategyService },
        { provide: TranslationService, useValue: translationService },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    })
      .overrideComponent(CameraCaptureComponent, { set: { imports: [], template: '' } })
      .compileComponents();

    queue = TestBed.inject(OfflineQueueService);
    // The service opens IndexedDB asynchronously after construction and
    // queueImage throws until it's ready — wait for the handle.
    const deadline = Date.now() + 10000;
    while (!(queue as unknown as { db?: unknown }).db) {
      if (Date.now() > deadline) throw new Error('offline queue DB never initialized');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await queue.clearAll();
  });

  afterEach(async () => {
    await queue.clearAll();
  });

  it('persists an offline multi-photo capture into the real IndexedDB queue', async () => {
    const fixture = TestBed.createComponent(CameraCaptureComponent);
    const component = fixture.componentInstance;
    component.ngOnInit();

    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map(
      name => new File([`payload-${name}`], name, { type: 'image/jpeg' })
    );
    component.capturedImages.set(
      files.map((file, i) => ({ id: `img${i}`, file, previewUrl: `blob:${i}` }))
    );

    await component.processImage();

    const pending = await queue.getPendingImages();
    expect(pending.length).toBe(3);
    expect(pending.map(img => img.fileName).sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(pending.every(img => img.size > 0)).toBeTrue();

    expect(dialogRef.close).toHaveBeenCalledWith({ success: true, queued: true, count: 3 });
  }, 20000);
});
