import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightSnapshot, SnapshotStaleness } from '../../../../models';
import { parseMonthKey } from '../../../../core/utils/transaction-date.utils';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * Month chips for the stored snapshot history, newest first.
 *
 * Selecting a month swaps the card area for that month's frozen cards. The
 * staleness strip lives here rather than in a snackbar: NotificationService's own
 * contract is that snackbars are transient feedback only, and "the data behind
 * this changed" has to persist until the user acts on it.
 */
@Component({
  selector: 'app-snapshot-timeline',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './snapshot-timeline.component.html',
  styleUrl: './snapshot-timeline.component.scss',
})
export class SnapshotTimelineComponent {
  private translation = inject(TranslationService);

  snapshots = input.required<InsightSnapshot[]>();
  selectedMonth = input<string | null>(null);
  staleness = input<SnapshotStaleness | null>(null);
  isRegenerating = input(false);

  readonly monthSelected = output<string | null>();
  readonly regenerateRequested = output<string>();

  readonly hasSnapshots = computed(() => this.snapshots().length > 0);

  readonly selected = computed<InsightSnapshot | null>(() => {
    const month = this.selectedMonth();
    return month
      ? this.snapshots().find(snapshot => snapshot.monthKey === month) ?? null
      : null;
  });

  /** Reasons that mean the user's own data moved — worth a warning strip. */
  readonly staleReasons = computed(() => {
    const state = this.staleness();
    return state?.isStale ? state.reasons.filter(reason => reason !== 'detectorUpdated') : [];
  });

  /**
   * A detector change with no data change. Shown as a quiet footnote, because
   * telling the user their data changed when only our code did would be false.
   */
  readonly showsDetectorNote = computed(() => {
    const state = this.staleness();
    return !!state && !state.isStale && state.reasons.includes('detectorUpdated');
  });

  monthLabel(monthKey: string): string {
    const parsed = parseMonthKey(monthKey);
    return parsed
      ? new Date(parsed.year, parsed.month, 1).toLocaleDateString(
        this.translation.getIntlLocale(), { month: 'short', year: 'numeric' })
      : monthKey;
  }

  reasonLabel(reason: string): string {
    return this.translation.t(`insights.stale_${reason}`);
  }

  select(monthKey: string): void {
    this.monthSelected.emit(this.selectedMonth() === monthKey ? null : monthKey);
  }

  backToCurrent(): void {
    this.monthSelected.emit(null);
  }

  regenerate(): void {
    const month = this.selectedMonth();
    if (month) {
      this.regenerateRequested.emit(month);
    }
  }
}
