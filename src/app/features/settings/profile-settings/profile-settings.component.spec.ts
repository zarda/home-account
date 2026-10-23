import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, Signal, WritableSignal, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelect } from '@angular/material/select';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { ProfileSettingsComponent } from './profile-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { SecurityLogService } from '../../../core/services/security-log.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { WeeklyRecapService } from '../../../core/services/weekly-recap.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { RateSource } from '../../../models';
import { provideNoMotion } from '../../../core/services/testing';
import en from '../../../../assets/i18n/en.json';
import ja from '../../../../assets/i18n/ja.json';
import tc from '../../../../assets/i18n/tc.json';

describe('ProfileSettingsComponent', () => {
  let component: ProfileSettingsComponent;
  let fixture: ComponentFixture<ProfileSettingsComponent>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;
  let mockGeminiService: jasmine.SpyObj<GeminiService>;
  let mockAnnouncer: jasmine.SpyObj<AnnouncerService>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;
  let mockSecurityLog: jasmine.SpyObj<SecurityLogService>;
  let mockReminders: jasmine.SpyObj<ReminderService>;
  let mockRecap: { enabled: Signal<boolean> };
  let mockCurrencyService: {
    rateSource: WritableSignal<RateSource | null>;
    lastUpdated: WritableSignal<Date | null>;
  };

  const mockUser = {
    displayName: 'Test User',
    preferences: {
      baseCurrency: 'USD',
      theme: 'light' as const,
      dateFormat: 'MM/DD/YYYY',
      language: 'en'
    }
  };

  beforeEach(async () => {
    mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences', 'updateUserProfile'], {
      currentUser: signal(mockUser),
      userId: signal('user-1')
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());
    mockAuthService.updateUserProfile.and.returnValue(Promise.resolve());

    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['setLocale', 't'], {
      currentLocale: signal('en'),
      // What the translate pipe keys its memo on beside the locale: a catalog
      // switch with no locale change still reaches a translated binding.
      translationsVersion: signal(0),
      languages: [
        { code: 'en', name: 'English', nativeName: 'English' },
        { code: 'tc', name: 'Traditional Chinese', nativeName: '繁體中文' },
        { code: 'ja', name: 'Japanese', nativeName: '日本語' }
      ]
    });
    mockTranslationService.setLocale.and.returnValue(Promise.resolve());
    mockTranslationService.t.and.callFake((key: string) => key);

    mockThemeService = jasmine.createSpyObj('ThemeService', ['setTheme'], {
      currentTheme: signal('light')
    });

    mockGeminiService = jasmine.createSpyObj('GeminiService', ['reinitialize', 'isAvailable']);
    mockGeminiService.isAvailable.and.returnValue(true);

    mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    mockTransactionService = jasmine.createSpyObj('TransactionService', ['resnapshotBaseCurrency']);

    mockTransactionService.resnapshotBaseCurrency.and.returnValue(Promise.resolve(0));

    mockSecurityLog = jasmine.createSpyObj('SecurityLogService', ['watchRecent', 'record']);
    mockSecurityLog.watchRecent.and.returnValue(of([]));

    mockReminders = jasmine.createSpyObj('ReminderService', ['requestPermission', 'sweep'], {
      enabled: signal(false),
    });

    mockRecap = { enabled: signal(false) };

    // Seeded on a rung rather than at null, which renders nothing: the mount
    // test below needs the marker to actually draw a line.
    mockCurrencyService = {
      rateSource: signal<RateSource | null>('live'),
      lastUpdated: signal<Date | null>(new Date(2026, 11, 31)),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileSettingsComponent],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: AnnouncerService, useValue: mockAnnouncer },
        { provide: TransactionService, useValue: mockTransactionService },
        // Stubbed so the embedded activity list does not pull Firestore into
        // this spec; SecurityActivityComponent has its own.
        { provide: SecurityLogService, useValue: mockSecurityLog },
        // Same reason: the reminders toggle would otherwise drag
        // BudgetService and Firestore in behind it.
        { provide: ReminderService, useValue: mockReminders },
        // And the recap toggle its own two queries. The service is stubbed
        // rather than the component, so the real switch still renders here.
        { provide: WeeklyRecapService, useValue: mockRecap },
        // The rate marker under Base Currency reads CurrencyService, whose
        // real constructor walks the rate ladder and reaches fetch. These two
        // signals are its whole surface.
        { provide: CurrencyService, useValue: mockCurrencyService },
        provideNoMotion()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should mount the weekly recap opt-in beside the reminders one', () => {
    const recap: HTMLElement = fixture.nativeElement.querySelector('app-weekly-recap-settings');

    // NO_ERRORS_SCHEMA renders an unknown element as an empty tag, so the
    // switch inside it is what says the component was actually imported.
    expect(recap.querySelector('button[role="switch"]')).toBeTruthy();
  });

  it('should mount the exchange-rate marker under the currency field', () => {
    const fields: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.setting-item')
    );
    // Found by its own label rather than by position, so a reordered grid
    // fails on the marker instead of quietly checking the wrong field.
    const currencyField = fields.find(field => field.textContent?.includes('settings.currency'));

    // And as above: NO_ERRORS_SCHEMA renders an unknown element as an empty
    // tag, so the rendered line is what says the panel is really there.
    expect(currencyField?.querySelector('app-rate-status .rate-line')).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load displayName from user', () => {
      expect(component.displayName()).toBe('Test User');
    });

    it('should load baseCurrency from user preferences', () => {
      expect(component.baseCurrency).toBe('USD');
    });

    it('should load theme from user preferences', () => {
      expect(component.theme).toBe('light');
    });

    it('should load dateFormat from user preferences', () => {
      expect(component.dateFormat).toBe('MM/DD/YYYY');
    });

    it('should load language from user preferences', () => {
      expect(component.language).toBe('en');
    });

    // The same read every date reader follows, so what the select shows and
    // what the app writes are one answer, and "auto when nothing is stored"
    // is written once (#500).
    it('seeds the date format select from the shared preference', () => {
      const service = TestBed.inject(DateFormatService);
      // The signed-in user stores MM/DD/YYYY; only a read through the
      // service can answer anything else.
      spyOn(service, 'preference').and.returnValue('YYYY-MM-DD');

      const seeded = TestBed.createComponent(ProfileSettingsComponent).componentInstance;

      expect(seeded.dateFormat).toBe('YYYY-MM-DD');
    });
  });

  describe('available options', () => {
    it('should have supported currencies', () => {
      expect(component.currencies.length).toBeGreaterThan(0);
    });

    it('should have date format options', () => {
      // Automatic plus the three fixed patterns.
      expect(component.dateFormats.length).toBe(4);
      expect(component.dateFormats[0].value).toBe('auto');
    });

    // Pin: the worked examples are what the table's own writers print for
    // 31 December 2024, not a second list of strings kept beside it. Proved by
    // making one writer in FIXED_FORMATS print another order, which fails this.
    // Automatic carries its catalog key, translated where it is shown; a fixed
    // pattern's label is the pattern.
    it('prints each fixed pattern\'s example from the table the service writes with', () => {
      expect(component.dateFormats.map(f => [f.value, f.labelKey, f.label, f.example])).toEqual([
        ['auto', 'settings.dateFormatAuto', undefined, ''],
        ['MM/DD/YYYY', undefined, 'MM/DD/YYYY', '12/31/2024'],
        ['DD/MM/YYYY', undefined, 'DD/MM/YYYY', '31/12/2024'],
        ['YYYY-MM-DD', undefined, 'YYYY-MM-DD', '2024-12-31'],
      ]);
    });

    // ADR 0182: a language picked on this page relabelled Currency's options
    // but left Automatic in the language the page opened in, translated once
    // when the page was built.
    it('names the Automatic option in the language the page now shows', async () => {
      spyOn(TestBed.inject(DateFormatService), 'preference').and.returnValue('auto');
      let catalog = '';
      mockTranslationService.t.and.callFake((key: string) => `${catalog}${key}`);
      const page = TestBed.createComponent(ProfileSettingsComponent);
      page.detectChanges();
      // ngModel writes the stored value to the select a microtask later.
      await page.whenStable();
      page.detectChanges();

      const field = page.debugElement
        .queryAll(By.directive(MatSelect))
        .find(select => (select.componentInstance as MatSelect).options.some(o => o.value === 'auto'))!;
      const select = field.componentInstance as MatSelect;
      const option = () => select.options.find(o => o.value === 'auto')!.viewValue;
      const trigger = () =>
        (field.nativeElement as HTMLElement).querySelector('.mat-mdc-select-value')?.textContent?.trim();
      expect(select.value).toBe('auto');
      expect(option()).toBe('settings.dateFormatAuto');
      expect(trigger()).toBe('settings.dateFormatAuto');

      catalog = 'ja:';
      (mockTranslationService.translationsVersion as WritableSignal<number>).update(version => version + 1);
      page.detectChanges();

      expect(option()).toBe('ja:settings.dateFormatAuto');
      expect(select.triggerValue).toBe('ja:settings.dateFormatAuto');
      expect(trigger()).toBe('ja:settings.dateFormatAuto');
    });

    // Pin: `check-i18n.mjs` counts `option.labelKey | translate` as a dynamic
    // lookup and skips it, and this spec's `t()` echoes keys, so a misspelt key
    // would show itself in every language with nothing failing. Proved by
    // misspelling Automatic's key in the component, which fails each locale.
    describe('every option key resolves in every catalog', () => {
      const CATALOGS: Record<string, unknown> = { en, ja, tc };

      /** The leaf at a dotted path, or undefined when any step of the walk misses. */
      function leafAt(tree: unknown, key: string): unknown {
        return key.split('.').reduce<unknown>(
          (node, step) =>
            node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[step] : undefined,
          tree,
        );
      }

      const keys = () => component.dateFormats.flatMap(f => (f.labelKey === undefined ? [] : [f.labelKey]));

      it('walks a real list of keys', () => {
        // A guard against the walk going quiet: an empty list would pass every
        // case below vacuously.
        expect(keys().length).toBeGreaterThan(0);
      });

      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        it(`reads a non-empty string for each key in ${locale}`, () => {
          const unresolved = keys().filter(key => {
            const leaf = leafAt(catalog, key);
            return typeof leaf !== 'string' || leaf.trim() === '';
          });

          expect(unresolved)
            .withContext(`date format keys with no text in the ${locale} catalog`)
            .toEqual([]);
        });
      }
    });

    it('shows the selected pattern\'s example as the helper text', () => {
      const seen: string[] = [];
      for (const value of ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']) {
        component.dateFormat = value;
        seen.push(component.dateFormatExample);
      }

      expect(seen).toEqual(['12/31/2024', '31/12/2024', '2024-12-31']);
    });

    // Automatic has no pattern to print, so the helper text shows the
    // language's own rendering of the same worked date.
    it('shows a locale-rendered example for the automatic option', () => {
      component.dateFormat = 'auto';

      expect(component.dateFormatExample).toBe('12/31/2024');
    });

    it('should have language options', () => {
      expect(component.languages.length).toBe(3);
    });
  });

  describe('preference changes', () => {
    it('should save currency preference on change', async () => {
      component.baseCurrency = 'EUR';
      await component.onCurrencyChange();

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalled();
    });

    it('should resnapshot stored transaction amounts against the new base currency', async () => {
      component.baseCurrency = 'TWD';
      await component.onCurrencyChange();

      expect(mockTransactionService.resnapshotBaseCurrency).toHaveBeenCalledWith('TWD');
      expect(notifications.success).toHaveBeenCalledWith('settings.amountsRecalculated');
    });

    it('should notify when resnapshotting fails', async () => {
      mockTransactionService.resnapshotBaseCurrency.and.returnValue(Promise.reject(new Error('offline')));
      component.baseCurrency = 'TWD';
      await component.onCurrencyChange();

      expect(notifications.error).toHaveBeenCalledWith('settings.amountsRecalculateFailed');
    });

    it('should save theme preference on change', async () => {
      component.theme = 'dark';
      await component.onThemeChange();

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalled();
    });

    it('should save date format preference on change', async () => {
      component.dateFormat = 'DD/MM/YYYY';
      await component.onDateFormatChange();

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalled();
    });

    it('should save language preference and update locale on change', async () => {
      component.language = 'tc';
      await component.onLanguageChange();

      expect(mockTranslationService.setLocale).toHaveBeenCalledWith('tc');
      expect(mockAuthService.updateUserPreferences).toHaveBeenCalled();
    });

    it('should announce the error assertively when saving fails', async () => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('fail')));
      await component.onCurrencyChange();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
    });

    it('should not resnapshot amounts when the preference save fails', async () => {
      mockAuthService.updateUserPreferences.and.returnValue(Promise.reject(new Error('fail')));
      await component.onCurrencyChange();

      expect(mockTransactionService.resnapshotBaseCurrency).not.toHaveBeenCalled();
    });
  });

  describe('display name changes', () => {
    it('should save trimmed display name via updateUserProfile on blur', async () => {
      component.displayName.set('  New Name  ');
      await component.onDisplayNameChange();

      expect(mockAuthService.updateUserProfile).toHaveBeenCalledWith({ displayName: 'New Name' });
      expect(component.displayName()).toBe('New Name');
    });

    it('should not save when display name is unchanged', async () => {
      component.displayName.set('Test User');
      await component.onDisplayNameChange();

      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
    });

    it('should reset empty input without saving', async () => {
      component.displayName.set('   ');
      await component.onDisplayNameChange();

      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
      expect(component.displayName()).toBe('Test User');
    });

    it('should show error notification and revert when save fails', async () => {
      mockAuthService.updateUserProfile.and.returnValue(Promise.reject(new Error('fail')));
      component.displayName.set('New Name');
      await component.onDisplayNameChange();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(component.displayName()).toBe('Test User');
    });
  });
});
