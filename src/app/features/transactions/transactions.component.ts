import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { DeviceService } from '../../core/services/device.service';
import { Transaction, TransactionFilters, Category } from '../../models';
import { TransactionListComponent } from './transaction-list/transaction-list.component';
import { TransactionFiltersComponent } from './transaction-filters/transaction-filters.component';
import { TransactionFormComponent } from './transaction-form/transaction-form.component';
import { CameraCaptureComponent } from './camera-capture/camera-capture.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TransactionListComponent,
    TransactionFiltersComponent,
    LoadingSpinnerComponent,
    TranslatePipe
  ],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
})
export class TransactionsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  readonly deviceService = inject(DeviceService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
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

  initialDate = signal<Date | undefined>(undefined);
  showAll = signal<boolean>(false);

  ngOnInit(): void {
    // Check for showAll query param (from "View All" link)
    const showAllParam = this.route.snapshot.queryParamMap.get('showAll');
    if (showAllParam === 'true') {
      this.showAll.set(true);
    }

    // Check for date query param to pre-filter
    const dateParam = this.route.snapshot.queryParamMap.get('date');
    if (dateParam) {
      const date = new Date(dateParam);
      if (!isNaN(date.getTime())) {
        this.initialDate.set(date);
      }
    }

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
    } catch {
      // Error handled silently - snackbar could be added here
    }
  }

  navigateToImportFile(): void {
    this.router.navigate(['/import/file']);
  }

  openCameraDialog(): void {
    this.dialog.open(CameraCaptureComponent, {
      width: '500px',
      maxWidth: '95vw',
    });
  }
}
