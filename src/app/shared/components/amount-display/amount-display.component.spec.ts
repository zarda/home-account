import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AmountDisplayComponent } from './amount-display.component';
import { CurrencyService } from '../../../core/services/currency.service';

describe('AmountDisplayComponent', () => {
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

  function createComponent(
    inputs: Record<string, unknown> = {},
  ): ComponentFixture<AmountDisplayComponent> {
    const fixture = TestBed.createComponent(AmountDisplayComponent);
    const withDefaults = { amount: 0, ...inputs };
    for (const [key, value] of Object.entries(withDefaults)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrencyService.formatCurrency.and.callFake(
      (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
    );

    TestBed.configureTestingModule({
      imports: [AmountDisplayComponent],
      providers: [{ provide: CurrencyService, useValue: mockCurrencyService }],
    });
  });

  it('should create', () => {
    expect(createComponent({ amount: 10 }).componentInstance).toBeTruthy();
  });

  describe('formattedAmount', () => {
    it('formats the absolute value through the currency service', () => {
      const component = createComponent({ amount: 100, currency: 'USD' }).componentInstance;
      expect(component.formattedAmount()).toBe('USD 100.00');
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(100, 'USD');
    });

    it('uses the magnitude for negative amounts', () => {
      const component = createComponent({ amount: -42.5, currency: 'EUR' }).componentInstance;
      expect(component.formattedAmount()).toBe('EUR 42.50');
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(42.5, 'EUR');
    });

    it('defaults the currency to USD', () => {
      const component = createComponent({ amount: 5 }).componentInstance;
      component.formattedAmount();
      expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(5, 'USD');
    });
  });

  describe('input reactivity (regression)', () => {
    // With plain @Input fields the computeds captured no signal dependencies,
    // memoized their first value and never updated again.
    it('recomputes the formatted amount when amount or currency change', () => {
      const fixture = createComponent({ amount: 100, currency: 'USD' });
      expect(fixture.componentInstance.formattedAmount()).toBe('USD 100.00');

      fixture.componentRef.setInput('amount', 250);
      fixture.detectChanges();
      expect(fixture.componentInstance.formattedAmount()).toBe('USD 250.00');

      fixture.componentRef.setInput('currency', 'EUR');
      fixture.detectChanges();
      expect(fixture.componentInstance.formattedAmount()).toBe('EUR 250.00');
    });

    it('recomputes the colour class when type changes', () => {
      const fixture = createComponent({ amount: 1, type: 'income' });
      expect(fixture.componentInstance.colorClass()).toContain('income-text');

      fixture.componentRef.setInput('type', 'expense');
      fixture.detectChanges();
      expect(fixture.componentInstance.colorClass()).toContain('expense-text');
    });

    it('updates the rendered DOM when inputs change', () => {
      const fixture = createComponent({ amount: 100, currency: 'USD' });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('USD 100.00');

      fixture.componentRef.setInput('amount', 7.5);
      fixture.detectChanges();
      expect(el.textContent).toContain('USD 7.50');
    });
  });

  describe('colorClass', () => {
    it('returns the income colour', () => {
      const component = createComponent({ amount: 1, type: 'income' }).componentInstance;
      expect(component.colorClass()).toContain('income-text');
    });

    it('returns the expense colour', () => {
      const component = createComponent({ amount: 1, type: 'expense' }).componentInstance;
      expect(component.colorClass()).toContain('expense-text');
    });

    it('returns the neutral colour by default', () => {
      const component = createComponent({ amount: 1 }).componentInstance;
      expect(component.colorClass()).toContain('gray');
    });
  });
});
