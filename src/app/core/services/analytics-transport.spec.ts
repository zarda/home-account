import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WebAnalyticsTransport } from './analytics-transport';

/**
 * isConfigured() stands in for a real GA4 measurement id, and checkSupported()
 * hands back a promise the spec resolves on its own schedule — the seams
 * analytics-transport.ts exposes so this file never has to touch real
 * Firebase config or wait on a real IndexedDB round trip. Same pattern as
 * AnalyticsService's createTransport() seam in its own spec.
 */
class TestWebAnalyticsTransport extends WebAnalyticsTransport {
  checkSupportedCalls = 0;

  constructor(
    injector: EnvironmentInjector,
    private readonly deferredSupported: Promise<boolean>
  ) {
    super(injector);
  }

  protected override isConfigured(): boolean {
    return true;
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
