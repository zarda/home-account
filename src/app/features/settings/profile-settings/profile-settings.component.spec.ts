import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ProfileSettingsComponent } from './profile-settings.component';
import { AuthService } from '../../../core/services/auth.service';

describe('ProfileSettingsComponent', () => {
  let component: ProfileSettingsComponent;
  let fixture: ComponentFixture<ProfileSettingsComponent>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;

  const mockUser = {
    preferences: {
      baseCurrency: 'USD',
      theme: 'light' as const,
      dateFormat: 'MM/DD/YYYY',
      language: 'en'
    }
  };

  beforeEach(async () => {
    mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences'], {
      currentUser: signal(mockUser)
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());

    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [ProfileSettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatSnackBar, useValue: mockSnackBar }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
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

    it('should not be saving initially', () => {
      expect(component.isSaving()).toBeFalse();
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

  describe('savePreferences', () => {
    it('should call updateUserPreferences with form values', async () => {
      component.baseCurrency = 'EUR';
      component.theme = 'dark';
      component.dateFormat = 'DD/MM/YYYY';
      component.language = 'zh-Hant';

      await component.savePreferences();

      expect(mockAuthService.updateUserPreferences).toHaveBeenCalledWith({
        baseCurrency: 'EUR',
        theme: 'dark',
        dateFormat: 'DD/MM/YYYY',
        language: 'zh-Hant'
      });
    });

    it('should set isSaving to true when saving', () => {
      component.savePreferences();
      expect(component.isSaving()).toBeTrue();
    });
  });
});
