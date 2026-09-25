import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  untracked
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { HouseholdService, HouseholdStatus } from '../../core/services/household.service';
import { HouseholdLedgerService } from '../../core/services/household-ledger.service';
import { PwaService } from '../../core/services/pwa.service';
import { RecurringService } from '../../core/services/recurring.service';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { HouseholdMembersComponent } from './household-members/household-members.component';
import { HouseholdOverviewComponent } from './household-overview/household-overview.component';
import { HouseholdPlansComponent } from './household-plans/household-plans.component';
import { HouseholdSetupComponent } from './household-setup/household-setup.component';
import { FocusContext, HouseholdPageFocus, focusWhenRendered } from './household-focus';

/**
 * Where focus lands when an action swaps what the page shows: the first
 * heading of the section that came in, or the retry that came back.
 */
const SWAP_LANDINGS: Partial<Record<HouseholdStatus, string>> = {
  member: '#household-overview-title',
  none: '#household-invites-title',
  unavailable: '.household-retry'
};

/**
 * The household page (#71): the setup while the account has no live
 * membership, the member view while it has one.
 *
 * The page holds the household listeners for exactly as long as it is on
 * screen (ADR 0009): HouseholdService opens nothing until a page connects.
 *
 * It also provides the one HouseholdLedgerService its member-view sections
 * share, so every section reads the same listeners, closed with the page,
 * and the HouseholdPageFocus they hand focus to the page through when an
 * action swaps one state for the other.
 */
@Component({
  selector: 'app-household',
  standalone: true,
  imports: [
    HouseholdMembersComponent,
    HouseholdOverviewComponent,
    HouseholdPlansComponent,
    HouseholdSetupComponent,
    LoadingSpinnerComponent,
    MatButtonModule,
    MatIconModule,
    PageHeaderComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HouseholdLedgerService, HouseholdPageFocus],
  templateUrl: './household.component.html',
  styleUrl: './household.component.scss'
})
export class HouseholdComponent implements OnInit {
  private readonly householdService = inject(HouseholdService);
  private readonly ledger = inject(HouseholdLedgerService);
  private readonly pageFocus = inject(HouseholdPageFocus);
  private readonly recurring = inject(RecurringService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly focus: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: this.destroyRef
  };

  readonly status = this.householdService.status;
  readonly lostAccess = this.householdService.lostAccess;
  readonly isOnline = inject(PwaService).isOnline;
  readonly householdName = computed(() => this.householdService.household()?.name ?? '');

  /** A live membership was seen, or the pointer was already looked at. */
  private pointerLookedAt = false;
  /** The loss on screen has had its pointer cleared. */
  private lossTidied = false;

  constructor() {
    // The members list is empty outside the member view, so leaving it
    // closes every member's listeners too.
    effect(() => this.ledger.setMembers(this.householdService.members()));

    effect(() => {
      const status = this.status();
      const lost = this.lostAccess();
      const online = this.isOnline();
      untracked(() => this.tidyPointer(status, lost, online));
    });

    // The section an action was taken in is gone once its status changes,
    // and focus with it; it goes to the section that came in.
    effect(() => {
      const status = this.status();
      if (!this.pageFocus.awaited()?.includes(status)) return;
      untracked(() => {
        this.pageFocus.clear();
        const landing = SWAP_LANDINGS[status];
        if (landing) focusWhenRendered(this.focus, [landing]);
      });
    });

    // Losing access takes the member view away just as an action would. The
    // notice says why; focus moves only if it was on the view that went.
    effect(() => {
      if (this.lostAccess()) untracked(() => this.pageFocus.afterSwapTo('none'));
    });
  }

  ngOnInit(): void {
    this.householdService.connect();
    this.destroyRef.onDestroy(() => this.householdService.disconnect());
    // The viewer's own recurring rules post only when their app catches them
    // up, which the dashboard does. A link straight to this page would
    // otherwise show the viewer's line short of what their dashboard shows.
    // Other members' rules post only from their own apps: the rules let no
    // one else write their records.
    this.recurring.catchUpRecurringTransactions().catch(() => {
      // Non-fatal: the page still shows every posted row.
    });
  }

  /**
   * Listens afresh; the failed listeners gave up and do not come back on
   * their own. The notice holding this button goes with the retry, and focus
   * goes to whatever replaces it.
   */
  retry(): void {
    this.householdService.disconnect();
    this.householdService.connect();
    this.pageFocus.afterSwapTo('member', 'none', 'unavailable');
  }

  /**
   * The profile's pointer outlives a membership that ended without this
   * account's own hand: the rules let only the account itself clear it. A
   * loss seen live says so. A loss that happened while no page listened
   * says nothing: from a cold cache it reads as no membership at all. So the
   * pointer is looked at once, the first time the page finds none, unless a
   * live membership was seen first; after that, a loss is always seen live.
   *
   * Offline, the clear would only be refused, so it waits for the
   * connection.
   */
  private tidyPointer(status: HouseholdStatus, lost: boolean, online: boolean): void {
    if (!lost) this.lossTidied = false;
    if (status === 'member') this.pointerLookedAt = true;
    if (!online) return;

    if (lost && !this.lossTidied) {
      this.lossTidied = true;
      this.pointerLookedAt = true;
      this.clearStalePointer();
    } else if (status === 'none' && !this.pointerLookedAt) {
      this.pointerLookedAt = true;
      this.clearStalePointer();
    }
  }

  private clearStalePointer(): void {
    // Nobody asked for this, and the page already shows the right state
    // either way. A pointer it could not clear is left for the next visit.
    this.householdService.clearStalePointer().catch(() => undefined);
  }
}
