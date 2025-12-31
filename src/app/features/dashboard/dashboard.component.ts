import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';

import { MatButtonToggleModule } from '@angular/material/button-toggle';
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

type PeriodOption = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonToggleModule,
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
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        };
    }
  }
}
