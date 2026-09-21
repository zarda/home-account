import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, WritableSignal, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { ProfileSettingsComponent } from './profile-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService, SupportedLocale } from '../../../core/services/translation.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { SecurityLogService } from '../../../core/services/security-log.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { WeeklyRecapService } from '../../../core/services/weekly-recap.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { RateSource } from '../../../models';

/**
 * The theme toggle at the Extra large font scale on a phone.
 *
 * Reproduces the account font scale the same way AccessibilityService does
 * (`--app-font-scale` on the document root, read by the global `html` rule
 * in styles.scss — see accessibility.service.ts) rather than forcing a
 * font-size locally, so the probe is wrong in exactly the ways the app would
 * be wrong.
 *
 * The two group widths are the same two device viewports the defect was
 * measured on, translated into the group's own clientWidth: 320 is the
 * group's clientWidth measured directly in the browser at the 402px (iPhone
 * 17) viewport; the settings page's own chrome around the group (the
 * shell's content padding plus the expansion panel body padding) is a fixed
 * px amount that does not change between viewports, so the same 82px
 * (402 - 320) gap carries over to the 320px viewport, giving 238.
 */
const GROUP_WIDTH_AT_402_VIEWPORT = 320;
const GROUP_WIDTH_AT_320_VIEWPORT = 238;

/** The three catalogs the requirement calls out, real strings — not keys. */
const THEME_LABELS: Record<SupportedLocale, { light: string; dark: string; system: string }> = {
  en: { light: 'Light', dark: 'Dark', system: 'System' },
  ja: { light: 'ライト', dark: 'ダーク', system: 'システム' },
  tc: { light: '淺色', dark: '深色', system: '系統' },
};

@Component({
  standalone: true,
  imports: [ProfileSettingsComponent],
  template: `<div class="narrow" [style.width.px]="width"><app-profile-settings /></div>`,
})
class ThemeToggleOverflowProbeComponent {
  width = GROUP_WIDTH_AT_402_VIEWPORT;
}

describe('overflow guard: the theme toggle', () => {
  let fixture: ComponentFixture<ThemeToggleOverflowProbeComponent>;
  let probe: ThemeToggleOverflowProbeComponent;
  let host: HTMLElement;

  const mockUser = {
    displayName: 'Test User',
    preferences: {
      baseCurrency: 'USD',
      theme: 'light' as const,
      dateFormat: 'MM/DD/YYYY',
      language: 'en',
    },
  };

  /** locale is fixed per test via TranslationService.currentLocale below. */
  async function setUp(locale: SupportedLocale): Promise<void> {
    const mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences', 'updateUserProfile'], {
      currentUser: signal(mockUser),
      userId: signal('user-1'),
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());
    mockAuthService.updateUserProfile.and.returnValue(Promise.resolve());

    const mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    const notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);

    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['setLocale', 't'], {
      currentLocale: signal(locale),
      languages: [
        { code: 'en', name: 'English', nativeName: 'English' },
        { code: 'tc', name: 'Traditional Chinese', nativeName: '繁體中文' },
        { code: 'ja', name: 'Japanese', nativeName: '日本語' },
      ],
    });
    mockTranslationService.setLocale.and.returnValue(Promise.resolve());
    // Real translated strings for the three theme keys — the whole point of
    // this probe — and the bare key everywhere else, which never competes
    // for the toggle's width.
    mockTranslationService.t.and.callFake((key: string) => {
      const labels = THEME_LABELS[locale];
      if (key === 'settings.themeLight') return labels.light;
      if (key === 'settings.themeDark') return labels.dark;
      if (key === 'settings.themeSystem') return labels.system;
      return key;
    });

    const mockThemeService = jasmine.createSpyObj('ThemeService', ['setTheme'], {
      currentTheme: signal('light'),
    });

    const mockGeminiService = jasmine.createSpyObj('GeminiService', ['reinitialize', 'isAvailable']);
    mockGeminiService.isAvailable.and.returnValue(true);

    const mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    const mockTransactionService = jasmine.createSpyObj('TransactionService', ['resnapshotBaseCurrency']);
    mockTransactionService.resnapshotBaseCurrency.and.returnValue(Promise.resolve(0));

    const mockSecurityLog = jasmine.createSpyObj('SecurityLogService', ['watchRecent', 'record']);
    mockSecurityLog.watchRecent.and.returnValue(of([]));

    const mockReminders = jasmine.createSpyObj('ReminderService', ['requestPermission', 'sweep'], {
      enabled: signal(false),
    });

    const mockRecap: { enabled: WritableSignal<boolean> } = { enabled: signal(false) };

    const mockCurrencyService = {
      rateSource: signal<RateSource | null>('live'),
      lastUpdated: signal<Date | null>(new Date(2026, 11, 31)),
    };

    await TestBed.configureTestingModule({
      imports: [ThemeToggleOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: AnnouncerService, useValue: mockAnnouncer },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: SecurityLogService, useValue: mockSecurityLog },
        { provide: ReminderService, useValue: mockReminders },
        { provide: WeeklyRecapService, useValue: mockRecap },
        {
          provide: AnalyticsService,
          useValue: jasmine.createSpyObj('AnalyticsService', ['trackSettingsChange']),
        },
        { provide: CurrencyService, useValue: mockCurrencyService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ThemeToggleOverflowProbeComponent);
    probe = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-font-scale');
    host?.remove();
  });

  function group(): HTMLElement {
    return host.querySelector('.theme-toggle') as HTMLElement;
  }

  /**
   * Selects through the button the user presses. `theme` is a plain field on
   * an OnPush component, so assigning it leaves the group rendering its
   * previous choice — and the selected option is the wide one, carrying the
   * checkmark this probe exists to measure.
   */
  function setThemeAndDetect(value: 'light' | 'dark' | 'system'): void {
    (segmentFor(value).querySelector('.mat-button-toggle-button') as HTMLElement).click();
    fixture.detectChanges();
  }

  function segmentFor(value: 'light' | 'dark' | 'system'): HTMLElement {
    const index = { light: 0, dark: 1, system: 2 }[value];
    return group().querySelectorAll('mat-button-toggle')[index] as HTMLElement;
  }

  /**
   * The real reason the defect brief cites: the group clips its content
   * (scrollWidth past clientWidth), or the selected label's own right edge
   * lands past its segment's right edge — same failure, read two ways.
   */
  function expectLabelWhole(value: 'light' | 'dark' | 'system'): void {
    const g = group();
    expect(g.scrollWidth)
      .withContext(`${value}: group scrollWidth vs clientWidth`)
      .toBeLessThanOrEqual(g.clientWidth + 1);

    const segment = segmentFor(value);
    const label = segment.querySelector('.mat-button-toggle-label-content') as HTMLElement;
    expect(label.getBoundingClientRect().right)
      .withContext(`${value}: label right edge vs segment right edge`)
      .toBeLessThanOrEqual(segment.getBoundingClientRect().right + 1);
  }

  describe('at the Extra large font scale', () => {
    beforeEach(() => {
      // Matches AccessibilityService.applyFontScale: 16 * 1.3 = 20.8px root
      // font-size, via the same custom property the html rule reads.
      document.documentElement.style.setProperty('--app-font-scale', '1.3');
    });

    for (const locale of ['en', 'ja', 'tc'] as const) {
      it(`keeps "System" whole in the ${locale} catalog at 320px (${GROUP_WIDTH_AT_320_VIEWPORT}px group)`, async () => {
        await setUp(locale);
        probe.width = GROUP_WIDTH_AT_320_VIEWPORT;
        fixture.detectChanges();
        setThemeAndDetect('system');

        expectLabelWhole('system');
      });

      it(`keeps "System" whole in the ${locale} catalog at 402px (${GROUP_WIDTH_AT_402_VIEWPORT}px group)`, async () => {
        await setUp(locale);
        probe.width = GROUP_WIDTH_AT_402_VIEWPORT;
        fixture.detectChanges();
        setThemeAndDetect('system');

        expectLabelWhole('system');
      });
    }

    for (const value of ['light', 'dark', 'system'] as const) {
      it(`keeps "${value}" whole (en) at the narrowest, 320px, width whichever option is selected`, async () => {
        await setUp('en');
        probe.width = GROUP_WIDTH_AT_320_VIEWPORT;
        fixture.detectChanges();
        setThemeAndDetect(value);

        expectLabelWhole(value);
      });
    }

    it('keeps every tap target at least 40px tall by its own box', async () => {
      await setUp('en');
      probe.width = GROUP_WIDTH_AT_320_VIEWPORT;
      fixture.detectChanges();
      setThemeAndDetect('system');

      const buttons = Array.from(group().querySelectorAll('.mat-button-toggle-button'));
      expect(buttons.length).toBe(3);
      for (const button of buttons) {
        expect((button as HTMLElement).getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
      }
    });

    it('still marks the selected option by more than colour alone', async () => {
      await setUp('en');
      probe.width = GROUP_WIDTH_AT_320_VIEWPORT;
      fixture.detectChanges();
      setThemeAndDetect('system');

      const label = segmentFor('system').querySelector('.mat-button-toggle-label-content') as HTMLElement;
      expect(getComputedStyle(label).fontWeight).toBe('600');
    });

    // Hiding the checkmark's wrapper does not release the inline space
    // Material reserves for it, so the checked segment used to carry an
    // empty strip its siblings did not — the font-size group beside it has
    // zeroed that padding since #450 and this group had not.
    it('gives the checked segment the same inline padding as its siblings', async () => {
      await setUp('en');
      probe.width = GROUP_WIDTH_AT_320_VIEWPORT;
      fixture.detectChanges();
      setThemeAndDetect('system');

      const paddings = (['light', 'dark', 'system'] as const).map(value => {
        const button = segmentFor(value).querySelector('.mat-button-toggle-button') as HTMLElement;
        return getComputedStyle(button).paddingInlineStart;
      });

      expect(new Set(paddings).size)
        .withContext(`checked segment padded differently: ${paddings.join(', ')}`)
        .toBe(1);
    });
  });

  describe('on desktop, at the default font scale', () => {
    it('leaves the toggle unchanged: icon and checkmark both stand at >= 1024px', async () => {
      await setUp('en');
      probe.width = 1024;
      fixture.detectChanges();
      setThemeAndDetect('system');

      const segment = segmentFor('system');
      expect(getComputedStyle(segment.querySelector('mat-icon') as HTMLElement).display).not.toBe('none');
      const checkbox = segment.querySelector('.mat-button-toggle-checkbox-wrapper') as HTMLElement | null;
      expect(checkbox).withContext('checkmark wrapper still renders on desktop').not.toBeNull();
      expect(getComputedStyle(checkbox!).display).not.toBe('none');

      expectLabelWhole('system');
    });
  });
});

describe('overflow guard: profile-settings grid tracks (#450)', () => {
  let fixture: ComponentFixture<ProfileSettingsComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    const mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences', 'updateUserProfile'], {
      currentUser: signal({
        displayName: 'Test User',
        preferences: { baseCurrency: 'USD', theme: 'light', dateFormat: 'MM/DD/YYYY', language: 'en' },
      }),
      userId: signal('user-1'),
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());
    mockAuthService.updateUserProfile.and.returnValue(Promise.resolve());

    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['setLocale', 't'], {
      currentLocale: signal('en'),
      languages: [{ code: 'en', name: 'English', nativeName: 'English' }],
    });
    mockTranslationService.setLocale.and.returnValue(Promise.resolve());
    mockTranslationService.t.and.callFake((key: string) => key);

    const mockThemeService = jasmine.createSpyObj('ThemeService', ['setTheme'], { currentTheme: signal('light') });
    const mockGeminiService = jasmine.createSpyObj('GeminiService', ['reinitialize', 'isAvailable']);
    mockGeminiService.isAvailable.and.returnValue(true);
    const mockTransactionService = jasmine.createSpyObj('TransactionService', ['resnapshotBaseCurrency']);
    mockTransactionService.resnapshotBaseCurrency.and.returnValue(Promise.resolve(0));
    const mockSecurityLog = jasmine.createSpyObj('SecurityLogService', ['watchRecent', 'record']);
    mockSecurityLog.watchRecent.and.returnValue(of([]));
    const mockReminders = jasmine.createSpyObj('ReminderService', ['requestPermission', 'sweep'], {
      enabled: signal(false),
    });
    const mockRecap: { enabled: WritableSignal<boolean> } = { enabled: signal(false) };
    const mockCurrencyService = {
      rateSource: signal<RateSource | null>('live'),
      lastUpdated: signal<Date | null>(new Date(2026, 11, 31)),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileSettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: SecurityLogService, useValue: mockSecurityLog },
        { provide: ReminderService, useValue: mockReminders },
        { provide: WeeklyRecapService, useValue: mockRecap },
        { provide: AnalyticsService, useValue: jasmine.createSpyObj('AnalyticsService', ['trackSettingsChange']) },
        { provide: CurrencyService, useValue: mockCurrencyService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileSettingsComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => {
    host?.remove();
  });

  it('keeps the settings grid single-column at the Karma window', () => {
    // #450's fix here sits entirely inside a >=768px rule, which this
    // window never reaches (see check-grid-tracks.mjs, the viewport-
    // independent gate that actually proves that rule parses). Karma
    // staying under 768px is what makes the unconditional base rule — one
    // column — the rule this pins, not the >=768px 2-column override,
    // which the CSSOM read below pins instead.
    expect(window.innerWidth)
      .withContext('Karma window stays under 768px, so the base single-column rule is what renders here')
      .toBeLessThan(768);

    const grid = host.querySelector('.settings-grid') as HTMLElement;
    expect(grid).withContext('settings-grid rendered').not.toBeNull();
    expect(getComputedStyle(grid).gridTemplateColumns.split(' ').length)
      .withContext('.settings-grid computed column count; pins the unconditional base rule (the >=768px rule is unreachable here)')
      .toBe(1);
  });

  /**
   * `.settings-grid`'s two-column rule lives entirely inside a >=768px
   * media query that Karma's window never reaches as rendered layout (see
   * above), so `getComputedStyle` cannot distinguish the fixed declaration
   * from the broken one it replaced. The declaration is still walkable
   * through the CSSOM once Angular injects the component's own emulated-
   * encapsulation `<style>` element: an unparseable `minmax(minmax())`
   * serialises as the empty string (confirmed as the RED by temporarily
   * restoring the broken value and rerunning this spec), a parseable one
   * as its exact resolved value.
   */
  function settingsGridRuleUnderMinWidth768(): string | null {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet; nothing this app injects is one
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('min-width: 768px')) {
          continue;
        }
        for (const inner of Array.from(rule.cssRules)) {
          if (inner instanceof CSSStyleRule && inner.selectorText.includes('.settings-grid')) {
            return inner.style.gridTemplateColumns;
          }
        }
      }
    }
    return null;
  }

  it('parses the two-column rule under >=768px (unobservable as layout at the Karma window)', () => {
    expect(settingsGridRuleUnderMinWidth768())
      .withContext('.settings-grid >=768px grid-template-columns, read via CSSOM since Karma never renders this rule')
      .toBe('repeat(2, minmax(0px, 1fr))');
  });
});
