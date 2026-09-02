import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { NoteTranslationComponent } from './note-translation.component';
import { NoteTranslationService } from '../../../core/services/note-translation.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NoteTranslation } from '../../../core/services/llm-provider.interface';

describe('NoteTranslationComponent', () => {
  let fixture: ComponentFixture<NoteTranslationComponent>;
  let component: NoteTranslationComponent;
  let available: ReturnType<typeof signal<boolean>>;
  let translate: jasmine.Spy;
  let failureKey: jasmine.Spy;

  const answer: NoteTranslation = { text: 'Rice ball 150', sourceLanguage: 'Japanese' };

  /** A translation held open, so the in-flight state can be asserted. */
  function pendingTranslation(): {
    resolve: (value: NoteTranslation) => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: (value: NoteTranslation) => void;
    let reject!: (error: unknown) => void;
    translate.and.returnValue(
      new Promise<NoteTranslation>((res, rej) => {
        resolve = res;
        reject = rej;
      })
    );
    return { resolve, reject };
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    available = signal(true);
    translate = jasmine.createSpy('translate').and.resolveTo(answer);
    failureKey = jasmine.createSpy('failureKey').and.returnValue('noteTranslation.failed');

    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    // Key, plus any parameters it was given: the marker's whole job is to name
    // the source language, and a resolver that answered with the bare key
    // would pass whether or not the language ever reached it.
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${JSON.stringify(params)}` : key
    );

    await TestBed.configureTestingModule({
      imports: [NoteTranslationComponent, NoopAnimationsModule],
      providers: [
        { provide: NoteTranslationService, useValue: { available, translate, failureKey } },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NoteTranslationComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('note', 'おにぎり 150');
  });

  it('renders nothing for a note with no text in it', () => {
    fixture.componentRef.setInput('note', '   ');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('');
    expect(query('.translate-button')).toBeNull();
  });

  it('asks for nothing until the user asks', () => {
    fixture.detectChanges();

    expect(translate).not.toHaveBeenCalled();
    expect(query('.translate-button')).not.toBeNull();
    expect(component.showingTranslation()).toBeFalse();
  });

  it('offers the disabled button and names the fix when no provider is configured', () => {
    available.set(false);
    fixture.detectChanges();

    const button = query('.translate-button') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(query('.no-provider-hint')?.textContent).toContain('noteTranslation.noProvider');
  });

  it('spins while the model answers, then shows the marked-up translation', async () => {
    const pending = pendingTranslation();
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('app-loading-spinner')).not.toBeNull();
    expect(translate).toHaveBeenCalledOnceWith('おにぎり 150');

    pending.resolve(answer);
    await settle();

    expect(query('app-loading-spinner')).toBeNull();
    expect(query('.translation-marker')?.textContent).toContain('noteTranslation.marker');
    expect(query('.translation-marker')?.textContent).toContain('"language":"Japanese"');
    expect(query('.translated-text')?.textContent).toContain('Rice ball 150');
    expect(component.showingTranslation()).toBeTrue();
  });

  it('announces the arrived translation to assistive tech', async () => {
    fixture.detectChanges();
    (query('.translate-button') as HTMLButtonElement).click();
    await settle();

    expect(query('.translation-panel')?.getAttribute('role')).toBe('status');
  });

  it('puts the original back without forgetting the translation', async () => {
    fixture.detectChanges();
    (query('.translate-button') as HTMLButtonElement).click();
    await settle();

    (query('.show-original-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.showingTranslation()).toBeFalse();
    expect(query('.translation-panel')).toBeNull();

    // Kept, so asking again costs nothing.
    (query('.translate-button') as HTMLButtonElement).click();
    await settle();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(component.showingTranslation()).toBeTrue();
  });

  it('shows the failure the service names and retries on demand', async () => {
    const failure = new Error('429 too many requests');
    failureKey.and.returnValue('noteTranslation.failedRateLimited');
    translate.and.rejectWith(failure);
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    await settle();

    expect(failureKey).toHaveBeenCalledWith(failure);
    const error = query('.translation-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('noteTranslation.failedRateLimited');
    expect(component.showingTranslation()).toBeFalse();

    translate.and.resolveTo(answer);
    (query('.retry-button') as HTMLButtonElement).click();
    await settle();

    expect(translate).toHaveBeenCalledTimes(2);
    expect(query('.translation-error')).toBeNull();
    expect(query('.translated-text')?.textContent).toContain('Rice ball 150');
  });

  it('keeps a showingTranslation the host bound before the first change detection', () => {
    fixture.componentRef.setInput('showingTranslation', true);
    fixture.detectChanges();

    expect(component.showingTranslation()).toBeTrue();
  });

  it('drops the panel when the note itself is edited', async () => {
    fixture.detectChanges();
    (query('.translate-button') as HTMLButtonElement).click();
    await settle();
    expect(query('.translation-panel')).not.toBeNull();

    fixture.componentRef.setInput('note', 'お茶 120');
    fixture.detectChanges();

    expect(query('.translation-panel')).toBeNull();
    expect(component.showingTranslation()).toBeFalse();
    expect(query('.translate-button')).not.toBeNull();
  });

  it('leaves the request in flight alone when an abandoned one lands late', async () => {
    const landings: ((value: NoteTranslation) => void)[] = [];
    translate.and.callFake(
      () => new Promise<NoteTranslation>(resolve => landings.push(resolve))
    );
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentRef.setInput('note', 'お茶 120');
    fixture.detectChanges();
    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('app-loading-spinner')).not.toBeNull();

    landings[0](answer);
    await settle();

    // The first answer is not this note's, and neither is its completion: it
    // must not take the spinner down over a request that is still running.
    expect(query('app-loading-spinner')).not.toBeNull();
    expect(query('.translation-panel')).toBeNull();
  });

  it('ignores an answer that arrived for a note the user has since edited', async () => {
    const pending = pendingTranslation();
    fixture.detectChanges();
    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentRef.setInput('note', 'お茶 120');
    fixture.detectChanges();
    pending.resolve(answer);
    await settle();

    expect(query('.translation-panel')).toBeNull();
    expect(component.showingTranslation()).toBeFalse();
  });

  it('applies only the second of two requests asked for the same note text, and keeps the spinner up until it resolves', async () => {
    const landings: ((value: NoteTranslation) => void)[] = [];
    translate.and.callFake(
      () => new Promise<NoteTranslation>(resolve => landings.push(resolve))
    );
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // Edit away and back: the second click asks about the exact same text as
    // the still-pending first request, so a value comparison could not tell
    // the two apart.
    fixture.componentRef.setInput('note', 'お茶 120');
    fixture.detectChanges();
    fixture.componentRef.setInput('note', 'おにぎり 150');
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(landings.length).toBe(2);

    const secondAnswer: NoteTranslation = { text: 'Second answer', sourceLanguage: 'Japanese' };
    landings[0](answer);
    await settle();

    expect(component.isLoading()).toBeTrue();
    expect(query('app-loading-spinner')).not.toBeNull();
    expect(query('.translation-panel')).toBeNull();

    landings[1](secondAnswer);
    await settle();

    expect(component.isLoading()).toBeFalse();
    expect(query('app-loading-spinner')).toBeNull();
    expect(query('.translated-text')?.textContent).toContain('Second answer');
    expect(component.showingTranslation()).toBeTrue();
  });

  it('drops a superseded rejection instead of setting an error behind the panel that replaced it', async () => {
    const landings: {
      resolve: (value: NoteTranslation) => void;
      reject: (error: unknown) => void;
    }[] = [];
    translate.and.callFake(
      () =>
        new Promise<NoteTranslation>((resolve, reject) => {
          landings.push({ resolve, reject });
        })
    );
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    fixture.componentRef.setInput('note', 'お茶 120');
    fixture.detectChanges();
    fixture.componentRef.setInput('note', 'おにぎり 150');
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(landings.length).toBe(2);

    landings[1].resolve(answer);
    await settle();
    expect(query('.translation-panel')).not.toBeNull();

    landings[0].reject(new Error('stale rate limit'));
    await settle();

    expect(component.errorKey()).toBeNull();
    expect(failureKey).not.toHaveBeenCalled();
    expect(query('.translation-error')).toBeNull();
    expect(query('.translation-panel')).not.toBeNull();
  });
});
