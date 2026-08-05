import { nextImportRowId } from '../../../core/utils/import-row-id.utils';
import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import {
  AIImportService,
  AI_NO_PROVIDER,
  AI_QUEUED_OFFLINE,
} from '../../../core/services/ai-import.service';
import {
  AIStrategyService,
  AI_CLOUD_UNAVAILABLE,
} from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DuplicateDetectionService } from '../../../core/services/duplicate-detection.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { compressImage as compressImageUtil } from '../../../shared/utils/image-compression';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { NotificationService } from '../../../core/services/notification.service';
import { AnalyticsService } from '../../../core/services/analytics.service';

interface CapturedImage {
  id: string;
  file: File;
  previewUrl: string;
  compressedFile?: File;
}

@Component({
  selector: 'app-camera-capture',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    DialogHeaderComponent,
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DragDropModule,
    TranslatePipe,
  ],
  templateUrl: './camera-capture.component.html',
  styleUrl: './camera-capture.component.scss',
})
export class CameraCaptureComponent implements OnInit, OnDestroy {
  private notifications = inject(NotificationService);
  private dialogRef = inject(MatDialogRef<CameraCaptureComponent>);
  private importService = inject(AIImportService);
  private strategyService = inject(AIStrategyService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private translationService = inject(TranslationService);
  private duplicateService = inject(DuplicateDetectionService);
  private router = inject(Router);
  private analytics = inject(AnalyticsService);

  /**
   * One receipt_import per attempt, whichever branch resolves it.
   *
   * processImage has five terminal paths — queued offline, no AI configured,
   * nothing extracted, extracted, and the outer catch — and two of them are
   * reached through nested helpers. A flag is cheaper to follow than threading
   * an outcome back up through all of them, and it makes double counting
   * structurally impossible rather than a thing to be careful about.
   */
  private importReported = false;

  private reportImport(outcome: 'ok' | 'failed' | 'queued_offline'): void {
    if (this.importReported) return;
    this.importReported = true;
    this.analytics.trackReceiptImport({ outcome });
  }

  // Support for multiple captured images
  capturedImages = signal<CapturedImage[]>([]);
  isProcessing = signal(false);
  processingStatus = signal('');
  error = signal<string | null>(null);

  // Platform state
  isIOS = signal(false);
  isStandalone = signal(false);

  /**
   * Connectivity comes straight from PwaService.
   *
   * The local copy this replaced was fed by window listeners the component
   * could not remove — `.bind(this)` returns a new function every call, so
   * removeEventListener never matched what had been registered and every
   * opened dialog left a live pair behind. It also read `navigator.onLine`,
   * which reports a network interface rather than a usable connection, so on a
   * captive portal this screen went on believing it was online while
   * PwaService's reachability probe knew better.
   */
  isOnline = this.pwaService.isOnline;

  // Computed signals
  hasImages = computed(() => this.capturedImages().length > 0);
  imageCount = computed(() => this.capturedImages().length);
  canAddMore = computed(() => this.capturedImages().length < this.MAX_IMAGES);

  // AI processing mode indicator
  processingMode = computed(() => {
    if (!this.isOnline()) return 'offline';
    if (this.strategyService.canUseNative()) return 'native';
    if (this.strategyService.canUseCloud()) return 'cloud';
    return 'unavailable';
  });

  // Show if a cloud provider is available and will be used
  willUseCloudAI = computed(() => {
    if (!this.isOnline()) return false;
    return this.strategyService.canUseCloud();
  });

  /**
   * The provider the chip names, as it brands itself.
   *
   * The chip used to say "Gemini Vision" whenever any provider was configured,
   * so a user running only OpenAI or Claude was told the wrong thing about
   * where their receipt was going. Brand names are not translated.
   */
  cloudProviderLabel = computed(() => {
    const labels: Record<string, string> = {
      gemini: 'Gemini',
      openai: 'OpenAI',
      claude: 'Claude',
    };
    return labels[this.strategyService.receiptProvider() ?? ''] ?? '';
  });

  // Show if native OCR is available (iOS)
  willUseNativeAI = computed(() => this.strategyService.canUseNative());

  // Legacy single image support for backward compatibility
  capturedImage = computed(() => {
    const images = this.capturedImages();
    return images.length > 0 ? images[0].file : null;
  });

  previewUrl = computed(() => {
    const images = this.capturedImages();
    return images.length > 0 ? images[0].previewUrl : null;
  });

  // Image compression settings for iOS
  readonly MAX_IMAGES = 10;
  private readonly MAX_IMAGE_SIZE = 1920; // Max dimension
  private readonly JPEG_QUALITY = 0.85;   // Compression quality

  ngOnInit(): void {
    // Detect iOS and standalone mode
    this.isIOS.set(this.pwaService.isIOS());
    this.isStandalone.set(this.pwaService.isStandalone());
  }

  ngOnDestroy(): void {
    // Clean up preview URLs
    this.capturedImages().forEach(img => {
      URL.revokeObjectURL(img.previewUrl);
    });
  }

  async onImageCaptured(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    // The library input allows multi-select; the camera input yields one shot
    const files = Array.from(input.files ?? []);

    if (files.length > 0) {
      const room = Math.max(0, this.MAX_IMAGES - this.capturedImages().length);
      const accepted = files.slice(0, room);
      this.error.set(
        accepted.length < files.length
          ? this.translationService.t('import.maxPhotosReached', { count: this.MAX_IMAGES })
          : null
      );

      if (accepted.length > 0) {
        this.processingStatus.set('Optimizing image...');
        for (const file of accepted) {
          await this.addCapturedImage(file);
        }
        this.processingStatus.set('');
      }
    }

    // Reset input so the same file can be selected again
    input.value = '';
  }

  private async addCapturedImage(file: File): Promise<void> {
    const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    try {
      // Compress image for better performance, especially on iOS
      const compressedFile = await this.compressImage(file);
      this.capturedImages.update(images => [...images, {
        id,
        file: compressedFile,
        previewUrl: URL.createObjectURL(compressedFile),
        compressedFile,
      }]);
    } catch (err) {
      console.error('Image compression error:', err);
      // Fall back to original file
      this.capturedImages.update(images => [...images, {
        id,
        file,
        previewUrl: URL.createObjectURL(file),
      }]);
    }
  }

  /**
   * Compress image for optimal processing performance.
   * This is especially important on iOS where camera images can be very large.
   */
  private compressImage(file: File): Promise<File> {
    return compressImageUtil(file, {
      maxDimension: this.MAX_IMAGE_SIZE,
      quality: this.JPEG_QUALITY,
    });
  }

  removeImage(imageId: string): void {
    this.capturedImages.update(images => {
      const imageToRemove = images.find(img => img.id === imageId);
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.previewUrl);
      }
      return images.filter(img => img.id !== imageId);
    });
  }

  moveImageUp(index: number): void {
    if (index <= 0) return;
    this.capturedImages.update(images => {
      const newImages = [...images];
      [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
      return newImages;
    });
  }

  moveImageDown(index: number): void {
    const images = this.capturedImages();
    if (index >= images.length - 1) return;
    this.capturedImages.update(imgs => {
      const newImages = [...imgs];
      [newImages[index], newImages[index + 1]] = [newImages[index + 1], newImages[index]];
      return newImages;
    });
  }

  onImageDrop(event: CdkDragDrop<CapturedImage[]>): void {
    this.capturedImages.update(images => {
      const newImages = [...images];
      moveItemInArray(newImages, event.previousIndex, event.currentIndex);
      return newImages;
    });
  }

  retake(): void {
    // Clear all images
    this.capturedImages().forEach(img => {
      URL.revokeObjectURL(img.previewUrl);
    });
    this.capturedImages.set([]);
    this.error.set(null);
  }

  async processImage(): Promise<void> {
    const images = this.capturedImages();
    if (images.length === 0) return;

    this.isProcessing.set(true);
    this.error.set(null);
    this.importReported = false;

    try {
      const files = images.map(img => img.compressedFile || img.file);
      const isOffline = !this.pwaService.isOnline();

      // Queue for later if offline
      if (isOffline) {
        await this.queueForLaterProcessing(files);
        return;
      }

      // Check if AI is available
      if (!this.strategyService.canUseCloud() && !this.strategyService.canUseNative()) {
        this.error.set(this.translationService.t('import.errorNoProvider'));
        this.reportImport('failed');
        return;
      }

      // One receiptId-aware pipeline for any photo count: several photos may
      // form one receipt, and a single photo may hold several receipts —
      // the dedicated single-image path had no receipt grouping.
      const modeLabel = this.getProcessingModeLabel();
      const multiImage = files.length > 1;
      this.processingStatus.set(
        multiImage
          ? `Processing ${files.length} images (${modeLabel})...`
          : `Analyzing image (${modeLabel})...`
      );

      try {
        const strategyResult = await this.strategyService.processMultipleImages(files);

        if (strategyResult.transactions.length === 0) {
          // Fall back to import service
          const result = await this.importService.importFromMultipleImages(files);
          this.handleImportResult(result, multiImage);
          return;
        }

        const importResult = await this.convertStrategyResult(strategyResult, files);
        this.handleImportResult(importResult, multiImage);
      } catch (strategyErr) {
        console.warn('[Camera] Strategy processing failed, falling back:', strategyErr);
        // Fall back to original import service
        const result = await this.importService.importFromMultipleImages(files);
        this.handleImportResult(result, multiImage);
      }
    } catch (err) {
      this.error.set(this.describeError(err));
      this.reportImport('failed');
    } finally {
      this.isProcessing.set(false);
      this.processingStatus.set('');
    }
  }

  /**
   * Queue images for later processing when offline.
   */
  /**
   * Turn a failure into something worth reading.
   *
   * The import path raises codes rather than sentences so they can be said in
   * the user's language; anything else is a provider's own wording, which
   * cannot be translated and is shown as-is.
   */
  private describeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : '';
    const keys: Record<string, string> = {
      [AI_NO_PROVIDER]: 'import.errorNoProvider',
      [AI_QUEUED_OFFLINE]: 'import.errorQueuedOffline',
      [AI_CLOUD_UNAVAILABLE]: 'import.errorCloudUnavailable',
    };
    if (keys[raw]) {
      return this.translationService.t(keys[raw]);
    }
    return raw || this.translationService.t('import.errorProcessingFailed');
  }

  private async queueForLaterProcessing(files: File[]): Promise<void> {
    this.processingStatus.set('Saving for later processing...');

    try {
      for (const file of files) {
        await this.offlineQueue.queueImage(file);
      }

      const message = this.translationService.t('import.queuedForLater', { count: files.length });
      this.notifications.success(message);

      // Not a failure and not yet a success: the images are safely stored and
      // the real outcome lands later, from the queue processor.
      this.reportImport('queued_offline');
      this.dialogRef.close({ success: true, queued: true, count: files.length });
    } catch {
      this.error.set('Failed to save images for later. Please try again.');
      this.reportImport('failed');
    } finally {
      this.isProcessing.set(false);
      this.processingStatus.set('');
    }
  }

  /**
   * Get human-readable processing mode label.
   */
  private getProcessingModeLabel(): string {
    const mode = this.processingMode();
    switch (mode) {
      case 'offline':
        return 'offline mode';
      case 'native':
        return 'native OCR';
      case 'cloud':
        return 'cloud AI';
      case 'unavailable':
        return 'AI unavailable';
      default:
        return 'AI';
    }
  }

  /**
   * Convert strategy service result to import result format.
   */
  private async convertStrategyResult(
    strategyResult: import('../../../core/services/ai-strategy.service').ProcessingResult,
    files: File[]
  ): Promise<import('../../../models').ImportResult> {
    const transactions = strategyResult.transactions.map(tx => ({
      id: nextImportRowId('strategy'),
      description: tx.description,
      amount: tx.amount,
      currency: tx.currency,
      date: tx.date,
      type: tx.type,
      suggestedCategoryId: tx.suggestedCategoryId || 'other_expense',
      categoryConfidence: tx.confidence,
      notes: tx.notes,
      fieldConfidence: tx.fieldConfidence,
      isDuplicate: false,
      selected: true,
      // The cloud strategy path carries the receipt grouping; native results
      // have none, and the review table renders nothing without it.
      imageMetadata: tx.receiptId != null ? {
        imageIndex: 0,
        imageId: 'image_0',
        positionInImage: 'middle' as const,
        confidenceScore: tx.confidence,
        receiptId: tx.receiptId,
      } : undefined,
    }));

    // The strategy path bypasses AIImportService, so run the same duplicate
    // check the wizard-upload path applies before review.
    const duplicates = await this.duplicateService.checkDuplicates(transactions);
    const marked = this.duplicateService.markDuplicates(transactions, duplicates);

    return {
      source: 'image',
      fileType: 'receipt_image',
      fileName: files.length === 1 ? files[0].name : `${files.length} images`,
      fileSize: files.reduce((sum, f) => sum + f.size, 0),
      transactions: marked,
      confidence: strategyResult.confidence,
      warnings: [],
      duplicates,
    };
  }

  /**
   * Handle import result - navigate to review page or show error.
   */
  private handleImportResult(
    result: import('../../../models').ImportResult,
    isMultiImage: boolean
  ): void {
    if (result.transactions.length === 0) {
      const message = isMultiImage
        ? 'No transactions found in the images. Please try again with clearer photos.'
        : 'No transactions found in the image. Please try again with a clearer photo.';
      this.error.set(message);
      this.isProcessing.set(false);
      // Nothing extracted is a failed import from the user's point of view,
      // whatever the pipeline thinks: they photographed a receipt and got no
      // transaction out of it.
      this.reportImport('failed');
      return;
    }

    // Log processing completion
    const platform = this.strategyService.platform();
    console.log(`[Camera] Processed on ${platform}`);

    this.reportImport('ok');
    this.dialogRef.close({ success: true, result });
    this.router.navigate(['/import/file'], {
      state: { 
        importResult: result, 
        fromCamera: true, 
        multiImage: isMultiImage,
      }
    });
  }

  cancel(): void {
    // Clean up all preview URLs
    this.capturedImages().forEach(img => {
      URL.revokeObjectURL(img.previewUrl);
    });
    this.dialogRef.close();
  }
}
