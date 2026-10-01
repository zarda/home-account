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
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { HouseholdLedgerService, LedgerRow } from '../../../core/services/household-ledger.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { HouseholdPlansService } from '../../../core/services/household-plans.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { pinLeadingMinus, snapDisplayZero } from '../../../core/utils/money-display.utils';
import { DateWindow, clampWindowToNow } from '../../../core/utils/transaction-date.utils';
import {
  Category,
  HouseholdMemberIdentity,
  LEDGER_VIEW_CAP,
  Transaction,
  baseCurrencyOf
} from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { MemberChipComponent } from '../../../shared/components/member-chip/member-chip.component';
import {
  PeriodSelection,
  PeriodSelectorComponent,
  defaultPeriodSelection
} from '../../../shared/components/period-selector/period-selector.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { FitTextDirective } from '../../../shared/directives/fit-text.directive';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { FinancialSummaryComponent } from '../../dashboard/financial-summary/financial-summary.component';
import { writeFailureMessage } from '../household-failure';
import { FocusContext, focusWhenRendered } from '../household-focus';

/**
 * Why a member's line shows no figures: only this device's cache is known,
 * and none of theirs is in it. Offline, connecting would load them; online,
 * the server is still to answer, or will not, its listener having failed.
 */
type MemberPending = 'offline' | 'loading' | 'failed';

/** A member's figures for the period, formatted for their line. */
interface MemberLine {
  member: HouseholdMemberIdentity;
  /** Set when the line says why in place of figures, and then none is formatted. */
  pending: MemberPending | null;
  income: string;
  expense: string;
  balance: string;
  negative: boolean;
  /** Some of their figures were converted at today's rate. */
  atTodaysRate: boolean;
}

/** A shared row as the transaction row shows it. */
interface RowView {
  key: string;
  transaction: Transaction;
  /** The row's own category alone, from its snapshot. */
  categories: Map<string, Category>;
  member: HouseholdMemberIdentity | null;
  /** What the row counts as in the viewer's base was converted at today's rate. */
  atTodaysRate: boolean;
  /** The viewer's own row: only its member counts it toward a goal. */
  own: boolean;
  /** Its row's id among the viewer's transactions, which the goal link is written by. */
  sourceId: string;
  /** The active household goal it counts toward, as the menu checks it; null for none, or for a goal no longer active. */
  goal: GoalChoice | null;
  /** The goal its copy is linked to as stored, active or not; null for none. */
  linkedId: string | null;
}

/** A household goal a row can count toward. */
interface GoalChoice {
  id: string;
  name: string;
}

/**
 * How many rows the list shows at first, and how many more each press of its
 * button adds. The ledger holds up to LEDGER_VIEW_CAP rows, and every row
 * shown is a full transaction row with fitted amounts.
 */
export const HOUSEHOLD_OVERVIEW_ROW_PAGE = 100;

const sameDates = (a: DateWindow | null, b: DateWindow | null): boolean =>
  a === b || (a !== null && b !== null &&
    a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime());

const sameUids = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((uid, at) => uid === b[at]);

/**
 * A shared row in the shape the transaction row reads. What it counts as is
 * the viewer's: its amount in the viewer's base, stamped against that base,
 * so the row's converted line shows the figure the totals fold (at today's
 * rate, or the amount itself in that currency). No snapshot of its member's
 * own base reaches a copy.
 */
function shownTransaction(row: LedgerRow, base: string): Transaction {
  return {
    id: row.id,
    userId: row.memberUid,
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    amountInBaseCurrency: row.inBase,
    exchangeRate: row.amount === 0 ? 1 : row.inBase / row.amount,
    baseCurrency: base,
    categoryId: row.categoryId,
    description: row.description,
    date: row.date,
    createdAt: row.date,
    updatedAt: row.date,
    isRecurring: false
  };
}

/**
 * The row's category from its snapshot. The transaction row names it through
 * the translation, as every category name is named, so a built-in's key reads
 * in the viewer's language and a custom category as its member typed it.
 */
function snapshotCategory(row: LedgerRow): Category {
  return {
    id: row.categoryId,
    userId: row.memberUid,
    name: row.category.name,
    icon: row.category.icon,
    color: row.category.color,
    type: row.type,
    order: 0,
    isActive: true,
    isDefault: false
  };
}

/**
 * What the household's members shared with it for a period, together: the
 * household's totals, each member's own, and every shared row in one list,
 * newest first and a page at a time. A row a member has not shared is never
 * here.
 *
 * Most rows belong to other members, so no row opens from here, the
 * viewer's own included. The one control in the list is on the viewer's own
 * rows, while the household has an active goal: a menu that counts the row
 * toward one of the goals, or toward none, and says which it counts toward.
 * Another member's link is theirs alone to change.
 *
 * The ledger comes from the household page, which hands it the household and
 * its members; this section owns the period. A period is read the way the
 * dashboard reads it, to the end of today. The goals a row is offered, and
 * the link written for it, are the page's HouseholdPlansService's.
 *
 * Figures are in the viewer's base currency. Any that include a row in
 * another currency were converted at today's rate, and say so: the
 * household's, a member's, and a row's own.
 */
@Component({
  selector: 'app-household-overview',
  standalone: true,
  imports: [
    EmptyStateComponent,
    FinancialSummaryComponent,
    FitTextDirective,
    LoadingSpinnerComponent,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MemberChipComponent,
    PeriodSelectorComponent,
    TransactionRowComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-overview.component.html',
  styleUrl: './household-overview.component.scss'
})
export class HouseholdOverviewComponent {
  private readonly ledger = inject(HouseholdLedgerService);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly announcer = inject(AnnouncerService);
  private readonly translation = inject(TranslationService);
  private readonly plans = inject(HouseholdPlansService);
  private readonly notification = inject(NotificationService);
  private readonly analytics = inject(AnalyticsService);
  private readonly isOnline = inject(PwaService).isOnline;
  private readonly focus: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: inject(DestroyRef)
  };

  /** The period last read; the same dates chosen again are no change. */
  private readonly period = signal<DateWindow | null>(null, { equal: sameDates });

  /** Who is shown, in any order: rows arriving for the same members change nothing here. */
  private readonly memberUids = computed(
    () => this.ledger.totalsByMember().map(({ member }) => member.uid).sort(),
    { equal: sameUids }
  );

  /** Another period, or another set of members, is another list. */
  private readonly listSource = computed(() => ({ period: this.period(), members: this.memberUids() }));

  /** Another list starts again from its newest rows. */
  private readonly shownCount = linkedSignal({
    source: this.listSource,
    computation: () => HOUSEHOLD_OVERVIEW_ROW_PAGE
  });

  /**
   * The one row that can take focus, and only from script: the row focus
   * went on to when the button went with focus on it. That is the first row
   * the last press revealed, or the last row shown when a change in the rows
   * took the button away.
   */
  readonly focusRowKey = linkedSignal({
    source: this.listSource,
    computation: (): string | null => null
  });

  /**
   * The button holds focus. A blur while rows are still hidden is focus
   * moving elsewhere and clears this. A blur with none hidden is the button
   * being taken away (some engines fire one on removal, some none), so it
   * leaves this set for the removal to hand focus on.
   */
  private moreHasFocus = false;

  readonly rowCap = LEDGER_VIEW_CAP;
  readonly combined = this.ledger.combined;
  readonly truncated = this.ledger.truncated;
  readonly incomplete = this.ledger.incomplete;
  readonly baseCurrency = computed(() => baseCurrencyOf(this.auth.currentUser()));

  /**
   * Nothing known is not an empty period. Until the server has answered, a
   * period with no rows is only as empty as this device's cache, so it shows
   * no figures at all rather than zeros: online it waits for the server, and
   * offline it says nothing is loaded. A listener that failed before the
   * server answered leaves nothing to wait for: with no rows it says the
   * shared rows could not be read, and with the cache's rows it shows them
   * under a note that the figures may be incomplete. Rows known from the
   * cache are shown, the page saying offline that they may be out of date.
   * A row in another currency waiting for today's rates is held out of
   * every figure (ratesPending), so the page waits for the rates rather
   * than show figures short of it.
   */
  readonly state = computed<'offline' | 'loading' | 'failed' | 'ready'>(() => {
    if (this.ledger.ratesPending()) return 'loading';
    if (this.ledger.rows().length > 0) return 'ready';
    if (this.ledger.incomplete()) return 'failed';
    if (!this.ledger.loading() && !this.ledger.fromCache()) return 'ready';
    return this.isOnline() ? 'loading' : 'offline';
  });

  readonly memberLines = computed<MemberLine[]>(() => {
    const base = this.baseCurrency();
    const format = (amount: number) => this.currency.formatCurrency(amount, base);
    // From the cache, a member with nothing in it is not known to have
    // shared nothing, so no zeros are shown for them.
    const cached = this.ledger.fromCache();
    const why: MemberPending = this.ledger.incomplete() ? 'failed' : this.isOnline() ? 'loading' : 'offline';
    // Totals short of a row held for today's rates are no one's figures.
    const held = this.ledger.ratesPending();
    return this.ledger.totalsByMember().map(({ member, totals }): MemberLine => {
      const pending = held ? 'loading' : cached && totals.count === 0 ? why : null;
      if (pending) return { member, pending, income: '', expense: '', balance: '', negative: false, atTodaysRate: false };
      // A residue below the currency's smallest unit is zero, not a signed
      // zero in the expense tone.
      const net = snapDisplayZero(totals.balance, base);
      return {
        member,
        pending,
        income: format(totals.income),
        expense: format(totals.expense),
        // A wrapped negative figure must not leave its sign behind on a line
        // of its own.
        balance: pinLeadingMinus(format(net)),
        negative: net < 0,
        atTodaysRate: totals.atTodaysRate
      };
    });
  });

  /** The household's active goals, in the plans' order: what a row can count toward. */
  readonly goalChoices = computed<GoalChoice[]>(
    () => this.plans.goals().map(({ goal }) => ({ id: goal.id, name: goal.name }))
  );

  private readonly allRows = computed<RowView[]>(() => {
    const base = this.baseCurrency();
    const viewer = this.auth.userId();
    const members = new Map(this.ledger.totalsByMember().map(({ member }) => [member.uid, member]));
    const goals = new Map(this.goalChoices().map(choice => [choice.id, choice]));
    return this.ledger.rows().map(row => ({
      key: row.id,
      transaction: shownTransaction(row, base),
      categories: new Map([[row.categoryId, snapshotCategory(row)]]),
      member: members.get(row.memberUid) ?? null,
      atTodaysRate: row.atTodaysRate,
      own: viewer !== null && row.memberUid === viewer,
      sourceId: row.sourceId,
      goal: (row.goalId && goals.get(row.goalId)) || null,
      linkedId: row.goalId ?? null
    }));
  });

  /**
   * The newest rows, a page at a time. The figures above are the ledger's
   * own, over every row, whatever is shown here.
   */
  readonly rows = computed(() => this.allRows().slice(0, this.shownCount()));

  readonly hiddenCount = computed(() => this.allRows().length - this.rows().length);

  constructor() {
    this.readPeriod(defaultPeriodSelection());
    // A change in the rows can take the button away while it holds focus.
    // Whether this runs before or after the button leaves the page, the flag
    // reads the same, so neither order is relied on.
    effect(() => {
      if (this.hiddenCount() > 0 || !this.moreHasFocus) return;
      this.handFocusOn(untracked(() => this.rows().at(-1)?.key));
    });
  }

  onPeriodSelection(selection: PeriodSelection): void {
    this.readPeriod(selection);
  }

  /**
   * Focus stays on the button while it stays, so the press is announced: the
   * rows it revealed went in above the button, out of the reading position,
   * and the button's own label is not read again while it holds focus. The
   * press that takes the button away would leave focus on the document
   * itself, so focus moves on to the first row that press revealed, where
   * reading carries on; that move says enough, and nothing is announced.
   */
  showMore(): void {
    const firstRevealed = this.shownCount();
    this.shownCount.update(count => count + HOUSEHOLD_OVERVIEW_ROW_PAGE);
    if (this.hiddenCount() > 0) {
      // Current state rather than an event: a run of presses must not be
      // heard as a backlog of counts already passed.
      this.announcer.announce(
        this.translation.t('household.overview.shownCount', {
          shown: this.rows().length,
          total: this.allRows().length
        }),
        'polite',
        'replace'
      );
      return;
    }
    this.handFocusOn(this.allRows()[firstRevealed]?.key);
  }

  /**
   * Counts the viewer's own row toward `goal`, or toward none (null). The
   * link it already has sends nothing. A link to a goal no longer active
   * counts nothing, so the menu checks None for it, and None clears it. The
   * menu's check follows the listener, so it moves once the link has landed.
   */
  async countToward(view: RowView, goal: GoalChoice | null): Promise<void> {
    if (!view.own || view.linkedId === (goal?.id ?? null)) return;
    try {
      await this.plans.linkCopy(view.sourceId, goal?.id ?? null);
      this.analytics.trackHouseholdAction({ action: 'goal_link' });
      this.notification.success(goal
        ? this.translation.t('household.overview.linked', { name: goal.name })
        : this.translation.t('household.overview.unlinked'));
    } catch (error) {
      this.notification.error(writeFailureMessage(error, key => this.translation.t(key)));
    }
  }

  onMoreFocus(): void {
    this.moreHasFocus = true;
  }

  onMoreBlur(): void {
    if (this.hiddenCount() > 0) this.moreHasFocus = false;
  }

  private readPeriod(period: DateWindow): void {
    const clamped = clampWindowToNow(period, new Date());
    this.period.set(clamped);
    this.ledger.setPeriod(clamped);
  }

  /**
   * To the row with this key, or to the list's heading once no row is left.
   * Only focus the button's going left on the document is moved: wherever
   * else the viewer has put it by then, it stays.
   */
  private handFocusOn(key: string | undefined): void {
    this.moreHasFocus = false;
    if (key === undefined) {
      focusWhenRendered(this.focus, ['#household-rows-title']);
      return;
    }
    this.focusRowKey.set(key);
    focusWhenRendered(this.focus, ['.overview-row[tabindex]']);
  }
}
