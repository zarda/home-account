import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { FileDropzoneComponent } from './file-dropzone.component';

describe('FileDropzoneComponent', () => {
  let component: FileDropzoneComponent;
  let fixture: ComponentFixture<FileDropzoneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileDropzoneComponent, NoopAnimationsModule],
      schemas: [NO_ERRORS_SCHEMA]
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
      expect(component.acceptedTypes).toBe('.csv,.pdf,.png,.jpg,.jpeg,.webp');
    });

    it('should have default max file size of 10MB', () => {
      expect(component.maxFileSize).toBe(10 * 1024 * 1024);
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
    const image = (name: string) => new File([''], name, { type: 'image/jpeg' });

    /** Drives the private processFiles the way the file input does. */
    function select(...files: File[]): void {
      component.onFileSelect({ target: { files, value: 'x' } } as unknown as Event);
    }

    it('releases the previous blob when a file of the same name is re-picked', () => {
      select(image('receipt.jpg'));
      const first = component.getFilePreview(image('receipt.jpg'));
      const revoke = spyOn(URL, 'revokeObjectURL');

      select(image('receipt.jpg'));

      // The map is keyed by name, so without this the first URL is overwritten
      // and stays alive with nothing able to reach it.
      expect(revoke).toHaveBeenCalledOnceWith(first);
    });

    it('releases what it displaces when only one file is allowed', () => {
      component.multiple = false;
      select(image('first.jpg'));
      const first = component.getFilePreview(image('first.jpg'));
      const revoke = spyOn(URL, 'revokeObjectURL');

      select(image('second.jpg'));

      expect(revoke).toHaveBeenCalledOnceWith(first);
      expect(component.selectedFiles().map(f => f.name)).toEqual(['second.jpg']);
    });

    it('releases every preview when the component is destroyed', () => {
      select(image('a.jpg'), image('b.jpg'));
      const urls = component.selectedFiles().map(f => component.getFilePreview(f));
      const revoke = spyOn(URL, 'revokeObjectURL');

      component.ngOnDestroy();

      expect(revoke.calls.allArgs().flat().sort()).toEqual(urls.sort());
      expect(component.getFilePreview(image('a.jpg'))).toBe('');
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
  });

  describe('file size formatting', () => {
    it('should format 0 bytes', () => {
      expect(component.formatFileSize(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      expect(component.formatFileSize(500)).toBe('500 Bytes');
    });

    it('should format kilobytes', () => {
      expect(component.formatFileSize(1024)).toBe('1 KB');
      expect(component.formatFileSize(2048)).toBe('2 KB');
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
