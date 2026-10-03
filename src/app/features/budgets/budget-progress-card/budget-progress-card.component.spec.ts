import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetProgressCardComponent } from './budget-progress-card.component';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { Budget, Category } from '../../../models';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';
import {
  channels,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withTheme,
} from '../../../core/services/testing';

describe('BudgetProgressCardComponent', () => {
  let component: BudgetProgressCardComponent;
  let fixture: ComponentFixture<BudgetProgressCardComponent>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockCurrencyService: { formatCurrency: jasmine.Spy };

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

  beforeEach(async () => {
    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    mockTranslationService.t.and.callFake((key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'budget.budgetExceeded': 'Budget exceeded!',
        'budget.almostAtLimit': 'Almost at limit',
        'budget.approachingLimit': 'Approaching limit',
        'budget.amountLeft': `${params?.['amount']} left`,
        'budget.amountOver': `${params?.['amount']} over`,
        'transactions.weekly': 'Weekly',
        'transactions.monthly': 'Monthly',
        'transactions.yearly': 'Yearly'
      };
      return translations[key] || key;
    });
    mockTranslationService.getIntlLocale.and.returnValue('en-US');
    // Mirrors CurrencyService.formatCurrency's decimal rules (two decimals
    // for USD-like currencies) so rendering assertions stay realistic.
    mockCurrencyService = {
      formatCurrency: jasmine
        .createSpy('formatCurrency')
        .and.callFake((amount: number, code: string) =>
          new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }).format(amount)
        )
    };

    await TestBed.configureTestingModule({
      imports: [BudgetProgressCardComponent, NoopAnimationsModule],
      providers: [
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: CurrencyService, useValue: mockCurrencyService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetProgressCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('budget', createMockBudget());
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('percentage', () => {
    it('should calculate correct percentage', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 1000, spent: 500 }));
      expect(component.percentage()).toBe(50);
    });

    it('should return 0 when amount is 0', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 0, spent: 100 }));
      expect(component.percentage()).toBe(0);
    });

    it('reports true utilization above 100% instead of capping', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 300, spent: 350.49 }));
      expect(component.percentage()).toBeCloseTo(116.83, 1);
    });

    it('clamps only the progress bar value at 100', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 200 }));
      expect(component.percentage()).toBe(200);
      expect(component.barValue()).toBe(100);
    });

    it('should handle decimal percentages', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 300, spent: 100 }));
      expect(component.percentage()).toBeCloseTo(33.33, 1);
    });
  });

  describe('remaining', () => {
    it('should calculate remaining amount', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 1000, spent: 300 }));
      expect(component.remaining()).toBe(700);
    });

    it('should return 0 when over budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 200 }));
      expect(component.remaining()).toBe(0);
    });

    it('should return full amount when nothing spent', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 500, spent: 0 }));
      expect(component.remaining()).toBe(500);
    });
  });

  describe('isOverBudget', () => {
    it('should return true when spent exceeds amount', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 150 }));
      expect(component.isOverBudget()).toBe(true);
    });

    it('should return false when under budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 50 }));
      expect(component.isOverBudget()).toBe(false);
    });

    it('should return false when exactly at budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 100 }));
      expect(component.isOverBudget()).toBe(false);
    });
  });

  describe('progressColor', () => {
    it('should return primary for under 50%', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 40 }));
      expect(component.progressColor()).toBe('primary');
    });

    it('should return primary while under the alert threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 60 }));
      expect(component.progressColor()).toBe('primary');
    });

    it('should return accent from the warning threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85 }));
      expect(component.progressColor()).toBe('accent');
    });

    it('should return warn for over budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 150 }));
      expect(component.progressColor()).toBe('warn');
    });
  });

  describe('statusClass', () => {
    it('should return the success text class for under 50%', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 40 }));
      expect(component.statusClass()).toBe('text-success-text');
    });

    it('should return the success text class while under the alert threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 60 }));
      expect(component.statusClass()).toBe('text-success-text');
    });

    it('should return the warning text class in the warning band', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85 }));
      expect(component.statusClass()).toBe('text-warning-text');
    });

    it('should return the warning text class in the critical band too', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 92 }));
      expect(component.statusClass()).toBe('text-warning-text');
    });

    it('should return the error text class with semibold for 100% and over', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 110 }));
      expect(component.statusClass()).toBe('text-error-text font-semibold');
    });
  });

  describe('signal consistency', () => {
    it('bar, percentage text and chip all agree in the warning band', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85 }));
      expect(component.alertSeverity()).toBe('warning');
      expect(component.progressColor()).toBe('accent');
      expect(component.statusClass()).toBe('text-warning-text');
    });

    it('bar, percentage text and chip all agree when exceeded', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 300, spent: 350.49 }));
      expect(component.alertSeverity()).toBe('exceeded');
      expect(component.progressColor()).toBe('warn');
      expect(component.statusClass()).toBe('text-error-text font-semibold');
      expect(component.percentage()).toBeGreaterThan(100);
    });
  });

  describe('colours, as painted on the card', () => {
    const THEMES = ['light', 'dark'] as const;
    const el = () => fixture.nativeElement as HTMLElement;
    const part = (selector: string) => el().querySelector(selector) as HTMLElement;

    /** What `<property>: var(token)` computes to under the theme on <html> now. */
    function tokenValue(token: string, property = 'color'): string {
      const probe = document.createElement('span');
      probe.style.setProperty(property, `var(${token})`);
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).getPropertyValue(property);
      } finally {
        probe.remove();
      }
    }

    function render(overrides: Partial<Budget> = {}): void {
      fixture.componentRef.setInput('budget', createMockBudget(overrides));
      fixture.componentRef.setInput('category', mockCategory);
      fixture.detectChanges();
    }

    /** `node` is `token`, and reads at `floor` or better on what is painted behind it. */
    function expectPainted(node: HTMLElement, token: string, label: string, floor = 4.5): void {
      expect(node).withContext(label).toBeTruthy();
      expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
      expect(ratio(paintedColor(node), paintedBackground(node)))
        .withContext(`${label} on the card`)
        .toBeGreaterThanOrEqual(floor);
    }

    // The menu renders in the CDK overlay, outside the fixture.
    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
    });

    // Each severity at a spend that reaches it under the budget's 80%
    // threshold. Critical shares the warning colour, as the bar does: there
    // is no orange token, and the alert's own words name the severity.
    const SEVERITIES = [
      { name: 'within budget', spent: 40, token: '--color-success-text', alert: false },
      { name: 'warning', spent: 85, token: '--color-warning-text', alert: true },
      { name: 'critical', spent: 92, token: '--color-warning-text', alert: true },
      { name: 'exceeded', spent: 110, token: '--color-error-text', alert: true },
    ] as const;

    it('sits on the M3 card surface, in both themes', () => {
      render();
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expect(paintedBackground(part('.budget-card')))
            .withContext(`${theme} card`)
            .toEqual(channels(tokenValue('--mat-sys-surface-container-low')).rgb);
        });
      }
    });

    it('reads the percentage and the alert of every severity at AA or better, in both themes', () => {
      for (const severity of SEVERITIES) {
        render({ amount: 100, spent: severity.spent });
        for (const theme of THEMES) {
          withTheme(theme, () => {
            expectPainted(part('.percentage'), severity.token, `${theme} ${severity.name} percentage`);
            if (severity.alert) {
              expectPainted(part('.alert'), severity.token, `${theme} ${severity.name} alert`);
              expectPainted(part('.alert-text'), severity.token, `${theme} ${severity.name} alert text`);
            } else {
              expect(part('.alert')).withContext(`${theme} ${severity.name} has no alert`).toBeNull();
            }
          });
        }
      }
    });

    it('paints the name, the figures, the meta, limit and remaining lines in the theme text tokens, in both themes', () => {
      render({ amount: 1000, spent: 300 });
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expectPainted(part('.budget-name'), '--text-primary', `${theme} name`);
          expectPainted(part('.spent'), '--text-primary', `${theme} spent`);
          expectPainted(part('.budget-meta'), '--text-muted', `${theme} meta`);
          expectPainted(part('.limit'), '--text-muted', `${theme} limit`);
          expectPainted(part('.remaining'), '--text-muted', `${theme} remaining`);
        });
      }
    });

    it('paints an overspend in the error text colour, at AA or better, in both themes', () => {
      render({ amount: 100, spent: 150 });
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expectPainted(part('.spent.over-budget'), '--color-error-text', `${theme} spent over`);
          expectPainted(part('.remaining.over-budget'), '--color-error-text', `${theme} remaining over`);
        });
      }
    });

    // A glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11).
    it('paints the menu button in --text-muted, its glyph at 3:1 or better, in both themes', () => {
      render();
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expectPainted(part('.menu-btn mat-icon'), '--text-muted', `${theme} menu glyph`, 3);
        });
      }
    });

    it('draws the card edge in --border-primary, in both themes', () => {
      render();
      const card = getComputedStyle(part('.budget-card'));
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expect(card.borderTopStyle).withContext(`${theme} the edge is drawn`).toBe('solid');
          expect(card.borderTopColor).withContext(`${theme} edge`).toBe(tokenValue('--border-primary'));
        });
      }
    });

    /**
     * The menu renders in the overlay, outside the card, so nothing scoped to
     * the card reaches it; and Material paints an item's label and icon from
     * its own tokens. Both are read where they are painted.
     */
    it('paints the delete item of its menu red, label and icon, at AA or better on the menu, in both themes', () => {
      render();
      part('.menu-btn').click();
      fixture.detectChanges();

      const items = Array.from(document.querySelectorAll('.mat-mdc-menu-panel .mat-mdc-menu-item')) as HTMLElement[];
      expect(items.length).withContext('edit and delete').toBe(2);
      const [edit, remove] = items;
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expectPainted(remove.querySelector('.mat-mdc-menu-item-text') as HTMLElement, '--color-error-text', `${theme} delete label`);
          expectPainted(remove.querySelector('mat-icon') as HTMLElement, '--color-error-text', `${theme} delete icon`);
          expect(getComputedStyle(edit.querySelector('.mat-mdc-menu-item-text') as HTMLElement).color)
            .withContext(`${theme} edit stays as Material paints it`)
            .not.toBe(tokenValue('--color-error-text'));
        });
      }
    });
  });

  describe('showAlert', () => {
    it('should show alert when percentage reaches threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 80, alertThreshold: 80 }));
      expect(component.showAlert()).toBe(true);
    });

    it('should not show alert when under threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 70, alertThreshold: 80 }));
      expect(component.showAlert()).toBe(false);
    });

    it('should show alert when over budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 150, alertThreshold: 80 }));
      expect(component.showAlert()).toBe(true);
    });
  });

  describe('alertSeverity', () => {
    it('should return null under the alert threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 70, alertThreshold: 80 }));
      expect(component.alertSeverity()).toBeNull();
    });

    it('should return warning for 80-89%', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85, alertThreshold: 80 }));
      expect(component.alertSeverity()).toBe('warning');
    });

    it('should return critical for 90-99%', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 95, alertThreshold: 80 }));
      expect(component.alertSeverity()).toBe('critical');
    });

    it('should return exceeded for 100% and over', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 110, alertThreshold: 80 }));
      expect(component.alertSeverity()).toBe('exceeded');
    });

    it('should show critical even when alertThreshold is above 90', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 92, alertThreshold: 95 }));
      expect(component.showAlert()).toBe(true);
      expect(component.alertSeverity()).toBe('critical');
    });
  });

  describe('alertText', () => {
    it('should return appropriate text for warning', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85, alertThreshold: 80 }));
      expect(component.alertText()).toBe('Approaching limit');
    });

    it('should return appropriate text for critical', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 95, alertThreshold: 80 }));
      expect(component.alertText()).toBe('Almost at limit');
    });

    it('should return appropriate text for exceeded', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 110, alertThreshold: 80 }));
      expect(component.alertText()).toBe('Budget exceeded!');
    });
  });

  describe('getPeriodLabel', () => {
    it('should return Weekly for weekly period', () => {
      fixture.componentRef.setInput('budget', createMockBudget());
      expect(component.getPeriodLabel('weekly')).toBe('Weekly');
    });

    it('should return Monthly for monthly period', () => {
      fixture.componentRef.setInput('budget', createMockBudget());
      expect(component.getPeriodLabel('monthly')).toBe('Monthly');
    });

    it('should return Yearly for yearly period', () => {
      fixture.componentRef.setInput('budget', createMockBudget());
      expect(component.getPeriodLabel('yearly')).toBe('Yearly');
    });
  });

  describe('formatCurrency', () => {
    it('should format USD currency correctly', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ currency: 'USD' }));
      const formatted = component.formatCurrency(1234.56);
      expect(formatted).toContain('1,234');
    });

    it('should format EUR currency correctly', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ currency: 'EUR' }));
      const formatted = component.formatCurrency(1234.56);
      expect(formatted).toContain('1,234');
    });

    it('delegates to the app-wide CurrencyService formatter', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ currency: 'USD' }));
      component.formatCurrency(93.1);
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(93.1, 'USD');
    });

    it('always renders two decimals for USD-like currencies', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ currency: 'USD' }));
      expect(component.formatCurrency(93.1)).toBe('$93.10');
      expect(component.formatCurrency(506.9)).toBe('$506.90');
    });
  });

  describe('getRemainingText', () => {
    it('should show remaining amount when under budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 1000, spent: 300, currency: 'USD' }));
      const text = component.getRemainingText();
      expect(text).toContain('700');
      expect(text).toContain('left');
    });

    it('should show over amount when over budget', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 150, currency: 'USD' }));
      const text = component.getRemainingText();
      expect(text).toContain('50');
      expect(text).toContain('over');
    });
  });

  describe('event emitters', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('budget', createMockBudget());
      fixture.componentRef.setInput('category', mockCategory);
      fixture.detectChanges();
    });

    it('should emit edit event', () => {
      const editSpy = spyOn(component.edit, 'emit');
      component.edit.emit();
      expect(editSpy).toHaveBeenCalled();
    });

    it('should emit delete event', () => {
      const deleteSpy = spyOn(component.delete, 'emit');
      component.delete.emit();
      expect(deleteSpy).toHaveBeenCalled();
    });
  });

  describe('UI rendering', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('budget', createMockBudget());
      fixture.componentRef.setInput('category', mockCategory);
      fixture.detectChanges();
    });

    it('should display budget name', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Food Budget');
    });

    it('should display category icon', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('restaurant');
    });

    it('should display progress bar', () => {
      const progressBar = fixture.nativeElement.querySelector('mat-progress-bar');
      expect(progressBar).toBeTruthy();
    });

    it("names the progress bar with the budget's own name and percentage", () => {
      const progressBar = fixture.nativeElement.querySelector('mat-progress-bar');
      expect(progressBar.getAttribute('aria-label')).toBe('budgets.progressLabel');
    });

    it('should display menu button', () => {
      const menuButton = fixture.nativeElement.querySelector('[mat-icon-button]');
      expect(menuButton).toBeTruthy();
    });
  });

  // The Budgets page lists the cards under the page's own heading.
  describe('its heading', () => {
    beforeEach(() => fixture.componentRef.setInput('budget', createMockBudget()));

    it('names the budget in an h3', () => {
      fixture.detectChanges();

      const name = fixture.nativeElement.querySelector('.budget-name') as HTMLElement;
      expect(name.tagName).toBe('H3');
      expect(name.textContent?.trim()).toBe('Food Budget');
    });
  });

  describe('hit boxes', () => {
    let host: HTMLElement;

    beforeEach(() => {
      fixture.componentRef.setInput('budget', createMockBudget());
      fixture.componentRef.setInput('category', mockCategory);
      host = fixture.nativeElement as HTMLElement;
      host.style.width = '320px';
      document.body.appendChild(host);
      fixture.detectChanges();
    });

    afterEach(() => {
      host?.remove();
    });

    it('gives the overflow-menu trigger a 40px tap target, not just its 32px glyph box', () => {
      const menuButton = host.querySelector('.menu-btn') as HTMLElement;
      const rect = menuButton.getBoundingClientRect();
      expect(rect.width).withContext('menu button width vs the 40px floor').toBeGreaterThanOrEqual(40);
      expect(rect.height).withContext('menu button height vs the 40px floor').toBeGreaterThanOrEqual(40);
    });
  });

  // G3 (docs/ui-overflow.md): nothing is cut. A name is its owner's own
  // words and may be one unbreakable run; a figure keeps every digit.
  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.display = 'block';
      host.style.width = '311px';
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    const within = (part: HTMLElement, box: DOMRect, label: string) => {
      expect(part.scrollWidth).withContext(`nothing overflows ${label}`).toBeLessThanOrEqual(part.clientWidth);
      const rect = part.getBoundingClientRect();
      expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(box.right + 0.5);
    };

    it('wraps a long name onto more lines rather than cutting it, the menu keeping its 40px', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ name: `Groceries ${'B'.repeat(80)}` }));
      fixture.componentRef.setInput('category', mockCategory);
      fixture.detectChanges();

      const card = (host.querySelector('.budget-card') as HTMLElement).getBoundingClientRect();
      const name = host.querySelector('.budget-name') as HTMLElement;
      const style = getComputedStyle(name);
      expect(style.textOverflow).not.toBe('ellipsis');
      expect(style.whiteSpace).toBe('normal');
      within(name, card, 'the name');
      expect(name.getBoundingClientRect().height)
        .withContext('the name runs onto more lines')
        .toBeGreaterThan(parseFloat(style.lineHeight) * 1.5);

      // Its box only: Material's own 48px touch target inside it widens its
      // scrollWidth by design.
      const menu = (host.querySelector('.menu-btn') as HTMLElement).getBoundingClientRect();
      expect(menu.width).toBeGreaterThanOrEqual(40);
      expect(menu.height).toBeGreaterThanOrEqual(40);
      expect(menu.right).withContext('the menu ends inside').toBeLessThanOrEqual(card.right + 0.5);
    });

    it('keeps every digit of a figure too wide for its line, scaled to fit rather than cut', () => {
      fixture.componentRef.setInput(
        'budget',
        createMockBudget({ currency: 'JPY', amount: 2345678901234567, spent: 1234567890123456 })
      );
      fixture.componentRef.setInput('category', mockCategory);
      fixture.detectChanges();
      TestBed.inject(FitTextRegistry).flush();

      const card = (host.querySelector('.budget-card') as HTMLElement).getBoundingClientRect();
      const spent = host.querySelector('.spent') as HTMLElement;
      expect(spent.textContent).toContain('1,234,567,890,123,456');
      expect(host.querySelector('.limit')?.textContent).toContain('2,345,678,901,234,567');
      expect(host.querySelector('.remaining')?.textContent).toContain('1,111,111,011,111,111');
      for (const selector of ['.spent', '.limit', '.amount-text', '.remaining', '.status-row']) {
        const part = host.querySelector(selector) as HTMLElement;
        expect(getComputedStyle(part).textOverflow).withContext(selector).not.toBe('ellipsis');
        within(part, card, selector);
      }
      expect(parseFloat(getComputedStyle(spent).fontSize))
        .withContext('scaled, and no smaller than the 12px floor')
        .toBeGreaterThanOrEqual(12);
    });
  });
});
