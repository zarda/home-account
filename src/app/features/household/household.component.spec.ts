import { ChangeDetectionStrategy, Component, Signal, computed, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { Subject } from 'rxjs';

import en from '../../../assets/i18n/en.json';
import { HouseholdComponent } from './household.component';
import { HouseholdSetupComponent } from './household-setup/household-setup.component';
import { HouseholdOverviewComponent } from './household-overview/household-overview.component';
import { HouseholdPlansComponent } from './household-plans/household-plans.component';
import { HouseholdMembersComponent } from './household-members/household-members.component';
import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdService,
  HouseholdStatus
} from '../../core/services/household.service';
import { HouseholdLedgerService } from '../../core/services/household-ledger.service';
import { HouseholdPlansService } from '../../core/services/household-plans.service';
import { LedgerShareService } from '../../core/services/ledger-share.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { CollectionWithMetadata, FirestoreService } from '../../core/services/firestore.service';
import { PwaService } from '../../core/services/pwa.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { RecurringService } from '../../core/services/recurring.service';
import { TranslationService } from '../../core/services/translation.service';
import { createTranslationStub, provideNoMotion } from '../../core/services/testing';
import { planWindow } from '../../core/utils/household-plans.utils';
import { Household, HouseholdBudget, HouseholdMember, HouseholdMembership } from '../../models';
import { HouseholdPageFocus } from './household-focus';

/** The setup state has its own spec; here only its presence, and its first heading, are the question. */
@Component({
  selector: 'app-household-setup',
  standalone: true,
  template: '<h2 id="household-invites-title" tabindex="-1">Invites for you</h2><button type="button" class="stub-create">Create</button>',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubSetupComponent {}

/** The overview has its own spec; here the question is which ledger it is given. */
@Component({
  selector: 'app-household-overview',
  standalone: true,
  template: '<h2 id="household-overview-title" tabindex="-1">Income and spending</h2>',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubOverviewComponent {
  readonly ledger = inject(HouseholdLedgerService);
}

/** The budgets and goals have their own spec; here the questions are where they sit and which plans they read. */
@Component({
  selector: 'app-household-plans',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubPlansComponent {
  readonly plans = inject(HouseholdPlansService);
}

/** The page's one way to the sharing code, a dynamic import. */
interface SharingLoader {
  ledgerShare: () => Promise<LedgerShareService>;
}

/** The members and their management have their own spec; here only where they sit is the question. */
@Component({
  selector: 'app-household-members',
  standalone: true,
  template: '<button type="button" class="stub-leave">Leave</button>',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubMembersComponent {}

const HOUSEHOLD: Household = {
  id: 'h1',
  name: 'The Lins',
  ownerId: 'owner-1',
  createdAt: Timestamp.fromMillis(1_700_000_000_000)
};

const FLAT: Household = {
  id: 'h2',
  name: 'Flat 4B',
  ownerId: 'someone-else',
  createdAt: Timestamp.fromMillis(1_710_000_000_000)
};

const member = (uid: string, displayName: string): HouseholdMember => ({
  uid,
  displayName,
  role: uid === 'owner-1' ? 'owner' : 'member',
  since: HOUSEHOLD.createdAt,
  joinedAt: HOUSEHOLD.createdAt
});

function membership(household: Household, overrides: Partial<HouseholdMembership> = {}): HouseholdMembership {
  return {
    householdId: household.id,
    name: household.name,
    role: household.ownerId === 'owner-1' ? 'owner' : 'member',
    since: household.createdAt,
    joinedAt: household.createdAt,
    ended: false,
    ...overrides
  };
}

/** The same shape as the app's household route, without the page the spec renders itself. */
const ROUTES = [{ path: 'household', children: [{ path: ':hid', children: [] }] }];

// Rendered throughout (ADR 0144): which state the page shows is the thing
// under test, and only the template can say.
describe('HouseholdComponent', () => {
  let fixture: ComponentFixture<HouseholdComponent>;
  let router: Router;
  let status: ReturnType<typeof signal<HouseholdStatus>>;
  let household: ReturnType<typeof signal<Household | null>>;
  let lostHouseholds: ReturnType<typeof signal<ReadonlySet<string>>>;
  let online: ReturnType<typeof signal<boolean>>;
  let members: ReturnType<typeof signal<HouseholdMember[]>>;
  let memberships: ReturnType<typeof signal<HouseholdMembership[]>>;
  let selected: ReturnType<typeof signal<string | null>>;
  let ledger: { setHousehold: jasmine.Spy; setMembers: jasmine.Spy; setPlanWindow: jasmine.Spy };
  /** The plans' listeners, by path, as the page's own HouseholdPlansService opened them. */
  let planListeners: Map<string, Subject<CollectionWithMetadata<unknown>>>;
  let plansHousehold: jasmine.Spy;
  let plansNow: jasmine.Spy;
  let sharing: { reconcileAll: jasmine.Spy };
  let loader: jasmine.Spy;
  let catchUp: jasmine.Spy;
  let analytics: jasmine.SpyObj<Pick<AnalyticsService, 'trackHouseholdAction'>>;
  let service: {
    status: typeof status;
    household: typeof household;
    members: typeof members;
    memberships: typeof memberships;
    liveMemberships: Signal<HouseholdMembership[]>;
    selectedHouseholdId: typeof selected;
    lostHouseholds: typeof lostHouseholds;
    lostAccess: Signal<boolean>;
    select: jasmine.Spy;
    connect: jasmine.Spy;
    disconnect: jasmine.Spy;
    tidyEndedMemberships: jasmine.Spy;
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const heading = (): string => element().querySelector('h1')?.textContent?.trim() ?? '';
  const header = (): Element | null => element().querySelector('app-page-header');
  const switcher = (): HTMLElement | null => element().querySelector<HTMLElement>('mat-select.household-switcher-select');
  const switcherValue = (): string =>
    switcher()?.querySelector('.mat-mdc-select-value')?.textContent?.trim() ?? '';
  const options = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
  const overviewTitle = (): HTMLElement | null => element().querySelector<HTMLElement>('#household-overview-title');
  const invitesTitle = (): HTMLElement | null => element().querySelector<HTMLElement>('#household-invites-title');

  function render(): void {
    fixture.detectChanges();
  }

  /** Lets afterNextRender run: it fires on the app's own tick, which detectChanges alone does not run. */
  async function settleFocus(): Promise<void> {
    render();
    await fixture.whenStable();
    TestBed.tick();
  }

  /** Lets a navigation the page started finish, and the page answer it. */
  async function settleRoute(): Promise<void> {
    render();
    await fixture.whenStable();
    render();
    await fixture.whenStable();
    render();
  }

  const pageFocus = (): HouseholdPageFocus => fixture.debugElement.injector.get(HouseholdPageFocus);

  /** The account's index lists these; the first is selected and shown. */
  function showMember(shown: Household, list: HouseholdMembership[] = [membership(shown)]): void {
    memberships.set(list);
    selected.set(shown.id);
    household.set(shown);
    status.set('member');
    render();
  }

  /** What the service does once a selected household's view has been heard. */
  function arrive(shown: Household): void {
    household.set(shown);
    status.set('member');
  }

  function openSwitcher(): void {
    switcher()?.querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
    render();
  }

  function choose(label: string): void {
    openSwitcher();
    const option = options().find(candidate => candidate.textContent?.includes(label));
    expect(option).withContext(`an option reading ${label}`).toBeDefined();
    option?.click();
    render();
  }

  beforeEach(async () => {
    status = signal<HouseholdStatus>('idle');
    household = signal<Household | null>(null);
    lostHouseholds = signal<ReadonlySet<string>>(new Set());
    online = signal(true);
    members = signal<HouseholdMember[]>([]);
    memberships = signal<HouseholdMembership[]>([]);
    selected = signal<string | null>(null);
    ledger = {
      setHousehold: jasmine.createSpy('setHousehold'),
      setMembers: jasmine.createSpy('setMembers'),
      setPlanWindow: jasmine.createSpy('setPlanWindow')
    };
    planListeners = new Map();
    // The page's own plans service, watched: which household and which day
    // the page hands it is the question, and its budgets' answer reaching the
    // page's ledger.
    plansHousehold = spyOn(HouseholdPlansService.prototype, 'setHousehold').and.callThrough();
    plansNow = spyOn(HouseholdPlansService.prototype, 'setNow').and.callThrough();
    sharing = { reconcileAll: jasmine.createSpy('reconcileAll').and.resolveTo() };
    // Straight to the fake: the case that needs the dynamic import itself
    // lets it through.
    loader = spyOn(HouseholdComponent.prototype as unknown as SharingLoader, 'ledgerShare')
      .and.callFake(async () => sharing as unknown as LedgerShareService);
    catchUp = jasmine.createSpy('catchUpRecurringTransactions').and.resolveTo([]);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackHouseholdAction']);
    service = {
      status,
      household,
      members,
      memberships,
      liveMemberships: computed(() => memberships().filter(entry => !entry.ended)),
      selectedHouseholdId: selected,
      lostHouseholds,
      lostAccess: computed(() => lostHouseholds().size > 0),
      // As the service does: a live membership becomes the selection, and its
      // view loads afresh.
      select: jasmine.createSpy('select').and.callFake((householdId: string) => {
        const live = memberships().some(entry => entry.householdId === householdId && !entry.ended);
        if (!live || selected() === householdId) return;
        selected.set(householdId);
        household.set(null);
        status.set('loading');
      }),
      connect: jasmine.createSpy('connect').and.callFake(() => {
        if (status() === 'idle') status.set('loading');
      }),
      disconnect: jasmine.createSpy('disconnect'),
      tidyEndedMemberships: jasmine.createSpy('tidyEndedMemberships').and.resolveTo(false)
    };

    await TestBed.configureTestingModule({
      imports: [HouseholdComponent],
      providers: [
        provideRouter(ROUTES),
        { provide: HouseholdService, useValue: service },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: RecurringService, useValue: { catchUpRecurringTransactions: catchUp } },
        { provide: AnalyticsService, useValue: analytics },
        {
          provide: FirestoreService,
          useValue: {
            subscribeToCollectionWithMetadata: (path: string) => {
              const listener = new Subject<CollectionWithMetadata<unknown>>();
              planListeners.set(path, listener);
              return listener.asObservable();
            }
          }
        },
        { provide: AuthService, useValue: { userId: signal('owner-1'), currentUser: signal(null) } },
        { provide: CurrencyService, useValue: { convert: (amount: number) => amount } },
        { provide: LedgerShareService, useValue: sharing },
        provideNoMotion()
      ]
    })
      .overrideComponent(HouseholdComponent, {
        remove: {
          imports: [HouseholdSetupComponent, HouseholdOverviewComponent, HouseholdPlansComponent, HouseholdMembersComponent],
          providers: [HouseholdLedgerService]
        },
        add: {
          imports: [StubSetupComponent, StubOverviewComponent, StubPlansComponent, StubMembersComponent],
          providers: [{ provide: HouseholdLedgerService, useValue: ledger }]
        }
      })
      .compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(HouseholdComponent);
    render();
  });

  describe('its connection', () => {
    it('connects once on init', () => {
      expect(service.connect).toHaveBeenCalledTimes(1);
      expect(service.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects once on destroy', () => {
      fixture.destroy();

      expect(service.disconnect).toHaveBeenCalledTimes(1);
    });

    // A recurring rule's occurrences start private, and the page reads only
    // what members shared, so posting them here would change nothing it shows.
    it("leaves the viewer's recurring rules to the pages that show their own records", () => {
      expect(catchUp).not.toHaveBeenCalled();
    });
  });

  // Every swap of what the page shows takes the focused element with it.
  describe('where focus goes when an action swaps what the page shows', () => {
    it("moves to the member view's first heading once a create or join lands", async () => {
      status.set('none');
      render();
      pageFocus().afterSwapTo('member');
      await settleFocus();
      expect(document.activeElement).withContext('not before the swap').not.toBe(invitesTitle());

      household.set(HOUSEHOLD);
      status.set('member');
      await settleFocus();

      expect(document.activeElement).toBe(overviewTitle());
      expect(pageFocus().awaited()).withContext('once, not at every later swap').toBeNull();
    });

    it("moves to the setup's first heading once a leave or dissolve lands", async () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();
      element().querySelector<HTMLButtonElement>('.stub-leave')?.focus();
      pageFocus().afterSwapTo('none');

      household.set(null);
      status.set('none');
      await settleFocus();

      expect(document.activeElement).toBe(invitesTitle());
    });

    it("moves to the next household's first heading when a leave or dissolve lands on it", async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      element().querySelector<HTMLButtonElement>('.stub-leave')?.focus();
      pageFocus().afterSwapTo('none');
      await settleFocus();
      expect(document.activeElement)
        .withContext('the view the leave was asked from is still on screen, and focus with it')
        .toBe(element().querySelector('.stub-leave'));

      memberships.set([membership(HOUSEHOLD, { ended: true }), membership(FLAT)]);
      selected.set(FLAT.id);
      household.set(null);
      status.set('loading');
      await settleFocus();
      arrive(FLAT);
      await settleFocus();

      expect(document.activeElement).toBe(overviewTitle());
      expect(pageFocus().awaited()).toBeNull();
    });

    it('moves nothing on a first load, or on a swap nobody here asked for', async () => {
      status.set('none');
      await settleFocus();
      expect(document.activeElement).toBe(document.body);

      household.set(HOUSEHOLD);
      status.set('member');
      await settleFocus();

      expect(document.activeElement).toBe(document.body);
    });

    it('moves into the setup when access is lost with focus on the view that went', async () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();
      element().querySelector<HTMLButtonElement>('.stub-leave')?.focus();

      household.set(null);
      status.set('none');
      lostHouseholds.set(new Set([HOUSEHOLD.id]));
      await settleFocus();

      expect(document.activeElement).toBe(invitesTitle());
      expect(text()).toContain('household.lostAccess');
    });

    it('moves to what replaces the notice after a retry', async () => {
      service.disconnect.and.callFake(() => status.set('idle'));
      status.set('unavailable');
      render();
      const retry = element().querySelector<HTMLButtonElement>('button.household-retry') as HTMLButtonElement;
      retry.focus();

      retry.click();
      await settleFocus();
      expect(status()).toBe('loading');

      household.set(HOUSEHOLD);
      status.set('member');
      await settleFocus();

      expect(document.activeElement).toBe(overviewTitle());
    });

    it('moves to the retry that came back when a retry fails again', async () => {
      service.disconnect.and.callFake(() => status.set('idle'));
      status.set('unavailable');
      render();
      element().querySelector<HTMLButtonElement>('button.household-retry')?.click();
      await settleFocus();

      status.set('unavailable');
      await settleFocus();

      expect(document.activeElement).toBe(element().querySelector('button.household-retry'));
    });
  });

  describe('its states', () => {
    it('shows a labelled progress indicator while the household loads', () => {
      const spinner = element().querySelector('mat-spinner');

      expect(spinner).withContext('a progress indicator').not.toBeNull();
      expect(spinner?.getAttribute('aria-label')).toBe('household.loading');
      expect(heading()).toBe('household.title');
      expect(element().querySelector('app-household-setup')).toBeNull();
    });

    it('shows the setup with no live membership', () => {
      status.set('none');
      render();

      expect(element().querySelector('app-household-setup')).not.toBeNull();
      expect(heading()).toBe('household.title');
      expect(header()?.textContent).toContain('household.subtitle');
      expect(switcher()).withContext('nothing to switch between').toBeNull();
      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(element().querySelector('.member-view')).toBeNull();
    });

    it('shows the member view with one, the household named in the page header', async () => {
      showMember(HOUSEHOLD);
      await settleRoute();

      expect(element().querySelector('.member-view')).not.toBeNull();
      expect(heading()).toBe('household.title');
      expect(element().querySelectorAll('h1').length).toBe(1);
      expect(header()?.contains(switcher())).withContext('the switcher sits in the page header').toBeTrue();
      expect(switcherValue()).toBe('The Lins');
      expect(header()?.textContent).toContain('household.memberSubtitle');
      expect(header()?.textContent).not.toContain('household.subtitle');
      expect(element().querySelector('app-household-setup')).toBeNull();
      expect(element().querySelector('mat-spinner')).toBeNull();
    });

    it('shows the members last in the member view, after the budgets and goals', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      const sections = Array.from(element().querySelectorAll('.member-view > *')).map(node => node.tagName.toLowerCase());
      expect(sections).toEqual(['app-household-overview', 'app-household-plans', 'app-household-members']);
    });

    it('shows no members section outside the member view', () => {
      status.set('none');
      render();

      expect(element().querySelector('app-household-members')).toBeNull();
    });

    it('says a household switched to offline, never loaded on this device, is not loaded, rather than offering the setup', async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      online.set(false);
      choose('Flat 4B');
      await settleRoute();
      status.set('notLoaded');
      render();

      const notice = element().querySelector('.household-not-loaded');
      expect(notice?.textContent).toContain('household.notLoadedTitle');
      expect(notice?.textContent).toContain('household.notLoadedDescription');
      expect(element().querySelector('app-household-setup')).withContext('not the setup').toBeNull();
      expect(element().querySelector('app-loading-spinner')).withContext('not a wait that never ends').toBeNull();
      expect(switcherValue()).toBe('Flat 4B');

      online.set(true);
      arrive(FLAT);
      render();

      expect(element().querySelector('.household-not-loaded')).toBeNull();
      expect(overviewTitle()).not.toBeNull();
    });

    it('says the household could not be loaded, and a retry reconnects', () => {
      status.set('unavailable');
      render();

      expect(text()).toContain('household.unavailable');
      expect(element().querySelector('app-household-setup')).toBeNull();

      const retry = element().querySelector<HTMLButtonElement>('button.household-retry');
      expect(retry).withContext('a retry button').not.toBeNull();
      service.connect.calls.reset();

      retry?.click();

      expect(service.disconnect).toHaveBeenCalledTimes(1);
      expect(service.connect).toHaveBeenCalledTimes(1);
      expect(service.disconnect).toHaveBeenCalledBefore(service.connect);
    });
  });

  describe('the switcher', () => {
    it('is labelled, and names the household shown', async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await settleRoute();

      const field = switcher()?.closest('mat-form-field');
      expect(field?.querySelector('mat-label')?.textContent?.trim()).toBe('household.switcher.label');
      const labelledBy = (switcher()?.getAttribute('aria-labelledby') ?? '').split(' ');
      expect(labelledBy).withContext('the select is named by its label').toContain(
        field?.querySelector('label')?.id ?? 'no label'
      );
      expect(switcherValue()).toBe('The Lins');
    });

    it('lists only the live memberships, by name, and then the way to start or join another', () => {
      const ended: Household = { ...FLAT, id: 'h3', name: 'Old flat' };
      const lost: Household = { ...FLAT, id: 'h4', name: 'Gone house' };
      showMember(HOUSEHOLD, [
        membership(HOUSEHOLD),
        membership(FLAT),
        membership(ended, { ended: true }),
        membership(lost)
      ]);
      lostHouseholds.set(new Set([lost.id]));
      render();
      openSwitcher();

      const listed = options().map(option => option.textContent?.trim() ?? '');
      expect(listed.length).toBe(3);
      expect(listed[0]).toContain('The Lins');
      expect(listed[1]).toContain('Flat 4B');
      expect(listed[2]).toBe('household.switcher.setup');
      expect(listed.join('|')).not.toContain('Old flat');
      expect(listed.join('|')).not.toContain('Gone house');
    });

    it('says which of them the account owns', () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      openSwitcher();

      expect(options()[0].textContent).toContain('household.members.roleOwner');
      expect(options()[1].textContent).not.toContain('household.members.roleOwner');
    });

    it('shows with one membership, so starting or joining another stays one choice away', () => {
      showMember(HOUSEHOLD);
      openSwitcher();

      expect(switcher()).not.toBeNull();
      expect(options().map(option => option.textContent?.trim())).toEqual([
        jasmine.stringContaining('The Lins'),
        'household.switcher.setup'
      ]);
    });

    it("moves to the chosen household's own address, which selects it", async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);

      choose('Flat 4B');
      await settleRoute();

      expect(router.url).toBe('/household/h2');
      expect(service.select).toHaveBeenCalledWith('h2');
      expect(selected()).toBe('h2');
      expect(status()).toBe('loading');
      expect(header()?.textContent).withContext('the header reads the same while it loads').toContain('household.memberSubtitle');
    });

    it("moves focus from the switcher to the chosen household's first heading once it shows", async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);

      choose('Flat 4B');
      expect(document.activeElement).withContext('the list hands focus back to the switcher').toBe(switcher());
      await settleRoute();
      await settleFocus();
      expect(document.activeElement).withContext('not before it shows').not.toBe(overviewTitle());

      arrive(FLAT);
      await settleFocus();

      expect(document.activeElement).toBe(overviewTitle());
      expect(pageFocus().awaited()).toBeNull();
    });

    it('leaves focus where the viewer put it while the household loaded', async () => {
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      try {
        showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
        choose('Flat 4B');
        await settleRoute();
        elsewhere.focus();

        arrive(FLAT);
        await settleFocus();

        expect(document.activeElement).toBe(elsewhere);
      } finally {
        elsewhere.remove();
      }
    });

    it('opens its list on an arrow key rather than switching household by household', async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      const select = switcher() as HTMLElement;
      select.focus();
      // Material reads the legacy keyCode, which a constructed event leaves at 0.
      const keydown = (key: string, keyCode: number): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        Object.defineProperty(event, 'keyCode', { get: () => keyCode });
        return event;
      };

      for (const [key, keyCode] of [['ArrowDown', 40], ['ArrowUp', 38], ['End', 35], ['f', 70]] as const) {
        select.dispatchEvent(keydown(key, keyCode));
        render();
        await settleRoute();
        expect(service.select).withContext(key).not.toHaveBeenCalled();
        expect(switcherValue()).withContext(key).toBe('The Lins');
        expect(options().length).withContext(`${key} opens the list`).toBe(3);

        select.dispatchEvent(keydown('Escape', 27));
        await settleRoute();
        expect(options().length).withContext('closed again').toBe(0);
      }
      expect(router.url).toBe('/');
    });

    describe('starting or joining another household', () => {
      beforeEach(() => showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]));

      it('shows the setup without leaving the membership', async () => {
        choose('household.switcher.setup');
        await settleRoute();

        expect(element().querySelector('app-household-setup')).not.toBeNull();
        expect(element().querySelector('.member-view')).toBeNull();
        expect(switcher()).withContext('the switcher stays').not.toBeNull();
        expect(switcherValue()).toBe('household.switcher.setup');
        expect(header()?.textContent).toContain('household.subtitle');
        expect(service.select).not.toHaveBeenCalled();
        expect(selected()).toBe('h1');
        expect(router.url).toBe('/');
      });

      it("moves focus to the setup's first heading", async () => {
        choose('household.switcher.setup');
        await settleFocus();

        expect(document.activeElement).toBe(invitesTitle());
      });

      it('goes back to a household chosen in the switcher, and focus with it', async () => {
        choose('household.switcher.setup');
        await settleFocus();

        choose('The Lins');
        await settleRoute();
        await settleFocus();

        expect(element().querySelector('app-household-setup')).toBeNull();
        expect(element().querySelector('.member-view')).not.toBeNull();
        expect(switcherValue()).toBe('The Lins');
        expect(document.activeElement).toBe(overviewTitle());
      });

      it('gives way to the household the account creates or joins from it', async () => {
        choose('household.switcher.setup');
        await settleFocus();
        const made: Household = { ...FLAT, id: 'h-new', name: 'New home', ownerId: 'owner-1' };

        memberships.set([membership(HOUSEHOLD), membership(FLAT), membership(made)]);
        selected.set(made.id);
        household.set(null);
        status.set('loading');
        render();
        arrive(made);
        await settleRoute();

        expect(element().querySelector('app-household-setup')).toBeNull();
        expect(element().querySelector('.member-view')).not.toBeNull();
        expect(switcherValue()).toBe('New home');
      });
    });

    /**
     * A switch is the viewer's own pick of another household, reported once
     * its address is reached; which household it was would say more than
     * the action.
     */
    describe('household_action', () => {
      beforeEach(async () => {
        showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
        await settleRoute();
      });

      it('reports one switch when the viewer picks another household', async () => {
        choose('Flat 4B');
        await settleRoute();

        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'switch' });
      });

      it('reports nothing for the household the page opens on', () => {
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('reports nothing for opening the setup, or for going back from it to the same household', async () => {
        choose('household.switcher.setup');
        await settleFocus();
        choose('The Lins');
        await settleRoute();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('reports nothing when the move to the chosen household does not go through', async () => {
        spyOn(router, 'navigate').and.resolveTo(false);

        choose('Flat 4B');
        await settleRoute();

        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });
    });
  });

  describe('its address', () => {
    let navigate: jasmine.Spy;

    beforeEach(() => {
      navigate = spyOn(router, 'navigate').and.callThrough();
    });

    it('selects the household /household/{hid} names', async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);

      await router.navigateByUrl('/household/h2');
      await settleRoute();

      expect(service.select).toHaveBeenCalledWith('h2');
      expect(router.url).toBe('/household/h2');
    });

    it('falls back to the selection the account would have, in place, for a household it is not in', async () => {
      await router.navigateByUrl('/household/unknown');
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await settleRoute();

      expect(service.select).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/household', 'h1'], jasmine.objectContaining({ replaceUrl: true }));
      expect(router.url).toBe('/household/h1');
    });

    it('falls back the same way for a membership that has ended', async () => {
      await router.navigateByUrl('/household/h2');
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT, { ended: true })]);
      await settleRoute();

      expect(service.select).not.toHaveBeenCalledWith('h2');
      expect(router.url).toBe('/household/h1');
    });

    it('waits for the account’s index before judging a household', async () => {
      await router.navigateByUrl('/household/h2');
      await settleRoute();

      expect(status()).toBe('loading');
      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/household/h2');

      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await settleRoute();

      expect(service.select).toHaveBeenCalledWith('h2');
      expect(router.url).toBe('/household/h2');
    });

    it('falls back to /household, in place, with no live membership at all', async () => {
      await router.navigateByUrl('/household/unknown');
      status.set('none');
      await settleRoute();

      expect(navigate).toHaveBeenCalledWith(['/household'], jasmine.objectContaining({ replaceUrl: true }));
      expect(router.url).toBe('/household');
      expect(element().querySelector('app-household-setup')).not.toBeNull();
    });

    it('leaves /household as it is, showing the selection', async () => {
      await router.navigateByUrl('/household');
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await settleRoute();

      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/household');
    });

    it('follows the selection, in place, when it moves to a household the account creates or joins', async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await router.navigateByUrl('/household/h1');
      await settleRoute();

      const made: Household = { ...FLAT, id: 'h-new', name: 'New home', ownerId: 'owner-1' };
      memberships.set([membership(HOUSEHOLD), membership(FLAT), membership(made)]);
      selected.set(made.id);
      await settleRoute();

      expect(navigate).toHaveBeenCalledWith(['/household', 'h-new'], jasmine.objectContaining({ replaceUrl: true }));
      expect(router.url).toBe('/household/h-new');
    });

    describe('through a retry', () => {
      beforeEach(async () => {
        showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
        await router.navigateByUrl('/household/h1');
        await settleRoute();
        status.set('unavailable');
        render();
        // As the service does: a retry closes every listener, the index's
        // with them, so nothing is selected until the index answers again.
        service.disconnect.and.callFake(() => {
          memberships.set([]);
          selected.set(null);
          household.set(null);
          status.set('idle');
        });
        navigate.calls.reset();

        element().querySelector<HTMLButtonElement>('button.household-retry')?.click();
        await settleRoute();
      });

      it('keeps the address while the index is heard again', async () => {
        expect(status()).toBe('loading');
        expect(navigate).not.toHaveBeenCalled();
        expect(router.url).toBe('/household/h1');

        memberships.set([membership(HOUSEHOLD), membership(FLAT)]);
        selected.set(HOUSEHOLD.id);
        arrive(HOUSEHOLD);
        await settleRoute();

        expect(navigate).not.toHaveBeenCalled();
        expect(router.url).toBe('/household/h1');
        expect(element().querySelector('.member-view')).not.toBeNull();
      });

      it('falls back to /household, in place, when the index heard again lists no membership', async () => {
        status.set('none');
        await settleRoute();

        expect(navigate).toHaveBeenCalledWith(['/household'], jasmine.objectContaining({ replaceUrl: true }));
        expect(router.url).toBe('/household');
        expect(element().querySelector('app-household-setup')).not.toBeNull();
      });
    });
  });

  describe('the ledger', () => {
    const overview = (): StubOverviewComponent | null => {
      const host = fixture.debugElement.query(debug => debug.name === 'app-household-overview');
      return host ? (host.componentInstance as StubOverviewComponent) : null;
    };

    it('is the one the member view\'s overview reads', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      expect(element().querySelector('.member-view app-household-overview')).not.toBeNull();
      expect(overview()?.ledger).toBe(ledger as unknown as HouseholdLedgerService);
    });

    it('has the budgets and goals shown after the overview', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      const sections = Array.from(element().querySelectorAll('.member-view > *')).map(node => node.tagName.toLowerCase());
      expect(sections.indexOf('app-household-plans'))
        .withContext('after the overview')
        .toBe(sections.indexOf('app-household-overview') + 1);
    });

    it('is given no household and nobody outside the member view', () => {
      status.set('none');
      render();

      expect(ledger.setHousehold).toHaveBeenCalled();
      expect(ledger.setHousehold.calls.mostRecent().args[0]).toBeNull();
      expect(ledger.setMembers).toHaveBeenCalled();
      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([]);
      expect(overview()).toBeNull();
      expect(element().querySelector('app-household-plans')).toBeNull();
    });

    it('is given the household shown, and each household switched to', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      expect(ledger.setHousehold.calls.mostRecent().args[0]).toEqual(HOUSEHOLD);

      household.set(FLAT);
      render();

      expect(ledger.setHousehold.calls.mostRecent().args[0]).toEqual(FLAT);
    });

    it('is given every member, and each change to them', () => {
      const owner = member('owner-1', 'Alex');
      const peer = member('peer-1', 'Sam');
      household.set(HOUSEHOLD);
      status.set('member');
      members.set([owner, peer]);
      render();

      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([owner, peer]);

      members.set([owner]);
      render();

      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([owner]);
    });

    it('is given no household and nobody while the setup is open beside a live membership, and both again after', async () => {
      const owner = member('owner-1', 'Alex');
      members.set([owner]);
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      expect(ledger.setHousehold.calls.mostRecent().args[0]).toEqual(HOUSEHOLD);

      choose('household.switcher.setup');
      await settleRoute();

      expect(overview()).toBeNull();
      expect(ledger.setHousehold.calls.mostRecent().args[0])
        .withContext('no listener behind the setup, and no purge judged there')
        .toBeNull();
      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([]);

      choose('The Lins');
      await settleRoute();

      expect(overview()).not.toBeNull();
      expect(ledger.setHousehold.calls.mostRecent().args[0]).toEqual(HOUSEHOLD);
      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([owner]);
    });

    it('lets the household and its members go when the membership ends', () => {
      const owner = member('owner-1', 'Alex');
      household.set(HOUSEHOLD);
      status.set('member');
      members.set([owner]);
      render();

      household.set(null);
      status.set('none');
      members.set([]);
      render();

      expect(ledger.setHousehold.calls.mostRecent().args[0]).toBeNull();
      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([]);
    });
  });

  describe('the plans', () => {
    const plansSection = (): StubPlansComponent | null => {
      const host = fixture.debugElement.query(debug => debug.name === 'app-household-plans');
      return host ? (host.componentInstance as StubPlansComponent) : null;
    };

    const budget: HouseholdBudget = {
      id: 'b1',
      gen: HOUSEHOLD.createdAt,
      name: 'Groceries',
      categoryIds: ['food'],
      amount: 400,
      currency: 'USD',
      period: 'monthly',
      startDate: Timestamp.fromDate(new Date(2026, 0, 1)),
      isActive: true,
      createdBy: 'owner-1',
      createdAt: HOUSEHOLD.createdAt,
      updatedAt: HOUSEHOLD.createdAt
    };

    it("are the page's own, the ones its plans section reads", () => {
      showMember(HOUSEHOLD);

      expect(plansSection()?.plans).toBe(fixture.debugElement.injector.get(HouseholdPlansService));
    });

    it('are given the household shown, each household switched to, and none outside the member view', async () => {
      status.set('none');
      render();
      expect(plansHousehold).toHaveBeenCalled();
      expect(plansHousehold.calls.mostRecent().args[0]).toBeNull();

      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      expect(plansHousehold.calls.mostRecent().args[0]).toEqual(HOUSEHOLD);

      choose('household.switcher.setup');
      await settleRoute();
      expect(plansHousehold.calls.mostRecent().args[0])
        .withContext('no listener behind the setup')
        .toBeNull();

      choose('Flat 4B');
      await settleRoute();
      arrive(FLAT);
      render();
      expect(plansHousehold.calls.mostRecent().args[0]).toEqual(FLAT);

      household.set(null);
      status.set('none');
      render();
      expect(plansHousehold.calls.mostRecent().args[0]).toBeNull();
    });

    it("hand the page's ledger the dates their active budgets count", () => {
      showMember(HOUSEHOLD);
      const budgets = planListeners.get('households/h1/budgets');
      expect(budgets).withContext('the budgets are listened to').toBeDefined();

      budgets!.next({ docs: [budget], fromCache: false, hasPendingWrites: false });

      const now = plansNow.calls.mostRecent().args[0] as Date;
      const window = planWindow([budget], now);
      expect(window).not.toBeNull();
      expect(ledger.setPlanWindow.calls.mostRecent().args[0]).toEqual(window);
    });

    describe('across midnight', () => {
      beforeEach(() => {
        // The page the outer setup made armed a real timer; this one is made
        // under the fake clock.
        fixture.destroy();
        plansNow.calls.reset();
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(2026, 8, 27, 23, 59, 30));
        fixture = TestBed.createComponent(HouseholdComponent);
        render();
      });

      afterEach(() => jasmine.clock().uninstall());

      it('are told the day the page opened on, and each new day while it stays open', () => {
        expect(plansNow).toHaveBeenCalledTimes(1);
        expect(plansNow.calls.mostRecent().args[0]).toEqual(new Date(2026, 8, 27, 23, 59, 30));

        jasmine.clock().tick(29_000);
        expect(plansNow).withContext('not before midnight').toHaveBeenCalledTimes(1);

        jasmine.clock().tick(1_000);
        expect(plansNow).toHaveBeenCalledTimes(2);
        expect((plansNow.calls.mostRecent().args[0] as Date).getDate()).toBe(28);

        jasmine.clock().tick(24 * 60 * 60 * 1000);
        expect(plansNow).toHaveBeenCalledTimes(3);
        expect((plansNow.calls.mostRecent().args[0] as Date).getDate()).toBe(29);
      });

      it('are told the day the device wakes on when the page is shown again, however long its sleep held the timer back', () => {
        // Asleep across midnight: the timer did not run.
        jasmine.clock().mockDate(new Date(2026, 8, 28, 7, 0, 0));
        document.dispatchEvent(new Event('visibilitychange'));

        expect(plansNow).toHaveBeenCalledTimes(2);
        expect(plansNow.calls.mostRecent().args[0]).toEqual(new Date(2026, 8, 28, 7, 0, 0));

        // The wait is measured again from the time it woke at.
        jasmine.clock().tick(60_000);
        expect(plansNow).withContext("the night's timer does not run as well").toHaveBeenCalledTimes(2);
        jasmine.clock().tick(17 * 60 * 60 * 1000);
        expect(plansNow).toHaveBeenCalledTimes(3);
        expect((plansNow.calls.mostRecent().args[0] as Date).getDate()).toBe(29);
      });

      it('are told nothing when the page is shown again on the same day', () => {
        document.dispatchEvent(new Event('visibilitychange'));
        expect(plansNow).toHaveBeenCalledTimes(1);

        jasmine.clock().tick(30_000);
        expect(plansNow).withContext('midnight still comes').toHaveBeenCalledTimes(2);
      });

      it('are not told another day once the page has gone', () => {
        fixture.destroy();

        jasmine.clock().tick(2 * 24 * 60 * 60 * 1000);
        document.dispatchEvent(new Event('visibilitychange'));

        expect(plansNow).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("the account's shared rows", () => {
    /** Lets the sweep's loader and the sweep it starts run out. */
    async function settleSweep(): Promise<void> {
      for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve));
    }

    it('are checked once when the member view opens, and not again for the same household', async () => {
      showMember(HOUSEHOLD);
      await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledOnceWith('page');

      members.set([member('owner-1', 'Alex')]);
      household.set({ ...HOUSEHOLD, name: 'The Lins at home' });
      render();
      await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledTimes(1);
    });

    it('are checked once in a visit, however many households it shows: the sweep covers every membership', async () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await settleSweep();
      expect(sharing.reconcileAll).toHaveBeenCalledTimes(1);

      choose('Flat 4B');
      await settleRoute();
      arrive(FLAT);
      render();
      await settleSweep();

      choose('The Lins');
      await settleRoute();
      arrive(HOUSEHOLD);
      render();
      await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledOnceWith('page');
    });

    it('are checked when a visit that opened on the setup first shows a household', async () => {
      status.set('none');
      render();
      await settleSweep();
      expect(sharing.reconcileAll).not.toHaveBeenCalled();

      showMember(HOUSEHOLD);
      await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledOnceWith('page');
    });

    it('are not checked outside the member view', async () => {
      status.set('none');
      render();
      await settleSweep();

      status.set('unavailable');
      render();
      await settleSweep();

      expect(loader).not.toHaveBeenCalled();
      expect(sharing.reconcileAll).not.toHaveBeenCalled();
    });

    it('are checked again on the next visit', async () => {
      showMember(HOUSEHOLD);
      await settleSweep();
      fixture.destroy();

      fixture = TestBed.createComponent(HouseholdComponent);
      render();
      await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledTimes(2);
      expect(sharing.reconcileAll.calls.allArgs()).toEqual([['page'], ['page']]);
    });

    it('stay unchecked until the next visit, with a warning and nothing thrown, when the sharing code does not load', async () => {
      const warn = spyOn(console, 'warn');
      loader.and.rejectWith(new Error('chunk failed'));
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      await settleSweep();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.calls.mostRecent().args[0])).toMatch(/^\[Household\]/);

      loader.and.callFake(async () => sharing as unknown as LedgerShareService);
      choose('Flat 4B');
      await settleRoute();
      arrive(FLAT);
      render();
      await settleSweep();

      expect(sharing.reconcileAll).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stay unchecked, with a warning and nothing thrown, when the sweep fails', async () => {
      const warn = spyOn(console, 'warn');
      sharing.reconcileAll.and.rejectWith(new Error('boom'));
      showMember(HOUSEHOLD);
      await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledOnceWith('page');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.calls.mostRecent().args[0])).toMatch(/^\[Household\]/);
    });

    it('are reached through the dynamic import of the sharing code', async () => {
      loader.and.callThrough();
      showMember(HOUSEHOLD);

      const start = Date.now();
      while (sharing.reconcileAll.calls.count() === 0 && Date.now() - start < 5000) await settleSweep();

      expect(sharing.reconcileAll).toHaveBeenCalledOnceWith('page');
    });
  });

  describe('losing access', () => {
    function loseAccess(): void {
      household.set(null);
      status.set('none');
      lostHouseholds.set(new Set([HOUSEHOLD.id]));
      render();
    }

    beforeEach(() => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();
      // The visit's own tidy aside (an index entry left from before): these
      // count what a loss asks for.
      service.tidyEndedMemberships.calls.reset();
    });

    it('shows the notice', () => {
      expect(text()).not.toContain('household.lostAccess');

      loseAccess();

      expect(text()).toContain('household.lostAccess');
      expect(element().querySelector('app-household-setup')).not.toBeNull();
    });

    it('tidies the ended membership once', () => {
      loseAccess();
      render();
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it('tidies again after a later loss', () => {
      loseAccess();

      lostHouseholds.set(new Set());
      household.set(HOUSEHOLD);
      status.set('member');
      render();
      loseAccess();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(2);
    });

    it('tidies again when a second household is lost while the first loss still shows', () => {
      loseAccess();
      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);

      household.set(HOUSEHOLD);
      status.set('member');
      render();
      household.set(null);
      status.set('none');
      lostHouseholds.set(new Set([HOUSEHOLD.id, 'h2']));
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(2);
    });

    it('tidies a household lost again after its first loss was lifted', () => {
      lostHouseholds.set(new Set([HOUSEHOLD.id, 'h2']));
      status.set('none');
      render();
      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);

      lostHouseholds.set(new Set(['h2']));
      render();
      lostHouseholds.set(new Set([HOUSEHOLD.id, 'h2']));
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(2);
    });

    it('waits for the connection before tidying', () => {
      online.set(false);
      loseAccess();

      expect(service.tidyEndedMemberships).not.toHaveBeenCalled();

      online.set(true);
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it('does not report the membership the page leaves itself', () => {
      household.set(null);
      status.set('none');
      render();

      expect(text()).not.toContain('household.lostAccess');
      expect(service.tidyEndedMemberships).not.toHaveBeenCalled();
    });

    describe('with another household to go to', () => {
      beforeEach(() => showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]));

      it('moves to it, still saying why, and tidies the one it lost', () => {
        loseAccess();

        expect(service.select).toHaveBeenCalledOnceWith('h2');
        expect(text()).toContain('household.lostAccess');
        expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
        expect(element().querySelector('app-household-setup')).withContext('not the setup').toBeNull();
      });

      it('reports no switch for the move the page makes itself', async () => {
        await router.navigateByUrl('/household/h1');
        await settleRoute();

        loseAccess();
        await settleRoute();

        expect(router.url).toBe('/household/h2');
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it("moves focus to its first heading when focus went with the view that was lost", async () => {
        element().querySelector<HTMLButtonElement>('.stub-leave')?.focus();
        loseAccess();
        await settleFocus();

        arrive(FLAT);
        await settleFocus();

        expect(document.activeElement).toBe(overviewTitle());
      });

      it("leaves the lost household's address for the next one's, in place", async () => {
        await router.navigateByUrl('/household/h1');
        await settleRoute();

        loseAccess();
        await settleRoute();

        expect(router.url).toBe('/household/h2');
      });

      it("moves focus to its first heading from the lost household's address too", async () => {
        await router.navigateByUrl('/household/h1');
        await settleRoute();
        element().querySelector<HTMLButtonElement>('.stub-leave')?.focus();

        loseAccess();
        await settleRoute();
        await settleFocus();
        arrive(FLAT);
        await settleRoute();
        await settleFocus();

        expect(router.url).toBe('/household/h2');
        expect(document.activeElement).toBe(overviewTitle());
      });

      it('keeps a setup the viewer opened, moving on only under it', async () => {
        choose('household.switcher.setup');
        await settleFocus();

        loseAccess();
        arrive(FLAT);
        await settleRoute();

        expect(service.select).toHaveBeenCalledOnceWith('h2');
        expect(element().querySelector('app-household-setup')).withContext('the setup stays').not.toBeNull();
        expect(switcherValue()).toBe('household.switcher.setup');
        expect(text()).toContain('household.lostAccess');
      });

      it("keeps it at the lost household's address too, and the focus in it, while the address moves on", async () => {
        await router.navigateByUrl('/household/h1');
        await settleRoute();
        choose('household.switcher.setup');
        await settleFocus();
        const create = element().querySelector<HTMLButtonElement>('.stub-create') as HTMLButtonElement;
        create.focus();

        loseAccess();
        arrive(FLAT);
        await settleRoute();
        await settleFocus();

        expect(router.url).toBe('/household/h2');
        expect(element().querySelector('app-household-setup')).withContext('the setup stays').not.toBeNull();
        expect(switcherValue()).toBe('household.switcher.setup');
        expect(document.activeElement).withContext('the same control, never taken off the page').toBe(create);
      });

      it('still closes the setup for an address the viewer goes to', async () => {
        await router.navigateByUrl('/household/h1');
        await settleRoute();
        choose('household.switcher.setup');
        await settleFocus();

        await router.navigateByUrl('/household/h2');
        await settleRoute();

        expect(element().querySelector('app-household-setup')).toBeNull();
        expect(selected()).toBe('h2');
      });

      it('lists only the households still to go to', () => {
        loseAccess();
        arrive(FLAT);
        render();
        openSwitcher();

        expect(options().map(option => option.textContent?.trim())).toEqual([
          jasmine.stringContaining('Flat 4B'),
          'household.switcher.setup'
        ]);
      });
    });
  });

  /**
   * An index entry whose membership ended while no page was listening, or
   * while the page showed another household, is heard by no listener: a
   * removal or a dissolve says nothing to a household the page does not
   * follow, and a cold start reads the ended one as no membership with no
   * loss seen. Nothing else would ever tidy it, so a visit tidies once.
   */
  describe('an index entry left from before', () => {
    const TRIP = membership({ ...FLAT, id: 'h3', name: 'Trip' }, { ended: true });

    it('is tidied quietly the first time the page finds no membership', () => {
      status.set('none');
      render();
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
      expect(text()).not.toContain('household.lostAccess');
    });

    it('is not looked for while the household is still loading', () => {
      expect(service.tidyEndedMemberships).not.toHaveBeenCalled();
    });

    it('is tidied once per visit while another household is shown', () => {
      showMember(FLAT, [membership(HOUSEHOLD), membership(FLAT), TRIP]);

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
      expect(text()).not.toContain('household.lostAccess');

      for (const next of ['loading', 'unavailable', 'member', 'none', 'member'] as const) {
        status.set(next);
        render();
      }

      expect(service.tidyEndedMemberships).withContext('once in the visit').toHaveBeenCalledTimes(1);
    });

    it('is tidied once for the visit when the household shown could not be loaded', () => {
      memberships.set([membership(HOUSEHOLD)]);
      selected.set(HOUSEHOLD.id);
      status.set('unavailable');
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it("waits for the connection before an offline member view spends the visit's tidy", () => {
      online.set(false);
      showMember(FLAT, [membership(HOUSEHOLD), membership(FLAT)]);
      render();

      expect(service.tidyEndedMemberships).not.toHaveBeenCalled();

      online.set(true);
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it('is tidied once more for a household listed after the visit tidied, which reads as no membership, never seen live', () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD)]);
      expect(service.tidyEndedMemberships).withContext("the visit's").toHaveBeenCalledTimes(1);

      memberships.set([membership(HOUSEHOLD), membership(FLAT)]);
      service.select(FLAT.id);
      render();
      status.set('none');
      render();
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(2);
      expect(text()).not.toContain('household.lostAccess');

      status.set('loading');
      render();
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).withContext('once for that household').toHaveBeenCalledTimes(2);
    });

    it("is tidied once more for a household the visit's tidy found live, which reads as no membership when moved to", () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      expect(service.tidyEndedMemberships).withContext("the visit's").toHaveBeenCalledTimes(1);

      // Removed since, with its member document never held on this device:
      // the server's null reads as no membership, and no loss is seen.
      service.select(FLAT.id);
      render();
      status.set('none');
      render();
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(2);
      expect(text()).not.toContain('household.lostAccess');

      status.set('loading');
      render();
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).withContext('once for that household').toHaveBeenCalledTimes(2);
    });

    it('is tidied once more when the household the visit could not load then reads as no membership', () => {
      memberships.set([membership(HOUSEHOLD)]);
      selected.set(HOUSEHOLD.id);
      status.set('unavailable');
      render();
      expect(service.tidyEndedMemberships).withContext("the visit's").toHaveBeenCalledTimes(1);

      status.set('none');
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(2);

      status.set('loading');
      render();
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).withContext('once for that household').toHaveBeenCalledTimes(2);
    });

    it('is not tidied again for the household the visit found no membership in', () => {
      memberships.set([membership(HOUSEHOLD)]);
      selected.set(HOUSEHOLD.id);
      status.set('none');
      render();
      expect(service.tidyEndedMemberships).withContext("the visit's").toHaveBeenCalledTimes(1);

      status.set('loading');
      render();
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).withContext('that tidy judged it').toHaveBeenCalledTimes(1);
    });

    it("is not looked for again when the household shown is left: the visit's tidy stands", () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      household.set(null);
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it("is not looked for again when the last household shown is left: the visit's tidy stands", () => {
      showMember(HOUSEHOLD);
      memberships.set([]);
      selected.set(null);
      household.set(null);
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it('is not looked for again when the household moved to from a loss reads as no membership', () => {
      showMember(HOUSEHOLD, [membership(HOUSEHOLD), membership(FLAT)]);
      household.set(null);
      status.set('none');
      lostHouseholds.set(new Set([HOUSEHOLD.id]));
      render();
      expect(service.tidyEndedMemberships).withContext("the visit's, then the loss").toHaveBeenCalledTimes(2);
      expect(selected()).toBe(FLAT.id);

      status.set('none');
      render();

      expect(service.tidyEndedMemberships).withContext('those tidies judged every entry').toHaveBeenCalledTimes(2);
    });

    it('is looked for once the connection returns, not while offline', () => {
      online.set(false);
      status.set('none');
      render();

      expect(service.tidyEndedMemberships).not.toHaveBeenCalled();

      online.set(true);
      render();

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
    });

    it('lets a failed tidy pass without a word', async () => {
      const unhandled: PromiseRejectionEvent[] = [];
      const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event);
      window.addEventListener('unhandledrejection', onUnhandled);
      const consoleError = spyOn(console, 'error');
      service.tidyEndedMemberships.and.rejectWith(new Error('permission-denied'));

      try {
        status.set('none');
        render();
        await new Promise(resolve => setTimeout(resolve));
      } finally {
        window.removeEventListener('unhandledrejection', onUnhandled);
      }

      expect(service.tidyEndedMemberships).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
      expect(text()).not.toContain('errors.generic');
    });
  });

  describe('the offline note', () => {
    const note = (): Element | null => element().querySelector('.household-offline');

    it('is absent online', () => {
      status.set('none');
      render();

      expect(note()).toBeNull();
    });

    it('shows in the setup', () => {
      online.set(false);
      status.set('none');
      render();

      expect(note()?.textContent).toContain('household.offline');
    });

    it('shows in the member view', () => {
      online.set(false);
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      expect(note()?.textContent).toContain('household.offline');
    });
  });

  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters; the page's own 16px padding
      // leaves 311px for the header.
      host.style.display = 'block';
      host.style.width = '343px';
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels. Material's fields take their face from the
      // --mat-sys tokens rather than from the host.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    it('keeps the switcher, and a household name of the longest length, inside the page', async () => {
      // One unbroken word: nothing to wrap on but the edge of the box.
      const longName = 'N'.repeat(HOUSEHOLD_NAME_MAX_LENGTH);
      const long: Household = { ...HOUSEHOLD, name: longName };
      showMember(long, [membership(long), membership(FLAT)]);
      await settleRoute();

      const page = element().querySelector('.page-container') as HTMLElement;
      const style = getComputedStyle(page);
      const left = page.getBoundingClientRect().left + parseFloat(style.paddingInlineStart);
      const right = page.getBoundingClientRect().right - parseFloat(style.paddingInlineEnd);
      expect(right - left).withContext('the header is 311px wide').toBeCloseTo(311, 0);

      const field = element().querySelector('mat-form-field.household-switcher') as HTMLElement;
      const valueBox = switcher()?.querySelector('.mat-mdc-select-value') as HTMLElement;
      const value = switcher()?.querySelector('.mat-mdc-select-value-text') as HTMLElement;
      expect(value.textContent).withContext('the whole name is shown').toContain(longName);
      const parts = [field, switcher() as HTMLElement, valueBox, value, element().querySelector('h1') as HTMLElement];
      for (const part of parts) {
        const label = `${part.tagName.toLowerCase()}.${part.className}`;
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(left - 0.5);
        expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(right + 0.5);
      }
      // Material's own trigger CSS keeps its ellipsis declaration, which draws
      // nothing once the name wraps: what shows a name is cut is text wider
      // than its box. The select itself is not measured: its arrow glyph
      // overhangs the arrow's own 10px box by design.
      for (const part of [valueBox, value]) {
        expect(getComputedStyle(part).whiteSpace).withContext(`${part.className} wraps`).not.toBe('nowrap');
        expect(part.scrollWidth).withContext(`nothing overflows ${part.className}`).toBeLessThanOrEqual(part.clientWidth + 1);
      }
      expect(value.getBoundingClientRect().height)
        .withContext('the name wraps onto more than one line')
        .toBeGreaterThan(parseFloat(getComputedStyle(value).lineHeight) * 1.5);
      expect(switcher()?.getBoundingClientRect().height)
        .withContext('a 40px target at least')
        .toBeGreaterThanOrEqual(40);
      // Material lays a floated label out at up to 133% of its field and draws
      // it at 75%; what must stay inside is the label as drawn.
      const floating = field.querySelector<HTMLElement>('.mdc-floating-label') as HTMLElement;
      expect(floating.classList).toContain('mdc-floating-label--float-above');
      expect(floating.getBoundingClientRect().right).toBeLessThanOrEqual(field.getBoundingClientRect().right + 0.5);
    });

    it('keeps every choice in the open list inside the phone, the long name whole', () => {
      const longName = 'N'.repeat(HOUSEHOLD_NAME_MAX_LENGTH);
      const long: Household = { ...HOUSEHOLD, name: longName };
      showMember(long, [membership(long), membership(FLAT)]);
      openSwitcher();
      // The phone's own edges, 16px out from the page on either side.
      const screenLeft = host.getBoundingClientRect().left - 16;
      const screenRight = screenLeft + 375;

      expect(options()[0].textContent).toContain(longName);
      for (const option of options()) {
        const rect = option.getBoundingClientRect();
        expect(rect.left).withContext(option.textContent ?? '').toBeGreaterThanOrEqual(screenLeft - 0.5);
        expect(rect.right).withContext(option.textContent ?? '').toBeLessThanOrEqual(screenRight + 0.5);
        expect(rect.height).withContext('a 40px target at least').toBeGreaterThanOrEqual(40);
        expect(option.scrollWidth).withContext('nothing overflows the choice').toBeLessThanOrEqual(option.clientWidth + 1);
      }
    });
  });
});

/**
 * The keys are asserted above; the English copy under them is asserted here,
 * in the catalog every other locale is kept at parity with. A household sees
 * only the rows its members share, and keeps budgets and goals of its own.
 */
describe('the copy the household pages show', () => {
  const copy = en.household;

  it('offers to share chosen transactions, never whole finances', () => {
    for (const [key, text] of Object.entries({
      subtitle: copy.subtitle,
      memberSubtitle: copy.memberSubtitle,
      cardDescription: copy.cardDescription
    })) {
      expect(text).withContext(key).toMatch(/shar/i);
      expect(text).withContext(key).not.toMatch(/finances/i);
    }
  });

  it('titles the overview list as the shared transactions', () => {
    expect(copy.overview.transactionsTitle).toBe('Shared transactions');
  });

  it("says the plans are the household's own", () => {
    expect(copy.plans.empty).toBe('This household has no budgets or goals yet.');
  });
});
