import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { signal } from '@angular/core';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { By } from '@angular/platform-browser';
import { RouterLink, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';

import { SettingsComponent } from './settings.component';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

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

  // The real template, with only the child feature components left unresolved,
  // so the sections the page actually offers can be asserted.
  describe('sections', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [SettingsComponent, NoopAnimationsModule],
        providers: [
          provideRouter([]),
          { provide: AuthService, useValue: mockAuthService },
          { provide: MatDialog, useValue: mockDialog },
          { provide: TranslationService, useValue: mockTranslationService }
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(SettingsComponent, {
          set: {
            imports: [
              CommonModule,
              MatButtonModule,
              MatExpansionModule,
              MatIconModule,
              PageHeaderComponent,
              RouterLink,
              TranslatePipe
            ],
            // A standalone component's template is governed by its own schemas,
            // not the TestBed's, so the child feature elements need excusing here.
            schemas: [NO_ERRORS_SCHEMA]
          }
        })
        .compileComponents();

      fixture = TestBed.createComponent(SettingsComponent);
      fixture.detectChanges();
    });

    // Panel titles carry their icon's ligature text, so match on substring.
    const panelTitles = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('mat-panel-title')).map(el =>
        (el as HTMLElement).textContent?.trim() ?? ''
      );

    // The link cards are divs, not anchors, so routerLink leaves no href.
    // The template writes it as a static attribute, which DebugElement keeps.
    const linkCard = (route: string): HTMLElement | undefined =>
      fixture.debugElement
        .queryAll(By.css('.settings-link-card'))
        .find(el => el.attributes['routerLink'] === route)?.nativeElement;

    it('no longer hosts data management itself', () => {
      expect(fixture.nativeElement.querySelector('app-data-management')).toBeNull();
      expect(panelTitles().some(title => title.includes('data.title'))).toBe(false);
    });

    it('points at the data hub instead', () => {
      const dataCard = linkCard('/data');

      expect(dataCard).withContext('a link card routing to /data').toBeTruthy();
      expect(dataCard?.textContent).toContain('data.title');
    });

    it('keeps preferences and categories in the accordion', () => {
      expect(panelTitles().some(title => title.includes('settings.preferences'))).toBe(true);
      expect(panelTitles().some(title => title.includes('settings.categories'))).toBe(true);
    });
  });
});
