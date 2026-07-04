import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';

import { SettingsComponent } from './settings.component';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let mockAuthService: { currentUser: ReturnType<typeof signal>; signOut: jasmine.Spy };
  let mockDialog: jasmine.SpyObj<MatDialog>;

  const mockUser = {
    displayName: 'Test User',
    email: 'test@example.com',
    photoURL: 'https://example.com/photo.jpg'
  };

  const mockTranslationService = { t: (key: string) => key };

  beforeEach(async () => {
    mockAuthService = {
      currentUser: signal(mockUser),
      signOut: jasmine.createSpy('signOut').and.resolveTo(undefined)
    };
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [SettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: TranslationService, useValue: mockTranslationService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(SettingsComponent, {
        set: {
          imports: [],
          template: '<div></div>'
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('user info', () => {
    it('should display user name', () => {
      expect(component.userName()).toBe('Test User');
    });

    it('should display user email', () => {
      expect(component.userEmail()).toBe('test@example.com');
    });

    it('should display user photo', () => {
      expect(component.userPhoto()).toBe('https://example.com/photo.jpg');
    });
  });

  describe('signOut', () => {
    it('should open a confirm dialog', () => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

      component.signOut();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should sign out when confirmed', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.signOut();
      tick();

      expect(mockAuthService.signOut).toHaveBeenCalled();
    }));
  });

  describe('fallback values', () => {
    beforeEach(async () => {
      const mockAuthServiceNoUser = {
        currentUser: signal(null),
        signOut: jasmine.createSpy('signOut').and.resolveTo(undefined)
      };

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [SettingsComponent, NoopAnimationsModule],
        providers: [
          { provide: AuthService, useValue: mockAuthServiceNoUser },
          { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
          { provide: TranslationService, useValue: mockTranslationService }
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(SettingsComponent, {
          set: {
            imports: [],
            template: '<div></div>'
          }
        })
        .compileComponents();

      fixture = TestBed.createComponent(SettingsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should fallback to User when no displayName', () => {
      expect(component.userName()).toBe('User');
    });

    it('should fallback to empty string when no email', () => {
      expect(component.userEmail()).toBe('');
    });

    it('should fallback to empty string when no photoURL', () => {
      expect(component.userPhoto()).toBe('');
    });
  });
});
