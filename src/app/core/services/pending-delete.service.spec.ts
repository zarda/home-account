import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PendingDeleteOutcome, PendingDeleteService, SIGN_OUT_WAIT_MS, UNDO_WINDOW_MS } from './pending-delete.service';
import { NotificationService } from './notification.service';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { AnnouncerService } from './announcer.service';
import { TranslationService } from './translation.service';
import { FakeNotice, catalogTranslator, createTransaction } from './testing';
import { quotedTransactionName } from '../utils/transaction-display.utils';

/**
 * Echoes a key and its params, and quotes a name as tc does, so the notice
 * can be seen to carry the description in the reader's own quotation marks.
 */
function t(key: string, params?: Record<string, string | number>): string {
  if (key === 'common.quotedName') return `「${params?.['name']}」`;
  return params ? `${key}:${JSON.stringify(params)}` : key;
}

/** Lets every settled promise run its callbacks without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('PendingDeleteService', () => {
  let service: PendingDeleteService;
  let notices: FakeNotice[];
  let withAction: jasmine.Spy;
  let notificationError: jasmine.Spy;
  let deleteTransaction: jasmine.Spy<(id: string) => Promise<void>>;
  let announce: jasmine.Spy;
  let userId: ReturnType<typeof signal<string | null>>;

  const coffee = createTransaction({ id: 'txn-coffee', description: 'Coffee' });
  const rent = createTransaction({ id: 'txn-rent', description: 'Rent' });

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 10, 19, 9, 0, 0));

    notices = [];
    withAction = jasmine.createSpy('withAction').and.callFake((message: string, action: string) => {
      const notice = new FakeNotice(message, action);
      notices.push(notice);
      return notice;
    });
    notificationError = jasmine.createSpy('error');
    deleteTransaction = jasmine.createSpy('deleteTransaction').and.resolveTo();
    announce = jasmine.createSpy('announce');
    userId = signal<string | null>('user-1');

    TestBed.configureTestingModule({
      providers: [
        { provide: NotificationService, useValue: { withAction, error: notificationError } },
        { provide: TransactionService, useValue: { deleteTransaction } },
        { provide: AuthService, useValue: { userId } },
        { provide: AnnouncerService, useValue: { announce } },
        { provide: TranslationService, useValue: { t } },
      ],
    });
    service = TestBed.inject(PendingDeleteService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  /** Defers a row and keeps its outcome as it lands. */
  function deferred(row = coffee): { outcome: Promise<PendingDeleteOutcome>; landed: () => PendingDeleteOutcome | null } {
    let landed: PendingDeleteOutcome | null = null;
    const outcome = service.defer(row);
    void outcome.then(value => (landed = value));
    return { outcome, landed: () => landed };
  }

  it('opens the undo notice naming the row in quotation marks, and deletes once ten seconds have passed', async () => {
    const { outcome, landed } = deferred();

    expect(UNDO_WINDOW_MS).toBe(10_000);
    expect(withAction).toHaveBeenCalledOnceWith(
      t('transactions.deleted', { description: '「Coffee」' }),
      'common.undo',
      { announcement: t('transactions.deletedWithUndo', { description: '「Coffee」', action: 'common.undo' }) }
    );
    // The snack bar's own live region, which would read the button out with
    // the message, is quiet: what a screen reader hears must name the action.
    const [, action, { announcement }] = withAction.calls.mostRecent().args;
    expect(announcement).withContext('the spoken text names the action').toContain(action);

    jasmine.clock().tick(UNDO_WINDOW_MS - 1);
    await settle();
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(landed()).toBeNull();

    jasmine.clock().tick(1);
    expect(deleteTransaction).toHaveBeenCalledOnceWith('txn-coffee');
    expect(notices[0].dismissCalls).withContext('the notice is taken down as the delete starts').toBe(1);
    await expectAsync(outcome).toBeResolvedTo('deleted');
  });

  it('names an untitled row by the catalog\'s words, bare', () => {
    service.defer(createTransaction({ id: 'txn-blank', description: '  ' }));

    expect(withAction).toHaveBeenCalledOnceWith(
      t('transactions.deleted', { description: 'transactions.untitledRow' }),
      'common.undo',
      { announcement: t('transactions.deletedWithUndo', { description: 'transactions.untitledRow', action: 'common.undo' }) }
    );
  });

  it('takes the delete back on Undo inside the window, deletes nothing and says the row is back', async () => {
    const { outcome } = deferred();
    jasmine.clock().tick(4000);

    notices[0].press();

    await expectAsync(outcome).toBeResolvedTo('undone');
    expect(announce).toHaveBeenCalledOnceWith(
      t('transactions.restored', { description: '「Coffee」' }),
      'polite'
    );
    jasmine.clock().tick(60_000);
    await settle();
    expect(deleteTransaction).not.toHaveBeenCalled();
    await expectAsync(service.flush()).toBeResolved();
    expect(deleteTransaction).not.toHaveBeenCalled();
  });

  it('answers undo(id) true inside the window and takes the notice down', async () => {
    const { outcome } = deferred();

    expect(service.undo('txn-rent')).withContext('another row is not the one waiting').toBe(false);
    expect(service.undo('txn-coffee')).toBe(true);

    expect(notices[0].dismissCalls).toBe(1);
    await expectAsync(outcome).toBeResolvedTo('undone');
    expect(service.undo('txn-coffee')).withContext('nothing is waiting any more').toBe(false);
    jasmine.clock().tick(UNDO_WINDOW_MS);
    expect(deleteTransaction).not.toHaveBeenCalled();
  });

  it('deletes once when two flush triggers land together', async () => {
    const { outcome } = deferred();

    const first = service.flush();
    const second = service.flush();
    // The window's end and the notice's own dismissal, arriving after the
    // flush, find nothing left to delete.
    jasmine.clock().tick(UNDO_WINDOW_MS);
    notices[0].left();

    await Promise.all([first, second]);
    expect(deleteTransaction).toHaveBeenCalledTimes(1);
    await expectAsync(outcome).toBeResolvedTo('deleted');
  });

  it('resolves every flush only once the delete it started has settled', async () => {
    let finish!: () => void;
    deleteTransaction.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
    deferred();

    let firstDone = false;
    let secondDone = false;
    void service.flush().then(() => (firstDone = true));
    void service.flush().then(() => (secondDone = true));
    await settle();
    expect(deleteTransaction).toHaveBeenCalledTimes(1);
    expect(firstDone).toBe(false);
    expect(secondDone).withContext('a door that flushes while the delete runs waits for it too').toBe(false);

    finish();
    await settle();
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
  });

  it('answers Undo after a flush began with false and restores nothing', async () => {
    let finish!: () => void;
    deleteTransaction.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
    const { outcome, landed } = deferred();

    void service.flush();

    expect(service.undo('txn-coffee')).toBe(false);
    notices[0].press();
    await settle();
    expect(landed()).withContext('an Undo pressed as the delete runs takes nothing back').toBeNull();
    expect(announce).not.toHaveBeenCalled();

    finish();
    await expectAsync(outcome).toBeResolvedTo('deleted');
    expect(deleteTransaction).toHaveBeenCalledTimes(1);
  });

  it('flushes the first pending delete when a second is deferred, and gives the second its own window', async () => {
    const first = deferred(coffee);
    jasmine.clock().tick(3000);

    const second = deferred(rent);

    expect(deleteTransaction).toHaveBeenCalledOnceWith('txn-coffee');
    expect(notices[0].dismissCalls).toBe(1);
    expect(notices.length).toBe(2);
    await expectAsync(first.outcome).toBeResolvedTo('deleted');

    jasmine.clock().tick(UNDO_WINDOW_MS - 1);
    expect(deleteTransaction).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(1);
    expect(deleteTransaction).toHaveBeenCalledWith('txn-rent');
    await expectAsync(second.outcome).toBeResolvedTo('deleted');
  });

  it('lets no handler of an earlier notice reach the delete waiting now', async () => {
    deferred(coffee);
    const second = deferred(rent);
    expect(deleteTransaction).toHaveBeenCalledOnceWith('txn-coffee');

    // The first notice reports that it has left only now, after the second
    // has opened, as Material does; then its action, pressed late.
    notices[0].left();
    notices[0].press();
    notices[0].hold(true);
    await settle();

    expect(deleteTransaction).toHaveBeenCalledTimes(1);
    expect(second.landed()).toBeNull();
    expect(announce).not.toHaveBeenCalled();

    // Nor did the first notice's hold stop the second's window.
    jasmine.clock().tick(UNDO_WINDOW_MS);
    expect(deleteTransaction).toHaveBeenCalledWith('txn-rent');
    await expectAsync(second.outcome).toBeResolvedTo('deleted');
  });

  it('flushes when its notice leaves the screen for any other reason than Undo', async () => {
    const { outcome } = deferred();
    jasmine.clock().tick(2000);

    // Another notice took its place: Undo cannot be reached any more.
    notices[0].left(false);

    expect(deleteTransaction).toHaveBeenCalledOnceWith('txn-coffee');
    await expectAsync(outcome).toBeResolvedTo('deleted');
  });

  it('holds the window while the notice is hovered or focused, and runs out what was left once released', async () => {
    deferred();
    jasmine.clock().tick(4000);

    notices[0].hold(true);
    jasmine.clock().tick(60_000);
    expect(deleteTransaction).not.toHaveBeenCalled();

    notices[0].hold(false);
    jasmine.clock().tick(UNDO_WINDOW_MS - 4000 - 1);
    expect(deleteTransaction).not.toHaveBeenCalled();

    // Held again with a moment left, and released again.
    notices[0].hold(true);
    jasmine.clock().tick(30_000);
    expect(deleteTransaction).not.toHaveBeenCalled();
    notices[0].hold(false);
    jasmine.clock().tick(1);
    expect(deleteTransaction).toHaveBeenCalledOnceWith('txn-coffee');
  });

  it('flushes quietly with nobody signed in', async () => {
    const consoleError = spyOn(console, 'error');
    const { outcome } = deferred();

    userId.set(null);
    await service.flush();

    expect(deleteTransaction).not.toHaveBeenCalled();
    await expectAsync(outcome).toBeResolvedTo('signed-out');
    expect(notices[0].dismissCalls).toBe(1);
    expect(notificationError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('never deletes for an account that signed in after the delete was asked for', async () => {
    const { outcome } = deferred();

    userId.set('user-2');
    jasmine.clock().tick(UNDO_WINDOW_MS);

    expect(deleteTransaction).not.toHaveBeenCalled();
    await expectAsync(outcome).toBeResolvedTo('signed-out');
  });

  describe('a failed delete, while the next row\'s Undo is up', () => {
    let fail: (error: Error) => void;

    beforeEach(() => {
      spyOn(console, 'error');
      // The first row's delete is still out when the second row is deferred.
      deleteTransaction.and.callFake((id: string) =>
        id === coffee.id ? new Promise<void>((_, reject) => (fail = reject)) : Promise.resolve()
      );
    });

    // Opened over the second notice, the error would take it down, and a
    // notice that leaves for any reason but its Undo makes its delete real.
    it('leaves that notice up and its delete waiting, and names the failed row once its window has run out', async () => {
      const first = deferred(coffee);
      const second = deferred(rent);

      fail(new Error('permission-denied'));
      await expectAsync(first.outcome).toBeResolvedTo('failed');
      await settle();
      expect(notificationError).withContext('while the second notice is up').not.toHaveBeenCalled();
      expect(notices[1].dismissCalls).toBe(0);
      expect(deleteTransaction).not.toHaveBeenCalledWith(rent.id);

      jasmine.clock().tick(UNDO_WINDOW_MS);
      await expectAsync(second.outcome).toBeResolvedTo('deleted');
      await settle();
      expect(notificationError).toHaveBeenCalledOnceWith(t('transactions.deleteFailed', { description: '「Coffee」' }));
    });

    it('names the failed row once the next one is taken back', async () => {
      deferred(coffee);
      const second = deferred(rent);
      fail(new Error('permission-denied'));
      await settle();

      notices[1].press();
      await expectAsync(second.outcome).toBeResolvedTo('undone');
      await settle();

      expect(notificationError).toHaveBeenCalledOnceWith(t('transactions.deleteFailed', { description: '「Coffee」' }));
      expect(deleteTransaction).not.toHaveBeenCalledWith(rent.id);
    });

    it('holds it through a third row deferred as the second is made real', async () => {
      deferred(coffee);
      deferred(rent);
      fail(new Error('permission-denied'));
      await settle();

      const third = deferred(createTransaction({ id: 'txn-tea', description: 'Tea' }));
      await settle();
      expect(notificationError).withContext('while the third notice is up').not.toHaveBeenCalled();
      expect(notices[2].dismissCalls).toBe(0);

      jasmine.clock().tick(UNDO_WINDOW_MS);
      await expectAsync(third.outcome).toBeResolvedTo('deleted');
      await settle();
      expect(notificationError).toHaveBeenCalledOnceWith(t('transactions.deleteFailed', { description: '「Coffee」' }));
    });
  });

  it('names no failed row to an account that is no longer the one signed in', async () => {
    spyOn(console, 'error');
    let fail!: (error: Error) => void;
    deleteTransaction.and.returnValue(new Promise<void>((_, reject) => (fail = reject)));
    const { outcome } = deferred();
    void service.flush();

    userId.set(null);
    fail(new Error('permission-denied'));

    await expectAsync(outcome).toBeResolvedTo('failed');
    await settle();
    expect(notificationError).not.toHaveBeenCalled();
  });

  it('reports a delete that failed as failed, logs why and names the row in the error notice', async () => {
    const consoleError = spyOn(console, 'error');
    const failure = new Error('permission-denied');
    deleteTransaction.and.rejectWith(failure);
    const { outcome } = deferred();

    jasmine.clock().tick(UNDO_WINDOW_MS);

    await expectAsync(outcome).toBeResolvedTo('failed');
    expect(consoleError).toHaveBeenCalledWith(jasmine.any(String), failure);
    await settle();
    expect(notificationError).toHaveBeenCalledOnceWith(t('transactions.deleteFailed', { description: '「Coffee」' }));
    await expectAsync(service.flush()).toBeResolved();
  });

  describe('before a sign-out', () => {
    it('makes the waiting delete real and waits for it to settle', async () => {
      let finish!: () => void;
      deleteTransaction.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
      const { outcome } = deferred();

      let done = false;
      void service.flushBeforeSignOut().then(() => (done = true));
      await settle();
      expect(deleteTransaction).toHaveBeenCalledOnceWith(coffee.id);
      expect(done).withContext('while the delete runs').toBe(false);

      finish();
      await settle();
      expect(done).toBe(true);
      await expectAsync(outcome).toBeResolvedTo('deleted');
    });

    it('signs out after SIGN_OUT_WAIT_MS at most, when the delete does not settle (offline)', async () => {
      deleteTransaction.and.returnValue(new Promise<void>(() => undefined));
      deferred();

      let done = false;
      void service.flushBeforeSignOut().then(() => (done = true));
      await settle();
      jasmine.clock().tick(SIGN_OUT_WAIT_MS - 1);
      await settle();
      expect(done).withContext('just before the wait runs out').toBe(false);

      jasmine.clock().tick(1);
      await settle();
      expect(done).toBe(true);
      expect(deleteTransaction).toHaveBeenCalledTimes(1);
    });

    it('waits for nothing when no delete waits or runs', async () => {
      let done = false;
      void service.flushBeforeSignOut().then(() => (done = true));
      await settle();

      expect(done).toBe(true);
      expect(deleteTransaction).not.toHaveBeenCalled();
    });

    // The page stays in use while the sign-out waits: a row deleted then
    // would otherwise still wait when the sign-out lands, and be dropped
    // with nobody signed in, never deleted.
    it('makes real a delete confirmed while it waits, and waits for that one too', async () => {
      const finishes = new Map<string, () => void>();
      deleteTransaction.and.callFake(id => new Promise<void>(resolve => finishes.set(id, resolve)));
      deferred(coffee);

      let done = false;
      void service.flushBeforeSignOut().then(() => (done = true));
      await settle();
      expect(deleteTransaction).toHaveBeenCalledOnceWith(coffee.id);

      const { outcome } = deferred(rent);
      finishes.get(coffee.id)!();
      await settle();
      expect(deleteTransaction).withContext('the row deleted during the wait').toHaveBeenCalledWith(rent.id);
      expect(done).withContext('while that delete runs').toBe(false);

      finishes.get(rent.id)!();
      await settle();
      expect(done).toBe(true);
      await expectAsync(outcome).toBeResolvedTo('deleted');
    });

    it('waits SIGN_OUT_WAIT_MS at most in all, for a delete confirmed while it waits too', async () => {
      const finishes = new Map<string, () => void>();
      deleteTransaction.and.callFake(id => new Promise<void>(resolve => finishes.set(id, resolve)));
      deferred(coffee);

      let done = false;
      void service.flushBeforeSignOut().then(() => (done = true));
      await settle();
      jasmine.clock().tick(1000);
      deferred(rent);
      finishes.get(coffee.id)!();
      await settle();
      expect(deleteTransaction).toHaveBeenCalledWith(rent.id);

      jasmine.clock().tick(SIGN_OUT_WAIT_MS - 1000 - 1);
      await settle();
      expect(done).withContext('just before the wait runs out').toBe(false);

      jasmine.clock().tick(1);
      await settle();
      expect(done).withContext('the wait counted from the sign-out, not from the later delete').toBe(true);
    });
  });

  it('opens no second notice for a row already on its way, and hands back the same outcome', async () => {
    let finish!: () => void;
    deleteTransaction.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
    const first = service.defer(coffee);

    expect(service.defer(coffee)).toBe(first);
    void service.flush();
    expect(service.defer(coffee)).withContext('while its delete runs').toBe(first);

    expect(withAction).toHaveBeenCalledTimes(1);
    finish();
    await expectAsync(first).toBeResolvedTo('deleted');
    expect(deleteTransaction).toHaveBeenCalledTimes(1);
  });
});

/**
 * What a screen reader hears of the notice, in each shipped catalog. The
 * echo stub above holds only that the service hands the catalog the button's
 * word; the sentence names it only while every catalog's
 * transactions.deletedWithUndo keeps its {{action}}.
 */
describe('PendingDeleteService, in each catalog', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`names the Undo and the row in what a screen reader hears, in ${locale}`, () => {
      const t = catalogTranslator(locale, { strict: true });
      const withAction = jasmine.createSpy('withAction').and.callFake(
        (message: string, action: string) => new FakeNotice(message, action)
      );
      TestBed.configureTestingModule({
        providers: [
          { provide: NotificationService, useValue: { withAction, error: jasmine.createSpy('error') } },
          { provide: TransactionService, useValue: { deleteTransaction: jasmine.createSpy('deleteTransaction').and.resolveTo() } },
          { provide: AuthService, useValue: { userId: signal<string | null>('user-1') } },
          { provide: AnnouncerService, useValue: { announce: jasmine.createSpy('announce') } },
          { provide: TranslationService, useValue: { t } },
        ],
      });

      TestBed.inject(PendingDeleteService).defer(createTransaction({ id: 'txn-coffee', description: 'Coffee' }));

      const [message, action, { announcement }] = withAction.calls.mostRecent().args;
      expect(action).toBe(t('common.undo'));
      expect(announcement).withContext('the spoken text names the button').toContain(t('common.undo'));
      expect(announcement).withContext('the spoken text names the row').toContain(quotedTransactionName('Coffee', t));
      expect(announcement).withContext('the spoken text says more than the shown message').not.toBe(message);
    });
  }
});
