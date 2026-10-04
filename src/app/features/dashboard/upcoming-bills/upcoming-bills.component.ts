import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Category, RecurringOccurrence } from '../../../models';
import { dayKey, wholeDaysBetween } from '../../../core/utils/transaction-date.utils';
import { snapDisplayZero } from '../../../core/utils/money-display.utils';
import { AccessibilityService } from '../../../core/services/accessibility.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LocaleDatePipe } from '../../../shared/pipes/locale-date.pipe';

/** One local calendar day of the window, with the rules landing on it. */
export interface UpcomingBillDay {
  key: string;
  date: Date;
  occurrences: RecurringOccurrence[];
}

/** What the card found for a rule it was asked to bring into view. */
export type RuleFocusOutcome = 'focused' | 'absent';

/** How long the row a link landed on stays marked. */
const HIGHLIGHT_MS = 2000;

/**
 * The scheduled half of the dashboard: what the recurring rules will move in
 * the next couple of weeks, day by day, with the window's net underneath.
 *
 * Dumb like the other dashboard widgets — the page owns the listener, the
 * base currency and the conversion, so this card can be rendered from a
 * literal. Row amounts stay in each rule's own currency: a future occurrence
 * has no write-time base-currency snapshot, and showing a converted figure
 * beside a rule the user typed in their own currency reads as a wrong number.
 * Only the net, which has to add unlike currencies up, is converted (ADR 0091).
 */
@Component({
  selector: 'app-upcoming-bills',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatIconModule,
    AmountDisplayComponent,
    CategoryChipComponent,
    EmptyStateComponent,
    TranslatePipe,
    LocaleDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './upcoming-bills.component.html',
  styleUrl: './upcoming-bills.component.scss',
})
export class UpcomingBillsComponent {
  occurrences = input.required<RecurringOccurrence[]>();
  categories = input.required<Map<string, Category>>();
  baseCurrency = input.required<string>();
  /** Window net in the base currency; income positive. Folded by the page. */
  net = input.required<number>();
  /**
   * Occurrences the window's floor left behind — a rule dormant long enough
   * that listing its backlog would bury everything upcoming. Zero hides the
   * note entirely; there is no "all caught up" to announce.
   */
  olderCount = input<number>(0);
  /**
   * A rule a bill reminder's link names (#446). Its row nearest today is
   * scrolled to, focused and marked, and `ruleFocus` says whether there was
   * one. The page clears it once answered, so a second link to the same rule
   * is a change.
   */
  focusRuleId = input<string | null>(null);
  readonly ruleFocus = output<RuleFocusOutcome>();

  /** `day|rule` of the row a link landed on, for `HIGHLIGHT_MS`. */
  readonly highlightedRow = signal<string | null>(null);

  private categoryHelperService = inject(CategoryHelperService);
  private accessibility = inject(AccessibilityService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);

  constructor() {
    // Looked up after the render the same change detection carries, so a
    // window and a link that arrive together find the window's rows.
    effect(() => {
      const ruleId = this.focusRuleId();
      if (!ruleId) return;
      untracked(() => afterNextRender(() => this.focusRule(ruleId), { injector: this.injector }));
    });
  }

  /**
   * Occurrences arrive sorted by date, so first-seen order is date order and
   * a Map preserves it — the grouping deliberately adds no sort of its own,
   * which would be a second ordering rule to keep in step with the service's.
   *
   * Days already past are grouped and shown like any other: they are due but
   * not yet posted, and hiding them would conceal money about to move on the
   * one occasion the catch-up has failed. Only the ones behind the window's
   * floor never arrive here, and `olderCount` says how many those were.
   */
  readonly days = computed<UpcomingBillDay[]>(() => {
    const days = new Map<string, UpcomingBillDay>();
    for (const occurrence of this.occurrences()) {
      const key = dayKey(occurrence.date);
      const day = days.get(key);
      if (day) {
        day.occurrences.push(occurrence);
      } else {
        days.set(key, { key, date: occurrence.date, occurrences: [occurrence] });
      }
    }
    return [...days.values()];
  });

  /**
   * The net as the footer shows it, sign and tone included. A window that
   * cancels out, or nets below the base currency's smallest unit, moves no
   * money either way, so it is neither income-green nor expense-red.
   */
  readonly netDisplay = computed(() => snapDisplayZero(this.net(), this.baseCurrency()));

  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories());
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories());
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories());
  }

  private focusRule(ruleId: string): void {
    const day = this.nearestDay(ruleId);
    const row = day === null
      ? null
      : this.host.nativeElement.querySelector<HTMLElement>(
        `.bill-row[data-day="${day}"][data-rule-id="${CSS.escape(ruleId)}"]`
      );
    if (!row) {
      this.ruleFocus.emit('absent');
      return;
    }

    row.scrollIntoView({ block: 'center', behavior: this.accessibility.reducedMotion() ? 'auto' : 'smooth' });
    // Without preventScroll, focus would jump to the row at once and the
    // smooth scroll above would never be seen.
    row.focus({ preventScroll: true });
    const key = `${day}|${ruleId}`;
    this.highlightedRow.set(key);
    setTimeout(() => {
      if (this.highlightedRow() === key) this.highlightedRow.set(null);
    }, HIGHLIGHT_MS);
    this.ruleFocus.emit('focused');
  }

  /**
   * The key of the day, among this rule's, nearest today. A rule can have a
   * past-due row and upcoming ones at once; days run in date order, so an
   * equal distance goes to the later day, since a reminder only ever names an
   * occurrence today or after.
   */
  private nearestDay(ruleId: string): string | null {
    const today = new Date();
    let nearest: { key: string; distance: number } | null = null;
    for (const day of this.days()) {
      if (!day.occurrences.some(occurrence => occurrence.recurringId === ruleId)) continue;
      const distance = Math.abs(wholeDaysBetween(today, day.date));
      if (nearest === null || distance <= nearest.distance) nearest = { key: day.key, distance };
    }
    return nearest?.key ?? null;
  }
}
