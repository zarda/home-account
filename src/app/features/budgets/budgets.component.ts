import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { Subscription } from 'rxjs';

import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { Budget, Category } from '../../models';
import { BudgetOverviewComponent } from './budget-overview/budget-overview.component';
import { BudgetFormComponent, BudgetFormDialogData } from './budget-form/budget-form.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    BudgetOverviewComponent,
    LoadingSpinnerComponent,
    EmptyStateComponent
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent implements OnInit, OnDestroy {
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private dialog = inject(MatDialog);

  budgets = this.budgetService.budgets;
  isLoading = signal(true);

  categories = this.categoryService.categories;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  budgetCount = computed(() => this.budgets().length);

  private budgetsSub?: Subscription;
  private categoriesSub?: Subscription;

  ngOnInit(): void {
    // Load categories if not already loaded
    if (this.categories().length === 0) {
      this.categoriesSub = this.categoryService.loadCategories().subscribe();
    }

    // Load budgets (real-time subscription)
    this.loadBudgets();
  }

  ngOnDestroy(): void {
    this.budgetsSub?.unsubscribe();
    this.categoriesSub?.unsubscribe();
  }

  private loadBudgets(): void {
    this.isLoading.set(true);
    this.budgetsSub = this.budgetService.getBudgets().subscribe({
      next: () => {
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load budgets:', error);
        this.isLoading.set(false);
      }
    });
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(BudgetFormComponent, {
      width: '480px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' } as BudgetFormDialogData,
    });

    // Real-time subscription auto-updates
    dialogRef.afterClosed().subscribe();
  }

  openEditDialog(budget: Budget): void {
    const dialogRef = this.dialog.open(BudgetFormComponent, {
      width: '480px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'edit', budget } as BudgetFormDialogData,
    });

    // Real-time subscription auto-updates
    dialogRef.afterClosed().subscribe();
  }

  confirmDelete(budget: Budget): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Delete Budget',
        message: `Are you sure you want to delete "${budget.name}"? This action cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
        icon: 'delete'
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        try {
          await this.budgetService.deleteBudget(budget.id);
        } catch (error) {
          console.error('Failed to delete budget:', error);
        }
      }
    });
  }
}
