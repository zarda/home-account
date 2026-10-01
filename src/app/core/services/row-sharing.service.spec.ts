import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Subject, Subscription, firstValueFrom, of, throwError } from 'rxjs';
import { RowSharingService } from './row-sharing.service';
import { ShareTarget } from '../utils/share-change.utils';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { LedgerShareRefusal, LedgerShareService } from './ledger-share.service';
import { NotificationService } from './notification.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { User } from '../../models';
import { createTranslationStub, createUser } from './testing';

const at = (millis: number) => Timestamp.fromMillis(millis);

/** Index documents as a listener hands them over. */
const HOME = { id: 'h1', name: 'Home', role: 'owner', since: at(3_000), joinedAt: at(3_000) };
const OFFICE = { id: 'h2', name: 'Office', role: 'member', since: at(1_000), joinedAt: at(2_000) };
const ENDED = { id: 'h3', name: 'Old flat', role: 'member', since: at(500), joinedAt: at(500), endedAt: at(4_000) };

const TARGETS: ShareTarget[] = [
  { householdId: 'h1', name: 'Home' },
  { householdId: 'h2', name: 'Office' },
];

describe('RowSharingService', () => {
  let service: RowSharingService;
  let firestore: { subscribeToCollection: jasmine.Spy };
  let ledger: jasmine.SpyObj<Pick<LedgerShareService, 'share' | 'unshare'>>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let online: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    firestore = { subscribeToCollection: jasmine.createSpy('subscribeToCollection').and.returnValue(of([HOME, OFFICE, ENDED])) };
    ledger = jasmine.createSpyObj('LedgerShareService', ['share', 'unshare']);
    ledger.share.and.resolveTo(undefined);
    ledger.unshare.and.resolveTo(undefined);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    currentUser = signal<User | null>(createUser({ id: 'u1' }));
    online = signal(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useValue: firestore },
        { provide: AuthService, useValue: { currentUser } },
        { provide: LedgerShareService, useValue: ledger },
        { provide: NotificationService, useValue: notifications },
        {
          provide: TranslationService,
          useValue: createTranslationStub({
            // The one entry the names are joined with, so a list of names reads as one.
            t: (key: string, params?: Record<string, string | number>) =>
              key === 'transactions.share.separator' ? ', ' : params ? `${key}:${JSON.stringify(params)}` : key,
          }),
        },
        { provide: PwaService, useValue: { isOnline: online } },
      ],
    });
    service = TestBed.inject(RowSharingService);
  });

  describe('targets', () => {
    it("lists the live memberships from the account's own index, earliest joined first", async () => {
      const targets = await firstValueFrom(service.targets());

      expect(firestore.subscribeToCollection).toHaveBeenCalledOnceWith('users/u1/households');
      expect(targets).toEqual([
        { householdId: 'h2', name: 'Office' },
        { householdId: 'h1', name: 'Home' },
      ]);
    });

    it('lists nothing while nobody is signed in', async () => {
      currentUser.set(null);

      expect(await firstValueFrom(service.targets())).toEqual([]);
      expect(firestore.subscribeToCollection).not.toHaveBeenCalled();
    });

    it('lists nothing when the index cannot be read', async () => {
      spyOn(console, 'warn');
      firestore.subscribeToCollection.and.returnValue(throwError(() => new Error('permission-denied')));

      expect(await firstValueFrom(service.targets())).toEqual([]);
      expect(console.warn).toHaveBeenCalled();
    });

    describe('across a change of account', () => {
      /** One listener per index path, each answering only when told to. */
      let indexes: Map<string, Subject<Record<string, unknown>[]>>;
      let lists: ShareTarget[][];
      let subscription: Subscription;

      const index = (path: string) => {
        const listener = indexes.get(path);
        if (!listener) throw new Error(`no listener was opened on ${path}`);
        return listener;
      };

      beforeEach(() => {
        indexes = new Map();
        firestore.subscribeToCollection.and.callFake((path: string) => {
          const listener = new Subject<Record<string, unknown>[]>();
          indexes.set(path, listener);
          return listener;
        });
        lists = [];
        subscription = service.targets().subscribe(targets => lists.push(targets));
        index('users/u1/households').next([HOME]);
      });

      afterEach(() => subscription.unsubscribe());

      it("reads the next account's households and drops the last one's listener", () => {
        // Another tab's sign-in moves the session with no signed-out state between.
        currentUser.set(createUser({ id: 'u2' }));
        TestBed.tick();

        expect(firestore.subscribeToCollection.calls.allArgs()).toEqual([['users/u1/households'], ['users/u2/households']]);
        expect(index('users/u1/households').observed).withContext("the last account's listener is closed").toBeFalse();
        expect(lists.at(-1)).withContext("the last account's households are not offered while the next one's index is read").toEqual([]);

        index('users/u2/households').next([OFFICE]);

        expect(lists.at(-1)).toEqual([{ householdId: 'h2', name: 'Office' }]);
      });

      it('drops the listener and lists nothing once signed out, and reads the index of whoever signs in next', () => {
        currentUser.set(null);
        TestBed.tick();

        expect(index('users/u1/households').observed).toBeFalse();
        expect(lists.at(-1)).toEqual([]);
        expect(firestore.subscribeToCollection).withContext('no listener while nobody is signed in').toHaveBeenCalledTimes(1);

        currentUser.set(createUser({ id: 'u2' }));
        TestBed.tick();
        index('users/u2/households').next([OFFICE]);

        expect(lists.at(-1)).toEqual([{ householdId: 'h2', name: 'Office' }]);
      });

      it('goes on following the account after an index could not be read', () => {
        spyOn(console, 'warn');
        index('users/u1/households').error(new Error('permission-denied'));
        expect(lists.at(-1)).toEqual([]);

        currentUser.set(createUser({ id: 'u2' }));
        TestBed.tick();
        index('users/u2/households').next([OFFICE]);

        expect(lists.at(-1)).toEqual([{ householdId: 'h2', name: 'Office' }]);
      });

      it('keeps its listener when the profile changes but the account does not', () => {
        currentUser.set(createUser({ id: 'u1', displayName: 'Renamed' }));
        TestBed.tick();

        expect(firestore.subscribeToCollection).toHaveBeenCalledTimes(1);
        expect(index('users/u1/households').observed).toBeTrue();
        expect(lists).toEqual([[{ householdId: 'h1', name: 'Home' }]]);
      });
    });
  });

  describe('apply', () => {
    it('shares into each added household and stops sharing with each removed one', async () => {
      const revision = service.revision();

      const outcome = await service.apply('tx1', { share: ['h1'], unshare: ['h2'] }, TARGETS);

      expect(ledger.share).toHaveBeenCalledOnceWith(['tx1'], 'h1');
      expect(ledger.unshare).toHaveBeenCalledOnceWith(['tx1'], 'h2');
      expect(outcome).toEqual({ landed: { share: ['h1'], unshare: ['h2'] }, failed: false });
      expect(service.revision()).toBe(revision + 1);
      expect(notifications.error).not.toHaveBeenCalled();
    });

    it('asks the sharing code for nothing when nothing changes', async () => {
      const outcome = await service.apply('tx1', { share: [], unshare: [] }, TARGETS);

      expect(ledger.share).not.toHaveBeenCalled();
      expect(ledger.unshare).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: { share: [], unshare: [] }, failed: false });
    });

    it('names the household a share was refused for because the membership is over', async () => {
      ledger.share.and.rejectWith(new LedgerShareRefusal('notMember', 'not a member'));

      const outcome = await service.apply('tx1', { share: ['h1'], unshare: ['h2'] }, TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.share.notMember:{"name":"Home"}');
      // The unshare went through on its own.
      expect(outcome).toEqual({ landed: { share: [], unshare: ['h2'] }, failed: true });
    });

    it('says a row no copy may hold cannot be shared', async () => {
      const warn = spyOn(console, 'warn');
      ledger.share.and.rejectWith(new LedgerShareRefusal('unshareable', 'no row a copy may hold'));

      const outcome = await service.apply('tx1', { share: ['h1'], unshare: [] }, TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.share.unshareable');
      expect(outcome).toEqual({ landed: { share: [], unshare: [] }, failed: true });
      expect(warn).not.toHaveBeenCalled();
    });

    it('reports any other failure without a name', async () => {
      spyOn(console, 'warn');
      ledger.unshare.and.rejectWith(new Error('unavailable'));
      const revision = service.revision();

      const outcome = await service.apply('tx1', { share: [], unshare: ['h2'] }, TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.share.failed');
      expect(outcome).toEqual({ landed: { share: [], unshare: [] }, failed: true });
      expect(service.revision()).withContext('nothing landed, so no list re-reads').toBe(revision);
    });
  });

  describe('applyToRows', () => {
    const IDS = ['tx1', 'tx2', 'tx3'];

    it('shares the rows into each chosen household in turn, with exactly the rows given', async () => {
      const order: string[] = [];
      ledger.share.and.callFake(async (_ids, hid) => {
        order.push(`start ${hid}`);
        await Promise.resolve();
        order.push(`end ${hid}`);
      });
      const revision = service.revision();

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS);

      expect(ledger.share.calls.allArgs().map(([ids, hid]) => [ids, hid])).toEqual([[IDS, 'h1'], [IDS, 'h2']]);
      expect(order).withContext('one household at a time').toEqual(['start h1', 'end h1', 'start h2', 'end h2']);
      expect(ledger.unshare).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: ['h1', 'h2'], failed: false });
      expect(service.revision()).toBe(revision + 1);
      expect(notifications.success).toHaveBeenCalledOnceWith(
        'transactions.select.shared:{"count":3,"names":"Home, Office"}'
      );
      expect(notifications.error).not.toHaveBeenCalled();
    });

    it('stops sharing the rows with each chosen household in turn', async () => {
      const outcome = await service.applyToRows('unshare', IDS, ['h2'], TARGETS);

      expect(ledger.unshare.calls.allArgs().map(([ids, hid]) => [ids, hid])).toEqual([[IDS, 'h2']]);
      expect(ledger.share).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: ['h2'], failed: false });
      expect(notifications.success).toHaveBeenCalledOnceWith(
        'transactions.select.unshared:{"count":3,"names":"Office"}'
      );
    });

    it('reports its progress across the households, each one\'s rows counted within its turn', async () => {
      ledger.share.and.callFake(async (_ids, _hid, progress) => {
        progress?.(1, 4);
        progress?.(4, 4);
      });
      const fractions: number[] = [];

      await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS, fraction => fractions.push(fraction));

      expect(fractions).toEqual([0, 0.125, 0.5, 0.5, 0.625, 1, 1]);
    });

    it('says, offline, that the households see shared rows once the device is back online', async () => {
      online.set(false);

      await service.applyToRows('share', IDS, ['h1'], TARGETS);

      expect(notifications.info).toHaveBeenCalledOnceWith(
        'transactions.select.sharedOffline:{"count":3,"names":"Home"}'
      );
      expect(notifications.success).not.toHaveBeenCalled();
    });

    it('says, offline, that the households keep seeing unshared rows until the device reconnects', async () => {
      online.set(false);

      await service.applyToRows('unshare', ['tx1'], ['h1'], TARGETS);

      expect(notifications.success).toHaveBeenCalledOnceWith(
        'transactions.select.unsharedOffline:{"count":1,"names":"Home"}'
      );
    });

    it('refuses too many rows with its own message, and asks no other household', async () => {
      ledger.share.and.rejectWith(new LedgerShareRefusal('tooMany', 'too many'));
      const revision = service.revision();

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS);

      expect(ledger.share).toHaveBeenCalledTimes(1);
      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.tooMany:{"max":500}');
      expect(notifications.success).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: [], failed: true });
      expect(service.revision()).toBe(revision);
    });

    it('names the household a share was refused for when no household took the rows', async () => {
      ledger.share.and.rejectWith(new LedgerShareRefusal('notMember', 'not a member'));
      const revision = service.revision();

      const outcome = await service.applyToRows('share', IDS, ['h1'], TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.notMember:{"name":"Home"}');
      expect(outcome).toEqual({ landed: [], failed: true });
      expect(service.revision()).toBe(revision);
    });

    it('names both sides when a share was refused for one household and went through for another', async () => {
      ledger.share.and.callFake(async (_ids, hid) => {
        if (hid === 'h1') throw new LedgerShareRefusal('notMember', 'not a member');
      });
      const revision = service.revision();

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS);

      expect(ledger.share).toHaveBeenCalledTimes(2);
      expect(notifications.error).toHaveBeenCalledOnceWith(
        'transactions.select.partialNotMember:{"count":3,"names":"Office","failed":"Home"}'
      );
      expect(notifications.success).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: ['h2'], failed: true });
      expect(service.revision()).withContext('a household took the rows').toBe(revision + 1);
    });

    it('names both sides when one household took the rows and another failed for any other reason', async () => {
      spyOn(console, 'warn');
      ledger.share.and.callFake(async (_ids, hid) => {
        if (hid === 'h2') throw new Error('unavailable');
      });
      const revision = service.revision();

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith(
        'transactions.select.partialShared:{"count":3,"names":"Home","failed":"Office"}'
      );
      expect(notifications.success).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: ['h1'], failed: true });
      expect(service.revision()).withContext('a household took the rows').toBe(revision + 1);
    });

    it('names every household left out when a refusal and another failure both happen beside a success', async () => {
      spyOn(console, 'warn');
      ledger.share.and.callFake(async (_ids, hid) => {
        if (hid === 'h1') throw new LedgerShareRefusal('notMember', 'not a member');
        if (hid === 'h3') throw new Error('unavailable');
      });

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2', 'h3'], [...TARGETS, { householdId: 'h3', name: 'Cabin' }]);

      expect(notifications.error).toHaveBeenCalledOnceWith(
        'transactions.select.partialShared:{"count":3,"names":"Office","failed":"Home, Cabin"}'
      );
      expect(outcome).toEqual({ landed: ['h2'], failed: true });
    });

    it('names both sides when an unshare went through for one household and not another', async () => {
      spyOn(console, 'warn');
      ledger.unshare.and.callFake(async (_ids, hid) => {
        if (hid === 'h1') throw new Error('unavailable');
      });

      const outcome = await service.applyToRows('unshare', IDS, ['h1', 'h2'], TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith(
        'transactions.select.partialUnshared:{"count":3,"names":"Office","failed":"Home"}'
      );
      expect(outcome).toEqual({ landed: ['h2'], failed: true });
    });

    it('reports any other failure without a name', async () => {
      spyOn(console, 'warn');
      ledger.unshare.and.rejectWith(new Error('unavailable'));

      const outcome = await service.applyToRows('unshare', IDS, ['h1'], TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.failed');
      expect(outcome).toEqual({ landed: [], failed: true });
      expect(console.warn).toHaveBeenCalled();
    });

    it('says how many rows a copy may not hold, in place of the rows shared', async () => {
      ledger.share.and.callFake(async (_ids, hid) => ({ skipped: hid === 'h1' ? ['tx2'] : ['tx2', 'tx3'] }));

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS);

      // A row counted once, whichever households passed it over.
      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.unshareable:{"count":2}');
      expect(notifications.success).not.toHaveBeenCalled();
      expect(outcome).toEqual({ landed: ['h1', 'h2'], failed: false });
    });

    it('says one row a copy may not hold, beside the others shared', async () => {
      ledger.share.and.resolveTo({ skipped: ['tx2'] });

      await service.applyToRows('share', IDS, ['h1'], TARGETS);

      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.unshareable:{"count":1}');
    });

    it('says every row a copy may not hold when none could be shared, and asks no other household', async () => {
      const warn = spyOn(console, 'warn');
      ledger.share.and.rejectWith(new LedgerShareRefusal('unshareable', 'no row a copy may hold'));
      const revision = service.revision();

      const outcome = await service.applyToRows('share', IDS, ['h1', 'h2'], TARGETS);

      expect(ledger.share).toHaveBeenCalledTimes(1);
      expect(notifications.error).toHaveBeenCalledOnceWith('transactions.select.unshareable:{"count":3}');
      expect(outcome).toEqual({ landed: [], failed: false });
      expect(service.revision()).toBe(revision);
      expect(warn).not.toHaveBeenCalled();
    });

    it('asks the sharing code for nothing when no row or no household is given', async () => {
      expect(await service.applyToRows('share', [], ['h1'], TARGETS)).toEqual({ landed: [], failed: false });
      expect(await service.applyToRows('unshare', IDS, [], TARGETS)).toEqual({ landed: [], failed: false });

      expect(ledger.share).not.toHaveBeenCalled();
      expect(ledger.unshare).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
    });
  });
});
