import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetProgressCardComponent } from './budget-progress-card.component';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { Budget, Category } from '../../../models';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';

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
    it('should return green class for under 50%', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 40 }));
      expect(component.statusClass()).toBe('text-green-600');
    });

    it('should return green class while under the alert threshold', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 60 }));
      expect(component.statusClass()).toBe('text-green-600');
    });

    it('should return yellow class in the warning band', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85 }));
      expect(component.statusClass()).toBe('text-yellow-600');
    });

    it('should return orange class in the critical band', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 92 }));
      expect(component.statusClass()).toBe('text-orange-500');
    });

    it('should return red class with semibold for 100% and over', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 110 }));
      expect(component.statusClass()).toBe('text-red-600 font-semibold');
    });
  });

  describe('signal consistency', () => {
    it('bar, percentage text and chip all agree in the warning band', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 100, spent: 85 }));
      expect(component.alertSeverity()).toBe('warning');
      expect(component.progressColor()).toBe('accent');
      expect(component.statusClass()).toBe('text-yellow-600');
    });

    it('bar, percentage text and chip all agree when exceeded', () => {
      fixture.componentRef.setInput('budget', createMockBudget({ amount: 300, spent: 350.49 }));
      expect(component.alertSeverity()).toBe('exceeded');
      expect(component.progressColor()).toBe('warn');
      expect(component.statusClass()).toBe('text-red-600 font-semibold');
      expect(component.percentage()).toBeGreaterThan(100);
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

  // The household page shows other members' budgets, which only their owner
  // can change: the card there offers nothing to act on.
  describe('read-only', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('budget', createMockBudget());
      fixture.componentRef.setInput('category', mockCategory);
    });

    it('keeps its menu by default, as the Budgets page shows it', () => {
      fixture.detectChanges();

      expect(component.readOnly()).toBeFalse();
      expect(fixture.nativeElement.querySelector('.menu-btn')).not.toBeNull();
    });

    it('drops the whole menu, its trigger included, and keeps the figures', () => {
      fixture.componentRef.setInput('readOnly', true);
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('.menu-btn')).toBeNull();
      expect(compiled.querySelector('mat-menu')).toBeNull();
      // The progress bar carries Material's own tabindex="-1": no tab stop.
      expect(compiled.querySelectorAll('button, a, [tabindex]:not([tabindex="-1"])').length).toBe(0);
      expect(compiled.textContent).toContain('Food Budget');
      expect(compiled.querySelector('.spent')?.textContent?.trim()).toBe('$500.00');
      expect(compiled.querySelector('mat-progress-bar')).not.toBeNull();
    });
  });

  // The Budgets page lists the cards under the page's own heading; the
  // household page lists them under a member's h3.
  describe('its heading', () => {
    beforeEach(() => fixture.componentRef.setInput('budget', createMockBudget()));

    it('names the budget in an h3 by default', () => {
      fixture.detectChanges();

      const name = fixture.nativeElement.querySelector('.budget-name') as HTMLElement;
      expect(name.tagName).toBe('H3');
      expect(name.textContent?.trim()).toBe('Food Budget');
    });

    it('names it one level down when listed under a lower heading', () => {
      fixture.componentRef.setInput('headingLevel', 4);
      fixture.detectChanges();

      const name = fixture.nativeElement.querySelector('.budget-name') as HTMLElement;
      expect(name.tagName).toBe('H4');
      expect(fixture.nativeElement.querySelector('h3')).toBeNull();
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
