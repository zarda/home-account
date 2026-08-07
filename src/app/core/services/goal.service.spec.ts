import { TestBed } from '@angular/core/testing';
import { ApplicationRef, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { firstValueFrom, of } from 'rxjs';

import { GoalService, GOAL_CONTRIBUTION_BELOW_ZERO } from './goal.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Goal } from '../../models';

describe('GoalService', () => {
  let service: GoalService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let userId: ReturnType<typeof signal<string | null>>;

  const PATH = 'users/user123/goals';

  const mockGoals = [
    {
      id: 'g1',
      userId: 'user123',
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    } as Goal
  ];

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'addDocument',
      'setDocument',
      'updateDocument',
      'deleteDocument',
      'getCollection',
      'getDocRef',
      'runTransaction',
      'dateToTimestamp',
      'getTimestamp'
    ]);
    userId = signal<string | null>('user123');
    mockAuthService = jasmine.createSpyObj('AuthService', [], { userId });

    mockFirestoreService.subscribeToCollection.and.returnValue(of(mockGoals));
    mockFirestoreService.addDocument.and.resolveTo('new-goal-id');
    mockFirestoreService.setDocument.and.resolveTo(undefined);
    mockFirestoreService.updateDocument.and.resolveTo(undefined);
    mockFirestoreService.deleteDocument.and.resolveTo(undefined);
    mockFirestoreService.getTimestamp.and.returnValue(Timestamp.now());
    mockFirestoreService.dateToTimestamp.and.callFake((date: Date) => Timestamp.fromDate(date));
    (mockFirestoreService.getDocRef as jasmine.Spy).and.callFake((path: string) => ({ path }));

    TestBed.configureTestingModule({
      providers: [
        GoalService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService }
      ]
    });

    service = TestBed.inject(GoalService);
  });

  it('getGoals publishes the collection into the signal', async () => {
    const goals = await firstValueFrom(service.getGoals());

    expect(goals).toEqual(mockGoals);
    expect(service.goals()).toEqual(mockGoals);
    expect(service.activeGoals().length).toBe(1);
  });

  describe('createGoal', () => {
    it('omits absent optional fields entirely', async () => {
      await service.createGoal({
        kind: 'saving',
        name: 'Emergency fund',
        targetAmount: 3000,
        currency: 'USD'
      });

      expect(mockFirestoreService.addDocument).toHaveBeenCalled();
      const [path, payload] = mockFirestoreService.addDocument.calls.mostRecent().args as [
        string,
        Record<string, unknown>
      ];
      expect(path).toBe(PATH);
      expect(payload['contributedAmount']).toBe(0);
      expect(payload['isActive']).toBeTrue();
      expect('targetDate' in payload).toBeFalse();
      expect('items' in payload).toBeFalse();
      expect('note' in payload).toBeFalse();
    });

    it('restores at a chosen id with the contributed amount intact', async () => {
      await service.createGoal(
        { kind: 'project', name: 'Japan trip', targetAmount: 2000, currency: 'USD' },
        { id: 'g9', contributedAmount: 500 }
      );

      expect(mockFirestoreService.setDocument).toHaveBeenCalled();
      const [path, payload] = mockFirestoreService.setDocument.calls.mostRecent().args as [
        string,
        Record<string, unknown>
      ];
      expect(path).toBe(`${PATH}/g9`);
      expect(payload['contributedAmount']).toBe(500);
    });
  });

  describe('contribute', () => {
    function stubTransaction(existing: Partial<Goal>): jasmine.Spy {
      const updateSpy = jasmine.createSpy('tx.update');
      mockFirestoreService.runTransaction.and.callFake(async updateFn => {
        const tx = {
          get: async () => ({
            exists: () => true,
            data: () => existing,
            id: 'g1'
          }),
          set: jasmine.createSpy('tx.set'),
          update: updateSpy,
          delete: jasmine.createSpy('tx.delete')
        };
        return updateFn(tx as never);
      });
      return updateSpy;
    }

    it('adds to the stored amount inside a transaction and rounds money', async () => {
      const updateSpy = stubTransaction({ contributedAmount: 10.1 });

      await service.contribute('g1', 5.15);

      expect(updateSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: `${PATH}/g1` }),
        jasmine.objectContaining({ contributedAmount: 15.25 })
      );
    });

    it('rejects a withdrawal past zero and writes nothing', async () => {
      const updateSpy = stubTransaction({ contributedAmount: 10 });

      await expectAsync(service.contribute('g1', -20)).toBeRejectedWithError(
        GOAL_CONTRIBUTION_BELOW_ZERO
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('toggleItem', () => {
    it('flips exactly the addressed item', async () => {
      const updateSpy = jasmine.createSpy('tx.update');
      mockFirestoreService.runTransaction.and.callFake(async updateFn => {
        const tx = {
          get: async () => ({
            exists: () => true,
            data: () => ({
              items: [
                { name: 'Flights', amount: 800, done: false },
                { name: 'Hotel', amount: 1200, done: false }
              ]
            }),
            id: 'g1'
          }),
          set: jasmine.createSpy('tx.set'),
          update: updateSpy,
          delete: jasmine.createSpy('tx.delete')
        };
        return updateFn(tx as never);
      });

      await service.toggleItem('g1', 1, true);

      expect(updateSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: `${PATH}/g1` }),
        jasmine.objectContaining({
          items: [
            { name: 'Flights', amount: 800, done: false },
            { name: 'Hotel', amount: 1200, done: true }
          ]
        })
      );
    });
  });

  describe('deleteAll', () => {
    it('enumerates the collection rather than the signal and resets it', async () => {
      mockFirestoreService.getCollection.and.resolveTo([{ id: 'g1' }, { id: 'g2' }]);
      service.goals.set(mockGoals);

      const count = await service.deleteAll();

      expect(count).toBe(2);
      expect(mockFirestoreService.deleteDocument.calls.allArgs()).toEqual([
        [`${PATH}/g1`],
        [`${PATH}/g2`]
      ]);
      expect(service.goals()).toEqual([]);
    });
  });

  describe('sign-out reset', () => {
    it('clears the signal on the signed-out edge', () => {
      TestBed.inject(ApplicationRef).tick();
      service.goals.set(mockGoals);

      userId.set(null);
      TestBed.inject(ApplicationRef).tick();

      expect(service.goals()).toEqual([]);
    });
  });
});
