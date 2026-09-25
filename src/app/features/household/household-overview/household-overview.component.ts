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

import {
  HOUSEHOLD_LEDGER_ROW_CAP,
  HouseholdLedgerService,
  LedgerRow
} from '../../../core/services/household-ledger.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { pinLeadingMinus, snapDisplayZero } from '../../../core/utils/money-display.utils';
import { DateWindow, clampWindowToNow } from '../../../core/utils/transaction-date.utils';
import { Category, HouseholdMemberIdentity, baseCurrencyOf } from '../../../models';
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
import { FocusContext, focusWhenRendered } from '../household-focus';

/** A member's figures for the period, formatted for their line. */
interface MemberLine {
  member: HouseholdMemberIdentity;
  /** Offline, and nothing of theirs cached: the line says so in place of figures. */
  notLoaded: boolean;
  income: string;
  expense: string;
  balance: string;
  negative: boolean;
}

interface RowView {
  key: string;
  row: LedgerRow;
  categories: Map<string, Category>;
  member: HouseholdMemberIdentity | null;
}

interface MemberNotice {
  kind: 'unavailable' | 'incomplete' | 'categoriesIncomplete' | 'truncated';
  member: HouseholdMemberIdentity;
  /** Empty when the member gave no name; the template names them generically. */
  name: string;
}

const NO_CATEGORIES = new Map<string, Category>();

/**
 * How many rows the list shows at first, and how many more each press of its
 * button adds. The ledger holds up to HOUSEHOLD_LEDGER_ROW_CAP rows for each
 * member of a household of up to eight, and every row shown is a full
 * transaction row with fitted amounts.
 */
export const HOUSEHOLD_OVERVIEW_ROW_PAGE = 100;

const sameDates = (a: DateWindow | null, b: DateWindow | null): boolean =>
  a === b || (a !== null && b !== null &&
    a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime());

const sameUids = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((uid, at) => uid === b[at]);

/**
 * Every member's income and spending for a period, together: the household's
 * totals, each member's own, and every member's transactions in one list,
 * newest first and a page at a time.
 *
 * Read-only throughout. Most rows belong to other members, so no row opens
 * from here, the viewer's own included, and nothing in the list is a control.
 *
 * The ledger comes from the household page, which hands it the members; this
 * section owns the period. A period is read the way the dashboard reads it,
 * to the end of today, so it covers the same window as each member's own
 * dashboard. Their figures can still differ: a member's recurring rules post
 * only when that member's own app catches them up, so a line here can be
 * short of rent that is due but not yet posted.
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

  readonly rowCap = HOUSEHOLD_LEDGER_ROW_CAP;
  readonly combined = this.ledger.combined;
  readonly baseCurrency = computed(() => baseCurrencyOf(this.auth.currentUser()));

  /**
   * Offline, only what this device cached is known. The viewer's own rows
   * are nearly always cached from their own pages, so they say nothing about
   * anyone else's: with another member shown, the period is known only once
   * another member's row is. A household of one goes by its own rows.
   *
   * Every offline answer comes from the cache, so another member whose
   * period is truly empty cannot be told from one never read on this device;
   * both count as not known.
   */
  private readonly offlineKnown = computed(() => {
    const me = this.auth.userId();
    const rows = this.ledger.rows();
    const others = this.ledger.totalsByMember().some(({ member }) => member.uid !== me);
    return others ? rows.some(row => row.memberUid !== me) : rows.length > 0;
  });

  /**
   * Nothing known is not an empty period, so offline with nothing known
   * shows no figures at all rather than zeros. Offline with rows known shows
   * them, the page saying they may be out of date.
   */
  readonly state = computed<'offline' | 'loading' | 'ready'>(() => {
    if (!this.isOnline()) return this.offlineKnown() ? 'ready' : 'offline';
    return this.ledger.loading() ? 'loading' : 'ready';
  });

  readonly memberLines = computed<MemberLine[]>(() => {
    const base = this.baseCurrency();
    const format = (amount: number) => this.currency.formatCurrency(amount, base);
    const offline = !this.isOnline();
    const me = this.auth.userId();
    return this.ledger.totalsByMember().map(({ member, totals }) => {
      // A residue below the currency's smallest unit is zero, not a signed
      // zero in the expense tone.
      const net = snapDisplayZero(totals.balance, base);
      return {
        member,
        // Offline, another member with nothing cached is not known to have
        // nothing (see offlineKnown), so no zeros are shown for them.
        notLoaded: offline && member.uid !== me && totals.count === 0,
        income: format(totals.income),
        expense: format(totals.expense),
        // A wrapped negative figure must not leave its sign behind on a line
        // of its own.
        balance: pinLeadingMinus(format(net)),
        negative: net < 0
      };
    });
  });

  private readonly allRows = computed<RowView[]>(() => {
    const categories = this.ledger.categoriesByMember();
    const members = new Map(this.ledger.totalsByMember().map(({ member }) => [member.uid, member]));
    // A custom category's id means nothing in another member's categories,
    // so each row resolves through its own member's.
    return this.ledger.rows().map(row => ({
      key: `${row.memberUid}/${row.id}`,
      row,
      categories: categories.get(row.memberUid) ?? NO_CATEGORIES,
      member: members.get(row.memberUid) ?? null
    }));
  });

  /**
   * The newest rows, a page at a time. The figures above are the ledger's
   * own, over every row, whatever is shown here.
   */
  readonly rows = computed(() => this.allRows().slice(0, this.shownCount()));

  readonly hiddenCount = computed(() => this.allRows().length - this.rows().length);

  /**
   * Only what this section shows is spoken for: an unread transactions
   * listener leaves a member's figures partial, and unread budgets or goals
   * belong to the section that shows those. An unread categories listener
   * leaves some rows here with an unknown category, and some budget cards in
   * the budgets and goals section with a generic icon; the page always shows
   * the two together, so this one note speaks for both.
   */
  readonly notices = computed<MemberNotice[]>(() => {
    const notice = (kind: MemberNotice['kind']) => (member: HouseholdMemberIdentity): MemberNotice =>
      ({ kind, member, name: member.displayName.trim() });
    const incomplete = this.ledger.incomplete();
    return [
      ...this.ledger.unavailable().map(notice('unavailable')),
      ...incomplete.transactions.map(notice('incomplete')),
      ...incomplete.categories.map(notice('categoriesIncomplete')),
      ...this.ledger.truncated().map(notice('truncated'))
    ];
  });

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
