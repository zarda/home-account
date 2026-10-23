import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { MatStepperIntl } from '@angular/material/stepper';

import { provideAppDatepicker } from '../config/datepicker.config';
import { User } from '../../models';
import { AppDatepickerIntl } from './app-datepicker-intl';
import { AppDirectionality } from './app-directionality';
import { APP_STEPPER_INTL_PROVIDER, AppStepperIntl } from './app-material-intl';
import { AuthService } from './auth.service';
import { SupportedLocale, TranslationService } from './translation.service';
import { createMockUser } from './testing';
import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';

const CATALOGS: Record<SupportedLocale, object> = { en, ja, tc };

/** What a reader of each language hears for a finished step, an editable one and an optional one. */
const STEPPER_LABELS: Record<SupportedLocale, { completedLabel: string; editableLabel: string; optionalLabel: string }> = {
  en: { completedLabel: 'Completed', editableLabel: 'Editable', optionalLabel: 'Optional' },
  ja: { completedLabel: '完了', editableLabel: '編集可能', optionalLabel: '任意' },
  tc: { completedLabel: '已完成', editableLabel: '可編輯', optionalLabel: '選填' },
};

/**
 * The Material classes whose words the app owns. `unchanged` names the fields
 * nothing in this version's templates reads, which keep Material's defaults;
 * `reads` is a sample of the rest, so a walk over no fields at all cannot pass.
 */
interface IntlCase {
  name: string;
  /**
   * True when the app already owned these words before #500, so the case pins
   * them rather than proving a fix.
   */
  pin: boolean;
  token: Type<object>;
  app: Type<object>;
  unchanged: string[];
  reads: string[];
}

const INTLS: IntlCase[] = [
  {
    name: 'MatDatepickerIntl',
    pin: true,
    token: MatDatepickerIntl,
    app: AppDatepickerIntl,
    unchanged: ['calendarLabel', 'startDateLabel', 'endDateLabel'],
    reads: ['openCalendarLabel', 'prevMonthLabel', 'comparisonDateLabel'],
  },
  {
    name: 'MatStepperIntl',
    pin: false,
    token: MatStepperIntl,
    app: AppStepperIntl,
    unchanged: [],
    reads: ['completedLabel', 'editableLabel', 'optionalLabel'],
  },
];

/**
 * The real catalogs, read by the real TranslationService, through the app's
 * own providers for Material's words. `appConfig.providers` is never used
 * here: its initializers start Firebase (app.config.spec.ts). Only the
 * signed-in account is a stub, since the datepicker's adapter reads the
 * stored date format through AuthService.
 */
describe('the Material intl classes the app provides', () => {
  let http: HttpTestingController;
  let lang: string;

  /** The reader turns to `locale`, and its catalog arrives. */
  async function speak(locale: SupportedLocale): Promise<void> {
    const loaded = TestBed.inject(TranslationService).setLocale(locale);
    http.expectOne(`/assets/i18n/${locale}.json`).flush(CATALOGS[locale]);
    await loaded;
  }

  beforeEach(() => {
    lang = document.documentElement.lang;
    TestBed.configureTestingModule({
      providers: [
        provideAppDatepicker(),
        APP_STEPPER_INTL_PROVIDER,
        { provide: AuthService, useValue: { currentUser: signal<User | null>(createMockUser()) } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // A locale switch writes `dir` through AppDirectionality; the spy keeps it
    // off the page Karma runs in. The `lang` it writes is put back below.
    spyOn(TestBed.inject(AppDirectionality), 'setDirection');
  });

  afterEach(() => {
    http.verify();
    document.documentElement.lang = lang;
  });

  // The datepicker's words were the app's before #500, so its case is a pin: a
  // Material upgrade that adds an own string field leaves it in English for a
  // reader of another language, and this is the case that says so. The
  // stepper's case proves #500's fix.
  for (const intl of INTLS) {
    it(`reads every own string field of ${intl.name} in the reader's language, bar the ones nothing reads${intl.pin ? ' (pin)' : ''}`, async () => {
      await speak('ja');

      const defaults = new intl.token() as Record<string, unknown>;
      const provided = TestBed.inject(intl.token) as Record<string, unknown>;
      const fields = Object.keys(defaults).filter(key => typeof defaults[key] === 'string');

      expect(provided).withContext('the root intl').toBeInstanceOf(intl.app);
      expect(fields).withContext('the string fields Material declares').toEqual(jasmine.arrayContaining(intl.reads));
      expect(fields).withContext('the fields kept as Material has them').toEqual(jasmine.arrayContaining(intl.unchanged));
      for (const field of fields) {
        if (intl.unchanged.includes(field)) {
          expect(provided[field]).withContext(`${field}, which no template reads`).toBe(defaults[field]);
        } else {
          expect(provided[field]).withContext(`${field}, in Japanese`).not.toBe(defaults[field]);
        }
      }
    });
  }

  describe('AppStepperIntl', () => {
    for (const locale of ['en', 'ja', 'tc'] as const) {
      it(`names a finished, an editable and an optional step in the language of a reader of ${locale}`, async () => {
        await speak(locale);

        const labels = TestBed.inject(MatStepperIntl);

        expect(labels).withContext('the root intl').toBeInstanceOf(AppStepperIntl);
        expect({
          completedLabel: labels.completedLabel,
          editableLabel: labels.editableLabel,
          optionalLabel: labels.optionalLabel,
        }).toEqual(STEPPER_LABELS[locale]);
      });
    }

    it('relabels when the reader turns to another language, then tells every header, in that order', async () => {
      await speak('en');
      const labels = TestBed.inject(AppStepperIntl);
      // The effect's first run, before the switch this case watches.
      TestBed.tick();
      const relabel = spyOn(labels, 'relabel').and.callThrough();
      const told = spyOn(labels.changes, 'next').and.callThrough();

      await speak('ja');
      TestBed.tick();

      expect(relabel).withContext('relabel').toHaveBeenCalledTimes(1);
      expect(told).withContext('changes.next').toHaveBeenCalledTimes(1);
      expect(relabel).toHaveBeenCalledBefore(told);
      expect(labels.editableLabel).withContext('the labels the headers are told about').toBe(STEPPER_LABELS.ja.editableLabel);
    });

    it('relabels when the same language is loaded again, which only the catalog version tells apart', async () => {
      await speak('ja');
      const labels = TestBed.inject(AppStepperIntl);
      TestBed.tick();
      const told = spyOn(labels.changes, 'next').and.callThrough();

      await speak('ja');
      TestBed.tick();

      expect(told).toHaveBeenCalledTimes(1);
    });
  });
});
