import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabGroup, MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
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
import { TabStripScrollDirective } from '../../shared/directives/tab-strip-scroll.directive';
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
    TabStripScrollDirective,
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
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

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
   * The tab shown. A ?tab= link sets it, as the page is built and while it
   * is open (a budget alert's link is /budgets?tab=budgets, and the page it
   * is tapped on may be this one, on another tab); after that the tab strip
   * owns it, through `selectedIndexChange`. Without that binding the strip
   * moved on its own and this still held the tab the last link named, so a
   * second link to that tab changed nothing.
   */
  selectedTabIndex = tabIndexFromParam(this.route.snapshot.queryParamMap.get('tab'), BUDGET_TABS);

  private tabStrip = viewChild(MatTabGroup);

  private budgetsSub?: Subscription;
  private categoriesSub?: Subscription;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => this.followTabLink(params));
  }

  /**
   * Opens the tab a link names, then takes the name off the URL (as the
   * dashboard does with a reminder's `bill` and `recap`, ADR 0082). It names
   * something to do once: left there, a change of any other parameter would
   * drag the reader back to it, and a second tap on the same alert would be a
   * navigation to the URL the page is already on, which the router ignores.
   * The stripped URL comes back through here and does nothing.
   */
  private followTabLink(params: ParamMap): void {
    if (!params.has('tab')) return;
    const index = tabIndexFromParam(params.get('tab'), BUDGET_TABS);
    this.selectedTabIndex = index;
    // And the strip itself, where it has rendered. The binding writes only a
    // value that differs from the last one it wrote, and the strip reports a
    // tab the reader chose a turn after it moves: a link that arrives inside
    // that turn finds the field still on the tab the last link named, and
    // the binding would write nothing.
    const strip = this.tabStrip();
    if (strip) strip.selectedIndex = index;
    this.cdr.markForCheck();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

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
