import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ProviderKeyService, pickProviderSecrets } from './provider-key.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { User, UserPreferences, LegacyProviderApiKeys } from '../../models';
import { createMockUser } from './testing/mock-auth.service';

describe('ProviderKeyService', () => {
  let service: ProviderKeyService;
  let firestore: jasmine.SpyObj<FirestoreService>;
  let auth: jasmine.SpyObj<AuthService>;
  let userId: ReturnType<typeof signal<string | null>>;
  let currentUser: ReturnType<typeof signal<User | null>>;

  const SECRETS_PATH = 'users/user-1/secrets/providers';

  function withPreferences(prefs: Partial<UserPreferences & LegacyProviderApiKeys>): void {
    currentUser.set(
      createMockUser('user-1', { preferences: prefs as UserPreferences })
    );
  }

  beforeEach(() => {
    userId = signal<string | null>('user-1');
    currentUser = signal<User | null>(
      createMockUser('user-1', { preferences: {} as UserPreferences })
    );

    firestore = jasmine.createSpyObj<FirestoreService>('FirestoreService', [
      'getDocument',
      'setDocument',
    ]);
    firestore.getDocument.and.resolveTo(null);
    firestore.setDocument.and.resolveTo(undefined);

    auth = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['clearStoredProviderApiKeys'],
      { userId, currentUser }
    );
    auth.clearStoredProviderApiKeys.and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        ProviderKeyService,
        { provide: FirestoreService, useValue: firestore },
        { provide: AuthService, useValue: auth },
      ],
    });

    service = TestBed.inject(ProviderKeyService);
  });

  describe('pickProviderSecrets', () => {
    it('keeps only the provider fields', () => {
      expect(
        pickProviderSecrets({ gemini: 'g', openai: 'o', id: 'providers', updatedAt: 'x' })
      ).toEqual({ gemini: 'g', openai: 'o' });
    });

    it('drops blank and non-string values', () => {
      expect(pickProviderSecrets({ gemini: '   ', openai: 42, claude: 'c' })).toEqual({
        claude: 'c',
      });
    });

    it('returns an empty object for a missing document', () => {
      expect(pickProviderSecrets(null)).toEqual({});
    });
  });

  describe('resolve', () => {
    it('reads the keys from the secrets document', async () => {
      firestore.getDocument.and.resolveTo({ gemini: 'g-key' });

      await expectAsync(service.resolve()).toBeResolvedTo({ gemini: 'g-key' });
      expect(firestore.getDocument).toHaveBeenCalledWith(SECRETS_PATH);
    });

    it('reads once per session and serves the rest from cache', async () => {
      firestore.getDocument.and.resolveTo({ gemini: 'g-key' });

      await service.resolve();
      await service.resolve();
      await service.getKey('gemini');

      expect(firestore.getDocument).toHaveBeenCalledTimes(1);
    });

    it('caches the empty result so users with no keys do not re-read', async () => {
      await service.resolve();
      await service.resolve();

      expect(firestore.getDocument).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent callers racing a cold cache', async () => {
      firestore.getDocument.and.resolveTo({ gemini: 'g-key' });

      await Promise.all([service.resolve(), service.resolve(), service.resolve()]);

      expect(firestore.getDocument).toHaveBeenCalledTimes(1);
    });

    it('returns nothing when no one is signed in', async () => {
      userId.set(null);

      await expectAsync(service.resolve()).toBeResolvedTo({});
      expect(firestore.getDocument).not.toHaveBeenCalled();
    });

    // Offline with a cold persistent cache: getDoc rejects outright.
    it('degrades to no keys when the read fails', async () => {
      spyOn(console, 'warn');
      firestore.getDocument.and.rejectWith(new Error('unavailable'));

      await expectAsync(service.resolve()).toBeResolvedTo({});
      expect(service.loadFailed()).toBe(true);
    });

    it('retries after a failed read instead of caching the failure', async () => {
      spyOn(console, 'warn');
      firestore.getDocument.and.rejectWith(new Error('unavailable'));
      await service.resolve();

      firestore.getDocument.and.resolveTo({ gemini: 'g-key' });
      await expectAsync(service.resolve()).toBeResolvedTo({ gemini: 'g-key' });
      expect(service.loadFailed()).toBe(false);
    });

    // A shared device: the previous user's load can still be pending when the
    // next signs in, and reusing it would key the providers with their key.
    it('does not hand an in-flight load to a different account', async () => {
      let releaseFirst: (value: Record<string, unknown>) => void = () => undefined;
      firestore.getDocument.and.returnValue(
        new Promise(resolve => {
          releaseFirst = resolve as (value: Record<string, unknown>) => void;
        })
      );

      const firstUserLoad = service.resolve();

      userId.set('user-2');
      currentUser.set(createMockUser('user-2', { preferences: {} as UserPreferences }));
      firestore.getDocument.and.resolveTo({ gemini: 'user-2-key' });

      await expectAsync(service.resolve()).toBeResolvedTo({ gemini: 'user-2-key' });

      releaseFirst({ gemini: 'user-1-key' });
      await firstUserLoad;
    });

    it('does not serve one account keys to the next', async () => {
      firestore.getDocument.and.resolveTo({ gemini: 'g-key' });
      await service.resolve();

      userId.set('user-2');
      expect(service.keys()).toBeNull();
    });
  });

  describe('setKey', () => {
    it('merge-writes a single provider key', async () => {
      await service.setKey('openai', 'o-key');

      expect(firestore.setDocument).toHaveBeenCalledWith(
        SECRETS_PATH,
        { openai: 'o-key' },
        true
      );
    });

    it('trims the stored value', async () => {
      await service.setKey('openai', '  o-key  ');

      const written = firestore.setDocument.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['openai']).toBe('o-key');
    });

    it('writes through to the cache so saving never triggers a read', async () => {
      await service.resolve();
      firestore.getDocument.calls.reset();

      await service.setKey('claude', 'c-key');

      await expectAsync(service.getKey('claude')).toBeResolvedTo('c-key');
      expect(firestore.getDocument).not.toHaveBeenCalled();
    });

    it('removes the key from the cache when cleared', async () => {
      firestore.getDocument.and.resolveTo({ claude: 'c-key' });
      await service.resolve();

      await service.setKey('claude', '');

      await expectAsync(service.getKey('claude')).toBeResolvedTo(undefined);
    });

    it('rejects when no one is signed in', async () => {
      userId.set(null);

      await expectAsync(service.setKey('gemini', 'g')).toBeRejected();
    });

    // Saving one key says nothing about the others. Treating the result as a
    // complete cache would make the unread ones look unset, and a later blur
    // on an empty field would then delete a key that was only ever unread.
    it('does not fabricate a cache when the keys were never read', async () => {
      spyOn(console, 'warn');
      firestore.getDocument.and.rejectWith(new Error('unavailable'));
      await service.resolve();
      expect(service.keys()).toBeNull();

      await service.setKey('gemini', 'g-key');

      expect(service.keys()).toBeNull();

      // The next resolve goes back to Firestore rather than trusting a
      // one-key cache.
      firestore.getDocument.calls.reset();
      firestore.getDocument.and.resolveTo({ gemini: 'g-key', openai: 'o-key' });
      await expectAsync(service.resolve()).toBeResolvedTo({ gemini: 'g-key', openai: 'o-key' });
      expect(firestore.getDocument).toHaveBeenCalled();
    });
  });

  describe('migration from preferences', () => {
    it('moves keys left on the preferences map into the secrets document', async () => {
      withPreferences({ geminiApiKey: 'old-g', claudeApiKey: 'old-c' });

      await expectAsync(service.resolve()).toBeResolvedTo({ gemini: 'old-g', claude: 'old-c' });
      expect(firestore.setDocument).toHaveBeenCalledWith(
        SECRETS_PATH,
        { gemini: 'old-g', claude: 'old-c' },
        true
      );
    });

    // The new location must be durable before the old one is emptied.
    it('writes the secrets document before clearing preferences', async () => {
      withPreferences({ geminiApiKey: 'old-g' });
      const order: string[] = [];
      firestore.setDocument.and.callFake(async () => {
        order.push('write-secrets');
      });
      auth.clearStoredProviderApiKeys.and.callFake(async () => {
        order.push('clear-preferences');
      });

      await service.resolve();

      expect(order).toEqual(['write-secrets', 'clear-preferences']);
    });

    it('keeps the key when clearing preferences fails', async () => {
      withPreferences({ geminiApiKey: 'old-g' });
      auth.clearStoredProviderApiKeys.and.rejectWith(new Error('offline'));
      spyOn(console, 'warn');

      // The failure surfaces as an unavailable load rather than a lost key,
      // and the next attempt re-runs the migration.
      await expectAsync(service.resolve()).toBeResolvedTo({});
      expect(firestore.setDocument).toHaveBeenCalled();
    });

    // A stale copy on another device must not overwrite a rotated key.
    it('lets the stored key win over a stale preferences copy', async () => {
      firestore.getDocument.and.resolveTo({ gemini: 'new-g' });
      withPreferences({ geminiApiKey: 'old-g' });

      await expectAsync(service.resolve()).toBeResolvedTo({ gemini: 'new-g' });
    });

    it('abandons the migration when the account switches during the secrets read', async () => {
      withPreferences({ geminiApiKey: 'a-key' });
      // resolve() captured user-1, but user-2 signs in while the secrets
      // document is still being fetched. The migration must not merge A's
      // keys with B's preferences and write them into B's secrets document.
      firestore.getDocument.and.callFake(async () => {
        userId.set('user-2');
        currentUser.set(
          createMockUser('user-2', {
            preferences: { geminiApiKey: 'b-key' } as unknown as UserPreferences
          })
        );
        return null;
      });

      await service.resolve();

      expect(firestore.setDocument).not.toHaveBeenCalled();
      expect(auth.clearStoredProviderApiKeys).not.toHaveBeenCalled();
    });

    it('abandons the preference clear when the account switches during the write', async () => {
      withPreferences({ geminiApiKey: 'a-key' });
      firestore.setDocument.and.callFake(async () => {
        // Switch lands between the secrets write and the preference clear:
        // clearing now would strip user-2's preferences over user-1's
        // migration.
        userId.set('user-2');
      });

      await service.resolve();

      expect(firestore.setDocument).toHaveBeenCalled();
      expect(auth.clearStoredProviderApiKeys).not.toHaveBeenCalled();
    });

    it('does nothing when preferences hold no keys', async () => {
      withPreferences({ baseCurrency: 'USD' });

      await service.resolve();

      expect(firestore.setDocument).not.toHaveBeenCalled();
      expect(auth.clearStoredProviderApiKeys).not.toHaveBeenCalled();
    });

    it('ignores blank leftovers', async () => {
      withPreferences({ geminiApiKey: '   ' });

      await service.resolve();

      expect(auth.clearStoredProviderApiKeys).not.toHaveBeenCalled();
    });
  });

  describe('clearCache', () => {
    it('forces the next resolve to re-read', async () => {
      firestore.getDocument.and.resolveTo({ gemini: 'g-key' });
      await service.resolve();

      service.clearCache();
      await service.resolve();

      expect(firestore.getDocument).toHaveBeenCalledTimes(2);
    });
  });
});
