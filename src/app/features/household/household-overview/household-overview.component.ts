import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import {
  HOUSEHOLD_LEDGER_ROW_CAP,
  HouseholdLedgerService,
  LedgerRow
} from '../../../core/services/household-ledger.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { PwaService } from '../../../core/services/pwa.service';
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
 * Every member's income and spending for a period, together: the household's
 * totals, each member's own, and every member's transactions in one list.
 *
 * Read-only throughout. Most rows belong to other members, so no row opens
 * from here, the viewer's own included, and nothing in the list is a control.
 *
 * The ledger comes from the household page, which hands it the members; this
 * section owns the period. A period is read the way the dashboard reads it,
 * to the end of today, so a member's line here matches their own dashboard.
 */
@Component({
  selector: 'app-household-overview',
  standalone: true,
  imports: [
    EmptyStateComponent,
    FinancialSummaryComponent,
    FitTextDirective,
    LoadingSpinnerComponent,
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
  private readonly isOnline = inject(PwaService).isOnline;

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

  readonly rows = computed<RowView[]>(() => {
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
   * Only what this section shows is spoken for: an unread transactions
   * listener leaves a member's figures partial, an unread categories one
   * leaves some rows unlabelled, and unread budgets or goals belong to the
   * section that shows those.
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
  }

  onPeriodSelection(selection: PeriodSelection): void {
    this.readPeriod(selection);
  }

  private readPeriod(period: DateWindow): void {
    this.ledger.setPeriod(clampWindowToNow(period, new Date()));
  }
}
