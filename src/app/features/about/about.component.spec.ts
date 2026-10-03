import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Capacitor } from '@capacitor/core';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { AboutComponent } from './about.component';
import { FeedbackDialogComponent } from './feedback-dialog/feedback-dialog.component';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { FeedbackService } from '../../core/services/feedback.service';
import { OnboardingService } from '../../core/services/onboarding.service';
import { TranslationService } from '../../core/services/translation.service';
import { FeedbackEntry } from '../../models';
import {
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withTheme,
} from '../../core/services/testing';
import packageJson from '../../../../package.json';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockFeedback: jasmine.SpyObj<FeedbackService>;
  let mockOnboarding: jasmine.SpyObj<OnboardingService>;

  beforeEach(async () => {
    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    mockDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    mockFeedback = jasmine.createSpyObj<FeedbackService>('FeedbackService', [
      'watchOwn',
      'delete',
    ]);
    mockFeedback.watchOwn.and.returnValue(of([]));
    mockFeedback.delete.and.resolveTo();
    const dateFormat = jasmine.createSpyObj<DateFormatService>('DateFormatService', ['formatDate']);
    dateFormat.formatDate.and.returnValue('2026-08-15');
    mockOnboarding = jasmine.createSpyObj<OnboardingService>('OnboardingService', ['show']);

    await TestBed.configureTestingModule({
      imports: [AboutComponent, NoopAnimationsModule],
      providers: [
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: mockDialog },
        { provide: FeedbackService, useValue: mockFeedback },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: OnboardingService, useValue: mockOnboarding },
        { provide: AuthService, useValue: { userId: () => 'user-1' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutComponent);
    component = fixture.componentInstance;
  });

  it('should create with version metadata', () => {
    expect(component).toBeTruthy();
    expect(component.appVersion).toBe(packageJson.version);
    expect(component.currentYear).toBe(new Date().getFullYear());
  });

  it('derives the Built With Angular version from the installed dependency', () => {
    const expectedMajor = parseInt(
      packageJson.dependencies['@angular/core'].replace(/^[^\d]*/, ''),
      10
    );
    expect(component.angularMajorVersion).toBe(expectedMajor);
    expect(component.angularMajorVersion).toBeGreaterThanOrEqual(22);
  });

  it('shows the real launcher icon in the app info card', () => {
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.app-icon img') as HTMLImageElement;
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('src')).toBe('assets/icons/icon-128x128.png');
  });

  it('shows the donate section on web', () => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
    fixture = TestBed.createComponent(AboutComponent);
    expect(fixture.componentInstance.showDonateSection()).toBeTrue();
  });

  it('hides the donate section on native platforms', () => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    fixture = TestBed.createComponent(AboutComponent);
    expect(fixture.componentInstance.showDonateSection()).toBeFalse();
  });

  it('openDonateLink opens a configured url in a new tab', () => {
    const openSpy = spyOn(window, 'open');
    component.donationUrl = 'https://example.com/donate';
    component.openDonateLink();
    expect(openSpy).toHaveBeenCalledWith('https://example.com/donate', '_blank');
  });

  it('openDonateLink does nothing when no url is configured', () => {
    const openSpy = spyOn(window, 'open');
    component.donationUrl = '';
    component.openDonateLink();
    expect(openSpy).not.toHaveBeenCalled();
  });

  /**
   * The card is the unconditional replay path (ADR 0072 covers the
   * first-run gate itself) — no shouldShow check on this button, since a
   * user reaching for the card is deliberately asking to see it again.
   */
  describe('welcome replay card', () => {
    it('renders with its translated replay button', () => {
      fixture.detectChanges();
      const card = fixture.nativeElement.querySelector('.welcome-card');
      expect(card).toBeTruthy();
      const button = card.querySelector('.welcome-button');
      expect(button).toBeTruthy();
      expect(button.textContent).toContain('about.welcome.replayButton');
    });

    it('replays the welcome from the card button', () => {
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.welcome-button') as HTMLButtonElement).click();
      expect(mockOnboarding.show).toHaveBeenCalled();
    });
  });

  it('renders the feedback card with its open button', () => {
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.feedback-card');
    expect(card).toBeTruthy();
    expect(card.querySelector('.feedback-button')).toBeTruthy();
  });

  it('opens the feedback dialog from the card button', () => {
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.feedback-button') as HTMLButtonElement).click();
    expect(mockDialog.open).toHaveBeenCalledWith(FeedbackDialogComponent);
  });

  it('shows the empty note when nothing was sent', () => {
    fixture.detectChanges();
    const note = fixture.nativeElement.querySelector('.feedback-note');
    expect(note?.textContent).toContain('about.feedback.historyEmpty');
  });

  it('lists sent entries with their category and message', () => {
    const entry: FeedbackEntry = {
      id: 'f1',
      userId: 'user-1',
      category: 'idea',
      message: 'a widget would be nice',
      appVersion: packageJson.version,
      platform: 'web',
      locale: 'en',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    mockFeedback.watchOwn.and.returnValue(of([entry]));

    fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.feedback-item');
    expect(item).toBeTruthy();
    expect(item.querySelector('.feedback-item-category')?.textContent)
      .toContain('about.feedback.categoryIdea');
    expect(item.querySelector('.feedback-item-message')?.textContent)
      .toContain('a widget would be nice');
    expect(item.querySelector('.feedback-item-date')?.textContent).toContain('2026-08-15');
  });

  /**
   * The rules always permitted an owner delete; the list never offered one
   * (#306, ADR 0056).
   */
  describe('deleting an entry', () => {
    const entry: FeedbackEntry = {
      id: 'f1',
      userId: 'user-1',
      category: 'bug',
      message: 'the chart is upside down',
      appVersion: packageJson.version,
      platform: 'web',
      locale: 'en',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    function renderWithEntry(): void {
      mockFeedback.watchOwn.and.returnValue(of([entry]));
      fixture = TestBed.createComponent(AboutComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    }

    function answerConfirm(confirmed: boolean): void {
      mockDialog.open.and.returnValue({
        afterClosed: () => of(confirmed),
      } as ReturnType<MatDialog['open']>);
    }

    it('offers a delete control on every row', () => {
      renderWithEntry();

      const button = fixture.nativeElement.querySelector('.feedback-item-delete');
      expect(button).toBeTruthy();
      expect(button.getAttribute('aria-label')).toBe('about.feedback.deleteLabel');
    });

    it('deletes the entry once the confirm is accepted', () => {
      renderWithEntry();
      answerConfirm(true);

      (fixture.nativeElement.querySelector('.feedback-item-delete') as HTMLElement).click();

      expect(mockFeedback.delete).toHaveBeenCalledWith('f1');
    });

    it('leaves the entry alone when the confirm is cancelled', () => {
      renderWithEntry();
      answerConfirm(false);

      (fixture.nativeElement.querySelector('.feedback-item-delete') as HTMLElement).click();

      expect(mockFeedback.delete).not.toHaveBeenCalled();
    });

    // The operator was mailed a copy on create and it is not recalled, so
    // the confirm has to say so rather than read like an unsend.
    it('tells the user the sent mail is not recalled', () => {
      renderWithEntry();
      answerConfirm(false);

      (fixture.nativeElement.querySelector('.feedback-item-delete') as HTMLElement).click();

      const data = mockDialog.open.calls.mostRecent().args[1]?.data as { message: string };
      expect(data.message).toBe('about.feedback.deleteMessage');
    });
  });

  describe('colours, as painted', () => {
    const THEMES = ['light', 'dark'] as const;

    /** What `<property>: <value>` computes to under the theme on <html> now. */
    function computedAs(value: string, property = 'color'): string {
      const probe = document.createElement('span');
      probe.style.setProperty(property, value);
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).getPropertyValue(property);
      } finally {
        probe.remove();
      }
    }

    const tokenValue = (token: string, property = 'color') => computedAs(`var(${token})`, property);

    /** `node` is `token`, and reads at `floor` or better on what is painted behind it. */
    function expectPainted(node: Element | null, token: string, label: string, floor = 4.5): void {
      expect(node).withContext(label).toBeTruthy();
      if (!node) return;
      settleAnimations(document);
      expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
      expect(ratio(paintedColor(node), paintedBackground(node)))
        .withContext(`${label} on what it sits on`)
        .toBeGreaterThanOrEqual(floor);
    }

    function renderDonateCard(): HTMLElement {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
      fixture = TestBed.createComponent(AboutComponent);
      fixture.detectChanges();
      const card = (fixture.nativeElement as HTMLElement).querySelector('.donate-card') as HTMLElement;
      expect(card).withContext('the donate card').toBeTruthy();
      return card;
    }

    // The badge's glyph is held to text's 4.5 rather than a graphic's 3:1:
    // it is the card's one visual mark.
    it('paints the donate badge glyph in --text-inverse, at AA on its accent bubble, in both themes', () => {
      const card = renderDonateCard();
      const bubble = card.querySelector('.donate-icon') as HTMLElement;

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          expect(getComputedStyle(bubble).backgroundColor)
            .withContext(`${theme} bubble`)
            .toBe(tokenValue('--color-accent', 'background-color'));
          expectPainted(bubble.querySelector('mat-icon'), '--text-inverse', `${theme} donate glyph`);
        });
      }
    });

    /**
     * The painted helpers do not see a gradient, so each end of it is laid
     * under the card in turn as a flat fill, and the copy is measured on both.
     */
    it('tints the donate card from accent to primary over the card, edged in the accent, its copy at AA at both ends, in both themes', () => {
      const card = renderDonateCard();
      const ends = {
        start: 'color-mix(in srgb, var(--color-accent) 10%, var(--surface-card))',
        end: 'color-mix(in srgb, var(--color-primary) 10%, var(--surface-card))',
      };

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          const style = getComputedStyle(card);
          expect(style.backgroundImage)
            .withContext(`${theme} tint`)
            .toBe(computedAs(`linear-gradient(135deg, ${ends.start}, ${ends.end})`, 'background-image'));
          expect(style.borderTopColor)
            .withContext(`${theme} edge`)
            .toBe(computedAs('color-mix(in srgb, var(--color-accent) 20%, transparent)', 'border-top-color'));

          for (const [name, end] of Object.entries(ends)) {
            card.style.setProperty('background', end);
            try {
              const at = `${theme}, at the ${name}`;
              expectPainted(card.querySelector('.donate-title'), '--text-primary', `${at}: title`);
              expectPainted(card.querySelector('.donate-description'), '--text-secondary', `${at}: description`);
            } finally {
              card.style.removeProperty('background');
            }
          }
        });
      }
    });
  });
});
