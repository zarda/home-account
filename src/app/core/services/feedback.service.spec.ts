import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Capacitor } from '@capacitor/core';

import {
  FeedbackService,
  MAX_DISPLAYED_FEEDBACK_ENTRIES,
  MAX_FEEDBACK_MESSAGE_LENGTH,
} from './feedback.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { TranslationService } from './translation.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import packageJson from '../../../../package.json';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let mockFirestore: MockFirestoreService;
  let userIdSpy: jasmine.Spy;

  beforeEach(() => {
    userIdSpy = jasmine.createSpy('userId').and.returnValue('user-1');

    TestBed.configureTestingModule({
      providers: [
        FeedbackService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useValue: { userId: userIdSpy } },
        { provide: TranslationService, useValue: { currentLocale: () => 'en' } },
      ],
    });

    mockFirestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    service = TestBed.inject(FeedbackService);
  });

  afterEach(() => {
    mockFirestore.clearMocks();
  });

  describe('add', () => {
    it('appends to the signed-in user own list', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('entry-1');

      await service.add('bug', 'the chart is upside down');

      expect(addDocument).toHaveBeenCalledTimes(1);
      expect(addDocument.calls.mostRecent().args[0]).toBe('users/user-1/feedback');
    });

    it('stores the category, message and the context the app already knew', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('entry-1');

      await service.add('idea', 'a widget would be nice');

      const payload = addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(payload['userId']).toBe('user-1');
      expect(payload['category']).toBe('idea');
      expect(payload['message']).toBe('a widget would be nice');
      expect(payload['appVersion']).toBe(packageJson.version);
      expect(payload['platform']).toBe(Capacitor.getPlatform());
      expect(payload['locale']).toBe('en');
    });

    // The account email the operator replies to is looked up server-side at
    // mail time; the stored record must never smuggle it or anything else in.
    it('stores no fields beyond the closed set the rules validate', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('entry-1');

      await service.add('other', 'thanks');

      const payload = addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual([
        'appVersion', 'category', 'locale', 'message', 'platform', 'userId'
      ]);
    });

    it('trims the message', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('entry-1');

      await service.add('bug', '  padded  ');

      const payload = addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(payload['message']).toBe('padded');
    });

    it('caps the message at the rules limit', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument').and.resolveTo('entry-1');

      await service.add('bug', 'y'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 5));

      const payload = addDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect((payload['message'] as string).length).toBe(MAX_FEEDBACK_MESSAGE_LENGTH);
    });

    it('rejects a whitespace-only message without writing', async () => {
      const addDocument = spyOn(mockFirestore, 'addDocument');

      await expectAsync(service.add('bug', '   ')).toBeRejected();
      expect(addDocument).not.toHaveBeenCalled();
    });

    it('rejects when nobody is signed in', async () => {
      userIdSpy.and.returnValue(null);
      const addDocument = spyOn(mockFirestore, 'addDocument');

      await expectAsync(service.add('bug', 'hello')).toBeRejected();
      expect(addDocument).not.toHaveBeenCalled();
    });

    // The write is the whole point of the user's action, so unlike the
    // security log a failure must reach the dialog.
    it('propagates a write failure', async () => {
      spyOn(mockFirestore, 'addDocument').and.rejectWith(new Error('permission-denied'));

      await expectAsync(service.add('bug', 'hello')).toBeRejected();
    });
  });

  describe('watchOwn', () => {
    it('returns an empty list when nobody is signed in', async () => {
      const subscribe = spyOn(mockFirestore, 'subscribeToCollection');

      await expectAsync(firstValueFrom(service.watchOwn(null))).toBeResolvedTo([]);
      expect(subscribe).not.toHaveBeenCalled();
    });

    it('reads the newest entries first', async () => {
      const subscribe = spyOn(mockFirestore, 'subscribeToCollection').and.returnValue(of([]));

      await firstValueFrom(service.watchOwn('user-1'));

      expect(subscribe.calls.mostRecent().args[0]).toBe('users/user-1/feedback');
      expect(subscribe.calls.mostRecent().args[1]).toEqual({
        orderBy: [{ field: 'createdAt', direction: 'desc' }],
        limit: MAX_DISPLAYED_FEEDBACK_ENTRIES,
      });
    });

    it('honours a caller-supplied cap', async () => {
      const subscribe = spyOn(mockFirestore, 'subscribeToCollection').and.returnValue(of([]));

      await firstValueFrom(service.watchOwn('user-1', 5));

      expect(
        (subscribe.calls.mostRecent().args[1] as { limit?: number }).limit
      ).toBe(5);
    });

    it('propagates a read failure so the page can report it', async () => {
      spyOn(mockFirestore, 'subscribeToCollection').and.returnValue(
        throwError(() => new Error('permission-denied'))
      );

      await expectAsync(firstValueFrom(service.watchOwn('user-1'))).toBeRejected();
    });
  });

  describe('deleteAll', () => {
    it('deletes every entry', async () => {
      mockFirestore.setMockCollection('users/user-1/feedback', [{ id: 'f1' }, { id: 'f2' }]);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestore.deleteDocumentSpy.calls.map(c => c.args[0])).toEqual([
        'users/user-1/feedback/f1',
        'users/user-1/feedback/f2'
      ]);
    });

    it('resolves to zero on an empty list', async () => {
      expect(await service.deleteAll()).toBe(0);
      expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(0);
    });

    it('resolves to zero when nobody is signed in', async () => {
      userIdSpy.and.returnValue(null);

      expect(await service.deleteAll()).toBe(0);
      expect(mockFirestore.deleteDocumentSpy.calls.length).toBe(0);
    });
  });
});
