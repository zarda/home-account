import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AmountDisplayComponent } from './amount-display.component';
import { CurrencyService } from '../../../core/services/currency.service';

describe('AmountDisplayComponent', () => {
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

  function createComponent(
    inputs: Partial<AmountDisplayComponent> = {},
  ): ComponentFixture<AmountDisplayComponent> {
    const fixture = TestBed.createComponent(AmountDisplayComponent);
    Object.assign(fixture.componentInstance, { amount: 0, ...inputs });
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

  describe('colorClass', () => {
    it('returns the income colour', () => {
      const component = createComponent({ amount: 1, type: 'income' }).componentInstance;
      expect(component.colorClass()).toContain('green');
    });

    it('returns the expense colour', () => {
      const component = createComponent({ amount: 1, type: 'expense' }).componentInstance;
      expect(component.colorClass()).toContain('red');
    });

    it('returns the neutral colour by default', () => {
      const component = createComponent({ amount: 1 }).componentInstance;
      expect(component.colorClass()).toContain('gray');
    });
  });
});
