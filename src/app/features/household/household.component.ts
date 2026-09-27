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
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { AnalyticsService } from '../../core/services/analytics.service';
import { HouseholdService, HouseholdStatus } from '../../core/services/household.service';
import { HouseholdLedgerService } from '../../core/services/household-ledger.service';
import { PwaService } from '../../core/services/pwa.service';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { HouseholdMembersComponent } from './household-members/household-members.component';
import { HouseholdOverviewComponent } from './household-overview/household-overview.component';
import { HouseholdPlansComponent } from './household-plans/household-plans.component';
import { HouseholdSetupComponent } from './household-setup/household-setup.component';
import { FocusContext, HouseholdPageFocus, HouseholdSwap, focusDropped, focusWhenRendered } from './household-focus';
import { routedHouseholdId } from './household-route';
import { SwitchOnChoiceDirective } from './switch-on-choice.directive';

/**
 * What the page's body shows: the setup (no live membership, or the viewer
 * chose to start or join another household), the selected household's member
 * view, the notice that it could not be loaded, or the wait for it.
 */
type HouseholdView = 'setup' | 'member' | 'unavailable' | 'loading';

/**
 * Where focus lands when an action swaps what the page shows: the first
 * heading of the view that came in, or the retry that came back.
 */
const SWAP_LANDINGS: Partial<Record<HouseholdView, string>> = {
  member: '#household-overview-title',
  setup: '#household-invites-title',
  unavailable: '.household-retry'
};

/** The status a view answers to in a swap: the setup is `none`. */
const VIEW_STATUS: Record<HouseholdView, HouseholdStatus> = {
  setup: 'none',
  member: 'member',
  unavailable: 'unavailable',
  loading: 'loading'
};

/**
 * The switcher's choice that shows the setup. Firestore reserves ids of the
 * form __.*__, so it is never a household's.
 */
const SETUP_CHOICE = '__setup__';

/** One household the switcher offers. */
interface SwitcherChoice {
  householdId: string;
  name: string;
  owned: boolean;
}

/**
 * The household page (#71): the setup while the account has no live
 * membership, and otherwise the member view of the selected household, with a
 * switcher in the header that moves between the account's households and
 * offers the setup beside them.
 *
 * /household/{hid} names the household shown. A household the account holds
 * no live membership in is replaced, in place, by the one the service would
 * select; /household itself shows that selection as it is. When the selection
 * moves by itself (a household created or joined, lost, or left), an address
 * naming a household follows it, in place. The setup, opened from the
 * switcher, is a view of the page rather than an address of its own: it names
 * no household to link to.
 *
 * The page holds the household listeners for exactly as long as it is on
 * screen (ADR 0009): HouseholdService opens nothing until a page connects.
 *
 * It also provides the one HouseholdLedgerService, fed here with the shown
 * household and its members and read by the overview, closed with the page,
 * and the HouseholdPageFocus its sections hand focus to the page through
 * when an action swaps one view for another.
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
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    PageHeaderComponent,
    SwitchOnChoiceDirective,
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
  private readonly analytics = inject(AnalyticsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly focus: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: this.destroyRef
  };
  private readonly switcher = viewChild(MatSelect, { read: ElementRef });

  readonly setupChoice = SETUP_CHOICE;
  readonly status = this.householdService.status;
  readonly lostAccess = this.householdService.lostAccess;
  readonly isOnline = inject(PwaService).isOnline;

  /** The viewer chose, in the switcher, to start or join another household. */
  private readonly setupOpen = signal(false);

  /**
   * The households the switcher offers: every live membership but one whose
   * loss this session saw. The one shown goes by its household's own name,
   * which a rename reaches before the index's copy of it.
   */
  readonly choices = computed<SwitcherChoice[]>(() => {
    const lost = this.householdService.lostHouseholds();
    const shown = this.householdService.household();
    return this.householdService
      .liveMemberships()
      .filter(membership => !lost.has(membership.householdId))
      .map(membership => ({
        householdId: membership.householdId,
        name: shown?.id === membership.householdId ? shown.name : membership.name,
        owned: membership.role === 'owner'
      }));
  });

  readonly view = computed<HouseholdView>(() => {
    const status = this.status();
    if (status === 'none' || (this.setupOpen() && this.choices().length > 0)) return 'setup';
    if (status === 'member' || status === 'unavailable') return status;
    return 'loading';
  });

  readonly switcherValue = computed<string | null>(() =>
    this.view() === 'setup' ? SETUP_CHOICE : this.householdService.selectedHouseholdId()
  );

  /** What the closed switcher reads: the household's name alone, without the role its choice carries. */
  readonly switcherName = computed(() => {
    const value = this.switcherValue();
    return this.choices().find(choice => choice.householdId === value)?.name ?? '';
  });

  /** The household the address names; null at /household. */
  private readonly routedAddress = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => routedHouseholdId(this.router))
    ),
    { initialValue: routedHouseholdId(this.router) }
  );

  /** The address last acted on: its household selected, or the address replaced. Undefined before the first. */
  private appliedAddress: string | null | undefined = undefined;
  /**
   * The address this page last moved to itself, following the selection.
   * Its arrival is not a navigation of the viewer's, so it leaves a setup the
   * viewer opened as it is: followSelection has already decided whether that
   * gives way.
   */
  private followedTo: string | null | undefined = undefined;
  /** The selection last seen, to tell when it moved. */
  private lastSelected: string | null | undefined = undefined;
  /** The household this page selected in place of one whose loss it saw. */
  private replacement: string | null = null;
  /** The losses already moved on from. */
  private lossesSeen: ReadonlySet<string> = new Set();

  /** The households the index was already looked at for: each seen live, or judged by a tidy. */
  private readonly lookedAt = new Set<string>();
  /** With nothing selected: a live membership was seen, or the index was already looked at. */
  private indexLookedAt = false;
  /** The lost households whose index entries a tidy was already asked to end. */
  private readonly lossesTidied = new Set<string>();

  constructor() {
    // Only the member view shows the ledger, so the ledger is given nothing
    // outside it, the setup opened beside a live membership included: its
    // listener closes, and no owner's purge is judged behind another view.
    effect(() => this.ledger.setHousehold(this.view() === 'member' ? this.householdService.household() : null));
    effect(() => this.ledger.setMembers(this.view() === 'member' ? this.householdService.members() : []));

    effect(() => {
      const status = this.status();
      const lost = this.householdService.lostHouseholds();
      const online = this.isOnline();
      const selected = this.householdService.selectedHouseholdId();
      untracked(() => this.tidyMemberships(status, lost, online, selected));
    });

    effect(() => {
      const address = this.routedAddress();
      const choices = this.choices();
      const selected = this.householdService.selectedHouseholdId();
      const status = this.status();
      untracked(() => this.followAddress(address, choices, selected, status));
    });

    effect(() => {
      const selected = this.householdService.selectedHouseholdId();
      const lost = this.householdService.lostHouseholds();
      const status = this.status();
      untracked(() => this.followSelection(selected, lost, status));
    });

    // The view a swap was asked from is gone once another comes in, and
    // focus with it; it goes to the view that came in.
    effect(() => {
      const swap = this.pageFocus.awaited();
      const view = this.view();
      const selected = this.householdService.selectedHouseholdId();
      if (swap) untracked(() => this.land(swap, view, selected));
    });

    // Losing access takes the member view away just as an action would. The
    // notice says why, and the page moves on to another household when there
    // is one; focus moves only if it was on the view that went.
    effect(() => {
      const lost = this.householdService.lostHouseholds();
      untracked(() => this.moveOnFrom(lost));
    });
  }

  ngOnInit(): void {
    this.householdService.connect();
    this.destroyRef.onDestroy(() => this.householdService.disconnect());
  }

  /**
   * A choice in the switcher. A household is reached through its own
   * address, which selects it; the setup opens beside the membership, which
   * stays selected. Either way the view swaps under the switcher, and focus
   * goes from the switcher to the view that comes in. Reaching another
   * household is a switch; the setup, a return from it to the household
   * still selected, and a navigation that did not go through are not.
   */
  choose(value: string): void {
    const origin = this.switcher()?.nativeElement ?? null;
    const from = this.householdService.selectedHouseholdId();
    this.followedTo = undefined;
    if (value === SETUP_CHOICE) {
      this.setupOpen.set(true);
      this.pageFocus.afterSwitchTo(null, origin);
      return;
    }
    this.setupOpen.set(false);
    this.pageFocus.afterSwitchTo(value, origin);
    void this.router.navigate(['/household', value]).then(moved => {
      if (moved && value !== from) this.analytics.trackHouseholdAction({ action: 'switch' });
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
   * Acts on each address once. A household the account is a live member of
   * is selected, and a setup the viewer opened gives way to it, unless the
   * address is the one this page moved to itself (followedTo). Any other is
   * judged only once the account's index has answered, which it has once
   * there is a selection, or a status past loading, and replaced in place by
   * the selection the service makes without it: nothing is shown under an
   * address naming a household the account cannot see.
   */
  private followAddress(
    address: string | null,
    choices: SwitcherChoice[],
    selected: string | null,
    status: HouseholdStatus
  ): void {
    if (address === this.appliedAddress) return;
    if (address === null) {
      this.appliedAddress = null;
      return;
    }
    if (choices.some(choice => choice.householdId === address)) {
      const followed = address === this.followedTo;
      this.followedTo = undefined;
      this.appliedAddress = address;
      if (!followed) this.setupOpen.set(false);
      if (selected !== address) this.householdService.select(address);
      return;
    }
    const indexHeard = selected !== null || (status !== 'idle' && status !== 'loading');
    if (!indexHeard) return;
    this.followedTo = undefined;
    this.appliedAddress = address;
    this.replaceAddress(this.shownSelection(selected, this.householdService.lostHouseholds()));
  }

  /**
   * The selection moved by itself: a household created or joined, one left,
   * lost or tidied away. A setup the viewer opened gives way to it, unless
   * the move is this page's own, away from a loss. An address naming a
   * household follows it, in place; /household already shows the selection.
   *
   * Nothing is selected while the index is unheard, as it is through a
   * retry, which closes every listener: that is no move, and the address
   * waits for the index's answer.
   */
  private followSelection(selected: string | null, lost: ReadonlySet<string>, status: HouseholdStatus): void {
    if (selected === null && (status === 'idle' || status === 'loading')) return;
    if (selected !== this.lastSelected) {
      const ownMove = selected !== null && selected === this.replacement;
      this.replacement = null;
      if (this.lastSelected !== undefined && !ownMove) this.setupOpen.set(false);
      this.lastSelected = selected;
    }
    const address = this.routedAddress();
    if (address === null || address !== this.appliedAddress) return;
    const shown = this.shownSelection(selected, lost);
    if (shown === address) return;
    this.followedTo = shown;
    this.replaceAddress(shown);
  }

  /** The selection an address may name: none while it is a household whose loss was seen. */
  private shownSelection(selected: string | null, lost: ReadonlySet<string>): string | null {
    return selected !== null && !lost.has(selected) ? selected : null;
  }

  private replaceAddress(householdId: string | null): void {
    void this.router.navigate(householdId ? ['/household', householdId] : ['/household'], { replaceUrl: true });
  }

  /**
   * A loss of the selected household, once seen, moves the selection to
   * another live membership when there is one; the loss is tidied either way
   * (tidyMemberships). The move is asked for as a swap to the setup, which
   * lands on whichever view comes in.
   */
  private moveOnFrom(lost: ReadonlySet<string>): void {
    const fresh = [...lost].some(householdId => !this.lossesSeen.has(householdId));
    this.lossesSeen = lost;
    if (!fresh) return;
    const selected = this.householdService.selectedHouseholdId();
    const next = this.choices()[0];
    if (selected !== null && lost.has(selected) && next) {
      this.replacement = next.householdId;
      this.householdService.select(next.householdId);
    }
    this.pageFocus.afterSwapTo('none');
  }

  /**
   * Moves focus to the view a swap waited for, once it is on screen.
   *
   * - A switch lands on the household it named, or on the setup, and moves
   *   focus from the switcher as well as from the document.
   * - An action lands on a view of a status it named. One that took a
   *   household away (a leave, a dissolve, a loss) names the setup, and
   *   lands on another household's member view too when that comes in
   *   instead; but only once focus has gone with the view it was taken in,
   *   since until then the member view on screen is that one. The answer
   *   to one can land before the action's own promise settles, so the
   *   view may already be the next household's when it is asked for.
   */
  private land(swap: HouseholdSwap, view: HouseholdView, selected: string | null): void {
    const landing = SWAP_LANDINGS[view];
    if (!landing) return;
    if (swap.kind === 'switch') {
      const arrived = swap.switchTo === null ? view === 'setup' : view !== 'setup' && selected === swap.switchTo;
      if (!arrived) return;
      this.pageFocus.clear();
      focusWhenRendered(this.focus, [landing], { from: swap.origin });
      return;
    }
    if (swap.statuses.includes(VIEW_STATUS[view])) {
      this.pageFocus.clear();
      focusWhenRendered(this.focus, [landing]);
      return;
    }
    if (view === 'member' && swap.statuses.includes('none') && focusDropped()) {
      this.pageFocus.clear();
      focusWhenRendered(this.focus, [landing]);
    }
  }

  /**
   * An index entry outlives a membership that ended without this account's
   * own hand: the rules let only the account itself delete it. A loss seen
   * live says so. A loss that happened while no page listened says nothing:
   * from a cold cache it reads as no membership at all, and the switcher
   * would go on offering it. So the index is looked at once for each
   * household the page finds no membership in without having seen it live
   * or had it judged by a tidy already; and once, with nothing selected, the
   * first time the page finds none, unless a live membership was seen first.
   * The viewer's own leave or dissolve of a household the page showed is
   * not taken for such an entry.
   *
   * Each lost household is tidied once while it stays lost, so a second
   * loss is tidied even while the first one's notice still shows; one that
   * leaves the set and is lost again is tidied again.
   *
   * Offline, the tidy would only be refused, so it waits for the connection.
   */
  private tidyMemberships(
    status: HouseholdStatus,
    lost: ReadonlySet<string>,
    online: boolean,
    selected: string | null
  ): void {
    for (const householdId of [...this.lossesTidied]) {
      if (!lost.has(householdId)) this.lossesTidied.delete(householdId);
    }
    if (status === 'member') {
      this.indexLookedAt = true;
      if (selected !== null) this.lookedAt.add(selected);
    }
    if (!online) return;

    const untidied = [...lost].filter(householdId => !this.lossesTidied.has(householdId));
    if (untidied.length > 0) {
      for (const householdId of untidied) this.lossesTidied.add(householdId);
      this.lookAtIndex();
      return;
    }
    if (status !== 'none') return;
    const unjudged = selected === null ? !this.indexLookedAt : !this.lookedAt.has(selected) && !lost.has(selected);
    if (unjudged) this.lookAtIndex();
  }

  /**
   * A tidy judges every entry the index lists, so none of them is looked at
   * again by this page. One that ends after it, while another household is
   * shown, is left for the next visit.
   */
  private lookAtIndex(): void {
    this.indexLookedAt = true;
    for (const membership of this.householdService.memberships()) this.lookedAt.add(membership.householdId);
    // Nobody asked for this, and the page already shows the right state
    // either way. An entry it could not tidy is left for the next visit.
    this.householdService.tidyEndedMemberships().catch(() => undefined);
  }
}
