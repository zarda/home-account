import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';

import { HouseholdComponent } from './household.component';
import { HouseholdSetupComponent } from './household-setup/household-setup.component';
import { HouseholdOverviewComponent } from './household-overview/household-overview.component';
import { HouseholdPlansComponent } from './household-plans/household-plans.component';
import { HouseholdMembersComponent } from './household-members/household-members.component';
import { HouseholdService, HouseholdStatus } from '../../core/services/household.service';
import { HouseholdLedgerService } from '../../core/services/household-ledger.service';
import { PwaService } from '../../core/services/pwa.service';
import { RecurringService } from '../../core/services/recurring.service';
import { TranslationService } from '../../core/services/translation.service';
import { createTranslationStub } from '../../core/services/testing';
import { Household, HouseholdMember } from '../../models';
import { HouseholdPageFocus } from './household-focus';

/** The setup state has its own spec; here only its presence, and its first heading, are the question. */
@Component({
  selector: 'app-household-setup',
  standalone: true,
  template: '<h2 id="household-invites-title" tabindex="-1">Invites for you</h2><button type="button">Create</button>',
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

/** The budgets and goals have their own spec; here the question is where they sit and which ledger they read. */
@Component({
  selector: 'app-household-plans',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubPlansComponent {
  readonly ledger = inject(HouseholdLedgerService);
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

const member = (uid: string, displayName: string): HouseholdMember => ({
  uid,
  displayName,
  role: uid === 'owner-1' ? 'owner' : 'member',
  since: HOUSEHOLD.createdAt,
  joinedAt: HOUSEHOLD.createdAt
});

// Rendered throughout (ADR 0144): which state the page shows is the thing
// under test, and only the template can say.
describe('HouseholdComponent', () => {
  let fixture: ComponentFixture<HouseholdComponent>;
  let status: ReturnType<typeof signal<HouseholdStatus>>;
  let household: ReturnType<typeof signal<Household | null>>;
  let lostAccess: ReturnType<typeof signal<boolean>>;
  let online: ReturnType<typeof signal<boolean>>;
  let members: ReturnType<typeof signal<HouseholdMember[]>>;
  let ledger: { setMembers: jasmine.Spy };
  let catchUp: jasmine.Spy;
  let service: {
    status: typeof status;
    household: typeof household;
    members: typeof members;
    lostAccess: typeof lostAccess;
    connect: jasmine.Spy;
    disconnect: jasmine.Spy;
    clearStalePointer: jasmine.Spy;
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const heading = (): string => element().querySelector('h1')?.textContent?.trim() ?? '';
  const header = (): Element | null => element().querySelector('app-page-header');

  function render(): void {
    fixture.detectChanges();
  }

  /** Lets afterNextRender run: it fires on the app's own tick, which detectChanges alone does not run. */
  async function settleFocus(): Promise<void> {
    render();
    await fixture.whenStable();
    TestBed.tick();
  }

  const pageFocus = (): HouseholdPageFocus => fixture.debugElement.injector.get(HouseholdPageFocus);

  beforeEach(async () => {
    status = signal<HouseholdStatus>('idle');
    household = signal<Household | null>(null);
    lostAccess = signal(false);
    online = signal(true);
    members = signal<HouseholdMember[]>([]);
    ledger = { setMembers: jasmine.createSpy('setMembers') };
    catchUp = jasmine.createSpy('catchUpRecurringTransactions').and.resolveTo([]);
    service = {
      status,
      household,
      members,
      lostAccess,
      connect: jasmine.createSpy('connect').and.callFake(() => {
        if (status() === 'idle') status.set('loading');
      }),
      disconnect: jasmine.createSpy('disconnect'),
      clearStalePointer: jasmine.createSpy('clearStalePointer').and.resolveTo(false)
    };

    await TestBed.configureTestingModule({
      imports: [HouseholdComponent, NoopAnimationsModule],
      providers: [
        { provide: HouseholdService, useValue: service },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: RecurringService, useValue: { catchUpRecurringTransactions: catchUp } }
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

    it("catches up the viewer's own recurring rules as it opens, as the dashboard does", () => {
      expect(catchUp).toHaveBeenCalledTimes(1);
    });

    it('lets a failed catch-up pass without a word', async () => {
      const consoleError = spyOn(console, 'error');
      catchUp.and.rejectWith(new Error('offline'));
      fixture.destroy();
      fixture = TestBed.createComponent(HouseholdComponent);
      render();
      await fixture.whenStable();

      expect(catchUp).toHaveBeenCalledTimes(2);
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  // Every swap of what the page shows takes the focused element with it.
  describe('where focus goes when an action swaps what the page shows', () => {
    it("moves to the member view's first heading once a create or join lands", async () => {
      status.set('none');
      render();
      pageFocus().afterSwapTo('member');
      await settleFocus();
      expect(document.activeElement).withContext('not before the swap').not.toBe(
        element().querySelector('#household-invites-title')
      );

      household.set(HOUSEHOLD);
      status.set('member');
      await settleFocus();

      expect(document.activeElement).toBe(element().querySelector('#household-overview-title'));
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

      expect(document.activeElement).toBe(element().querySelector('#household-invites-title'));
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
      lostAccess.set(true);
      await settleFocus();

      expect(document.activeElement).toBe(element().querySelector('#household-invites-title'));
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

      expect(document.activeElement).toBe(element().querySelector('#household-overview-title'));
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
      expect(header()?.querySelector('.household-name')).toBeNull();
      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(element().querySelector('.member-view')).toBeNull();
    });

    it('shows the member view with one, the household named in the page header', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      expect(element().querySelector('.member-view')).not.toBeNull();
      expect(heading()).toBe('household.title');
      expect(element().querySelectorAll('h1').length).toBe(1);
      expect(header()?.querySelector('.household-name')?.textContent?.trim()).toBe('The Lins');
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

  describe('the ledger', () => {
    const overview = (): StubOverviewComponent | null => {
      const host = fixture.debugElement.query(debug => debug.name === 'app-household-overview');
      return host ? (host.componentInstance as StubOverviewComponent) : null;
    };
    const plans = (): StubPlansComponent | null => {
      const host = fixture.debugElement.query(debug => debug.name === 'app-household-plans');
      return host ? (host.componentInstance as StubPlansComponent) : null;
    };

    it('is the one the member view\'s overview reads', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      expect(element().querySelector('.member-view app-household-overview')).not.toBeNull();
      expect(overview()?.ledger).toBe(ledger as unknown as HouseholdLedgerService);
    });

    it('is the one the budgets and goals read, shown after the overview', () => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();

      const sections = Array.from(element().querySelectorAll('.member-view > *')).map(node => node.tagName.toLowerCase());
      expect(sections.indexOf('app-household-plans'))
        .withContext('after the overview')
        .toBe(sections.indexOf('app-household-overview') + 1);
      expect(plans()?.ledger).toBe(ledger as unknown as HouseholdLedgerService);
    });

    it('is given nobody outside the member view', () => {
      status.set('none');
      render();

      expect(ledger.setMembers).toHaveBeenCalled();
      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([]);
      expect(overview()).toBeNull();
      expect(plans()).toBeNull();
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

    it('lets them go when the membership ends', () => {
      const owner = member('owner-1', 'Alex');
      household.set(HOUSEHOLD);
      status.set('member');
      members.set([owner]);
      render();

      household.set(null);
      status.set('none');
      members.set([]);
      render();

      expect(ledger.setMembers.calls.mostRecent().args[0]).toEqual([]);
    });
  });

  describe('losing access', () => {
    function loseAccess(): void {
      household.set(null);
      status.set('none');
      lostAccess.set(true);
      render();
    }

    beforeEach(() => {
      household.set(HOUSEHOLD);
      status.set('member');
      render();
    });

    it('shows the notice', () => {
      expect(text()).not.toContain('household.lostAccess');

      loseAccess();

      expect(text()).toContain('household.lostAccess');
      expect(element().querySelector('app-household-setup')).not.toBeNull();
    });

    it('clears the stale pointer once', () => {
      loseAccess();
      render();
      render();

      expect(service.clearStalePointer).toHaveBeenCalledTimes(1);
    });

    it('clears again after a later loss', () => {
      loseAccess();

      lostAccess.set(false);
      household.set(HOUSEHOLD);
      status.set('member');
      render();
      loseAccess();

      expect(service.clearStalePointer).toHaveBeenCalledTimes(2);
    });

    it('waits for the connection before clearing', () => {
      online.set(false);
      loseAccess();

      expect(service.clearStalePointer).not.toHaveBeenCalled();

      online.set(true);
      render();

      expect(service.clearStalePointer).toHaveBeenCalledTimes(1);
    });

    it('does not report the membership the page leaves itself', () => {
      household.set(null);
      status.set('none');
      render();

      expect(text()).not.toContain('household.lostAccess');
      expect(service.clearStalePointer).not.toHaveBeenCalled();
    });
  });

  /**
   * A pointer whose membership ended while no page was listening reads as
   * `none` from a cold cache, with no loss seen, so nothing else would ever
   * clear it.
   */
  describe('a pointer left from before', () => {
    it('is cleared quietly the first time the page finds no membership', () => {
      status.set('none');
      render();
      render();

      expect(service.clearStalePointer).toHaveBeenCalledTimes(1);
      expect(text()).not.toContain('household.lostAccess');
    });

    it('is not looked for while the household is still loading', () => {
      expect(service.clearStalePointer).not.toHaveBeenCalled();
    });

    it('is looked for once the connection returns, not while offline', () => {
      online.set(false);
      status.set('none');
      render();

      expect(service.clearStalePointer).not.toHaveBeenCalled();

      online.set(true);
      render();

      expect(service.clearStalePointer).toHaveBeenCalledTimes(1);
    });

    it('lets a failed clear pass without a word', async () => {
      const unhandled: PromiseRejectionEvent[] = [];
      const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event);
      window.addEventListener('unhandledrejection', onUnhandled);
      const consoleError = spyOn(console, 'error');
      service.clearStalePointer.and.rejectWith(new Error('permission-denied'));

      try {
        status.set('none');
        render();
        await new Promise(resolve => setTimeout(resolve));
      } finally {
        window.removeEventListener('unhandledrejection', onUnhandled);
      }

      expect(service.clearStalePointer).toHaveBeenCalledTimes(1);
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
});
