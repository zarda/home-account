import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked
} from '@angular/core';
import { ComponentType } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { HouseholdError, HouseholdService } from '../../../core/services/household.service';
import {
  HouseholdBudgetChanges,
  HouseholdBudgetInput,
  HouseholdGoalChanges,
  HouseholdGoalInput,
  HouseholdPlansService
} from '../../../core/services/household-plans.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { getBudgetAlertSeverity } from '../../../core/utils/budget-alert.utils';
import {
  BudgetAlertSeverity,
  BudgetPeriod,
  Household,
  HouseholdBudget,
  HouseholdGoal,
  HouseholdMemberIdentity,
  baseCurrencyOf
} from '../../../models';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { MemberChipComponent } from '../../../shared/components/member-chip/member-chip.component';
import { FitTextDirective } from '../../../shared/directives/fit-text.directive';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { writeFailureMessage } from '../household-failure';
import { FocusContext, OpenDialog, closeDialogsOnSwitch, focusWhenRendered, sameShownHousehold } from '../household-focus';
import {
  HouseholdBudgetDialogComponent,
  HouseholdBudgetDialogData
} from './household-budget-dialog/household-budget-dialog.component';
import {
  HouseholdContributionDialogComponent,
  HouseholdContributionDialogData
} from './household-contribution-dialog/household-contribution-dialog.component';
import { HouseholdGoalDialogComponent, HouseholdGoalDialogData } from './household-goal-dialog/household-goal-dialog.component';
import { PLAN_DIALOG_CONFIG } from './household-plan-form';

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
  /** The DOM id of the card's heading, where focus lands on the card. */
  headingId: string;
  /** The viewer may delete it: its maker, or the household's owner. */
  deletable: boolean;
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
  /** The viewer may delete it: its author, or the household's owner. */
  deletable: boolean;
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
    return before ? { ...before, name: view.name, deletable: view.deletable } : view;
  });
}

/** Where focus goes once the plans show what an action did. */
interface Landing {
  selectors: string[];
  /** The plans show it: a card made has come, or a card deleted has gone. */
  shown: () => boolean;
  /** The control the action was taken from, when it stays: focus left on it moves too. */
  from: Element | null;
}

/**
 * A document id as part of a DOM id. The rules leave a plan's id free, so
 * each character outside [A-Za-z0-9-] is written as `_`, its code in hex and
 * `_`: the id is then one IDREF token, safe in a selector, and no two ids
 * come out alike.
 */
const domIdPart = (id: string): string => id.replace(/[^A-Za-z0-9-]/g, char => `_${char.charCodeAt(0).toString(16)}_`);

const budgetHeadingId = (budgetId: string): string => `household-budget-${domIdPart(budgetId)}-name`;
const goalHeadingId = (goalId: string): string => `household-goal-${domIdPart(goalId)}-name`;

/** Two dates to the millisecond, or both none. */
const sameDate = (a: Date | null, b: Date | null): boolean => a === b || (!!a && !!b && a.getTime() === b.getTime());

/** The same categories, in any order. */
const sameIds = (a: readonly string[], b: readonly string[]): boolean => {
  const before = new Set(b);
  return new Set(a).size === before.size && a.every(id => before.has(id));
};

/**
 * An edit sends only what the viewer changed from the budget its dialog
 * opened on, so another member's change to any other field, made meanwhile,
 * stands. A cleared end date or threshold is sent as null. Never the
 * currency, which is fixed once the budget is made.
 */
function budgetChanges(before: HouseholdBudget, input: HouseholdBudgetInput): HouseholdBudgetChanges {
  const changes: HouseholdBudgetChanges = {};
  if (input.name !== before.name) changes.name = input.name;
  if (!sameIds(input.categoryIds, before.categoryIds)) changes.categoryIds = input.categoryIds;
  if (input.amount !== before.amount) changes.amount = input.amount;
  if (input.period !== before.period) changes.period = input.period;
  if (!sameDate(input.startDate, before.startDate.toDate())) changes.startDate = input.startDate;
  const endDate = input.endDate ?? null;
  if (!sameDate(endDate, before.endDate?.toDate() ?? null)) changes.endDate = endDate;
  const threshold = input.alertThreshold ?? null;
  if (threshold !== (before.alertThreshold ?? null)) changes.alertThreshold = threshold;
  return changes;
}

/** As a budget's edit: only what changed, a cleared target date as null, never the currency. */
function goalChanges(before: HouseholdGoal, input: HouseholdGoalInput): HouseholdGoalChanges {
  const changes: HouseholdGoalChanges = {};
  if (input.name !== before.name) changes.name = input.name;
  if (input.targetAmount !== before.targetAmount) changes.targetAmount = input.targetAmount;
  const targetDate = input.targetDate ?? null;
  if (!sameDate(targetDate, before.targetDate?.toDate() ?? null)) changes.targetDate = targetDate;
  return changes;
}

/** A threshold as stored: any number the rules let through, so one that is not finite is taken as none. */
const thresholdOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * The household's own budgets and goals. A member's own budgets and goals
 * are private to them and are never read: a household's plans are its own,
 * counted only from the rows its members shared into it
 * (HouseholdPlansService, which the page provides and feeds).
 *
 * Any live member makes and edits them, and records contributions to a
 * goal. Only a plan's maker or the household's owner is offered its delete,
 * and only a contribution's author or the owner is offered that one's: the
 * rules refuse anyone else. Every write needs a connection, so offline one
 * is refused before its dialog opens. A dialog stays open when its save is
 * refused, with the service's words for why; one action runs at a time.
 * Every save of a new plan's or a contribution's dialog goes under one id,
 * so saving again after the connection dropped never makes it twice.
 *
 * A dialog or confirm belongs to the household it was opened for. It
 * closes once the page shows another household, another generation of it,
 * or none, and when the section goes; a save or confirm that beats the close
 * is refused before anything is sent, since the service writes to whichever
 * household the page shows then.
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
    MatButtonModule,
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
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);
  private readonly focus: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: inject(DestroyRef)
  };

  /**
   * A write is on its way. Every control says it is not offered meanwhile
   * (aria-disabled) but keeps focus, and a press on one, or an action
   * reached from script, is refused, not queued, until it ends.
   */
  readonly pending = signal(false);

  /**
   * The dialogs open from here, confirms included, each with the household
   * it was opened for. While one is open no other action starts.
   */
  private readonly dialogsOpen = new Map<OpenDialog, Household | null>();

  /** Where focus goes once the plans show what the last action did. */
  private readonly landing = signal<Landing | null>(null);

  /** A live member makes, edits and contributes; a viewer whose membership ended only reads. */
  readonly canWrite = computed(() => this.householdService.ownMember() !== null);

  private readonly viewerUid = computed(() => this.householdService.ownMember()?.uid ?? null);

  /** Whether the viewer may delete what `author` made or recorded: its author, or the owner. */
  private readonly mayDelete = computed(() => {
    const uid = this.viewerUid();
    const owner = this.householdService.isOwner();
    return (author: string) => uid !== null && (owner || author === uid);
  });

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

  private readonly budgetsCounted = computed<BudgetView[]>(() => {
    const mayDelete = this.mayDelete();
    return this.plans.budgets().map(({ budget, spent, window, atTodaysRate, incomplete, counting }) => {
      const format = (amount: number) => this.currency.formatCurrency(amount, budget.currency);
      const fraction = budget.amount > 0 ? spent / budget.amount : 0;
      return {
        id: budget.id,
        name: budget.name,
        headingId: budgetHeadingId(budget.id),
        deletable: mayDelete(budget.createdBy),
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
    });
  });

  readonly budgets = linkedSignal<BudgetView[], BudgetView[]>({
    source: this.budgetsCounted,
    computation: (fresh, previous) => keepCounted(fresh, previous?.value)
  }).asReadonly();

  private readonly goalsCounted = computed<GoalView[]>(() => {
    const members = this.membersByUid();
    const mayDelete = this.mayDelete();
    return this.plans.goals().map(({ goal, saved, fraction, contributions, atTodaysRate, incomplete, counting }) => {
      const format = (amount: number) => this.currency.formatCurrency(amount, goal.currency);
      return {
        id: goal.id,
        name: goal.name,
        headingId: goalHeadingId(goal.id),
        deletable: mayDelete(goal.createdBy),
        counting,
        contributionsId: `household-goal-${domIdPart(goal.id)}-contributions`,
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
          date: this.dateFormat.formatDate(entry.date),
          deletable: mayDelete(entry.memberUid)
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
    // A card comes or goes when the listener says so, which may be after
    // the write resolved: focus waits for it.
    effect(() => {
      const landing = this.landing();
      if (!landing || !landing.shown()) return;
      untracked(() => {
        this.landing.set(null);
        focusWhenRendered(this.focus, landing.selectors, { from: landing.from });
      });
    });
    closeDialogsOnSwitch(() => this.householdService.household(), this.dialogsOpen, this.focus.destroyRef);
  }

  async newBudget(event: Event): Promise<void> {
    if (this.refused()) return;
    const from = event.currentTarget as Element | null;
    const opened = this.householdService.household();
    // One id for every save of this dialog: a save sent again after the
    // connection dropped is then recognised if it landed, not made twice.
    const id = this.plans.newId();
    let created = '';
    const saved = await this.openDialog<HouseholdBudgetDialogComponent, HouseholdBudgetDialogData>(
      HouseholdBudgetDialogComponent,
      {
        currency: this.baseCurrency(),
        save: async input => {
          created = await this.writeFor(opened, () => this.plans.createBudget(input, id));
        }
      },
      opened
    );
    if (!saved) return;
    this.analytics.trackHouseholdAction({ action: 'plan_create' });
    this.notification.success(this.t('household.plans.budgetCreated'));
    this.landOn(`#${budgetHeadingId(created)}`, () => this.budgets().some(view => view.id === created), from);
  }

  async newGoal(event: Event): Promise<void> {
    if (this.refused()) return;
    const from = event.currentTarget as Element | null;
    const opened = this.householdService.household();
    // One id for every save of this dialog, as a new budget's.
    const id = this.plans.newId();
    let created = '';
    const saved = await this.openDialog<HouseholdGoalDialogComponent, HouseholdGoalDialogData>(
      HouseholdGoalDialogComponent,
      {
        currency: this.baseCurrency(),
        save: async input => {
          created = await this.writeFor(opened, () => this.plans.createGoal(input, id));
        }
      },
      opened
    );
    if (!saved) return;
    this.analytics.trackHouseholdAction({ action: 'plan_create' });
    this.notification.success(this.t('household.plans.goalCreated'));
    this.landOn(`#${goalHeadingId(created)}`, () => this.goals().some(view => view.id === created), from);
  }

  /** The same dialog as a new budget's, on the budget as it is, its currency fixed. */
  async editBudget(budgetId: string): Promise<void> {
    if (this.refused()) return;
    const budget = this.plans.budgets().find(figures => figures.budget.id === budgetId)?.budget;
    if (!budget) return;
    const opened = this.householdService.household();
    const saved = await this.openDialog<HouseholdBudgetDialogComponent, HouseholdBudgetDialogData>(
      HouseholdBudgetDialogComponent,
      {
        budget,
        currency: budget.currency,
        save: input => this.writeFor(opened, async () => {
          const changes = budgetChanges(budget, input);
          if (Object.keys(changes).length > 0) await this.plans.updateBudget(budgetId, changes);
        })
      },
      opened
    );
    if (saved) this.notification.success(this.t('household.plans.budgetSaved'));
  }

  /** The same dialog as a new goal's, on the goal as it is, its currency fixed. */
  async editGoal(goalId: string): Promise<void> {
    if (this.refused()) return;
    const goal = this.plans.goals().find(figures => figures.goal.id === goalId)?.goal;
    if (!goal) return;
    const opened = this.householdService.household();
    const saved = await this.openDialog<HouseholdGoalDialogComponent, HouseholdGoalDialogData>(
      HouseholdGoalDialogComponent,
      {
        goal,
        currency: goal.currency,
        save: input => this.writeFor(opened, async () => {
          const changes = goalChanges(goal, input);
          if (Object.keys(changes).length > 0) await this.plans.updateGoal(goalId, changes);
        })
      },
      opened
    );
    if (saved) this.notification.success(this.t('household.plans.goalSaved'));
  }

  async deleteBudget(view: BudgetView): Promise<void> {
    if (this.refused()) return;
    const opened = this.householdService.household();
    const confirmed = await this.confirm({
      title: this.t('household.plans.deleteBudgetTitle', { name: view.name }),
      message: this.t('household.plans.deleteBudgetMessage'),
      confirmLabel: this.t('household.plans.deleteConfirm'),
      confirmColor: 'warn',
      icon: 'delete'
    }, opened);
    if (!confirmed) return;
    await this.run(async () => {
      await this.writeFor(opened, () => this.plans.deleteBudget(view.id));
      this.analytics.trackHouseholdAction({ action: 'plan_delete' });
      this.notification.success(this.t('household.plans.budgetDeleted'));
      this.landOn('#household-plans-title', () => !this.budgets().some(each => each.id === view.id));
    });
  }

  /** Its contributions go with it, and the confirm says so. */
  async deleteGoal(view: GoalView): Promise<void> {
    if (this.refused()) return;
    const opened = this.householdService.household();
    const confirmed = await this.confirm({
      title: this.t('household.plans.deleteGoalTitle', { name: view.name }),
      message: this.t('household.plans.deleteGoalMessage'),
      confirmLabel: this.t('household.plans.deleteConfirm'),
      confirmColor: 'warn',
      icon: 'delete'
    }, opened);
    if (!confirmed) return;
    await this.run(async () => {
      await this.writeFor(opened, () => this.plans.deleteGoal(view.id));
      this.analytics.trackHouseholdAction({ action: 'plan_delete' });
      this.notification.success(this.t('household.plans.goalDeleted'));
      this.landOn('#household-plans-title', () => !this.goals().some(each => each.id === view.id));
    });
  }

  /** In the goal's currency. Focus comes back to the button it was asked from, which stays. */
  async addContribution(view: GoalView): Promise<void> {
    if (this.refused()) return;
    const goal = this.plans.goals().find(figures => figures.goal.id === view.id)?.goal;
    if (!goal) return;
    const opened = this.householdService.household();
    // One id for every save of this dialog, as a new budget's; another
    // dialog, even for the same amount, is another contribution.
    const id = this.plans.newId();
    const saved = await this.openDialog<HouseholdContributionDialogComponent, HouseholdContributionDialogData>(
      HouseholdContributionDialogComponent,
      {
        goalName: goal.name,
        currency: goal.currency,
        save: async (amount, date) => {
          await this.writeFor(opened, () => this.plans.addContribution(goal.id, amount, date, id));
        }
      },
      opened
    );
    if (!saved) return;
    this.analytics.trackHouseholdAction({ action: 'contribute' });
    this.notification.success(this.t('household.plans.contributionAdded'));
  }

  async deleteContribution(view: GoalView, entry: ContributionView): Promise<void> {
    if (this.refused()) return;
    const opened = this.householdService.household();
    const confirmed = await this.confirm({
      title: this.t('household.plans.deleteContributionTitle'),
      message: this.t('household.plans.deleteContributionMessage', { amount: entry.amount, date: entry.date, name: view.name }),
      confirmLabel: this.t('household.plans.deleteConfirm'),
      confirmColor: 'warn',
      icon: 'delete'
    }, opened);
    if (!confirmed) return;
    await this.run(async () => {
      await this.writeFor(opened, () => this.plans.deleteContribution(view.id, entry.id));
      this.notification.success(this.t('household.plans.contributionDeleted'));
      // Its button goes with it: focus goes to the goal it was recorded on.
      this.landOn(`#${view.headingId}`, () =>
        !this.goals().some(goal => goal.id === view.id && goal.contributions.some(each => each.id === entry.id)));
    });
  }

  /**
   * Refuses an action while another is on its way or a dialog is open, and
   * offline before its first dialog: the service refuses offline too, but
   * only once a dialog has been filled in; it still catches a connection
   * lost meanwhile. The section's buttons stay focusable while a write is on
   * its way, so focus is not dropped on the document: this is what refuses
   * their press.
   */
  private refused(): boolean {
    if (this.pending() || this.dialogsOpen.size > 0) return true;
    if (this.isOnline()) return false;
    this.notification.error(this.t('household.errors.offline'));
    return true;
  }

  /** Runs one write, saying why it failed in the service's own words. */
  private async run(work: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    try {
      await work();
    } catch (error) {
      this.notification.error(writeFailureMessage(error, key => this.t(key)));
    } finally {
      this.pending.set(false);
    }
  }

  /**
   * Makes a write for the household its action was taken in, or refuses it
   * before anything is sent: by the time a dialog is saved or a confirm
   * answered, the page may show another household, or none, and the service
   * writes to whichever it shows then. Nothing is awaited between this check
   * and the service taking its household.
   */
  private writeFor<T>(opened: Household | null, write: () => Promise<T>): Promise<T> {
    if (!sameShownHousehold(opened, this.householdService.household())) {
      return Promise.reject(new HouseholdError(this.t('household.errors.refused')));
    }
    return write();
  }

  /**
   * Opens a plan dialog for the household `opened`, answering whether it
   * saved. The dialog makes its write itself and stays open when the write
   * is refused.
   */
  private async openDialog<T, D>(component: ComponentType<T>, data: D, opened: Household | null): Promise<boolean> {
    const ref = this.dialog.open<T, D, boolean>(component, { ...PLAN_DIALOG_CONFIG, data });
    return (await this.closed(ref, opened)) === true;
  }

  private async confirm(data: ConfirmDialogData, opened: Household | null): Promise<boolean> {
    return (await this.closed(this.dialog.open(ConfirmDialogComponent, { data }), opened)) === true;
  }

  /** What a dialog closed with, holding it among the dialogs open from here until then. */
  private async closed<R>(ref: MatDialogRef<unknown, R>, opened: Household | null): Promise<R | undefined> {
    this.dialogsOpen.set(ref, opened);
    try {
      return await firstValueFrom(ref.afterClosed(), { defaultValue: undefined });
    } finally {
      this.dialogsOpen.delete(ref);
    }
  }

  private landOn(selector: string, shown: () => boolean, from: Element | null = null): void {
    this.landing.set({ selectors: [selector, '#household-plans-title'], shown, from });
  }

  private baseCurrency(): string {
    return baseCurrencyOf(this.auth.currentUser());
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translation.t(key, params);
  }
}
