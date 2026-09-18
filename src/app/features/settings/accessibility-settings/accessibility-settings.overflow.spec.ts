import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { AccessibilitySettingsComponent } from './accessibility-settings.component';
import { AccessibilityService } from '../../../core/services/accessibility.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService, SupportedLocale } from '../../../core/services/translation.service';
import { User, UserPreferences } from '../../../models';

/**
 * The font-size toggle at the Extra large font scale on a phone.
 *
 * Reproduces the account font scale the same way AccessibilityService does
 * (`--app-font-scale` on the document root, read by the global `html` rule
 * in styles.scss) rather than forcing a font-size locally, so the probe is
 * wrong in exactly the ways the app would be wrong.
 *
 * The two group widths are the same two device viewports the defect was
 * measured on, translated into the group's own clientWidth — see
 * profile-settings.overflow.spec.ts, whose theme toggle sits in the same
 * settings panel and so shares the same chrome around it.
 */
const GROUP_WIDTH_AT_402_VIEWPORT = 320;
const GROUP_WIDTH_AT_320_VIEWPORT = 238;

/**
 * Flex distributes fractional remainders unevenly across three `flex: 1`
 * items sharing a 1px divider border (border-box, so the border itself
 * never widens a segment) — a sub-pixel rendering artifact, not a return
 * of the size-to-content defect this guards against, which left tens of
 * pixels of empty strip rather than a fraction of one.
 */
const SEGMENT_WIDTH_TOLERANCE_PX = 1.5;

/** The three catalogs' `settings.fontScale*` strings, real strings — not keys. */
const FONT_SCALE_LABELS: Record<SupportedLocale, { default: string; large: string; extraLarge: string }> = {
  en: { default: 'Default', large: 'Large', extraLarge: 'Extra large' },
  ja: { default: '標準', large: '大', extraLarge: '特大' },
  tc: { default: '標準', large: '大', extraLarge: '特大' },
};

@Component({
  standalone: true,
  imports: [AccessibilitySettingsComponent],
  template: `<div class="narrow" [style.width.px]="width"><app-accessibility-settings /></div>`,
})
class FontScaleToggleOverflowProbeComponent {
  width = GROUP_WIDTH_AT_402_VIEWPORT;
}

describe('overflow guard: the font-size toggle', () => {
  let fixture: ComponentFixture<FontScaleToggleOverflowProbeComponent>;
  let probe: FontScaleToggleOverflowProbeComponent;
  let host: HTMLElement;

  const userWith = (preferences: Partial<UserPreferences>): User => ({ id: 'user-1', preferences }) as User;

  /** locale is fixed per test via TranslationService.t below. */
  async function setUp(locale: SupportedLocale): Promise<void> {
    const mockAuthService = jasmine.createSpyObj('AuthService', ['updateUserPreferences'], {
      currentUser: signal(userWith({})),
    });
    mockAuthService.updateUserPreferences.and.returnValue(Promise.resolve());

    const mockAccessibilityService = jasmine.createSpyObj(
      'AccessibilityService',
      ['setFontScale', 'setHighContrast', 'setReducedMotion'],
      { fontScale: signal(1), highContrast: signal(false) }
    );

    const notifications = jasmine.createSpyObj('NotificationService', ['error']);
    const analytics = jasmine.createSpyObj('AnalyticsService', ['trackSettingsChange']);

    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['t'], {
      currentLocale: signal(locale),
    });
    // Real translated strings for the three font-scale keys — the whole
    // point of this probe — and the bare key everywhere else, which never
    // competes for the toggle's width.
    mockTranslationService.t.and.callFake((key: string) => {
      const labels = FONT_SCALE_LABELS[locale];
      if (key === 'settings.fontScaleDefault') return labels.default;
      if (key === 'settings.fontScaleLarge') return labels.large;
      if (key === 'settings.fontScaleExtraLarge') return labels.extraLarge;
      return key;
    });

    await TestBed.configureTestingModule({
      imports: [FontScaleToggleOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AccessibilityService, useValue: mockAccessibilityService },
        { provide: NotificationService, useValue: notifications },
        { provide: AnalyticsService, useValue: analytics },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(FontScaleToggleOverflowProbeComponent);
    probe = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-font-scale');
    host?.remove();
  });

  function group(): HTMLElement {
    return host.querySelector('.font-scale-toggle') as HTMLElement;
  }

  function segments(): HTMLElement[] {
    return Array.from(group().querySelectorAll('mat-button-toggle')) as HTMLElement[];
  }

  /**
   * The real reason #426's fourth part cites: the group clips its content
   * (scrollWidth past clientWidth), or a label's own right edge lands past
   * its segment's right edge — same failure, read two ways. Every segment
   * is checked, not just the selected one, since the checked segment's own
   * checkmark reservation (Material's own CSS) is a second place the same
   * empty-strip shape can reappear.
   */
  function expectEveryLabelWhole(): void {
    const g = group();
    expect(g.scrollWidth).withContext('group scrollWidth vs clientWidth').toBeLessThanOrEqual(g.clientWidth + 1);

    for (const segment of segments()) {
      const label = segment.querySelector('.mat-button-toggle-label-content') as HTMLElement;
      expect(label.getBoundingClientRect().right)
        .withContext(`"${label.textContent}": label right edge vs segment right edge`)
        .toBeLessThanOrEqual(segment.getBoundingClientRect().right + 1);
    }
  }

  describe('at the default font scale', () => {
    it('shares the row evenly among the three segments at 320px (402px viewport)', async () => {
      await setUp('en');
      probe.width = GROUP_WIDTH_AT_402_VIEWPORT;
      fixture.detectChanges();

      const g = group();
      const rects = segments().map((segment) => segment.getBoundingClientRect());
      expect(rects.length).toBe(3);

      const [first] = rects;
      for (const rect of rects) {
        expect(Math.abs(rect.width - first.width))
          .withContext('segment width vs first segment')
          .toBeLessThanOrEqual(SEGMENT_WIDTH_TOLERANCE_PX);
      }

      const last = rects[rects.length - 1];
      expect(Math.abs(last.right - g.getBoundingClientRect().right))
        .withContext('last segment right edge vs group right edge')
        .toBeLessThanOrEqual(1);
    });
  });

  describe('at the Extra large font scale', () => {
    beforeEach(() => {
      // Matches AccessibilityService.applyFontScale: 16 * 1.3 = 20.8px root
      // font-size, via the same custom property the html rule reads.
      document.documentElement.style.setProperty('--app-font-scale', '1.3');
    });

    for (const locale of ['en', 'ja', 'tc'] as const) {
      it(`keeps every option whole in the ${locale} catalog at 320px (${GROUP_WIDTH_AT_402_VIEWPORT}px group)`, async () => {
        await setUp(locale);
        probe.width = GROUP_WIDTH_AT_402_VIEWPORT;
        fixture.detectChanges();

        expectEveryLabelWhole();
      });

      it(`keeps every option whole in the ${locale} catalog at 238px (${GROUP_WIDTH_AT_320_VIEWPORT}px group)`, async () => {
        await setUp(locale);
        probe.width = GROUP_WIDTH_AT_320_VIEWPORT;
        fixture.detectChanges();

        expectEveryLabelWhole();
      });
    }
  });
});
