import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Capacitor } from '@capacitor/core';

import { SecurityLogService, MAX_DISPLAYED_SECURITY_EVENTS } from './security-log.service';
import { FirestoreService } from './firestore.service';
import { MockFirestoreService } from './testing/mock-firestore.service';

describe('SecurityLogService', () => {
  let service: SecurityLogService;
  let mockFirestore: MockFirestoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SecurityLogService,
        { provide: FirestoreService, useClass: MockFirestoreService },
      ],
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    service = TestBed.inject(SecurityLogService);
  });

  afterEach(() => {
    mockFirestore.clearMocks();
  });

  describe('record', () => {
    it('appends to the signing-in user own log', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('event-1');

      await service.record('user-1', 'signIn');

      expect(addDocument).toHaveBeenCalledTimes(1);
      expect(addDocument.calls.mostRecent().args[0]).toBe('users/user-1/securityEvents');
    });

    it('stores the event type, time and platform', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('event-1');

      await service.record('user-1', 'signIn');

      const payload = addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(payload['userId']).toBe('user-1');
      expect(payload['type']).toBe('signIn');
      expect(payload['platform']).toBe(Capacitor.getPlatform());
      expect(payload['occurredAt']).toBeDefined();
    });

    // Nothing beyond the runtime container: no user agent, no device id.
    it('stores no identifying fields beyond the platform', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('event-1');

      await service.record('user-1', 'signIn');

      const payload = addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(['occurredAt', 'platform', 'type', 'userId']);
    });

    // The log is an audit trail, never a precondition for signing in.
    it('never rejects when the write fails', async () => {
      spyOn(console, 'error');
      spyOn(mockFirestore, 'addDocument').and.rejectWith(new Error('permission-denied'));

      await expectAsync(service.record('user-1', 'signIn')).toBeResolved();
    });
  });

  describe('watchRecent', () => {
    it('returns an empty list when nobody is signed in', async () => {
      const subscribe = spyOn(mockFirestore, 'subscribeToCollection');

      await expectAsync(firstValueFrom(service.watchRecent(null))).toBeResolvedTo([]);
      expect(subscribe).not.toHaveBeenCalled();
    });

    it('reads the newest entries first', async () => {
      const subscribe = spyOn(mockFirestore, 'subscribeToCollection').and.returnValue(of([]));

      await firstValueFrom(service.watchRecent('user-1'));

      expect(subscribe.calls.mostRecent().args[0]).toBe('users/user-1/securityEvents');
      expect(subscribe.calls.mostRecent().args[1]).toEqual({
        orderBy: [{ field: 'occurredAt', direction: 'desc' }],
        limit: MAX_DISPLAYED_SECURITY_EVENTS,
      });
    });

    it('honours a caller-supplied cap', async () => {
      const subscribe = spyOn(mockFirestore, 'subscribeToCollection').and.returnValue(of([]));

      await firstValueFrom(service.watchRecent('user-1', 5));

      expect(
        (subscribe.calls.mostRecent().args[1] as { limit?: number }).limit
      ).toBe(5);
    });

    it('propagates a read failure so the UI can report it', async () => {
      spyOn(mockFirestore, 'subscribeToCollection').and.returnValue(
        throwError(() => new Error('permission-denied'))
      );

      await expectAsync(firstValueFrom(service.watchRecent('user-1'))).toBeRejected();
    });
  });
});
