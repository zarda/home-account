import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { WidgetSnapshotService } from './widget-snapshot.service';
import { AuthService } from './auth.service';
import { AppLockService } from './app-lock.service';
import { CurrencyService } from './currency.service';
import { LocaleFormatService, LocaleDateStyle } from './locale-format.service';
import { TranslationService } from './translation.service';
import { createMockUser } from './testing/mock-auth.service';
import { WIDGET_SNAPSHOT_PLUGIN, WidgetSnapshotPlugin } from '../plugins/widget-snapshot.plugin';
import {
  Budget,
  RecurringOccurrence,
  User,
  WidgetSnapshot,
  WidgetSnapshotInput,
} from '../../models';

type WriteSpy = jasmine.Spy<WidgetSnapshotPlugin['write']>;

const LABELS_BY_KEY = {
  title: 'dashboard.thisMonth',
  spent: 'widget.spent',
  net: 'common.netBalance',
  topBudget: 'widget.topBudget',
  nextScheduled: 'widget.nextScheduled',
  noBudgets: 'widget.noBudgets',
  nothingScheduled: 'dashboard.noUpcomingBills',
  locked: 'widget.locked',
  signedOut: 'widget.signedOut',
  stale: 'widget.stale',
};

function budget(overrides: Partial<Budget>): Budget {
  const at = Timestamp.fromDate(new Date(2026, 8, 1));
  return {
    id: 'budget-1',
    userId: 'user-1',
    categoryId: 'food',
    name: 'Budget',
    amount: 100,
    currency: 'USD',
    period: 'monthly',
    startDate: at,
    spent: 0,
    isActive: true,
    alertThreshold: 80,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function occurrence(overrides: Partial<RecurringOccurrence>): RecurringOccurrence {
  return {
    recurringId: 'recurring-1',
    name: 'Rent',
    type: 'expense',
    amount: 1200,
    currency: 'EUR',
    categoryId: 'housing',
    date: new Date(2026, 8, 20),
    ...overrides,
  };
}

function input(overrides: Partial<WidgetSnapshotInput> = {}): WidgetSnapshotInput {
  return {
    spent: 4200,
    net: 800,
    baseCurrency: 'JPY',
    budgets: [],
    upcoming: [],
    now: new Date(2026, 8, 14, 9, 30),
    ...overrides,
  };
}

/** Lets a resolved or rejected write reach its handlers. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve));
}

describe('WidgetSnapshotService', () => {
  let write: WriteSpy;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let isLoading: ReturnType<typeof signal<boolean>>;
  let canEngage: ReturnType<typeof signal<boolean>>;
  let formatCurrency: jasmine.Spy<(amount: number, code: string) => string>;

  function configure(plugin: WidgetSnapshotPlugin | null, withFormatters = true): void {
    currentUser = signal<User | null>(createMockUser('user-1'));
    isLoading = signal(false);
    canEngage = signal(false);
    formatCurrency = jasmine
      .createSpy('formatCurrency')
      .and.callFake((amount: number, code: string) => `${code} ${amount}`);

    // On the web every formatter throws when resolved. Leaving them out is not
    // enough: they are root-provided and construct for real, and the real
    // CurrencyService fetches rates from its constructor.
    const unresolvable = (name: string) => () => {
      throw new Error(`${name} was resolved on the web`);
    };
    const formatters = withFormatters
      ? [
          {
            provide: TranslationService,
            useValue: {
              t: (key: string, params?: Record<string, string | number>) =>
                params ? `${key}|${JSON.stringify(params)}` : key,
            },
          },
          { provide: CurrencyService, useValue: { formatCurrency } },
          {
            provide: LocaleFormatService,
            useValue: {
              formatDate: jasmine
                .createSpy('formatDate')
                .and.callFake(
                  (value: Date, style: LocaleDateStyle) =>
                    `${style}:${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`
                ),
            },
          },
        ]
      : [
          { provide: TranslationService, useFactory: unresolvable('TranslationService') },
          { provide: CurrencyService, useFactory: unresolvable('CurrencyService') },
          { provide: LocaleFormatService, useFactory: unresolvable('LocaleFormatService') },
        ];

    TestBed.configureTestingModule({
      providers: [
        { provide: WIDGET_SNAPSHOT_PLUGIN, useValue: plugin },
        { provide: AuthService, useValue: { currentUser, isLoading } },
        { provide: AppLockService, useValue: { canEngage } },
        ...formatters,
      ],
    });
  }

  function written(index = write.calls.count() - 1): WidgetSnapshot {
    return JSON.parse(write.calls.argsFor(index)[0].snapshot) as WidgetSnapshot;
  }

  describe('on the web', () => {
    beforeEach(() => configure(null, false));

    it('resolves no formatter and writes nothing, from publish or from its effects', () => {
      const service = TestBed.inject(WidgetSnapshotService);
      TestBed.tick();

      canEngage.set(true);
      TestBed.tick();
      canEngage.set(false);
      currentUser.set(null);
      TestBed.tick();

      expect(() =>
        service.publish(input({ budgets: [budget({ spent: 50 })], upcoming: [occurrence({})] }))
      ).not.toThrow();

      // The harness would have caught a resolution: every formatter throws here.
      expect(() => TestBed.inject(TranslationService)).toThrowError(/resolved on the web/);
      expect(() => TestBed.inject(CurrencyService)).toThrowError(/resolved on the web/);
      expect(() => TestBed.inject(LocaleFormatService)).toThrowError(/resolved on the web/);
    });
  });

  describe('on a device', () => {
    let service: WidgetSnapshotService;

    beforeEach(() => {
      write = jasmine.createSpy('write').and.resolveTo();
      configure({ write });
      service = TestBed.inject(WidgetSnapshotService);
    });

    describe('the payload', () => {
      it('stamps version, state, the local month and the write time, and takes every label by key', () => {
        const now = new Date(2026, 8, 14, 9, 30);

        service.publish(input({ now }));

        expect(write).toHaveBeenCalledTimes(1);
        const snapshot = written();
        expect(snapshot.version).toBe(1);
        expect(snapshot.state).toBe('figures');
        expect(snapshot.monthKey).toBe('2026-09');
        expect(snapshot.writtenAt).toBe(now.getTime());
        expect(snapshot.labels).toEqual({
          ...LABELS_BY_KEY,
          updated: 'widget.updated|{"date":"medium:2026-9-14"}',
        });
      });

      it('zero-pads the month and reads it from local time on either side of a month boundary', () => {
        service.publish(input({ now: new Date(2026, 0, 31, 12) }));
        service.publish(input({ now: new Date(2026, 8, 30, 23, 59) }));
        service.publish(input({ now: new Date(2026, 9, 1, 0, 1) }));

        expect(written(0).monthKey).toBe('2026-01');
        expect(written(1).monthKey).toBe('2026-09');
        expect(written(2).monthKey).toBe('2026-10');
      });

      it('formats spent and net in the base currency, signing a negative net', () => {
        service.publish(input({ spent: 4200, net: -1500, baseCurrency: 'JPY' }));

        const figures = written().figures!;
        expect(figures.spent).toBe('JPY 4200');
        expect(figures.net).toBe('JPY -1500');
      });

      it('picks the budget with the highest spent over amount, never ranking a zero-amount or inactive one', () => {
        service.publish(
          input({
            budgets: [
              budget({ name: 'Travel', amount: 500, spent: 200, currency: 'USD' }),
              budget({ name: 'Nothing set', amount: 0, spent: 50 }),
              budget({ name: 'Paused', amount: 100, spent: 95, isActive: false }),
              budget({ name: 'Food', amount: 100, spent: 82, currency: 'EUR' }),
            ],
          })
        );

        expect(written().figures!.topBudget).toEqual({
          name: 'Food',
          percent: 82,
          detail: 'widget.budgetDetail|{"spent":"EUR 82","limit":"EUR 100"}',
        });
      });

      it('keeps the first of two budgets tied on utilisation', () => {
        service.publish(
          input({
            budgets: [
              budget({ name: 'First', amount: 100, spent: 50 }),
              budget({ name: 'Second', amount: 50, spent: 25 }),
            ],
          })
        );

        expect(written().figures!.topBudget!.name).toBe('First');
      });

      it('rounds a fractional utilisation to an integer percent', () => {
        service.publish(input({ budgets: [budget({ amount: 3, spent: 2 })] }));

        const percent = written().figures!.topBudget!.percent;
        expect(Number.isInteger(percent)).toBeTrue();
        expect(percent).toBe(67);
      });

      it('writes a null top budget when there are no budgets, or only zero-amount ones', () => {
        service.publish(input({ budgets: [] }));
        service.publish(input({ budgets: [budget({ amount: 0, spent: 10 })], spent: 1 }));

        expect(written(0).figures!.topBudget).toBeNull();
        expect(written(1).figures!.topBudget).toBeNull();
      });

      it('takes the first occurrence with a signed amount in its own currency and a medium date', () => {
        service.publish(
          input({
            upcoming: [
              occurrence({ name: 'Rent', type: 'expense', amount: 1200, currency: 'EUR', date: new Date(2026, 8, 20) }),
              occurrence({ name: 'Salary', type: 'income', amount: 3000, currency: 'USD', date: new Date(2026, 8, 25) }),
            ],
          })
        );
        service.publish(
          input({
            upcoming: [
              occurrence({ name: 'Salary', type: 'income', amount: 3000, currency: 'USD', date: new Date(2026, 8, 25) }),
            ],
          })
        );

        expect(written(0).figures!.nextScheduled).toEqual({
          name: 'Rent',
          date: 'medium:2026-9-20',
          amount: 'EUR -1200',
        });
        expect(written(1).figures!.nextScheduled!.amount).toBe('USD 3000');
      });

      it('writes a null next scheduled when nothing is scheduled', () => {
        service.publish(input({ upcoming: [] }));

        expect(written().figures!.nextScheduled).toBeNull();
      });

      it('writes labels only, formatting no money, while the lock can engage', () => {
        canEngage.set(true);

        service.publish(input({ budgets: [budget({ spent: 50 })], upcoming: [occurrence({})] }));

        const snapshot = written();
        expect(snapshot.state).toBe('locked');
        expect('figures' in snapshot).toBeFalse();
        expect(snapshot.labels).toEqual({
          ...LABELS_BY_KEY,
          updated: 'widget.updated|{"date":"medium:2026-9-14"}',
        });
        expect(formatCurrency).not.toHaveBeenCalled();
      });
    });

    describe('deduplication', () => {
      it('writes the same figures once on the same day, whatever the time', async () => {
        service.publish(input({ now: new Date(2026, 8, 14, 9, 0) }));
        await settle();
        service.publish(input({ now: new Date(2026, 8, 14, 18, 0) }));
        await settle();

        expect(write).toHaveBeenCalledTimes(1);
      });

      it('writes again when a figure changes', async () => {
        service.publish(input({ spent: 4200 }));
        await settle();
        service.publish(input({ spent: 4300 }));
        await settle();

        expect(write).toHaveBeenCalledTimes(2);
        expect(written(1).figures!.spent).toBe('JPY 4300');
      });

      it('writes the same figures again on the next local day', async () => {
        service.publish(input({ now: new Date(2026, 8, 14, 23, 50) }));
        await settle();
        service.publish(input({ now: new Date(2026, 8, 15, 0, 10) }));
        await settle();

        expect(write).toHaveBeenCalledTimes(2);
        expect(written(1).labels.updated).toBe('widget.updated|{"date":"medium:2026-9-15"}');
      });

      it('settles a rejected write with no unhandled rejection and no console line, and tries again next time', async () => {
        const unhandled: PromiseRejectionEvent[] = [];
        const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event);
        window.addEventListener('unhandledrejection', onUnhandled);
        const consoleLines = [
          spyOn(console, 'error'),
          spyOn(console, 'warn'),
          spyOn(console, 'log'),
          spyOn(console, 'info'),
        ];
        write.and.rejectWith(Object.assign(new Error('unavailable'), { code: 'unavailable' }));

        try {
          service.publish(input());
          await settle();
          await settle();
          service.publish(input());
          await settle();
          await settle();
        } finally {
          window.removeEventListener('unhandledrejection', onUnhandled);
        }

        expect(unhandled).toEqual([]);
        for (const line of consoleLines) expect(line).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledTimes(2);
      });
    });

    describe('the effects', () => {
      it('writes a locked snapshot as soon as the lock can engage, with no publish', () => {
        TestBed.tick();
        expect(write).not.toHaveBeenCalled();

        canEngage.set(true);
        TestBed.tick();

        expect(write).toHaveBeenCalledTimes(1);
        const snapshot = written();
        expect(snapshot.state).toBe('locked');
        expect('figures' in snapshot).toBeFalse();
        expect(snapshot.labels.locked).toBe('widget.locked');
      });

      it('writes nothing while auth is still loading with no user', async () => {
        isLoading.set(true);
        currentUser.set(null);
        TestBed.tick();
        await settle();

        expect(write).not.toHaveBeenCalled();
      });

      it('writes signedOut once when loading resolves to no user', async () => {
        isLoading.set(true);
        currentUser.set(null);
        TestBed.tick();

        isLoading.set(false);
        TestBed.tick();
        await settle();
        TestBed.tick();

        expect(write).toHaveBeenCalledTimes(1);
        const snapshot = written();
        expect(snapshot.state).toBe('signedOut');
        expect('figures' in snapshot).toBeFalse();
        expect(snapshot.labels.signedOut).toBe('widget.signedOut');
      });

      it('writes signedOut once when a signed-in user signs out', async () => {
        TestBed.tick();
        expect(write).not.toHaveBeenCalled();

        currentUser.set(null);
        TestBed.tick();
        await settle();
        TestBed.tick();

        expect(write).toHaveBeenCalledTimes(1);
        expect(written().state).toBe('signedOut');
      });
    });
  });
});
