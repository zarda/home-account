import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightSnapshot } from '../../../../models';
import {
  SnapshotComparison,
  compareSnapshots,
  isComparison,
} from '../../../../core/utils/insight-snapshot.utils';
import { parseMonthKey } from '../../../../core/utils/transaction-date.utils';
import { LocaleNumberPipe } from '../../../../shared/pipes/locale-number.pipe';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * Two stored months, side by side.
 *
 * Refuses outright when the two were computed against different base currencies.
 * Their money fields are in different units and the historical rates behind each
 * figure are not stored, so a difference would be a confident number that means
 * nothing.
 */
@Component({
  selector: 'app-snapshot-compare',
  standalone: true,
  imports: [
    CurrencyPipe,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    LocaleNumberPipe,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './snapshot-compare.component.html',
  styleUrl: './snapshot-compare.component.scss',
})
export class SnapshotCompareComponent {
  private categoryService = inject(CategoryService);
  private translation = inject(TranslationService);

  snapshots = input.required<InsightSnapshot[]>();

  /** Defaults to the two most recent months, oldest of the pair on the left. */
  private fromMonth = signal<string | null>(null);
  private toMonth = signal<string | null>(null);

  readonly canCompare = computed(() => this.snapshots().length >= 2);

  readonly selectedFrom = computed(() => {
    const explicit = this.fromMonth();
    if (explicit) {
      return explicit;
    }
    const rows = this.snapshots();
    return rows.length >= 2 ? rows[1].monthKey : null;
  });

  readonly selectedTo = computed(() => {
    const explicit = this.toMonth();
    return explicit ?? this.snapshots()[0]?.monthKey ?? null;
  });

  private result = computed(() => {
    const from = this.snapshots().find(s => s.monthKey === this.selectedFrom());
    const to = this.snapshots().find(s => s.monthKey === this.selectedTo());
    return from && to ? compareSnapshots(from, to) : null;
  });

  readonly comparison = computed<SnapshotComparison | null>(() => {
    const result = this.result();
    return result && isComparison(result) ? result : null;
  });

  readonly refusal = computed<string | null>(() => {
    const result = this.result();
    if (!result || isComparison(result)) {
      return null;
    }
    return result.reason === 'baseCurrencyMismatch'
      ? 'insights.compareCurrencyMismatch'
      : 'insights.compareSameMonth';
  });

  /** Categories that moved, then the unchanged ones — both worth saying. */
  readonly changed = computed(
    () => this.comparison()?.categories.filter(entry => !entry.unchanged) ?? []);
  readonly unchanged = computed(
    () => this.comparison()?.categories.filter(entry => entry.unchanged) ?? []);

  monthLabel(monthKey: string): string {
    const parsed = parseMonthKey(monthKey);
    return parsed
      ? new Date(parsed.year, parsed.month, 1).toLocaleDateString(
        this.translation.getIntlLocale(), { month: 'long', year: 'numeric' })
      : monthKey;
  }

  categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(item => item.id === categoryId);
    return category?.name ? this.translation.t(category.name) : categoryId;
  }

  onFromChange(monthKey: string): void {
    this.fromMonth.set(monthKey);
  }

  onToChange(monthKey: string): void {
    this.toMonth.set(monthKey);
  }
}
