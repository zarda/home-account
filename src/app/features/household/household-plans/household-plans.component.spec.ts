import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { HouseholdPlansComponent } from './household-plans.component';
import { AuthService } from '../../../core/services/auth.service';
import {
  HouseholdLedgerService,
  LedgerBudget,
  LedgerKind,
  MemberBudgets,
  MemberGoals
} from '../../../core/services/household-ledger.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  createBudget,
  createCategory,
  createLocaleFormatStub,
  createTimestamp,
  createTranslationStub
} from '../../../core/services/testing';
import { BudgetProgressCardComponent } from '../../budgets/budget-progress-card/budget-progress-card.component';
import { GoalProgressCardComponent } from '../../budgets/goals/goal-progress-card/goal-progress-card.component';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';
import { Category, Goal, HouseholdMemberIdentity } from '../../../models';

interface FakeLedger {
  budgetsByMember: WritableSignal<MemberBudgets[]>;
  goalsByMember: WritableSignal<MemberGoals[]>;
  categoriesByMember: WritableSignal<ReadonlyMap<string, Map<string, Category>>>;
  incomplete: WritableSignal<Record<LedgerKind, HouseholdMemberIdentity[]>>;
  /** The period's rows included: what the overview waits on, not this section. */
  loading: WritableSignal<boolean>;
  plansLoading: WritableSignal<boolean>;
}

/** The viewer. */
const alex: HouseholdMemberIdentity = { uid: 'alex', displayName: 'Alex' };
const sam: HouseholdMemberIdentity = { uid: 'sam', displayName: 'Sam Ito' };
const kai: HouseholdMemberIdentity = { uid: 'kai', displayName: 'Kai' };

const NOTHING_FAILED: Record<LedgerKind, HouseholdMemberIdentity[]> =
  { transactions: [], categories: [], budgets: [], goals: [] };

/** Each member's own categories: the same id means a different thing to each. */
const alexCategories = new Map<string, Category>([
  ['custom-1', createCategory({ id: 'custom-1', name: 'Climbing gym', icon: 'fitness_center' })]
]);
const samCategories = new Map<string, Category>([
  ['custom-1', createCategory({ id: 'custom-1', name: 'Tea shop', icon: 'local_cafe' })]
]);

function budget(id: string, overrides: Partial<LedgerBudget> = {}): LedgerBudget {
  return {
    ...createBudget({ id, categoryId: 'custom-1', amount: 500, spent: 120, currency: 'USD', ...overrides }),
    stale: false,
    ...overrides
  };
}

function goal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    userId: 'someone',
    kind: 'saving',
    name: 'Holiday',
    targetAmount: 2000,
    contributedAmount: 500,
    currency: 'USD',
    isActive: true,
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    ...overrides
  };
}

// Rendered throughout (ADR 0144), the real cards included: that the cards
// come out read-only, in their own currency and with their own member's
// category, is the thing under test.
describe('HouseholdPlansComponent', () => {
  let fixture: ComponentFixture<HouseholdPlansComponent>;
  let ledger: FakeLedger;
  let online: WritableSignal<boolean>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const groups = (): HTMLElement[] => Array.from(element().querySelectorAll<HTMLElement>('.plans-member'));
  const group = (name: string): HTMLElement | undefined =>
    groups().find(g => g.querySelector('.plans-member-head app-member-chip')?.textContent?.includes(name));
  const budgetCards = () => fixture.debugElement.queryAll(By.directive(BudgetProgressCardComponent));
  const goalCards = () => fixture.debugElement.queryAll(By.directive(GoalProgressCardComponent));

  function render(): void {
    fixture.detectChanges();
  }

  /**
   * Alex has a budget and a goal, Sam two budgets in yen and a goal in euros
   * with a checklist; Kai has neither.
   */
  function answered(): void {
    ledger.budgetsByMember.set([
      { member: alex, budgets: [budget('b-a1', { name: 'Climbing' })] },
      {
        member: sam,
        budgets: [
          budget('b-s1', { name: 'Tea', currency: 'JPY', amount: 30000, spent: 12000 }),
          budget('b-s2', { name: 'Rent', currency: 'JPY', amount: 90000, spent: 0, stale: true })
        ]
      },
      { member: kai, budgets: [] }
    ]);
    ledger.goalsByMember.set([
      { member: alex, goals: [goal('g-a1', { name: 'New rope' })] },
      {
        member: sam,
        goals: [
          goal('g-s1', {
            name: 'Kyoto trip',
            kind: 'project',
            currency: 'EUR',
            contributedAmount: 750,
            items: [
              { name: 'Rail pass', amount: 200, done: true },
              { name: 'Ryokan', amount: 400, done: false }
            ]
          })
        ]
      },
      { member: kai, goals: [] }
    ]);
    ledger.categoriesByMember.set(new Map([['alex', alexCategories], ['sam', samCategories], ['kai', new Map()]]));
    ledger.plansLoading.set(false);
    ledger.loading.set(false);
  }

  beforeEach(async () => {
    ledger = {
      budgetsByMember: signal([]),
      goalsByMember: signal([]),
      categoriesByMember: signal(new Map()),
      incomplete: signal(NOTHING_FAILED),
      loading: signal(true),
      plansLoading: signal(true)
    };
    online = signal(true);

    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount.toFixed(2)}`);

    await TestBed.configureTestingModule({
      imports: [HouseholdPlansComponent],
      providers: [
        provideNoopAnimations(),
        { provide: HouseholdLedgerService, useValue: ledger },
        { provide: AuthService, useValue: { userId: signal<string | null>(alex.uid) } },
        { provide: CurrencyService, useValue: currency },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdPlansComponent);
    render();
  });

  describe('its members', () => {
    beforeEach(() => {
      answered();
      render();
    });

    it('groups the cards by member, in list order, each group headed by their chip', () => {
      const heads = groups().map(g => g.querySelector('.plans-member-head app-member-chip .member-name')?.textContent);

      expect(heads).toEqual(['Alex', 'Sam Ito', 'Kai']);
      expect(group('Alex')?.querySelectorAll('app-budget-progress-card').length).toBe(1);
      expect(group('Alex')?.querySelectorAll('app-goal-progress-card').length).toBe(1);
      expect(group('Sam Ito')?.querySelectorAll('app-budget-progress-card').length).toBe(2);
      expect(group('Sam Ito')?.querySelectorAll('app-goal-progress-card').length).toBe(1);
    });

    it("heads each group with the member's name, each card's name a heading under it", () => {
      expect(element().querySelector('h2')?.textContent).toContain('household.plans.title');
      const head = group('Sam Ito')?.querySelector('.plans-member-head') as HTMLElement;
      expect(head.tagName).toBe('H3');

      // Every card's name sits one level below its member's, budgets and
      // goals alike, so the outline nests each plan under its owner.
      const names = Array.from(group('Sam Ito')?.querySelectorAll<HTMLElement>('.budget-name, .goal-name') ?? []);
      expect(names.map(name => name.textContent?.trim())).toEqual(['Tea', 'Rent', 'Kyoto trip']);
      for (const name of names) {
        const level = name.tagName === 'H4' ? '4' : name.getAttribute('role') === 'heading' && name.getAttribute('aria-level');
        expect(level).withContext(`${name.textContent?.trim()} is a level-4 heading`).toBe('4');
      }
      expect(element().querySelectorAll('.plans-member h3').length)
        .withContext('only the member heads are h3')
        .toBe(groups().length);
    });

    it('labels each of a member\'s lists by its kind', () => {
      // A label, not a heading: a "Budgets" heading at the cards' level
      // would put the goals under the last budget.
      const lists = Array.from(group('Sam Ito')?.querySelectorAll<HTMLElement>('ul.plans-cards') ?? []);
      const labels = lists.map(list =>
        element().querySelector(`[id="${list.getAttribute('aria-labelledby')}"]`)?.textContent?.trim()
      );
      expect(labels).toEqual(['budget.budgets', 'budget.goals']);
      const ids = Array.from(element().querySelectorAll('.plans-subtitle')).map(label => label.id);
      expect(new Set(ids).size).withContext('every label has its own id').toBe(ids.length);
    });

    it('shows every card read-only, and nothing in the section is a control', () => {
      expect(budgetCards().length).toBe(3);
      expect(goalCards().length).toBe(2);
      for (const card of [...budgetCards(), ...goalCards()]) {
        expect((card.componentInstance as BudgetProgressCardComponent | GoalProgressCardComponent).readOnly())
          .toBeTrue();
      }
      // A progress bar carries Material's own tabindex="-1": no tab stop.
      // An enabled checkbox would carry tabindex="0".
      expect(element().querySelectorAll('button, a, [tabindex]:not([tabindex="-1"])').length).toBe(0);
      const boxes = Array.from(element().querySelectorAll<HTMLInputElement>('mat-checkbox input'));
      expect(boxes.length).withContext("Sam's checklist is shown").toBe(2);
      expect(boxes.every(box => box.disabled)).toBeTrue();
    });

    it('shows each card in its own currency, the members\' currencies side by side', () => {
      const tea = budgetCards()[1].nativeElement as HTMLElement;
      const kyoto = goalCards()[1].nativeElement as HTMLElement;
      const climbing = budgetCards()[0].nativeElement as HTMLElement;

      expect(tea.querySelector('.spent')?.textContent?.trim()).toBe('JPY 12000.00');
      expect(tea.querySelector('.limit')?.textContent?.trim()).toBe('/ JPY 30000.00');
      expect(kyoto.querySelector('.contributed')?.textContent?.trim()).toBe('EUR 750.00');
      expect(climbing.querySelector('.spent')?.textContent?.trim()).toBe('USD 120.00');
    });

    it("resolves each budget's category through its own member's categories", () => {
      const [climbing, tea] = budgetCards();

      expect((climbing.componentInstance as BudgetProgressCardComponent).category()?.name).toBe('Climbing gym');
      expect((tea.componentInstance as BudgetProgressCardComponent).category()?.name).toBe('Tea shop');
      expect((climbing.nativeElement as HTMLElement).textContent).toContain('fitness_center');
      expect((tea.nativeElement as HTMLElement).textContent).toContain('local_cafe');
    });

    it('notes a stale budget beside its card, and only that one', () => {
      const notes = Array.from(element().querySelectorAll('.plans-stale'));

      expect(notes.length).toBe(1);
      expect(notes[0].textContent).toContain('household.plans.stale:{"name":"Sam Ito"}');
      const rent = notes[0].closest('.plans-card');
      expect(rent?.querySelector('.budget-name')?.textContent).toContain('Rent');
      expect(rent?.querySelector('.spent')?.textContent?.trim()).toBe('JPY 0.00');
    });

    it('gives a member with neither budgets nor goals an empty state of their own', () => {
      const empty = group('Kai')?.querySelector('.plans-empty');

      expect(empty?.textContent).toContain('household.plans.empty');
      expect(group('Kai')?.querySelector('.plans-subtitle')).toBeNull();
      expect(element().querySelectorAll('.plans-empty').length).toBe(1);
    });

    it('titles only the kinds a member has', () => {
      ledger.goalsByMember.update(lines => lines.map(line => (line.member === sam ? { ...line, goals: [] } : line)));
      render();

      const subtitles = Array.from(group('Sam Ito')?.querySelectorAll('.plans-subtitle') ?? [])
        .map(label => label.textContent?.trim());
      expect(subtitles).toEqual(['budget.budgets']);
      expect(group('Sam Ito')?.querySelector('.plans-empty')).toBeNull();
    });

    it('names an unnamed member all the same', () => {
      const anon: HouseholdMemberIdentity = { uid: 'anon', displayName: ' ' };
      ledger.budgetsByMember.set([{ member: anon, budgets: [budget('b-x', { stale: true, spent: 0 })] }]);
      ledger.goalsByMember.set([{ member: anon, goals: [] }]);
      render();

      expect(text()).toContain('household.plans.stale:{"name":"household.unnamedMember"}');
    });
  });

  describe('its notes about members', () => {
    beforeEach(() => {
      answered();
      render();
    });

    it("names a member whose budgets may not all have been read", () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, budgets: [sam] });
      render();

      expect(text()).toContain('household.plans.budgetsIncomplete:{"name":"Sam Ito"}');
      expect(text()).not.toContain('household.plans.goalsIncomplete');
    });

    it("names a member whose goals may not all have been read", () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, goals: [alex] });
      render();

      expect(text()).toContain('household.plans.goalsIncomplete:{"name":"Alex"}');
      expect(text()).not.toContain('household.plans.budgetsIncomplete');
    });

    it('names an unnamed member in the middle of a sentence in its own form', () => {
      const anon: HouseholdMemberIdentity = { uid: 'anon', displayName: '' };
      ledger.incomplete.set({ ...NOTHING_FAILED, budgets: [anon], goals: [anon] });
      render();

      expect(text()).toContain('household.plans.budgetsIncomplete:{"name":"household.unnamedMemberInline"}');
      expect(text()).toContain('household.plans.goalsIncomplete:{"name":"household.unnamedMemberInline"}');
    });

    it('says a member whose listener failed with nothing to show is not fully loaded, not empty', () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, budgets: [kai] });
      render();

      const kaiGroup = group('Kai');
      expect(kaiGroup?.querySelector('.plans-empty')).toBeNull();
      expect(kaiGroup?.querySelector('.plans-not-loaded')).toBeNull();
      expect(kaiGroup?.querySelector('.plans-read-failed')?.textContent).toContain('household.plans.readFailed');
    });

    it('keeps the cards a member does have when one of their listeners failed', () => {
      ledger.goalsByMember.update(lines =>
        lines.map(line => (line.member === kai ? { ...line, goals: [goal('g-k1', { name: 'Bike' })] } : line))
      );
      ledger.incomplete.set({ ...NOTHING_FAILED, budgets: [kai] });
      render();

      const kaiGroup = group('Kai');
      expect(kaiGroup?.querySelectorAll('app-goal-progress-card').length).toBe(1);
      expect(kaiGroup?.querySelector('.plans-read-failed')).toBeNull();
      expect(kaiGroup?.querySelector('.plans-empty')).toBeNull();
    });

    it('leaves unread transactions and categories to the section that shows them', () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, transactions: [alex], categories: [sam] });
      render();

      expect(element().querySelector('.plans-note')).toBeNull();
    });

    it('says nothing while every member reads in full', () => {
      expect(element().querySelector('.plans-note')).toBeNull();
    });
  });

  describe('its waiting and offline states', () => {
    it('shows progress, not an empty member, while a member has not answered', () => {
      ledger.budgetsByMember.set([{ member: alex, budgets: [] }]);
      ledger.goalsByMember.set([{ member: alex, goals: [] }]);
      ledger.loading.set(false);
      render();

      expect(element().querySelector('app-loading-spinner mat-spinner')?.getAttribute('aria-label'))
        .toBe('household.plans.loading');
      expect(element().querySelector('.plans-empty')).toBeNull();
      expect(element().querySelector('.plans-member')).toBeNull();
    });

    it("keeps every card while only the period's rows are being read", () => {
      answered();
      ledger.loading.set(true);
      render();

      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(budgetCards().length).toBe(3);
      expect(goalCards().length).toBe(2);
    });

    it('offline, says a member with nothing cached is not loaded rather than empty', () => {
      online.set(false);
      answered();
      render();

      const kaiGroup = group('Kai');
      expect(kaiGroup?.querySelector('.plans-empty')).toBeNull();
      expect(kaiGroup?.querySelector('.plans-not-loaded')?.textContent).toContain('household.plans.notLoaded');
      expect(group('Sam Ito')?.querySelectorAll('app-budget-progress-card').length)
        .withContext('a cached member keeps their cards').toBe(2);
    });

    it("offline, says the viewer's own empty group is empty: their plans are this device's own", () => {
      online.set(false);
      answered();
      ledger.budgetsByMember.update(lines => lines.map(line => (line.member === alex ? { ...line, budgets: [] } : line)));
      ledger.goalsByMember.update(lines => lines.map(line => (line.member === alex ? { ...line, goals: [] } : line)));
      render();

      const own = group('Alex');
      expect(own?.querySelector('.plans-not-loaded')).toBeNull();
      expect(own?.querySelector('.plans-empty')?.textContent).toContain('household.plans.empty');
      expect(group('Kai')?.querySelector('.plans-not-loaded')).not.toBeNull();
    });

    it('offline, shows what is cached rather than waiting', () => {
      online.set(false);
      answered();
      ledger.plansLoading.set(true);
      ledger.loading.set(true);
      render();

      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(budgetCards().length).toBe(3);
    });
  });

  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.width = '311px';
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    it('keeps the heading, every group, every card and every note inside the section', () => {
      answered();
      const long: HouseholdMemberIdentity = { uid: 'long', displayName: 'W'.repeat(100) };
      ledger.budgetsByMember.update(lines => [
        {
          member: long,
          budgets: [
            budget('b-l1', {
              name: `Groceries ${'B'.repeat(80)}`,
              currency: 'JPY',
              amount: 123456789012345,
              spent: 0,
              stale: true
            }),
            // Its spending is wider than its line at the card's figure size.
            budget('b-l2', { name: 'Rent', currency: 'JPY', amount: 9000000000000000, spent: 1234567890123456 })
          ]
        },
        ...lines
      ]);
      ledger.goalsByMember.update(lines => [
        {
          member: long,
          goals: [goal('g-l1', { name: `Deposit ${'G'.repeat(80)}`, currency: 'JPY', targetAmount: 98765432 })]
        },
        ...lines
      ]);
      ledger.incomplete.set({ ...NOTHING_FAILED, budgets: [long] });
      render();
      TestBed.inject(FitTextRegistry).flush();

      const section = (element().querySelector('.plans') as HTMLElement).getBoundingClientRect();
      const parts = Array.from(element().querySelectorAll<HTMLElement>(
        '.plans-title, .plans-note, .plans-member-head, .plans-card, .budget-card, .goal-card, ' +
        '.budget-name, .goal-name, .amount-text, .spent, .limit, .remaining, .plans-stale, .plans-empty'
      ));
      // A title and a note; four groups; eight cards, each in its list item
      // with its name; on each of five budget cards, its figures' line and
      // three figures; two stale notes; one empty state.
      expect(parts.length).toBe(2 + 4 + 8 * 3 + 5 * 4 + 2 + 1);
      expect(text()).withContext('every digit is shown').toContain('JPY 1234567890123456.00');
      for (const part of parts) {
        const label = part.className;
        expect(getComputedStyle(part).textOverflow).withContext(`${label} is not cut`).not.toBe('ellipsis');
        expect(part.scrollWidth).withContext(`nothing overflows ${label}`).toBeLessThanOrEqual(part.clientWidth);
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(section.left - 0.5);
        expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(section.right + 0.5);
      }
    });
  });
});
