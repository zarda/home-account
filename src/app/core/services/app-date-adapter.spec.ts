import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS, MatDateFormats } from '@angular/material/core';
import { MatDatepicker, MatDatepickerInput } from '@angular/material/datepicker';

import { APP_DATE_INPUT } from './app-date-adapter';
import { DATE_FORMAT_AUTO } from './date-format.service';
import { SupportedLocale } from './translation.service';
import { provideAppDatepickerForTests } from './testing';

/** 19 August 2026, local midnight: a single-digit month, so a fixed pattern's padding shows. */
const AUG_19 = new Date(2026, 7, 19);

const FIXED_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;

@Component({
  selector: 'app-picker-host',
  template: `<input [matDatepicker]="picker" [formControl]="date" /><mat-datepicker #picker />`,
  imports: [MatDatepicker, MatDatepickerInput, ReactiveFormsModule],
})
class PickerHostComponent {
  readonly date = new FormControl<Date | null>(null);
}

describe('AppDateAdapter', () => {
  let locale: WritableSignal<SupportedLocale>;
  let dateFormat: WritableSignal<string>;

  beforeEach(() => {
    locale = signal<SupportedLocale>('en');
    dateFormat = signal(DATE_FORMAT_AUTO);
    TestBed.configureTestingModule({ providers: [provideAppDatepickerForTests({ dateFormat, locale })] });
  });

  /** The root adapter, built on first inject the way the first picker builds it. */
  const adapter = (): DateAdapter<Date> => TestBed.inject(DateAdapter);
  const formats = (): MatDateFormats => TestBed.inject(MAT_DATE_FORMATS);

  /** Counts what Material re-renders every input on, from now. */
  function countLocaleChanges(): { count: number } {
    const seen = { count: 0 };
    adapter().localeChanges.subscribe(() => seen.count++);
    return seen;
  }

  /** Writes the reader's language and format, then lets the adapter follow them. */
  function readAs(language: SupportedLocale, format: string): void {
    locale.set(language);
    dateFormat.set(format);
    TestBed.tick();
  }

  const shown = (date: Date): string => adapter().format(date, APP_DATE_INPUT);
  const typed = (text: string): Date | null => adapter().parse(text, formats().parse.dateInput);
  const isInvalidDate = (value: Date | null): boolean =>
    value !== null && adapter().isDateInstance(value) && !adapter().isValid(value);

  describe('the date an input shows', () => {
    it("is the language's own numeric date on auto: 8/19/2026 in English, 2026/8/19 once the reader turns to Japanese", () => {
      expect(shown(AUG_19)).withContext('in English').toBe('8/19/2026');

      locale.set('ja');
      TestBed.tick();

      expect(shown(AUG_19)).withContext('in Japanese').toBe('2026/8/19');
    });

    it('tells every input to re-render exactly once per language the reader turns to, and names months and weekdays in it', () => {
      const changes = countLocaleChanges();

      locale.set('ja');
      TestBed.tick();
      expect(changes.count).withContext('after turning to Japanese').toBe(1);
      TestBed.tick();
      expect(changes.count).withContext('after a run with nothing changed').toBe(1);

      expect(adapter().getMonthNames('long')[7]).withContext('August').toBe('8月');
      expect(adapter().getDayOfWeekNames('long')[0]).withContext('Sunday').toBe('日曜日');
    });

    it('is built in the language the reader chose, before its first run', () => {
      locale.set('ja');

      expect(adapter().getMonthNames('long')[7]).withContext('August').toBe('8月');
    });

    // Pin: the adapter follows the reader from its constructor, so its effect's
    // first run finds the language and format it already has. Bites when the
    // last-key guard in follow() is dropped: the first run re-emits.
    it('emits nothing on its first run, which finds the reader it was built for (pin)', () => {
      const changes = countLocaleChanges();

      TestBed.tick();

      expect(changes.count).toBe(0);
    });

    it('writes each fixed pattern zero-padded, in English and in Japanese alike', () => {
      const expected: Record<(typeof FIXED_FORMATS)[number], string> = {
        'MM/DD/YYYY': '08/19/2026',
        'DD/MM/YYYY': '19/08/2026',
        'YYYY-MM-DD': '2026-08-19',
      };
      for (const language of ['en', 'ja'] as const) {
        for (const format of FIXED_FORMATS) {
          readAs(language, format);
          expect(shown(AUG_19)).withContext(`${format} in ${language}`).toBe(expected[format]);
        }
      }
    });

    it('tells every input to re-render exactly once when the reader changes only the format', () => {
      const changes = countLocaleChanges();

      dateFormat.set('DD/MM/YYYY');
      TestBed.tick();

      expect(changes.count).toBe(1);
      expect(shown(AUG_19)).toBe('19/08/2026');
    });

    it("keeps the calendar's own labels in the language's words under a fixed pattern", () => {
      readAs('en', 'DD/MM/YYYY');
      expect(adapter().format(AUG_19, formats().display.monthYearLabel)).withContext('the period, in English').toBe('Aug 2026');

      readAs('ja', 'DD/MM/YYYY');
      expect(adapter().format(AUG_19, formats().display.dateA11yLabel)).withContext('a day, in Japanese').toBe('2026年8月19日');
    });
  });

  describe('a date the reader types', () => {
    it('is read day first under DD/MM/YYYY', () => {
      readAs('en', 'DD/MM/YYYY');

      expect(typed('19/08/2026')).withContext('19/08/2026').toEqual(AUG_19);
      expect(typed('08/09/2026')).withContext('08/09/2026').toEqual(new Date(2026, 8, 8));
    });

    it('is the local day it names when typed as ISO, under every format', () => {
      for (const format of [DATE_FORMAT_AUTO, ...FIXED_FORMATS]) {
        readAs('en', format);
        expect(typed('2026-08-19')).withContext(format).toEqual(AUG_19);
      }
    });

    it('is an invalid date, not a guess, when it names no day in the reader\'s order', () => {
      for (const text of ['Aug 19 2026', '2', '8/19']) {
        expect(isInvalidDate(typed(text))).withContext(text).toBeTrue();
      }
    });

    it('is no date at all when the input is empty or blank, so a cleared input is not an error', () => {
      expect(typed('')).withContext("''").toBeNull();
      expect(typed('   ')).withContext("'   '").toBeNull();
    });
  });

  describe('a value handed to an input', () => {
    it('reads a date-only ISO string as its local day', () => {
      expect(adapter().deserialize('2026-08-19')).toEqual(AUG_19);
    });

    it('refuses a date-only ISO string that names no day, rather than rolling it into March', () => {
      expect(isInvalidDate(adapter().deserialize('2026-02-31'))).toBeTrue();
    });

    // Pin: an instant is not date-only and keeps Material's reading. Bites when
    // the date-only test in deserialize() is left unanchored at its end, which
    // takes the instant for a day and refuses it.
    it('reads an ISO instant as the instant it names (pin)', () => {
      expect(adapter().deserialize('2026-08-19T10:30:00Z')?.getTime()).toBe(Date.UTC(2026, 7, 19, 10, 30));
    });

    it("writes an input's bounds from the local day, not the UTC one", () => {
      expect(adapter().toIso8601(new Date(2026, 7, 1))).toBe('2026-08-01');
    });
  });

  // The picker builds the adapter inside the Angular zone, so its effect is
  // flushed there: fixture.detectChanges() does so. TestBed.tick() from the
  // spec body would enter the zone mid-tick and report NG0101.
  describe('an input it formats and reads', () => {
    function render(): { fixture: ComponentFixture<PickerHostComponent>; host: PickerHostComponent; input: HTMLInputElement } {
      const fixture = TestBed.createComponent(PickerHostComponent);
      fixture.detectChanges();
      return { fixture, host: fixture.componentInstance, input: (fixture.nativeElement as HTMLElement).querySelector('input')! };
    }

    function type(input: HTMLInputElement, text: string): void {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }

    it('hands the control local midnight for a typed ISO day', () => {
      const { host, input } = render();

      type(input, '2026-08-19');

      expect(host.date.value).toEqual(AUG_19);
    });

    it('leaves the control empty and in error for text it cannot read', () => {
      const { host, input } = render();

      type(input, 'Aug 19 2026');

      expect(host.date.value).withContext('the value').toBeNull();
      expect(host.date.hasError('matDatepickerParse')).withContext('the parse error').toBeTrue();
    });

    it('shows its date in Japanese once the reader turns to it, without a reload', () => {
      const { fixture, host, input } = render();
      host.date.setValue(AUG_19);
      expect(input.value).withContext('in English').toBe('8/19/2026');

      locale.set('ja');
      fixture.detectChanges();

      expect(input.value).withContext('in Japanese').toBe('2026/8/19');
    });
  });
});
