import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { AIImportService } from '../../../core/services/ai-import.service';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

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
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    DragDropModule,
    TranslatePipe,
  ],
  templateUrl: './camera-capture.component.html',
  styleUrl: './camera-capture.component.scss',
})
export class CameraCaptureComponent implements OnInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<CameraCaptureComponent>);
  private importService = inject(AIImportService);
  private strategyService = inject(AIStrategyService);
  private pwaService = inject(PwaService);
  private offlineQueue = inject(OfflineQueueService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  // Support for multiple captured images
  capturedImages = signal<CapturedImage[]>([]);
  isProcessing = signal(false);
  processingStatus = signal('');
  error = signal<string | null>(null);

  // iOS-specific state
  isIOS = signal(false);
  isStandalone = signal(false);
  isOnline = signal(true);
  useLocalAI = signal(false);

  // Computed signals
  hasImages = computed(() => this.capturedImages().length > 0);
  imageCount = computed(() => this.capturedImages().length);
  canAddMore = computed(() => this.capturedImages().length < 10); // Max 10 images

  // AI processing mode indicator
  processingMode = computed(() => {
    if (!this.isOnline()) return 'offline';
    const prefs = this.strategyService.preferences();
    if (prefs.privacyMode) return 'privacy';
    return prefs.strategy;
  });

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
  private readonly MAX_IMAGE_SIZE = 1920; // Max dimension
  private readonly JPEG_QUALITY = 0.85;   // Compression quality

  ngOnInit(): void {
    // Detect iOS and standalone mode
    this.isIOS.set(this.pwaService.isIOS());
    this.isStandalone.set(this.pwaService.isStandalone());
    this.isOnline.set(this.pwaService.isOnline());

    // Subscribe to online/offline changes
    window.addEventListener('online', this.handleOnlineChange.bind(this));
    window.addEventListener('offline', this.handleOnlineChange.bind(this));
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnlineChange.bind(this));
    window.removeEventListener('offline', this.handleOnlineChange.bind(this));
    
    // Clean up preview URLs
    this.capturedImages().forEach(img => {
      URL.revokeObjectURL(img.previewUrl);
    });
  }

  private handleOnlineChange(): void {
    this.isOnline.set(navigator.onLine);
  }

  async onImageCaptured(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file) {
      this.processingStatus.set('Optimizing image...');
      
      try {
        // Compress image for better performance, especially on iOS
        const compressedFile = await this.compressImage(file);
        
        const newImage: CapturedImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          file: compressedFile,
          previewUrl: URL.createObjectURL(compressedFile),
          compressedFile,
        };

        this.capturedImages.update(images => [...images, newImage]);
        this.error.set(null);
        this.processingStatus.set('');
      } catch (err) {
        console.error('Image compression error:', err);
        // Fall back to original file
        const newImage: CapturedImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        };
        this.capturedImages.update(images => [...images, newImage]);
        this.error.set(null);
        this.processingStatus.set('');
      }
    }

    // Reset input so the same file can be selected again
    input.value = '';
  }

  /**
   * Compress image for optimal processing performance.
   * This is especially important on iOS where camera images can be very large.
   */
  private compressImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = () => {
        const img = new Image();
        
        img.onload = () => {
          try {
            // Calculate new dimensions
            let { width, height } = img;
            
            if (width > this.MAX_IMAGE_SIZE || height > this.MAX_IMAGE_SIZE) {
              if (width > height) {
                height = (height / width) * this.MAX_IMAGE_SIZE;
                width = this.MAX_IMAGE_SIZE;
              } else {
                width = (width / height) * this.MAX_IMAGE_SIZE;
                height = this.MAX_IMAGE_SIZE;
              }
            }

            // Create canvas and draw resized image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(file); // Fall back to original
              return;
            }

            // Use better image smoothing for iOS
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to blob
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  const compressedFile = new File([blob], file.name, {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                  });
                  
                  console.log(`[Camera] Compressed: ${file.size} -> ${compressedFile.size} bytes`);
                  resolve(compressedFile);
                } else {
                  resolve(file);
                }
              },
              'image/jpeg',
              this.JPEG_QUALITY
            );
          } catch (err) {
            reject(err);
          }
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = reader.result as string;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
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

    try {
      const files = images.map(img => img.compressedFile || img.file);
      const isOffline = !this.pwaService.isOnline();
      const prefs = this.strategyService.preferences();

      // Check if we should queue for later (offline and no local AI available)
      if (isOffline && !this.strategyService.canUseLocal()) {
        await this.queueForLaterProcessing(files);
        return;
      }

      // Show processing mode
      const modeLabel = this.getProcessingModeLabel();
      
      if (files.length === 1) {
        // Single image processing
        this.processingStatus.set(`Analyzing image (${modeLabel})...`);
        
        // Try using strategy service for hybrid processing
        if (prefs.mode !== 'cloud_only' || isOffline) {
          try {
            const strategyResult = await this.strategyService.processReceipt(files[0]);
            
            if (strategyResult.transactions.length === 0) {
              // Fall back to import service
              const result = await this.importService.importFromImage(files[0]);
              this.handleImportResult(result, false);
              return;
            }

            // Convert strategy result to import result format
            const importResult = this.convertStrategyResult(strategyResult, files);
            this.handleImportResult(importResult, false);
            return;
          } catch (strategyErr) {
            console.warn('[Camera] Strategy processing failed, falling back:', strategyErr);
          }
        }

        // Fall back to original import service
        const result = await this.importService.importFromImage(files[0]);
        this.handleImportResult(result, false);
      } else {
        // Multiple images processing
        this.processingStatus.set(`Processing ${files.length} images (${modeLabel})...`);

        // Try using strategy service for hybrid processing
        if (prefs.mode !== 'cloud_only' || isOffline) {
          try {
            const strategyResult = await this.strategyService.processMultipleImages(files);
            
            if (strategyResult.transactions.length === 0) {
              // Fall back to import service
              const result = await this.importService.importFromMultipleImages(files);
              this.handleImportResult(result, true);
              return;
            }

            const importResult = this.convertStrategyResult(strategyResult, files);
            this.handleImportResult(importResult, true);
            return;
          } catch (strategyErr) {
            console.warn('[Camera] Strategy processing failed, falling back:', strategyErr);
          }
        }

        // Fall back to original import service
        const result = await this.importService.importFromMultipleImages(files);
        this.handleImportResult(result, true);
      }
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to process image(s). Please try again.'
      );
    } finally {
      this.isProcessing.set(false);
      this.processingStatus.set('');
    }
  }

  /**
   * Queue images for later processing when offline.
   */
  private async queueForLaterProcessing(files: File[]): Promise<void> {
    this.processingStatus.set('Saving for later processing...');

    try {
      for (const file of files) {
        await this.offlineQueue.queueImage(file);
      }

      this.snackBar.open(
        `${files.length} image(s) queued for processing when online`,
        'OK',
        { duration: 4000 }
      );

      this.dialogRef.close({ success: true, queued: true, count: files.length });
    } catch {
      this.error.set('Failed to save images for later. Please try again.');
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
      case 'privacy':
        return 'privacy mode';
      case 'speed':
        return 'local AI';
      case 'accuracy':
        return 'cloud AI';
      default:
        return 'AI';
    }
  }

  /**
   * Convert strategy service result to import result format.
   */
  private convertStrategyResult(
    strategyResult: import('../../../core/services/ai-strategy.service').ProcessingResult,
    files: File[]
  ): import('../../../models').ImportResult {
    return {
      source: 'image',
      fileType: 'receipt_image',
      fileName: files.length === 1 ? files[0].name : `${files.length} images`,
      fileSize: files.reduce((sum, f) => sum + f.size, 0),
      transactions: strategyResult.transactions.map((tx, index) => ({
        id: `strategy_${index}_${Date.now()}`,
        description: tx.description,
        amount: tx.amount,
        currency: tx.currency,
        date: tx.date,
        type: tx.type,
        suggestedCategoryId: 'other_expense',
        categoryConfidence: tx.confidence,
        isDuplicate: false,
        selected: true,
      })),
      confidence: strategyResult.confidence,
      warnings: strategyResult.usedFallback 
        ? [{ type: 'info' as const, message: 'Used cloud AI for better accuracy' }]
        : [],
      duplicates: [],
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
      return;
    }

    // Show processing source if available
    const source = this.strategyService.currentSource();
    if (source) {
      const sourceLabel = source === 'local' ? 'local AI' : 'cloud AI';
      console.log(`[Camera] Processed with ${sourceLabel}`);
    }

    this.dialogRef.close({ success: true, result });
    this.router.navigate(['/import/file'], {
      state: { 
        importResult: result, 
        fromCamera: true, 
        multiImage: isMultiImage,
        processedLocally: source === 'local',
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
