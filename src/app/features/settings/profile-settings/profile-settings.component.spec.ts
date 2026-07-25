import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { ProfileSettingsComponent } from './profile-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { SecurityLogService } from '../../../core/services/security-log.service';

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

    await TestBed.configureTestingModule({
      imports: [ProfileSettingsComponent, NoopAnimationsModule],
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
        { provide: SecurityLogService, useValue: mockSecurityLog }
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

  describe('initialization', () => {
    it('should load displayName from user', () => {
      expect(component.displayName).toBe('Test User');
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
  });

  describe('available options', () => {
    it('should have supported currencies', () => {
      expect(component.currencies.length).toBeGreaterThan(0);
    });

    it('should have date format options', () => {
      expect(component.dateFormats.length).toBe(3);
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
      component.displayName = '  New Name  ';
      await component.onDisplayNameChange();

      expect(mockAuthService.updateUserProfile).toHaveBeenCalledWith({ displayName: 'New Name' });
      expect(component.displayName).toBe('New Name');
    });

    it('should not save when display name is unchanged', async () => {
      component.displayName = 'Test User';
      await component.onDisplayNameChange();

      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
    });

    it('should reset empty input without saving', async () => {
      component.displayName = '   ';
      await component.onDisplayNameChange();

      expect(mockAuthService.updateUserProfile).not.toHaveBeenCalled();
      expect(component.displayName).toBe('Test User');
    });

    it('should show error notification and revert when save fails', async () => {
      mockAuthService.updateUserProfile.and.returnValue(Promise.reject(new Error('fail')));
      component.displayName = 'New Name';
      await component.onDisplayNameChange();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(component.displayName).toBe('Test User');
    });
  });
});
