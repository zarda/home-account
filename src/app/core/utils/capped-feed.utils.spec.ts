import { Observable, Subject, throwError } from 'rxjs';
import type { CollectionWithMetadata, QueryOptions } from '../services/firestore.service';
import { LEDGER_VIEW_CAP } from '../../models';
import { CappedFeed, UNHEARD, openCappedFeed } from './capped-feed.utils';

interface Doc {
  id: string;
}

describe('openCappedFeed', () => {
  const QUERY: QueryOptions = { where: [{ field: 'gen', op: '==', value: 1 }], orderBy: [{ field: 'date', direction: 'desc' }] };
  const firebaseError = (code: string) => Object.assign(new Error(code), { name: 'FirebaseError', code });
  const docs = (count: number): Doc[] => Array.from({ length: count }, (_, i) => ({ id: `d${i}` }));

  let asked: { path: string; options: QueryOptions | undefined }[];
  let subject: Subject<CollectionWithMetadata<Doc>>;
  let heard: CappedFeed<Doc>[];
  let consoleWarn: jasmine.Spy;
  const firestore = {
    subscribeToCollectionWithMetadata: <T>(path: string, options?: QueryOptions): Observable<CollectionWithMetadata<T>> => {
      asked.push({ path, options });
      return subject.asObservable() as unknown as Observable<CollectionWithMetadata<T>>;
    }
  };

  const open = (capped: boolean) =>
    openCappedFeed<Doc>(firestore, 'households/h1/ledger', QUERY, { capped, what: 'ledger', log: '[Test]' }, feed => heard.push(feed));
  const answer = (list: Doc[], fromCache = false) => subject.next({ docs: list, fromCache, hasPendingWrites: false });

  beforeEach(() => {
    asked = [];
    subject = new Subject();
    heard = [];
    consoleWarn = spyOn(console, 'warn');
  });

  it('asks a capped list for one document past the cap, keeps the cap, and says when it held more', () => {
    open(true);

    expect(asked).toEqual([{ path: 'households/h1/ledger', options: { ...QUERY, limit: LEDGER_VIEW_CAP + 1 } }]);
    answer(docs(LEDGER_VIEW_CAP + 1));
    answer(docs(LEDGER_VIEW_CAP), true);

    expect(heard.map(feed => [feed.docs!.length, feed.docs!.at(-1)!.id, feed.truncated, feed.fromCache, feed.incomplete])).toEqual([
      [LEDGER_VIEW_CAP, `d${LEDGER_VIEW_CAP - 1}`, true, false, false],
      [LEDGER_VIEW_CAP, `d${LEDGER_VIEW_CAP - 1}`, false, true, false]
    ]);
  });

  it('asks an uncapped list as given, and keeps every document', () => {
    open(false);

    expect(asked[0].options).toEqual(QUERY);
    answer(docs(LEDGER_VIEW_CAP + 5));
    expect(heard.map(feed => [feed.docs!.length, feed.truncated])).toEqual([[LEDGER_VIEW_CAP + 5, false]]);
  });

  it('stops quietly on a refusal, whatever it had heard', () => {
    open(true);
    subject.error(firebaseError('permission-denied'));

    expect(heard).toEqual([]);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('warns of any other failure, and says the last answer is incomplete when the server never gave one', () => {
    const failure = firebaseError('unavailable');
    open(true);
    answer([{ id: 'cached' }], true);

    subject.error(failure);

    expect(heard.at(-1)).toEqual({ docs: [{ id: 'cached' }], truncated: false, fromCache: true, incomplete: true });
    expect(consoleWarn).toHaveBeenCalledOnceWith('[Test] The ledger listener stopped:', failure);
  });

  it('says a failure before any answer answered nothing, as incomplete', () => {
    open(false);
    subject.error(firebaseError('failed-precondition'));

    expect(heard).toEqual([{ docs: [], truncated: false, fromCache: false, incomplete: true }]);
  });

  it('keeps what the server said when it fails later, and only warns', () => {
    open(true);
    answer([{ id: 'served' }]);

    subject.error(firebaseError('internal'));

    expect(heard).toEqual([{ docs: [{ id: 'served' }], truncated: false, fromCache: false, incomplete: false }]);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  it('answers null when the listener fails as it is being opened, having said so', () => {
    const failure = firebaseError('failed-precondition');
    const failing = { subscribeToCollectionWithMetadata: () => throwError(() => failure) };

    const subscription = openCappedFeed<Doc>(failing, 'p', QUERY, { capped: true, what: 'ledger', log: '[Test]' }, feed => heard.push(feed));

    expect(subscription).toBeNull();
    expect(heard).toEqual([{ ...UNHEARD, docs: [], incomplete: true }]);
  });

  it('hears nothing more once unsubscribed', () => {
    const subscription = open(true);
    expect(subscription).not.toBeNull();

    subscription!.unsubscribe();
    answer([{ id: 'late' }]);

    expect(heard).toEqual([]);
    expect(subject.observed).toBeFalse();
  });
});
