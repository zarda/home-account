import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { Component, NO_ERRORS_SCHEMA, input, output, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { CategoryBreakdownComponent } from './category-breakdown.component';
import { Transaction, Category } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SpendingChartComponent } from '../../dashboard/spending-chart/spending-chart.component';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

// Stands in for the reused donut so the real template can render without
// SpendingChartComponent's own provider chain — see the identical stub in
// category-breakdown.component.spec.ts's "chart drill-down" suite.
@Component({ selector: 'app-spending-chart', standalone: true, template: '' })
class SpendingChartStubComponent {
  categoryTotals = input<{ categoryId: string; total: number; count: number }[]>([]);
  categories = input<Category[]>([]);
  categoryActivated = output<string>();
}

/**
 * The component spec blanks its own template (category-breakdown.component.
 * spec.ts:127-128), so it cannot host a layout assertion — #450's fifth site
 * lives in `.stats-grid`, inside a category's expanded detail panel.
 */
describe('overflow guard: category-breakdown grid tracks (#450)', () => {
  let fixture: ComponentFixture<CategoryBreakdownComponent>;
  let host: HTMLElement;

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
      isDefault: true,
    },
  ];

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      userId: 'user1',
      type: 'expense',
      amount: 100,
      amountInBaseCurrency: 100,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Groceries',
      date: Timestamp.fromDate(new Date(2024, 5, 15)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false,
    },
  ];

  beforeEach(async () => {
    const mockTranslationService = { t: (key: string) => key, currentLocale: signal('en') };

    await TestBed.configureTestingModule({
      imports: [CategoryBreakdownComponent, NoopAnimationsModule],
      providers: [
        {
          provide: CurrencyService,
          useValue: {
            currencies: signal([{ code: 'USD', name: 'US Dollar', symbol: '$' }]),
            getCurrencyInfo: () => ({ code: 'USD', name: 'US Dollar', symbol: '$' }),
            convert: (amount: number) => amount,
            amountInBase: (t: Transaction) => t.amountInBaseCurrency,
          },
        },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    })
      .overrideComponent(CategoryBreakdownComponent, {
        remove: {
          imports: [SpendingChartComponent, AmountDisplayComponent, CategoryChipComponent, EmptyStateComponent],
        },
        add: { imports: [SpendingChartStubComponent], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CategoryBreakdownComponent);
    fixture.componentInstance.transactions = mockTransactions;
    fixture.componentInstance.categories = mockCategories;
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => {
    host?.remove();
  });

  it('lays the stats grid out in two columns once a category panel is open', () => {
    // The 768px rule this grid is also written at (repeat(4, ...)) is not
    // observable in Karma's window — see check-grid-tracks.mjs, which is
    // what actually proves that rule parses. Its unconditional base rule
    // (repeat(2, ...)) is the one under test here, and it carried the same
    // #450 defect.
    expect(window.innerWidth)
      .withContext('Karma window; the >=768px 4-column override is not reached here')
      .toBeLessThan(768);

    const panel = fixture.debugElement.query(By.css('mat-expansion-panel'));
    expect(panel).withContext('a category panel rendered').not.toBeNull();
    panel.componentInstance.open();
    fixture.detectChanges();

    const grid = fixture.nativeElement.querySelector('.stats-grid') as HTMLElement;
    expect(grid).withContext('stats-grid rendered in the expanded panel').not.toBeNull();
    expect(getComputedStyle(grid).gridTemplateColumns.split(' ').length)
      .withContext('.stats-grid computed column count; pins the unconditional base rule (repeat(2, minmax(0, 1fr)) — the >=768px 4-column override is unreachable here)')
      .toBe(2);
  });
});
