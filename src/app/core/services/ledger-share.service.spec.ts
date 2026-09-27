import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { FieldValue, Timestamp, arrayRemove, arrayUnion } from '@angular/fire/firestore';
import {
  LEDGER_REPAIR_DELAY_MS,
  LEDGER_UNSHARE_PAIRS_PER_COMMIT,
  LedgerShareRefusal,
  LedgerShareService
} from './ledger-share.service';
import {
  ledgerJournalKey,
  ledgerSweepKey,
  journalRows,
  markFullPass,
  readLedgerJournal,
  readSweepStamps,
  stampSweep
} from './ledger-journal';
import { BatchOp, FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import {
  Category,
  FULL_SWEEP_EVERY_MS,
  LEDGER_COMMIT_CHUNK,
  LEDGER_OWN_WRITE_CHUNK,
  LEDGER_PURGE_CHUNK,
  LedgerCopy,
  MAX_BULK_SHARE,
  Transaction,
  shareKey
} from '../../models';
import { defaultCategories, mergeCategories } from '../utils/category-merge.utils';
import { projectRow } from '../utils/ledger-projection.utils';

describe('LedgerShareService', () => {
  const UID = 'owner1';
  const OTHER_UID = 'other1';
  /** Generations with microseconds, as the server stamps them. */
  const G1 = new Timestamp(1_790_000_000, 123_456_000);
  const G2 = new Timestamp(1_790_100_000, 654_321_000);
  const G3 = new Timestamp(1_790_200_000, 0);
  const OLD_GEN = new Timestamp(1_700_000_000, 0);
  const DATE = Timestamp.fromMillis(Date.UTC(2026, 8, 20, 12));
  const DAY_MS = 24 * 60 * 60 * 1000;

  let firestore: MockFirestoreService;
  let online: WritableSignal<boolean>;
  let userId: WritableSignal<string | null>;
  let service: LedgerShareService;

  const rowsPath = (uid = UID) => `users/${uid}/transactions`;
  const rowPath = (txId: string, uid = UID) => `${rowsPath(uid)}/${txId}`;
  const ledgerPath = (hid: string) => `households/${hid}/ledger`;
  const copyPath = (hid: string, txId: string, uid = UID) => `${ledgerPath(hid)}/${uid}_${txId}`;

  const categories = (stored: Category[] = []) => mergeCategories(defaultCategories(), stored);
  const categoriesPath = `users/${UID}/categories`;

  /** A custom category under the built-in food group. */
  const custom = (name: string, extra: Partial<Category> = {}): Category => ({
    id: 'custom1',
    userId: UID,
    name,
    icon: 'star',
    color: '#123456',
    type: 'expense',
    parentId: 'food',
    order: 500,
    isActive: true,
    isDefault: false,
    ...extra
  });

  function row(id: string, hids: string[], overrides: Partial<Transaction> = {}): Transaction {
    return {
      id,
      userId: UID,
      type: 'expense',
      amount: 12.5,
      currency: 'USD',
      amountInBaseCurrency: 12.5,
      exchangeRate: 1,
      categoryId: 'food_groceries',
      description: `Row ${id}`,
      note: 'never revealed',
      tags: ['private'],
      date: DATE,
      createdAt: DATE,
      updatedAt: DATE,
      isRecurring: false,
      ...(hids.length ? { sharedWith: hids.map(shareKey) } : {}),
      ...overrides
    } as Transaction;
  }

  const projectionOf = (source: Transaction, gen: Timestamp, stored: Category[] = []) =>
    projectRow({ ...source, userId: UID }, categories(stored), gen);

  /** A copy as stored: the projection, the server's stamp and its document id. */
  function copyOf(
    source: Transaction,
    gen: Timestamp,
    extra: Partial<LedgerCopy> = {},
    stored: Category[] = []
  ): LedgerCopy & { id: string } {
    return { id: `${UID}_${source.id}`, ...projectionOf(source, gen, stored), updatedAt: DATE, ...extra };
  }

  function indexEntry(hid: string, since: Timestamp | null, extra: Record<string, unknown> = {}) {
    return { id: hid, since, role: 'member', name: `Home ${hid}`, joinedAt: since, ...extra };
  }

  /** h1 and h2 live, h3 ended. */
  function seedIndex(entries = [indexEntry('h1', G1), indexEntry('h2', G2), indexEntry('h3', G3, { endedAt: DATE })]) {
    firestore.setMockCollection(`users/${UID}/households`, entries);
  }

  /** The server's side of a live membership: the own member document and the household of its generation. */
  function seedLive(hid: string, gen: Timestamp) {
    firestore.setMockDocument(`households/${hid}/members/${UID}`, { uid: UID, role: 'member', since: gen, joinedAt: gen });
    firestore.setMockDocument(`households/${hid}`, { name: hid, ownerId: 'someone', createdAt: gen });
  }

  /** Rows as documents (for reads and updates) and as the collection a list or aggregate answers with. */
  function seedRows(rows: Transaction[]) {
    for (const source of rows) firestore.setMockDocument(rowPath(source.id), source);
    firestore.setMockCollection(rowsPath(), rows);
  }

  function seedCopies(hid: string, copies: (LedgerCopy & { id: string })[]) {
    for (const copy of copies) firestore.setMockDocument(`${ledgerPath(hid)}/${copy.id}`, copy);
    firestore.setMockCollection(ledgerPath(hid), copies);
  }

  const commits = () => firestore.callLog.filter(call => call.method === 'commitBatch').map(call => call.ops ?? []);
  const methods = () => firestore.callLog.map(call => call.method);
  const journal = () => readLedgerJournal(UID);

  /** Every promise chain the service started, run to its end. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 0));
  }

  const setOf = (hid: string, source: Transaction, gen: Timestamp, stored: Category[] = []): BatchOp => ({
    op: 'set',
    path: copyPath(hid, source.id),
    data: projectionOf(source, gen, stored),
    merge: true,
    stamp: 'server'
  });

  /**
   * Each commit applied to the seeded documents as issued, and answered
   * only when the spec lets it: the server's acknowledgement held back.
   */
  function holdAnswers(): { release: () => void } {
    const apply = firestore.commitBatch.bind(firestore);
    const held: { resolve: () => void; reject: (error: unknown) => void; landed: Promise<void> }[] = [];
    spyOn(firestore, 'commitBatch').and.callFake((ops: readonly BatchOp[]) => {
      const landed = apply(ops);
      return new Promise<void>((resolve, reject) => held.push({ resolve, reject, landed }));
    });
    return {
      release: () => {
        for (const answer of held.splice(0)) answer.landed.then(answer.resolve, answer.reject);
      }
    };
  }

  function fieldValue(op: BatchOp, field: string): FieldValue {
    if (op.op === 'delete') throw new Error(`${op.path} is a delete`);
    return op.data[field] as FieldValue;
  }

  function clearStorage() {
    for (const uid of [UID, OTHER_UID, 'bad_uid']) {
      localStorage.removeItem(ledgerJournalKey(uid));
      for (const hid of ['h1', 'h2', 'h3', 'h4']) localStorage.removeItem(ledgerSweepKey(uid, hid));
    }
  }

  beforeEach(() => {
    clearStorage();
    firestore = new MockFirestoreService();
    online = signal(true);
    userId = signal<string | null>(UID);
    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useValue: firestore },
        { provide: AuthService, useValue: { userId } },
        { provide: PwaService, useValue: { isOnline: online } }
      ]
    });
    service = TestBed.inject(LedgerShareService);
    seedIndex();
    firestore.setMockCollection(categoriesPath, []);
    seedLive('h1', G1);
    seedLive('h2', G2);
  });

  afterEach(clearStorage);

  describe('follow', () => {
    /** Named: two live households, an ended one and one the index does not list. */
    const shared = row('t1', ['h1', 'h2', 'h3', 'h4']);
    /** Named: the two live households only. */
    const both = row('t1', ['h1', 'h2']);

    it('issues one copy write per live household the row names, each in a commit of its own', async () => {
      await service.prepare();
      firestore.callLog.length = 0;

      service.follow('t1', null, shared);

      // Issued before follow returned, and nothing for the ended h3 or the unlisted h4.
      expect(commits()).toEqual([[setOf('h1', shared, G1)], [setOf('h2', shared, G2)]]);
    });

    it('never reveals a field outside the copy\'s own, whatever the row holds', async () => {
      await service.prepare();

      service.follow('t1', null, { ...shared, location: { name: 'Home' } } as unknown as Transaction);

      for (const [op] of commits()) {
        if (op.op !== 'set') throw new Error('expected a set');
        expect(Object.keys(op.data)).not.toContain('note');
        expect(Object.keys(op.data)).not.toContain('tags');
        expect(Object.keys(op.data)).not.toContain('location');
      }
    });

    it('writes nothing when the edit leaves the copy as it was', async () => {
      await service.prepare();
      firestore.callLog.length = 0;

      service.follow('t1', shared, { ...shared, note: 'a new note', tags: ['other'] });

      expect(firestore.callLog).toEqual([]);
      expect(journal().rows).toEqual([]);
    });

    it('writes the copy again when a revealed field changes', async () => {
      await service.prepare();
      const edited = { ...both, amount: 40, description: 'Edited' };

      service.follow('t1', both, edited);

      expect(commits()).toEqual([[setOf('h1', edited, G1)], [setOf('h2', edited, G2)]]);
    });

    it('does nothing at all for a private row, not even a read', () => {
      service.follow('t1', null, row('t1', []));
      service.follow('t1', row('t1', []), { ...row('t1', []), amount: 99 });

      expect(firestore.callLog).toEqual([]);
      expect(journal()).toEqual({ rows: [], full: [] });
    });

    it('journals the copy before it issues the write, and settles it once acknowledged', async () => {
      await service.prepare();
      const atIssue: unknown[] = [];
      firestore.refuseBatch = () => {
        atIssue.push(journal().rows);
        return undefined;
      };

      service.follow('t1', null, row('t1', ['h1']));

      expect(atIssue).toEqual([[{ hid: 'h1', txId: 't1' }]]);
      await settle();
      expect(journal().rows).toEqual([]);
    });

    it('keeps the journal entry when the write is refused, and schedules a repair', fakeAsync(() => {
      void service.prepare();
      flushMicrotasks();
      const repair = spyOn(service, 'repairJournal').and.resolveTo();
      const warn = spyOn(console, 'warn');
      firestore.refuseBatch = () => Object.assign(new Error('refused'), { code: 'permission-denied' });

      service.follow('t1', null, row('t1', ['h1']));
      flushMicrotasks();

      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
      expect(repair).not.toHaveBeenCalled();
      tick(LEDGER_REPAIR_DELAY_MS);
      expect(repair).toHaveBeenCalledTimes(1);
    }));

    it('settles an entry only once the last write in flight for it is acknowledged', async () => {
      await service.prepare();
      let calls = 0;
      firestore.refuseBatch = () => (++calls === 2 ? Object.assign(new Error('refused'), { code: 'permission-denied' }) : undefined);
      spyOn(console, 'warn');
      const first = row('t1', ['h1']);

      service.follow('t1', null, first);
      service.follow('t1', first, { ...first, amount: 30 });
      await settle();

      // The later write was refused, so the copy may be behind its row.
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    });

    it('before the account is loaded, journals every household the row names and issues the writes only once it is', async () => {
      service.follow('t1', null, shared);

      expect(commits()).toEqual([]);
      expect(journal().rows.map(entry => entry.hid)).toEqual(['h1', 'h2', 'h3', 'h4']);

      await settle();

      expect(commits()).toEqual([[setOf('h1', shared, G1)], [setOf('h2', shared, G2)]]);
      // The acknowledged copies are settled; the ended and the unlisted household wait for the repair.
      expect(journal().rows).toEqual([{ hid: 'h3', txId: 't1' }, { hid: 'h4', txId: 't1' }]);
    });

    it('reads the account\'s households again for a household it has not heard of, then writes its copy', async () => {
      await service.prepare();
      seedIndex([indexEntry('h1', G1), indexEntry('h2', G2), indexEntry('h4', G3)]);

      service.follow('t1', null, row('t1', ['h4']));
      await settle();

      expect(commits()).toEqual([[setOf('h4', row('t1', ['h4']), G3)]]);
      expect(journal().rows).toEqual([]);
    });

    it('journals a household the row no longer names, for the repair to take its copy out, and writes nothing for it', async () => {
      await service.prepare();
      const before = row('t1', ['h1', 'h2']);
      const after = { ...row('t1', ['h1']), amount: 20 };

      service.follow('t1', before, after);
      await settle();

      expect(commits()).toEqual([[setOf('h1', after, G1)]]);
      expect(journal().rows).toEqual([{ hid: 'h2', txId: 't1' }]);
    });

    it('never throws: a row it cannot project is left in the journal for the repair', async () => {
      await service.prepare();
      spyOn(console, 'warn');

      expect(() => service.follow('t1', null, { ...shared, amount: Number.NaN })).not.toThrow();
      expect(() => service.follow('t1', null, { ...shared, date: 'soon' as unknown as Timestamp })).not.toThrow();
      // An account id holding an underscore has no copy id (ledgerCopyId).
      firestore.setMockCollection('users/bad_uid/households', [indexEntry('h1', G1)]);
      firestore.setMockCollection('users/bad_uid/categories', []);
      userId.set('bad_uid');
      expect(() => service.follow('t1', null, { ...both, userId: 'bad_uid' })).not.toThrow();
      await settle();

      expect(commits()).toEqual([]);
      expect(journal().rows.map(entry => entry.hid)).toEqual(['h1', 'h2', 'h3', 'h4']);
    });

    it('issues each copy commit before it returns, so the commits sit between the personal write before them and the next', async () => {
      await service.prepare();
      firestore.callLog.length = 0;
      const edited = { ...both, amount: 31 };

      void firestore.updateDocument(rowPath('t1'), { amount: 31 });
      service.follow('t1', both, edited);
      // follow reads no connection state today; offline here only guards
      // against a later branch on it that would hold the writes back.
      online.set(false);
      void firestore.updateDocument(rowPath('t1'), { amount: 32 });
      service.follow('t1', edited, { ...edited, amount: 32 });

      // That they also land in this order across an offline period rests on
      // the SDK's persistent mutation queue, which sends writes as issued.
      expect(methods()).toEqual([
        'updateDocument', 'commitBatch', 'commitBatch',
        'updateDocument', 'commitBatch', 'commitBatch'
      ]);
    });

    it('starts over for another account: its own households and categories, and stops hearing the first account\'s', async () => {
      let attached = 0;
      spyOn(firestore, 'subscribeToCollection').and.callFake(((path: string) => {
        firestore.callLog.push({ method: 'subscribeToCollection', path });
        return new Observable<Category[]>(subscriber => {
          attached++;
          subscriber.next([]);
          return () => attached--;
        });
      }) as never);
      await service.prepare();
      userId.set(OTHER_UID);
      firestore.callLog.length = 0;

      service.follow('t1', null, { ...shared, userId: OTHER_UID });
      await settle();

      const read = firestore.callLog
        .filter(call => call.method === 'getCollection' || call.method === 'subscribeToCollection')
        .map(call => call.path ?? '');
      expect(read).toContain(`users/${OTHER_UID}/households`);
      expect(read).toContain(`users/${OTHER_UID}/categories`);
      expect(read.some(path => path.includes(UID))).toBeFalse();
      expect(commits()).toEqual([]);
      // One listener, the other account's, is left attached.
      expect(attached).toBe(1);
    });

    it('projects a category added after the account was loaded with its own snapshot and bucket, once it has read the categories again', async () => {
      await service.prepare();
      const added = custom('Added since', { id: 'custom9' });
      firestore.setMockCollection(categoriesPath, [added]);
      const source = row('t1', ['h1'], { categoryId: 'custom9' });

      service.follow('t1', null, source);

      expect(commits()).toEqual([]);
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
      await settle();

      expect(commits()).toEqual([[setOf('h1', source, G1, [added])]]);
      const [write] = commits()[0];
      if (write.op !== 'set') throw new Error('expected a set');
      expect(write.data['category']).toEqual({ name: 'Added since', icon: 'star', color: '#123456' });
      expect(write.data['bucket']).toBe('food');
      expect(journal().rows).toEqual([]);
    });

    it('reads the categories again once for a category that is gone, then projects it as the built-in it counts under', async () => {
      await service.prepare();
      firestore.callLog.length = 0;
      const source = row('t1', ['h1'], { categoryId: 'gone' });
      const edited = { ...source, amount: 20 };

      service.follow('t1', null, source);
      await settle();
      service.follow('t1', source, edited);

      const reads = firestore.callLog.filter(call => call.method === 'getCollection' && call.path === categoriesPath);
      expect(reads.length).toBe(1);
      expect(commits()).toEqual([[setOf('h1', source, G1)], [setOf('h1', edited, G1)]]);
    });

    it('holds a follow of a category it is reading again behind that read, in the order the follows were made', async () => {
      await service.prepare();
      firestore.setMockCollection(categoriesPath, [custom('Added since', { id: 'custom9' })]);
      const source = row('t1', ['h1'], { categoryId: 'custom9' });
      const edited = { ...source, amount: 20 };

      service.follow('t1', null, source);
      service.follow('t1', source, edited);
      await settle();

      const added = [custom('Added since', { id: 'custom9' })];
      expect(commits()).toEqual([[setOf('h1', source, G1, added)], [setOf('h1', edited, G1, added)]]);
    });

    it('projects from the account\'s categories as they are heard, a change made on another device included', async () => {
      const heard = new BehaviorSubject<Category[]>([custom('Old name')]);
      spyOn(firestore, 'subscribeToCollection').and.returnValue(heard.asObservable() as never);
      await service.prepare();
      heard.next([custom('New name')]);
      const source = row('t1', ['h1'], { categoryId: 'custom1' });

      service.follow('t1', null, source);

      expect(commits()).toEqual([[setOf('h1', source, G1, [custom('New name')])]]);
    });

    it('keeps an entry for a household the row stopped naming while an earlier write to its copy was still unanswered', async () => {
      await service.prepare();
      const answers = holdAnswers();
      const first = row('t1', ['h1', 'h2']);
      const after = { ...row('t1', ['h1']), amount: 20 };

      service.follow('t1', null, first);
      service.follow('t1', first, after);
      answers.release();
      await settle();

      // The h2 write answered was issued before the row stopped naming h2:
      // its copy is the repair's to take out.
      expect(journal().rows).toEqual([{ hid: 'h2', txId: 't1' }]);
    });
  });

  describe('intend', () => {
    it('journals every household a new row names, and reads and writes nothing', () => {
      service.intend('t1', null, row('t1', ['h1', 'h2', 'h3', 'h4']));

      expect(journal().rows.map(entry => entry.hid)).toEqual(['h1', 'h2', 'h3', 'h4']);
      expect(firestore.callLog).toEqual([]);
    });

    it('journals nothing for an edit that leaves the copies as they were', () => {
      const shared = row('t1', ['h1', 'h2']);

      service.intend('t1', shared, { ...shared, note: 'a new note', receiptCount: 1 });

      expect(journal()).toEqual({ rows: [], full: [] });
    });

    it('journals each household of an edit to a revealed field', () => {
      const shared = row('t1', ['h1', 'h2']);

      service.intend('t1', shared, { ...shared, amount: 40 });

      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }, { hid: 'h2', txId: 't1' }]);
    });

    it('journals a household the row stops naming, for the repair to take its copy out', () => {
      service.intend('t1', row('t1', ['h1', 'h2']), row('t1', ['h1']));

      expect(journal().rows).toEqual([{ hid: 'h2', txId: 't1' }]);
    });

    it('does nothing for a private row, or with no account signed in', () => {
      service.intend('t1', null, row('t1', []));
      userId.set(null);
      service.intend('t1', null, row('t1', ['h1']));

      expect(journal()).toEqual({ rows: [], full: [] });
      expect(firestore.callLog).toEqual([]);
    });

    it('never throws', () => {
      const warn = spyOn(console, 'warn');
      const hostile = { get sharedWith(): string[] { throw new Error('unreadable'); } } as unknown as Transaction;

      expect(() => service.intend('t1', null, hostile)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });

    it('leaves the entry to the follow made after the commit, which settles it once the copy is acknowledged', async () => {
      await service.prepare();
      const source = row('t1', ['h1']);

      service.intend('t1', null, source);
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
      service.follow('t1', null, source);
      await settle();

      expect(commits()).toEqual([[setOf('h1', source, G1)]]);
      expect(journal().rows).toEqual([]);
    });

    it('keeps the entry for the repair when the commit it was made for never lands', async () => {
      await service.prepare();

      service.intend('t1', null, row('t1', ['h1']));
      await settle();

      expect(commits()).toEqual([]);
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    });

    it('keeps the entry when an acknowledged write was issued before it was made', async () => {
      await service.prepare();
      const answers = holdAnswers();
      const source = row('t1', ['h1']);

      service.follow('t1', null, source);
      service.intend('t1', source, { ...source, amount: 30 });
      answers.release();
      await settle();

      // The answered write carries the row before the change the intent is for.
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    });

    it('journals every household that follow, handed the same change, writes or leaves to the repair', async () => {
      await service.prepare();
      const changes: [string, Transaction | null, Transaction][] = [
        ['a new row', null, row('t1', ['h1', 'h2', 'h3', 'h4'])],
        ['a revealed field and the shares', row('t1', ['h1', 'h2']), { ...row('t1', ['h1', 'h3']), amount: 40 }],
        ['the note alone', row('t1', ['h1', 'h2']), { ...row('t1', ['h1', 'h2']), note: 'another note' }],
        ['the shares alone', row('t1', ['h1', 'h2']), row('t1', ['h2'])]
      ];
      const touched = () => [...new Set(journal().rows.map(entry => entry.hid))].sort();

      for (const [what, before, after] of changes) {
        clearStorage();
        service.intend('t1', before, after);
        const intended = touched();
        clearStorage();
        // follow journals each copy it writes before issuing it, and each it
        // leaves to the repair at once: its journal, read before any answer,
        // is every household it touched.
        service.follow('t1', before, after);
        const followed = touched();
        await settle();

        expect(intended).withContext(what).toEqual(followed);
      }
    });
  });

  describe('followMany', () => {
    it(`writes several rows' copies by household, at most ${LEDGER_COMMIT_CHUNK} to a commit, before it returns`, async () => {
      await service.prepare();
      firestore.callLog.length = 0;
      const rows = Array.from({ length: LEDGER_COMMIT_CHUNK + 2 }, (_, i) => row(`t${i}`, ['h1', 'h2']));

      service.followMany(rows.map(source => [source.id, null, source]));

      expect(commits()).toEqual([
        rows.slice(0, LEDGER_COMMIT_CHUNK).map(source => setOf('h1', source, G1)),
        rows.slice(LEDGER_COMMIT_CHUNK).map(source => setOf('h1', source, G1)),
        rows.slice(0, LEDGER_COMMIT_CHUNK).map(source => setOf('h2', source, G2)),
        rows.slice(LEDGER_COMMIT_CHUNK).map(source => setOf('h2', source, G2))
      ]);
      await settle();
      expect(journal().rows).toEqual([]);
    });

    it('applies follow\'s rule to each change: an unchanged copy is left, an ended membership and an unshare are journaled', async () => {
      await service.prepare();
      firestore.callLog.length = 0;
      const kept = row('t1', ['h1']);
      const edited = row('t2', ['h1']);
      const unshared = row('t3', ['h1', 'h2']);

      service.followMany([
        ['t1', kept, { ...kept, note: 'another note' }],
        ['t2', edited, { ...edited, amount: 40 }],
        ['t3', unshared, row('t3', ['h1'])],
        ['t4', null, row('t4', ['h3'])]
      ]);

      expect(commits()).toEqual([[setOf('h1', { ...edited, amount: 40 }, G1)]]);
      await settle();
      expect(journal().rows).toEqual([{ hid: 'h2', txId: 't3' }, { hid: 'h3', txId: 't4' }]);
    });

    it('follows each change as follow does until the account is loaded', async () => {
      const rows = [row('t1', ['h1']), row('t2', ['h1'])];

      service.followMany(rows.map(source => [source.id, null, source]));

      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }, { hid: 'h1', txId: 't2' }]);
      await settle();
      expect(commits()).toEqual([[setOf('h1', rows[0], G1)], [setOf('h1', rows[1], G1)]]);
      expect(journal().rows).toEqual([]);
    });

    it('does nothing at all for private rows, and never throws', () => {
      const warn = spyOn(console, 'warn');
      const hostile = { get sharedWith(): string[] { throw new Error('unreadable'); } } as unknown as Transaction;

      service.followMany([['t1', null, row('t1', [])], ['t2', row('t2', []), { ...row('t2', []), amount: 99 }]]);
      expect(firestore.callLog).toEqual([]);
      expect(journal()).toEqual({ rows: [], full: [] });

      expect(() => service.followMany([['t3', null, hostile]])).not.toThrow();
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });
  });

  describe('share', () => {
    it(`adds the key to the rows at most ${LEDGER_OWN_WRITE_CHUNK} per commit, then writes the copies at most ${LEDGER_COMMIT_CHUNK} per commit`, async () => {
      const rows = Array.from({ length: LEDGER_OWN_WRITE_CHUNK + 2 }, (_, i) => row(`t${i}`, []));
      seedRows(rows);

      await service.share(rows.map(source => source.id), 'h1');

      const all = commits();
      const keyed = all.filter(ops => ops.every(op => op.op === 'update'));
      const copies = all.filter(ops => ops.every(op => op.op === 'set'));
      expect(keyed.map(ops => ops.length)).toEqual([LEDGER_OWN_WRITE_CHUNK, 2]);
      for (const op of keyed.flat()) {
        if (op.op !== 'update') throw new Error('expected an update');
        expect(Object.keys(op.data)).toEqual(['sharedWith']);
        expect(fieldValue(op, 'sharedWith').isEqual(arrayUnion(shareKey('h1')))).toBeTrue();
        expect(op.stamp).toBe('client');
      }
      // The rows' keys go first: every copy is judged against a row that names the household.
      expect(all.indexOf(keyed[1])).toBeLessThan(all.indexOf(copies[0]));
      expect(copies.length).toBe(Math.ceil(rows.length / LEDGER_COMMIT_CHUNK));
      expect(copies.every(ops => ops.length <= LEDGER_COMMIT_CHUNK)).toBeTrue();
      const shared = { ...rows[0], sharedWith: [shareKey('h1')] };
      expect(copies[0][0] as BatchOp).toEqual(setOf('h1', shared, G1));
      expect(journal().rows).toEqual([]);
    });

    it('offline, queues only the rows\' keys and marks the household for a full pass', async () => {
      seedRows([row('t1', []), row('t2', [])]);
      online.set(false);

      await service.share(['t1', 't2'], 'h1');

      expect(commits().length).toBe(1);
      expect(commits()[0].every(op => op.op === 'update')).toBeTrue();
      expect(journal().full).toEqual(['h1']);
    });

    it('offline, a single row\'s share queues its key and then its copy, journaled, and resolves without the server\'s answer', async () => {
      const source = row('t1', ['h2']);
      seedRows([source]);
      online.set(false);
      holdAnswers();

      await service.share(['t1'], 'h1');

      const [keyed, copy] = commits();
      expect(commits().length).toBe(2);
      expect(keyed.map(op => `${op.op} ${op.path}`)).toEqual([`update ${rowPath('t1')}`]);
      expect(fieldValue(keyed[0], 'sharedWith').isEqual(arrayUnion(shareKey('h1')))).toBeTrue();
      // The copy of the row as the cache holds it, the queued key included.
      expect(copy).toEqual([setOf('h1', { ...source, sharedWith: [shareKey('h2'), shareKey('h1')] }, G1)]);
      expect(journal()).toEqual({ rows: [{ hid: 'h1', txId: 't1' }], full: [] });
    });

    it('offline, a single row the cache cannot read marks the household for a full pass and queues only its key', async () => {
      const warn = spyOn(console, 'warn');
      seedRows([row('t1', [])]);
      online.set(false);
      spyOn(firestore, 'getDocument').and.rejectWith(Object.assign(new Error('offline'), { code: 'unavailable' }));

      await service.share(['t1'], 'h1');

      expect(commits().length).toBe(1);
      expect(commits()[0].every(op => op.op === 'update')).toBeTrue();
      expect(journal()).toEqual({ rows: [], full: ['h1'] });
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });

    it('shares the rows still there when one was deleted since it was chosen, key by key', async () => {
      const kept = [row('t1', []), row('t3', [])];
      seedRows(kept);

      await service.share(['t1', 't2', 't3'], 'h1');

      const all = commits();
      // The chunk refused for the missing row, then each row alone.
      expect(all.slice(0, 4).map(ops => ops.map(op => op.path))).toEqual([
        [rowPath('t1'), rowPath('t2'), rowPath('t3')],
        [rowPath('t1')],
        [rowPath('t2')],
        [rowPath('t3')]
      ]);
      expect(all.slice(4)).toEqual([[
        setOf('h1', { ...kept[0], sharedWith: [shareKey('h1')] }, G1),
        setOf('h1', { ...kept[1], sharedWith: [shareKey('h1')] }, G1)
      ]]);
      expect(journal()).toEqual({ rows: [], full: [] });
    });

    it('marks the household for a full pass when a key commit fails, some rows perhaps already keyed', async () => {
      spyOn(console, 'warn');
      seedRows([row('t1', [])]);
      firestore.refuseBatch = () => Object.assign(new Error('refused'), { code: 'permission-denied' });

      await expectAsync(service.share(['t1'], 'h1')).toBeRejected();

      expect(journal().full).toEqual(['h1']);
    });

    it('resolves once the keys have landed, leaving the copies to a full pass when the rows cannot be read back', async () => {
      const warn = spyOn(console, 'warn');
      seedRows([row('t1', [])]);
      spyOn(firestore, 'getDocument').and.rejectWith(Object.assign(new Error('unavailable'), { code: 'unavailable' }));

      // A rejection would tell the share controls the key did not land,
      // while the row already names the household.
      await expectAsync(service.share(['t1'], 'h1')).toBeResolved();

      expect(commits().length).withContext('only the key').toBe(1);
      expect(commits()[0].map(op => `${op.op} ${op.path}`)).toEqual([`update ${rowPath('t1')}`]);
      expect(journal().full).toEqual(['h1']);
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });

    it(`refuses more than ${MAX_BULK_SHARE} rows at once, writing nothing`, async () => {
      const ids = Array.from({ length: MAX_BULK_SHARE + 1 }, (_, i) => `t${i}`);

      await expectAsync(service.share(ids, 'h1')).toBeRejectedWith(jasmine.any(LedgerShareRefusal));
      await expectAsync(service.share(ids, 'h1')).toBeRejectedWith(jasmine.objectContaining({ reason: 'tooMany' }));
      expect(commits()).toEqual([]);
    });

    it('refuses a household that is not one of the account\'s live memberships', async () => {
      seedRows([row('t1', [])]);

      await expectAsync(service.share(['t1'], 'h3')).toBeRejectedWith(jasmine.objectContaining({ reason: 'notMember' }));
      await expectAsync(service.share(['t1'], 'h9')).toBeRejectedWith(jasmine.objectContaining({ reason: 'notMember' }));
      expect(commits()).toEqual([]);
    });

    it(`reports how many rows are done as each commit of ${LEDGER_COMMIT_CHUNK} copies is answered`, async () => {
      const rows = Array.from({ length: LEDGER_COMMIT_CHUNK * 2 + 2 }, (_, i) => row(`t${i}`, []));
      seedRows(rows);
      const progress = jasmine.createSpy('progress');

      await service.share(rows.map(source => source.id), 'h1', progress);

      expect(progress.calls.allArgs()).toEqual([
        [LEDGER_COMMIT_CHUNK, rows.length],
        [LEDGER_COMMIT_CHUNK * 2, rows.length],
        [rows.length, rows.length]
      ]);
    });

    it('reports no rows done while their commit of copies waits for its answer', async () => {
      const rows = Array.from({ length: LEDGER_COMMIT_CHUNK + 1 }, (_, i) => row(`t${i}`, []));
      seedRows(rows);
      // The keys are answered at once; each commit of copies only when released.
      const apply = firestore.commitBatch.bind(firestore);
      const held: (() => void)[] = [];
      spyOn(firestore, 'commitBatch').and.callFake((ops: readonly BatchOp[]) => {
        const landed = apply(ops);
        if (ops.every(op => op.op === 'update')) return landed;
        return new Promise<void>((resolve, reject) => held.push(() => landed.then(resolve, reject)));
      });
      const progress = jasmine.createSpy('progress');
      let resolved = false;

      const run = service.share(rows.map(source => source.id), 'h1', progress).then(() => (resolved = true));
      await settle();

      expect(held.length).withContext('both commits of copies issued').toBe(2);
      expect(progress).withContext('nothing answered yet').not.toHaveBeenCalled();
      expect(resolved).toBeFalse();

      held[0]();
      await settle();
      expect(progress.calls.allArgs()).toEqual([[LEDGER_COMMIT_CHUNK, rows.length]]);
      expect(resolved).toBeFalse();

      held[1]();
      await run;
      expect(progress.calls.allArgs()).toEqual([[LEDGER_COMMIT_CHUNK, rows.length], [rows.length, rows.length]]);
    });

    it('counts a chunk whose rows are all gone as done, since it has nothing to write', async () => {
      // t5 is chosen but deleted: its chunk writes no copy.
      const rows = Array.from({ length: LEDGER_COMMIT_CHUNK }, (_, i) => row(`t${i}`, []));
      seedRows(rows);
      const progress = jasmine.createSpy('progress');

      await service.share([...rows.map(source => source.id), `t${LEDGER_COMMIT_CHUNK}`], 'h1', progress);

      expect(progress.calls.mostRecent().args).toEqual([rows.length + 1, rows.length + 1]);
    });

    it('reports nothing offline, where the share resolves once its keys are queued', async () => {
      seedRows([row('t1', []), row('t2', [])]);
      online.set(false);
      const progress = jasmine.createSpy('progress');

      await service.share(['t1', 't2'], 'h1', progress);

      expect(progress).not.toHaveBeenCalled();
    });

    it('still shares when the progress callback throws', async () => {
      const warn = spyOn(console, 'warn');
      seedRows([row('t1', [])]);

      await expectAsync(service.share(['t1'], 'h1', () => { throw new Error('view gone'); })).toBeResolved();

      expect(commits().length).withContext('the key, then the copy').toBe(2);
      expect(journal()).toEqual({ rows: [], full: [] });
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });
  });

  describe('unshare', () => {
    it(`takes each copy out with its row's key in one commit, at most ${LEDGER_UNSHARE_PAIRS_PER_COMMIT} pairs per commit`, async () => {
      const rows = Array.from({ length: LEDGER_UNSHARE_PAIRS_PER_COMMIT + 1 }, (_, i) => row(`t${i}`, ['h1']));
      seedRows(rows);

      await service.unshare(rows.map(source => source.id), 'h1');

      const all = commits();
      expect(all.map(ops => ops.length)).toEqual([LEDGER_UNSHARE_PAIRS_PER_COMMIT * 2, 2]);
      const [remove, key] = all[1];
      expect(remove).toEqual({ op: 'delete', path: copyPath('h1', rows[rows.length - 1].id) });
      expect(key.op).toBe('update');
      expect(key.path).toBe(rowPath(rows[rows.length - 1].id));
      expect(fieldValue(key, 'sharedWith').isEqual(arrayRemove(shareKey('h1')))).toBeTrue();
      expect(key.op === 'update' && key.stamp).toBe('client');
    });

    it('works offline: the pairs are issued and it resolves without the server\'s answer', async () => {
      online.set(false);
      spyOn(firestore, 'commitBatch').and.returnValue(new Promise<void>(() => undefined));

      await service.unshare(['t1'], 'h1');

      expect(firestore.commitBatch).toHaveBeenCalledTimes(1);
    });

    it('works for a membership that has ended, which a copy write could not', async () => {
      seedRows([row('t1', ['h3'])]);

      await service.unshare(['t1'], 'h3');

      expect(commits().length).toBe(1);
    });

    it('takes out the copy of a row that is gone without holding back the others', async () => {
      seedRows([row('t1', ['h1'])]);
      seedCopies('h1', [copyOf(row('t1', ['h1']), G1), copyOf(row('t2', ['h1']), G1)]);

      await service.unshare(['t1', 't2'], 'h1');

      expect(await firestore.getDocument(copyPath('h1', 't1'))).toBeNull();
      expect(await firestore.getDocument(copyPath('h1', 't2'))).toBeNull();
      expect((await firestore.getDocument<Transaction>(rowPath('t1')))?.sharedWith).toEqual([]);
    });

    it(`refuses more than ${MAX_BULK_SHARE} rows at once`, async () => {
      const ids = Array.from({ length: MAX_BULK_SHARE + 1 }, (_, i) => `t${i}`);

      await expectAsync(service.unshare(ids, 'h1')).toBeRejectedWith(jasmine.objectContaining({ reason: 'tooMany' }));
      expect(commits()).toEqual([]);
    });

    it('reports how many rows are done as each commit is answered', async () => {
      const rows = Array.from({ length: LEDGER_UNSHARE_PAIRS_PER_COMMIT + 3 }, (_, i) => row(`t${i}`, ['h1']));
      seedRows(rows);
      const progress = jasmine.createSpy('progress');

      await service.unshare(rows.map(source => source.id), 'h1', progress);

      // One report per commit, in the order the commits are answered.
      expect(progress.calls.allArgs()).toEqual([
        [LEDGER_UNSHARE_PAIRS_PER_COMMIT, rows.length],
        [rows.length, rows.length]
      ]);
    });

    it('settles only once every commit is answered, so a refused one reports nothing after it', async () => {
      const rows = Array.from({ length: LEDGER_UNSHARE_PAIRS_PER_COMMIT * 2 + 1 }, (_, i) => row(`t${i}`, ['h1']));
      seedRows(rows);
      // The first commit is answered, the second refused, the third held.
      const apply = firestore.commitBatch.bind(firestore);
      const refusal = Object.assign(new Error('refused'), { code: 'permission-denied' });
      let releaseLast!: () => void;
      let call = 0;
      spyOn(firestore, 'commitBatch').and.callFake((ops: readonly BatchOp[]) => {
        call++;
        if (call === 1) return apply(ops);
        if (call === 2) return Promise.reject(refusal);
        const landed = apply(ops);
        return new Promise<void>((resolve, reject) => (releaseLast = () => landed.then(resolve, reject)));
      });
      const progress = jasmine.createSpy('progress');
      let settled = false;

      const run = service.unshare(rows.map(source => source.id), 'h1', progress);
      run.then(() => (settled = true), () => (settled = true));
      await settle();

      expect(settled).withContext('a commit is still unanswered').toBeFalse();
      expect(progress.calls.allArgs()).toEqual([[LEDGER_UNSHARE_PAIRS_PER_COMMIT, rows.length]]);

      releaseLast();
      await expectAsync(run).toBeRejectedWith(refusal);
      const reports = progress.calls.allArgs();
      expect(reports).toEqual([
        [LEDGER_UNSHARE_PAIRS_PER_COMMIT, rows.length],
        [LEDGER_UNSHARE_PAIRS_PER_COMMIT + 1, rows.length]
      ]);
      await settle();
      expect(progress.calls.count()).withContext('nothing after it settled').toBe(reports.length);
    });

    it('reports nothing offline, where the unshare resolves once its commits are queued', async () => {
      online.set(false);
      spyOn(firestore, 'commitBatch').and.returnValue(new Promise<void>(() => undefined));
      const progress = jasmine.createSpy('progress');

      await service.unshare(['t1'], 'h1', progress);

      expect(progress).not.toHaveBeenCalled();
    });

    it('still unshares when the progress callback throws', async () => {
      const warn = spyOn(console, 'warn');
      seedRows([row('t1', ['h1'])]);

      await expectAsync(service.unshare(['t1'], 'h1', () => { throw new Error('view gone'); })).toBeResolved();

      expect(commits().length).toBe(1);
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });
  });

  describe('repairJournal', () => {
    beforeEach(() => spyOn(console, 'warn'));

    it('does nothing offline', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      online.set(false);

      await service.repairJournal();

      expect(firestore.callLog).toEqual([]);
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    });

    it('waits for the writes already issued before it reads anything', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      seedRows([row('t1', ['h1'])]);

      await service.repairJournal();

      const order = methods();
      expect(order[0]).toBe('waitForPendingWrites');
      expect(order.indexOf('getDocumentFromServer')).toBeGreaterThan(0);
    });

    it('takes out the copy of a row that is gone', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      seedCopies('h1', [copyOf(row('t1', ['h1']), G1)]);

      await service.repairJournal();

      expect(commits()).toEqual([[{ op: 'delete', path: copyPath('h1', 't1') }]]);
      expect(journal().rows).toEqual([]);
    });

    it('takes out the copy of a row that no longer names the household', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      seedRows([row('t1', ['h2'])]);
      seedCopies('h1', [copyOf(row('t1', ['h1']), G1)]);

      await service.repairJournal();

      expect(commits()).toEqual([[{ op: 'delete', path: copyPath('h1', 't1') }]]);
      expect(journal().rows).toEqual([]);
    });

    it('writes the copy again, as the server holds the row, when the row names a live household', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h1', txId: 't2' }]);
      const stale = row('t1', ['h1']);
      const current = { ...stale, amount: 99 };
      seedRows([current, row('t2', ['h1'])]);
      seedCopies('h1', [copyOf(stale, G1)]);

      await service.repairJournal();

      expect(commits()).toEqual([[setOf('h1', current, G1), setOf('h1', row('t2', ['h1']), G1)]]);
      expect(journal().rows).toEqual([]);
    });

    it('writes nothing for a copy that already matches its row, and settles the entry', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      seedRows([row('t1', ['h1'])]);
      seedCopies('h1', [copyOf(row('t1', ['h1']), G1, { goalId: 'holiday' })]);

      await service.repairJournal();

      expect(commits()).toEqual([]);
      expect(journal().rows).toEqual([]);
    });

    it('replaces a copy of another generation: the old one out first, then the new', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      seedRows([row('t1', ['h1'])]);
      seedCopies('h1', [copyOf(row('t1', ['h1']), OLD_GEN)]);

      await service.repairJournal();

      expect(commits()).toEqual([
        [{ op: 'delete', path: copyPath('h1', 't1') }],
        [setOf('h1', row('t1', ['h1']), G1)]
      ]);
    });

    it('cleans up a membership that has ended: its own copies out, then the key off its rows', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h2', txId: 't9' }]);
      firestore.setMockDocument(`households/h1/members/${UID}`, null);
      const own = copyOf(row('t1', ['h1']), G1);
      const others = { ...copyOf(row('x1', ['h1']), G1), id: 'someone_x1', memberUid: 'someone' };
      seedCopies('h1', [own, others]);
      seedRows([row('t1', ['h1']), row('t2', ['h1', 'h2']), row('t3', ['h2'])]);

      await service.repairJournal();

      const cleanup = commits().slice(0, 2);
      expect(cleanup[0]).toEqual([{ op: 'delete', path: copyPath('h1', 't1') }]);
      expect(cleanup[1].map(op => op.path)).toEqual([rowPath('t1'), rowPath('t2')]);
      expect(cleanup[1].every(op => fieldValue(op, 'sharedWith').isEqual(arrayRemove(shareKey('h1'))))).toBeTrue();
      expect(journal().rows.some(entry => entry.hid === 'h1')).toBeFalse();
    });

    it('cleans up a membership whose household is gone, which a member can no longer read', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      const read = firestore.getDocumentFromServer.bind(firestore);
      spyOn(firestore, 'getDocumentFromServer').and.callFake(((path: string) => path === 'households/h1'
        ? Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }))
        : read(path)) as never);
      seedCopies('h1', [copyOf(row('t1', ['h1']), G1)]);

      await service.repairJournal();

      expect(commits()[0]).toEqual([{ op: 'delete', path: copyPath('h1', 't1') }]);
      expect(journal().rows).toEqual([]);
    });

    it('repairs, and never cleans up, a household the index lists as ended while the server holds the membership live', async () => {
      seedIndex([indexEntry('h1', G1, { endedAt: DATE }), indexEntry('h2', G2)]);
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      const source = row('t1', ['h1']);
      seedRows([source]);

      await service.repairJournal();

      expect(commits()).toEqual([[setOf('h1', source, G1)]]);
      expect(methods()).not.toContain('getCollectionFromServer');
      expect(journal().rows).toEqual([]);
    });

    it('keeps an entry a follow journaled again while the repair was reading it', async () => {
      await service.prepare();
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      const source = row('t1', ['h1']);
      seedRows([source]);
      seedCopies('h1', [copyOf(source, G1)]);
      const read = firestore.getDocumentFromServer.bind(firestore);
      spyOn(firestore, 'getDocumentFromServer').and.callFake(((path: string) => {
        // The row stops naming h1 on this device while its server copy is read.
        if (path === rowPath('t1')) service.follow('t1', source, { ...row('t1', []), amount: 5 });
        return read(path);
      }) as never);

      await service.repairJournal();

      expect(commits()).toEqual([]);
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    });

    it('keeps an entry it could not judge for the next repair', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      spyOn(firestore, 'getDocumentFromServer').and.rejectWith(Object.assign(new Error('offline'), { code: 'unavailable' }));

      await service.repairJournal();

      expect(commits()).toEqual([]);
      expect(journal().rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    });
  });

  describe('reconcile', () => {
    const rowsAggregate = rowsPath();

    it('settles on the check when the counts agree, and writes nothing', async () => {
      firestore.setMockAggregate(rowsAggregate, { count: 3 });
      firestore.setMockAggregate(ledgerPath('h1'), { count: 3 });

      const report = await service.reconcile('h1', 'check');

      expect(report).toEqual({ pass: 'check', written: 0, deleted: 0 });
      expect(commits()).toEqual([]);
      expect(methods()).not.toContain('getCollectionFromServer');
      expect(readSweepStamps(UID, 'h1').check).toEqual(jasmine.any(Number));
    });

    it('asks the server only to count, each side under one filter, which needs no composite index', async () => {
      const aggregate = spyOn(firestore, 'aggregateFromServer').and.resolveTo({ count: 0 });

      await service.reconcile('h1', 'check');

      // A sum filtered on another field needs a composite of the filter and
      // the summed field in production (the emulator never asks for one), and
      // no query shape declares one; a count under one filter is served by
      // the automatic single-field index.
      expect(aggregate.calls.allArgs()).toEqual(jasmine.arrayWithExactContents([
        [rowsPath(), { where: [{ field: 'sharedWith', op: 'array-contains', value: shareKey('h1') }] }, { count: true }],
        [ledgerPath('h1'), { where: [{ field: 'memberUid', op: '==', value: UID }] }, { count: true }]
      ]));
    });

    it('goes on to a full pass when the counts differ', async () => {
      firestore.setMockAggregate(rowsAggregate, { count: 3 });
      firestore.setMockAggregate(ledgerPath('h1'), { count: 2 });

      expect((await service.reconcile('h1', 'check')).pass).toBe('full');
      expect(methods()).toContain('getCollectionFromServer');
    });

    it('settles on the check when only a copy\'s amount is behind: that drift waits for the journal or the weekly pass', async () => {
      const source = row('t1', ['h1'], { amount: 70 });
      seedRows([source]);
      seedCopies('h1', [copyOf({ ...source, amount: 7 }, G1)]);

      expect(await service.reconcile('h1', 'check')).toEqual({ pass: 'check', written: 0, deleted: 0 });
      expect(commits()).toEqual([]);
    });

    it('goes on to a full pass when the server will not answer the check', async () => {
      spyOn(console, 'warn');
      spyOn(firestore, 'aggregateFromServer').and.rejectWith(Object.assign(new Error('unreachable'), { code: 'unavailable' }));

      expect((await service.reconcile('h1', 'check')).pass).toBe('full');
    });

    it('names a missing index when the server refuses the check for want of one', async () => {
      const warn = spyOn(console, 'warn');
      spyOn(firestore, 'aggregateFromServer').and.rejectWith(Object.assign(new Error('index'), { code: 'failed-precondition' }));

      expect((await service.reconcile('h1', 'check')).pass).toBe('full');
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\] .*index/), jasmine.anything());
    });

    it('in a full pass, writes the missing and the different, and takes out the orphans and another generation\'s', async () => {
      const missing = row('a', ['h1']);
      const different = row('b', ['h1'], { amount: 70 });
      const same = row('c', ['h1']);
      const unshared = row('e', ['h2']);
      const wrongGen = row('f', ['h1']);
      seedRows([missing, different, same, unshared, wrongGen]);
      seedCopies('h1', [
        copyOf({ ...different, amount: 7 }, G1),
        copyOf(same, G1, { goalId: 'holiday' }),
        copyOf(row('d', ['h1']), G1),
        copyOf(row('e', ['h1']), G1),
        copyOf(wrongGen, OLD_GEN)
      ]);

      const report = await service.reconcile('h1', 'full');

      expect(report).toEqual({ pass: 'full', written: 3, deleted: 3 });
      expect(commits()).toEqual([
        [
          { op: 'delete', path: copyPath('h1', 'f') },
          { op: 'delete', path: copyPath('h1', 'd') },
          { op: 'delete', path: copyPath('h1', 'e') }
        ],
        [setOf('h1', missing, G1), setOf('h1', different, G1), setOf('h1', wrongGen, G1)]
      ]);
      expect(journal()).toEqual({ rows: [], full: [] });
      expect(readSweepStamps(UID, 'h1').full).toEqual(jasmine.any(Number));
    });

    it(`writes a full pass's copies at most ${LEDGER_COMMIT_CHUNK} per commit`, async () => {
      seedRows(Array.from({ length: LEDGER_COMMIT_CHUNK + 2 }, (_, i) => row(`t${i}`, ['h1'])));

      await service.reconcile('h1', 'full');

      expect(commits().map(ops => ops.length)).toEqual([LEDGER_COMMIT_CHUNK, 2]);
    });

    it('clears the household\'s full-pass mark once a full pass completes, and keeps it when one fails', async () => {
      spyOn(console, 'warn');
      markFullPass(UID, 'h1');
      seedRows([row('t1', ['h1'])]);
      firestore.refuseBatch = () => Object.assign(new Error('refused'), { code: 'permission-denied' });

      await expectAsync(service.reconcile('h1', 'full')).toBeRejected();
      expect(journal().full).toEqual(['h1']);

      firestore.refuseBatch = undefined;
      await service.reconcile('h1', 'full');
      expect(journal().full).toEqual([]);
    });

    it('refuses a household that is not one of the account\'s live memberships', async () => {
      await expectAsync(service.reconcile('h3', 'full')).toBeRejectedWith(jasmine.objectContaining({ reason: 'notMember' }));
      expect(commits()).toEqual([]);
    });
  });

  describe('reconcileAll', () => {
    /** Which households were checked and which diffed in full, read from the server calls. */
    function passes(): { checked: string[]; full: string[] } {
      const checked = new Set<string>();
      const full = new Set<string>();
      for (const call of firestore.callLog) {
        const hid = /^households\/([^/]+)\/ledger$/.exec(call.path ?? '')?.[1];
        if (!hid) continue;
        if (call.method === 'aggregateFromServer') checked.add(hid);
        if (call.method === 'getCollectionFromServer') full.add(hid);
      }
      return { checked: [...checked].sort(), full: [...full].sort() };
    }

    const recent = () => Date.now() - DAY_MS;

    beforeEach(() => {
      for (const hid of ['h1', 'h2']) stampSweep(UID, hid, 'full', recent());
    });

    it('repairs the journal first, then checks each live household', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);

      await service.reconcileAll('start');

      const order = methods();
      expect(order).toContain('waitForPendingWrites');
      expect(order.lastIndexOf('getDocumentFromServer')).toBeLessThan(order.indexOf('aggregateFromServer'));
      expect(passes()).toEqual({ checked: ['h1', 'h2'], full: [] });
    });

    it('runs a full pass for a household the journal marks', async () => {
      markFullPass(UID, 'h2');

      await service.reconcileAll('reconnect');

      expect(passes()).toEqual({ checked: ['h1'], full: ['h2'] });
    });

    it('runs a full pass for a household not diffed in full for a week', async () => {
      stampSweep(UID, 'h1', 'full', Date.now() - FULL_SWEEP_EVERY_MS - 1);

      await service.reconcileAll('page');

      expect(passes()).toEqual({ checked: ['h2'], full: ['h1'] });
    });

    it('runs a full pass for every live household after a restore', async () => {
      await service.reconcileAll('restore');

      expect(passes()).toEqual({ checked: [], full: ['h1', 'h2'] });
    });

    it('falls back on the weekly pass when the journal is lost', async () => {
      const shared = row('t1', ['h2']);
      seedRows([shared]);
      // The copy's amount matches its row, so the counts agree and only a
      // full pass sees the description it missed.
      seedCopies('h2', [copyOf({ ...shared, description: 'Before the lost edit' }, G2)]);
      journalRows(UID, [{ hid: 'h2', txId: 't1' }]);
      // An absent journal is all a sweep can see of a lost one.
      localStorage.removeItem(ledgerJournalKey(UID));
      expect(journal()).toEqual({ rows: [], full: [] });

      await service.reconcileAll('start');

      expect(passes()).toEqual({ checked: ['h1', 'h2'], full: [] });
      expect(commits()).toEqual([]);

      firestore.callLog.length = 0;
      stampSweep(UID, 'h2', 'full', Date.now() - FULL_SWEEP_EVERY_MS - 1);
      await service.reconcileAll('page');

      expect(passes().full).toEqual(['h2']);
      expect(commits()).toEqual([[setOf('h2', shared, G2)]]);
      expect(readSweepStamps(UID, 'h2').full).toBeGreaterThan(Date.now() - DAY_MS);
    });

    it('runs every household in full, and never throws, when the browser will not read its storage', async () => {
      spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');

      await expectAsync(service.reconcileAll('start')).toBeResolved();

      expect(passes()).toEqual({ checked: [], full: ['h1', 'h2'] });
    });

    it('does nothing offline or signed out', async () => {
      online.set(false);
      await service.reconcileAll('start');
      online.set(true);
      userId.set(null);
      await service.reconcileAll('start');

      expect(firestore.callLog).toEqual([]);
    });

    it('never rejects, and one household failing does not stop the next', async () => {
      const warn = spyOn(console, 'warn');
      for (const hid of ['h1', 'h2']) localStorage.removeItem(ledgerSweepKey(UID, hid));
      const list = firestore.getCollectionFromServer.bind(firestore);
      const listed: string[] = [];
      spyOn(firestore, 'getCollectionFromServer').and.callFake(((path: string, options?: unknown) => {
        listed.push(path);
        return path === ledgerPath('h1') ? Promise.reject(new Error('h1 is unavailable')) : list(path, options);
      }) as never);

      await expectAsync(service.reconcileAll('start')).toBeResolved();

      expect(listed).toContain(ledgerPath('h1'));
      expect(listed).toContain(ledgerPath('h2'));
      expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/^\[LedgerShareService\]/), jasmine.anything());
    });

    it('never drops a sweep asked for just as the one running finishes', async () => {
      let hook: ((path: string) => void) | undefined;
      const count = firestore.aggregateFromServer.bind(firestore);
      spyOn(firestore, 'aggregateFromServer').and.callFake(((path: string, options: never, fields: never) => {
        const answer = count(path, options, fields);
        hook?.(path);
        return answer;
      }) as never);

      // Asked a varying number of microtasks after the sweep's last server
      // call, so one of them lands as that sweep ends.
      for (let delay = 0; delay < 24; delay++) {
        for (const hid of ['h1', 'h2']) stampSweep(UID, hid, 'full', recent());
        firestore.callLog.length = 0;
        let restore: Promise<void> = Promise.resolve();
        const asked = new Promise<void>(resolve => {
          hook = path => {
            if (path !== ledgerPath('h2')) return;
            hook = undefined;
            void (async () => {
              for (let i = 0; i < delay; i++) await Promise.resolve();
              restore = service.reconcileAll('restore');
              resolve();
            })();
          };
        });

        await service.reconcileAll('start');
        await asked;
        await restore;

        expect(passes().full).withContext(`asked ${delay} microtasks after the last check was sent`).toEqual(['h1', 'h2']);
      }
    });

    it('runs one sweep at a time, and once more for a call made while one runs', async () => {
      const first = service.reconcileAll('start');
      const second = service.reconcileAll('page');
      const third = service.reconcileAll('page');
      await Promise.all([first, second, third]);

      expect(methods().filter(method => method === 'waitForPendingWrites').length).toBe(0);
      expect(firestore.callLog.filter(call => call.method === 'aggregateFromServer' && call.path === ledgerPath('h1')).length)
        .toBe(2);
    });
  });

  describe('ending a membership', () => {
    it('cleans up in order: its own copies purged, then the key stripped from its rows, then the journal forgotten', async () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h2', txId: 't1' }]);
      seedCopies('h1', [copyOf(row('t1', ['h1']), G1)]);
      seedRows([row('t1', ['h1', 'h2'])]);

      await service.cleanupMembership('h1');

      expect(firestore.callLog.map(call => `${call.method} ${call.path ?? call.ops?.[0]?.path}`)).toEqual([
        `getCollectionFromServer ${ledgerPath('h1')}`,
        `commitBatch ${copyPath('h1', 't1')}`,
        `getCollectionFromServer ${rowsPath()}`,
        `commitBatch ${rowPath('t1')}`
      ]);
      expect(journal().rows).toEqual([{ hid: 'h2', txId: 't1' }]);
    });

    it(`purges the account's own copies, and only its own, at most ${LEDGER_OWN_WRITE_CHUNK} per commit`, async () => {
      const own = Array.from({ length: LEDGER_OWN_WRITE_CHUNK + 1 }, (_, i) => copyOf(row(`t${i}`, ['h1']), G1));
      const others = { ...copyOf(row('x', ['h1']), G1), id: 'someone_x', memberUid: 'someone' };
      seedCopies('h1', [...own, others]);

      expect(await service.purgeOwn('h1')).toBe(own.length);

      expect(commits().map(ops => ops.length)).toEqual([LEDGER_OWN_WRITE_CHUNK, 1]);
      expect(commits().flat().some(op => op.path.endsWith('someone_x'))).toBeFalse();
      expect(firestore.getCollectionFromServerSpy.mostRecent()?.args[1])
        .toEqual({ where: [{ field: 'memberUid', op: '==', value: UID }] });
    });

    it(`strips the key from the rows naming it, at most ${LEDGER_OWN_WRITE_CHUNK} per commit`, async () => {
      seedRows([
        ...Array.from({ length: LEDGER_OWN_WRITE_CHUNK + 1 }, (_, i) => row(`t${i}`, ['h1'])),
        row('private', []),
        row('elsewhere', ['h2'])
      ]);

      expect(await service.stripKey('h1')).toBe(LEDGER_OWN_WRITE_CHUNK + 1);

      expect(commits().map(ops => ops.length)).toEqual([LEDGER_OWN_WRITE_CHUNK, 1]);
      expect(firestore.getCollectionFromServerSpy.mostRecent()?.args[1])
        .toEqual({ where: [{ field: 'sharedWith', op: 'array-contains', value: shareKey('h1') }] });
    });

    it(`purges a removed member's copies of the live generation as the owner, at most ${LEDGER_PURGE_CHUNK} per commit`, async () => {
      seedIndex([indexEntry('h1', G1, { role: 'owner' }), indexEntry('h2', G2)]);
      firestore.setMockDocument('households/h1', { name: 'h1', ownerId: UID, createdAt: G1 });
      const member = (i: number, gen = G1) => ({
        ...copyOf(row(`m${i}`, ['h1']), gen),
        id: `removed_m${i}`,
        memberUid: 'removed'
      });
      seedCopies('h1', [
        ...Array.from({ length: 2 * LEDGER_PURGE_CHUNK + 1 }, (_, i) => member(i)),
        { ...member(99, OLD_GEN), id: 'removed_old' },
        copyOf(row('mine', ['h1']), G1)
      ]);

      expect(await service.purgeMember('h1', 'removed')).toBe(2 * LEDGER_PURGE_CHUNK + 1);

      expect(commits().map(ops => ops.length)).toEqual([LEDGER_PURGE_CHUNK, LEDGER_PURGE_CHUNK, 1]);
      expect(commits().flat().every(op => op.op === 'delete' && op.path.startsWith(`${ledgerPath('h1')}/removed_m`)))
        .toBeTrue();
      // The ledgerByMember shape: gen, then memberUid, both by equality.
      expect(firestore.getCollectionFromServerSpy.mostRecent()?.args[1]).toEqual({
        where: [{ field: 'gen', op: '==', value: G1 }, { field: 'memberUid', op: '==', value: 'removed' }]
      });
    });

    it('refuses a member\'s purge of another member\'s copies before reading any', async () => {
      seedCopies('h1', [{ ...copyOf(row('m1', ['h1']), G1), id: 'removed_m1', memberUid: 'removed' }]);

      await expectAsync(service.purgeMember('h1', 'removed'))
        .toBeRejectedWith(jasmine.objectContaining({ name: 'LedgerShareRefusal', reason: 'notOwner' }));
      expect(firestore.getCollectionFromServerSpy.calls.length).toBe(0);
      expect(commits()).toEqual([]);
    });
  });

  describe('reprojectCategory', () => {
    it('reloads the categories, then rewrites the copies of the shared rows in that category', async () => {
      firestore.setMockCollection(categoriesPath, [custom('Old name')]);
      const inCategory = row('t1', ['h1', 'h2'], { categoryId: 'custom1' });
      seedRows([inCategory, row('t2', [], { categoryId: 'custom1' }), row('t3', ['h1'])]);
      await service.prepare();
      firestore.setMockCollection(categoriesPath, [custom('New name')]);

      await service.reprojectCategory('custom1');

      const written = commits().flat();
      expect(written.map(op => op.path)).toEqual([copyPath('h1', 't1'), copyPath('h2', 't1')]);
      expect(written[0]).toEqual({
        op: 'set',
        path: copyPath('h1', 't1'),
        data: projectionOf(inCategory, G1, [custom('New name')]),
        merge: true,
        stamp: 'server'
      });
      expect(firestore.getCollectionSpy.calls.some(call => call.args[0] === rowsPath()
        && JSON.stringify(call.args[1]) === JSON.stringify({ where: [{ field: 'categoryId', op: '==', value: 'custom1' }] })))
        .toBeTrue();
    });

    it('writes nothing when the change leaves the copies as they were', async () => {
      firestore.setMockCollection(categoriesPath, [custom('Same')]);
      const source = row('t1', ['h1'], { categoryId: 'custom1' });
      seedRows([source]);
      seedCopies('h1', [copyOf(source, G1, {}, [custom('Same')])]);
      await service.prepare();
      firestore.setMockCollection(categoriesPath, [custom('Same', { isActive: false })]);

      await service.reprojectCategory('custom1');

      expect(commits()).toEqual([]);
    });

    it('rewrites a copy the change left behind, even when the service already held the changed category', async () => {
      const source = row('t1', ['h1'], { categoryId: 'custom1' });
      seedRows([source]);
      seedCopies('h1', [copyOf(source, G1, {}, [custom('Old name')])]);
      // The categories were read again after the change and before this call.
      firestore.setMockCollection(categoriesPath, [custom('New name')]);
      await service.prepare();

      await service.reprojectCategory('custom1');

      expect(commits()).toEqual([[setOf('h1', source, G1, [custom('New name')])]]);
    });
  });
});
