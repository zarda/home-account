import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NativeAnalyticsTransport, WebAnalyticsTransport } from './analytics-transport';

/**
 * isConfigured() stands in for a real GA4 measurement id, and checkSupported()
 * hands back a promise the spec resolves on its own schedule — the seams
 * analytics-transport.ts exposes so this file never has to touch real
 * Firebase config or wait on a real IndexedDB round trip. Same pattern as
 * AnalyticsService's createTransport() seam in its own spec.
 */
class TestWebAnalyticsTransport extends WebAnalyticsTransport {
  checkSupportedCalls = 0;
  configured = true;

  constructor(
    injector: EnvironmentInjector,
    private readonly deferredSupported: Promise<boolean>
  ) {
    super(injector);
  }

  protected override isConfigured(): boolean {
    return this.configured;
  }

  protected override checkSupported(): Promise<boolean> {
    this.checkSupportedCalls++;
    return this.deferredSupported;
  }
}

describe('WebAnalyticsTransport', () => {
  // A child of the TestBed injector so destroying it for one spec cannot
  // reach the root injector the rest of the suite depends on. No Analytics
  // token is provided: injector.get(Analytics, null) must fall through to
  // the null default, since these specs have no Firebase app to back a real
  // one and must never hand the SDK a fake.
  function testInjector(): EnvironmentInjector {
    return createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
  }

  // The regression this task fixes: before the disposal guards existed, the
  // resumed resolve() ran straight into runInInjectionContext / injector.get
  // on a destroyed injector and rejected with NG0205 — a warning every
  // caller here can only console.warn, not act on.
  it('a logEvent parked on isSupported resolves quietly when the injector is destroyed', async () => {
    let resolveSupported!: (value: boolean) => void;
    const supported = new Promise<boolean>(resolve => {
      resolveSupported = resolve;
    });
    const injector = testInjector();
    const transport = new TestWebAnalyticsTransport(injector, supported);

    // Both calls run synchronously up to the parked await before anything
    // else happens, landing in the same in-flight state a real caller would
    // be in between an enable and isSupported() settling.
    const enabling = expectAsync(transport.setEnabled(true)).toBeResolved();
    const logging = expectAsync(transport.logEvent('e', {})).toBeResolved();

    injector.destroy();
    resolveSupported(true);

    await enabling;
    await logging;
  });

  it('a call arriving after destroy is a no-op', async () => {
    let resolveSupported!: (value: boolean) => void;
    const supported = new Promise<boolean>(resolve => {
      resolveSupported = resolve;
    });
    // Resolved up front: a hang here would mean disposal stopped being
    // checked before ever reaching checkSupported(), not that it was never
    // reached at all.
    resolveSupported(true);
    const injector = testInjector();
    const transport = new TestWebAnalyticsTransport(injector, supported);

    injector.destroy();

    const enabling = expectAsync(transport.setEnabled(true)).toBeResolved();
    const logging = expectAsync(transport.logEvent('e', {})).toBeResolved();
    await enabling;
    await logging;

    expect(transport.checkSupportedCalls).toBe(0);
  });

  it('switches off without ever resolving the token', async () => {
    // Resolving the Analytics instance purely to disable it would create the
    // very gtag load the toggle exists to prevent, so a disable before any
    // enable must not reach checkSupported() at all.
    const transport = new TestWebAnalyticsTransport(testInjector(), Promise.resolve(true));

    await expectAsync(transport.setEnabled(false)).toBeResolved();

    expect(transport.checkSupportedCalls).toBe(0);
  });

  it('short-circuits before the risky await when no measurement id is configured', async () => {
    // CI's stub measurement id lands here. The memo still has to close, or
    // every later call would re-enter the same dead path.
    const transport = new TestWebAnalyticsTransport(testInjector(), Promise.resolve(true));
    transport.configured = false;

    await transport.setEnabled(true);
    await expectAsync(transport.logEvent('e', {})).toBeResolved();

    expect(transport.checkSupportedCalls).toBe(0);
  });

  it('abandons an enable that was switched back off while isSupported was parked', async () => {
    // The await inside resolve() is exactly where a toggle-off lands. The
    // re-check after it is what stops a stale enable arming analytics.
    let resolveSupported!: (value: boolean) => void;
    const supported = new Promise<boolean>(resolve => { resolveSupported = resolve; });
    const transport = new TestWebAnalyticsTransport(testInjector(), supported);

    const enabling = transport.setEnabled(true);
    await transport.setEnabled(false);
    resolveSupported(true);

    await expectAsync(enabling).toBeResolved();
  });

  it('logs a screen view through the same funnel as any other event', async () => {
    const transport = new TestWebAnalyticsTransport(testInjector(), Promise.resolve(true));
    await transport.setEnabled(true);

    await expectAsync(
      transport.logScreenView({ screenName: 'dashboard', screenClass: 'DashboardComponent' })
    ).toBeResolved();
  });

  it('stands down immediately when handed an already-destroyed injector', async () => {
    // injector.get throws once the injector is gone, so onDestroy would never
    // fire and the disposal flag would stay false forever.
    const injector = testInjector();
    injector.destroy();

    const transport = new TestWebAnalyticsTransport(injector, Promise.resolve(true));
    await expectAsync(transport.setEnabled(true)).toBeResolved();
    await expectAsync(transport.logEvent('e', {})).toBeResolved();

    expect(transport.checkSupportedCalls).toBe(0);
  });

  it('resolves to the null instance and keeps logging as a no-op when no Analytics token is provided', async () => {
    let resolveSupported!: (value: boolean) => void;
    const supported = new Promise<boolean>(resolve => {
      resolveSupported = resolve;
    });
    resolveSupported(true);
    const injector = testInjector();
    const transport = new TestWebAnalyticsTransport(injector, supported);

    await transport.setEnabled(true);

    const first = expectAsync(transport.logEvent('e', {})).toBeResolved();
    const second = expectAsync(transport.logEvent('e', {})).toBeResolved();
    await first;
    await second;

    // The resolved memo holds: only the very first resolve() call — here,
    // setEnabled's — ever reaches checkSupported().
    expect(transport.checkSupportedCalls).toBe(1);
  });
});

describe('NativeAnalyticsTransport', () => {
  /**
   * Mimics registerPlugin()'s real Proxy: a known method name answers with
   * the spy, and every other property name — including 'then' — answers
   * with a function that rejects UNIMPLEMENTED, exactly like a plugin method
   * Capacitor never registered. Returning undefined for 'then' here would
   * hide the defect this suite exists to catch.
   */
  function fakeNativePlugin(spy: jasmine.Spy): unknown {
    return new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === 'setEnabled' || prop === 'logEvent' || prop === 'setCurrentScreen'
            ? spy
            : () =>
                Promise.reject(
                  Object.assign(
                    new Error(`"FirebaseAnalytics.${String(prop)}()" is not implemented on ios`),
                    { code: 'UNIMPLEMENTED' }
                  )
                ),
      }
    );
  }

  function timeout(ms: number): Promise<'hung'> {
    return new Promise(resolve => setTimeout(() => resolve('hung'), ms));
  }

  let nativeCall: jasmine.Spy;
  let loadModule: jasmine.Spy;
  let transport: NativeAnalyticsTransport;

  beforeEach(() => {
    nativeCall = jasmine.createSpy('nativeCall').and.resolveTo(undefined);
    loadModule = jasmine
      .createSpy('loadModule')
      .and.resolveTo({ FirebaseAnalytics: fakeNativePlugin(nativeCall) });
    transport = new NativeAnalyticsTransport(loadModule);
  });

  it('resolves setEnabled instead of hanging on the plugin proxy adopting as a thenable', async () => {
    const race = await Promise.race([
      transport.setEnabled(true).then(() => 'resolved' as const),
      timeout(200),
    ]);

    expect(race).toBe('resolved');
    expect(nativeCall).toHaveBeenCalledWith({ enabled: true });
  });

  it('forwards logEvent once enabled', async () => {
    await transport.setEnabled(true);
    nativeCall.calls.reset();

    await transport.logEvent('purchase_added', { amount: 5 });

    expect(nativeCall).toHaveBeenCalledWith({ name: 'purchase_added', params: { amount: 5 } });
  });

  it('forwards logScreenView', async () => {
    await transport.setEnabled(true);
    nativeCall.calls.reset();

    await transport.logScreenView({ screenName: 'dashboard', screenClass: 'DashboardComponent' });

    expect(nativeCall).toHaveBeenCalledWith({
      screenName: 'dashboard',
      screenClassOverride: 'DashboardComponent',
    });
  });

  it('does not re-push a value the plugin already carries', async () => {
    await transport.setEnabled(true);
    nativeCall.calls.reset();

    await transport.setEnabled(true);

    // Re-pushing would restart the measurement session for no reason.
    expect(nativeCall).not.toHaveBeenCalled();
  });

  it('pushes a change of mind through to the plugin', async () => {
    await transport.setEnabled(true);
    nativeCall.calls.reset();

    await transport.setEnabled(false);

    expect(nativeCall).toHaveBeenCalledWith({ enabled: false });
  });

  it('drops an event and a screen view while disabled, without loading the plugin', async () => {
    await transport.logEvent('purchase_added', { amount: 5 });
    await transport.logScreenView({ screenName: 'dashboard', screenClass: 'DashboardComponent' });

    expect(nativeCall).not.toHaveBeenCalled();
    expect(loadModule).not.toHaveBeenCalled();
  });

  it('imports the module once across calls', async () => {
    await transport.setEnabled(true);
    await transport.logEvent('e', {});
    await transport.logScreenView({ screenName: 's', screenClass: 'c' });

    expect(loadModule).toHaveBeenCalledTimes(1);
  });
});
