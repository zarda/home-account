import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { FileDropzoneComponent } from './file-dropzone.component';
import { IMPORT_FILE_MAX_BYTES, RefusedShare } from '../../../../core/services/share-intake.service';
import { TranslationService } from '../../../../core/services/translation.service';
import {
  channels,
  createTranslationStub,
  hoverValue,
  paintedBackground,
  paintedColor,
  provideNoMotion,
  ratio,
  settleAnimations,
  withTheme,
} from '../../../../core/services/testing';

describe('FileDropzoneComponent', () => {
  let component: FileDropzoneComponent;
  let fixture: ComponentFixture<FileDropzoneComponent>;

  const image = (name: string) => new File([''], name, { type: 'image/jpeg' });
  const csv = (name: string) => new File([''], name, { type: 'text/csv' });
  const names = (files: readonly File[]) => files.map(f => f.name);

  /** Drives the private processFiles the way the file input does. */
  function select(...files: File[]): void {
    component.onFileSelect({ target: { files, value: 'x' } } as unknown as Event);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileDropzoneComponent],
      schemas: [NO_ERRORS_SCHEMA],
      // The component itself reads the catalog now — its two file refusals
      // are user-facing sentences — so the stub is needed even with the
      // template blanked.
      providers: [
        { provide: TranslationService, useValue: createTranslationStub() },
        provideNoMotion()
      ]
    })
      .overrideComponent(FileDropzoneComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(FileDropzoneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should not be in drag over state initially', () => {
      expect(component.isDragOver()).toBeFalse();
    });

    it('should have no selected files initially', () => {
      expect(component.selectedFiles().length).toBe(0);
    });

    it('should not have error initially', () => {
      expect(component.hasError()).toBeFalse();
    });

    it('should have default accepted types', () => {
      expect(component.acceptedTypes).toBe('.csv,.pdf,.png,.jpg,.jpeg,.webp,.json');
    });

    it('should default its max file size to the shared intake ceiling', () => {
      expect(component.maxFileSize).toBe(IMPORT_FILE_MAX_BYTES);
    });
  });

  describe('drag events', () => {
    it('should set isDragOver to true on dragover', () => {
      const event = new DragEvent('dragover');
      spyOn(event, 'preventDefault');
      spyOn(event, 'stopPropagation');

      component.onDragOver(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(component.isDragOver()).toBeTrue();
    });

    it('should set isDragOver to false on dragleave', () => {
      component.isDragOver.set(true);
      const event = new DragEvent('dragleave');
      spyOn(event, 'preventDefault');
      spyOn(event, 'stopPropagation');

      component.onDragLeave(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(component.isDragOver()).toBeFalse();
    });
  });

  describe('image preview lifetime', () => {
    // Two iOS captures are both image.jpg. Each is a row of its own, so each
    // keeps a preview of its own: the second pick takes nothing from the
    // first, and the first's blob is still the one its row shows.
    it('gives each of two same-named photos its own preview, and releases neither', () => {
      const first = image('receipt.jpg');
      const second = image('receipt.jpg');
      select(first);
      const firstPreview = component.getFilePreview(first);
      const revoke = spyOn(URL, 'revokeObjectURL');

      select(second);

      expect(firstPreview).withContext('the first photo\'s preview').toMatch(/^blob:/);
      expect(component.getFilePreview(first)).withContext('the first photo\'s preview, after the second pick').toBe(firstPreview);
      expect(component.getFilePreview(second)).withContext('the second photo\'s preview').toMatch(/^blob:/);
      expect(component.getFilePreview(second)).withContext('the second photo\'s preview').not.toBe(firstPreview);
      expect(revoke).withContext('a blob a row still shows').not.toHaveBeenCalled();
    });

    // PIN: passes before the fix, and has to keep passing after it. Mutation
    // run and seen failing: the single-mode revoke skipped.
    it('releases what it displaces when only one file is allowed', () => {
      component.multiple = false;
      const first = image('first.jpg');
      select(first);
      const firstPreview = component.getFilePreview(first);
      const revoke = spyOn(URL, 'revokeObjectURL');

      select(image('second.jpg'));

      expect(revoke).toHaveBeenCalledOnceWith(firstPreview);
      expect(component.selectedFiles().map(f => f.name)).toEqual(['second.jpg']);
    });

    // Single mode lists one photo of a pick, so it mints one preview: a blob
    // for a photo it leaves off the list would live until the zone goes.
    it('mints a preview only for the photo it keeps when only one file is allowed', () => {
      component.multiple = false;
      const first = image('first.jpg');
      const second = image('second.jpg');
      const mint = spyOn(URL, 'createObjectURL').and.callThrough();

      select(first, second);

      // By identity: two empty Files are equal to toEqual.
      expect(mint.calls.count()).withContext('the previews minted').toBe(1);
      expect(mint.calls.argsFor(0)[0]).withContext('the photo previewed').toBe(first);
      expect(component.getFilePreview(second)).withContext('the photo left off the list').toBe('');
      expect(component.selectedFiles().length).withContext('the list').toBe(1);
      expect(component.selectedFiles()[0]).withContext('the file listed').toBe(first);
    });

    // The same File taken again gets a new preview, and the blob it had is
    // released: nothing points at it once its entry is overwritten.
    // A pin. Mutation: the revokePreview before the preview is set removed.
    it('releases the old preview when the same file is taken again', () => {
      component.multiple = false;
      const photo = image('photo.jpg');
      select(photo);
      const firstPreview = component.getFilePreview(photo);
      const revoke = spyOn(URL, 'revokeObjectURL');

      select(photo);

      expect(firstPreview).withContext('the first preview').toMatch(/^blob:/);
      expect(revoke).withContext('the old blob').toHaveBeenCalledOnceWith(firstPreview);
      expect(component.getFilePreview(photo)).withContext('the new preview').toMatch(/^blob:/);
      expect(component.getFilePreview(photo)).withContext('the new preview').not.toBe(firstPreview);
    });

    // PIN: passes before the fix, and has to keep passing after it. Mutation
    // run and seen failing: the map left uncleared in ngOnDestroy.
    it('releases every preview when the component is destroyed', () => {
      const a = image('a.jpg');
      select(a, image('b.jpg'));
      const urls = component.selectedFiles().map(f => component.getFilePreview(f));
      const revoke = spyOn(URL, 'revokeObjectURL');

      component.ngOnDestroy();

      expect(revoke.calls.allArgs().flat().sort()).toEqual(urls.sort());
      expect(component.getFilePreview(a)).toBe('');
    });
  });

  // The wizard drops photos the offline queue has stored from its own
  // selection, and this list has to drop them too: every change here emits
  // the whole list, so a photo left on it returns with the next one.
  describe('forget', () => {
    it('takes out exactly the named files, releasing their previews, without emitting', () => {
      const first = image('first.jpg');
      const kept = image('kept.jpg');
      const third = image('third.jpg');
      select(first, csv('ledger.csv'), kept, third, csv('last.csv'));
      const released = [first, third].map(f => component.getFilePreview(f));
      const keptPreview = component.getFilePreview(kept);
      const revoke = spyOn(URL, 'revokeObjectURL');
      const emit = spyOn(component.filesSelected, 'emit');

      component.forget([first, third]);

      expect(names(component.selectedFiles())).toEqual(['ledger.csv', 'kept.jpg', 'last.csv']);
      expect(revoke.calls.allArgs().flat().sort()).toEqual(released.sort());
      expect(component.getFilePreview(first)).withContext('a forgotten preview').toBe('');
      expect(component.getFilePreview(kept)).withContext('a kept preview').toBe(keptPreview);
      // The host already holds the list it wants; an emit would run its
      // selection handler again over the one it just wrote.
      expect(emit).not.toHaveBeenCalled();
    });

    it('leaves the forgotten files out of what the next add emits', () => {
      const queued = image('queued.jpg');
      select(queued, csv('ledger.csv'));
      component.forget([queued]);
      const emitted: File[][] = [];
      component.filesSelected.subscribe(files => emitted.push(files));

      select(image('next.jpg'));

      expect(emitted.map(names)).toEqual([['ledger.csv', 'next.jpg']]);
    });

    // Two iOS captures are both image.jpg. Each photo owns its own preview,
    // so the forgotten one's blob is released and the later one keeps its
    // own, whatever their names.
    it('releases the forgotten photo\'s own preview and keeps a later one\'s of the same name', () => {
      const queued = image('image.jpg');
      const later = image('image.jpg');
      select(queued);
      const queuedPreview = component.getFilePreview(queued);
      select(later);
      const laterPreview = component.getFilePreview(later);
      const revoke = spyOn(URL, 'revokeObjectURL');

      component.forget([queued]);

      // By identity: two empty Files of one name are equal to toEqual.
      expect(component.selectedFiles().length).withContext('the list').toBe(1);
      expect(component.selectedFiles()[0]).withContext('the file kept').toBe(later);
      expect(laterPreview).withContext('the later photo\'s preview').toMatch(/^blob:/);
      expect(component.getFilePreview(later)).withContext('the later photo\'s preview').toBe(laterPreview);
      expect(revoke).withContext('the forgotten photo\'s blob').toHaveBeenCalledOnceWith(queuedPreview);
    });
  });

  // A file shared into the app reaches the wizard, not this zone, so the
  // wizard hands it here: it joins the list a pick would have joined, and
  // a file the share gate refused is named in this zone's own banner.
  describe('adopt', () => {
    it('takes files its host received elsewhere onto the list, previews minted, without emitting', () => {
      select(csv('ledger.csv'));
      const emit = spyOn(component.filesSelected, 'emit');
      const shared = image('shared.jpg');

      const taken = component.adopt([shared]);

      expect(taken.length).withContext('the files taken').toBe(1);
      expect(taken[0]).withContext('the file taken').toBe(shared);
      expect(names(component.selectedFiles())).toEqual(['ledger.csv', 'shared.jpg']);
      expect(component.getFilePreview(shared)).toMatch(/^blob:/);
      // The host is the one asking, and writes its selection from this list
      // once the call returns; an emit would run its handler a second time.
      expect(emit).not.toHaveBeenCalled();
    });

    it('hands the next pick the adopted files with it', () => {
      component.adopt([image('shared.jpg')]);
      const emitted: File[][] = [];
      component.filesSelected.subscribe(files => emitted.push(files));

      select(csv('ledger.csv'));

      expect(emitted.map(names)).toEqual([['shared.jpg', 'ledger.csv']]);
    });

    it('names the files a gate upstream refused in its banner, in its own words and ahead of its own refusals', () => {
      const big = new File(['x'], 'big.png', { type: 'image/png' });
      Object.defineProperty(big, 'size', { value: component.maxFileSize + 1 });
      const refused: RefusedShare[] = [
        { file: big, reason: 'tooLarge' },
        { file: new File([], 'empty.pdf', { type: 'application/pdf' }), reason: 'empty' },
        { file: new File(['{}'], 'backup.json', { type: 'application/json' }), reason: 'backup' },
      ];

      const taken = component.adopt([image('ok.jpg'), new File(['x'], 'notes.txt')], refused);

      expect(names(taken)).toEqual(['ok.jpg']);
      expect(component.hasError()).toBeTrue();
      expect(component.errorMessage()).toBe(
        'import.fileTooLarge:{"name":"big.png","limit":"10 MB"}. import.fileEmpty:{"name":"empty.pdf"}. ' +
        'import.shareBackup:{"name":"backup.json"}. import.fileTypeUnsupported:{"name":"notes.txt"}'
      );
    });

    // A share can land while the banner still names a file the user picked:
    // that refusal is still true, so the share's is added to it, not put in
    // its place.
    it('keeps a refusal the user\'s own pick put in the banner, and adds the share\'s after it', () => {
      select(new File(['hi'], 'notes.txt', { type: 'text/plain' }));

      component.adopt([], [{ file: new File([], 'empty.pdf', { type: 'application/pdf' }), reason: 'empty' }]);

      expect(component.hasError()).toBeTrue();
      expect(component.errorMessage()).toBe(
        'import.fileTypeUnsupported:{"name":"notes.txt"}. import.fileEmpty:{"name":"empty.pdf"}'
      );
    });

    it('takes the first file only when one is allowed, and releases what it displaces', () => {
      component.multiple = false;
      const first = image('first.jpg');
      select(first);
      const firstPreview = component.getFilePreview(first);
      const revoke = spyOn(URL, 'revokeObjectURL');
      const a = image('a.jpg');
      const b = image('b.jpg');

      const taken = component.adopt([a, b]);

      // By identity: two empty Files are equal to toEqual.
      expect(taken.length).withContext('the files taken').toBe(1);
      expect(taken[0]).withContext('the file taken').toBe(a);
      expect(component.selectedFiles().length).withContext('the list').toBe(1);
      expect(component.selectedFiles()[0]).withContext('the file listed').toBe(a);
      expect(revoke).withContext('the displaced file\'s blob').toHaveBeenCalledOnceWith(firstPreview);
    });

    // The host reaches the zone after an await, so the zone can be gone by
    // the time it is asked; a preview minted then has no destroy left to
    // release it.
    // A pin. Mutation: `if (this.destroyRef.destroyed) return [];` removed from adopt.
    it('takes nothing once it is destroyed, so it mints no preview no destroy is left to release', () => {
      fixture.destroy();
      const mint = spyOn(URL, 'createObjectURL');

      const taken = component.adopt([image('late.jpg')]);

      expect(taken).toEqual([]);
      expect(component.selectedFiles()).toEqual([]);
      expect(mint).not.toHaveBeenCalled();
    });

    it('takes a file it already lists, or one repeated in the batch, once', () => {
      const mint = spyOn(URL, 'createObjectURL').and.callThrough();
      const s = image('s.jpg');
      const t = image('t.jpg');

      component.adopt([s]);
      const again = component.adopt([s]);
      const repeated = component.adopt([t, t]);

      expect(again).withContext('a file already listed').toEqual([]);
      expect(repeated.length).withContext('a file repeated in the batch').toBe(1);
      expect(repeated[0]).withContext('the repeated file').toBe(t);
      expect(component.selectedFiles().length).withContext('the list').toBe(2);
      expect(component.selectedFiles()[0]).withContext('the first file listed').toBe(s);
      expect(component.selectedFiles()[1]).withContext('the second file listed').toBe(t);
      expect(mint.calls.count()).withContext('the previews minted').toBe(2);
      expect(mint.calls.argsFor(0)[0]).withContext('the first preview').toBe(s);
      expect(mint.calls.argsFor(1)[0]).withContext('the second preview').toBe(t);
    });
  });

  describe('file type validation', () => {
    it('should return correct icon for CSV files', () => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      expect(component.getFileIcon(file)).toBe('table_chart');
    });

    it('should return correct icon for PDF files', () => {
      const file = new File([''], 'test.pdf', { type: 'application/pdf' });
      expect(component.getFileIcon(file)).toBe('picture_as_pdf');
    });

    it('should return correct icon for image files', () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      expect(component.getFileIcon(file)).toBe('image');
    });

    it('should return default icon for unknown files', () => {
      const file = new File([''], 'test.xyz', { type: 'application/octet-stream' });
      expect(component.getFileIcon(file)).toBe('insert_drive_file');
    });

    it('returns the backup icon for a json file', () => {
      const file = new File([''], 'backup.json', { type: 'application/json' });
      expect(component.getFileIcon(file)).toBe('backup');
    });

    it('should identify image files correctly', () => {
      const imageFile = new File([''], 'test.png', { type: 'image/png' });
      const nonImageFile = new File([''], 'test.csv', { type: 'text/csv' });

      expect(component.isImageFile(imageFile)).toBeTrue();
      expect(component.isImageFile(nonImageFile)).toBeFalse();
    });

    it('treats an octet-stream jpg as an image', () => {
      // A photo shared from another iOS app arrives with a generic MIME
      // type; the extension is what says it is an image.
      const shared = new File([''], 'photo.jpg', { type: 'application/octet-stream' });
      expect(component.isImageFile(shared)).toBeTrue();
    });

    it('takes a .json typed application/json', () => {
      spyOn(component.filesSelected, 'emit');
      const file = new File(['{}'], 'backup.json', { type: 'application/json' });

      component.onFileSelect({ target: { files: [file], value: 'x' } } as unknown as Event);

      expect(component.filesSelected.emit).toHaveBeenCalled();
      expect(component.hasError()).toBeFalse();
    });

    it('takes a .json with a blank type on its extension', () => {
      // A backup file dragged from Finder or a Files app share carries no
      // MIME type at all; the extension has to carry the whole decision.
      spyOn(component.filesSelected, 'emit');
      const file = new File(['{}'], 'backup.json', { type: '' });

      component.onFileSelect({ target: { files: [file], value: 'x' } } as unknown as Event);

      expect(component.filesSelected.emit).toHaveBeenCalled();
      expect(component.hasError()).toBeFalse();
    });

    it('still refuses a .txt', () => {
      const file = new File(['hi'], 'notes.txt', { type: 'text/plain' });

      component.onFileSelect({ target: { files: [file], value: 'x' } } as unknown as Event);

      expect(component.hasError()).toBeTrue();
      // The refusal is read from the catalog, keyed and parameterised — the
      // stub echoes key and params, so this is the whole rendered sentence.
      expect(component.errorMessage()).toBe('import.fileTypeUnsupported:{"name":"notes.txt"}');
    });

    // A pick that adds nothing leaves the list as it was, so the host has
    // nothing new to hear.
    // A pin. Mutation: processFiles emitting after take() whatever it took.
    it('emits nothing for a pick it refuses whole', () => {
      const emit = spyOn(component.filesSelected, 'emit');

      select(new File(['hi'], 'notes.txt', { type: 'text/plain' }));

      expect(component.hasError()).toBeTrue();
      expect(emit).not.toHaveBeenCalled();
    });

    it('refuses an oversized file from the catalog too', () => {
      const file = new File(['x'], 'huge.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: component.maxFileSize + 1 });

      component.onFileSelect({ target: { files: [file], value: 'x' } } as unknown as Event);

      expect(component.hasError()).toBeTrue();
      expect(component.errorMessage()).toBe(
        'import.fileTooLarge:{"name":"huge.png","limit":"10 MB"}'
      );
    });
  });

  describe('file size formatting', () => {
    it('should format 0 bytes', () => {
      expect(component.formatFileSize(0)).toBe('common.fileSizeBytes:{"size":"0"}');
    });

    it('should format bytes', () => {
      expect(component.formatFileSize(500)).toBe('common.fileSizeBytes:{"size":"500"}');
    });

    it('should format kilobytes', () => {
      expect(component.formatFileSize(1024)).toBe('1 kB');
      expect(component.formatFileSize(2048)).toBe('2 kB');
    });

    it('should format megabytes', () => {
      expect(component.formatFileSize(1048576)).toBe('1 MB');
      expect(component.formatFileSize(5242880)).toBe('5 MB');
    });
  });

  describe('getFileTypeClass', () => {
    it('should return csv class for CSV files', () => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      expect(component.getFileTypeClass(file)).toBe('csv');
    });

    it('should return pdf class for PDF files', () => {
      const file = new File([''], 'test.pdf', { type: 'application/pdf' });
      expect(component.getFileTypeClass(file)).toBe('pdf');
    });

    it('should return image class for image files', () => {
      const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
      expect(component.getFileTypeClass(file)).toBe('image');
    });
  });

  describe('getFileTypeLabel', () => {
    it('should return uppercase extension', () => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      expect(component.getFileTypeLabel(file)).toBe('CSV');
    });

    it('should return FILE for files without extension', () => {
      const file = new File([''], 'test', { type: 'application/octet-stream' });
      expect(component.getFileTypeLabel(file)).toBe('TEST');
    });
  });
});

/**
 * Every case above overrides the template to `<div></div>`, so none of them
 * touches the zone a user actually drops on: the empty state's own
 * `role`/`tabindex`/`aria-label` gate, the per-file row, the reorder controls
 * that only exist for a multi-image pick, or the error banner. This is the
 * one place the real template renders and its controls are clicked.
 */
describe('FileDropzoneComponent, through its own template', () => {
  let fixture: ComponentFixture<FileDropzoneComponent>;
  let component: FileDropzoneComponent;

  const imageFile = (name: string) => new File(['x'], name, { type: 'image/png' });
  const csvFile = (name = 'rows.csv') => new File(['a,b'], name, { type: 'text/csv' });

  /** A real `drop`, the way the browser delivers one. */
  function dropFiles(files: File[]): void {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    const zone = fixture.nativeElement.querySelector('.dropzone') as HTMLElement;
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const all = (selector: string) => Array.from(el().querySelectorAll(selector)) as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileDropzoneComponent],
      providers: [
        { provide: TranslationService, useValue: createTranslationStub() },
        provideNoMotion()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FileDropzoneComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    // The component mints blob URLs for image previews and releases them in
    // ngOnDestroy; without the destroy every image case leaks one.
    fixture.destroy();
  });

  it('offers the empty zone as a keyboard-reachable button', () => {
    fixture.detectChanges();

    const zone = el().querySelector('.dropzone') as HTMLElement;
    expect(zone.getAttribute('role')).toBe('button');
    expect(zone.getAttribute('tabindex')).toBe('0');
    expect(zone.getAttribute('aria-label')).toBe('import.dropzoneTitle');
    expect(text('.title')).toBe('import.dropzoneTitle');
    expect(text('.hint')).toBe('import.dropzoneHint');
    expect(all('.file-type').length).toBe(4);
  });

  it('stops being a button once a file is picked', () => {
    fixture.detectChanges();
    dropFiles([csvFile()]);

    const zone = el().querySelector('.dropzone') as HTMLElement;
    expect(zone.getAttribute('role')).toBeNull();
    expect(zone.getAttribute('tabindex')).toBeNull();
    expect(el().querySelector('.dropzone-content')).toBeNull();
    expect(el().querySelector('.selected-files')).not.toBeNull();
  });

  it('renders a dropped file as a row carrying its name, size and type', () => {
    fixture.detectChanges();
    dropFiles([csvFile('statement.csv')]);

    expect(all('.file-item').length).toBe(1);
    expect(text('.file-name')).toBe('statement.csv');
    expect(text('.file-size')).toBe('common.fileSizeBytes:{"size":"3"}');
    expect(text('.file-type-label')).toBe('CSV');
    expect(text('.file-icon-wrapper mat-icon')).toBe('table_chart');
  });

  it('gives an image a thumbnail rather than an icon', () => {
    fixture.detectChanges();
    dropFiles([imageFile('receipt.png')]);

    const thumb = el().querySelector('.file-thumbnail img') as HTMLImageElement;
    expect(thumb).not.toBeNull();
    expect(thumb.src).toContain('blob:');
    expect(thumb.alt).toBe('receipt.png');
    expect(el().querySelector('.file-icon-wrapper')).toBeNull();
  });

  it('removes a row when its remove button is clicked', () => {
    const emitted: File[][] = [];
    component.filesSelected.subscribe(files => emitted.push(files));
    fixture.detectChanges();
    dropFiles([csvFile('one.csv'), csvFile('two.csv')]);

    (all('.file-item')[0].querySelector('.remove-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(all('.file-name').map(n => n.textContent?.trim())).toEqual(['two.csv']);
    expect(emitted[emitted.length - 1].map(f => f.name)).toEqual(['two.csv']);
  });

  // Two iOS captures are both image.jpg. Each is a row with a thumbnail of
  // its own, and removing one leaves the other's where it was.
  it('gives two photos of one name a row and a thumbnail each, and keeps the first one\'s when the second goes', () => {
    const thumbnails = () => all('.file-thumbnail img').map(img => img.getAttribute('src'));
    fixture.detectChanges();
    dropFiles([imageFile('image.jpg'), imageFile('image.jpg')]);

    const [first, second] = thumbnails();
    expect(all('.file-item').length).withContext('the rows').toBe(2);
    expect(thumbnails().length).withContext('the thumbnails').toBe(2);
    expect(first).withContext('the first thumbnail').toMatch(/^blob:/);
    expect(second).withContext('the second thumbnail').toMatch(/^blob:/);
    expect(second).withContext('the second thumbnail').not.toBe(first);

    const remove = all('.file-item')[1]?.querySelector<HTMLButtonElement>('.remove-btn');
    expect(remove).withContext('the second row\'s remove button').toBeTruthy();
    remove?.click();
    fixture.detectChanges();

    expect(thumbnails()).withContext('the thumbnails left').toEqual([first]);
  });

  it('keeps the reorder controls out of a single-image pick', () => {
    fixture.detectChanges();
    dropFiles([imageFile('only.png')]);

    expect(el().querySelector('.reorder-controls')).toBeNull();
    expect(el().querySelector('.image-number')).toBeNull();
    expect(el().querySelector('.multi-image-hint')).toBeNull();
  });

  it('numbers and reorders a multi-image pick from the template', () => {
    fixture.detectChanges();
    dropFiles([imageFile('first.png'), imageFile('second.png')]);

    expect(text('.multi-image-hint span')).toBe('import.multiImageHint');
    expect(all('.image-number').map(n => n.textContent?.trim())).toEqual(['1', '2']);

    const firstRow = all('.file-item')[0];
    const [up, down] = Array.from(
      firstRow.querySelectorAll('.reorder-btn')
    ) as HTMLButtonElement[];
    expect(up.disabled).toBeTrue();
    expect(down.disabled).toBeFalse();

    down.click();
    fixture.detectChanges();

    expect(all('.file-name').map(n => n.textContent?.trim())).toEqual(['second.png', 'first.png']);
  });

  // Two iOS captures are both image.jpg. Each row's buttons name the file
  // they act on by its place in the list and its name, the way the badge and
  // the thumbnail tell the rows apart by sight: "Remove", "Move up" and
  // "Move down" alone gave every row the same three names.
  it('names each row\'s remove and move buttons by the file\'s place and name', () => {
    fixture.detectChanges();
    dropFiles([imageFile('image.jpg'), imageFile('image.jpg'), csvFile('rows.csv')]);
    const labels = (selector: string) => all(selector).map(b => b.getAttribute('aria-label'));

    expect(labels('.remove-btn')).withContext('the remove buttons').toEqual([
      'import.removeFileLabel:{"position":1,"name":"image.jpg"}',
      'import.removeFileLabel:{"position":2,"name":"image.jpg"}',
      'import.removeFileLabel:{"position":3,"name":"rows.csv"}',
    ]);
    expect(labels('.reorder-btn')).withContext('the move buttons').toEqual([
      'import.moveFileUpLabel:{"position":1,"name":"image.jpg"}',
      'import.moveFileDownLabel:{"position":1,"name":"image.jpg"}',
      'import.moveFileUpLabel:{"position":2,"name":"image.jpg"}',
      'import.moveFileDownLabel:{"position":2,"name":"image.jpg"}',
    ]);
  });

  it('renames a row\'s buttons when its file moves', () => {
    fixture.detectChanges();
    dropFiles([imageFile('first.png'), imageFile('second.png')]);

    (all('.file-item')[0].querySelectorAll('.reorder-btn')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(all('.remove-btn').map(b => b.getAttribute('aria-label'))).toEqual([
      'import.removeFileLabel:{"position":1,"name":"second.png"}',
      'import.removeFileLabel:{"position":2,"name":"first.png"}',
    ]);
  });

  it('shows the error banner when a dropped file is refused', () => {
    fixture.detectChanges();
    dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(el().querySelector('.error-banner')).not.toBeNull();
    expect(text('.error-message')).toBe('import.fileTypeUnsupported:{"name":"notes.txt"}');
    expect(el().querySelector('.dropzone')?.classList).toContain('error');
  });

  // The banner is the only thing that says a file was refused. It is inserted
  // by `@if`, so as an alert its arrival is spoken; without the role a
  // screen-reader user dropped a file and heard nothing at all.
  it('announces an oversized file it refuses', () => {
    fixture.detectChanges();
    const big = new File(['x'], 'big-statement.csv', { type: 'text/csv' });
    // A DataTransfer copies the file and drops an overridden size, so this
    // one goes in through the input's handler rather than a drop.
    Object.defineProperty(big, 'size', { value: component.maxFileSize + 1 });
    component.onFileSelect({ target: { files: [big], value: 'x' } } as unknown as Event);
    fixture.detectChanges();

    const banner = el().querySelector('.error-banner') as HTMLElement;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('import.fileTooLarge:{"name":"big-statement.csv","limit":"10 MB"}');
    expect(banner.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');

    // A refusal leaves nothing picked, so the zone is a role="button" right
    // now, and a button's children are presentational: an alert inside one
    // is each engine's to keep or prune. The banner sits beside the zone.
    expect(el().querySelector('.dropzone')?.getAttribute('role')).toBe('button');
    expect(banner.closest('[role="button"]')).toBeNull();
  });

  // Beside the zone, the banner still sits inside the frame that takes the
  // drop, so a file dropped on it is read rather than opened by the browser.
  it('takes a file dropped on the refusal banner', () => {
    fixture.detectChanges();
    dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    const banner = el().querySelector('.error-banner') as HTMLElement;

    const transfer = new DataTransfer();
    transfer.items.add(csvFile('statement.csv'));
    banner.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
    fixture.detectChanges();

    expect(text('.file-name')).toBe('statement.csv');
    expect(el().querySelector('.error-banner')).toBeNull();
  });

  it('announces an unsupported file it refuses, and the next refusal in the same alert', () => {
    fixture.detectChanges();
    dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    const banner = el().querySelector('.error-banner') as HTMLElement;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('import.fileTypeUnsupported:{"name":"notes.txt"}');
    expect(banner.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');

    // processFiles clears and sets the error in one handler, so a second
    // refusal never unmounts the banner: its new text lands in the same
    // alert, and a change to an alert's text is spoken too.
    dropFiles([new File(['x'], 'tool.exe', { type: 'application/octet-stream' })]);
    expect(el().querySelector('.error-banner')).toBe(banner);
    expect(banner.textContent).toContain('import.fileTypeUnsupported:{"name":"tool.exe"}');
  });

  // Below the zone, the banner sat just under the fold of a 768px window,
  // where the zone fills the first screen: a sighted user who dropped the
  // file saw nothing change. The scroll waits for the render that inserts
  // or rewrites the banner, so it runs on the tick, and it moves the page
  // only: an alert is announced where it is, never focused.
  it('brings a refused file\'s message into view, and again when the next refusal rewrites it', () => {
    const scroll = spyOn(Element.prototype, 'scrollIntoView');
    fixture.detectChanges();
    const focused = document.activeElement;

    const big = new File(['x'], 'big-statement.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: component.maxFileSize + 1 });
    component.onFileSelect({ target: { files: [big], value: 'x' } } as unknown as Event);
    fixture.detectChanges();
    TestBed.tick();

    const banner = el().querySelector('.error-banner') as HTMLElement;
    expect(scroll).toHaveBeenCalledOnceWith({ block: 'nearest' });
    expect(scroll.calls.mostRecent().object).toBe(banner);
    expect(document.activeElement).toBe(focused);

    dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    TestBed.tick();

    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll.calls.mostRecent().object).toBe(banner);
  });

  it('scrolls nothing for a file it takes', () => {
    const scroll = spyOn(Element.prototype, 'scrollIntoView');
    fixture.detectChanges();

    dropFiles([csvFile('statement.csv')]);
    TestBed.tick();

    expect(text('.file-name')).toBe('statement.csv');
    expect(scroll).not.toHaveBeenCalled();
  });

  it('renders an adopted file as a row with its thumbnail', () => {
    fixture.detectChanges();

    component.adopt([imageFile('shared.png')]);
    fixture.detectChanges();

    expect(all('.file-name').map(n => n.textContent?.trim())).toEqual(['shared.png']);
    const thumb = el().querySelector('.file-thumbnail img') as HTMLImageElement | null;
    expect(thumb).withContext('the thumbnail').not.toBeNull();
    expect(thumb?.getAttribute('src') ?? '').toMatch(/^blob:/);
    expect(el().querySelector('.dropzone')?.getAttribute('role')).toBeNull();
  });

  // A share the gate refused is said where a refused pick is said: the
  // same alert, scrolled into view the same way.
  it('announces a share the gate refused in the same alert, brought into view', () => {
    const scroll = spyOn(Element.prototype, 'scrollIntoView');
    fixture.detectChanges();

    component.adopt([], [{ file: new File([], 'empty.pdf', { type: 'application/pdf' }), reason: 'empty' }]);
    fixture.detectChanges();
    TestBed.tick();

    const banner = el().querySelector('.error-banner') as HTMLElement | null;
    expect(banner).withContext('the banner').not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(text('.error-message')).toBe('import.fileEmpty:{"name":"empty.pdf"}');
    expect(scroll).toHaveBeenCalledOnceWith({ block: 'nearest' });
    expect(scroll.calls.mostRecent()?.object).withContext('the element scrolled').toBe(banner as HTMLElement);
  });

  it('marks the zone while a drag is over it', () => {
    fixture.detectChanges();
    const zone = el().querySelector('.dropzone') as HTMLElement;

    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
    fixture.detectChanges();
    expect(zone.classList).toContain('dragover');

    zone.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    fixture.detectChanges();
    expect(zone.classList).not.toContain('dragover');
  });

  it('opens the picker from the empty zone but not from the file list', () => {
    fixture.detectChanges();
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    const click = spyOn(input, 'click');

    (el().querySelector('.dropzone') as HTMLElement).click();
    expect(click).toHaveBeenCalledTimes(1);

    dropFiles([csvFile()]);
    (el().querySelector('.dropzone') as HTMLElement).click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('takes a file through the hidden input the browse button reaches', () => {
    fixture.detectChanges();
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(csvFile('picked.csv'));
    input.files = transfer.files;

    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(text('.file-name')).toBe('picked.csv');
    // The handler clears the input so the same file can be picked twice.
    expect(input.value).toBe('');
  });

  describe('colours, as painted', () => {
    const THEMES = ['light', 'dark'] as const;

    /** What `<property>: var(token)` computes to under the theme on <html> now. */
    function tokenValue(token: string, property = 'color'): string {
      const probe = document.createElement('span');
      probe.style.setProperty(property, `var(${token})`);
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).getPropertyValue(property);
      } finally {
        probe.remove();
      }
    }

    /** `node` is `token`, and reads at `floor` or better on what is painted behind it. */
    function expectPainted(node: HTMLElement | null, token: string, label: string, floor = 4.5): void {
      expect(node).withContext(label).toBeTruthy();
      if (!node) return;
      expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
      expect(ratio(paintedColor(node), paintedBackground(node)))
        .withContext(`${label} on what it sits on`)
        .toBeGreaterThanOrEqual(floor);
    }

    // A glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11). An image never
    // reaches the wrapper: it gets a thumbnail (the case above).
    it('paints a CSV\'s and a PDF\'s icon in a status token at 3:1 or better on its wrapper, in both themes', () => {
      fixture.detectChanges();
      dropFiles([csvFile('rows.csv'), new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' })]);
      const [csv, pdf] = all('.file-icon-wrapper mat-icon');

      for (const theme of THEMES) {
        withTheme(theme, () => {
          expectPainted(csv, '--color-success-text', `${theme} CSV icon`, 3);
          expectPainted(pdf, '--color-error-text', `${theme} PDF icon`, 3);
        });
      }
    });

    /**
     * The upload glyph sits on its own pulsing bubble, a gradient between
     * two tints that the walk up the parents cannot see. Each end of it is
     * laid on the glyph's container in turn, at full strength, over the zone
     * as the pointer leaves it and as the zone's own :hover rule paints it.
     */
    it('holds the upload glyph at 3:1 or better over either end of its bubble, at rest and hovered, in both themes', () => {
      fixture.detectChanges();
      const zone = el().querySelector('.dropzone') as HTMLElement;
      const container = el().querySelector('.icon-container') as HTMLElement;
      const glyph = el().querySelector('.upload-icon') as HTMLElement;
      const bubble = el().querySelector('.icon-bg') as HTMLElement;
      const hovered = hoverValue(zone, '.dropzone', 'background');
      expect(hovered).withContext('the hover rule').toBe('var(--surface-hover)');

      for (const theme of THEMES) {
        withTheme(theme, () => {
          const stops = getComputedStyle(bubble).backgroundImage.match(/(?:rgba?|color)\([^()]*\)/g) ?? [];
          expect(stops.length).withContext(`${theme} the bubble's two ends`).toBe(2);
          expect(getComputedStyle(glyph).color)
            .withContext(`${theme} glyph`)
            .toBe(tokenValue('--color-primary-text'));
          for (const zoneFill of ['', hovered]) {
            zone.style.background = zoneFill;
            try {
              for (const stop of stops) {
                container.style.backgroundColor = stop;
                expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
                  .withContext(`${theme} glyph ${zoneFill ? 'hovered' : 'at rest'} over ${stop}`)
                  .toBeGreaterThanOrEqual(3);
              }
            } finally {
              container.style.backgroundColor = '';
              zone.style.background = '';
            }
          }
        });
      }
    });

    // The message sits on its banner's 10% error tint over whatever is below
    // the zone, not on a card, and the zone fades between its states, so the
    // page is settled first.
    it('reads a refused file\'s message in --color-error-text at AA on its banner, in both themes', () => {
      fixture.detectChanges();
      dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          expectPainted(el().querySelector('.error-banner .error-message'), '--color-error-text', `${theme} message`);
        });
      }
    });

    it('paints the multi-image hint\'s icon in --color-ai at 3:1 and its text at AA, in both themes', () => {
      fixture.detectChanges();
      dropFiles([imageFile('first.png'), imageFile('second.png')]);
      const hint = el().querySelector('.multi-image-hint') as HTMLElement;

      for (const theme of THEMES) {
        withTheme(theme, () => {
          expectPainted(hint.querySelector('mat-icon'), '--color-ai', `${theme} hint icon`, 3);
          expectPainted(hint.querySelector('span'), '--text-primary', `${theme} hint text`);
        });
      }
    });

    /**
     * The zone repaints itself while hovered and while a drag is over it, so
     * a hint held to the resting fill shows as a patch of it: in dark the
     * hovered zone is #3d3d3d and the resting fill #121212. Every state is
     * held to one sum, 8% of --color-ai over whatever the zone paints.
     */
    it('keeps the multi-image hint 8% --color-ai over the zone\'s own fill at rest, hovered and dragged over, in both themes', () => {
      fixture.detectChanges();
      dropFiles([imageFile('first.png'), imageFile('second.png')]);
      const zone = el().querySelector('.dropzone') as HTMLElement;
      const hint = el().querySelector('.multi-image-hint') as HTMLElement;
      const label = hint.querySelector('span') as HTMLElement;
      const drag = (type: 'dragover' | 'dragleave') => {
        zone.dispatchEvent(new DragEvent(type, { bubbles: true }));
        fixture.detectChanges();
      };
      const states = [
        { name: 'at rest', enter: () => undefined, leave: () => undefined },
        { name: 'dragged over', enter: () => drag('dragover'), leave: () => drag('dragleave') },
        {
          name: 'hovered',
          enter: () => {
            zone.style.background = hoverValue(zone, '.dropzone', 'background');
            hint.style.background = hoverValue(hint, '.multi-image-hint', 'background');
          },
          leave: () => {
            zone.style.background = '';
            hint.style.background = '';
          },
        },
      ];

      for (const theme of THEMES) {
        withTheme(theme, () => {
          const ai = channels(tokenValue('--color-ai')).rgb;
          for (const state of states) {
            state.enter();
            try {
              const under = paintedBackground(zone);
              const painted = paintedBackground(hint);
              painted.forEach((value, i) => {
                expect(Math.abs(value - (0.08 * ai[i] + 0.92 * under[i])))
                  .withContext(`${theme} hint ${state.name}, channel ${i}`)
                  .toBeLessThanOrEqual(1);
              });
              expect(ratio(paintedColor(label), painted))
                .withContext(`${theme} hint text ${state.name}`)
                .toBeGreaterThanOrEqual(4.5);
            } finally {
              state.leave();
            }
          }
        });
      }
    });
  });
});
