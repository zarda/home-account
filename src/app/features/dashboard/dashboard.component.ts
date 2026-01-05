import { Component, computed, effect, inject, OnInit, signal, ViewChild } from '@angular/core';

import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../core/services/transaction.service';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { CurrencyService } from '../../core/services/currency.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { Transaction, Category } from '../../models';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { AiSummaryComponent } from './ai-summary/ai-summary.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

type PeriodOption = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

interface CustomPeriod {
  type: 'month' | 'year';
  year: number;
  month?: number; // 0-11, only for type 'month'
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    FinancialSummaryComponent,
    SpendingChartComponent,
    RecentTransactionsComponent,
    BudgetProgressComponent,
    AiSummaryComponent,
    LoadingSpinnerComponent,
    TranslatePipe
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);

  selectedPeriod: PeriodOption = 'thisMonth';
  isLoading = signal(true);

  // Custom period selection
  customPeriod = signal<CustomPeriod | null>(null);

  customPeriodLabel = computed(() => {
    const cp = this.customPeriod();
    if (!cp) return '';
    if (cp.type === 'year') return cp.year.toString();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[cp.month!]} ${cp.year}`;
  });

  isCustomPeriod = computed(() => this.selectedPeriod === 'custom');

  // ViewChild for date pickers
  @ViewChild('monthPicker') monthPicker!: MatDatepicker<Date>;
  @ViewChild('yearPicker') yearPicker!: MatDatepicker<Date>;

  // User info
  userName = computed(() => {
    const user = this.authService.currentUser();
    return user?.displayName?.split(' ')[0] || 'User';
  });

  baseCurrency = computed(() => {
    return this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
  });

  // Transaction data
  transactions = this.transactionService.transactions;
  recentTransactions = signal<Transaction[]>([]);
  previousPeriodData = signal<{ income: number; expense: number } | null>(null);

  // Compute totals with real-time currency conversion to user's base currency
  totalIncome = computed(() => {
    const baseCurrency = this.baseCurrency();
    return this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + this.currencyService.convert(t.amount, t.currency, baseCurrency), 0);
  });

  totalExpenses = computed(() => {
    const baseCurrency = this.baseCurrency();
    return this.transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + this.currencyService.convert(t.amount, t.currency, baseCurrency), 0);
  });

  balance = computed(() => this.totalIncome() - this.totalExpenses());

  categoryTotals = computed(() => {
    const baseCurrency = this.baseCurrency();
    const transactions = this.transactions();
    const expenseTransactions = transactions.filter(t => t.type === 'expense');

    const totals = new Map<string, { total: number; count: number }>();
    for (const t of expenseTransactions) {
      const current = totals.get(t.categoryId) || { total: 0, count: 0 };
      const convertedAmount = this.currencyService.convert(t.amount, t.currency, baseCurrency);
      totals.set(t.categoryId, { total: current.total + convertedAmount, count: current.count + 1 });
    }

    return Array.from(totals.entries())
      .map(([categoryId, data]) => ({ categoryId, total: data.total, count: data.count }))
      .sort((a, b) => b.total - a.total);
  });

  // Category data
  categories = this.categoryService.categories;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  // Budget data
  activeBudgets = this.budgetService.activeBudgets;

  constructor() {
    effect(() => {
      // Update loading state based on service loading states
      const txLoading = this.transactionService.isLoading();
      const budgetLoading = this.budgetService.isLoading();
      // Don't set loading to true once we have data
      if (!txLoading && !budgetLoading && this.transactionService.transactions().length >= 0) {
        this.isLoading.set(false);
      }
    });
  }

  ngOnInit(): void {
    this.loadData();
  }

  onPeriodChange(): void {
    this.customPeriod.set(null); // Clear custom when toggle clicked
    this.loadData();
  }

  // Month/Year picker methods
  openMonthPicker(): void {
    this.monthPicker.open();
  }

  openYearPicker(): void {
    this.yearPicker.open();
  }

  onMonthSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.customPeriod.set({
      type: 'month',
      year: date.getFullYear(),
      month: date.getMonth()
    });
    this.selectedPeriod = 'custom';
    this.loadData();
  }

  onYearSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.customPeriod.set({
      type: 'year',
      year: date.getFullYear()
    });
    this.selectedPeriod = 'custom';
    this.loadData();
  }

  clearCustomPeriod(): void {
    this.customPeriod.set(null);
    this.selectedPeriod = 'thisMonth';
    this.loadData();
  }

  private loadData(): void {
    this.isLoading.set(true);
    const { start, end } = this.getPeriodDates();

    // Load transactions for the period
    this.transactionService.getByDateRange(start, end).subscribe({
      next: () => {
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });

    // Load recent transactions
    this.transactionService.getRecentTransactions(5).subscribe({
      next: (transactions) => {
        this.recentTransactions.set(transactions);
      }
    });

    // Load previous period data for AI comparison
    this.loadPreviousPeriodData();

    // Load budgets
    this.budgetService.getBudgets().subscribe();

    // Load categories
    this.categoryService.loadCategories().subscribe();
  }

  private loadPreviousPeriodData(): void {
    const prevDates = this.getPreviousPeriodDates();
    if (!prevDates) {
      this.previousPeriodData.set(null);
      return;
    }

    // Use getPeriodTotals which doesn't update the main transactions signal
    this.transactionService.getPeriodTotals(prevDates.start, prevDates.end).subscribe({
      next: (totals) => {
        this.previousPeriodData.set(totals);
      },
      error: () => {
        this.previousPeriodData.set(null);
      }
    });
  }

  private getPreviousPeriodDates(): { start: Date; end: Date } | null {
    const now = new Date();

    // Handle custom period
    if (this.selectedPeriod === 'custom') {
      const cp = this.customPeriod();
      if (cp) {
        if (cp.type === 'month') {
          // Previous month
          const month = cp.month!;
          const prevMonth = month === 0 ? 11 : month - 1;
          const prevYear = month === 0 ? cp.year - 1 : cp.year;
          return {
            start: new Date(prevYear, prevMonth, 1),
            end: new Date(prevYear, prevMonth + 1, 0, 23, 59, 59)
          };
        } else {
          // Previous year
          return {
            start: new Date(cp.year - 1, 0, 1),
            end: new Date(cp.year - 1, 11, 31, 23, 59, 59)
          };
        }
      }
    }

    switch (this.selectedPeriod) {
      case 'thisMonth':
        // Compare with last month
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        };

      case 'lastMonth':
        // Compare with 2 months ago
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59)
        };

      case 'last3Months':
        // Compare with previous 3 months (months -5 to -3)
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 5, 1),
          end: new Date(now.getFullYear(), now.getMonth() - 2, 0, 23, 59, 59)
        };

      case 'thisYear':
        // Compare with last year
        return {
          start: new Date(now.getFullYear() - 1, 0, 1),
          end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59)
        };

      default:
        return null;
    }
  }

  private getPeriodDates(): { start: Date; end: Date } {
    const now = new Date();

    // Handle custom period first
    if (this.selectedPeriod === 'custom') {
      const cp = this.customPeriod();
      if (cp) {
        if (cp.type === 'month') {
          return {
            start: new Date(cp.year, cp.month!, 1),
            end: new Date(cp.year, cp.month! + 1, 0, 23, 59, 59)
          };
        } else {
          // Full year
          return {
            start: new Date(cp.year, 0, 1),
            end: new Date(cp.year, 11, 31, 23, 59, 59)
          };
        }
      }
    }

    // End of today for current periods
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (this.selectedPeriod) {
      case 'thisMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: endOfToday
        };

      case 'lastMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        };

      case 'last3Months':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: endOfToday
        };

      case 'thisYear':
      default:
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: endOfToday
        };
    }
  }
}
