import { WritableSignal, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';

import { HouseholdPlansComponent } from './household-plans.component';
import { HouseholdBudgetDialogComponent } from './household-budget-dialog/household-budget-dialog.component';
import { HouseholdGoalDialogComponent } from './household-goal-dialog/household-goal-dialog.component';
import { HouseholdContributionDialogComponent } from './household-contribution-dialog/household-contribution-dialog.component';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { HouseholdError, HouseholdService } from '../../../core/services/household.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import {
  HouseholdBudgetFigures,
  HouseholdGoalFigures,
  HouseholdPlansService
} from '../../../core/services/household-plans.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  channels,
  createTranslationStub,
  createUser,
  paintedBackground,
  ratio,
  runAxe,
  settleAnimations,
  summarizeViolations,
  withTheme
} from '../../../core/services/testing';
import { defaultBudgetStart, startOfDay } from '../../../core/utils/transaction-date.utils';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';
import { Household, HouseholdBudget, HouseholdContribution, HouseholdGoal, HouseholdMember, User } from '../../../models';
import { PLAN_AUDIT_THEMES } from './household-plan-dialog.testing';

const GEN = Timestamp.fromMillis(1_700_000_000_000);

/** The household the page shows throughout, unless a test moves it. */
const HOME: Household = { id: 'h1', name: 'Home', ownerId: 'me', createdAt: GEN };

const member = (uid: string, displayName: string): HouseholdMember => ({
  uid,
  displayName,
  role: uid === 'me' ? 'owner' : 'member',
  since: GEN,
  joinedAt: GEN
});

function budgetFigures(overrides: Partial<HouseholdBudget> = {}, figures: Partial<HouseholdBudgetFigures> = {}): HouseholdBudgetFigures {
  const budget: HouseholdBudget = {
    id: 'b1',
    gen: GEN,
    name: 'Groceries',
    categoryIds: ['food'],
    amount: 400,
    currency: 'USD',
    period: 'monthly',
    startDate: Timestamp.fromDate(new Date(2026, 0, 1)),
    isActive: true,
    createdBy: 'me',
    createdAt: GEN,
    updatedAt: GEN,
    ...overrides
  };
  return {
    budget,
    spent: 150,
    atTodaysRate: false,
    window: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) },
    incomplete: false,
    counting: false,
    ...figures
  };
}

function contribution(id: string, memberUid: string, amount: number, date: Date): HouseholdContribution {
  return { id, gen: GEN, memberUid, amount, date: Timestamp.fromDate(date), createdAt: Timestamp.fromDate(date) };
}

function goalFigures(overrides: Partial<HouseholdGoal> = {}, figures: Partial<HouseholdGoalFigures> = {}): HouseholdGoalFigures {
  const goal: HouseholdGoal = {
    id: 'g1',
    gen: GEN,
    name: 'Holiday',
    targetAmount: 1000,
    currency: 'EUR',
    targetDate: Timestamp.fromDate(new Date(2026, 11, 24)),
    isActive: true,
    createdBy: 'me',
    createdAt: GEN,
    updatedAt: GEN,
    ...overrides
  };
  return {
    goal,
    saved: 250,
    linked: 0,
    contributed: 250,
    fraction: 0.25,
    atTodaysRate: false,
    contributions: [
      contribution('c2', 'kai', 50, new Date(2026, 8, 20)),
      contribution('c1', 'me', 200, new Date(2026, 8, 1))
    ],
    incomplete: false,
    counting: false,
    ...figures
  };
}

// Rendered (ADR 0144): what the section says, in which heading, and that it
// says it inside the section at a phone's width, is the thing under test.
describe('HouseholdPlansComponent', () => {
  let fixture: ComponentFixture<HouseholdPlansComponent>;
  let plans: {
    budgets: WritableSignal<HouseholdBudgetFigures[]>;
    goals: WritableSignal<HouseholdGoalFigures[]>;
    loading: WritableSignal<boolean>;
    incomplete: WritableSignal<boolean>;
    fromCache: WritableSignal<boolean>;
  };
  let members: WritableSignal<HouseholdMember[]>;
  /** The household the page shows; null when it shows none. */
  let shown: WritableSignal<Household | null>;
  /** The viewer's own member document; null once they are no longer a live member. */
  let own: WritableSignal<HouseholdMember | null>;
  let online: WritableSignal<boolean>;
  let writes: jasmine.SpyObj<Pick<HouseholdPlansService,
    'newId' | 'createBudget' | 'updateBudget' | 'deleteBudget' | 'createGoal' | 'updateGoal' | 'deleteGoal' |
    'addContribution' | 'deleteContribution'>>;
  let notification: jasmine.SpyObj<Pick<NotificationService, 'success' | 'error'>>;
  let analytics: jasmine.SpyObj<Pick<AnalyticsService, 'trackHouseholdAction'>>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const all = (selector: string): HTMLElement[] => Array.from(element().querySelectorAll<HTMLElement>(selector));
  const text = (node: Element | null | undefined): string => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  /** What a node reads as: its text without an icon's ligature, and a member chip's without its initial. */
  const readAs = (node: Element | null | undefined): string => {
    if (!node) return '';
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('mat-icon, .member-avatar').forEach(part => part.remove());
    return text(copy);
  };

  function render(): void {
    fixture.detectChanges();
  }

  beforeEach(async () => {
    plans = {
      budgets: signal([]),
      goals: signal([]),
      loading: signal(false),
      incomplete: signal(false),
      fromCache: signal(false)
    };
    members = signal([member('me', 'Alex'), member('kai', 'Kai')]);
    shown = signal<Household | null>(HOME);
    own = signal<HouseholdMember | null>(members()[0]);
    online = signal(true);
    writes = jasmine.createSpyObj('HouseholdPlansService', [
      'newId', 'createBudget', 'updateBudget', 'deleteBudget', 'createGoal', 'updateGoal', 'deleteGoal',
      'addContribution', 'deleteContribution'
    ]);
    let ids = 0;
    writes.newId.and.callFake(() => `id-${++ids}`);
    writes.createBudget.and.resolveTo('b-new');
    writes.createGoal.and.resolveTo('g-new');
    writes.addContribution.and.resolveTo('c-new');
    for (const done of [writes.updateBudget, writes.deleteBudget, writes.updateGoal, writes.deleteGoal, writes.deleteContribution]) {
      done.and.resolveTo(undefined);
    }
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error']);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackHouseholdAction']);
    const viewer = signal<User | null>(createUser({ id: 'me', preferences: { baseCurrency: 'JPY' } as User['preferences'] }));

    await TestBed.configureTestingModule({
      imports: [HouseholdPlansComponent],
      providers: [
        provideNoopAnimations(),
        provideNativeDateAdapter(),
        { provide: HouseholdPlansService, useValue: { ...plans, ...writes } },
        {
          provide: HouseholdService,
          useValue: { household: shown, members, ownMember: own, isOwner: computed(() => own()?.role === 'owner') }
        },
        { provide: AuthService, useValue: { currentUser: viewer, userId: computed(() => viewer()?.id ?? null) } },
        { provide: NotificationService, useValue: notification },
        { provide: AnalyticsService, useValue: analytics },
        { provide: PwaService, useValue: { isOnline: online } },
        {
          provide: CurrencyService,
          useValue: {
            formatCurrency: (amount: number, code: string) => `${code} ${amount.toFixed(2)}`,
            getSupportedCurrencies: () => ['USD', 'EUR', 'JPY'].map(code => ({ code, nameKey: `currencies.${code}`, symbol: code }))
          }
        },
        {
          provide: DateFormatService,
          useValue: {
            formatDate: (date: Date | Timestamp) => {
              const day = date instanceof Date ? date : date.toDate();
              return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
            }
          }
        },
        { provide: TranslationService, useValue: createTranslationStub() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdPlansComponent);
    render();
  });

  it('says the household has no budgets or goals, under its own heading', () => {
    const heading = element().querySelector('h2');

    expect(heading?.id).toBe('household-plans-title');
    expect(heading?.textContent).toContain('household.plans.title');
    expect(element().querySelector('section')?.getAttribute('aria-labelledby')).toBe('household-plans-title');
    expect(text(element().querySelector('.plans-empty'))).toBe('household.plans.empty');
    expect(element().querySelector('app-loading-spinner')).toBeNull();
  });

  describe('its budgets', () => {
    it('name each active budget with its spending, limit, bar, period and window, under the section', () => {
      plans.budgets.set([budgetFigures()]);
      render();

      const group = element().querySelector<HTMLElement>('.plans-budgets');
      expect(group?.getAttribute('aria-labelledby')).toBe('household-budgets-title');
      expect(text(group?.querySelector('h3#household-budgets-title'))).toBe('household.plans.budgetsTitle');
      const card = group?.querySelector<HTMLElement>('.plan-card');
      expect(text(card?.querySelector('h4.plan-name'))).toBe('Groceries');
      expect(text(card?.querySelector('.plan-amount'))).toBe('USD 150.00');
      expect(text(card?.querySelector('.plan-of'))).toBe('/ USD 400.00');
      expect(text(card?.querySelector('.plan-percent'))).toBe('38%');
      expect(text(card?.querySelector('.plan-period'))).toBe('transactions.monthly');
      expect(text(card?.querySelector('.plan-window')))
        .toBe('household.plans.window:{"start":"2026-9-1","end":"2026-9-30"}');

      const bar = card?.querySelector<HTMLElement>('mat-progress-bar');
      expect(bar?.getAttribute('role')).toBe('progressbar');
      expect(bar?.getAttribute('aria-valuenow')).toBe('37.5');
      expect(bar?.getAttribute('aria-label')).toBe('budgets.progressLabel:{"name":"Groceries","percent":38}');

      expect(card?.querySelector('.rate-caption')).toBeNull();
      expect(card?.querySelector('.plan-incomplete')).toBeNull();
      expect(element().querySelector('.plans-empty')).toBeNull();
    });

    it("say when a copy in another currency was counted at today's rate, or the window may not all have been read", () => {
      plans.budgets.set([budgetFigures({}, { atTodaysRate: true, incomplete: true })]);
      render();

      const card = element().querySelector('.plans-budgets .plan-card');
      expect(text(card?.querySelector('.rate-caption'))).toBe('common.atTodaysRate');
      expect(readAs(card?.querySelector('.plan-incomplete'))).toBe('household.plans.incomplete');
    });

    it('read an overspend in the number, with the bar full', () => {
      plans.budgets.set([budgetFigures({}, { spent: 500 })]);
      render();

      const card = element().querySelector('.plans-budgets .plan-card');
      expect(text(card?.querySelector('.plan-percent'))).toBe('125%');
      expect(card?.querySelector('.plan-amount')?.classList).toContain('over');
      expect(card?.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('100');
    });

    it('show no window for a budget that has none now', () => {
      plans.budgets.set([budgetFigures({}, { window: null, spent: 0 })]);
      render();

      const card = element().querySelector('.plans-budgets .plan-card');
      expect(card?.querySelector('.plan-window')).toBeNull();
      expect(text(card?.querySelector('.plan-percent'))).toBe('0%');
    });

    describe('warn as the budget asks', () => {
      /** The card's bar tone, its percentage's tone and what its alert line says, in that order. */
      function signals(): [string[], string[], string] {
        const card = element().querySelector('.plans-budgets .plan-card');
        const toneOf = (node: Element | null | undefined) => ['over', 'near'].filter(name => node?.classList.contains(name));
        return [
          toneOf(card?.querySelector('mat-progress-bar')),
          toneOf(card?.querySelector('.plan-percent')),
          readAs(card?.querySelector('.plan-alert'))
        ];
      }

      it('from its own threshold, with words beside the colour', () => {
        plans.budgets.set([budgetFigures({ alertThreshold: 70 }, { spent: 300 })]);
        render();
        expect(signals()).withContext('75% of a budget that warns at 70%').toEqual([['near'], ['near'], 'budget.approachingLimit']);

        plans.budgets.set([budgetFigures({ alertThreshold: 80 }, { spent: 360 })]);
        render();
        expect(signals()).withContext('90%').toEqual([['near'], ['near'], 'budget.almostAtLimit']);

        plans.budgets.set([budgetFigures({ alertThreshold: 95 }, { spent: 340 })]);
        render();
        expect(signals()).withContext('85% of a budget that warns at 95%').toEqual([[], [], '']);
      });

      it('from the default threshold when the budget names none', () => {
        plans.budgets.set([budgetFigures({}, { spent: 320 })]);
        render();

        expect(signals()).withContext('80%').toEqual([['near'], ['near'], 'budget.approachingLimit']);
      });

      it('as exceeded from the moment it reaches its limit', () => {
        plans.budgets.set([budgetFigures({}, { spent: 400 })]);
        render();

        expect(signals()).toEqual([['over'], ['over'], 'budget.budgetExceeded']);
        expect(element().querySelector('.plans-budgets .plan-amount')?.classList).toContain('over');
      });

      it('not at all below it', () => {
        plans.budgets.set([budgetFigures({}, { spent: 150 })]);
        render();

        expect(signals()).toEqual([[], [], '']);
      });

      /** What `color: var(token)` computes to under the theme on <html> now. */
      function tokenColour(token: string): string {
        const probe = document.createElement('span');
        probe.style.color = `var(${token})`;
        document.body.appendChild(probe);
        try {
          settleAnimations(document);
          return getComputedStyle(probe).color;
        } finally {
          probe.remove();
        }
      }

      // Each severity at a spend of the 400 limit that reaches it under the
      // default threshold. Material paints the indicator as the inner bar's
      // top border. It is a graphic, so its floor is 3:1 (WCAG 1.4.11),
      // against the track it runs along and the card around it. Past its
      // limit the card says so in one red: the bar, the amount, the
      // percentage and the alert.
      it("in the bar's own colour as well, at 3:1 or better on its track and the card, in both themes, and past its limit in the red its words read in", () => {
        const SEVERITIES = [
          { name: 'within budget', spent: 150, token: '--color-success-text' },
          { name: 'warning', spent: 320, token: '--color-warning-text' },
          { name: 'critical', spent: 360, token: '--color-warning-text' },
          { name: 'exceeded', spent: 400, token: '--color-expense-text' },
        ] as const;
        const part = (selector: string) => element().querySelector<HTMLElement>(`.plans-budgets ${selector}`) as HTMLElement;
        for (const theme of ['light', 'dark'] as const) {
          withTheme(theme, () => {
            const painted = new Map<string, string>();
            for (const severity of SEVERITIES) {
              plans.budgets.set([budgetFigures({}, { spent: severity.spent })]);
              render();
              settleAnimations(document);
              const label = `${theme} ${severity.name} bar`;
              const indicator = getComputedStyle(part('.mdc-linear-progress__bar-inner')).borderTopColor;
              painted.set(severity.name, indicator);
              expect(indicator).withContext(label).toBe(tokenColour(severity.token));
              expect(ratio(channels(indicator).rgb, paintedBackground(part('.mdc-linear-progress__buffer-bar'))))
                .withContext(`${label} on its track`)
                .toBeGreaterThanOrEqual(3);
              expect(ratio(channels(indicator).rgb, paintedBackground(part('.plan-card'))))
                .withContext(`${label} on the card`)
                .toBeGreaterThanOrEqual(3);
              if (severity.name === 'exceeded') {
                for (const words of ['.plan-amount', '.plan-percent', '.plan-alert']) {
                  expect(indicator).withContext(`${label} in the red of ${words}`).toBe(getComputedStyle(part(words)).color);
                }
              }
            }
            expect(painted.get('warning'))
              .withContext(`${theme} a warning bar paints apart from one within budget`)
              .not.toBe(painted.get('within budget'));
            expect(painted.get('exceeded'))
              .withContext(`${theme} an exceeded bar paints apart from a warning one`)
              .not.toBe(painted.get('warning'));
          });
        }
      });
    });
  });

  describe('its goals', () => {
    it("name each active goal with its progress, target date and every member's contribution, newest first", () => {
      plans.goals.set([goalFigures()]);
      render();

      const group = element().querySelector<HTMLElement>('.plans-goals');
      expect(group?.getAttribute('aria-labelledby')).toBe('household-goals-title');
      expect(text(group?.querySelector('h3#household-goals-title'))).toBe('household.plans.goalsTitle');
      const card = group?.querySelector<HTMLElement>('.plan-card');
      expect(text(card?.querySelector('h4.plan-name'))).toBe('Holiday');
      expect(text(card?.querySelector('.plan-amount'))).toBe('EUR 250.00');
      expect(text(card?.querySelector('.plan-of'))).toBe('/ EUR 1000.00');
      expect(text(card?.querySelector('.plan-percent'))).toBe('25%');
      expect(text(card?.querySelector('.plan-target-date'))).toBe('household.plans.targetDate:{"date":"2026-12-24"}');

      const bar = card?.querySelector<HTMLElement>('mat-progress-bar');
      expect(bar?.getAttribute('aria-valuenow')).toBe('25');
      expect(bar?.getAttribute('aria-label')).toBe('goals.progressLabel:{"name":"Holiday","percent":25}');

      const list = card?.querySelector<HTMLElement>('ul.contributions');
      const label = card?.querySelector<HTMLElement>('.contributions-title');
      expect(text(label)).toBe('household.plans.contributionsTitle');
      expect(list?.getAttribute('aria-labelledby')).toBe(label?.id);
      expect(label?.id).toBeTruthy();
      const rows = Array.from(list?.querySelectorAll<HTMLElement>('li.contribution') ?? []);
      expect(rows.map(row => readAs(row.querySelector('app-member-chip')))).toEqual(['Kai', 'Alex']);
      expect(rows.map(row => text(row.querySelector('.contribution-amount')))).toEqual(['EUR 50.00', 'EUR 200.00']);
      expect(rows.map(row => text(row.querySelector('.contribution-date')))).toEqual(['2026-9-20', '2026-9-1']);

      expect(card?.querySelector('.rate-caption')).toBeNull();
      expect(card?.querySelector('.plan-incomplete')).toBeNull();
    });

    it("say when a linked copy was counted at today's rate, or not everything counted was read", () => {
      plans.goals.set([goalFigures({}, { atTodaysRate: true, incomplete: true })]);
      render();

      const card = element().querySelector('.plans-goals .plan-card');
      expect(text(card?.querySelector('.rate-caption'))).toBe('common.atTodaysRate');
      // A goal counts contributions as well as shared rows, and says so.
      expect(readAs(card?.querySelector('.plan-incomplete'))).toBe('household.plans.goalIncomplete');
    });

    it('say a goal without a target date or contributions has neither', () => {
      plans.goals.set([goalFigures({ targetDate: undefined }, { saved: 0, contributed: 0, fraction: 0, contributions: [] })]);
      render();

      const card = element().querySelector('.plans-goals .plan-card');
      expect(card?.querySelector('.plan-target-date')).toBeNull();
      expect(card?.querySelector('ul.contributions')).toBeNull();
      expect(text(card?.querySelector('.contributions-empty'))).toBe('household.plans.noContributions');
    });

    it('read past the target in the number, with the bar full', () => {
      plans.goals.set([goalFigures({}, { saved: 1500, fraction: 1.5 })]);
      render();

      const card = element().querySelector('.plans-goals .plan-card');
      expect(text(card?.querySelector('.plan-percent'))).toBe('150%');
      expect(card?.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('100');
    });

    it("name a contributor the members list does not name as a member with no name, never by their id", () => {
      members.set([member('me', 'Alex')]);
      plans.goals.set([goalFigures()]);
      render();

      const chips = all('.plans-goals li.contribution app-member-chip').map(chip => readAs(chip));
      expect(chips).toEqual(['household.unnamedMember', 'Alex']);
    });
  });

  it('keeps the budgets before the goals, each heading nested under the one before', () => {
    plans.budgets.set([budgetFigures()]);
    plans.goals.set([goalFigures()]);
    render();

    const headings = all('h2, h3, h4').map(heading => `${heading.tagName.toLowerCase()} ${readAs(heading)}`);
    expect(headings).toEqual([
      'h2 household.plans.title',
      'h3 household.plans.budgetsTitle',
      'h4 Groceries',
      'h3 household.plans.goalsTitle',
      'h4 Holiday'
    ]);
  });

  it('holds no control, and no personal budget or goal card, for a viewer who is no longer a live member', () => {
    own.set(null);
    plans.budgets.set([budgetFigures()]);
    plans.goals.set([goalFigures()]);
    render();

    expect(element().querySelector('app-budget-progress-card, app-goal-progress-card')).toBeNull();
    // Material's progress bar carries tabindex="-1": reachable from script, never by Tab.
    const reachable = all('button, a, input, [tabindex]:not([tabindex="-1"])');
    expect(reachable.map(node => node.outerHTML.slice(0, 120))).toEqual([]);
  });

  describe("a live member's controls", () => {
    let dialog: MatDialog;

    const button = (selector: string, within?: Element | null): HTMLButtonElement => {
      const found = (within ?? element()).querySelector<HTMLButtonElement>(selector);
      if (!found) throw new Error(`${selector} is not shown`);
      return found;
    };
    const card = (name: string): HTMLElement | undefined =>
      all('.plan-card').find(each => text(each.querySelector('.plan-name')) === name);
    const openDialog = <T>(): MatDialogRef<T> => {
      const ref = dialog.openDialogs.at(-1);
      if (!ref) throw new Error('No dialog is open');
      return ref as MatDialogRef<T>;
    };
    /** Answers the confirm now open, with what it asked. */
    async function answerConfirm(answer: boolean): Promise<ConfirmDialogData> {
      const ref = openDialog<ConfirmDialogComponent>();
      expect(ref.componentInstance).toBeInstanceOf(ConfirmDialogComponent);
      const asked = ref.componentInstance.data;
      ref.close(answer);
      await firstValueFrom(ref.afterClosed());
      await fixture.whenStable();
      return asked;
    }
    /** Lets a dialog's close reach the section, and the section render what came of it. */
    async function settle(): Promise<void> {
      await fixture.whenStable();
      render();
      await fixture.whenStable();
    }

    beforeEach(() => {
      dialog = TestBed.inject(MatDialog);
      // A member, not the owner, unless a test says otherwise.
      own.set({ ...member('me', 'Alex'), role: 'member' });
      plans.budgets.set([budgetFigures(), budgetFigures({ id: 'b2', name: 'Fuel', createdBy: 'kai' })]);
      plans.goals.set([goalFigures(), goalFigures({ id: 'g2', name: 'Sofa', createdBy: 'kai' }, { contributions: [] })]);
      render();
    });

    afterEach(() => dialog.closeAll());

    it('offer a new budget and a new goal, and every plan to edit, each control 40px or larger', () => {
      expect(text(button('.plans-new-budget'))).toContain('household.plans.newBudget');
      expect(text(button('.plans-new-goal'))).toContain('household.plans.newGoal');
      expect(all('.plan-edit').map(each => each.getAttribute('aria-label'))).toEqual([
        'household.plans.edit:{"name":"Groceries"}',
        'household.plans.edit:{"name":"Fuel"}',
        'household.plans.edit:{"name":"Holiday"}',
        'household.plans.edit:{"name":"Sofa"}'
      ]);
      const host = element();
      document.body.appendChild(host);
      try {
        for (const control of all('.plans button')) {
          const { width, height } = control.getBoundingClientRect();
          expect(Math.min(width, height)).withContext(control.className).toBeGreaterThanOrEqual(40);
        }
      } finally {
        host.remove();
      }
    });

    it("offer a plan's delete only to its maker or the household's owner", () => {
      expect(card('Groceries')?.querySelector('.plan-delete')).not.toBeNull();
      expect(card('Fuel')?.querySelector('.plan-delete')).toBeNull();
      expect(card('Holiday')?.querySelector('.plan-delete')).not.toBeNull();
      expect(card('Sofa')?.querySelector('.plan-delete')).toBeNull();

      own.set(member('me', 'Alex'));
      render();
      expect(all('.plan-delete').length).toBe(4);
      expect(button('.plan-delete', card('Fuel')).getAttribute('aria-label')).toBe('household.plans.delete:{"name":"Fuel"}');
    });

    it("offer a contribution's delete only to the member who recorded it or the owner", () => {
      const contributions = () => all('.contribution').map(each => !!each.querySelector('.contribution-delete'));
      // Kai's first, then the viewer's.
      expect(contributions()).toEqual([false, true]);
      own.set(member('me', 'Alex'));
      render();
      expect(contributions()).toEqual([true, true]);
      expect(button('.contribution-delete').getAttribute('aria-label'))
        .toBe('household.plans.deleteContribution:{"amount":"EUR 50.00","date":"2026-9-20"}');
    });

    it("make a budget from its dialog in the viewer's base currency, counted and said, then focus its card", async () => {
      const host = element();
      document.body.appendChild(host);
      try {
        const origin = button('.plans-new-budget');
        origin.focus();
        origin.click();
        const ref = openDialog<HouseholdBudgetDialogComponent>();
        expect(ref.componentInstance).toBeInstanceOf(HouseholdBudgetDialogComponent);
        ref.componentInstance.form.patchValue({ name: 'Home', categoryIds: ['food', 'bills'], amount: 900 });

        await ref.componentInstance.submit();
        await settle();

        expect(writes.createBudget).toHaveBeenCalledOnceWith({
          name: 'Home',
          categoryIds: ['food', 'bills'],
          amount: 900,
          currency: 'JPY',
          period: 'monthly',
          startDate: defaultBudgetStart('monthly', new Date()),
          endDate: null,
          alertThreshold: null
        }, 'id-1');
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'plan_create' });
        expect(notification.success).toHaveBeenCalledOnceWith('household.plans.budgetCreated');
        expect(document.activeElement).withContext('the dialog hands focus back to its button').toBe(origin);

        // The card comes once the listener says so, and focus moves on to it.
        plans.budgets.update(budgets => [...budgets, budgetFigures({ id: 'b-new', name: 'Home' })]);
        render();
        await settle();
        expect(document.activeElement?.id).toBe('household-budget-b-new-name');
      } finally {
        host.remove();
      }
    });

    it("make a goal from its dialog in the viewer's base currency, counted and said, then focus its card", async () => {
      const host = element();
      document.body.appendChild(host);
      try {
        const origin = button('.plans-new-goal');
        origin.focus();
        origin.click();
        const ref = openDialog<HouseholdGoalDialogComponent>();
        expect(ref.componentInstance).toBeInstanceOf(HouseholdGoalDialogComponent);
        ref.componentInstance.form.patchValue({ name: 'Bike', targetAmount: 300 });

        await ref.componentInstance.submit();
        await settle();

        expect(writes.createGoal).toHaveBeenCalledOnceWith({ name: 'Bike', targetAmount: 300, currency: 'JPY', targetDate: null }, 'id-1');
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'plan_create' });
        expect(notification.success).toHaveBeenCalledOnceWith('household.plans.goalCreated');
        expect(document.activeElement).withContext('the dialog hands focus back to its button').toBe(origin);

        plans.goals.update(goals => [...goals, goalFigures({ id: 'g-new', name: 'Bike' })]);
        render();
        await settle();
        expect(document.activeElement?.id).toBe('household-goal-g-new-name');
      } finally {
        host.remove();
      }
    });

    it('edit a budget in the same dialog, its currency fixed and never sent, sending only what changed, and count nothing', async () => {
      button('.plan-edit', card('Fuel')).click();
      const ref = openDialog<HouseholdBudgetDialogComponent>();
      expect(ref.componentInstance.form.controls.currency.disabled).toBeTrue();
      expect(ref.componentInstance.form.controls.currency.value).toBe('USD');
      ref.componentInstance.form.patchValue({ name: ' Fuel and parking ', alertThreshold: 90 });

      await ref.componentInstance.submit();
      await settle();

      // Another member's edit to any other field, made meanwhile, stands.
      expect(writes.updateBudget).toHaveBeenCalledOnceWith('b2', { name: 'Fuel and parking', alertThreshold: 90 });
      expect(notification.success).toHaveBeenCalledOnceWith('household.plans.budgetSaved');
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it("clear a budget's end date and threshold as its only changes, its categories in another order being none", async () => {
      plans.budgets.set([
        budgetFigures({
          id: 'b3',
          name: 'Home',
          categoryIds: ['food', 'bills'],
          endDate: Timestamp.fromDate(new Date(2026, 11, 31)),
          alertThreshold: 70
        })
      ]);
      render();
      button('.plan-edit', card('Home')).click();
      const ref = openDialog<HouseholdBudgetDialogComponent>();
      ref.componentInstance.clearEndDate();
      ref.componentInstance.form.patchValue({ alertThreshold: null, categoryIds: ['bills', 'food'] });

      await ref.componentInstance.submit();
      await settle();

      expect(writes.updateBudget).toHaveBeenCalledOnceWith('b3', { endDate: null, alertThreshold: null });
    });

    it('send nothing for an edit that changes nothing, and close', async () => {
      button('.plan-edit', card('Groceries')).click();
      const ref = openDialog<HouseholdBudgetDialogComponent>();

      await ref.componentInstance.submit();
      await settle();

      expect(writes.updateBudget).not.toHaveBeenCalled();
      expect(dialog.openDialogs.length).toBe(0);
    });

    it('edit a goal in the same dialog, its currency fixed and never sent, sending only what changed', async () => {
      button('.plan-edit', card('Holiday')).click();
      const ref = openDialog<HouseholdGoalDialogComponent>();
      expect(ref.componentInstance.form.controls.currency.disabled).toBeTrue();
      ref.componentInstance.form.patchValue({ targetAmount: 1500 });

      await ref.componentInstance.submit();
      await settle();

      expect(writes.updateGoal).toHaveBeenCalledOnceWith('g1', { targetAmount: 1500 });
      expect(notification.success).toHaveBeenCalledOnceWith('household.plans.goalSaved');
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();

      button('.plan-edit', card('Holiday')).click();
      const again = openDialog<HouseholdGoalDialogComponent>();
      again.componentInstance.clearTargetDate();
      await again.componentInstance.submit();
      await settle();

      expect(writes.updateGoal.calls.mostRecent().args).toEqual(['g1', { targetDate: null }]);
    });

    it('delete a budget only once confirmed, counted and said, then focus the section heading', async () => {
      const host = element();
      document.body.appendChild(host);
      try {
        button('.plan-delete', card('Groceries')).click();
        const asked = await answerConfirm(false);
        expect(asked.title).toBe('household.plans.deleteBudgetTitle:{"name":"Groceries"}');
        expect(asked.message).toBe('household.plans.deleteBudgetMessage');
        expect(writes.deleteBudget).not.toHaveBeenCalled();

        button('.plan-delete', card('Groceries')).click();
        await answerConfirm(true);
        await settle();

        expect(writes.deleteBudget).toHaveBeenCalledOnceWith('b1');
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'plan_delete' });
        expect(notification.success).toHaveBeenCalledOnceWith('household.plans.budgetDeleted');

        // The card goes once the listener says so, taking focus with it.
        (document.activeElement as HTMLElement | null)?.blur();
        plans.budgets.update(budgets => budgets.filter(each => each.budget.id !== 'b1'));
        render();
        await settle();
        expect(document.activeElement?.id).toBe('household-plans-title');
      } finally {
        host.remove();
      }
    });

    it("say a goal's delete takes its contributions with it", async () => {
      button('.plan-delete', card('Holiday')).click();
      const asked = await answerConfirm(true);
      await settle();

      expect(asked.message).toBe('household.plans.deleteGoalMessage');
      expect(writes.deleteGoal).toHaveBeenCalledOnceWith('g1');
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'plan_delete' });
      expect(notification.success).toHaveBeenCalledOnceWith('household.plans.goalDeleted');
    });

    it("add a contribution in the goal's currency, dated today unless chosen, counted and said", async () => {
      const add = button('.plan-contribute', card('Holiday'));
      expect(add.getAttribute('aria-describedby')).toBe('household-goal-g1-name');
      add.click();
      const ref = openDialog<HouseholdContributionDialogComponent>();
      expect(ref.componentInstance).toBeInstanceOf(HouseholdContributionDialogComponent);
      expect(ref.componentInstance.data.currency).toBe('EUR');
      ref.componentInstance.form.patchValue({ amount: 75 });

      await ref.componentInstance.submit();
      await settle();

      expect(writes.addContribution).toHaveBeenCalledOnceWith('g1', 75, startOfDay(new Date()), 'id-1');
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'contribute' });
      expect(notification.success).toHaveBeenCalledOnceWith('household.plans.contributionAdded');
    });

    it('delete a contribution only once confirmed, and count nothing', async () => {
      button('.contribution-delete').click();
      const asked = await answerConfirm(true);
      await settle();

      expect(asked.message).toBe('household.plans.deleteContributionMessage:{"amount":"EUR 200.00","date":"2026-9-1","name":"Holiday"}');
      expect(writes.deleteContribution).toHaveBeenCalledOnceWith('g1', 'c1');
      expect(notification.success).toHaveBeenCalledOnceWith('household.plans.contributionDeleted');
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it('refuse offline before any dialog opens', () => {
      online.set(false);
      render();

      for (const selector of ['.plans-new-budget', '.plans-new-goal', '.plan-edit', '.plan-delete', '.plan-contribute', '.contribution-delete']) {
        button(selector).click();
      }

      expect(dialog.openDialogs.length).toBe(0);
      expect(notification.error.calls.allArgs()).toEqual(Array(6).fill(['household.errors.offline']));
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it("say a refusal in the service's own words, and count nothing", async () => {
      writes.deleteBudget.and.rejectWith(new HouseholdError('household.errors.planNotYours'));
      button('.plan-delete', card('Groceries')).click();
      await answerConfirm(true);
      await settle();

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.planNotYours');
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it('keep focus on the delete confirmed from it while the write is on its way, and once it is refused', async () => {
      const host = element();
      document.body.appendChild(host);
      try {
        let refuse!: (error: unknown) => void;
        writes.deleteBudget.and.returnValue(new Promise<void>((_, reject) => (refuse = reject)));
        const remove = button('.plan-delete', card('Groceries'));
        remove.focus();
        remove.click();
        await answerConfirm(true);
        render();
        // Focus fixup runs as the page next renders.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        expect(remove.getAttribute('aria-disabled')).withContext('it says it is not offered meanwhile').toBe('true');
        expect(document.activeElement).withContext('the confirm hands focus back, and the write keeps it there').toBe(remove);

        // No card goes, so nothing lands focus anywhere else.
        refuse(new HouseholdError('household.errors.offline'));
        await new Promise(resolve => setTimeout(resolve));
        await settle();
        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
        expect(remove.getAttribute('aria-disabled')).toBeNull();
        expect(document.activeElement).withContext('once the write is refused').toBe(remove);
      } finally {
        host.remove();
      }
    });

    it('count nothing when a dialog is closed without saving, or its save is refused', async () => {
      button('.plans-new-budget').click();
      openDialog<HouseholdBudgetDialogComponent>().componentInstance.cancel();
      await settle();

      writes.createGoal.and.rejectWith(new HouseholdError('household.errors.refused'));
      button('.plans-new-goal').click();
      const ref = openDialog<HouseholdGoalDialogComponent>();
      ref.componentInstance.form.patchValue({ name: 'Bike', targetAmount: 300 });
      await ref.componentInstance.submit();
      await settle();

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.refused');
      expect(dialog.openDialogs).toEqual([ref]);
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it("send every save of a contribution's dialog under the id it opened with, and a new dialog's under its own", async () => {
      writes.addContribution.and.rejectWith(new HouseholdError('household.errors.unconfirmed'));
      button('.plan-contribute', card('Holiday')).click();
      const ref = openDialog<HouseholdContributionDialogComponent>();
      ref.componentInstance.form.patchValue({ amount: 75 });
      await ref.componentInstance.submit();
      await settle();
      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.unconfirmed');
      expect(dialog.openDialogs).toEqual([ref]);

      writes.addContribution.and.resolveTo('c-new');
      ref.componentInstance.form.patchValue({ amount: 80 });
      await ref.componentInstance.submit();
      await settle();
      expect(dialog.openDialogs).toEqual([]);

      button('.plan-contribute', card('Holiday')).click();
      const next = openDialog<HouseholdContributionDialogComponent>();
      next.componentInstance.form.patchValue({ amount: 75 });
      await next.componentInstance.submit();
      await settle();

      expect(writes.addContribution.calls.allArgs().map(args => args[3]))
        .withContext('a save sent again is the same contribution; a new dialog is another')
        .toEqual(['id-1', 'id-1', 'id-2']);
    });

    it("send every save of a new budget's or goal's dialog under the id it opened with", async () => {
      writes.createBudget.and.rejectWith(new HouseholdError('household.errors.unconfirmed'));
      writes.createGoal.and.rejectWith(new HouseholdError('household.errors.unconfirmed'));

      button('.plans-new-budget').click();
      const budget = openDialog<HouseholdBudgetDialogComponent>();
      budget.componentInstance.form.patchValue({ name: 'Home', categoryIds: ['food'], amount: 900 });
      await budget.componentInstance.submit();
      await settle();
      writes.createBudget.and.resolveTo('b-new');
      await budget.componentInstance.submit();
      await settle();

      button('.plans-new-goal').click();
      const goal = openDialog<HouseholdGoalDialogComponent>();
      goal.componentInstance.form.patchValue({ name: 'Bike', targetAmount: 300 });
      await goal.componentInstance.submit();
      await settle();
      writes.createGoal.and.resolveTo('g-new');
      await goal.componentInstance.submit();
      await settle();

      expect(writes.createBudget.calls.allArgs().map(args => args[1])).toEqual(['id-1', 'id-1']);
      expect(writes.createGoal.calls.allArgs().map(args => args[1])).toEqual(['id-2', 'id-2']);
      expect(dialog.openDialogs).toEqual([]);
    });

    it('run one action at a time, refusing rather than queueing another while a dialog is open or a write is on its way', async () => {
      button('.plans-new-budget').click();
      button('.plans-new-goal').click();
      button('.plan-delete', card('Groceries')).click();
      expect(dialog.openDialogs.length).withContext('a dialog is open').toBe(1);
      expect(openDialog().componentInstance).toBeInstanceOf(HouseholdBudgetDialogComponent);
      openDialog<HouseholdBudgetDialogComponent>().componentInstance.cancel();
      await settle();

      let deleted!: () => void;
      writes.deleteBudget.and.returnValue(new Promise<void>(resolve => (deleted = resolve)));
      button('.plan-delete', card('Groceries')).click();
      await answerConfirm(true);
      render();

      // Every control says it is not offered meanwhile, staying focusable so
      // focus is not dropped on the document, and a press on one, or one
      // reached from script, is refused.
      const enabled = all('.plans button').filter(each => each.getAttribute('aria-disabled') !== 'true');
      expect(enabled.map(each => each.className)).toEqual([]);
      button('.plans-new-budget').click();
      button('.plan-edit', card('Fuel')).click();
      await fixture.componentInstance.editBudget('b2');
      await fixture.componentInstance.newGoal(new Event('click'));
      expect(dialog.openDialogs.length).withContext('a write is on its way').toBe(0);
      expect(writes.deleteBudget).toHaveBeenCalledTimes(1);

      deleted();
      // The write's chain settles over several turns; a task later it has.
      await new Promise(resolve => setTimeout(resolve));
      await settle();
      expect(button('.plans-new-goal').getAttribute('aria-disabled')).toBeNull();
      button('.plans-new-goal').click();
      expect(dialog.openDialogs.length).toBe(1);
    });

    it("name each card's heading by an id any document id is safe in, each reference resolving", async () => {
      plans.budgets.set([budgetFigures({ id: 'b 1.#"x', name: 'Odd' }), budgetFigures({ id: 'b_1', name: 'Plain' })]);
      plans.goals.set([goalFigures({ id: 'g 2]', name: 'Odder' })]);
      render();

      const headings = all('h4.plan-name');
      expect(headings.length).toBe(3);
      for (const heading of headings) {
        expect(heading.id).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(element().querySelector(`#${heading.id}`)).toBe(heading);
      }
      expect(new Set(headings.map(heading => heading.id)).size).withContext('no two ids alike').toBe(3);
      const goal = card('Odder');
      const describedBy = button('.plan-contribute', goal).getAttribute('aria-describedby');
      expect(element().querySelector(`#${describedBy}`)).toBe(goal?.querySelector('h4.plan-name') ?? null);
      const labelledBy = goal?.querySelector('ul.contributions')?.getAttribute('aria-labelledby');
      expect(element().querySelector(`#${labelledBy}`)?.classList).toContain('contributions-title');

      // Focus lands on a plan made under such an id.
      writes.createGoal.and.resolveTo('g new#1');
      const host = element();
      document.body.appendChild(host);
      try {
        button('.plans-new-goal').click();
        const ref = openDialog<HouseholdGoalDialogComponent>();
        ref.componentInstance.form.patchValue({ name: 'Bike', targetAmount: 300 });
        await ref.componentInstance.submit();
        await settle();
        plans.goals.update(goals => [...goals, goalFigures({ id: 'g new#1', name: 'Bike' })]);
        render();
        await settle();
        expect(readAs(document.activeElement)).toBe('Bike');
      } finally {
        host.remove();
      }
    });

    describe('tied to the household it was opened for', () => {
      const newBudget = (): MatDialogRef<HouseholdBudgetDialogComponent> => {
        button('.plans-new-budget').click();
        const ref = openDialog<HouseholdBudgetDialogComponent>();
        ref.componentInstance.form.patchValue({ name: 'Home', categoryIds: ['food'], amount: 900 });
        return ref;
      };

      it('close a dialog once the page shows another household, having written nothing', async () => {
        const ref = newBudget();

        shown.set({ ...HOME, id: 'h2', name: 'Other' });
        render();
        await firstValueFrom(ref.afterClosed());
        await settle();

        expect(dialog.openDialogs.length).toBe(0);
        expect(writes.createBudget).not.toHaveBeenCalled();
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('keep a dialog open through a rename of the household it was opened for', async () => {
        newBudget();

        shown.set({ ...HOME, name: 'Renamed' });
        render();
        await settle();

        expect(dialog.openDialogs.length).toBe(1);
      });

      const elsewhere: [string, () => Household | null][] = [
        ['another household', () => ({ ...HOME, id: 'h2' })],
        ['another generation of it', () => ({ ...HOME, createdAt: Timestamp.fromMillis(GEN.toMillis() + 1) })],
        ['no household', () => null]
      ];
      for (const [what, next] of elsewhere) {
        it(`refuse a save made once the page shows ${what}, before anything is sent`, async () => {
          const ref = newBudget();

          // Saved before the section has looked again.
          shown.set(next());
          await ref.componentInstance.submit();

          expect(writes.createBudget).not.toHaveBeenCalled();
          expect(notification.error).toHaveBeenCalledOnceWith('household.errors.refused');
          expect(notification.success).not.toHaveBeenCalled();
          expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
        });
      }

      it('refuse a delete confirmed once the page shows another household', async () => {
        button('.plan-delete', card('Groceries')).click();
        shown.set({ ...HOME, id: 'h2' });
        const ref = openDialog<ConfirmDialogComponent>();
        ref.close(true);
        await firstValueFrom(ref.afterClosed());
        await settle();

        expect(writes.deleteBudget).not.toHaveBeenCalled();
        expect(notification.success).not.toHaveBeenCalled();
      });

      it('close its dialog when the section goes, saying and counting nothing', async () => {
        const ref = newBudget();

        fixture.destroy();
        await firstValueFrom(ref.afterClosed());

        expect(dialog.openDialogs.length).toBe(0);
        expect(writes.createBudget).not.toHaveBeenCalled();
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });
    });
  });

  describe('while the plans load', () => {
    beforeEach(() => {
      // As the page shows it: the household is handed to the plans before
      // the section is made, so its lists have not answered yet.
      fixture.destroy();
      plans.loading.set(true);
      fixture = TestBed.createComponent(HouseholdPlansComponent);
      render();
    });

    it('waits for them, rather than saying there are none', () => {
      expect(element().querySelector('app-loading-spinner')).not.toBeNull();
      expect(element().querySelector('.plans-empty')).toBeNull();

      plans.loading.set(false);
      render();

      expect(element().querySelector('app-loading-spinner')).toBeNull();
      expect(element().querySelector('.plans-empty')).not.toBeNull();
    });

    it('shows no figures before the first answer, and keeps them shown through a later wait', () => {
      plans.budgets.set([budgetFigures({}, { spent: 0 })]);
      render();
      expect(element().querySelector('.plan-card')).withContext('no spending read yet').toBeNull();

      plans.loading.set(false);
      plans.budgets.set([budgetFigures()]);
      render();
      expect(all('.plan-card').length).toBe(1);

      // A goal made later has its own listener to wait for.
      plans.loading.set(true);
      plans.goals.set([goalFigures()]);
      render();
      expect(element().querySelector('app-loading-spinner')).toBeNull();
      expect(all('.plan-card').length).toBe(2);
    });
  });

  describe('while a plan is counted again', () => {
    beforeEach(() => {
      plans.budgets.set([budgetFigures()]);
      plans.goals.set([goalFigures({}, { linked: 100, saved: 350, fraction: 0.35 })]);
      render();
    });

    it("keeps a budget's last figures, rather than dropping them to nothing, until its copies are read again", () => {
      // A new day, say: the window's copies are read afresh.
      plans.loading.set(true);
      plans.budgets.set([budgetFigures({ name: 'Food' }, { spent: 0, counting: true })]);
      render();

      const card = element().querySelector('.plans-budgets .plan-card');
      expect(text(card?.querySelector('h4.plan-name'))).withContext('the name is not held').toBe('Food');
      expect(text(card?.querySelector('.plan-amount'))).toBe('USD 150.00');
      expect(text(card?.querySelector('.plan-percent'))).toBe('38%');
      expect(card?.querySelector('.plan-counting')).toBeNull();

      plans.loading.set(false);
      plans.budgets.set([budgetFigures({ name: 'Food' }, { spent: 20 })]);
      render();
      expect(text(element().querySelector('.plans-budgets .plan-amount'))).toBe('USD 20.00');
    });

    it("keeps a goal's last figures and contributions until what it counts is read again", () => {
      // Another goal made: every goal's linked copies are read afresh.
      plans.loading.set(true);
      plans.goals.set([
        goalFigures({}, { linked: 0, saved: 250, fraction: 0.25, counting: true }),
        goalFigures({ id: 'g2', name: 'Car' }, { saved: 0, contributed: 0, fraction: 0, contributions: [], counting: true })
      ]);
      render();

      const [held, made] = all('.plans-goals .plan-card');
      expect(text(held.querySelector('.plan-amount'))).toBe('EUR 350.00');
      expect(text(held.querySelector('.plan-percent'))).toBe('35%');
      expect(held.querySelectorAll('li.contribution').length).toBe(2);

      // Nothing was ever counted for the new one: it says it is counting, not 0%.
      expect(text(made.querySelector('h4.plan-name'))).toBe('Car');
      expect(text(made.querySelector('.plan-counting'))).toBe('household.plans.counting');
      expect(made.querySelector('.plan-figures')).toBeNull();
      expect(made.querySelector('mat-progress-bar')).toBeNull();
      expect(made.querySelector('.contributions-empty')).withContext('its contributions are not read yet').toBeNull();
      expect(made.querySelector('.contributions-title')).toBeNull();
    });

    it('says a budget made since is counting, not that it has spent nothing', () => {
      plans.loading.set(true);
      plans.budgets.set([budgetFigures(), budgetFigures({ id: 'b2', name: 'Fuel' }, { spent: 0, counting: true })]);
      render();

      const made = all('.plans-budgets .plan-card')[1];
      expect(text(made.querySelector('.plan-counting'))).toBe('household.plans.counting');
      expect(made.querySelector('.plan-percent')).toBeNull();
      expect(made.querySelector('.plan-alert')).toBeNull();
    });
  });

  describe('when the plans came only from this device', () => {
    it('says offline that they are not loaded here, rather than that there are none', () => {
      online.set(false);
      plans.fromCache.set(true);
      render();

      expect(element().querySelector('.plans-empty')).toBeNull();
      expect(element().querySelector('app-loading-spinner')).toBeNull();
      expect(readAs(element().querySelector('.plans-offline'))).toBe('household.plans.notLoaded');
    });

    it('waits online for the server, rather than saying there are none', () => {
      plans.fromCache.set(true);
      render();

      expect(element().querySelector('.plans-empty')).toBeNull();
      expect(element().querySelector('.plans-offline')).toBeNull();
      expect(element().querySelector('app-loading-spinner')).not.toBeNull();

      plans.fromCache.set(false);
      render();
      expect(element().querySelector('app-loading-spinner')).toBeNull();
      expect(element().querySelector('.plans-empty')).not.toBeNull();
    });

    it('says there are none offline when the server said so', () => {
      online.set(false);
      render();

      expect(element().querySelector('.plans-empty')).not.toBeNull();
      expect(element().querySelector('.plans-offline')).toBeNull();
    });

    it('says first that the lists could not all be read', () => {
      online.set(false);
      plans.fromCache.set(true);
      plans.incomplete.set(true);
      render();

      expect(readAs(element().querySelector('.plans-note'))).toBe('household.plans.listIncomplete');
      expect(element().querySelector('.plans-offline')).toBeNull();
      expect(element().querySelector('.plans-empty')).toBeNull();
    });

    it('shows the plans it holds, figures and all, offline', () => {
      online.set(false);
      plans.fromCache.set(true);
      plans.budgets.set([budgetFigures()]);
      render();

      expect(text(element().querySelector('.plans-budgets .plan-amount'))).toBe('USD 150.00');
      expect(element().querySelector('.plans-offline')).toBeNull();
    });
  });

  it('says the lists may be missing some, and not that there are none, when they could not all be read', () => {
    plans.incomplete.set(true);
    render();

    const note = element().querySelector('.plans-note');
    expect(note?.getAttribute('role')).toBe('status');
    expect(readAs(note)).toBe('household.plans.listIncomplete');
    expect(element().querySelector('.plans-empty')).toBeNull();
  });

  // In each theme class, for the reason PLAN_AUDIT_THEMES gives.
  for (const theme of PLAN_AUDIT_THEMES) {
    it(`gives axe nothing to report with budgets and goals shown, every note, caption and control included, in the ${theme}`, async () => {
      plans.incomplete.set(true);
      plans.budgets.set([
        budgetFigures({}, { atTodaysRate: true, incomplete: true }),
        budgetFigures({ id: 'b2' }, { spent: 500 }),
        budgetFigures({ id: 'b3' }, { spent: 360 })
      ]);
      plans.goals.set([
        goalFigures({}, { atTodaysRate: true, incomplete: true }),
        goalFigures({ id: 'g2', targetDate: undefined }, { contributions: [] })
      ]);
      render();
      // A plan made while the others are counted again.
      plans.loading.set(true);
      plans.goals.update(goals => [...goals, goalFigures({ id: 'g3' }, { counting: true })]);
      render();
      expect(all('.plan-counting').length).toBe(1);
      expect(all('.plan-edit, .plan-delete, .plan-contribute, .contribution-delete').length).toBeGreaterThan(0);
      const host = fixture.nativeElement as HTMLElement;
      document.documentElement.classList.add(theme);
      document.body.appendChild(host);

      try {
        expect(summarizeViolations(await runAxe(host))).toEqual([]);
      } finally {
        host.remove();
        document.documentElement.classList.remove(theme);
      }
    });
  }

  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.width = '311px';
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels. Material takes its face from the --mat-sys
      // tokens rather than from the host.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    /** Every part named stays inside the section, with nothing spilling out of it. */
    function expectInside(selectors: string[]): void {
      const section = (element().querySelector('.plans') as HTMLElement).getBoundingClientRect();
      for (const selector of selectors) {
        const parts = all(selector);
        expect(parts.length).withContext(`${selector} is shown`).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.scrollWidth).withContext(`nothing overflows ${selector}`).toBeLessThanOrEqual(part.clientWidth);
          const rect = part.getBoundingClientRect();
          expect(rect.left).withContext(`${selector} starts inside`).toBeGreaterThanOrEqual(section.left - 0.5);
          expect(rect.right).withContext(`${selector} ends inside`).toBeLessThanOrEqual(section.right + 0.5);
        }
      }
    }

    it('keeps the heading and the note inside the section', () => {
      const translation = TestBed.inject(TranslationService) as unknown as ReturnType<typeof createTranslationStub>;
      // Longer than any locale's copy, as one unbroken word.
      translation.t = key => (key === 'household.plans.empty' ? 'N'.repeat(120) : key);
      translation.translationsVersion.update(version => version + 1);
      render();

      expect(element().querySelector('.plans-empty')?.textContent).toContain('N'.repeat(120));
      expectInside(['.plans-title', '.plans-empty', '.plans-actions']);
    });

    it('keeps the longest names and figures inside each card', () => {
      // A name at its longest, as one unbroken word, and figures past any
      // household's: each wider than the card at its own size, so it fits
      // only by scaling.
      const name = 'N'.repeat(100);
      const huge = 987_654_321_098_765_400_000;
      members.set([member('me', 'A'.repeat(100)), member('kai', 'K'.repeat(100))]);
      plans.budgets.set([
        budgetFigures({ name, amount: huge }, { spent: huge, atTodaysRate: true, incomplete: true })
      ]);
      plans.goals.set([
        goalFigures(
          { name, targetAmount: huge },
          {
            saved: huge / 8,
            fraction: 0.125,
            atTodaysRate: true,
            incomplete: true,
            contributions: [contribution('c1', 'kai', huge, new Date(2026, 8, 20))]
          }
        )
      ]);
      render();
      TestBed.inject(FitTextRegistry).flush();

      expectInside([
        '.plans-subtitle',
        '.plan-card',
        '.plan-name',
        '.plan-figures',
        '.plan-meta',
        '.plan-target-date',
        'mat-progress-bar',
        '.rate-caption',
        '.plan-incomplete',
        '.contributions-title',
        'li.contribution',
        '.contribution-amount',
        '.contribution-date',
        'app-member-chip',
        '.plan-alert',
        '.plans-actions',
        '.plan-head',
        '.plan-actions',
        '.contribution-delete',
        // Measured at their labels: an outlined button's own ripple layer sits
        // a pixel out over its border, so its scroll size always leads its
        // client size by one.
        '.plans-actions .mdc-button__label',
        '.plan-contribute .mdc-button__label'
      ]);
      for (const outlined of all('.plans-actions button, .plan-contribute')) {
        const box = outlined.getBoundingClientRect();
        const label = (outlined.querySelector('.mdc-button__label') as HTMLElement).getBoundingClientRect();
        expect(label.left).withContext(`${outlined.className} holds its label`).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(label.right).withContext(`${outlined.className} holds its label`).toBeLessThanOrEqual(box.right + 0.5);
      }

      // A figure scales to fit, and never breaks between its digits.
      for (const figure of all('.plan-amount, .plan-of, .plan-percent, .contribution-amount')) {
        const size = parseFloat(getComputedStyle(figure).fontSize);
        expect(figure.getBoundingClientRect().height)
          .withContext(`${figure.className} "${text(figure)}" on one line`)
          .toBeLessThan(size * 1.8);
      }
    });
  });
});
