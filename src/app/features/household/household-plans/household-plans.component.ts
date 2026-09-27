import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { HouseholdService } from '../../../core/services/household.service';
import { HouseholdPlansService } from '../../../core/services/household-plans.service';
import { PwaService } from '../../../core/services/pwa.service';
import { getBudgetAlertSeverity } from '../../../core/utils/budget-alert.utils';
import { BudgetAlertSeverity, BudgetPeriod, HouseholdMemberIdentity } from '../../../models';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { MemberChipComponent } from '../../../shared/components/member-chip/member-chip.component';
import { FitTextDirective } from '../../../shared/directives/fit-text.directive';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/** How far a plan has come, as the card reads it. */
interface Progress {
  /** Rounded, and deliberately uncapped: an overspend or an overshoot reads honestly in the number. */
  percent: number;
  /** The bar's value, capped at 100, so it fills rather than breaks. */
  bar: number;
}

/** What every plan's card has: a name, and whether its figures are still being counted. */
interface PlanView {
  id: string;
  name: string;
  /**
   * Its figures wait on a listener. A card shows this only for a plan with
   * no earlier figures to keep meanwhile (keepCounted).
   */
  counting: boolean;
}

/** One household budget as its card shows it. */
interface BudgetView extends PlanView, Progress {
  period: BudgetPeriod;
  spent: string;
  amount: string;
  /** How near its limit the budget is, by its own alert threshold (the personal card's rule); null below it. */
  severity: BudgetAlertSeverity | null;
  /** The dates the budget counts now; null when it has none. */
  window: { start: string; end: string } | null;
  atTodaysRate: boolean;
  incomplete: boolean;
}

/** One member's contribution to a household goal. */
interface ContributionView {
  id: string;
  member: HouseholdMemberIdentity;
  amount: string;
  date: string;
}

/** One household goal as its card shows it. */
interface GoalView extends PlanView, Progress {
  /** Names the goal's list of contributions. */
  contributionsId: string;
  saved: string;
  target: string;
  targetDate: string | null;
  contributions: ContributionView[];
  atTodaysRate: boolean;
  incomplete: boolean;
}

function progress(fraction: number): Progress {
  const exact = Number.isFinite(fraction) ? Math.max(0, fraction * 100) : 0;
  return { percent: Math.round(exact), bar: Math.min(100, exact) };
}

/**
 * The plans as the cards show them. A plan counted again (its copies read
 * afresh for a new day, or its goal's links for a goal made since) keeps the
 * figures it last showed until the count is back, rather than dropping to
 * nothing and back; only its name follows at once.
 */
function keepCounted<T extends PlanView>(fresh: T[], shown: readonly T[] | undefined): T[] {
  const counted = new Map((shown ?? []).filter(view => !view.counting).map(view => [view.id, view] as const));
  return fresh.map(view => {
    const before = view.counting ? counted.get(view.id) : undefined;
    return before ? { ...before, name: view.name } : view;
  });
}

/** A threshold as stored: any number the rules let through, so one that is not finite is taken as none. */
const thresholdOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * The household's own budgets and goals, read-only here. A member's own
 * budgets and goals are private to them and are never read: a household's
 * plans are its own, counted only from the rows its members shared into it
 * (HouseholdPlansService, which the page provides and feeds).
 *
 * A budget shows its spending against its limit in its own currency over the
 * window it counts now; a goal, what its members saved toward it against its
 * target, in its own currency, with each contribution under the member who
 * made it. A figure that took in another currency says it was converted at
 * today's rate, and one whose rows were not all read says it may be
 * incomplete.
 *
 * Its own cards rather than the Budgets page's: a household budget counts
 * several categories over a window of its own and folds its spending as it
 * is read, and a household goal has members' contributions and no checklist,
 * so neither fits a personal budget's or goal's card.
 *
 * Nothing known is not nothing there, as the overview beside it holds: an
 * empty answer from this device's cache waits for the server online, and
 * offline says the plans are not loaded here. Plans the cache holds are
 * shown, under the page's note that they may be out of date.
 */
@Component({
  selector: 'app-household-plans',
  standalone: true,
  imports: [
    FitTextDirective,
    LoadingSpinnerComponent,
    MatIconModule,
    MatProgressBarModule,
    MemberChipComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-plans.component.html',
  styleUrl: './household-plans.component.scss'
})
export class HouseholdPlansComponent {
  private readonly plans = inject(HouseholdPlansService);
  private readonly householdService = inject(HouseholdService);
  private readonly currency = inject(CurrencyService);
  private readonly dateFormat = inject(DateFormatService);
  private readonly isOnline = inject(PwaService).isOnline;

  /**
   * The plans have answered once. A later wait (the listener of a goal made
   * since, say) keeps what is shown rather than taking the lists away, focus
   * and all. The section is made afresh for each household the page shows.
   */
  private readonly answered = signal(false);

  /** A list's listener failed before the server answered, so some plans may be missing from it. */
  readonly incomplete = this.plans.incomplete;

  private readonly membersByUid = computed(
    () => new Map(this.householdService.members().map(member => [member.uid, member] as const))
  );

  private readonly budgetsCounted = computed<BudgetView[]>(() =>
    this.plans.budgets().map(({ budget, spent, window, atTodaysRate, incomplete, counting }) => {
      const format = (amount: number) => this.currency.formatCurrency(amount, budget.currency);
      const fraction = budget.amount > 0 ? spent / budget.amount : 0;
      return {
        id: budget.id,
        name: budget.name,
        counting,
        period: budget.period,
        spent: format(spent),
        amount: format(budget.amount),
        // The unrounded share, so a budget just under its threshold is not
        // rounded up into a warning.
        severity: getBudgetAlertSeverity(fraction * 100, thresholdOf(budget.alertThreshold)),
        ...progress(fraction),
        window: window && {
          start: this.dateFormat.formatDate(window.start),
          end: this.dateFormat.formatDate(window.end)
        },
        atTodaysRate,
        incomplete
      };
    })
  );

  readonly budgets = linkedSignal<BudgetView[], BudgetView[]>({
    source: this.budgetsCounted,
    computation: (fresh, previous) => keepCounted(fresh, previous?.value)
  }).asReadonly();

  private readonly goalsCounted = computed<GoalView[]>(() => {
    const members = this.membersByUid();
    return this.plans.goals().map(({ goal, saved, fraction, contributions, atTodaysRate, incomplete, counting }) => {
      const format = (amount: number) => this.currency.formatCurrency(amount, goal.currency);
      return {
        id: goal.id,
        name: goal.name,
        counting,
        contributionsId: `household-goal-${goal.id}-contributions`,
        saved: format(saved),
        target: format(goal.targetAmount),
        ...progress(fraction),
        targetDate: goal.targetDate ? this.dateFormat.formatDate(goal.targetDate) : null,
        contributions: contributions.map(entry => ({
          id: entry.id,
          // Only a live member's contributions reach here. Should the list
          // lag behind them, the chip reads as a member without a name
          // rather than showing an account id.
          member: members.get(entry.memberUid) ?? { uid: entry.memberUid, displayName: '' },
          amount: format(entry.amount),
          date: this.dateFormat.formatDate(entry.date)
        })),
        atTodaysRate,
        incomplete
      };
    });
  });

  readonly goals = linkedSignal<GoalView[], GoalView[]>({
    source: this.goalsCounted,
    computation: (fresh, previous) => keepCounted(fresh, previous?.value)
  }).asReadonly();

  readonly empty = computed(() => this.budgets().length === 0 && this.goals().length === 0);

  /**
   * What the section shows. Until the plans first answer, no figure is
   * known, so none is shown: a budget would read as nothing spent. No plans
   * is only as empty as this device's cache until the server has answered:
   * online the section waits for it, and offline it says the plans are not
   * loaded here. A list that could not all be read has nothing to wait for,
   * and says so in place of saying there are none.
   */
  readonly state = computed<'loading' | 'offline' | 'ready'>(() => {
    if (!this.empty()) return this.answered() || !this.plans.loading() ? 'ready' : 'loading';
    if (this.incomplete()) return 'ready';
    if (!this.plans.loading() && !this.plans.fromCache()) return 'ready';
    return this.isOnline() ? 'loading' : 'offline';
  });

  constructor() {
    effect(() => {
      if (!this.plans.loading()) this.answered.set(true);
    });
  }
}
