import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { TranslationService } from '../../core/services/translation.service';
import { NotificationService } from '../../core/services/notification.service';
import { Budget, Category } from '../../models';
import { BudgetOverviewComponent } from './budget-overview/budget-overview.component';
import { BudgetFormComponent, BudgetFormDialogData } from './budget-form/budget-form.component';
import { RecurringTransactionsComponent } from './recurring-transactions/recurring-transactions.component';
import { GoalsComponent } from './goals/goals.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { AccessibilityService } from '../../core/services/accessibility.service';
import { tabIndexFromParam } from '../../core/utils/tab-query-param.utils';

/** The tab strip's sections, in the order the template lays them out. */
export const BUDGET_TABS = ['budgets', 'recurring', 'goals'] as const;

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    PageHeaderComponent,
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    BudgetOverviewComponent,
    RecurringTransactionsComponent,
    GoalsComponent,
    LoadingSpinnerComponent,
    EmptyStateComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss',
})
export class BudgetsComponent implements OnInit, OnDestroy {
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private notifications = inject(NotificationService);
  private dialog = inject(MatDialog);
  private accessibility = inject(AccessibilityService);

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

  // 0ms when the user prefers reduced motion (Material tab slide runs via the
  // Web Animations API, which the global CSS switch can't reach).
  readonly tabAnimationDuration = this.accessibility.tabAnimationDuration;

  /**
   * Which tab a ?tab= link opens on. Read once at construction rather than
   * bound to the param stream: after that the tab strip owns the selection,
   * and re-reading would drag the user back on every param change.
   */
  selectedTabIndex = tabIndexFromParam(
    inject(ActivatedRoute).snapshot.queryParamMap.get('tab'),
    BUDGET_TABS
  );

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
      error: () => {
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
        title: this.translationService.t('budget.deleteBudget'),
        message: this.translationService.t('budget.deleteConfirmMessage', { name: budget.name }),
        confirmLabel: this.translationService.t('common.delete'),
        cancelLabel: this.translationService.t('common.cancel'),
        confirmColor: 'warn',
        icon: 'delete'
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        try {
          await this.budgetService.deleteBudget(budget.id);
        } catch (error) {
          // The card stays on screen; the user has to be told the delete
          // did not happen.
          console.error('[Budgets] Delete failed:', error);
          this.notifications.error(this.translationService.t('common.error'));
        }
      }
    });
  }
}
