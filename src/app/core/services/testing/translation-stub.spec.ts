import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslationService } from '../translation.service';
import { LocaleFormatService } from '../locale-format.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LocaleDatePipe } from '../../../shared/pipes/locale-date.pipe';
import { LocaleNumberPipe } from '../../../shared/pipes/locale-number.pipe';
import { createTranslationStub, createLocaleFormatStub } from './translation-stub';

describe('createTranslationStub', () => {
  it('echoes the key', () => {
    expect(createTranslationStub().t('settings.title')).toBe('settings.title');
  });

  it('echoes the params beside the key when there are any', () => {
    expect(createTranslationStub().t('goals.remaining', { count: 3 })).toBe('goals.remaining:{"count":3}');
  });

  it('exposes currentLocale and translationsVersion as readable signals', () => {
    const stub = createTranslationStub();

    expect(stub.currentLocale()).toBe('en');
    expect(stub.translationsVersion()).toBe(0);
  });

  it('takes an override for a single key without losing the signals', () => {
    const stub = createTranslationStub({ t: (key: string) => (key === 'a.b' ? 'Pinned' : key) });

    expect(stub.t('a.b')).toBe('Pinned');
    expect(stub.t('c.d')).toBe('c.d');
    expect(stub.currentLocale()).toBe('en');
  });
});

describe('createLocaleFormatStub', () => {
  it('formats a Date as its ISO day', () => {
    expect(createLocaleFormatStub().formatDate(new Date('2026-03-04T10:00:00Z'))).toBe('2026-03-04');
  });

  it('formats a Firestore-shaped value through its toDate', () => {
    const stamp = { toDate: () => new Date('2026-03-04T10:00:00Z') };

    expect(createLocaleFormatStub().formatDate(stamp)).toBe('2026-03-04');
  });

  it('formats an absent or unparseable value as the empty string', () => {
    const stub = createLocaleFormatStub();

    expect(stub.formatDate(null)).toBe('');
    expect(stub.formatDate(undefined)).toBe('');
    expect(stub.formatDate('not a date')).toBe('');
    expect(stub.formatNumber(null)).toBe('');
    expect(stub.formatNumber(Number.NaN)).toBe('');
  });

  it('orders a range whose sides arrive swapped', () => {
    const stub = createLocaleFormatStub();

    expect(stub.formatRange(new Date('2026-03-09'), new Date('2026-03-01'))).toBe('2026-03-01–2026-03-09');
  });

  it('formats a number as its own digits', () => {
    expect(createLocaleFormatStub().formatNumber(1234.5)).toBe('1234.5');
  });
});

@Component({
  standalone: true,
  imports: [TranslatePipe, LocaleDatePipe, LocaleNumberPipe],
  template: `
    <span class="key">{{ 'settings.title' | translate }}</span>
    <span class="params">{{ 'goals.remaining' | translate: { count: count() } }}</span>
    <span class="date">{{ day | localeDate }}</span>
    <span class="number">{{ 42.5 | localeNumber }}</span>
  `,
})
class StubHost {
  readonly count = signal(1);
  readonly day = new Date('2026-03-04T10:00:00Z');
}

/**
 * The point of the stubs is that a real template renders against them, so
 * the proof is a real template — not a direct call to `t`. The version
 * signal is the load-bearing half: the pipe memoizes per instance, so a
 * catalog that arrives after first render only reaches the DOM because the
 * stub's `translationsVersion` is a signal the pipe can re-read.
 */
describe('the stubs under a rendered template', () => {
  it('renders every pipe the stubs serve', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
      ],
    });

    const fixture = TestBed.createComponent(StubHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.key')?.textContent?.trim()).toBe('settings.title');
    expect(el.querySelector('.params')?.textContent?.trim()).toBe('goals.remaining:{"count":1}');
    expect(el.querySelector('.date')?.textContent?.trim()).toBe('2026-03-04');
    expect(el.querySelector('.number')?.textContent?.trim()).toBe('42.5');
  });

  it('re-resolves a memoized key when the catalog version moves', () => {
    const stub = createTranslationStub();
    let loaded = false;
    stub.t = (key: string) => (loaded ? `Loaded ${key}` : key);

    TestBed.configureTestingModule({
      providers: [
        { provide: TranslationService, useValue: stub },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
      ],
    });

    const fixture = TestBed.createComponent(StubHost);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.key')?.textContent?.trim()).toBe(
      'settings.title'
    );

    loaded = true;
    stub.translationsVersion.set(1);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.key')?.textContent?.trim()).toBe(
      'Loaded settings.title'
    );
  });
});
