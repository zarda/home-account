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
  viewChild,
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
import { joinSentences } from '../../../../core/utils/import-review.utils';
import { ImportFocusContext, focusWhenRendered } from '../import-focus';

/**
 * A file the zone, or a gate upstream, refused: its name as the disk spells
 * it and why. The banner keeps these rather than its sentences, and never the
 * File, which for a refused share is a blob nothing else holds.
 */
interface Refusal {
  readonly name: string;
  readonly reason: ShareRefusalReason;
}

/** Two lists are one banner when they name the same files for the same reasons, in order. */
function sameRefusals(a: readonly Refusal[], b: readonly Refusal[]): boolean {
  return a.length === b.length && a.every((r, i) => r.name === b[i].name && r.reason === b[i].reason);
}

/** One hint id per zone, so Browse's description never resolves to another zone's hint. */
let hintSeq = 0;

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
  styleUrl: './file-dropzone.component.scss',
  // On the host rather than the template: a template click on the zone, an
  // element with no tabindex, fails interactive-supports-focus, and the zone
  // must not be a tab stop or a button. Browse is both, inside it.
  host: {
    '(click)': 'onZoneClick($event)',
  },
})
export class FileDropzoneComponent implements OnDestroy {
  private translationService = inject(TranslationService);
  private localeFormat = inject(LocaleFormatService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private readonly focus: ImportFocusContext = {
    host: this.host.nativeElement,
    injector: this.injector,
    destroyRef: this.destroyRef,
  };

  @Input() acceptedTypes = '.csv,.pdf,.png,.jpg,.jpeg,.webp,.json';
  @Input() maxFileSize = IMPORT_FILE_MAX_BYTES;
  @Input() multiple = true;
  @Output() filesSelected = new EventEmitter<File[]>();

  isDragOver = signal(false);
  selectedFiles = signal<File[]>([]);
  // What the banner refuses, not its words: the sentences are written as it
  // renders, in the language the page is in then, so a reader who switches
  // language with a refusal standing reads it in the new one. Writing a list
  // equal to the standing one is no change and brings nothing into view; a
  // fresh pick empties it first, so its refusals always do.
  private readonly refusals = signal<readonly Refusal[]>([], { equal: sameRefusals });
  readonly hasError = computed(() => this.refusals().length > 0);
  // One sentence a file, joined by the reader's own stop through
  // joinSentences, the import area's one way to join two sentences: a Latin
  // one and a space in en, 。 alone in ja and tc. None of the four sentences
  // ends in a stop of its own in any catalog, so none is given up.
  readonly errorMessage = computed(() =>
    this.refusals()
      .map(r => this.refusal(r.name, r.reason))
      .reduce((lead, next) => joinSentences((k, p) => this.translationService.t(k, p), lead, next), '')
  );

  // Keyed by the File itself: two files can share a name (two iOS captures
  // are both image.jpg), and each row shows its own photo.
  private filePreviews = new Map<File, string>();

  constructor() {
    // The banner sits below the zone, and the zone fills the first screen
    // of a short window, so a refusal shown only there changed nothing a
    // sighted user could see. It is brought into view after the render that
    // inserts it or changes what it refuses, without smooth motion and
    // without focus: an alert is announced where it is. A language switch
    // rewrites its words in place and moves nothing.
    effect(() => {
      if (this.refusals().length === 0) return;
      untracked(() => afterNextRender(
        () => this.host.nativeElement.querySelector('.error-banner')?.scrollIntoView({ block: 'nearest' }),
        { injector: this.injector },
      ));
    });
  }

  /**
   * Each listed file's number among its own kind, counted from 1 in list
   * order: a photo's among the photos, which is the number its badge shows
   * and its place in the order the photos are sent in, and any other file's
   * among the other files. Keyed by the File, as the previews are: two
   * captures are both image.jpg.
   */
  readonly places = computed(() => {
    const photos = new Map<File, number>();
    const others = new Map<File, number>();
    for (const file of this.selectedFiles()) {
      if (this.isImageFile(file)) photos.set(file, photos.size + 1);
      else others.set(file, others.size + 1);
    }
    return { photos, others };
  });

  /** A photo's number among the photos, its badge's; 0 for any other file. */
  photoNumber(file: File): number {
    return this.places().photos.get(file) ?? 0;
  }

  /** A file's number among the files that are not photos; 0 for a photo. */
  otherNumber(file: File): number {
    return this.places().others.get(file) ?? 0;
  }

  /** How many photos are listed. */
  photoCount(): number {
    return this.places().photos.size;
  }

  // The badges, the arrows and the drag handles stand once two photos are listed.
  readonly hasMultipleImages = computed(() => this.photoCount() > 1);

  /** What Browse's aria-describedby names: the hint under the zone's title. */
  readonly hintId = `dropzone-hint-${++hintSeq}`;

  /** The hidden input whose own click opens the picker. */
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  /**
   * A pointer click anywhere on the empty zone opens the picker, as a click
   * on Browse does; the keyboard and a screen reader reach it through Browse
   * alone. Once files are picked the list of rows must not re-open it on
   * every stray click: adding more is Add more's.
   *
   * Only a click inside the zone counts, so the refusal banner beside it,
   * which is read rather than pressed, opens nothing. A click from inside a
   * control of the zone's is that control's own: Browse has opened the
   * picker already, and the input's own click, which is the picker, bubbles
   * out through the zone to here and would ask again. A control the zone
   * sits inside, a link of the page's own, is none of the zone's.
   */
  onZoneClick(event: Event): void {
    if (this.selectedFiles().length > 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const zone = this.host.nativeElement.querySelector('.dropzone');
    if (!target || !zone?.contains(target)) return;
    const control = target.closest('button, a, input');
    if (control && zone.contains(control)) return;
    this.fileInput().nativeElement.click();
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

  // Checks each file, writes what the banner refuses, mints the previews of
  // what passed and lists it, then returns what it took. The banner starts
  // empty, unless `keepStanding` asks to keep the refusals it already shows:
  // the new ones, `upstream` first, are then added after those. Starting
  // empty is a change of its own, so a file refused again, whose list equals
  // the standing one, still brings the banner into view again.
  private take(files: readonly File[], upstream: readonly Refusal[] = [], keepStanding = false): File[] {
    if (!keepStanding) this.refusals.set([]);
    const refused: Refusal[] = [...this.refusals(), ...upstream];

    const validFiles: File[] = [];

    for (const file of files) {
      // Check file size. Both refusals are read by whoever tried to import,
      // so their sentences come from the catalog as the banner renders; the
      // file's own name is the one part that stays as the disk spells it.
      if (file.size > this.maxFileSize) {
        refused.push({ name: file.name, reason: 'tooLarge' });
        continue;
      }

      // Check file type
      if (!this.isValidFileType(file)) {
        refused.push({ name: file.name, reason: 'type' });
        continue;
      }

      validFiles.push(file);
    }

    this.refusals.set(refused);

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
  private refusal(name: string, reason: ShareRefusalReason): string {
    switch (reason) {
      case 'tooLarge':
        // The limit named is this zone's: the share gate's ceiling
        // (IMPORT_FILE_MAX_BYTES) unless a host sets a smaller
        // [maxFileSize], and the wizard does not.
        return this.translationService.t('import.fileTooLarge', {
          name,
          limit: this.formatFileSize(this.maxFileSize),
        });
      case 'backup':
        return this.translationService.t('import.shareBackup', { name });
      case 'type':
        return this.translationService.t('import.fileTypeUnsupported', { name });
      case 'empty':
        return this.translationService.t('import.fileEmpty', { name });
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
    return this.take(fresh, refused.map(r => ({ name: r.file.name, reason: r.reason })), true);
  }

  removeFile(file: File, event: Event): void {
    event.stopPropagation();

    // The remove pressed goes with its row, and a focused button taken out
    // of the page drops focus to the page itself; the last file's remove
    // takes the whole list with it. So focus goes on to the remove of the
    // row that takes this one's place, else of the row before it, and to
    // Browse, back with the empty zone, once nothing is left: the review
    // card hands a removed row's focus on the same way, and a click hands it
    // on too, as a click on an arrow does. Nothing is announced: the remove
    // that takes focus reads the file now in that place. The neighbour is
    // found while it is still beside the file, and its row by its new place.
    const listed = this.selectedFiles();
    const at = listed.indexOf(file);
    const neighbour = at < 0 ? undefined : (listed[at + 1] ?? listed[at - 1]);

    this.revokePreview(file);

    this.selectedFiles.update(files => files.filter(f => f !== file));
    this.filesSelected.emit(this.selectedFiles());

    focusWhenRendered(
      this.focus,
      ...(neighbour ? [`[data-row="${this.selectedFiles().indexOf(neighbour)}"] .remove-btn`] : []),
      '.browse-btn',
    );
  }

  // The arrows move a photo among the photos: it swaps rows with the photo
  // before or after it, and a file between them that is no photo keeps its
  // row. The photos are sent in list order, so the badges stay the order
  // they are read in.
  moveFileUp(file: File, event: Event): void {
    event.stopPropagation();
    this.swapWithPhoto(file, -1);
  }

  moveFileDown(file: File, event: Event): void {
    event.stopPropagation();
    this.swapWithPhoto(file, 1);
  }

  private swapWithPhoto(file: File, step: -1 | 1): void {
    const files = this.selectedFiles();
    const from = files.indexOf(file);
    if (from < 0 || !this.isImageFile(file)) return;
    let to = from + step;
    while (to >= 0 && to < files.length && !this.isImageFile(files[to])) to += step;
    if (to < 0 || to >= files.length) return;

    const moved = [...files];
    [moved[from], moved[to]] = [moved[to], moved[from]];
    this.selectedFiles.set(moved);
    this.filesSelected.emit(moved);

    // The pressed arrow is disabled once its photo reaches that end, and a
    // disabled button drops focus; a row the swap takes out of the page and
    // puts back drops it too. So focus is put back on the moved photo's row,
    // now at `to`: on the arrow pressed while the photo can still go that
    // way, on its other arrow once it cannot.
    const [pressed, other] = step === -1 ? ['up', 'down'] : ['down', 'up'];
    const row = `[data-row="${to}"]`;
    focusWhenRendered(
      this.focus,
      `${row} [data-move="${pressed}"]:enabled`,
      `${row} [data-move="${other}"]:enabled`,
      `${row} .remove-btn`,
    );
  }

  // CDK sorts every row the dragged photo passes, a CSV's too, and no
  // cdkDropListSortPredicate can hold one in place: the predicate gates only
  // where the dragged row lands. So the drop is remapped after the sort: the
  // photos are read off in the order CDK left them and written back into the
  // photos' own rows, and every other file keeps its row. A CSV the drag
  // slid aside snaps back when the photo is dropped.
  onFileDrop(event: CdkDragDrop<File[]>): void {
    const files = this.selectedFiles();
    const sorted = [...files];
    moveItemInArray(sorted, event.previousIndex, event.currentIndex);
    const photos = sorted.filter(f => this.isImageFile(f));
    let next = 0;
    const placed = files.map(f => (this.isImageFile(f) ? photos[next++] : f));
    this.selectedFiles.set(placed);
    this.filesSelected.emit(placed);
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
