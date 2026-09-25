import { EnvironmentInjector, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FirebaseApp } from '@angular/fire/app';
import {
  FunctionsSdk,
  HOUSEHOLD_FUNCTIONS_REGION,
  HOUSEHOLD_INVITE_CALLABLE,
  HouseholdInviteRequest,
  createHouseholdInviteCallable,
  householdInviteCallableFactory
} from './household-invite-callable';
// The hosts the `emulators` build configuration swaps in; imported directly
// because the unit build compiles the committed, null EMULATOR_HOSTS.
import { EMULATOR_HOSTS as EMULATOR_BUILD_HOSTS } from '../../../environments/emulators.on';

describe('household invite callable seam', () => {
  const fakeApp = { name: 'fake-app' } as unknown as FirebaseApp;
  const fakeFunctions = { region: 'fake' };
  const request: HouseholdInviteRequest = { householdId: 'h1', email: 'sam@example.test', locale: 'ja' };

  let appFactory: jasmine.Spy;
  let callableFn: jasmine.Spy;
  let sdk: jasmine.SpyObj<FunctionsSdk>;
  let loadSdk: jasmine.Spy;
  let resolvedInContext: boolean[];

  beforeEach(() => {
    appFactory = jasmine.createSpy('FirebaseApp').and.returnValue(fakeApp);
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseApp, useFactory: appFactory }]
    });

    resolvedInContext = [];
    callableFn = jasmine.createSpy('inviteToHousehold')
      .and.resolveTo({ data: { inviteId: 'h1_sam', mail: 'sent' } });
    sdk = jasmine.createSpyObj<FunctionsSdk>('FunctionsSdk', [
      'getFunctions',
      'httpsCallable',
      'connectFunctionsEmulator'
    ]);
    // The @angular/fire wrappers warn when called outside an injection
    // context; the fake proves it is inside one by injecting.
    sdk.getFunctions.and.callFake((() => {
      resolvedInContext.push(inject(FirebaseApp) === fakeApp);
      return fakeFunctions;
    }) as never);
    sdk.httpsCallable.and.returnValue(callableFn as never);
    loadSdk = jasmine.createSpy('loadSdk').and.resolveTo(sdk);
  });

  const injector = () => TestBed.inject(EnvironmentInjector);

  it('names the asia-east1 region, the one the callable is deployed to', () => {
    expect(HOUSEHOLD_FUNCTIONS_REGION).toBe('asia-east1');
  });

  it('touches neither the Firebase app nor the Functions SDK before an invite is sent', () => {
    createHouseholdInviteCallable(injector(), { loadSdk });
    TestBed.inject(HOUSEHOLD_INVITE_CALLABLE);

    expect(loadSdk).not.toHaveBeenCalled();
    expect(appFactory).not.toHaveBeenCalled();
  });

  it('calls inviteToHousehold in asia-east1 and answers with the callable data, no emulator', async () => {
    const invite = createHouseholdInviteCallable(injector(), { loadSdk });

    const response = await invite(request);

    expect(loadSdk).toHaveBeenCalledTimes(1);
    expect(sdk.getFunctions).toHaveBeenCalledOnceWith(fakeApp, 'asia-east1');
    expect(resolvedInContext).toEqual([true]);
    expect(sdk.connectFunctionsEmulator).not.toHaveBeenCalled();
    expect(sdk.httpsCallable).toHaveBeenCalledOnceWith(fakeFunctions as never, 'inviteToHousehold');
    expect(callableFn).toHaveBeenCalledOnceWith(request);
    expect(response).toEqual({ inviteId: 'h1_sam', mail: 'sent' });
  });

  it('keeps the region and connects the Functions emulator when hosts are given', async () => {
    const invite = createHouseholdInviteCallable(injector(), {
      loadSdk,
      emulator: { host: '127.0.0.1', port: 5001 }
    });

    await invite(request);

    expect(sdk.getFunctions).toHaveBeenCalledOnceWith(fakeApp, 'asia-east1');
    expect(sdk.connectFunctionsEmulator).toHaveBeenCalledOnceWith(fakeFunctions as never, '127.0.0.1', 5001);
    expect(sdk.httpsCallable).toHaveBeenCalledOnceWith(fakeFunctions as never, 'inviteToHousehold');
  });

  it('builds the callable once and reuses it for later invites', async () => {
    const invite = createHouseholdInviteCallable(injector(), {
      loadSdk,
      emulator: { host: '127.0.0.1', port: 5001 }
    });

    await invite(request);
    await invite({ ...request, email: 'kai@example.test' });

    expect(loadSdk).toHaveBeenCalledTimes(1);
    expect(sdk.connectFunctionsEmulator).toHaveBeenCalledTimes(1);
    expect(callableFn).toHaveBeenCalledTimes(2);
  });

  it('loads the SDK again after a failed load rather than keeping the failure', async () => {
    let loads = 0;
    loadSdk.and.callFake(() => ++loads === 1 ? Promise.reject(new Error('chunk failed')) : Promise.resolve(sdk));
    const invite = createHouseholdInviteCallable(injector(), { loadSdk });

    await expectAsync(invite(request)).toBeRejectedWithError('chunk failed');
    await expectAsync(invite(request)).toBeResolvedTo({ inviteId: 'h1_sam', mail: 'sent' });
    expect(loadSdk).toHaveBeenCalledTimes(2);
  });

  it('passes a refusal from the callable through untouched', async () => {
    const refusal = Object.assign(new Error('household invite refused: quota'), {
      code: 'functions/resource-exhausted',
      details: { reason: 'quota' }
    });
    callableFn.and.rejectWith(refusal);
    const invite = createHouseholdInviteCallable(injector(), { loadSdk });

    await expectAsync(invite(request)).toBeRejectedWith(refusal);
  });

  // The token's own factory: what HouseholdService gets unless a spec or a
  // smoke suite provides the token itself.
  describe('the default factory', () => {
    const build = (hosts?: typeof EMULATOR_BUILD_HOSTS) =>
      TestBed.runInInjectionContext(() => householdInviteCallableFactory(hosts, loadSdk));

    it('connects the Functions emulator on 127.0.0.1:5001 and keeps asia-east1 when the build names hosts', async () => {
      await build(EMULATOR_BUILD_HOSTS)(request);

      // The emulator routes by region as well, so the pin still decides the
      // URL: /<project>/asia-east1/inviteToHousehold.
      expect(sdk.getFunctions).toHaveBeenCalledOnceWith(fakeApp, 'asia-east1');
      expect(sdk.connectFunctionsEmulator).toHaveBeenCalledOnceWith(fakeFunctions as never, '127.0.0.1', 5001);
      expect(callableFn).toHaveBeenCalledOnceWith(request);
    });

    it('calls the deployed function in asia-east1 when the build names no hosts', async () => {
      await build(null)(request);

      expect(sdk.getFunctions).toHaveBeenCalledOnceWith(fakeApp, 'asia-east1');
      expect(sdk.connectFunctionsEmulator).not.toHaveBeenCalled();
    });

    it('defaults to the committed hosts, which name no emulator', async () => {
      await build()(request);

      expect(sdk.getFunctions).toHaveBeenCalledOnceWith(fakeApp, 'asia-east1');
      expect(sdk.connectFunctionsEmulator).not.toHaveBeenCalled();
    });

    it('touches nothing before an invite is sent', () => {
      build(EMULATOR_BUILD_HOSTS);

      expect(loadSdk).not.toHaveBeenCalled();
      expect(appFactory).not.toHaveBeenCalled();
    });
  });
});
