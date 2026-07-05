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

  describe('period-over-period deltas', () => {
    function setPeriodInputs(inputs: Record<string, number | null>): void {
      for (const [name, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(name, value);
      }
    }

    it('computes income and expense % change from the previous period', () => {
      setPeriodInputs({ income: 1200, expenses: 300, previousIncome: 1000, previousExpenses: 400 });
      fixture.detectChanges();

      expect(component.incomeChange()).toBeCloseTo(20, 5);
      expect(component.expensesChange()).toBeCloseTo(-25, 5);
    });

    it('computes balance % change against the absolute previous balance', () => {
      setPeriodInputs({
        income: 1200,
        expenses: 300,
        balance: 900,
        previousIncome: 1000,
        previousExpenses: 400,
      });
      fixture.detectChanges();

      // Previous balance is 600, current is 900 -> +50%
      expect(component.balanceChange()).toBeCloseTo(50, 5);
    });

    it('uses |previous balance| as denominator when the previous balance was negative', () => {
      setPeriodInputs({ balance: 300, previousIncome: 100, previousExpenses: 400 });
      fixture.detectChanges();

      // Previous balance is -300, current is 300 -> +200% of |−300|
      expect(component.balanceChange()).toBeCloseTo(200, 5);
    });

    it('returns null for every change when no previous period data is provided', () => {
      fixture.detectChanges();

      expect(component.incomeChange()).toBeNull();
      expect(component.expensesChange()).toBeNull();
      expect(component.balanceChange()).toBeNull();
    });

    it('returns null when previous values are zero', () => {
      setPeriodInputs({ income: 1200, expenses: 300, previousIncome: 0, previousExpenses: 0 });
      fixture.detectChanges();

      expect(component.incomeChange()).toBeNull();
      expect(component.expensesChange()).toBeNull();
      expect(component.balanceChange()).toBeNull();
    });

    it('returns null balance change when the previous balance nets to zero', () => {
      setPeriodInputs({ balance: 100, previousIncome: 500, previousExpenses: 500 });
      fixture.detectChanges();

      expect(component.balanceChange()).toBeNull();
    });

    it('renders shared stat-card delta chips with direction classes and formatted percentages', () => {
      setPeriodInputs({
        income: 1200,
        expenses: 300,
        balance: 900,
        previousIncome: 1000,
        previousExpenses: 400,
      });
      fixture.detectChanges();

      const chips: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.delta-chip');
      expect(chips.length).toBe(3);

      const [incomeChip, expensesChip, balanceChip] = Array.from(chips);
      expect(incomeChip.classList.contains('positive')).toBeTrue();
      expect(incomeChip.querySelector('mat-icon')?.textContent).toContain('arrow_upward');
      expect(incomeChip.textContent).toContain('20.0%');

      // Expenses dropped: green (positive) chip with a factual downward arrow
      expect(expensesChip.classList.contains('positive')).toBeTrue();
      expect(expensesChip.querySelector('mat-icon')?.textContent).toContain('arrow_downward');
      expect(expensesChip.textContent).toContain('-25.0%');

      expect(balanceChip.classList.contains('positive')).toBeTrue();
      expect(balanceChip.textContent).toContain('50.0%');
    });

    it('marks rising expenses as negative while keeping the arrow factual', () => {
      setPeriodInputs({ expenses: 500, previousExpenses: 400 });
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.delta-chip');
      expect(chip.classList.contains('negative')).toBeTrue();
      expect(chip.classList.contains('positive')).toBeFalse();
      expect(chip.querySelector('mat-icon')?.textContent).toContain('arrow_upward');
      expect(chip.textContent).toContain('25.0%');
    });

    it('keeps the semantic icon tiles regardless of delta presence', () => {
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('.delta-chip').length).toBe(0);
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('trending_up');
      expect(text).toContain('trending_down');
      expect(text).toContain('account_balance_wallet');
    });

    it('captions each chip with the vs-previous-period translation key', () => {
      setPeriodInputs({
        income: 1200,
        expenses: 300,
        balance: 900,
        previousIncome: 1000,
        previousExpenses: 400,
      });
      fixture.detectChanges();

      const captions: NodeListOf<HTMLElement> =
        fixture.nativeElement.querySelectorAll('.delta-caption');
      expect(captions.length).toBe(3);
      expect(captions[0].textContent).toContain('dashboard.vsPreviousPeriod');
    });
  });
});
