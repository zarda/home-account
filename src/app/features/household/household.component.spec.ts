import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';

import { HouseholdComponent } from './household.component';
import { HouseholdSetupComponent } from './household-setup/household-setup.component';
import { HouseholdService, HouseholdStatus } from '../../core/services/household.service';
import { PwaService } from '../../core/services/pwa.service';
import { TranslationService } from '../../core/services/translation.service';
import { createTranslationStub } from '../../core/services/testing';
import { Household } from '../../models';

/** The setup state has its own spec; here only its presence is the question. */
@Component({
  selector: 'app-household-setup',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubSetupComponent {}

const HOUSEHOLD: Household = {
  id: 'h1',
  name: 'The Lins',
  ownerId: 'owner-1',
  createdAt: Timestamp.fromMillis(1_700_000_000_000)
};

// Rendered throughout (ADR 0144): which state the page shows is the thing
// under test, and only the template can say.
describe('HouseholdComponent', () => {
  let fixture: ComponentFixture<HouseholdComponent>;
  let status: ReturnType<typeof signal<HouseholdStatus>>;
  let household: ReturnType<typeof signal<Household | null>>;
  let lostAccess: ReturnType<typeof signal<boolean>>;
  let online: ReturnType<typeof signal<boolean>>;
  let service: {
    status: typeof status;
    household: typeof household;
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

  beforeEach(async () => {
    status = signal<HouseholdStatus>('idle');
    household = signal<Household | null>(null);
    lostAccess = signal(false);
    online = signal(true);
    service = {
      status,
      household,
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
        { provide: TranslationService, useValue: createTranslationStub() }
      ]
    })
      .overrideComponent(HouseholdComponent, {
        remove: { imports: [HouseholdSetupComponent] },
        add: { imports: [StubSetupComponent] }
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
