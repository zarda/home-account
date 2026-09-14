import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Capacitor, CapacitorException, ExceptionCode } from '@capacitor/core';

import { BiometricAuthService } from './biometric-auth.service';
import { BIOMETRIC_AUTH_PLUGIN, BiometricAuthPlugin } from '../plugins/biometric-auth.plugin';

describe('BIOMETRIC_AUTH_PLUGIN', () => {
  it('yields a plain adapter DI cannot mistake for a lifecycle-bearing provider', () => {
    const plugin = TestBed.inject(BIOMETRIC_AUTH_PLUGIN);

    expect((plugin as unknown as Record<string, unknown>)['ngOnDestroy']).toBeUndefined();
    expect(Object.keys(plugin).sort()).toEqual(['authenticate', 'isAvailable']);
  });
});

describe('BiometricAuthService', () => {
  let service: BiometricAuthService;
  let plugin: jasmine.SpyObj<BiometricAuthPlugin>;

  beforeEach(() => {
    plugin = jasmine.createSpyObj<BiometricAuthPlugin>('BiometricAuthPlugin', [
      'isAvailable',
      'authenticate',
    ]);

    TestBed.configureTestingModule({
      providers: [{ provide: BIOMETRIC_AUTH_PLUGIN, useValue: plugin }],
    });

    service = TestBed.inject(BiometricAuthService);
  });

  describe('detectAvailability', () => {
    it('resolves without calling the plugin on web', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);

      await service.detectAvailability();

      expect(service.available()).toBe(false);
      expect(plugin.isAvailable).not.toHaveBeenCalled();
    });

    it('sets both signals from a resolved probe', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      plugin.isAvailable.and.resolveTo({ available: true, biometry: 'faceId', reason: '' });

      await service.detectAvailability();

      expect(service.available()).toBe(true);
      expect(service.biometry()).toBe('faceId');
    });

    it('resets both signals when the probe rejects', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      plugin.isAvailable.and.resolveTo({ available: true, biometry: 'faceId', reason: '' });
      await service.detectAvailability();
      expect(service.available()).toBe(true);

      plugin.isAvailable.and.rejectWith(new Error('bridge error'));
      await service.detectAvailability();

      expect(service.available()).toBe(false);
      expect(service.biometry()).toBe('none');
    });

    // Starts from a prior successful probe so the timeout path is caught if it
    // ever left a stale `true` in place instead of resetting it.
    it('resolves false once the probe outlasts its deadline', fakeAsync(() => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      plugin.isAvailable.and.resolveTo({ available: true, biometry: 'faceId', reason: '' });
      service.detectAvailability();
      tick();
      expect(service.available()).toBe(true);

      plugin.isAvailable.and.returnValue(new Promise(() => undefined));

      let settled = false;
      void service.detectAvailability().then(() => (settled = true));

      tick(1500);

      expect(settled).toBe(true);
      expect(service.available()).toBe(false);
      expect(service.biometry()).toBe('none');
    }));
  });

  describe('authenticate', () => {
    it('maps a successful prompt to success', async () => {
      plugin.authenticate.and.resolveTo({ success: true });

      await expectAsync(service.authenticate('Unlock Home Account')).toBeResolvedTo('success');
    });

    it('maps a rejection carrying lockedOut to lockedOut', async () => {
      plugin.authenticate.and.rejectWith(new Error('lockedOut'));

      await expectAsync(service.authenticate('Unlock Home Account')).toBeResolvedTo('lockedOut');
    });

    it('maps an Unimplemented rejection to unavailable', async () => {
      plugin.authenticate.and.callFake(() =>
        Promise.resolve().then(() =>
          Promise.reject(new CapacitorException('not implemented', ExceptionCode.Unimplemented))
        )
      );

      await expectAsync(service.authenticate('Unlock Home Account')).toBeResolvedTo('unavailable');
    });

    it('maps an unrecognized rejection to failed', async () => {
      plugin.authenticate.and.rejectWith(new Error('something else'));

      await expectAsync(service.authenticate('Unlock Home Account')).toBeResolvedTo('failed');
    });
  });
});
