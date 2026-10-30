import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnDestroy,
  Output,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import {
  IMPORT_FILE_MAX_BYTES,
  RefusedShare,
  ShareRefusalReason,
} from '../../../../core/services/share-intake.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { looksLikeImageFile } from '../../../../core/utils/file.utils';

@Component({
  selector: 'app-file-dropzone',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    DragDropModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-dropzone.component.html',
  styleUrl: './file-dropzone.component.scss'
})
export class FileDropzoneComponent implements OnDestroy {
  private translationService = inject(TranslationService);
  private localeFormat = inject(LocaleFormatService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);

  @Input() acceptedTypes = '.csv,.pdf,.png,.jpg,.jpeg,.webp,.json';
  @Input() maxFileSize = IMPORT_FILE_MAX_BYTES;
  @Input() multiple = true;
  @Output() filesSelected = new EventEmitter<File[]>();

  isDragOver = signal(false);
  selectedFiles = signal<File[]>([]);
  hasError = signal(false);
  errorMessage = signal('');

  // Keyed by the File itself: two files can share a name (two iOS captures
  // are both image.jpg), and each row shows its own photo.
  private filePreviews = new Map<File, string>();

  constructor() {
    // The banner sits below the zone, and the zone fills the first screen
    // of a short window, so a refusal shown only there changed nothing a
    // sighted user could see. It is brought into view after the render that
    // inserts or rewrites it, without smooth motion and without focus: an
    // alert is announced where it is.
    effect(() => {
      if (!this.hasError()) return;
      this.errorMessage();
      untracked(() => afterNextRender(
        () => this.host.nativeElement.querySelector('.error-banner')?.scrollIntoView({ block: 'nearest' }),
        { injector: this.injector },
      ));
    });
  }

  // Computed signals for multi-image handling
  hasMultipleImages = computed(() => {
    return this.selectedFiles().filter(f => this.isImageFile(f)).length > 1;
  });

  imageFilesCount = computed(() => {
    return this.selectedFiles().filter(f => this.isImageFile(f)).length;
  });

  // Only the empty zone acts as a click-to-browse target. Once files are
  // picked the list of thumbnails must not re-open the OS picker on every
  // stray click; adding more is done through the explicit "Add more" button.
  browse(input: HTMLInputElement): void {
    if (this.selectedFiles().length === 0) {
      input.click();
    }
  }

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
    if (this.take(files).length > 0) this.filesSelected.emit(this.selectedFiles());
  }

  // Checks each file, writes the banner, mints the previews of what passed
  // and lists it, then returns what it took. The banner starts empty, unless
  // `keepStanding` asks to keep a refusal it already shows: the new
  // sentences, `refusals` first, are then added after that one.
  private take(files: readonly File[], refusals: readonly string[] = [], keepStanding = false): File[] {
    const errors: string[] = [];
    if (keepStanding && this.hasError()) {
      errors.push(this.errorMessage());
    } else {
      this.hasError.set(false);
      this.errorMessage.set('');
    }
    errors.push(...refusals);

    const validFiles: File[] = [];

    for (const file of files) {
      // Check file size. Both refusals are read by whoever tried to import,
      // so they come from the catalog like everything else on screen; the
      // file's own name is the one part that stays as the disk spells it.
      if (file.size > this.maxFileSize) {
        errors.push(this.refusal(file, 'tooLarge'));
        continue;
      }

      // Check file type
      if (!this.isValidFileType(file)) {
        errors.push(this.refusal(file, 'type'));
        continue;
      }

      validFiles.push(file);
    }

    if (errors.length > 0) {
      this.hasError.set(true);
      this.errorMessage.set(errors.join('. '));
    }

    if (validFiles.length === 0) return [];
    if (this.multiple) {
      this.mintPreviews(validFiles);
      this.selectedFiles.update(current => [...current, ...validFiles]);
      return validFiles;
    }
    // Single mode replaces the selection, so whatever it displaced has to
    // be released — nothing else will ever refer to it again.
    const kept = validFiles.slice(0, 1);
    this.selectedFiles().forEach(f => {
      if (!kept.includes(f)) this.revokePreview(f);
    });
    this.mintPreviews(kept);
    this.selectedFiles.set(kept);
    return kept;
  }

  // Generates the previews of the images take() lists, and of no other: a
  // blob for a file left off the list would live until the zone goes. The
  // same File taken again would otherwise overwrite its entry and leave the
  // old blob alive with nothing pointing at it.
  private mintPreviews(files: readonly File[]): void {
    for (const file of files) {
      if (this.isImageFile(file)) {
        this.revokePreview(file);
        this.filePreviews.set(file, URL.createObjectURL(file));
      }
    }
  }

  // One sentence per reason, each under a literal key: the catalog check
  // reads only literal `t(` arguments. The zone's own two refusals come
  // through here too, so a file refused upstream reads as one refused here.
  private refusal(file: File, reason: ShareRefusalReason): string {
    switch (reason) {
      case 'tooLarge':
        // The limit named is this zone's: the share gate's ceiling
        // (IMPORT_FILE_MAX_BYTES) unless a host sets a smaller
        // [maxFileSize], and the wizard does not.
        return this.translationService.t('import.fileTooLarge', {
          name: file.name,
          limit: this.formatFileSize(this.maxFileSize),
        });
      case 'backup':
        return this.translationService.t('import.shareBackup', { name: file.name });
      case 'type':
        return this.translationService.t('import.fileTypeUnsupported', { name: file.name });
      case 'empty':
        return this.translationService.t('import.fileEmpty', { name: file.name });
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
      '.webp': ['image/webp'],
      '.json': ['application/json']
    };

    for (const [ext, mimeTypes] of Object.entries(mimeTypeMap)) {
      if (acceptedExtensions.includes(ext) && mimeTypes.includes(file.type)) {
        return true;
      }
    }

    return false;
  }

  // The component holds blob URLs, so it has to release them when it goes:
  // the wizard renders one of these, so a session without this leaked two
  // sets of previews per image, not one.
  ngOnDestroy(): void {
    this.filePreviews.forEach(url => URL.revokeObjectURL(url));
    this.filePreviews.clear();
  }

  private revokePreview(file: File): void {
    const preview = this.filePreviews.get(file);
    if (preview) {
      URL.revokeObjectURL(preview);
      this.filePreviews.delete(file);
    }
  }

  // For a host that has already let these files go from its own selection:
  // every change here emits the whole list, so a file this list still held
  // would walk back into the host's with the next add, remove or reorder.
  // It emits nothing: the host is the one asking, its selection is written
  // already, and an emit would run its handler over that selection again.
  forget(files: readonly File[]): void {
    const gone = this.selectedFiles().filter(f => files.includes(f));
    const kept = this.selectedFiles().filter(f => !gone.includes(f));
    gone.forEach(f => this.revokePreview(f));
    this.selectedFiles.set(kept);
  }

  // For a host that received files elsewhere (a share reaches the wizard,
  // not this zone): they join this list as a pick's would, so the next add,
  // remove or reorder emits them with the rest, and the files a gate
  // upstream refused are named in this banner, after any refusal it still
  // shows. A file already listed, or repeated in the batch, is taken once.
  // It emits nothing: the host is the one asking, its selection is written
  // from this list once the call returns, and an emit would run its handler
  // over that selection twice. The host asks after an await, so the zone
  // can be gone by then, and a preview minted once it is has no destroy
  // left to release it: it takes nothing.
  adopt(files: readonly File[], refused: readonly RefusedShare[] = []): File[] {
    if (this.destroyRef.destroyed) return [];
    const listed = this.selectedFiles();
    const fresh = files.filter((f, i) => !listed.includes(f) && files.indexOf(f) === i);
    return this.take(fresh, refused.map(r => this.refusal(r.file, r.reason)), true);
  }

  removeFile(file: File, event: Event): void {
    event.stopPropagation();

    this.revokePreview(file);

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
    // MIME or extension: a shared photo can arrive typed
    // application/octet-stream and still needs its thumbnail.
    return looksLikeImageFile(file);
  }

  getFilePreview(file: File): string {
    return this.filePreviews.get(file) || '';
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
      case 'json':
        return 'backup';
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

  // A file's size, and the limit a refusal names, in the reader's language,
  // through the app's one locale formatter.
  formatFileSize(bytes: number): string {
    return this.localeFormat.formatFileSize(bytes);
  }
}
