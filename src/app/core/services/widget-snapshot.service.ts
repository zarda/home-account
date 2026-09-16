import { Injectable, Injector, effect, inject, untracked } from '@angular/core';

import { AuthService } from './auth.service';
import { AppLockService } from './app-lock.service';
import { CurrencyService } from './currency.service';
import { LocaleFormatService } from './locale-format.service';
import { TranslationService } from './translation.service';
import { WIDGET_SNAPSHOT_PLUGIN, WidgetSnapshotPlugin } from '../plugins/widget-snapshot.plugin';
import {
  Budget,
  WidgetSnapshot,
  WidgetSnapshotFigures,
  WidgetSnapshotInput,
  WidgetSnapshotState,
  WidgetSnapshotTopBudget,
} from '../../models';

/**
 * Writes what the iOS home-screen widget shows: the figures the dashboard last
 * painted for this month, or labels alone when the lock can engage or nobody
 * is signed in, so nothing a lock hides reaches the home screen.
 *
 * The formatters are resolved through the injector on the write path only.
 * On the web the plugin token is `null`, nothing is written, and this service —
 * constructed at startup — must not be what constructs `CurrencyService`, whose
 * constructor fetches rates.
 */
@Injectable({ providedIn: 'root' })
export class WidgetSnapshotService {
  private readonly plugin = inject(WIDGET_SNAPSHOT_PLUGIN);
  private readonly auth = inject(AuthService);
  private readonly appLock = inject(AppLockService);
  private readonly injector = inject(Injector);

  /**
   * The last payload the plugin accepted, without `writtenAt`. Equal payloads
   * are not rewritten, so a listener's re-emission does not reload the widget's
   * timelines; the `updated` label carries the local date, so a new day still
   * writes.
   */
  private lastWritten: string | null = null;

  constructor() {
    // Written at once rather than at the next paint: a cold start that lands
    // on /lock never paints the dashboard, and last session's figures would
    // stay on the home screen.
    effect(() => {
      const plugin = this.plugin;
      if (!plugin || !this.appLock.canEngage()) return;
      untracked(() => this.writeIfChanged(plugin, this.compose('locked', new Date())));
    });

    // Never while auth is loading: a cold start has no user until the session
    // is restored, and that must not wipe the figures of an account that is
    // still signed in.
    effect(() => {
      const plugin = this.plugin;
      if (!plugin || this.auth.isLoading() || this.auth.currentUser() !== null) return;
      untracked(() => this.writeIfChanged(plugin, this.compose('signedOut', new Date())));
    });
  }

  publish(input: WidgetSnapshotInput): void {
    const plugin = this.plugin;
    if (!plugin) return;

    // Untracked so a calling effect stays keyed on what it chose to read, not
    // on the lock, the catalog or the locale read while composing.
    untracked(() => {
      const now = input.now ?? new Date();
      const snapshot = this.appLock.canEngage()
        ? this.compose('locked', now)
        : { ...this.compose('figures', now), figures: this.figures(input) };
      this.writeIfChanged(plugin, snapshot);
    });
  }

  private compose(state: WidgetSnapshotState, now: Date): WidgetSnapshot {
    const translation = this.injector.get(TranslationService);
    const localeFormat = this.injector.get(LocaleFormatService);
    const month = String(now.getMonth() + 1).padStart(2, '0');

    return {
      version: 1,
      state,
      writtenAt: now.getTime(),
      monthKey: `${now.getFullYear()}-${month}`,
      labels: {
        title: translation.t('dashboard.thisMonth'),
        spent: translation.t('widget.spent'),
        net: translation.t('common.netBalance'),
        topBudget: translation.t('widget.topBudget'),
        nextScheduled: translation.t('widget.nextScheduled'),
        noBudgets: translation.t('widget.noBudgets'),
        nothingScheduled: translation.t('dashboard.noUpcomingBills'),
        locked: translation.t('widget.locked'),
        signedOut: translation.t('widget.signedOut'),
        stale: translation.t('widget.stale'),
        updated: translation.t('widget.updated', { date: localeFormat.formatDate(now, 'medium') }),
      },
    };
  }

  private figures(input: WidgetSnapshotInput): WidgetSnapshotFigures {
    const currency = this.injector.get(CurrencyService);
    const localeFormat = this.injector.get(LocaleFormatService);
    const next = input.upcoming[0];

    return {
      spent: currency.formatCurrency(input.spent, input.baseCurrency),
      net: currency.formatCurrency(input.net, input.baseCurrency),
      topBudget: this.topBudget(input.budgets),
      nextScheduled: next
        ? {
            name: next.name,
            date: localeFormat.formatDate(next.date, 'medium'),
            amount: currency.formatCurrency(
              next.type === 'expense' ? -next.amount : next.amount,
              next.currency
            ),
          }
        : null,
    };
  }

  /**
   * The budget card's utilisation, `spent / amount * 100`. A zero-amount
   * budget has none to rank, and a tie keeps the earlier budget.
   */
  private topBudget(budgets: Budget[]): WidgetSnapshotTopBudget | null {
    let top: { budget: Budget; percent: number } | null = null;
    for (const budget of budgets) {
      if (!budget.isActive || !(budget.amount > 0)) continue;
      const percent = (budget.spent / budget.amount) * 100;
      if (!Number.isFinite(percent)) continue;
      if (!top || percent > top.percent) top = { budget, percent };
    }
    if (!top) return null;

    const currency = this.injector.get(CurrencyService);
    const translation = this.injector.get(TranslationService);
    const { budget } = top;
    return {
      name: budget.name,
      percent: Math.round(top.percent),
      detail: translation.t('widget.budgetDetail', {
        spent: currency.formatCurrency(budget.spent, budget.currency),
        limit: currency.formatCurrency(budget.amount, budget.currency),
      }),
    };
  }

  /**
   * Recorded only once the write resolves. A rejection ('invalid',
   * 'unavailable') is swallowed without a retry or a console line: the widget
   * keeps its last readable file, and the next publish tries again.
   */
  private writeIfChanged(plugin: WidgetSnapshotPlugin, snapshot: WidgetSnapshot): void {
    const content = JSON.stringify({ ...snapshot, writtenAt: undefined });
    if (content === this.lastWritten) return;

    plugin
      .write({ snapshot: JSON.stringify(snapshot) })
      .then(() => {
        this.lastWritten = content;
      })
      .catch(() => undefined);
  }
}
