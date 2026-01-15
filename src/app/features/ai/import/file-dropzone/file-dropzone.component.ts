import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-file-dropzone',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    DragDropModule,
    TranslatePipe
  ],
  templateUrl: './file-dropzone.component.html',
  styleUrl: './file-dropzone.component.scss'
})
export class FileDropzoneComponent {
  @Input() acceptedTypes = '.csv,.pdf,.png,.jpg,.jpeg,.webp';
  @Input() maxFileSize = 10 * 1024 * 1024; // 10MB
  @Input() multiple = true;
  @Output() filesSelected = new EventEmitter<File[]>();

  isDragOver = signal(false);
  selectedFiles = signal<File[]>([]);
  hasError = signal(false);
  errorMessage = signal('');

  private filePreviews = new Map<string, string>();

  // Computed signals for multi-image handling
  hasMultipleImages = computed(() => {
    return this.selectedFiles().filter(f => this.isImageFile(f)).length > 1;
  });

  imageFilesCount = computed(() => {
    return this.selectedFiles().filter(f => this.isImageFile(f)).length;
  });

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (files) {
      this.processFiles(Array.from(files));
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.processFiles(Array.from(input.files));
    }
    // Reset input so same file can be selected again
    input.value = '';
  }

  private processFiles(files: File[]): void {
    this.hasError.set(false);
    this.errorMessage.set('');

    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Check file size
      if (file.size > this.maxFileSize) {
        errors.push(`${file.name} exceeds ${this.formatFileSize(this.maxFileSize)} limit`);
        continue;
      }

      // Check file type
      if (!this.isValidFileType(file)) {
        errors.push(`${file.name} is not a supported file type`);
        continue;
      }

      validFiles.push(file);

      // Generate preview for images
      if (this.isImageFile(file)) {
        this.filePreviews.set(file.name, URL.createObjectURL(file));
      }
    }

    if (errors.length > 0) {
      this.hasError.set(true);
      this.errorMessage.set(errors.join('. '));
    }

    if (validFiles.length > 0) {
      if (this.multiple) {
        this.selectedFiles.update(current => [...current, ...validFiles]);
      } else {
        this.selectedFiles.set(validFiles.slice(0, 1));
      }
      this.filesSelected.emit(this.selectedFiles());
    }
  }

  private isValidFileType(file: File): boolean {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    const acceptedExtensions = this.acceptedTypes.split(',').map(t => t.trim().toLowerCase());

    // Check by extension
    if (acceptedExtensions.includes(extension)) {
      return true;
    }

    // Check by MIME type
    const mimeTypeMap: Record<string, string[]> = {
      '.csv': ['text/csv', 'application/vnd.ms-excel'],
      '.pdf': ['application/pdf'],
      '.png': ['image/png'],
      '.jpg': ['image/jpeg'],
      '.jpeg': ['image/jpeg'],
      '.webp': ['image/webp']
    };

    for (const [ext, mimeTypes] of Object.entries(mimeTypeMap)) {
      if (acceptedExtensions.includes(ext) && mimeTypes.includes(file.type)) {
        return true;
      }
    }

    return false;
  }

  removeFile(file: File, event: Event): void {
    event.stopPropagation();

    // Revoke object URL if exists
    const preview = this.filePreviews.get(file.name);
    if (preview) {
      URL.revokeObjectURL(preview);
      this.filePreviews.delete(file.name);
    }

    this.selectedFiles.update(files => files.filter(f => f !== file));
    this.filesSelected.emit(this.selectedFiles());
  }

  moveFileUp(index: number, event: Event): void {
    event.stopPropagation();
    if (index <= 0) return;

    this.selectedFiles.update(files => {
      const newFiles = [...files];
      [newFiles[index - 1], newFiles[index]] = [newFiles[index], newFiles[index - 1]];
      return newFiles;
    });
    this.filesSelected.emit(this.selectedFiles());
  }

  moveFileDown(index: number, event: Event): void {
    event.stopPropagation();
    const files = this.selectedFiles();
    if (index >= files.length - 1) return;

    this.selectedFiles.update(fs => {
      const newFiles = [...fs];
      [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
      return newFiles;
    });
    this.filesSelected.emit(this.selectedFiles());
  }

  onFileDrop(event: CdkDragDrop<File[]>): void {
    this.selectedFiles.update(files => {
      const newFiles = [...files];
      moveItemInArray(newFiles, event.previousIndex, event.currentIndex);
      return newFiles;
    });
    this.filesSelected.emit(this.selectedFiles());
  }

  getFileIndex(file: File): number {
    return this.selectedFiles().indexOf(file);
  }

  isImageFile(file: File): boolean {
    return file.type.startsWith('image/');
  }

  getFilePreview(file: File): string {
    return this.filePreviews.get(file.name) || '';
  }

  getFileIcon(file: File): string {
    const extension = file.name.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'csv':
        return 'table_chart';
      case 'pdf':
        return 'picture_as_pdf';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'webp':
        return 'image';
      default:
        return 'insert_drive_file';
    }
  }

  getFileTypeClass(file: File): string {
    const extension = file.name.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'csv':
        return 'csv';
      case 'pdf':
        return 'pdf';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'webp':
        return 'image';
      default:
        return '';
    }
  }

  getFileTypeLabel(file: File): string {
    const extension = file.name.split('.').pop()?.toUpperCase();
    return extension || 'FILE';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
