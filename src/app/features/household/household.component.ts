import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { HouseholdOverviewComponent } from './household-overview/household-overview.component';
import { HouseholdSetupComponent } from './household-setup/household-setup.component';

/**
 * The household page (#71): the setup while the account has no live
 * membership, the member view while it has one.
 *
 * The page holds the household listeners for exactly as long as it is on
 * screen (ADR 0009): HouseholdService opens nothing until a page connects.
 *
 * It also provides the one HouseholdLedgerService its member-view sections
 * share, so every section reads the same listeners, closed with the page.
 */
@Component({
  selector: 'app-household',
  standalone: true,
  imports: [
    HouseholdOverviewComponent,
    HouseholdSetupComponent,
    LoadingSpinnerComponent,
    MatButtonModule,
    MatIconModule,
    PageHeaderComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HouseholdLedgerService],
  templateUrl: './household.component.html',
  styleUrl: './household.component.scss'
})
export class HouseholdComponent implements OnInit {
  private readonly householdService = inject(HouseholdService);
  private readonly ledger = inject(HouseholdLedgerService);
  private readonly destroyRef = inject(DestroyRef);

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
  }

  ngOnInit(): void {
    this.householdService.connect();
    this.destroyRef.onDestroy(() => this.householdService.disconnect());
  }

  /** Listens afresh; the failed listeners gave up and do not come back on their own. */
  retry(): void {
    this.householdService.disconnect();
    this.householdService.connect();
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
