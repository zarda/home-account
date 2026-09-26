import { TestBed } from '@angular/core/testing';
import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  deleteField,
  increment,
  serverTimestamp
} from '@angular/fire/firestore';
import { MockFirestoreService } from './mock-firestore.service';

/**
 * The mock's batch recorder, call-order log and aggregate stub: the helpers
 * other specs pin write order and reconcile figures with.
 */
describe('MockFirestoreService', () => {
  let mock: MockFirestoreService;

  // deleteField and increment go through the zone wrapper, which warns
  // outside an injector.
  const inInjector = <T>(make: () => T): T => TestBed.runInInjectionContext(make);

  beforeEach(() => {
    mock = new MockFirestoreService();
  });

  describe('commitBatch', () => {
    it('records each batch that lands and applies its set, merge, update and delete', async () => {
      mock.setMockDocument('a/1', { x: 1, y: 1 });
      mock.setMockDocument('a/2', { x: 2, y: 2 });
      mock.setMockDocument('a/3', { x: 3 });

      await mock.commitBatch([
        { op: 'set', path: 'a/1', data: { x: 10 } },
        { op: 'set', path: 'a/2', data: { x: 20 }, merge: true },
        { op: 'update', path: 'a/2', data: { z: 2 } },
        { op: 'delete', path: 'a/3' }
      ]);
      await mock.commitBatch([{ op: 'update', path: 'a/1', data: { z: 1 } }]);

      expect(await mock.getDocument('a/1')).toEqual({ x: 10, z: 1 });
      expect(await mock.getDocument('a/2')).toEqual({ x: 20, y: 2, z: 2 });
      expect(await mock.getDocument('a/3')).toBeNull();
      expect(mock.batches.map(ops => ops.map(o => `${o.op} ${o.path}`))).toEqual([
        ['set a/1', 'set a/2', 'update a/2', 'delete a/3'],
        ['update a/1']
      ]);
    });

    it('refuses the whole batch with not-found when an update names a missing document', async () => {
      mock.setMockDocument('a/1', { x: 1 });
      // A row seeded only as part of a collection is not a document here.
      mock.setMockCollection('a', [{ id: '4', x: 4 }]);

      await expectAsync(mock.commitBatch([
        { op: 'set', path: 'a/1', data: { x: 10 } },
        { op: 'update', path: 'a/4', data: { x: 40 } }
      ])).toBeRejectedWith(jasmine.objectContaining({ code: 'not-found' }));

      expect(await mock.getDocument('a/1')).toEqual({ x: 1 });
      expect(await mock.getDocument('a/4')).toBeNull();
      expect(mock.batches).toEqual([]);
      expect(mock.commitBatchSpy.calls.length).toBe(1);
    });

    it('judges each update against the batch as it stands at that op', async () => {
      mock.setMockDocument('a/2', { x: 2 });

      await mock.commitBatch([
        { op: 'set', path: 'a/1', data: { x: 1 } },
        { op: 'update', path: 'a/1', data: { y: 1 } }
      ]);
      expect(await mock.getDocument('a/1')).toEqual({ x: 1, y: 1 });

      await expectAsync(mock.commitBatch([
        { op: 'delete', path: 'a/2' },
        { op: 'update', path: 'a/2', data: { y: 2 } }
      ])).toBeRejectedWith(jasmine.objectContaining({ code: 'not-found' }));
      expect(await mock.getDocument('a/2')).toEqual({ x: 2 });
      expect(mock.batches.length).toBe(1);
    });

    it('applies nothing of a batch refuseBatch refuses, and rejects with its answer', async () => {
      const refusal = new Error('refused');
      mock.setMockDocument('a/1', { x: 1 });
      mock.refuseBatch = ops => ops.some(o => o.path.startsWith('households/')) && refusal;

      await expectAsync(mock.commitBatch([
        { op: 'delete', path: 'a/1' },
        { op: 'set', path: 'households/h/ledger/u_1', data: { amount: 1 } }
      ])).toBeRejectedWith(refusal);

      expect(await mock.getDocument('a/1')).toEqual({ x: 1 });
      expect(mock.batches).toEqual([]);
      expect(mock.commitBatchSpy.calls.length).toBe(1);
      expect(mock.callLog.map(c => c.method)).toEqual(['commitBatch', 'getDocument']);
    });

    it('refuses the whole batch with invalid-argument when a value is undefined, as the SDK does', async () => {
      mock.setMockDocument('a/1', { x: 1 });

      await expectAsync(mock.commitBatch([
        { op: 'delete', path: 'a/1' },
        { op: 'set', path: 'a/2', data: { x: 2, category: { name: undefined } } }
      ])).toBeRejectedWith(jasmine.objectContaining({ code: 'invalid-argument' }));
      await expectAsync(mock.commitBatch([
        { op: 'update', path: 'a/1', data: { goalId: undefined } }
      ])).toBeRejectedWith(jasmine.objectContaining({ code: 'invalid-argument' }));

      expect(await mock.getDocument('a/1')).toEqual({ x: 1 });
      expect(await mock.getDocument('a/2')).toBeNull();
      expect(mock.batches).toEqual([]);
    });

    it('holds a server timestamp as a Timestamp, as the server stores it', async () => {
      const before = Timestamp.now().toMillis();

      await mock.commitBatch([
        { op: 'set', path: 'h/l/c/1', data: { amount: 1, updatedAt: serverTimestamp() }, stamp: false }
      ]);

      const copy = await mock.getDocument<{ amount: number; updatedAt: Timestamp }>('h/l/c/1');
      expect(copy!.updatedAt instanceof Timestamp).toBeTrue();
      expect(copy!.updatedAt.toMillis()).toBeGreaterThanOrEqual(before);
    });

    it('adds with arrayUnion only the elements not already there, and removes every match with arrayRemove', async () => {
      mock.setMockDocument('u/t/1', { sharedWith: ['households/a'] });
      mock.setMockDocument('u/t/2', { sharedWith: ['households/a', 'households/b', 'households/a'] });
      mock.setMockDocument('u/t/3', { amount: 3 });

      await mock.commitBatch([
        { op: 'update', path: 'u/t/1', data: { sharedWith: arrayUnion('households/a', 'households/b') } },
        { op: 'update', path: 'u/t/2', data: { sharedWith: arrayRemove('households/a') } },
        { op: 'update', path: 'u/t/3', data: { sharedWith: arrayUnion('households/c', 'households/c') } }
      ]);

      expect(await mock.getDocument('u/t/1')).toEqual({ sharedWith: ['households/a', 'households/b'] });
      expect(await mock.getDocument('u/t/2')).toEqual({ sharedWith: ['households/b'] });
      expect(await mock.getDocument('u/t/3')).toEqual({ amount: 3, sharedWith: ['households/c'] });
    });

    it('compares arrayUnion and arrayRemove elements by value, maps and timestamps included', async () => {
      const at = Timestamp.fromMillis(1000);
      mock.setMockDocument('a/1', { list: [{ k: 1 }, Timestamp.fromMillis(1000)] });

      await mock.commitBatch([
        { op: 'update', path: 'a/1', data: { list: arrayUnion({ k: 1 }, { k: 2 }) } }
      ]);
      expect(await mock.getDocument('a/1')).toEqual({ list: [{ k: 1 }, at, { k: 2 }] });

      await mock.commitBatch([
        { op: 'update', path: 'a/1', data: { list: arrayRemove(Timestamp.fromMillis(1000), { k: 1 }) } }
      ]);
      expect(await mock.getDocument('a/1')).toEqual({ list: [{ k: 2 }] });
    });

    it('removes a field deleteField names, from an update or a merge', async () => {
      mock.setMockDocument('a/1', { x: 1, goalId: 'g', nested: { keep: 1, drop: 2 } });
      mock.setMockDocument('a/2', { x: 2, goalId: 'g' });

      await mock.commitBatch([
        { op: 'update', path: 'a/1', data: { goalId: inInjector(() => deleteField()) } },
        { op: 'update', path: 'a/1', data: { 'nested.drop': inInjector(() => deleteField()) } },
        { op: 'set', path: 'a/2', data: { goalId: inInjector(() => deleteField()) }, merge: true }
      ]);

      expect(await mock.getDocument('a/1')).toEqual({ x: 1, nested: { keep: 1 } });
      expect(await mock.getDocument('a/2')).toEqual({ x: 2 });
    });

    it('reads a dotted update key as a path into nested maps', async () => {
      mock.setMockDocument('a/1', { category: { name: 'Food', icon: 'restaurant' }, amount: 1 });

      await mock.commitBatch([
        { op: 'update', path: 'a/1', data: { 'category.name': 'Groceries', 'meta.source': 'scan' } }
      ]);

      expect(await mock.getDocument('a/1')).toEqual({
        category: { name: 'Groceries', icon: 'restaurant' },
        meta: { source: 'scan' },
        amount: 1
      });
    });

    it('merges a merge set into nested maps, and replaces them on a plain set or an update', async () => {
      const seeded = { category: { name: 'Food', icon: 'restaurant' }, amount: 1 };
      mock.setMockDocument('a/1', seeded);
      mock.setMockDocument('a/2', seeded);
      mock.setMockDocument('a/3', seeded);

      await mock.commitBatch([
        { op: 'set', path: 'a/1', data: { category: { name: 'Groceries' } }, merge: true },
        { op: 'set', path: 'a/2', data: { category: { name: 'Groceries' } } },
        { op: 'update', path: 'a/3', data: { category: { name: 'Groceries' } } }
      ]);

      expect(await mock.getDocument('a/1')).toEqual({ category: { name: 'Groceries', icon: 'restaurant' }, amount: 1 });
      expect(await mock.getDocument('a/2')).toEqual({ category: { name: 'Groceries' } });
      expect(await mock.getDocument('a/3')).toEqual({ category: { name: 'Groceries' }, amount: 1 });
      expect(seeded).toEqual({ category: { name: 'Food', icon: 'restaurant' }, amount: 1 });
    });

    it('refuses the whole batch for a sentinel it cannot apply, rather than store it as a value', async () => {
      mock.setMockDocument('a/1', { x: 1, n: 1 });

      await expectAsync(mock.commitBatch([
        { op: 'set', path: 'a/2', data: { x: 2 } },
        { op: 'update', path: 'a/1', data: { n: inInjector(() => increment(1)) } }
      ])).toBeRejectedWithError(/cannot apply increment\(\)/);

      expect(await mock.getDocument('a/1')).toEqual({ x: 1, n: 1 });
      expect(await mock.getDocument('a/2')).toBeNull();
      expect(mock.batches).toEqual([]);
    });
  });

  describe('commitOnline', () => {
    it('applies and records a commit as commitBatch does, flagged as a transaction', async () => {
      mock.setMockDocument('a/1', { x: 1 });
      mock.setMockDocument('a/2', { x: 2 });

      await mock.commitBatch([{ op: 'update', path: 'a/1', data: { y: 1 } }]);
      await mock.commitOnline([
        { op: 'set', path: 'a/3', data: { x: 3, at: serverTimestamp() }, stamp: 'server' },
        { op: 'update', path: 'a/1', data: { y: inInjector(() => deleteField()) } },
        { op: 'delete', path: 'a/2' }
      ]);

      expect(await mock.getDocument('a/1')).toEqual({ x: 1 });
      expect(await mock.getDocument('a/2')).toBeNull();
      expect((await mock.getDocument<{ at: unknown }>('a/3'))!.at).toEqual(jasmine.any(Timestamp));
      expect(mock.batches.map(ops => ops.map(o => `${o.op} ${o.path}`))).toEqual([
        ['update a/1'],
        ['set a/3', 'update a/1', 'delete a/2']
      ]);
      expect(mock.transactional).toEqual([false, true]);
      expect(mock.commitBatchSpy.calls.length).toBe(1);
      expect(mock.commitOnlineSpy.calls.map(call => (call.args[0] as { path: string }[]).length)).toEqual([3]);
      expect(mock.callLog.map(c => c.method)).toEqual(['commitBatch', 'commitOnline', 'getDocument', 'getDocument', 'getDocument']);
      expect(mock.callLog[1].ops!.map(o => o.path)).toEqual(['a/3', 'a/1', 'a/2']);
    });

    it('refuses the whole commit as commitBatch does: by refuseBatch, and with not-found for a missing document', async () => {
      const refusal = new Error('refused');
      mock.setMockDocument('a/1', { x: 1 });
      mock.refuseBatch = ops => ops.some(o => o.path.startsWith('households/')) && refusal;

      await expectAsync(mock.commitOnline([
        { op: 'delete', path: 'a/1' },
        { op: 'set', path: 'households/h/budgets/b1', data: { amount: 1 } }
      ])).toBeRejectedWith(refusal);
      await expectAsync(mock.commitOnline([
        { op: 'delete', path: 'a/1' },
        { op: 'update', path: 'a/4', data: { x: 4 } }
      ])).toBeRejectedWith(jasmine.objectContaining({ code: 'not-found' }));

      expect(await mock.getDocument('a/1')).toEqual({ x: 1 });
      expect(mock.batches).toEqual([]);
      expect(mock.transactional).toEqual([]);
      expect(mock.commitOnlineSpy.calls.length).toBe(2);
    });
  });

  it('logs every call in the order it was made, before any of them settles', () => {
    void mock.setDocument('users/u/transactions/t1', { amount: 1 });
    void mock.commitBatch([{ op: 'set', path: 'households/h/ledger/u_t1', data: {}, stamp: false }]);
    void mock.updateDocument('users/u/transactions/t1', { amount: 2 });
    void mock.getDocumentFromServer('users/u/transactions/t1');
    void mock.waitForPendingWrites();

    expect(mock.callLog.map(c => c.method)).toEqual([
      'setDocument', 'commitBatch', 'updateDocument', 'getDocumentFromServer', 'waitForPendingWrites'
    ]);
    expect(mock.callLog[0].path).toBe('users/u/transactions/t1');
    expect(mock.callLog[1].ops!.map(o => o.path)).toEqual(['households/h/ledger/u_t1']);
  });

  describe('aggregateFromServer', () => {
    const rows = [
      { id: 't1', amount: 5, sharedWith: ['households/h'] },
      { id: 't2', amount: 7.5, sharedWith: ['households/h', 'households/k'] },
      { id: 't3', amount: 20 },
      { id: 't4', amount: 'n/a', sharedWith: ['households/h'] }
    ];

    it('counts and sums the seeded collection by the == and array-contains filters', async () => {
      mock.setMockCollection('users/u/transactions', rows);

      expect(await mock.aggregateFromServer('users/u/transactions', {
        where: [{ field: 'sharedWith', op: 'array-contains', value: 'households/h' }]
      }, { count: true, sum: 'amount' })).toEqual({ count: 3, sum: 12.5 });
      expect(await mock.aggregateFromServer('users/u/transactions', {
        where: [{ field: 'id', op: '==', value: 't3' }]
      }, { sum: 'amount' })).toEqual({ sum: 20 });
      expect(await mock.aggregateFromServer('users/u/transactions', undefined, { count: true }))
        .toEqual({ count: 4 });
    });

    it('answers the figures setMockAggregate names, whatever the filters', async () => {
      mock.setMockCollection('households/h/ledger', rows);
      mock.setMockAggregate('households/h/ledger', { count: 2, sum: 9 });

      expect(await mock.aggregateFromServer('households/h/ledger', {
        where: [{ field: 'memberUid', op: '==', value: 'u' }]
      }, { count: true, sum: 'amount' })).toEqual({ count: 2, sum: 9 });
      expect(mock.aggregateFromServerSpy.mostRecent()!.args[0]).toBe('households/h/ledger');
    });

    it('throws for a filter it cannot apply, rather than answer for the wrong documents', async () => {
      mock.setMockCollection('users/u/transactions', rows);

      await expectAsync(mock.aggregateFromServer('users/u/transactions', {
        where: [{ field: 'amount', op: '>', value: 1 }]
      }, { count: true })).toBeRejectedWithError(/does not filter by '>'/);
    });

    it('rejects a request for neither a count nor a sum, as the service does', async () => {
      mock.setMockCollection('users/u/transactions', rows);
      mock.setMockAggregate('households/h/ledger', { count: 2, sum: 9 });

      await expectAsync(mock.aggregateFromServer('users/u/transactions', undefined, {}))
        .toBeRejectedWithError(/count or sum/);
      await expectAsync(mock.aggregateFromServer('households/h/ledger', undefined, { sum: '' }))
        .toBeRejectedWithError(/count or sum/);
      expect(mock.aggregateFromServerSpy.calls.length).toBe(2);
    });
  });

  it('clearMocks empties the log, the recorder, the stubs and the refusal', async () => {
    mock.setMockAggregate('a', { count: 1 });
    await mock.commitBatch([]);
    await mock.commitOnline([]);
    mock.refuseBatch = () => new Error('refused');
    await mock.commitBatch([]).catch(() => undefined);
    expect(mock.batches.length).toBe(2);

    mock.clearMocks();

    expect(mock.refuseBatch).toBeUndefined();
    expect(mock.callLog).toEqual([]);
    expect(mock.batches).toEqual([]);
    expect(mock.transactional).toEqual([]);
    expect(mock.commitBatchSpy.calls).toEqual([]);
    expect(mock.commitOnlineSpy.calls).toEqual([]);
    expect(await mock.aggregateFromServer('a', undefined, { count: true })).toEqual({ count: 0 });
    // Last, since it logs a call and records a batch of its own.
    await expectAsync(mock.commitBatch([])).toBeResolved();
  });
});
