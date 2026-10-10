import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { NoteTranslationComponent } from './note-translation.component';
import { NoteTranslationService } from '../../../core/services/note-translation.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NoteTranslation } from '../../../core/services/llm-provider.interface';
import { provideNoMotion } from '../../../core/services/testing';

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
      imports: [NoteTranslationComponent],
      providers: [
        { provide: NoteTranslationService, useValue: { available, translate, failureKey } },
        { provide: TranslationService, useValue: translation },
        provideNoMotion(),
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

  it('keeps the unavailable button in the tab order, described by the fix, and asks for nothing on a press', () => {
    available.set(false);
    fixture.detectChanges();

    // A natively disabled button leaves the tab order, so a keyboard reader
    // never reaches it, nor the hint that says why it does nothing.
    const button = query('.translate-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).withContext('not natively disabled').toBeFalse();
    const hint = query('.no-provider-hint')!;
    expect(hint.textContent).toContain('noteTranslation.noProvider');
    expect(hint.id).withContext('the hint carries an id').not.toBe('');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);

    button.click();
    fixture.detectChanges();

    expect(translate).not.toHaveBeenCalled();
    expect(query('app-loading-spinner')).toBeNull();
    expect(query('.translate-button')).not.toBeNull();
  });

  it('drops the description and the disabled state once a provider can answer', () => {
    available.set(false);
    fixture.detectChanges();
    available.set(true);
    fixture.detectChanges();

    const button = query('.translate-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();
    expect(query('.no-provider-hint')).toBeNull();
  });

  it('gives every lens its own hint id', () => {
    // The list, the detail dialog and the edit form can each hold a lens at
    // once, and a description pointing at a shared id reads whichever hint
    // the document finds first.
    available.set(false);
    fixture.detectChanges();
    const other = TestBed.createComponent(NoteTranslationComponent);
    other.componentRef.setInput('note', 'お茶 120');
    other.detectChanges();

    const first = query('.no-provider-hint')!.id;
    const second = (other.nativeElement as HTMLElement).querySelector('.no-provider-hint')!.id;
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
    other.destroy();
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

  it('moves focus onto Show original when the panel replaces the button', async () => {
    fixture.detectChanges();
    const button = query('.translate-button') as HTMLButtonElement;
    button.focus();

    button.click();
    await settle();

    // The button the click landed on is gone by the time the answer arrives,
    // so without this focus is on <body> and the keyboard has to walk the
    // whole surface again to reach the note.
    expect(document.activeElement).toBe(query('.show-original-button'));
  });

  it('hands focus back to Translate when the original returns', async () => {
    fixture.detectChanges();
    (query('.translate-button') as HTMLButtonElement).click();
    await settle();

    (query('.show-original-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(query('.translate-button'));
  });

  it('leaves focus alone when the reader moved it away while the model answered', async () => {
    const pending = pendingTranslation();
    fixture.detectChanges();
    const button = query('.translate-button') as HTMLButtonElement;
    button.focus();

    button.click();
    await settle();

    // The edit form's textarea, standing outside this component: the note goes
    // on being typed while the request runs, and an answer that yanked the
    // caret out of it would lose the keystrokes aimed at it next.
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();

    pending.resolve(answer);
    await settle();

    const focused = document.activeElement;
    outside.remove();
    expect(focused).toBe(outside);
  });

  it('moves focus onto Retry when the failure replaces the button', async () => {
    translate.and.rejectWith(new Error('offline'));
    fixture.detectChanges();
    const button = query('.translate-button') as HTMLButtonElement;
    button.focus();

    button.click();
    await settle();

    expect(document.activeElement).toBe(query('.retry-button'));
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

  it('holds Retry too when no provider can answer, reachable and described by the fix', async () => {
    translate.and.rejectWith(new Error('offline'));
    fixture.detectChanges();

    (query('.translate-button') as HTMLButtonElement).click();
    await settle();
    expect(query('.no-provider-hint')).withContext('no hint while a provider can answer').toBeNull();
    expect(query('.retry-button')?.getAttribute('aria-describedby')).toBeNull();

    available.set(false);
    fixture.detectChanges();

    const retry = query('.retry-button') as HTMLButtonElement;
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.disabled).withContext('not natively disabled').toBeFalse();
    const hint = query('.no-provider-hint')!;
    expect(hint.textContent).toContain('noteTranslation.noProvider');
    expect(hint.id).withContext('the hint carries an id').not.toBe('');
    expect(retry.getAttribute('aria-describedby')).toBe(hint.id);
    expect(query('.translation-error')).withContext('the failure stays on screen').not.toBeNull();

    retry.click();
    await settle();

    expect(translate).toHaveBeenCalledTimes(1);
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
