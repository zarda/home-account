import { Component, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import {
  StorableRecurringGroup,
  StorableRecurringSummary,
  Transaction,
} from '../../../../models';
import { cadenceKey } from '../../../../core/utils/insight-card.utils';
import { CategoryChipComponent } from '../../../../shared/components/category-chip/category-chip.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { InsightTransactionListComponent } from '../insight-card/insight-transaction-list.component';

/**
 * The recurring payments behind the portfolio card, one row each.
 *
 * Declared and detected groups are shown in separate sections. The user already
 * configured the declared ones, so presenting them as a discovery would be
 * wrong; keeping them apart is also what stops the portfolio total from
 * double-counting a rule whose occurrences also look like a pattern.
 *
 * Each row drills down in place, because a fuzzy cluster's members have
 * different descriptions by construction and no filter set can select exactly
 * them.
 */
@Component({
  selector: 'app-recurring-list',
  standalone: true,
  imports: [
    CurrencyPipe,
    NgTemplateOutlet,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    CategoryChipComponent,
    TranslatePipe,
    InsightTransactionListComponent,
  ],
  templateUrl: './recurring-list.component.html',
  styleUrl: './recurring-list.component.scss',
})
export class RecurringListComponent {
  private categoryService = inject(CategoryService);
  private translation = inject(TranslationService);

  summary = input.required<StorableRecurringSummary>();
  currency = input.required<string>();
  drillDownIds = input<Record<string, string[]>>({});
  lookup = input<Map<string, Transaction>>(new Map());
  /** Frozen snapshots keep no transaction ids, so rows cannot be expanded. */
  archived = input(false);

  private expanded = signal<string | null>(null);

  readonly declared = computed(
    () => this.summary().groups.filter(group => group.source === 'declared'));
  readonly detected = computed(
    () => this.summary().groups.filter(group => group.source === 'detected'));

  readonly hasHiddenGroups = computed(
    () => this.summary().groupCount > this.summary().groups.length);

  readonly hiddenCount = computed(
    () => this.summary().groupCount - this.summary().groups.length);

  categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(item => item.id === categoryId);
    return category?.name ? this.translation.t(category.name) : categoryId;
  }

  categoryIcon(categoryId: string): string {
    return this.categoryService.categories()
      .find(item => item.id === categoryId)?.icon ?? 'category';
  }

  categoryColor(categoryId: string): string {
    return this.categoryService.categories()
      .find(item => item.id === categoryId)?.color ?? '#9E9E9E';
  }

  cadenceLabel(group: StorableRecurringGroup): string {
    return this.translation.t(cadenceKey(group.cadence));
  }

  idsFor(group: StorableRecurringGroup): string[] {
    return this.drillDownIds()[`recurring:${group.key}`] ?? [];
  }

  canExpand(group: StorableRecurringGroup): boolean {
    return !this.archived() && this.idsFor(group).length > 0;
  }

  isExpanded(group: StorableRecurringGroup): boolean {
    return this.expanded() === group.key;
  }

  toggle(group: StorableRecurringGroup): void {
    this.expanded.update(current => (current === group.key ? null : group.key));
  }
}
