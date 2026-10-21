import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { MatDatepicker, MatDatepickerInput, MatDatepickerIntl, MatDatepickerToggle } from '@angular/material/datepicker';

import { provideAppDatepicker } from '../config/datepicker.config';
import { User } from '../../models';
import { AppDatepickerIntl } from './app-datepicker-intl';
import { AppDirectionality } from './app-directionality';
import { AuthService } from './auth.service';
import { SupportedLocale, TranslationService } from './translation.service';
import { createMockUser, provideNoMotion } from './testing';
import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';

const CATALOGS: Record<SupportedLocale, object> = { en, ja, tc };

/** What a reader of each language is shown, label by label, and the two ranges for a page of years. */
interface Labels {
  openCalendarLabel: string;
  closeCalendarLabel: string;
  prevMonthLabel: string;
  nextMonthLabel: string;
  prevYearLabel: string;
  nextYearLabel: string;
  prevMultiYearLabel: string;
  nextMultiYearLabel: string;
  switchToMonthViewLabel: string;
  switchToMultiYearViewLabel: string;
  comparisonDateLabel: string;
  /** The first and last year of a page as the adapter names them in that language. */
  years: [string, string];
  yearRange: string;
  yearRangeLabel: string;
}

const LABELS: Record<SupportedLocale, Labels> = {
  en: {
    openCalendarLabel: 'Open calendar',
    closeCalendarLabel: 'Close calendar',
    prevMonthLabel: 'Previous month',
    nextMonthLabel: 'Next month',
    prevYearLabel: 'Previous year',
    nextYearLabel: 'Next year',
    prevMultiYearLabel: 'Previous 24 years',
    nextMultiYearLabel: 'Next 24 years',
    switchToMonthViewLabel: 'Choose date',
    switchToMultiYearViewLabel: 'Choose month and year',
    comparisonDateLabel: 'Comparison range',
    years: ['2016', '2039'],
    yearRange: '2016 – 2039',
    yearRangeLabel: '2016 to 2039',
  },
  ja: {
    openCalendarLabel: 'カレンダーを開く',
    closeCalendarLabel: 'カレンダーを閉じる',
    prevMonthLabel: '前の月',
    nextMonthLabel: '次の月',
    prevYearLabel: '前の年',
    nextYearLabel: '次の年',
    prevMultiYearLabel: '前の24年',
    nextMultiYearLabel: '次の24年',
    switchToMonthViewLabel: '日付を選択',
    switchToMultiYearViewLabel: '年と月を選択',
    comparisonDateLabel: '比較期間',
    years: ['2016年', '2039年'],
    yearRange: '2016年〜2039年',
    yearRangeLabel: '2016年から2039年まで',
  },
  tc: {
    openCalendarLabel: '開啟日曆',
    closeCalendarLabel: '關閉日曆',
    prevMonthLabel: '上個月',
    nextMonthLabel: '下個月',
    prevYearLabel: '上一年',
    nextYearLabel: '下一年',
    prevMultiYearLabel: '前 24 年',
    nextMultiYearLabel: '後 24 年',
    switchToMonthViewLabel: '選擇日期',
    switchToMultiYearViewLabel: '選擇年份和月份',
    comparisonDateLabel: '比較期間',
    years: ['2016年', '2039年'],
    yearRange: '2016年 至 2039年',
    yearRangeLabel: '2016年 至 2039年',
  },
};

const LABEL_FIELDS = [
  'openCalendarLabel',
  'closeCalendarLabel',
  'prevMonthLabel',
  'nextMonthLabel',
  'prevYearLabel',
  'nextYearLabel',
  'prevMultiYearLabel',
  'nextMultiYearLabel',
  'switchToMonthViewLabel',
  'switchToMultiYearViewLabel',
  'comparisonDateLabel',
] as const;

/** 19 August 2026: the month the open calendar starts on. */
const AUG_19 = new Date(2026, 7, 19);

@Component({
  selector: 'app-intl-host',
  template: `
    <input [matDatepicker]="picker" />
    <mat-datepicker-toggle [for]="picker" />
    <mat-datepicker #picker [startAt]="startAt" />
  `,
  imports: [MatDatepicker, MatDatepickerInput, MatDatepickerToggle],
})
class IntlHostComponent {
  readonly picker = viewChild.required<MatDatepicker<Date>>('picker');
  readonly startAt = AUG_19;
}

/**
 * The real catalogs, read by the real TranslationService, through the app's
 * own datepicker providers: the labels asserted here are the words a reader
 * sees. Only the signed-in account is a stub, since the adapter reads its
 * stored date format through AuthService.
 */
describe('AppDatepickerIntl', () => {
  let http: HttpTestingController;
  let lang: string;

  /** The reader turns to `locale`, and its catalog arrives. */
  async function speak(locale: SupportedLocale): Promise<void> {
    const loaded = TestBed.inject(TranslationService).setLocale(locale);
    http.expectOne(`/assets/i18n/${locale}.json`).flush(CATALOGS[locale]);
    await loaded;
  }

  const intl = (): MatDatepickerIntl => TestBed.inject(MatDatepickerIntl);

  beforeEach(async () => {
    lang = document.documentElement.lang;
    TestBed.configureTestingModule({
      providers: [
        provideAppDatepicker(),
        { provide: AuthService, useValue: { currentUser: signal<User | null>(createMockUser()) } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoMotion(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // A locale switch writes `dir` through AppDirectionality; the spy keeps
    // it off the page Karma runs in. The `lang` it writes is put back below.
    spyOn(TestBed.inject(AppDirectionality), 'setDirection');
    await speak('en');
  });

  afterEach(() => {
    http.verify();
    document.documentElement.lang = lang;
  });

  function expectLabels(labels: MatDatepickerIntl, locale: SupportedLocale): void {
    const expected = LABELS[locale];
    for (const field of LABEL_FIELDS) {
      expect(labels[field]).withContext(`${field} in ${locale}`).toBe(expected[field]);
    }
    expect(labels.formatYearRange(...expected.years)).withContext(`the year range in ${locale}`).toBe(expected.yearRange);
    expect(labels.formatYearRangeLabel(...expected.years))
      .withContext(`the year range's spoken label in ${locale}`)
      .toBe(expected.yearRangeLabel);
  }

  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`names every button and both year ranges in the language of a reader of ${locale}`, async () => {
      await speak(locale);

      expect(intl()).withContext('the root intl').toBeInstanceOf(AppDatepickerIntl);
      expectLabels(intl(), locale);
    });
  }

  it('relabels in the language the reader has turned to', async () => {
    const labels = TestBed.inject(AppDatepickerIntl);
    expect(labels.openCalendarLabel).withContext('before the switch').toBe(LABELS.en.openCalendarLabel);

    await speak('ja');
    labels.relabel();

    expectLabels(labels, 'ja');
  });

  it("relabels on the adapter's change of language, then tells every picker, in that order", async () => {
    const labels = TestBed.inject(AppDatepickerIntl);
    const relabel = spyOn(labels, 'relabel').and.callThrough();
    const told = spyOn(labels.changes, 'next').and.callThrough();

    await speak('ja');
    TestBed.tick();

    expect(relabel).withContext('relabel').toHaveBeenCalledTimes(1);
    expect(told).withContext('changes.next').toHaveBeenCalledTimes(1);
    expect(relabel).toHaveBeenCalledBefore(told);
    expect(labels.prevMonthLabel).withContext('the labels the pickers are told about').toBe(LABELS.ja.prevMonthLabel);
  });

  // The calendar is a CDK overlay outside the fixture. The picker builds the
  // adapter inside the Angular zone, so fixture.detectChanges() flushes the
  // adapter's effect there; TestBed.tick() from the spec body would enter
  // the zone mid-tick and report NG0101.
  describe('a rendered picker', () => {
    let fixture: ComponentFixture<IntlHostComponent>;

    beforeEach(() => {
      fixture = TestBed.createComponent(IntlHostComponent);
      fixture.detectChanges();
    });

    afterEach(() => {
      fixture.componentInstance.picker().close();
      fixture.destroy();
      document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
    });

    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const toggleName = (): string | null | undefined =>
      host().querySelector('mat-datepicker-toggle button')?.getAttribute('aria-label');
    const previousName = (): string | null | undefined =>
      document.querySelector('.mat-calendar-previous-button')?.getAttribute('aria-label');
    // The period button's own text, not the ripple and focus spans Material
    // puts beside it.
    const period = (): string | undefined =>
      document.querySelector('.mat-calendar-period-button span[aria-hidden="true"]')?.textContent?.trim();
    const weekdays = (): string[] =>
      Array.from(document.querySelectorAll('.mat-calendar-table-header th span[aria-hidden="true"]')).map(
        day => day.textContent?.trim() ?? '',
      );

    it('names its toggle and its open calendar in the language the reader turns to, without a reload', async () => {
      fixture.componentInstance.picker().open();
      fixture.detectChanges();

      expect(toggleName()).withContext('the toggle, in English').toBe('Open calendar');
      expect(previousName()).withContext('the previous button, in English').toBe('Previous month');
      expect(period()).withContext('the period, in English').toBe('AUG 2026');
      expect(weekdays()).withContext('the weekdays, in English').toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);

      await speak('ja');
      fixture.detectChanges();

      expect(toggleName()).withContext('the toggle, in Japanese').toBe(LABELS.ja.openCalendarLabel);
      expect(previousName()).withContext('the previous button, in Japanese').toBe(LABELS.ja.prevMonthLabel);
      expect(period()).withContext('the period, in Japanese').toBe('2026年8月');
      expect(weekdays()).withContext('the weekdays, in Japanese').toEqual(['日', '月', '火', '水', '木', '金', '土']);
    });

    // Pin: no picker component provides its own labels, so a picker on a
    // page reads the root's. Bites when the host's imports bring a module
    // that provides MatDatepickerIntl.
    it("reads the root's labels (pin)", () => {
      const toggle = fixture.debugElement.query(By.directive(MatDatepickerToggle));

      expect(toggle.injector.get(MatDatepickerIntl)).toBe(intl());
    });
  });
});
