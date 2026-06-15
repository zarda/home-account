import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FinancialSummaryComponent } from './financial-summary.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';

describe('FinancialSummaryComponent', () => {
  let component: FinancialSummaryComponent;
  let fixture: ComponentFixture<FinancialSummaryComponent>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

  beforeEach(async () => {
    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrencyService.formatCurrency.and.callFake(
      (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
    );
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [FinancialSummaryComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FinancialSummaryComponent);
    component = fixture.componentInstance;
  });

  it('should create with default inputs', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.income()).toBe(0);
    expect(component.currency()).toBe('USD');
  });

  it('reflects provided inputs', () => {
    fixture.componentRef.setInput('income', 1000);
    fixture.componentRef.setInput('expenses', 400);
    fixture.componentRef.setInput('balance', 600);
    fixture.componentRef.setInput('currency', 'EUR');
    fixture.detectChanges();

    expect(component.income()).toBe(1000);
    expect(component.expenses()).toBe(400);
    expect(component.balance()).toBe(600);
  });

  it('formatAmount delegates to the currency service with the active currency', () => {
    fixture.componentRef.setInput('currency', 'JPY');
    fixture.detectChanges();
    expect(component.formatAmount(250)).toBe('JPY 250.00');
    expect(mockCurrencyService.formatCurrency).toHaveBeenCalledWith(250, 'JPY');
  });
});
