import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetProgressComponent } from './budget-progress.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { ThemeService } from '../../../core/services/theme.service';
import { TranslationService } from '../../../core/services/translation.service';
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
  textLines,
  withScheme,
  withTheme,
  provideNoMotion,
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
      imports: [BudgetProgressComponent],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: CategoryHelperService, useValue: mockCategoryHelperService },
        provideNoMotion()
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

  // The dashboard's right-hand rail at 1024 px gives each budget's header row
  // 160 px, where *Food & Dining* was cut to *Food & Dini…* with nothing to
  // read the rest by. G3 in docs/ui-overflow.md: nothing truncates. A name
  // too long for the row wraps, one with no break in it breaks where it must,
  // and the amounts wrap at their spaces.
  describe('a budget row at the rail width (real template)', () => {
    const HEADER_ROW = 160;
    // The card content's padding (12 px a side) and the row's own (10 px a
    // side) around the header row.
    const RAIL = HEADER_ROW + 2 * 12 + 2 * 10;
    const COPY: Record<string, string> = {
      'dashboard.budgetProgress': 'Budget Progress',
      'budget.manage': 'Manage',
      'transactions.monthly': 'Monthly',
    };
    const LONG_NAME = 'Groceries_Household_Pantry_Staples';
    let host: HTMLElement;

    const rows = () => Array.from(host.querySelectorAll('.budget-item')) as HTMLElement[];
    const part = (row: HTMLElement, selector: string) => row.querySelector(selector) as HTMLElement;
    const longRow = () => rows().find(row => part(row, '.budget-name').textContent?.trim() === LONG_NAME)!;
    /** The rectangle of the first line `element`'s own text is laid out on. */
    const firstLine = (element: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects()).find(rect => rect.width > 0)!;
    };
    const middle = (box: DOMRect) => (box.top + box.bottom) / 2;
    /** How wide `element`'s text is on one unbroken line, in its own font. */
    const naturalWidth = (element: HTMLElement) => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.style.cssText = 'position: absolute; white-space: nowrap; width: max-content; max-width: none';
      element.parentElement!.appendChild(copy);
      try {
        return copy.getBoundingClientRect().width;
      } finally {
        copy.remove();
      }
    };
    /** Whether `period` follows `name` on its line or starts a line below it. */
    const afterOrBelow = (name: DOMRect, period: DOMRect) =>
      period.left >= name.right || period.top >= name.bottom - 0.5;

    beforeEach(() => {
      spyOn(TestBed.inject(TranslationService), 't').and.callFake((key: string) => COPY[key] ?? key);
      mockCurrencyService.formatCurrency.and.callFake((amount: number, currency: string) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
      );
      host = fixture.nativeElement as HTMLElement;
      host.style.display = 'block';
      host.style.width = `${RAIL}px`;
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
      setBudgets([
        createMockBudget({ id: 'food', name: 'Food & Dining', amount: 600, spent: 0 }),
        createMockBudget({ id: 'long', name: LONG_NAME, amount: 125000, spent: 98765.43 }),
      ]);
      fixture.detectChanges();
    });

    afterEach(() => host.remove());

    it('wraps a name too long for the row rather than cutting it, inside its row', () => {
      expect(rows().length).withContext('both budgets rendered').toBe(2);
      for (const row of rows()) {
        const name = part(row, '.budget-name');
        const label = name.textContent!.trim();
        const header = part(row, '.budget-header').getBoundingClientRect();
        expect(header.width).withContext(`${label} header row at the rail width`).toBeCloseTo(HEADER_ROW, 0);
        expect(getComputedStyle(name).textOverflow).withContext(`${label} no ellipsis`).not.toBe('ellipsis');
        expect(name.scrollWidth)
          .withContext(`${label} nothing hidden past the name's edge`)
          .toBeLessThanOrEqual(name.clientWidth);

        const period = part(row, '.budget-period').getBoundingClientRect();
        const percentage = part(row, '.budget-percentage').getBoundingClientRect();
        expect(afterOrBelow(name.getBoundingClientRect(), period))
          .withContext(`${label} period word after the name on its line, or below it`)
          .toBeTrue();
        expect(period.right).withContext(`${label} period word before the percentage`).toBeLessThanOrEqual(percentage.left);
        expect(percentage.right).withContext(`${label} percentage inside the row`).toBeLessThanOrEqual(header.right);
      }
      expect(textLines(part(longRow(), '.budget-name')))
        .withContext('the unbreakable name wrapped')
        .toBeGreaterThan(1);
    });

    it('wraps the amounts at their spaces rather than cutting them', () => {
      for (const row of rows()) {
        const amounts = part(row, '.budget-amounts');
        const label = amounts.textContent!.trim();
        expect(getComputedStyle(amounts).textOverflow).withContext(`${label} no ellipsis`).not.toBe('ellipsis');
        expect(amounts.scrollWidth)
          .withContext(`${label} nothing hidden past the line's edge`)
          .toBeLessThanOrEqual(amounts.clientWidth);
        expect(amounts.getBoundingClientRect().right)
          .withContext(`${label} inside the row`)
          .toBeLessThanOrEqual(part(row, '.budget-footer').getBoundingClientRect().right);
      }
    });

    // A wrapped name is read from its first line, so the glyph and the
    // percentage sit beside that line rather than floating between two, or
    // on a line of their own above the name. The name has the row's width
    // to wrap in, so the period word starts the line below it.
    it("keeps the glyph and the percentage on a wrapped name's first line, and the period word below the name", () => {
      const row = longRow();
      const name = part(row, '.budget-name');
      expect(textLines(name)).withContext('the name wrapped').toBeGreaterThan(1);
      const line = firstLine(name);
      for (const [label, selector] of [
        ['glyph', '.budget-info mat-icon'],
        ['percentage', '.budget-percentage'],
      ] as const) {
        const centre = middle(part(row, selector).getBoundingClientRect());
        expect(centre).withContext(`${label} at or below the first line's top`).toBeGreaterThanOrEqual(line.top);
        expect(centre).withContext(`${label} at or above the first line's bottom`).toBeLessThanOrEqual(line.bottom);
      }
      const period = part(row, '.budget-period').getBoundingClientRect();
      expect(period.top)
        .withContext("period word at or below the name's last line")
        .toBeGreaterThanOrEqual(name.getBoundingClientRect().bottom - 0.5);
      expect(period.right)
        .withContext('period word inside the row')
        .toBeLessThanOrEqual(part(row, '.budget-header').getBoundingClientRect().right);
    });

    // *Subscriptions* fits the row on its own but not beside the period
    // word. Taking the period word's room split it as *Subscription* / *s*;
    // the period word moves down instead, and the name keeps its line whole.
    it('keeps a word that fits the row whole on one line, and moves the period word below it', () => {
      setBudgets([createMockBudget({ id: 'subs', name: 'Subscriptions', amount: 600, spent: 0 })]);
      fixture.detectChanges();
      const [row] = rows();
      const header = part(row, '.budget-header').getBoundingClientRect();
      const info = part(row, '.budget-info');
      const name = part(row, '.budget-name');
      const period = part(row, '.budget-period');
      expect(header.width).withContext('header row at the rail width').toBeCloseTo(HEADER_ROW, 0);

      // The word is sized for the fallback face: wider than what the period
      // word leaves it, no wider than what the glyph alone leaves it.
      const gap = parseFloat(getComputedStyle(info).columnGap);
      const word = naturalWidth(name);
      const besideGlyph = info.getBoundingClientRect().width - part(row, '.budget-info mat-icon').getBoundingClientRect().width - gap;
      const besidePeriod = besideGlyph - gap - period.getBoundingClientRect().width;
      expect(word).withContext('precondition: too wide to sit beside the period word').toBeGreaterThan(besidePeriod);
      expect(word).withContext('precondition: fits the row beside the glyph alone').toBeLessThanOrEqual(besideGlyph);

      const nameBox = name.getBoundingClientRect();
      expect(nameBox.height)
        .withContext('the name on one line, its height one line-height')
        .toBeCloseTo(parseFloat(getComputedStyle(name).lineHeight), 0);
      expect(textLines(name)).withContext('the word whole on one line').toBe(1);
      const periodBox = period.getBoundingClientRect();
      expect(periodBox.top).withContext("period word below the name's line").toBeGreaterThanOrEqual(nameBox.bottom - 0.5);
      expect(periodBox.right).withContext('period word inside the row').toBeLessThanOrEqual(header.right);
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
