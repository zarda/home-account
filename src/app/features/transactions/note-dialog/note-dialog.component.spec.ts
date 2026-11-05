import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { NoteDialogComponent, NoteDialogData } from './note-dialog.component';
import { NoteTranslationService } from '../../../core/services/note-translation.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NoteTranslation } from '../../../core/services/llm-provider.interface';
import {
  type TranslationStub,
  catalogTranslator,
  createTranslationStub,
  provideNoMotion,
} from '../../../core/services/testing';

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
      imports: [NoteDialogComponent],
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
        provideNoMotion(),
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

// The subtitle names the transaction as the list's rows do, from the
// description it is handed as stored, so an untitled one reads the catalog's
// words for one. A sibling of the describe above, not inside it: that one's
// beforeEach has opened its note already, and the dialog's data is read once
// per test.
describe("NoteDialogComponent's subtitle, read in the catalog's words", () => {
  let fixture: ComponentFixture<NoteDialogComponent>;
  let dialogData: NoteDialogData;
  let locale: ReturnType<typeof signal<'en' | 'ja'>>;
  let translation: TranslationStub;

  const say = (language: 'en' | 'ja') => catalogTranslator(language, { strict: true });
  const root = () => fixture.nativeElement as HTMLElement;
  const subtitle = () => root().querySelector('.note-subtitle')?.textContent?.trim();

  beforeEach(async () => {
    locale = signal<'en' | 'ja'>('en');
    // This stub's t reads a locale signal as the service's reads its catalog.
    translation = createTranslationStub({ t: (key, params) => catalogTranslator(locale())(key, params) });

    await TestBed.configureTestingModule({
      imports: [NoteDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        {
          provide: NoteTranslationService,
          useValue: {
            available: signal(true),
            translate: jasmine.createSpy('translate'),
            failureKey: jasmine.createSpy('failureKey').and.returnValue('noteTranslation.failed'),
          },
        },
        { provide: TranslationService, useValue: translation },
        provideNoMotion(),
      ],
    }).compileComponents();
  });

  function open(description: string): void {
    dialogData = { note: 'no idea what this was', description };
    fixture = TestBed.createComponent(NoteDialogComponent);
    fixture.detectChanges();
  }

  /** Switches the stub as the service's setLocale does: the catalog, its version, then the locale. */
  function switchTo(next: 'ja'): void {
    locale.set(next);
    translation.translationsVersion.update(version => version + 1);
    translation.currentLocale.set(next);
    fixture.detectChanges();
  }

  for (const blank of ['', '   ']) {
    it(`names a transaction whose description is ${JSON.stringify(blank)} by the list's words`, () => {
      open(blank);

      expect(subtitle()).toBe(say('en')('transactions.untitledRow'));
    });
  }

  // A pin. Mutation: the subtitle reading the untitled words whatever the
  // description (a titled one would read them too).
  it('still names a titled transaction by its description (pin)', () => {
    open('Family Mart');

    expect(subtitle()).toBe('Family Mart');
  });

  // The template calls transactionName(), and the service's t reads its
  // catalog signal, so a language switch made while the note is open redraws
  // the subtitle under the header the pipe redraws. A pin. Mutation: the
  // name read once, into a field, when the note opens.
  for (const blank of ['', '   ']) {
    it(`follows a language switch made while the note is open, for ${JSON.stringify(blank)} (pin)`, () => {
      open(blank);
      expect(subtitle()).withContext('in en').toBe(say('en')('transactions.untitledRow'));

      switchTo('ja');

      expect(root().querySelector('.dialog-header-text')?.textContent)
        .withContext('the header, which the pipe redraws')
        .toContain(say('ja')('transactions.note'));
      expect(subtitle()).withContext('in ja, with the note still open').toBe(say('ja')('transactions.untitledRow'));
    });
  }
});
