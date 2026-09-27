import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { firstValueFrom, of, throwError } from 'rxjs';
import { RowSharingService } from './row-sharing.service';
import { ShareTarget } from '../utils/share-change.utils';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { LedgerShareRefusal, LedgerShareService } from './ledger-share.service';
import { NotificationService } from './notification.service';
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

  beforeEach(() => {
    firestore = { subscribeToCollection: jasmine.createSpy('subscribeToCollection').and.returnValue(of([HOME, OFFICE, ENDED])) };
    ledger = jasmine.createSpyObj('LedgerShareService', ['share', 'unshare']);
    ledger.share.and.resolveTo(undefined);
    ledger.unshare.and.resolveTo(undefined);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    currentUser = signal<User | null>(createUser({ id: 'u1' }));

    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useValue: firestore },
        { provide: AuthService, useValue: { currentUser } },
        { provide: LedgerShareService, useValue: ledger },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: createTranslationStub() },
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
});
