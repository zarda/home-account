import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { AIImportService } from '../../../core/services/ai-import.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

interface CapturedImage {
  id: string;
  file: File;
  previewUrl: string;
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
    DragDropModule,
    TranslatePipe,
  ],
  templateUrl: './camera-capture.component.html',
  styleUrl: './camera-capture.component.scss',
})
export class CameraCaptureComponent {
  private dialogRef = inject(MatDialogRef<CameraCaptureComponent>);
  private importService = inject(AIImportService);
  private router = inject(Router);

  // Support for multiple captured images
  capturedImages = signal<CapturedImage[]>([]);
  isProcessing = signal(false);
  processingStatus = signal('');
  error = signal<string | null>(null);

  // Computed signals
  hasImages = computed(() => this.capturedImages().length > 0);
  imageCount = computed(() => this.capturedImages().length);
  canAddMore = computed(() => this.capturedImages().length < 10); // Max 10 images

  // Legacy single image support for backward compatibility
  capturedImage = computed(() => {
    const images = this.capturedImages();
    return images.length > 0 ? images[0].file : null;
  });

  previewUrl = computed(() => {
    const images = this.capturedImages();
    return images.length > 0 ? images[0].previewUrl : null;
  });

  onImageCaptured(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file) {
      const newImage: CapturedImage = {
        id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        previewUrl: URL.createObjectURL(file)
      };

      this.capturedImages.update(images => [...images, newImage]);
      this.error.set(null);
    }

    // Reset input so the same file can be selected again
    input.value = '';
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
      const files = images.map(img => img.file);

      if (files.length === 1) {
        // Single image - use existing method
        this.processingStatus.set('Analyzing image...');
        const result = await this.importService.importFromImage(files[0]);

        if (result.transactions.length === 0) {
          this.error.set('No transactions found in the image. Please try again with a clearer photo.');
          this.isProcessing.set(false);
          return;
        }

        this.dialogRef.close({ success: true, result });
        this.router.navigate(['/import/file'], {
          state: { importResult: result, fromCamera: true }
        });
      } else {
        // Multiple images - use multi-image method
        this.processingStatus.set(`Processing ${files.length} images...`);
        const result = await this.importService.importFromMultipleImages(files);

        if (result.transactions.length === 0) {
          this.error.set('No transactions found in the images. Please try again with clearer photos.');
          this.isProcessing.set(false);
          return;
        }

        this.dialogRef.close({ success: true, result });
        this.router.navigate(['/import/file'], {
          state: { importResult: result, fromCamera: true, multiImage: true }
        });
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

  cancel(): void {
    // Clean up all preview URLs
    this.capturedImages().forEach(img => {
      URL.revokeObjectURL(img.previewUrl);
    });
    this.dialogRef.close();
  }
}
