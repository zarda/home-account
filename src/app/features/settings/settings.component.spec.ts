import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { SettingsComponent } from './settings.component';
import { AuthService } from '../../core/services/auth.service';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  const mockUser = {
    displayName: 'Test User',
    email: 'test@example.com',
    photoURL: 'https://example.com/photo.jpg'
  };

  beforeEach(async () => {
    const mockAuthService = {
      currentUser: signal(mockUser)
    };

    await TestBed.configureTestingModule({
      imports: [SettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService }
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
      expect(component.userName).toBe('Test User');
    });

    it('should display user email', () => {
      expect(component.userEmail).toBe('test@example.com');
    });

    it('should display user photo', () => {
      expect(component.userPhoto).toBe('https://example.com/photo.jpg');
    });
  });

  describe('fallback values', () => {
    beforeEach(async () => {
      const mockAuthServiceNoUser = {
        currentUser: signal(null)
      };

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [SettingsComponent, NoopAnimationsModule],
        providers: [
          { provide: AuthService, useValue: mockAuthServiceNoUser }
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
      expect(component.userName).toBe('User');
    });

    it('should fallback to empty string when no email', () => {
      expect(component.userEmail).toBe('');
    });

    it('should fallback to empty string when no photoURL', () => {
      expect(component.userPhoto).toBe('');
    });
  });
});
