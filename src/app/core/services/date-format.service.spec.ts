import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { DateFormatService } from './date-format.service';
import { AuthService } from './auth.service';
import { TranslationService } from './translation.service';

describe('DateFormatService', () => {
  let service: DateFormatService;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  beforeEach(() => {
    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({
        preferences: { baseCurrency: 'USD', theme: 'light', language: 'en', dateFormat: 'MM/DD/YYYY' }
      })
    });

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    mockTranslationService.t.and.callFake((key: string) => {
      const translations: Record<string, string> = {
        'dates.today': 'Today',
        'dates.yesterday': 'Yesterday',
        'days.sunday': 'Sun',
        'days.monday': 'Mon',
        'days.tuesday': 'Tue',
        'days.wednesday': 'Wed',
        'days.thursday': 'Thu',
        'days.friday': 'Fri',
        'days.saturday': 'Sat'
      };
      return translations[key] || key;
    });
    mockTranslationService.getIntlLocale.and.returnValue('en-US');

    TestBed.configureTestingModule({
      providers: [
        DateFormatService,
        { provide: AuthService, useValue: mockAuthService },
        { provide: TranslationService, useValue: mockTranslationService }
      ]
    });
    service = TestBed.inject(DateFormatService);
  });

  // A fresh service over a signed-in user holding this stored format. The
  // locale is read per call, so a spec switches language on the mock.
  function withDateFormat(dateFormat: string): DateFormatService {
    return withUser({ preferences: { dateFormat } });
  }

  function withUser(user: unknown): DateFormatService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DateFormatService,
        { provide: AuthService, useValue: { currentUser: signal(user) } },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    });
    return TestBed.inject(DateFormatService);
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('formatDate', () => {
    it('should format a Date object', () => {
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      const result = service.formatDate(date);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should format a Firestore Timestamp', () => {
      const date = new Date(2024, 5, 20); // Jun 20, 2024
      const timestamp = {
        toDate: () => date,
        seconds: Math.floor(date.getTime() / 1000),
        nanoseconds: 0
      } as Timestamp;

      const result = service.formatDate(timestamp);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    // The three fixed patterns are a deliberate choice and must survive; only
    // 'auto' — the default for new accounts — follows the language (#84).
    describe('against the stored preference', () => {
      const day = new Date(2024, 0, 15);

      it('keeps an explicitly stored pattern', () => {
        expect(withDateFormat('MM/DD/YYYY').formatDate(day)).toBe('01/15/2024');
        expect(withDateFormat('DD/MM/YYYY').formatDate(day)).toBe('15/01/2024');
        expect(withDateFormat('YYYY-MM-DD').formatDate(day)).toBe('2024-01-15');
      });

      // Pin: the numeric patterns zero-pad a single-digit day and month; they
      // were padded by hand before they were split from `dayKey`.
      it('zero-pads a single-digit day and month in the numeric patterns', () => {
        const fifth = new Date(2026, 0, 5);

        expect(withDateFormat('DD/MM/YYYY').formatDate(fifth)).toBe('05/01/2026');
        expect(withDateFormat('MM/DD/YYYY').formatDate(fifth)).toBe('01/05/2026');
      });

      it('follows the active language on auto', () => {
        mockTranslationService.getIntlLocale.and.returnValue('ja-JP');

        expect(withDateFormat('auto').formatDate(day)).toBe(
          new Intl.DateTimeFormat('ja-JP', {
            year: 'numeric', month: 'numeric', day: 'numeric',
          }).format(day));
      });

      // An account with nothing stored is a new one, and new accounts default
      // to auto rather than to the old en-US pattern.
      it('treats an unset preference as auto', () => {
        mockTranslationService.getIntlLocale.and.returnValue('ja-JP');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            DateFormatService,
            { provide: AuthService, useValue: { currentUser: signal({ preferences: {} }) } },
            { provide: TranslationService, useValue: mockTranslationService },
          ],
        });

        expect(TestBed.inject(DateFormatService).formatDate(day)).toBe(
          new Intl.DateTimeFormat('ja-JP', {
            year: 'numeric', month: 'numeric', day: 'numeric',
          }).format(day));
      });
    });
  });

  // The one read of what the user stored. The profile select seeds from it and
  // whatever must follow the setting reads it, so "auto when absent" is
  // written once (#500).
  describe('preference', () => {
    it('is the stored format', () => {
      expect(withDateFormat('DD/MM/YYYY').preference()).toBe('DD/MM/YYYY');
      expect(withDateFormat('YYYY-MM-DD').preference()).toBe('YYYY-MM-DD');
    });

    it('is auto when nothing is stored', () => {
      expect(withUser({ preferences: {} }).preference()).toBe('auto');
      expect(withUser({}).preference()).toBe('auto');
      expect(withDateFormat('').preference()).toBe('auto');
    });

    it('is auto when nobody is signed in', () => {
      expect(withUser(null).preference()).toBe('auto');
    });

    it('follows the signed-in user\'s stored format', () => {
      const user = signal<unknown>({ preferences: { dateFormat: 'DD/MM/YYYY' } });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          DateFormatService,
          { provide: AuthService, useValue: { currentUser: user } },
          { provide: TranslationService, useValue: mockTranslationService },
        ],
      });
      const live = TestBed.inject(DateFormatService);
      const seen = [live.preference()];

      user.set({ preferences: { dateFormat: 'YYYY-MM-DD' } });
      seen.push(live.preference());
      user.set({ preferences: {} });
      seen.push(live.preference());

      expect(seen).toEqual(['DD/MM/YYYY', 'YYYY-MM-DD', 'auto']);
    });
  });

  describe('fieldOrder', () => {
    it('names the order each fixed format writes its fields in', () => {
      expect(withDateFormat('MM/DD/YYYY').fieldOrder()).toBe('mdy');
      expect(withDateFormat('DD/MM/YYYY').fieldOrder()).toBe('dmy');
      expect(withDateFormat('YYYY-MM-DD').fieldOrder()).toBe('ymd');
    });

    it('follows the chosen language on auto', () => {
      const auto = withDateFormat('auto');

      mockTranslationService.getIntlLocale.and.returnValue('en-US');
      expect(auto.fieldOrder()).toBe('mdy');
      mockTranslationService.getIntlLocale.and.returnValue('ja-JP');
      expect(auto.fieldOrder()).toBe('ymd');
      mockTranslationService.getIntlLocale.and.returnValue('zh-Hant-TW');
      expect(auto.fieldOrder()).toBe('ymd');
    });

    it('does not let a fixed format follow the language', () => {
      mockTranslationService.getIntlLocale.and.returnValue('ja-JP');

      expect(withDateFormat('MM/DD/YYYY').fieldOrder()).toBe('mdy');
    });
  });

  describe('parseDate', () => {
    const aug9 = new Date(2026, 7, 9).getTime();
    const sep8 = new Date(2026, 8, 8).getTime();

    function read(service: DateFormatService, text: string): number | null {
      return service.parseDate(text)?.getTime() ?? null;
    }

    it('reads the digits in the order the stored format names', () => {
      expect(read(withDateFormat('MM/DD/YYYY'), '08/09/2026')).toBe(aug9);
      expect(read(withDateFormat('DD/MM/YYYY'), '08/09/2026')).toBe(sep8);
      expect(read(withDateFormat('YYYY-MM-DD'), '2026-08-09')).toBe(aug9);
    });

    it('reads the digits in the order of the chosen language on auto', () => {
      const auto = withDateFormat('auto');

      mockTranslationService.getIntlLocale.and.returnValue('en-US');
      expect(read(auto, '8/9/2026')).toBe(aug9);
      mockTranslationService.getIntlLocale.and.returnValue('ja-JP');
      expect(read(auto, '2026/8/9')).toBe(aug9);
      expect(read(auto, '2026年8月9日')).toBe(aug9);
    });

    it('is null for text that is no date in that order', () => {
      expect(withDateFormat('MM/DD/YYYY').parseDate('Aug 9 2026')).toBeNull();
      expect(withDateFormat('MM/DD/YYYY').parseDate('')).toBeNull();
      expect(withDateFormat('DD/MM/YYYY').parseDate('8/19/2026')).toBeNull();
      expect(withDateFormat('MM/DD/YYYY').parseDate('2/31/2026')).toBeNull();
    });

    // Every stored value is a string the account document held, so one that
    // names an Object.prototype member must not be looked up as a format.
    it('reads a stored name that is an Object.prototype member as auto', () => {
      const day = new Date(2026, 7, 9);
      const autoText = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: 'numeric', day: 'numeric',
      }).format(day);

      for (const stored of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
        const service = withDateFormat(stored);

        expect(service.formatDate(day)).withContext(`${stored} formats`).toBe(autoText);
        expect(read(service, autoText)).withContext(`${stored} parses`).toBe(aug9);
        expect(service.fieldOrder()).withContext(`${stored} order`).toBe('mdy');
      }
    });

    // A reader who is shown a date and types it back must get the same day:
    // the writer and the reader are two directions over one table.
    describe('round trip', () => {
      const days = [
        new Date(2026, 7, 9),
        new Date(2026, 7, 19),
        new Date(2026, 0, 5),
        new Date(2026, 11, 31),
        new Date(2028, 1, 29),
      ];
      const cases: { name: string; stored: string; locale: string }[] = [
        { name: 'MM/DD/YYYY', stored: 'MM/DD/YYYY', locale: 'en-US' },
        { name: 'DD/MM/YYYY', stored: 'DD/MM/YYYY', locale: 'en-US' },
        { name: 'YYYY-MM-DD', stored: 'YYYY-MM-DD', locale: 'en-US' },
        { name: 'auto in en', stored: 'auto', locale: 'en-US' },
        { name: 'auto in ja', stored: 'auto', locale: 'ja-JP' },
        { name: 'auto in tc', stored: 'auto', locale: 'zh-Hant-TW' },
      ];

      for (const { name, stored, locale } of cases) {
        it(`reads back what ${name} wrote`, () => {
          mockTranslationService.getIntlLocale.and.returnValue(locale);
          const service = withDateFormat(stored);

          for (const day of days) {
            const written = service.formatDate(day);

            expect(read(service, written)).withContext(written).toBe(day.getTime());
          }
        });
      }
    });
  });

  describe('formatRelativeDate', () => {
    it('should return "Today" for today\'s date', () => {
      const today = new Date();
      const result = service.formatRelativeDate(today);
      expect(result).toBe('Today');
    });

    it('should return "Yesterday" for yesterday\'s date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = service.formatRelativeDate(yesterday);
      expect(result).toBe('Yesterday');
    });

    it('should return weekday for dates within the last 7 days', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const result = service.formatRelativeDate(threeDaysAgo);
      // Should be a short weekday like "Mon", "Tue", etc.
      expect(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).toContain(result);
    });

    it('should return short date for older dates', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);
      const result = service.formatRelativeDate(oldDate);
      // Should be in format like "Dec 1" or "Nov 30"
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    });

    it('should handle Firestore Timestamp for today', () => {
      const today = new Date();
      const timestamp = {
        toDate: () => today,
        seconds: Math.floor(today.getTime() / 1000),
        nanoseconds: 0
      } as Timestamp;

      const result = service.formatRelativeDate(timestamp);
      expect(result).toBe('Today');
    });

    it('should handle Firestore Timestamp for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const timestamp = {
        toDate: () => yesterday,
        seconds: Math.floor(yesterday.getTime() / 1000),
        nanoseconds: 0
      } as Timestamp;

      const result = service.formatRelativeDate(timestamp);
      expect(result).toBe('Yesterday');
    });
  });
});
