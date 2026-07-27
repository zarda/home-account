import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AnalyticsService } from './analytics.service';
import { AnalyticsParams, AnalyticsTransport } from './analytics-transport';
import { ScreenView } from './analytics-screen-view';
import { AuthService } from './auth.service';
import { User } from '../../models';

class FakeTransport implements AnalyticsTransport {
  enabledCalls: boolean[] = [];
  events: { name: string; params: AnalyticsParams }[] = [];
  screens: ScreenView[] = [];
  /** Set to make setEnabled(true) suspend, so the consent race is reachable. */
  enablePending: Promise<void> | null = null;

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && this.enablePending) {
      await this.enablePending;
    }
    this.enabledCalls.push(enabled);
  }

  async logEvent(name: string, params: AnalyticsParams): Promise<void> {
    this.events.push({ name, params });
  }

  async logScreenView(screen: ScreenView): Promise<void> {
    this.screens.push(screen);
  }
}

/** Exposes the protected seams the way a taxonomy method would use them. */
class TestAnalyticsService extends AnalyticsService {
  constructor(private readonly fake: AnalyticsTransport) {
    super();
  }

  protected override createTransport(): AnalyticsTransport {
    return this.fake;
  }

  track(name: string, params: AnalyticsParams = {}): void {
    this.send(name, params);
  }
}

describe('AnalyticsService', () => {
  let transport: FakeTransport;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let isLoading: ReturnType<typeof signal<boolean>>;
  let routerEvents: { subscribe: jasmine.Spy };

  const userWithConsent = (granted: boolean | undefined): User =>
    ({
      id: 'user-1',
      preferences:
        granted === undefined ? {} : { enableUsageAnalytics: granted },
    }) as unknown as User;

  function build(): TestAnalyticsService {
    return TestBed.runInInjectionContext(() => new TestAnalyticsService(transport));
  }

  beforeEach(() => {
    transport = new FakeTransport();
    currentUser = signal<User | null>(null);
    isLoading = signal<boolean>(false);
    routerEvents = { subscribe: jasmine.createSpy('subscribe') };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: { currentUser, isLoading },
        },
        {
          provide: Router,
          useValue: {
            navigated: true,
            events: { pipe: () => routerEvents },
            routerState: { snapshot: { root: { firstChild: null, pathFromRoot: [] } } },
          },
        },
      ],
    });
  });

  describe('consent gate', () => {
    it('should stay off while no account is signed in', fakeAsync(() => {
      const service = build();
      TestBed.tick();
      tick();

      // Signed out is indistinguishable from opted out, and both must be off.
      expect(service.consentGranted()).toBeFalse();
      expect(transport.enabledCalls).toEqual([false]);
    }));

    it('should stay off when the preference is absent', fakeAsync(() => {
      currentUser.set(userWithConsent(undefined));
      build();
      TestBed.tick();
      tick();

      // Every account created before the setting shipped looks like this.
      expect(transport.enabledCalls).toEqual([false]);
    }));

    it('should enable collection once the account opts in', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      build();
      TestBed.tick();
      tick();

      expect(transport.enabledCalls).toEqual([true]);
    }));

    it('should follow the toggle without a reload', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      build();
      TestBed.tick();
      tick();

      currentUser.set(userWithConsent(false));
      TestBed.tick();
      tick();

      currentUser.set(userWithConsent(true));
      TestBed.tick();
      tick();

      expect(transport.enabledCalls).toEqual([true, false, true]);
    }));

    it('should wait for the auth state to settle before pushing', fakeAsync(() => {
      isLoading.set(true);
      build();
      TestBed.tick();
      tick();

      // Native collection persists across launches, so a speculative push at
      // boot would either restart a consenting user's session or briefly
      // contradict the stored preference.
      expect(transport.enabledCalls).toEqual([]);

      isLoading.set(false);
      currentUser.set(userWithConsent(true));
      TestBed.tick();
      tick();

      expect(transport.enabledCalls).toEqual([true]);
    }));

    it('should not finish enabling when consent is revoked mid-flight', fakeAsync(() => {
      let releaseEnable!: () => void;
      transport.enablePending = new Promise<void>(resolve => {
        releaseEnable = resolve;
      });

      currentUser.set(userWithConsent(true));
      const service = build();
      TestBed.tick();
      tick();

      // The enable is suspended inside the transport, exactly where
      // isSupported() or the plugin import would suspend in production.
      expect(transport.enabledCalls).toEqual([]);

      currentUser.set(userWithConsent(false));
      TestBed.tick();
      tick();

      releaseEnable();
      tick();

      // The enable was already under way when consent was withdrawn, so it
      // runs to completion — but the operations are serialised, so the
      // withdrawal lands after it and collection ends up off. Without that
      // ordering the stale enable resolved last and left analytics running
      // against a preference that said otherwise.
      expect(service.consentGranted()).toBeFalse();
      expect(transport.enabledCalls.at(-1)).toBeFalse();
      // And the stale enable must not have started reporting screens on its
      // way past — that is what the generation check covers.
      expect(transport.screens).toEqual([]);
    }));
  });

  describe('event dispatch', () => {
    it('should drop events while consent is off', fakeAsync(() => {
      const service = build();
      TestBed.tick();
      tick();

      service.track('budget_create');
      tick();

      expect(transport.events).toEqual([]);
    }));

    it('should send events once consent is granted', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      const service = build();
      TestBed.tick();
      tick();

      service.track('transaction_add', { method: 'manual', type: 'expense' });
      tick();

      expect(transport.events).toEqual([
        { name: 'transaction_add', params: { method: 'manual', type: 'expense' } },
      ]);
    }));

    it('should stop sending as soon as consent is withdrawn', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      const service = build();
      TestBed.tick();
      tick();

      currentUser.set(userWithConsent(false));
      TestBed.tick();
      tick();

      service.track('budget_create');
      tick();

      expect(transport.events).toEqual([]);
    }));

    it('should never throw when the transport fails', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      const service = build();
      TestBed.tick();
      tick();

      spyOn(console, 'warn');
      spyOn(transport, 'logEvent').and.rejectWith(new Error('blocked'));

      // Usage statistics are never a precondition for anything the user asked
      // for; a blocked script must not surface.
      expect(() => {
        service.track('budget_create');
        tick();
      }).not.toThrow();
    }));
  });

  describe('screen tracking', () => {
    it('should not subscribe to the router while consent is off', fakeAsync(() => {
      build();
      TestBed.tick();
      tick();

      expect(routerEvents.subscribe).not.toHaveBeenCalled();
    }));

    it('should subscribe once consent is granted', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      build();
      TestBed.tick();
      tick();

      expect(routerEvents.subscribe).toHaveBeenCalledTimes(1);
    }));

    it('should not report a screen before anything is activated', fakeAsync(() => {
      currentUser.set(userWithConsent(true));
      build();
      TestBed.tick();
      tick();

      // The Router fake reports navigated with no activated child, which is
      // the state at the moment the auth guard releases the first navigation.
      expect(transport.screens).toEqual([]);
    }));
  });
});
