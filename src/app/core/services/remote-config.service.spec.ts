import { TestBed } from '@angular/core/testing';
import { RemoteConfig } from '@angular/fire/remote-config';

import {
  RemoteConfigService,
  RC_FREE_TIER_RECEIPT_IMAGE_LIMIT,
  RC_PREMIUM_RECEIPT_IMAGE_LIMIT,
} from './remote-config.service';
import { FREE_TIER_RECEIPT_IMAGE_LIMIT } from '../../models';

/** Shape of the protected SDK-call seams the spec substitutes. */
interface RemoteConfigSeams {
  fetchAndActivateConfig(remoteConfig: RemoteConfig): Promise<boolean>;
  getNumberValue(remoteConfig: RemoteConfig, key: string): number;
}

describe('RemoteConfigService', () => {
  let remoteValues: Record<string, number>;

  const seams = () => RemoteConfigService.prototype as unknown as RemoteConfigSeams;
  const fakeRemoteConfig = () => ({ settings: {}, defaultConfig: {} }) as unknown as RemoteConfig;

  function createService(remoteConfig: RemoteConfig | null): RemoteConfigService {
    TestBed.configureTestingModule({
      providers: [
        RemoteConfigService,
        { provide: RemoteConfig, useValue: remoteConfig },
      ],
    });
    return TestBed.inject(RemoteConfigService);
  }

  beforeEach(() => {
    remoteValues = {};
    spyOn(seams(), 'fetchAndActivateConfig').and.resolveTo(true);
    spyOn(seams(), 'getNumberValue').and.callFake(
      (_remoteConfig: RemoteConfig, key: string) => remoteValues[key] ?? NaN
    );
  });

  it('keeps the in-app defaults when Remote Config is not provided', async () => {
    const service = createService(null);
    await service.ready;

    expect(service.freeTierReceiptImageLimit()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    expect(service.premiumReceiptImageLimit()).toBe(Number.POSITIVE_INFINITY);
  });

  it('exposes remotely configured limits after activation', async () => {
    remoteValues[RC_FREE_TIER_RECEIPT_IMAGE_LIMIT] = 100;
    remoteValues[RC_PREMIUM_RECEIPT_IMAGE_LIMIT] = 2000;

    const service = createService(fakeRemoteConfig());
    await service.ready;

    expect(service.freeTierReceiptImageLimit()).toBe(100);
    expect(service.premiumReceiptImageLimit()).toBe(2000);
  });

  it('treats a premium limit of 0 as unlimited', async () => {
    remoteValues[RC_PREMIUM_RECEIPT_IMAGE_LIMIT] = 0;

    const service = createService(fakeRemoteConfig());
    await service.ready;

    expect(service.premiumReceiptImageLimit()).toBe(Number.POSITIVE_INFINITY);
  });

  it('falls back to the default when the remote free limit is not a positive number', async () => {
    remoteValues[RC_FREE_TIER_RECEIPT_IMAGE_LIMIT] = 0;

    const service = createService(fakeRemoteConfig());
    await service.ready;

    expect(service.freeTierReceiptImageLimit()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
  });

  it('keeps the defaults and resolves ready when the fetch fails', async () => {
    (seams().fetchAndActivateConfig as jasmine.Spy).and.rejectWith(new Error('offline'));

    const service = createService(fakeRemoteConfig());
    await expectAsync(service.ready).toBeResolved();

    expect(service.freeTierReceiptImageLimit()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    expect(service.premiumReceiptImageLimit()).toBe(Number.POSITIVE_INFINITY);
  });

  it('configures the fetch policy and in-app defaults before fetching', async () => {
    const remoteConfig = fakeRemoteConfig();
    const service = createService(remoteConfig);
    await service.ready;

    expect(remoteConfig.settings.minimumFetchIntervalMillis).toBe(12 * 60 * 60 * 1000);
    expect(remoteConfig.defaultConfig[RC_FREE_TIER_RECEIPT_IMAGE_LIMIT])
      .toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    expect(remoteConfig.defaultConfig[RC_PREMIUM_RECEIPT_IMAGE_LIMIT]).toBe(0);
    expect(seams().fetchAndActivateConfig).toHaveBeenCalledWith(remoteConfig);
  });
});
