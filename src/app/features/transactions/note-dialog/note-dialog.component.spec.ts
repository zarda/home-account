import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { NoteDialogComponent } from './note-dialog.component';
import { NoteTranslationService } from '../../../core/services/note-translation.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NoteTranslation } from '../../../core/services/llm-provider.interface';

describe('NoteDialogComponent', () => {
  let fixture: ComponentFixture<NoteDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<NoteDialogComponent>>;
  let translate: jasmine.Spy;

  const NOTE = 'おにぎり 150\n緑茶 120';
  const answer: NoteTranslation = { text: 'Rice ball 150\nGreen tea 120', sourceLanguage: 'Japanese' };

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj<MatDialogRef<NoteDialogComponent>>('MatDialogRef', ['close']);
    translate = jasmine.createSpy('translate').and.resolveTo(answer);

    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    // The real lens is mounted here on purpose — hiding the original is a
    // contract between the two components, not something either can prove
    // alone. Its service is stubbed because the real one pulls the cloud-LLM
    // graph in behind it, with no Firestore to build it from.
    await TestBed.configureTestingModule({
      imports: [NoteDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { note: NOTE, description: 'Family Mart' } },
        {
          provide: NoteTranslationService,
          useValue: {
            available: signal(true),
            translate,
            failureKey: jasmine.createSpy('failureKey').and.returnValue('noteTranslation.failed'),
          },
        },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NoteDialogComponent);
    fixture.detectChanges();
  });

  it('shows the note under the transaction it belongs to', () => {
    expect(query('.note-subtitle')?.textContent).toContain('Family Mart');
    expect(query('.note-text')?.textContent).toContain('おにぎり 150');
    expect(query('.note-text')?.textContent).toContain('緑茶 120');
  });

  it('keeps the note readable line by line', () => {
    // A receipt read as one run-on paragraph is not the note that was written.
    expect(getComputedStyle(query('.note-text')!).whiteSpace).toBe('pre-wrap');
  });

  it('mounts the lens over the note it is reading', () => {
    expect(query('app-note-translation')).not.toBeNull();
    expect(query('.translate-button')).not.toBeNull();
  });

  it('stands the translation in for the original rather than beside it', async () => {
    (query('.translate-button') as HTMLButtonElement).click();
    await settle();

    expect(translate).toHaveBeenCalledOnceWith(NOTE);
    expect(query('.note-text')).withContext('the original steps aside').toBeNull();
    expect(query('.translated-text')?.textContent).toContain('Rice ball 150');

    // And comes back when the lens is closed, which is the whole point of the
    // two-way binding between them.
    (query('.show-original-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(query('.note-text')?.textContent).toContain('おにぎり 150');
  });

  it('closes from the header', () => {
    (query('.dialog-header-close') as HTMLButtonElement).click();

    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('closes from the actions row', () => {
    (query('.close-button') as HTMLButtonElement).click();

    expect(dialogRef.close).toHaveBeenCalled();
  });
});
