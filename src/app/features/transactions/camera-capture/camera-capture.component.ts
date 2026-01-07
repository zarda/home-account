import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AIImportService } from '../../../core/services/ai-import.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-camera-capture',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './camera-capture.component.html',
  styleUrl: './camera-capture.component.scss',
})
export class CameraCaptureComponent {
  private dialogRef = inject(MatDialogRef<CameraCaptureComponent>);
  private importService = inject(AIImportService);
  private router = inject(Router);

  capturedImage = signal<File | null>(null);
  previewUrl = signal<string | null>(null);
  isProcessing = signal(false);
  processingStatus = signal('');
  error = signal<string | null>(null);

  onImageCaptured(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file) {
      // Revoke previous URL if exists
      const oldUrl = this.previewUrl();
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }

      this.capturedImage.set(file);
      this.previewUrl.set(URL.createObjectURL(file));
      this.error.set(null);
    }
  }

  retake(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.capturedImage.set(null);
    this.previewUrl.set(null);
    this.error.set(null);
  }

  async processImage(): Promise<void> {
    const file = this.capturedImage();
    if (!file) return;

    this.isProcessing.set(true);
    this.error.set(null);

    try {
      this.processingStatus.set('Analyzing image...');
      const result = await this.importService.importFromImage(file);

      if (result.transactions.length === 0) {
        this.error.set('No transactions found in the image. Please try again with a clearer photo.');
        this.isProcessing.set(false);
        return;
      }

      // Close dialog and navigate to import wizard with results
      this.dialogRef.close({ success: true, result });
      this.router.navigate(['/import/file'], {
        state: { importResult: result, fromCamera: true }
      });
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to process image. Please try again.'
      );
    } finally {
      this.isProcessing.set(false);
      this.processingStatus.set('');
    }
  }

  cancel(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.dialogRef.close();
  }
}
