import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { MonthlyComparisonComponent } from './monthly-comparison.component';
import { provideAppCharts } from '../../../core/config/chart.config';
import { Transaction } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';

/**
 * The component spec blanks its own template (monthly-comparison.component.
 * spec.ts:171-172), so it cannot host a layout assertion — #450's tenth and
 * eleventh sites live in `.summary-stats`.
 */
describe('overflow guard: monthly-comparison grid tracks (#450)', () => {
  let fixture: ComponentFixture<MonthlyComparisonComponent>;
  let host: HTMLElement;

  const mockCurrencyService = {
    currencies: [{ code: 'USD', name: 'US Dollar', symbol: '$' }],
    getCurrencyInfo: (code: string) => ({ code, name: 'US Dollar', symbol: '$' }),
    convert: (amount: number) => amount,
    amountInBase: (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount,
  };

  const mockTranslationService = { t: (key: string) => key, getIntlLocale: () => 'en-US' };

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      userId: 'user1',
      type: 'income',
      amount: 1000,
      amountInBaseCurrency: 1000,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Salary',
      date: Timestamp.fromDate(new Date(2024, 5, 1)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false,
    },
  ];

  function breakpointState(matches: boolean): BreakpointState {
    return { matches, breakpoints: { [APP_BREAKPOINTS.mobile]: matches } };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthlyComparisonComponent, NoopAnimationsModule],
      providers: [
        provideAppCharts(),
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: BreakpointObserver, useValue: { observe: () => of(breakpointState(false)) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonthlyComparisonComponent);
    fixture.componentInstance.transactions = mockTransactions;
    fixture.componentInstance.dateRange = { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) };
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => {
    host?.remove();
  });

  it('keeps the summary stats single-column at the Karma window', () => {
    // #450's fix here sits entirely inside >=768px and >=1024px rules,
    // neither of which this window reaches (see check-grid-tracks.mjs, the
    // viewport-independent gate that actually proves those rules parse).
    // Karma staying under 768px is what makes the unconditional base rule
    // — one column — the rule this pins, not the >=768px override, which
    // the CSSOM read below pins instead.
    expect(window.innerWidth)
      .withContext('Karma window stays under 768px, so the base single-column rule is what renders here')
      .toBeLessThan(768);

    const grid = fixture.nativeElement.querySelector('.summary-stats') as HTMLElement;
    expect(grid).withContext('summary-stats rendered').not.toBeNull();
    expect(getComputedStyle(grid).gridTemplateColumns.split(' ').length)
      .withContext('.summary-stats computed column count; pins the unconditional base rule (the >=768px/>=1024px rules are unreachable here)')
      .toBe(1);
  });

  /**
   * `.summary-stats`'s two-column rule (the >=768px one — a separate
   * four-column rule at >=1024px is out of scope here) lives entirely
   * inside a media query Karma's window never reaches as rendered layout
   * (see above), so `getComputedStyle` cannot distinguish the fixed
   * declaration from the broken one it replaced. The declaration is still
   * walkable through the CSSOM once Angular injects the component's own
   * emulated-encapsulation `<style>` element: an unparseable
   * `minmax(minmax())` serialises as the empty string (confirmed as the
   * RED by temporarily restoring the broken value and rerunning this
   * spec), a parseable one as its exact resolved value.
   */
  function summaryStatsRuleUnderMinWidth768(): string | null {
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
          if (inner instanceof CSSStyleRule && inner.selectorText.includes('.summary-stats')) {
            return inner.style.gridTemplateColumns;
          }
        }
      }
    }
    return null;
  }

  it('parses the two-column rule under >=768px (unobservable as layout at the Karma window)', () => {
    expect(summaryStatsRuleUnderMinWidth768())
      .withContext('.summary-stats >=768px grid-template-columns, read via CSSOM since Karma never renders this rule')
      .toBe('repeat(2, minmax(0px, 1fr))');
  });
});
