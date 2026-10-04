import { Injectable, Signal, computed, inject, linkedSignal, signal } from '@angular/core';

import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { TranslationService } from '../../core/services/translation.service';
import { DashboardCardId, DashboardLayout, effectiveDashboardLayout } from '../../models';
import {
  LayoutField,
  layoutWrite,
  moveVisible as moveAmongVisible,
  sameLayout,
  setCardHidden
} from './dashboard-layout.utils';

/**
 * The account's dashboard arrangement as this session shows it, which the
 * dashboard and the settings editor both render, and its one save: every
 * change goes through it, so no two writes of the arrangement race.
 *
 * A change shows at once. While a save is out the layout is held, because a
 * write of this session's own lands reporting an older layout than the one
 * already shown, and an unrelated preference write replaces the whole user
 * object. Saves go out one at a time: a change made during one waits, and
 * every field changed meanwhile goes in the next write together. Each write
 * is the smallest one that stores the change (`layoutWrite`), so a field
 * another device set is not sent back over it.
 *
 * Every call returns the promise of the save run it joined, which resolves
 * once that run's last write lands. A failed write ends the run: the changes
 * queued behind it were built on it and are dropped, the layout falls back to
 * the account's once, one snackbar says so, and every caller's promise
 * rejects so each can undo what it showed.
 *
 * The service outlives the account: signing out and in again on the page
 * does not reload it. A write still out when the account changes neither
 * lands nor fails while another account is signed in, since the SDK settles
 * a write only for the user who made it. So the hold and the run belong to
 * the account they were made for: the next account's layout shows at once,
 * nothing the previous one queued is sent, and the next account's first
 * change starts a run of its own.
 */
@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
  private auth = inject(AuthService);
  private notifications = inject(NotificationService);
  private translation = inject(TranslationService);

  // Compared by structure: a preference write anywhere replaces the user object.
  private accountLayout = computed(
    () => effectiveDashboardLayout(this.auth.currentUser()?.preferences),
    { equal: sameLayout }
  );

  private readonly uid = computed(() => this.auth.currentUser()?.id ?? null);

  /**
   * Moves on with each change of account. It is read whenever the layout is,
   * so an account shown in between counts even when the first one signs in
   * again.
   */
  private readonly generation = linkedSignal<string | null, number>({
    source: this.uid,
    computation: (_uid, previous) => (previous === undefined ? 0 : previous.value + 1),
  });

  /** The generation the save now out was made in; null while none is out. */
  private readonly savingIn = signal<number | null>(null);

  // The signal itself is the source, not a boolean derived from it: a save
  // that starts and ends unread must still end the hold.
  private readonly held = linkedSignal<
    { account: DashboardLayout; savingIn: number | null; generation: number },
    DashboardLayout
  >({
    source: () => ({ account: this.accountLayout(), savingIn: this.savingIn(), generation: this.generation() }),
    // Held only for the account the save was made for.
    computation: ({ account, savingIn, generation }, previous) =>
      savingIn === generation && previous ? previous.value : account,
  });

  /** What to render: the account's layout, or while saving, the latest change. */
  readonly layout: Signal<DashboardLayout> = this.held.asReadonly();

  private draining = false;
  private run: Promise<void> = Promise.resolve();
  private queuedFields = new Set<LayoutField>();
  private resetQueued = false;
  /** The generation the queue and the run belong to. */
  private queueGeneration = 0;

  hide(id: DashboardCardId): Promise<void> {
    return this.change(setCardHidden(this.held(), id, true), 'hidden');
  }

  show(id: DashboardCardId): Promise<void> {
    return this.change(setCardHidden(this.held(), id, false), 'hidden');
  }

  /** One step past the next card in `visible`, the cards the caller renders. */
  moveVisible(id: DashboardCardId, delta: -1 | 1, visible: readonly DashboardCardId[]): Promise<void> {
    return this.change(moveAmongVisible(this.held(), id, delta, visible), 'order');
  }

  /** The order a drag-and-drop leaves behind. */
  setOrder(order: readonly DashboardCardId[]): Promise<void> {
    const layout = this.held();
    const same = order.length === layout.order.length && order.every((id, i) => id === layout.order[i]);
    return this.change(same ? layout : { ...layout, order: [...order] }, 'order');
  }

  /**
   * Deletes the key rather than writing today's default, so a reset account
   * follows whatever default a later build ships. A field change still
   * queued is superseded; one made after this is written on top.
   */
  reset(): Promise<void> {
    this.followAccount();
    this.held.set(effectiveDashboardLayout(undefined));
    this.queuedFields.clear();
    this.resetQueued = true;
    return this.save();
  }

  private change(next: DashboardLayout, field: LayoutField): Promise<void> {
    this.followAccount();
    if (next === this.held()) {
      return this.draining ? this.run : Promise.resolve();
    }
    this.held.set(next);
    this.queuedFields.add(field);
    return this.save();
  }

  private save(): Promise<void> {
    if (!this.draining) {
      this.run = this.drain();
      // The snackbar is the failure's one report: a caller that ignores the
      // rejection must not also reach the global error handler.
      this.run.catch(() => undefined);
    }
    return this.run;
  }

  private async drain(): Promise<void> {
    const generation = this.generation();
    const current = () => this.generation() === generation;

    this.draining = true;
    this.savingIn.set(generation);
    try {
      while (current() && (this.resetQueued || this.queuedFields.size > 0)) {
        await this.writeQueued();
      }
    } catch (error) {
      // The previous account's failure is not this account's to report.
      if (current()) {
        this.resetQueued = false;
        this.queuedFields.clear();
        this.notifications.error(this.translation.t('settings.dashboardLayoutSaveFailed'));
      }
      throw error;
    } finally {
      // Ends the hold, so the layout becomes the account's again. A run left
      // behind by a change of account leaves the next one's alone.
      if (generation === this.queueGeneration) {
        this.draining = false;
        this.savingIn.set(null);
      }
    }
  }

  /**
   * Run by every change before it is queued. A change made for another
   * account than the queue's starts over: what the previous account queued
   * is dropped unsent, and its run, still waiting on a write, is left behind.
   */
  private followAccount(): void {
    const generation = this.generation();
    if (generation === this.queueGeneration) return;
    this.queueGeneration = generation;
    this.queuedFields.clear();
    this.resetQueued = false;
    this.draining = false;
    this.savingIn.set(null);
  }

  /**
   * Judged against the stored value as this session last read it, which
   * already includes every earlier write of this run.
   */
  private async writeQueued(): Promise<void> {
    if (this.resetQueued) {
      this.resetQueued = false;
      await this.auth.clearUserPreferences(['dashboardLayout']);
      return;
    }

    const touched = new Set(this.queuedFields);
    this.queuedFields.clear();
    const write = layoutWrite(this.auth.currentUser()?.preferences?.dashboardLayout, this.held(), touched);
    if (write.kind === 'whole') {
      await this.auth.updateUserPreferences({ dashboardLayout: write.layout });
    } else if (Object.keys(write.fields).length > 0) {
      await this.auth.updatePreferenceFields('dashboardLayout', write.fields);
    }
  }
}
