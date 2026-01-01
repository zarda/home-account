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
import { AuthService } from '../../core/services/auth.service';
import { Transaction, Category } from '../../models';
import { FinancialSummaryComponent } from './financial-summary/financial-summary.component';
import { SpendingChartComponent } from './spending-chart/spending-chart.component';
import { RecentTransactionsComponent } from './recent-transactions/recent-transactions.component';
import { BudgetProgressComponent } from './budget-progress/budget-progress.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';

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
    LoadingSpinnerComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private authService = inject(AuthService);

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
  totalIncome = this.transactionService.totalIncome;
  totalExpenses = this.transactionService.totalExpense;
  balance = this.transactionService.balance;
  transactions = this.transactionService.transactions;
  recentTransactions = signal<Transaction[]>([]);

  categoryTotals = computed(() => {
    const transactions = this.transactionService.transactions();
    const expenseTransactions = transactions.filter(t => t.type === 'expense');

    const totals = new Map<string, number>();
    for (const t of expenseTransactions) {
      const current = totals.get(t.categoryId) || 0;
      totals.set(t.categoryId, current + t.amountInBaseCurrency);
    }

    return Array.from(totals.entries())
      .map(([categoryId, total]) => ({ categoryId, total }))
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

    // Load budgets
    this.budgetService.getBudgets().subscribe();

    // Load categories
    this.categoryService.loadCategories().subscribe();
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

    switch (this.selectedPeriod) {
      case 'thisMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        };

      case 'lastMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        };

      case 'last3Months':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        };

      case 'thisYear':
      default:
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        };
    }
  }
}
