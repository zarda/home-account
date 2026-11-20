import { Injectable, NgZone, inject } from '@angular/core';
import { Transaction } from '../../models';
import { AnnouncerService } from './announcer.service';
import { AuthService } from './auth.service';
import { ActionNotice, NotificationService } from './notification.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { quotedTransactionName } from '../utils/transaction-display.utils';

/** How long a deleted transaction's Undo is offered, not counting the time the notice is held. */
export const UNDO_WINDOW_MS = 10_000;

/** The longest a sign-out waits for the deletes it makes real (flushBeforeSignOut). */
export const SIGN_OUT_WAIT_MS = 5_000;

/**
 * How a deferred delete ended: taken back by Undo, carried out, failed, or
 * dropped because the account it was asked for is no longer the one signed
 * in (nobody, or someone else), so there was no one to delete it for and no
 * one to tell.
 */
export type PendingDeleteOutcome = 'undone' | 'deleted' | 'failed' | 'signed-out';

/** The one delete waiting for its window to end. */
interface Pending {
  readonly id: string;
  /** The account signed in when the delete was asked for. */
  readonly owner: string | null;
  /** The row as the notices name it, in the reader's own quotation marks. */
  readonly name: string;
  readonly notice: ActionNotice;
  readonly settle: (outcome: PendingDeleteOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** When the running timer ends (epoch ms). */
  deadline: number;
  /** What is left of the window while the timer stands still. */
  remainingMs: number;
}

/**
 * A transaction delete that waits out an Undo window before it is real.
 *
 * Undo is a deferred delete, not a restore: `TransactionService.deleteTransaction`
 * sweeps receipt objects, backs a goal link out and removes household copies,
 * none of which writing the row again could put back. So nothing is touched
 * until the window ends, and Undo only tells the caller to show the row
 * again. The caller hides the row meanwhile, and brings it back if its
 * delete fails; the error notice that names it is opened here, wherever the
 * reader is by then, once no Undo notice is up (reportFailures).
 *
 * One delete waits at a time; deferring a second makes the first real. A
 * flush takes the waiting delete synchronously, takes its notice down and
 * only then deletes, so two triggers arriving together delete once (twice
 * would count the receipts out twice), and an Undo pressed after a flush
 * began finds nothing to take back. Every handler a notice is given acts
 * only while its own delete is the one waiting: a notice that leaves late,
 * after the next one has opened, cannot flush the next delete.
 *
 * The window is this service's own timer, not the notice's duration: it
 * stands still while the notice is hovered or focused and runs out what was
 * left once it is let go. A notice that leaves the screen for any other
 * reason than its Undo (another notice took its place) makes the delete
 * real, since its Undo can no longer be reached.
 *
 * The caller flushes on leaving the page and when the page is hidden; the
 * three sign-out doors flush too, and wait (flushBeforeSignOut). A flush
 * finds the account the delete was asked for still signed in or deletes
 * nothing, quietly.
 */
@Injectable({ providedIn: 'root' })
export class PendingDeleteService {
  private transactions = inject(TransactionService);
  private notifications = inject(NotificationService);
  private auth = inject(AuthService);
  private announcer = inject(AnnouncerService);
  private translation = inject(TranslationService);
  private zone = inject(NgZone);

  private pending: Pending | null = null;
  /** The outcome of every delete deferred and not yet settled, by row id. */
  private readonly unsettled = new Map<string, Promise<PendingDeleteOutcome>>();
  /** Deletes running now; a flush resolves once they have all settled. */
  private readonly running = new Set<Promise<void>>();
  /** Deletes that failed and are not yet told (reportFailures), oldest first. */
  private readonly failed: Pick<Pending, 'owner' | 'name'>[] = [];

  /**
   * Hides nothing itself: opens the Undo notice for the row and starts its
   * window, after making any delete already waiting real. Resolves with how
   * the delete ended. A row already on its way gets no second notice; its
   * outcome is handed back again.
   */
  defer(transaction: Pick<Transaction, 'id' | 'description'>): Promise<PendingDeleteOutcome> {
    const known = this.unsettled.get(transaction.id);
    if (known) return known;

    void this.flush();

    const name = quotedTransactionName(transaction.description, (key, params) => this.translation.t(key, params));
    const undo = this.translation.t('common.undo');
    const notice = this.notifications.withAction(
      this.translation.t('transactions.deleted', { description: name }),
      undo,
      // Heard in place of the message: a screen reader is told the Undo is
      // there, as a sighted reader sees it beside the message.
      { announcement: this.translation.t('transactions.deletedWithUndo', { description: name, action: undo }) }
    );
    let settle!: (outcome: PendingDeleteOutcome) => void;
    const outcome = new Promise<PendingDeleteOutcome>(resolve => (settle = resolve));
    const record: Pending = {
      id: transaction.id,
      owner: this.auth.userId(),
      name,
      notice,
      settle: result => {
        this.unsettled.delete(transaction.id);
        settle(result);
      },
      timer: null,
      deadline: 0,
      remainingMs: UNDO_WINDOW_MS,
    };
    this.pending = record;
    this.unsettled.set(transaction.id, outcome);

    notice.onAction(() => {
      if (this.pending === record) this.takeBack(record);
    });
    notice.afterDismissed(byAction => {
      if (!byAction && this.pending === record) this.finish(record);
    });
    notice.onHold(held => {
      if (this.pending !== record) return;
      if (held) this.pause(record);
      else this.run(record);
    });
    this.run(record);
    return outcome;
  }

  /**
   * Takes back the delete of the row with this id while it still waits:
   * true when it did. False once a flush has begun, since by then the delete
   * is on its way, and for any other row.
   */
  undo(id: string): boolean {
    const record = this.pending;
    if (!record || record.id !== id) return false;
    this.takeBack(record);
    return true;
  }

  /**
   * Makes the waiting delete real now, and resolves once every delete
   * running has settled, so a sign-out door that awaits it signs out after
   * the delete, never in the middle of it.
   */
  flush(): Promise<void> {
    if (this.pending) this.finish(this.pending);
    return Promise.all(this.running).then(() => undefined);
  }

  /**
   * flush(), for a door that signs out: the delete waiting is made real and
   * the sign-out waits for the deletes running to settle, so none is cut off
   * half done, but for SIGN_OUT_WAIT_MS at most. A delete made offline
   * settles only once the connection returns, and a sign-out must never wait
   * on that: on the lock screen it is the one way off the screen.
   *
   * The page stays in use meanwhile, so a delete confirmed during the wait is
   * made real and waited for too, within the same time: left waiting, it
   * would meet nobody signed in once the sign-out lands, and never run.
   */
  flushBeforeSignOut(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waited = false;
    const waitedEnough = new Promise<void>(resolve => (timer = setTimeout(() => {
      waited = true;
      resolve();
    }, SIGN_OUT_WAIT_MS)));
    const drain = (): Promise<void> =>
      this.flush().then(() => (this.pending && !waited ? drain() : undefined));
    return Promise.race([drain(), waitedEnough]).finally(() => clearTimeout(timer));
  }

  private takeBack(record: Pending): void {
    this.pending = null;
    this.stop(record);
    record.notice.dismiss();
    record.settle('undone');
    this.announcer.announce(this.translation.t('transactions.restored', { description: record.name }), 'polite');
    this.reportFailures();
  }

  private finish(record: Pending): void {
    this.pending = null;
    this.stop(record);
    record.notice.dismiss();

    const signedIn = this.auth.userId();
    if (signedIn === null || signedIn !== record.owner) {
      record.settle('signed-out');
      return;
    }

    const running = this.transactions.deleteTransaction(record.id).then(
      () => record.settle('deleted'),
      error => {
        console.error('[PendingDelete] Delete failed:', error);
        record.settle('failed');
        this.failed.push({ owner: record.owner, name: record.name });
        this.reportFailures();
      }
    );
    this.running.add(running);
    void running.then(() => this.running.delete(running));
    // Its notice is down: a failure held back for it can be told now.
    this.reportFailures();
  }

  /**
   * Names each row whose delete failed in the error notice, but only once no
   * Undo notice is up. A failure arrives late, up to a window after its
   * confirm, and by then the next row's notice may be the one on screen: an
   * error notice opened over it would take it down, and a notice that leaves
   * for any reason but its Undo makes its delete real, so one row's failure
   * would delete the next row with no Undo, under a notice the reader would
   * take to be about that row. Looked at a turn later, so a flush that a
   * defer starts, just before it opens its own notice, is not taken for the
   * last notice going. A failure is told only to the account it was asked
   * for: with nobody, or someone else, signed in by then it is dropped.
   */
  private reportFailures(): void {
    if (this.failed.length === 0) return;
    void Promise.resolve().then(() => {
      if (this.pending) return;
      const signedIn = this.auth.userId();
      for (const { owner, name } of this.failed.splice(0)) {
        if (signedIn === null || signedIn !== owner) continue;
        this.notifications.error(this.translation.t('transactions.deleteFailed', { description: name }));
      }
    });
  }

  /** Starts the timer on what is left of the window. */
  private run(record: Pending): void {
    if (record.timer !== null) return;
    record.deadline = Date.now() + record.remainingMs;
    // Outside Angular, so a waiting delete does not keep the app from
    // reporting itself stable for ten seconds; the delete itself runs inside.
    record.timer = this.zone.runOutsideAngular(() =>
      setTimeout(() => this.zone.run(() => {
        if (this.pending === record) this.finish(record);
      }), record.remainingMs)
    );
  }

  private pause(record: Pending): void {
    if (record.timer === null) return;
    this.stop(record);
    record.remainingMs = Math.max(0, record.deadline - Date.now());
  }

  private stop(record: Pending): void {
    if (record.timer !== null) clearTimeout(record.timer);
    record.timer = null;
  }
}
