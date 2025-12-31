import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { Transaction, TransactionFilters, Category } from '../../models';
import { TransactionListComponent } from './transaction-list/transaction-list.component';
import { TransactionFiltersComponent } from './transaction-filters/transaction-filters.component';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    TransactionListComponent,
    TransactionFiltersComponent,
    LoadingSpinnerComponent
  ],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
})
export class TransactionsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);

  transactions = this.transactionService.transactions;
  isLoading = this.transactionService.isLoading;

  transactionCount = computed(() => this.transactions().length);

  expenseCategories = this.categoryService.expenseCategories;
  incomeCategories = this.categoryService.incomeCategories;
  categories = this.categoryService.categories;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  private currentFilters = signal<TransactionFilters>({});
  private transactionsSub?: Subscription;
  private categoriesSub?: Subscription;

  ngOnInit(): void {
    // Load categories (only once)
    this.categoriesSub = this.categoryService.loadCategories().subscribe();

    // Load transactions (real-time subscription - only once)
    this.loadTransactions();

    // Check for add action in query params
    this.route.queryParams.subscribe(params => {
      if (params['action'] === 'add') {
        setTimeout(() => this.openAddDialog(), 100);
      }
    });
  }

  ngOnDestroy(): void {
    this.transactionsSub?.unsubscribe();
    this.categoriesSub?.unsubscribe();
  }

  onFiltersChanged(filters: TransactionFilters): void {
    this.currentFilters.set(filters);
    // Unsubscribe from previous and create new subscription with new filters
    this.transactionsSub?.unsubscribe();
    this.loadTransactions(filters);
  }

  private loadTransactions(filters?: TransactionFilters): void {
    this.transactionsSub = this.transactionService.getTransactions(filters).subscribe();
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' },
    });

    // No need to reload - real-time subscription auto-updates
    dialogRef.afterClosed().subscribe();
  }

  openEditDialog(transaction: Transaction): void {
    const dialogRef = this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'edit', transaction },
    });

    // No need to reload - real-time subscription auto-updates
    dialogRef.afterClosed().subscribe();
  }

  async onDeleteTransaction(transaction: Transaction): Promise<void> {
    try {
      await this.transactionService.deleteTransaction(transaction.id);
      // No need to reload - real-time subscription auto-updates
    } catch (error) {
      console.error('Failed to delete transaction:', error);
    }
  }
}
