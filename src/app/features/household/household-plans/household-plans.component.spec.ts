import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';

import { HouseholdPlansComponent } from './household-plans.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { HouseholdService } from '../../../core/services/household.service';
import { PwaService } from '../../../core/services/pwa.service';
import {
  HouseholdBudgetFigures,
  HouseholdGoalFigures,
  HouseholdPlansService
} from '../../../core/services/household-plans.service';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub, runAxe, summarizeViolations } from '../../../core/services/testing';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';
import { HouseholdBudget, HouseholdContribution, HouseholdGoal, HouseholdMember } from '../../../models';

const GEN = Timestamp.fromMillis(1_700_000_000_000);

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
  let online: WritableSignal<boolean>;

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
    online = signal(true);

    await TestBed.configureTestingModule({
      imports: [HouseholdPlansComponent],
      providers: [
        provideNoopAnimations(),
        { provide: HouseholdPlansService, useValue: plans },
        { provide: HouseholdService, useValue: { members } },
        { provide: PwaService, useValue: { isOnline: online } },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (amount: number, code: string) => `${code} ${amount.toFixed(2)}` }
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
      /** The card's bar colour, its percentage's tone and what its alert line says, in that order. */
      function signals(): [string | undefined, string[], string] {
        const card = element().querySelector('.plans-budgets .plan-card');
        const bar = card?.querySelector('mat-progress-bar');
        const colour = ['mat-primary', 'mat-accent', 'mat-warn'].find(name => bar?.classList.contains(name));
        const tone = ['over', 'near'].filter(name => card?.querySelector('.plan-percent')?.classList.contains(name));
        return [colour, tone, readAs(card?.querySelector('.plan-alert'))];
      }

      it('from its own threshold, with words beside the colour', () => {
        plans.budgets.set([budgetFigures({ alertThreshold: 70 }, { spent: 300 })]);
        render();
        expect(signals()).withContext('75% of a budget that warns at 70%').toEqual(['mat-accent', ['near'], 'budget.approachingLimit']);

        plans.budgets.set([budgetFigures({ alertThreshold: 80 }, { spent: 360 })]);
        render();
        expect(signals()).withContext('90%').toEqual(['mat-accent', ['near'], 'budget.almostAtLimit']);

        plans.budgets.set([budgetFigures({ alertThreshold: 95 }, { spent: 340 })]);
        render();
        expect(signals()).withContext('85% of a budget that warns at 95%').toEqual(['mat-primary', [], '']);
      });

      it('from the default threshold when the budget names none', () => {
        plans.budgets.set([budgetFigures({}, { spent: 320 })]);
        render();

        expect(signals()).withContext('80%').toEqual(['mat-accent', ['near'], 'budget.approachingLimit']);
      });

      it('as exceeded from the moment it reaches its limit', () => {
        plans.budgets.set([budgetFigures({}, { spent: 400 })]);
        render();

        expect(signals()).toEqual(['mat-warn', ['over'], 'budget.budgetExceeded']);
        expect(element().querySelector('.plans-budgets .plan-amount')?.classList).toContain('over');
      });

      it('not at all below it', () => {
        plans.budgets.set([budgetFigures({}, { spent: 150 })]);
        render();

        expect(signals()).toEqual(['mat-primary', [], '']);
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

  it('holds no control, and no personal budget or goal card', () => {
    plans.budgets.set([budgetFigures()]);
    plans.goals.set([goalFigures()]);
    render();

    expect(element().querySelector('app-budget-progress-card, app-goal-progress-card')).toBeNull();
    // Material's progress bar carries tabindex="-1": reachable from script, never by Tab.
    const reachable = all('button, a, input, [tabindex]:not([tabindex="-1"])');
    expect(reachable.map(node => node.outerHTML.slice(0, 120))).toEqual([]);
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

  it('gives axe nothing to report with budgets and goals shown, every note and caption included', async () => {
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
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);

    try {
      expect(summarizeViolations(await runAxe(host))).toEqual([]);
    } finally {
      host.remove();
    }
  });

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
      expectInside(['.plans-title', '.plans-empty']);
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
        '.plan-alert'
      ]);

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
