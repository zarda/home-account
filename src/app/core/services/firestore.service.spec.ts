import { TestBed } from '@angular/core/testing';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import {
  FieldValue,
  Firestore,
  Timestamp,
  WriteBatch,
  aggregateFieldEqual,
  count,
  getFirestore,
  serverTimestamp,
  sum
} from '@angular/fire/firestore';
import {
  FirestoreService,
  aggregateSpecOf,
  aggregateTotalsOf,
  assertAggregateAsks
} from './firestore.service';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';

// afterAll's deleteApp runs outside any injector, where the zone wrapper
// would print a warning into the suite's output.
silenceFirebaseWarnings();

interface BatchCall {
  kind: 'set' | 'update' | 'delete' | 'commit';
  batch: unknown;
  path?: string;
  data?: Record<string, unknown>;
  options?: unknown;
}

/**
 * Unit cases for the parts of FirestoreService a spec can see without a
 * server: how commitBatch builds its one batch, how getDocumentFromServer
 * reads, and how an aggregate is asked for and answered. The emulator smoke
 * (firestore.service.smoke.spec.ts) covers what lands.
 *
 * The Firestore instance is real but never connected: building a batch and
 * a reference needs one. It uses the default memory cache and never starts
 * its network half: every batch case replaces the batch's commit, and every
 * getDocumentFromServer case replaces runTransaction. So the stalled
 * teardown app.config.ts warns about, from a real instance running its
 * persistent cache and network, does not arise here; afterAll's deleteApp
 * ends the one client writeBatch made.
 */
describe('FirestoreService', () => {
  let app: FirebaseApp | undefined;
  let service: FirestoreService;

  // Made inside a provider factory, which runs in the injector: the zone
  // wrapper warns about every Firebase call made outside one. The app, and
  // so its one Firestore instance, is kept across cases.
  const unconnectedFirestore = () => getFirestore(app ??= initializeApp(
    { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
    `firestore-unit-${Date.now()}`
  ));

  afterAll(async () => {
    if (app) await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FirestoreService, { provide: Firestore, useFactory: unconnectedFirestore }]
    });
    service = TestBed.inject(FirestoreService);
  });

  /**
   * Replaces the batch's writes and commit with a recorder: every call in
   * the order made, with the batch it was made on. The commit answers with
   * `commit`.
   */
  function recordBatches(commit: Promise<void> = Promise.resolve()): BatchCall[] {
    const calls: BatchCall[] = [];
    spyOn(WriteBatch.prototype, 'set').and.callFake(function (
      this: WriteBatch, ref: { path: string }, data: Record<string, unknown>, options?: unknown
    ) {
      calls.push({ kind: 'set', batch: this, path: ref.path, data, options });
      return this;
    } as never);
    spyOn(WriteBatch.prototype, 'update').and.callFake(function (
      this: WriteBatch, ref: { path: string }, data: Record<string, unknown>
    ) {
      calls.push({ kind: 'update', batch: this, path: ref.path, data });
      return this;
    } as never);
    spyOn(WriteBatch.prototype, 'delete').and.callFake(function (this: WriteBatch, ref: { path: string }) {
      calls.push({ kind: 'delete', batch: this, path: ref.path });
      return this;
    } as never);
    spyOn(WriteBatch.prototype, 'commit').and.callFake(function (this: WriteBatch) {
      calls.push({ kind: 'commit', batch: this });
      return commit;
    } as never);
    return calls;
  }

  const shape = (calls: BatchCall[]) => calls.map(c => (c.path ? `${c.kind} ${c.path}` : c.kind));

  const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied'
  });

  describe('commitBatch', () => {
    it('writes every op to one batch in the order given, then commits it once', async () => {
      const calls = recordBatches();

      await service.commitBatch([
        { op: 'delete', path: 'households/h1/ledger/u_t1' },
        { op: 'update', path: 'users/u/transactions/t1', data: { description: 'b' } },
        { op: 'set', path: 'users/u/transactions/t2', data: { description: 'c' } },
        { op: 'delete', path: 'users/u/transactions/t3' }
      ]);

      expect(shape(calls)).toEqual([
        'delete households/h1/ledger/u_t1',
        'update users/u/transactions/t1',
        'set users/u/transactions/t2',
        'delete users/u/transactions/t3',
        'commit'
      ]);
      expect(new Set(calls.map(c => c.batch)).size).toBe(1);
    });

    it('issues the whole batch before it returns, so a later write cannot overtake it', () => {
      const calls = recordBatches(new Promise<void>(() => undefined));

      void service.commitBatch([
        { op: 'set', path: 'users/u/transactions/t1', data: { description: 'a' } },
        { op: 'delete', path: 'households/h1/ledger/u_t1' }
      ]);

      expect(shape(calls)).toEqual([
        'set users/u/transactions/t1',
        'delete households/h1/ledger/u_t1',
        'commit'
      ]);
    });

    it('stamps a set and an update with the device clock by default, as setDocument and updateDocument do', async () => {
      const calls = recordBatches();
      const before = Timestamp.now().toMillis();

      await service.commitBatch([
        { op: 'set', path: 'users/u/transactions/t1', data: { description: 'a' } },
        { op: 'update', path: 'users/u/transactions/t2', data: { description: 'b' } },
        { op: 'set', path: 'users/u/transactions/t4', data: { description: 'd' }, stamp: 'client' },
        { op: 'delete', path: 'users/u/transactions/t3' }
      ]);

      const after = Timestamp.now().toMillis();
      const written = calls.filter(c => c.kind === 'set' || c.kind === 'update');
      expect(written.length).toBe(3);
      for (const call of written) {
        const stamp = call.data!['updatedAt'] as Timestamp;
        expect(stamp instanceof Timestamp).withContext(call.path!).toBeTrue();
        expect(stamp.toMillis()).toBeGreaterThanOrEqual(before);
        expect(stamp.toMillis()).toBeLessThanOrEqual(after);
      }
      expect(calls[0].data!['description']).toBe('a');
      expect(calls[1].data!['description']).toBe('b');
      expect(calls[2].data!['description']).toBe('d');
      expect(calls[3].data).toBeUndefined();
    });

    it('stamps over an updatedAt the data carried, as setDocument does', async () => {
      const calls = recordBatches();
      const stale = Timestamp.fromMillis(0);

      await service.commitBatch([
        { op: 'update', path: 'users/u/transactions/t1', data: { updatedAt: stale } }
      ]);

      expect(calls[0].data!['updatedAt']).not.toBe(stale);
      expect((calls[0].data!['updatedAt'] as Timestamp).toMillis()).toBeGreaterThan(0);
    });

    it('stamps with the commit\'s own time when an op asks for the server stamp, over any it carried', async () => {
      const calls = recordBatches();

      await service.commitBatch([
        { op: 'set', path: 'households/h1/ledger/u_t1', data: { amount: 12 }, merge: true, stamp: 'server' },
        {
          op: 'update',
          path: 'households/h1/ledger/u_t2',
          data: { goalId: 'g1', updatedAt: Timestamp.fromMillis(0) },
          stamp: 'server'
        }
      ]);

      for (const call of calls.filter(c => c.kind === 'set' || c.kind === 'update')) {
        const stamp = call.data!['updatedAt'];
        expect(stamp instanceof FieldValue).withContext(call.path!).toBeTrue();
        expect((stamp as FieldValue).isEqual(serverTimestamp())).withContext(call.path!).toBeTrue();
      }
      expect(calls[0].data!['amount']).toBe(12);
      expect(calls[0].options).toEqual({ merge: true });
      expect(calls[1].data!['goalId']).toBe('g1');
    });

    it('sends an unstamped op exactly as given, its own server timestamp included', async () => {
      const calls = recordBatches();
      const copy = { amount: 12, updatedAt: serverTimestamp() };
      const index = { endedAt: serverTimestamp() };

      await service.commitBatch([
        { op: 'set', path: 'households/h1/ledger/u_t1', data: copy, merge: true, stamp: false },
        { op: 'update', path: 'users/u/households/h1', data: index, stamp: false }
      ]);

      expect(calls[0].data).toEqual(copy);
      expect(calls[0].data!['updatedAt']).toBe(copy.updatedAt);
      expect(calls[1].data).toEqual(index);
      expect(Object.keys(calls[1].data!)).toEqual(['endedAt']);
    });

    it('merges a set only when the op asks for it', async () => {
      const calls = recordBatches();

      await service.commitBatch([
        { op: 'set', path: 'users/u/transactions/t1', data: { description: 'a' }, merge: true },
        { op: 'set', path: 'users/u/transactions/t2', data: { description: 'b' } }
      ]);

      expect(calls[0].options).toEqual({ merge: true });
      expect(calls[1].options).toEqual({ merge: false });
    });

    it('answers with the commit: pending until the server answers, then its outcome', async () => {
      let accept!: () => void;
      recordBatches(new Promise<void>(resolve => { accept = resolve; }));
      let settled = false;

      const committed = service.commitBatch([{ op: 'delete', path: 'users/u/transactions/t1' }])
        .then(() => { settled = true; });
      await new Promise(resolve => setTimeout(resolve));
      expect(settled).toBeFalse();

      accept();
      await committed;
      expect(settled).toBeTrue();
    });

    it('rejects with the refusal when the server refuses the commit', async () => {
      const refused = refusal();
      recordBatches(Promise.reject(refused));

      await expectAsync(service.commitBatch([
        { op: 'set', path: 'households/h1/ledger/u_t1', data: { amount: 1 }, stamp: false }
      ])).toBeRejectedWith(refused);
    });

    // These use the real batch, so the SDK parses each op's data and path;
    // only commit is watched, and each op is refused before it is reached.
    it('rejects, and never throws, when the SDK refuses an op\'s data before sending', async () => {
      const commit = spyOn(WriteBatch.prototype, 'commit').and.resolveTo();
      let committed!: Promise<void>;

      expect(() => {
        committed = service.commitBatch([
          { op: 'set', path: 'users/u/transactions/t1', data: { description: 'a' } },
          { op: 'set', path: 'households/h1/ledger/u_t1', data: { goalId: undefined }, stamp: false }
        ]);
      }).not.toThrow();

      await expectAsync(committed).toBeRejectedWith(jasmine.objectContaining({ code: 'invalid-argument' }));
      expect(commit).not.toHaveBeenCalled();
    });

    it('rejects, and never throws, when an op names no document', async () => {
      const commit = spyOn(WriteBatch.prototype, 'commit').and.resolveTo();
      let committed!: Promise<void>;

      expect(() => {
        committed = service.commitBatch([
          { op: 'delete', path: 'users/u/transactions/t1' },
          { op: 'delete', path: 'users/u/transactions' }
        ]);
      }).not.toThrow();

      await expectAsync(committed).toBeRejectedWith(jasmine.objectContaining({ code: 'invalid-argument' }));
      expect(commit).not.toHaveBeenCalled();
    });
  });

  describe('commitOnline', () => {
    interface TxCall {
      kind: 'get' | 'set' | 'update' | 'delete';
      tx: unknown;
      path: string;
      data?: Record<string, unknown>;
      options?: unknown;
    }

    /**
     * Replaces runTransaction with a recorder of what the callback does on
     * its transaction, answering with `outcome` once the callback resolves,
     * as the SDK's runner commits only then.
     */
    function recordTransactions(outcome: Promise<void> = Promise.resolve()): { calls: TxCall[]; options: unknown[] } {
      const record = { calls: [] as TxCall[], options: [] as unknown[] };
      spyOn(service, 'runTransaction').and.callFake((async (
        update: (tx: unknown) => Promise<unknown>,
        options?: unknown
      ) => {
        record.options.push(options);
        const tx = {
          get: async (ref: { path: string }) => {
            record.calls.push({ kind: 'get', tx, path: ref.path });
            throw new Error('commitOnline reads nothing');
          },
          set: (ref: { path: string }, data: Record<string, unknown>, options?: unknown) => {
            record.calls.push({ kind: 'set', tx, path: ref.path, data, options });
            return tx;
          },
          update: (ref: { path: string }, data: Record<string, unknown>) => {
            record.calls.push({ kind: 'update', tx, path: ref.path, data });
            return tx;
          },
          delete: (ref: { path: string }) => {
            record.calls.push({ kind: 'delete', tx, path: ref.path });
            return tx;
          }
        };
        const result = await update(tx);
        await outcome;
        return result;
      }) as never);
      return record;
    }

    it('writes every op in one transaction, in the order given, reading nothing and never through a batch', async () => {
      const commit = spyOn(WriteBatch.prototype, 'commit').and.resolveTo();
      const record = recordTransactions();

      await service.commitOnline([
        { op: 'set', path: 'households/h1/budgets/b1', data: { name: 'Food' }, merge: true, stamp: 'server' },
        { op: 'update', path: 'households/h1/goals/g1', data: { name: 'Trip' }, stamp: 'server' },
        { op: 'delete', path: 'households/h1/goals/g1/contributions/c1' }
      ]);

      expect(record.calls.map(c => `${c.kind} ${c.path}`)).toEqual([
        'set households/h1/budgets/b1',
        'update households/h1/goals/g1',
        'delete households/h1/goals/g1/contributions/c1'
      ]);
      expect(new Set(record.calls.map(c => c.tx)).size).toBe(1);
      expect(record.calls[0].options).toEqual({ merge: true });
      // The runner's own attempts: an answer lost to the network is sent again.
      expect(record.options).toEqual([undefined]);
      expect(commit).not.toHaveBeenCalled();
    });

    it('stamps each set and update as commitBatch does: the commit\'s own time when asked, over any the data carried', async () => {
      const record = recordTransactions();
      const before = Timestamp.now().toMillis();

      await service.commitOnline([
        { op: 'set', path: 'households/h1/budgets/b1', data: { name: 'Food', updatedAt: Timestamp.fromMillis(0) }, stamp: 'server' },
        { op: 'update', path: 'households/h1/ledger/u_t1', data: { goalId: 'g1' }, stamp: 'server' },
        { op: 'set', path: 'households/h1/goals/g1/contributions/c1', data: { amount: 5, createdAt: serverTimestamp() }, stamp: false },
        { op: 'update', path: 'users/u/transactions/t1', data: { description: 'b' } }
      ]);

      const [budget, link, contribution, own] = record.calls;
      for (const call of [budget, link]) {
        const stamp = call.data!['updatedAt'];
        expect(stamp instanceof FieldValue).withContext(call.path).toBeTrue();
        expect((stamp as FieldValue).isEqual(serverTimestamp())).withContext(call.path).toBeTrue();
      }
      expect(budget.data!['name']).toBe('Food');
      expect(budget.options).toEqual({ merge: false });
      expect(link.data!['goalId']).toBe('g1');
      expect(Object.keys(contribution.data!).sort()).withContext('unstamped, as given').toEqual(['amount', 'createdAt']);
      expect((own.data!['updatedAt'] as Timestamp).toMillis()).toBeGreaterThanOrEqual(before);
    });

    it('rejects with what the transaction failed with, and has nothing left to send', async () => {
      const unreachable = Object.assign(new Error('Connection failed.'), { code: 'unavailable' });
      const commit = spyOn(WriteBatch.prototype, 'commit').and.resolveTo();
      recordTransactions(Promise.reject(unreachable));

      await expectAsync(service.commitOnline([{ op: 'delete', path: 'households/h1/budgets/b1' }]))
        .toBeRejectedWith(unreachable);
      expect(commit).not.toHaveBeenCalled();
    });
  });

  describe('getDocumentFromServer', () => {
    interface FakeTx {
      reads: string[];
      writes: number;
      committed: boolean;
      options: unknown[];
    }

    /**
     * Replaces runTransaction with one that answers reads from `docs` (an
     * Error rejects the read with it) and commits only when the callback
     * resolves, as the SDK's runner does.
     */
    function fakeTransactions(docs: Record<string, unknown>): FakeTx {
      const record: FakeTx = { reads: [], writes: 0, committed: false, options: [] };
      spyOn(service, 'runTransaction').and.callFake((async (
        update: (tx: unknown) => Promise<unknown>,
        options?: unknown
      ) => {
        record.options.push(options);
        const write = () => { record.writes++; };
        const result = await update({
          get: async (ref: { path: string }) => {
            record.reads.push(ref.path);
            const doc = docs[ref.path];
            if (doc instanceof Error) throw doc;
            return {
              id: ref.path.split('/').pop(),
              exists: () => doc !== undefined,
              data: () => doc
            };
          },
          set: write,
          update: write,
          delete: write
        });
        record.committed = true;
        return result;
      }) as never);
      return record;
    }

    it('reads the document inside a transaction it abandons, never through a plain get', async () => {
      const tx = fakeTransactions({ 'households/h1': { name: 'Home', ownerId: 'u' } });
      const plainGet = spyOn(service, 'getDocument').and.callThrough();

      const household = await service.getDocumentFromServer<{ id: string; name: string }>('households/h1');

      expect(household).toEqual(jasmine.objectContaining({ id: 'h1', name: 'Home', ownerId: 'u' }));
      expect(tx.reads).toEqual(['households/h1']);
      expect(tx.writes).toBe(0);
      expect(tx.committed).toBeFalse();
      expect(plainGet).not.toHaveBeenCalled();
    });

    it('answers null for a document the server does not have', async () => {
      const tx = fakeTransactions({});

      expect(await service.getDocumentFromServer('households/gone')).toBeNull();
      expect(tx.committed).toBeFalse();
    });

    it('rejects with the refusal when the rules refuse the read', async () => {
      const refused = refusal();
      fakeTransactions({ 'households/h1': refused });

      await expectAsync(service.getDocumentFromServer('households/h1')).toBeRejectedWith(refused);
    });

    it('makes one attempt, so an unreachable server rejects without the runner\'s retries', async () => {
      const unreachable = Object.assign(new Error('Connection failed.'), { code: 'unavailable' });
      const tx = fakeTransactions({ 'households/h1': unreachable });

      await expectAsync(service.getDocumentFromServer('households/h1')).toBeRejectedWith(unreachable);
      expect(tx.options).toEqual([{ maxAttempts: 1 }]);
    });
  });

  describe('aggregateSpecOf', () => {
    it('asks for a count alone', () => {
      const spec = aggregateSpecOf({ count: true });

      expect(Object.keys(spec)).toEqual(['count']);
      expect(aggregateFieldEqual(spec.count!, count())).toBeTrue();
    });

    it('asks for the sum of the named field alone', () => {
      const spec = aggregateSpecOf({ sum: 'amount' });

      expect(Object.keys(spec)).toEqual(['sum']);
      expect(aggregateFieldEqual(spec.sum!, sum('amount'))).toBeTrue();
      expect(aggregateFieldEqual(spec.sum!, sum('amountInBaseCurrency'))).toBeFalse();
    });

    it('asks for both in one aggregation', () => {
      const spec = aggregateSpecOf({ count: true, sum: 'amount' });

      expect(Object.keys(spec).sort()).toEqual(['count', 'sum']);
      expect(aggregateFieldEqual(spec.count!, count())).toBeTrue();
      expect(aggregateFieldEqual(spec.sum!, sum('amount'))).toBeTrue();
    });

    it('refuses an aggregation that asks for nothing', () => {
      expect(() => aggregateSpecOf({})).toThrowError(/count or sum/);
      expect(() => aggregateSpecOf({ sum: '' })).toThrowError(/count or sum/);
    });
  });

  describe('assertAggregateAsks', () => {
    it('passes a request for a count, a sum or both', () => {
      expect(() => assertAggregateAsks({ count: true })).not.toThrow();
      expect(() => assertAggregateAsks({ sum: 'amount' })).not.toThrow();
      expect(() => assertAggregateAsks({ count: true, sum: 'amount' })).not.toThrow();
    });

    it('refuses a request for neither', () => {
      expect(() => assertAggregateAsks({})).toThrowError(/count or sum/);
      expect(() => assertAggregateAsks({ count: false, sum: '' })).toThrowError(/count or sum/);
    });
  });

  describe('aggregateTotalsOf', () => {
    it('answers every part asked for', () => {
      expect(aggregateTotalsOf({ count: true, sum: 'amount' }, { count: 3, sum: 39 }))
        .toEqual({ count: 3, sum: 39 });
    });

    it('leaves out a part the answer holds but the request did not ask for', () => {
      const sumOnly = aggregateTotalsOf({ sum: 'amount' }, { count: 3, sum: 39 });
      expect(sumOnly).toEqual({ sum: 39 });
      expect(Object.keys(sumOnly)).toEqual(['sum']);

      const countOnly = aggregateTotalsOf({ count: true }, { count: 3, sum: 39 });
      expect(countOnly).toEqual({ count: 3 });
      expect(Object.keys(countOnly)).toEqual(['count']);
    });
  });
});
