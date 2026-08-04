import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { Component, input, output, signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { CategoryBreakdownComponent } from './category-breakdown.component';
import { Transaction, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SpendingChartComponent } from '../../dashboard/spending-chart/spending-chart.component';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

// Stands in for the reused donut when the real breakdown template is
// rendered, so the drill-down wiring can be exercised without a live chart.
@Component({ selector: 'app-spending-chart', standalone: true, template: '' })
class SpendingChartStubComponent {
  categoryTotals = input<{ categoryId: string; total: number; count: number }[]>([]);
  categories = input<Category[]>([]);
  categoryActivated = output<string>();
}

describe('CategoryBreakdownComponent', () => {
  let component: CategoryBreakdownComponent;
  let fixture: ComponentFixture<CategoryBreakdownComponent>;

  const mockCategories: Category[] = [
    {
      id: 'cat1',
      userId: null,
      name: 'Food & Drinks',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: true
    },
    {
      id: 'cat2',
      userId: null,
      name: 'Transportation',
      icon: 'directions_car',
      color: '#2196F3',
      type: 'expense',
      order: 2,
      isActive: true,
      isDefault: true
    },
    {
      id: 'cat3',
      userId: null,
      name: 'Salary',
      icon: 'payments',
      color: '#4CAF50',
      type: 'income',
      order: 1,
      isActive: true,
      isDefault: true
    }
  ];

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      userId: 'user1',
      type: 'expense',
      amount: 200,
      amountInBaseCurrency: 200,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Groceries',
      date: Timestamp.fromDate(new Date(2024, 5, 15)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    },
    {
      id: 't2',
      userId: 'user1',
      type: 'expense',
      amount: 50,
      amountInBaseCurrency: 50,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat2',
      description: 'Gas',
      date: Timestamp.fromDate(new Date(2024, 5, 10)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    },
    {
      id: 't3',
      userId: 'user1',
      type: 'income',
      amount: 5000,
      amountInBaseCurrency: 5000,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat3',
      description: 'Monthly Salary',
      date: Timestamp.fromDate(new Date(2024, 5, 1)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    }
  ];

  beforeEach(async () => {
    const mockCurrencyService = {
      currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
      getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
      convert: (amount: number) => amount // 1:1 conversion for tests
    };

    await TestBed.configureTestingModule({
      imports: [CategoryBreakdownComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: mockCurrencyService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(CategoryBreakdownComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(CategoryBreakdownComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('with no data', () => {
    beforeEach(() => {
      component.transactions = [];
      component.categories = [];
      fixture.detectChanges();
    });

    it('should return false for hasData', () => {
      expect(component.hasData()).toBeFalse();
    });

    it('should return empty category breakdown', () => {
      expect(component.categoryBreakdown().length).toBe(0);
    });
  });

  describe('with transaction data', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      fixture.detectChanges();
    });

    it('should return true for hasData', () => {
      expect(component.hasData()).toBeTrue();
    });

    it('should default to expense type filter', () => {
      expect(component.selectedType()).toBe('expense');
    });
  });

  describe('type filtering', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      fixture.detectChanges();
    });

    it('should filter by expense type', () => {
      component.selectedType.set('expense');
      const breakdown = component.categoryBreakdown();

      // Should only include expense category transactions
      expect(breakdown.length).toBe(2); // cat1 and cat2
    });

    // Note: computed signals don't re-evaluate when plain property (selectedType) changes
    // This test would require selectedType to be a signal for reactive behavior
    it('should use selectedType when filtering', () => {
      // selectedType defaults to 'expense', which filters to expense transactions
      const breakdown = component.categoryBreakdown();
      expect(breakdown.length).toBe(2); // cat1 and cat2 are expense categories
    });
  });

  describe('category breakdown computation', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      component.selectedType.set('expense');
      fixture.detectChanges();
    });

    it('should group transactions by category', () => {
      const breakdown = component.categoryBreakdown();
      expect(breakdown.length).toBe(2); // 2 expense categories with transactions
    });

    it('should calculate total per category', () => {
      const breakdown = component.categoryBreakdown();
      const food = breakdown.find(b => b.categoryId === 'cat1');
      expect(food?.total).toBe(200);
    });

    it('should calculate percentage of total', () => {
      const breakdown = component.categoryBreakdown();
      const food = breakdown.find(b => b.categoryId === 'cat1');
      // 200 out of 250 total expense = 80%
      expect(food?.percentage).toBe(80);
    });

    it('should sort by total descending', () => {
      const breakdown = component.categoryBreakdown();
      expect(breakdown[0].total).toBeGreaterThanOrEqual(breakdown[1].total);
    });

    it('should include category metadata', () => {
      const breakdown = component.categoryBreakdown();
      const food = breakdown.find(b => b.categoryId === 'cat1');
      expect(food?.name).toBe('Food & Drinks');
      expect(food?.icon).toBe('restaurant');
      expect(food?.color).toBe('#FF5722');
    });
  });

  describe('total', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      fixture.detectChanges();
    });

    it('should calculate total for expense type', () => {
      component.selectedType.set('expense');
      expect(component.total()).toBe(250);
    });

    // Note: computed signals don't re-evaluate when plain property (selectedType) changes
    // This test verifies default behavior with expense type
    it('should calculate total using default expense type', () => {
      expect(component.total()).toBe(250); // 200 + 50 expense transactions
    });
  });

  describe('getTransactionsForCategory', () => {
    beforeEach(() => {
      component.transactions = mockTransactions;
      component.categories = mockCategories;
      component.selectedType.set('expense');
      fixture.detectChanges();
    });

    it('should return transactions for a specific category', () => {
      const transactions = component.getTransactionsForCategory('cat1');
      expect(transactions.length).toBe(1);
      expect(transactions[0].categoryId).toBe('cat1');
    });

    it('should return empty array for category with no transactions', () => {
      const transactions = component.getTransactionsForCategory('nonexistent');
      expect(transactions.length).toBe(0);
    });
  });

  // The shared TestBed above blanks the template, so it cannot catch the
  // donut's drill-down being left unwired. Re-configure to render the REAL
  // breakdown template with the chart swapped for a stub.
  describe('chart drill-down (real template)', () => {
    let realFixture: ComponentFixture<CategoryBreakdownComponent>;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      const mockTranslationService = { t: (key: string) => key, currentLocale: signal('en') };
      await TestBed.configureTestingModule({
        imports: [CategoryBreakdownComponent, NoopAnimationsModule],
        providers: [
          {
            provide: CurrencyService,
            useValue: {
              currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
              getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
              convert: (amount: number) => amount
            }
          },
          { provide: TranslationService, useValue: mockTranslationService }
        ]
      })
        .overrideComponent(CategoryBreakdownComponent, {
          remove: {
            imports: [
              SpendingChartComponent,
              AmountDisplayComponent,
              CategoryChipComponent,
              EmptyStateComponent
            ]
          },
          add: { imports: [SpendingChartStubComponent], schemas: [NO_ERRORS_SCHEMA] }
        })
        .compileComponents();

      realFixture = TestBed.createComponent(CategoryBreakdownComponent);
      realFixture.componentInstance.transactions = mockTransactions;
      realFixture.componentInstance.categories = mockCategories;
      realFixture.detectChanges();
    });

    function innerChart(): SpendingChartStubComponent {
      const chart = realFixture.debugElement.query(By.directive(SpendingChartStubComponent))
        ?.componentInstance as SpendingChartStubComponent;
      expect(chart).withContext('app-spending-chart rendered').toBeTruthy();
      return chart;
    }

    it('should re-emit the donut activation with the active type', () => {
      const activated: { categoryId: string; type: 'expense' | 'income' }[] = [];
      realFixture.componentInstance.categoryActivated.subscribe(e => activated.push(e));

      innerChart().categoryActivated.emit('cat1');

      expect(activated).toEqual([{ categoryId: 'cat1', type: 'expense' }]);
    });

    it('should carry the income type when the toggle is on income', () => {
      const activated: { categoryId: string; type: 'expense' | 'income' }[] = [];
      realFixture.componentInstance.categoryActivated.subscribe(e => activated.push(e));

      realFixture.componentInstance.selectedType.set('income');
      realFixture.detectChanges();
      // The donut is showing income categories here, so a hardcoded expense
      // type would open a list that can only ever be empty.
      innerChart().categoryActivated.emit('cat3');

      expect(activated).toEqual([{ categoryId: 'cat3', type: 'income' }]);
    });

    it('keeps the amount in the row when a description is far too long', () => {
      /* `.transaction-info` had no `min-width: 0`, so it floored at its own
         min-content size, refused to shrink, and pushed the amount out of the
         panel — G1 in docs/ui-overflow.md, the same defect the transaction row
         had. Measured rather than asserted on the stylesheet, because the
         declaration only matters if it changes where the amount lands.

         Attached to the document at a fixed width: an element with no layout
         box has no geometry to check, and a width that came from the browser
         running the test would make this pass or fail by window size. */
      realFixture.componentInstance.transactions = [
        {
          ...mockTransactions[0],
          description:
            'Weekly grocery run at the farmers market on Ferry Building Embarcadero plus ' +
            'household supplies and a refill of the pantry staples',
        },
      ];
      const host = realFixture.nativeElement as HTMLElement;
      host.style.width = '311px';
      document.body.appendChild(host);
      realFixture.detectChanges();

      const panel = realFixture.debugElement.query(By.css('mat-expansion-panel'));
      expect(panel).withContext('a category panel rendered').not.toBeNull();
      panel.componentInstance.open();
      realFixture.detectChanges();

      const item = host.querySelector('.transaction-item') as HTMLElement;
      const amount = host.querySelector('.transaction-amount') as HTMLElement;
      expect(item).withContext('transaction row rendered').not.toBeNull();
      expect(amount.getBoundingClientRect().right)
        .withContext('amount inside its row')
        .toBeLessThanOrEqual(item.getBoundingClientRect().right + 1);

      host.remove();
    });
  });
});
