import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetProgressComponent } from './budget-progress.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { ThemeService } from '../../../core/services/theme.service';
import { Budget, Category } from '../../../models';
import {
  AUDIT_SCHEMES,
  GLYPH_PROBE_COLOURS,
  channels,
  iconBox,
  iconSquare,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withScheme,
  withTheme,
} from '../../../core/services/testing';

/**
 * What `color: var(token)` computes to under the palette on <html> now,
 * once any transition the theme swap started has run to its end.
 */
function tokenColour(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  try {
    settleAnimations(document);
    return getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

// The card as the dashboard renders it: what carries `card-actions` is the
// card's own menu.
@Component({
  standalone: true,
  imports: [BudgetProgressComponent],
  template: `
    <app-budget-progress>
      <span card-actions class="projected-action"></span>
    </app-budget-progress>
  `,
})
class BudgetProgressWithActionHostComponent {}

describe('BudgetProgressComponent', () => {
  let component: BudgetProgressComponent;
  let fixture: ComponentFixture<BudgetProgressComponent>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockCategoryHelperService: jasmine.SpyObj<CategoryHelperService>;

  const mockTimestamp = {
    seconds: Math.floor(Date.now() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => Date.now(),
    isEqual: () => false,
    toJSON: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })
  } as unknown as Timestamp;

  const mockCategory: Category = {
    id: 'cat1',
    userId: null,
    name: 'Food & Drinks',
    icon: 'restaurant',
    color: '#FF5722',
    type: 'expense',
    order: 1,
    isActive: true,
    isDefault: true
  };

  const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
    id: 'budget1',
    userId: 'user1',
    name: 'Food Budget',
    categoryId: 'cat1',
    amount: 1000,
    spent: 500,
    currency: 'USD',
    period: 'monthly',
    alertThreshold: 80,
    isActive: true,
    startDate: mockTimestamp,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    ...overrides
  });

  const setCategories = (value: Map<string, Category>) =>
    fixture.componentRef.setInput('categories', value);
  const setBudgets = (value: Budget[]) => fixture.componentRef.setInput('budgets', value);

  beforeEach(async () => {
    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrencyService.formatCurrency.and.callFake((amount: number, currency: string) =>
      `${currency} ${amount.toFixed(2)}`
    );

    mockCategoryHelperService = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName',
      'getCategoryIcon',
      'getCategoryColor'
    ]);
    mockCategoryHelperService.getCategoryName.and.returnValue('Food & Drinks');
    mockCategoryHelperService.getCategoryIcon.and.returnValue('restaurant');
    mockCategoryHelperService.getCategoryColor.and.returnValue('#FF5722');

    await TestBed.configureTestingModule({
      imports: [BudgetProgressComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: CategoryHelperService, useValue: mockCategoryHelperService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetProgressComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('getCategoryName', () => {
    it('should delegate to CategoryHelperService', () => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      setCategories(categories);

      const result = component.getCategoryName('cat1');

      expect(mockCategoryHelperService.getCategoryName).toHaveBeenCalledWith('cat1', categories);
      expect(result).toBe('Food & Drinks');
    });
  });

  describe('getCategoryIcon', () => {
    it('should delegate to CategoryHelperService', () => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      setCategories(categories);

      const result = component.getCategoryIcon('cat1');

      expect(mockCategoryHelperService.getCategoryIcon).toHaveBeenCalledWith('cat1', categories);
      expect(result).toBe('restaurant');
    });
  });

  describe('getCategoryColor', () => {
    it('should delegate to CategoryHelperService', () => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      setCategories(categories);

      const result = component.getCategoryColor('cat1');

      expect(mockCategoryHelperService.getCategoryColor).toHaveBeenCalledWith('cat1', categories);
      expect(result).toBe('#FF5722');
    });
  });

  describe('formatAmount', () => {
    it('should delegate to CurrencyService', () => {
      const result = component.formatAmount(1234.56, 'USD');

      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(1234.56, 'USD');
      expect(result).toBe('USD 1234.56');
    });
  });

  describe('getBudgetSpent', () => {
    it('reads the persisted, budget-period-anchored spent figure', () => {
      const budget = createMockBudget({ spent: 351 });
      expect(component.getBudgetSpent(budget)).toBe(351);
    });

    it('agrees with the budget-alert utilization for the same budget', () => {
      // The snackbar alerts compute percentUsed = spent / amount * 100 from
      // the same persisted field (BudgetService.budgetAlerts) — the card must
      // report the identical number, whatever period the dashboard shows.
      const budget = createMockBudget({ amount: 300, spent: 350.49 });
      const alertPercentUsed = (budget.spent / budget.amount) * 100;
      expect(component.getPercentage(budget)).toBe(alertPercentUsed);
    });
  });

  describe('getPercentage', () => {
    it('should calculate correct percentage', () => {
      const budget = createMockBudget({ amount: 1000, spent: 500 });
      expect(component.getPercentage(budget)).toBe(50);
    });

    it('should return 0 when amount is 0', () => {
      const budget = createMockBudget({ amount: 0, spent: 100 });
      expect(component.getPercentage(budget)).toBe(0);
    });

    it('reports true utilization above 100% instead of capping', () => {
      const budget = createMockBudget({ amount: 100, spent: 200 });
      expect(component.getPercentage(budget)).toBe(200);
    });

    it('clamps only the progress bar value at 100', () => {
      const budget = createMockBudget({ amount: 100, spent: 200 });
      expect(component.getBarValue(budget)).toBe(100);
    });
  });

  describe('getBarTone', () => {
    it('should return none for under 80%', () => {
      const budget = createMockBudget({ amount: 100, spent: 50 });
      expect(component.getBarTone(budget)).toBeNull();
    });

    it('should return near for 80-99%', () => {
      const budget = createMockBudget({ amount: 100, spent: 85 });
      expect(component.getBarTone(budget)).toBe('near');
    });

    it('should return over for 100% and over', () => {
      const budget = createMockBudget({ amount: 100, spent: 110 });
      expect(component.getBarTone(budget)).toBe('over');
    });
  });

  describe('getRemainingText', () => {
    it('should show remaining when under budget', () => {
      const budget = createMockBudget({ amount: 1000, spent: 300 });
      const text = component.getRemainingText(budget);
      expect(text).toContain('left');
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(700, 'USD');
    });

    it('should show over when over budget', () => {
      const budget = createMockBudget({ amount: 100, spent: 150 });
      const text = component.getRemainingText(budget);
      expect(text).toContain('over');
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(50, 'USD');
    });
  });

  // Each severity at a spend that reaches it under the budget's 80%
  // threshold, and the token its percentage and its bar both read in.
  // Critical shares the warning colour: there is no orange token, and the
  // alert text names the severity.
  const SEVERITIES = [
    { name: 'within budget', spent: 50, token: '--color-success-text' },
    { name: 'warning', spent: 85, token: '--color-warning-text' },
    { name: 'critical', spent: 95, token: '--color-warning-text' },
    { name: 'exceeded', spent: 110, token: '--color-error-text' },
  ] as const;

  describe('getPercentageClass, as painted', () => {
    it('reads each severity at AA or better on the budget row, in both themes', () => {
      for (const severity of SEVERITIES) {
        setBudgets([createMockBudget({ amount: 100, spent: severity.spent })]);
        fixture.detectChanges();
        const percentage = fixture.nativeElement.querySelector('.budget-percentage') as HTMLElement;
        const row = fixture.nativeElement.querySelector('.budget-item') as HTMLElement;
        for (const theme of ['light', 'dark'] as const) {
          withTheme(theme, () => {
            expect(paintedBackground(row))
              .withContext(`${theme} row`)
              .toEqual(channels(tokenColour('--surface-subtle')).rgb);
            expect(ratio(paintedColor(percentage), paintedBackground(percentage)))
              .withContext(`${theme} ${severity.name} on the row`)
              .toBeGreaterThanOrEqual(4.5);
            expect(getComputedStyle(percentage).color)
              .withContext(`${theme} ${severity.name}`)
              .toBe(tokenColour(severity.token));
          });
        }
      }
    });
  });

  describe('colours (real template)', () => {
    beforeEach(() => {
      setBudgets([createMockBudget()]);
      fixture.detectChanges();
    });

    it("paints the Manage link in the theme's own primary, at AA or better on the card, in both themes", () => {
      const link = fixture.nativeElement.querySelector('a[mat-button]') as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          expect(ratio(paintedColor(link), paintedBackground(link)))
            .withContext(`${theme} Manage link on the card`)
            .toBeGreaterThanOrEqual(4.5);
          expect(getComputedStyle(link).color)
            .withContext(`${theme} Manage link`)
            .toBe(tokenColour('--mat-sys-primary'));
        });
      }
    });

    it('paints the name and the amounts in the theme text tokens, at AA or better, in both themes', () => {
      const name = fixture.nativeElement.querySelector('.budget-name') as HTMLElement;
      const amounts = fixture.nativeElement.querySelector('.budget-amounts') as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          for (const [label, el, token] of [
            ['name', name, '--text-primary'],
            ['amounts', amounts, '--text-muted'],
          ] as const) {
            expect(ratio(paintedColor(el), paintedBackground(el)))
              .withContext(`${theme} ${label} on the row`)
              .toBeGreaterThanOrEqual(4.5);
            expect(getComputedStyle(el).color)
              .withContext(`${theme} ${label}`)
              .toBe(tokenColour(token));
          }
        });
      }
    });

    // A category's glyph is drawn on the budget row, so it is corrected for
    // --surface-subtle in the theme on screen.
    it("draws each category's glyph at AA or better on its budget row's --surface-subtle, in both themes", () => {
      const colours: Record<string, string> = { green: GLYPH_PROBE_COLOURS.light, indigo: GLYPH_PROBE_COLOURS.dark };
      mockCategoryHelperService.getCategoryColor.and.callFake((id: string) => colours[id]);
      setBudgets(Object.keys(colours).map(id => createMockBudget({ id, categoryId: id })));
      fixture.detectChanges();
      const glyphs = Array.from(fixture.nativeElement.querySelectorAll('.budget-info mat-icon')) as HTMLElement[];
      expect(glyphs.length).withContext('one glyph per budget').toBe(2);

      for (const scheme of AUDIT_SCHEMES) {
        withScheme(TestBed.inject(ThemeService), scheme, () => {
          fixture.detectChanges();
          glyphs.forEach((glyph, i) => {
            const label = `${scheme} ${Object.values(colours)[i]}`;
            expect(paintedBackground(glyph))
              .withContext(`${label} on the row`)
              .toEqual(channels(tokenColour('--surface-subtle')).rgb);
            expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
              .withContext(`${label} glyph`)
              .toBeGreaterThanOrEqual(4.5);
          });
        });
      }
    });

    // The track is Material's own and already follows the theme. An
    // override has to set --mat-progress-bar-track-color: Material reads no
    // --mdc-* name.
    it("draws the progress track in Material's own track colour, in both themes", () => {
      const track = fixture.nativeElement.querySelector('.mdc-linear-progress__buffer-bar') as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          settleAnimations(document);
          expect(getComputedStyle(track).backgroundColor)
            .withContext(`${theme} track`)
            .toBe(tokenColour('--mat-sys-surface-variant'));
        });
      }
    });

    // Material paints the indicator as the inner bar's top border. It is a
    // graphic, so its floor is 3:1 (WCAG 1.4.11), against the track it runs
    // along and the row around it.
    it("draws each severity's bar in the colour its percentage reads in, at 3:1 or better on its track and its row, in both themes", () => {
      const part = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          const painted = new Map<string, string>();
          for (const severity of SEVERITIES) {
            setBudgets([createMockBudget({ amount: 100, spent: severity.spent })]);
            fixture.detectChanges();
            settleAnimations(document);
            const label = `${theme} ${severity.name} bar`;
            const indicator = getComputedStyle(part('.mdc-linear-progress__bar-inner')).borderTopColor;
            painted.set(severity.name, indicator);
            expect(indicator).withContext(label).toBe(tokenColour(severity.token));
            expect(ratio(channels(indicator).rgb, paintedBackground(part('.mdc-linear-progress__buffer-bar'))))
              .withContext(`${label} on its track`)
              .toBeGreaterThanOrEqual(3);
            expect(ratio(channels(indicator).rgb, paintedBackground(part('.budget-item'))))
              .withContext(`${label} on its row`)
              .toBeGreaterThanOrEqual(3);
          }
          expect(painted.get('warning'))
            .withContext(`${theme} a warning bar paints apart from one within budget`)
            .not.toBe(painted.get('within budget'));
          expect(painted.get('exceeded'))
            .withContext(`${theme} an exceeded bar paints apart from a warning one`)
            .not.toBe(painted.get('warning'));
        });
      }
    });
  });

  describe('UI rendering', () => {
    beforeEach(() => {
      const categories = new Map<string, Category>();
      categories.set('cat1', mockCategory);
      setCategories(categories);
      setBudgets([createMockBudget({ categoryId: 'cat1', currency: 'USD' })]);
      fixture.detectChanges();
    });

    it('should display budget progress card', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('mat-card')).toBeTruthy();
    });

    it('should display title', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      // Check for translation key or translated text
      expect(compiled.textContent?.includes('Budget Progress') || compiled.textContent?.includes('dashboard.budgetProgress')).toBe(true);
    });

    it('should display manage link', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      // Check for translation key or translated text
      expect(compiled.textContent?.includes('Manage') || compiled.textContent?.includes('budget.manage')).toBe(true);
    });

    it("sizes the Manage link's arrow at --text-base, its box and line box the same", () => {
      const arrow = fixture.nativeElement.querySelector('a[mat-button] mat-icon') as HTMLElement;
      expect(arrow?.textContent?.trim()).toBe('arrow_forward');
      expect(iconBox(arrow)).toEqual(iconSquare('--text-base'));
    });

    it('should display budget name', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Food Budget');
    });

    it("should display the budget's own period label next to the name", () => {
      const period = fixture.nativeElement.querySelector('.budget-period') as HTMLElement;
      expect(period).toBeTruthy();
      // Raw key under Karma (i18n assets not served) or the translated label.
      expect(
        period.textContent?.includes('transactions.monthly') ||
          period.textContent?.includes('Monthly')
      ).toBe(true);
    });

    it("wears the token class instead of the gray-400/gray-500 utility pair", () => {
      const period = fixture.nativeElement.querySelector('.budget-period') as HTMLElement;
      expect(period.classList.contains('budget-period')).toBe(true);
      // --text-muted resolves differently per theme (and per a11y class) on
      // document.documentElement, which this spec doesn't control — proving
      // .budget-period wears the token means resolving the token itself
      // here, not asserting whichever theme happened to be active when the
      // suite reached this test.
      const tokenValue = getComputedStyle(document.documentElement)
        .getPropertyValue('--text-muted')
        .trim();
      const probe = document.createElement('span');
      probe.style.color = tokenValue;
      document.body.appendChild(probe);
      const expectedColor = getComputedStyle(probe).color;
      probe.remove();

      expect(getComputedStyle(period).color).toBe(expectedColor);
    });

    it('should display progress bar', () => {
      const progressBar = fixture.nativeElement.querySelector('mat-progress-bar');
      expect(progressBar).toBeTruthy();
    });

    it("names the progress bar with the budget's own name and percentage", () => {
      const progressBar = fixture.nativeElement.querySelector('mat-progress-bar');
      expect(progressBar.getAttribute('aria-label')).toBe('budgets.progressLabel');
    });

    it('projects the card actions into its header, after Manage', () => {
      const hostFixture = TestBed.createComponent(BudgetProgressWithActionHostComponent);
      hostFixture.detectChanges();

      const header = hostFixture.nativeElement.querySelector('mat-card-header') as HTMLElement;
      const action = header.querySelector('.projected-action');
      expect(action).withContext('in the header').not.toBeNull();
      const manage = header.querySelector('a[mat-button]') as HTMLElement;
      expect(manage.compareDocumentPosition(action!) & Node.DOCUMENT_POSITION_FOLLOWING)
        .withContext('after Manage')
        .toBeTruthy();
    });

    it('should render multiple budgets', () => {
      setBudgets([
        createMockBudget({ id: '1', name: 'Budget 1' }),
        createMockBudget({ id: '2', name: 'Budget 2' })
      ]);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Budget 1');
      expect(compiled.textContent).toContain('Budget 2');
    });
  });
});
