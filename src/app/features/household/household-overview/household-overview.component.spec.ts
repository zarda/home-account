import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { HouseholdOverviewComponent } from './household-overview.component';
import {
  HOUSEHOLD_LEDGER_ROW_CAP,
  HouseholdLedgerService,
  LedgerKind,
  LedgerRow,
  MemberTotals
} from '../../../core/services/household-ledger.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  createCategory,
  createLocaleFormatStub,
  createTransaction,
  createTranslationStub,
  createUser
} from '../../../core/services/testing';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';
import { Category, HouseholdMemberIdentity, User } from '../../../models';
import { TypeTotals } from '../../../core/utils/transaction-aggregation.utils';
import { clampWindowToNow, periodWindow } from '../../../core/utils/transaction-date.utils';

interface FakeLedger {
  rows: WritableSignal<LedgerRow[]>;
  totalsByMember: WritableSignal<MemberTotals[]>;
  combined: WritableSignal<TypeTotals>;
  categoriesByMember: WritableSignal<ReadonlyMap<string, Map<string, Category>>>;
  unavailable: WritableSignal<HouseholdMemberIdentity[]>;
  truncated: WritableSignal<HouseholdMemberIdentity[]>;
  incomplete: WritableSignal<Record<LedgerKind, HouseholdMemberIdentity[]>>;
  loading: WritableSignal<boolean>;
  setPeriod: jasmine.Spy;
}

// Alex is the viewer throughout.
const alex: HouseholdMemberIdentity = { uid: 'alex', displayName: 'Alex' };
const sam: HouseholdMemberIdentity = { uid: 'sam', displayName: 'Sam Ito' };
const kai: HouseholdMemberIdentity = { uid: 'kai', displayName: 'Kai' };

const NOTHING_FAILED: Record<LedgerKind, HouseholdMemberIdentity[]> =
  { transactions: [], categories: [], budgets: [], goals: [] };

const totals = (income: number, expense: number, count = 1): TypeTotals =>
  ({ income, expense, balance: income - expense, count });

/** Each member's own categories: the same id means a different thing to each. */
const alexCategories = new Map<string, Category>([
  ['custom-1', createCategory({ id: 'custom-1', name: 'Climbing gym', icon: 'fitness_center' })]
]);
const samCategories = new Map<string, Category>([
  ['custom-1', createCategory({ id: 'custom-1', name: 'Tea shop', icon: 'local_cafe' })]
]);

function row(memberUid: string, id: string, overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    ...createTransaction({ id, categoryId: 'custom-1', currency: 'USD', ...overrides }),
    memberUid
  };
}

// Rendered throughout (ADR 0144), the period selector and the rows included:
// what the page shows for each state of the ledger is the thing under test.
describe('HouseholdOverviewComponent', () => {
  let fixture: ComponentFixture<HouseholdOverviewComponent>;
  let ledger: FakeLedger;
  let online: WritableSignal<boolean>;
  let viewer: WritableSignal<User | null>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const rowsShown = () => fixture.debugElement.queryAll(By.directive(TransactionRowComponent));
  const emptyState = (): string => element().querySelector('app-empty-state')?.textContent ?? '';
  const memberLine = (name: string): HTMLElement | undefined =>
    Array.from(element().querySelectorAll<HTMLElement>('.member-line'))
      .find(line => line.querySelector('app-member-chip')?.textContent?.includes(name));

  function render(): void {
    fixture.detectChanges();
  }

  /** Two members with a row each, every listener answered. */
  function answered(): void {
    ledger.totalsByMember.set([
      { member: alex, totals: totals(1000, 250.5, 2) },
      { member: sam, totals: totals(0, 1200, 1) }
    ]);
    ledger.combined.set(totals(1000, 1450.5, 3));
    ledger.categoriesByMember.set(new Map([['alex', alexCategories], ['sam', samCategories]]));
    ledger.rows.set([
      row('sam', 'tx-s1', { description: 'Matcha', type: 'expense', amount: 1200 }),
      row('alex', 'tx-a1', { description: 'Pay', type: 'income', amount: 1000 }),
      row('alex', 'tx-a2', { description: 'Bouldering', type: 'expense', amount: 250.5 })
    ]);
    ledger.loading.set(false);
  }

  beforeEach(async () => {
    ledger = {
      rows: signal([]),
      totalsByMember: signal([]),
      combined: signal(totals(0, 0, 0)),
      categoriesByMember: signal(new Map()),
      unavailable: signal([]),
      truncated: signal([]),
      incomplete: signal(NOTHING_FAILED),
      loading: signal(true),
      setPeriod: jasmine.createSpy('setPeriod')
    };
    online = signal(true);
    viewer = signal<User | null>(
      createUser({ id: 'alex', preferences: { baseCurrency: 'USD' } as User['preferences'] })
    );

    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    // Signed the way Intl signs: the minus leads, before the currency.
    currency.formatCurrency.and.callFake(
      (amount: number, code: string) => `${amount < 0 ? '-' : ''}${code} ${Math.abs(amount).toFixed(2)}`
    );
    currency.amountInBase.and.callFake((t: { amount: number }) => t.amount);

    await TestBed.configureTestingModule({
      imports: [HouseholdOverviewComponent],
      providers: [
        provideNoopAnimations(),
        { provide: HouseholdLedgerService, useValue: ledger },
        { provide: CurrencyService, useValue: currency },
        {
          provide: AuthService,
          useValue: { currentUser: viewer, userId: computed(() => viewer()?.id ?? null) }
        },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdOverviewComponent);
    render();
  });

  describe('its period', () => {
    it("asks the ledger for this month on creation, to the end of today as the dashboard reads it", () => {
      const now = new Date();

      expect(ledger.setPeriod).toHaveBeenCalledTimes(1);
      expect(ledger.setPeriod).toHaveBeenCalledWith(clampWindowToNow(periodWindow('thisMonth', now), now));
    });

    it('follows the period selector', () => {
      ledger.setPeriod.calls.reset();
      const lastMonth = element().querySelector<HTMLButtonElement>('mat-button-toggle[value="lastMonth"] button');
      expect(lastMonth).withContext('the selector is on the page').not.toBeNull();

      lastMonth?.click();
      render();

      const now = new Date();
      expect(ledger.setPeriod).toHaveBeenCalledTimes(1);
      expect(ledger.setPeriod).toHaveBeenCalledWith(clampWindowToNow(periodWindow('lastMonth', now), now));
    });
  });

  describe('its figures', () => {
    beforeEach(() => {
      answered();
      render();
    });

    it("shows the household's combined totals in the viewer's base currency", () => {
      const cards = Array.from(element().querySelectorAll('app-stat-card')).map(card => card.textContent ?? '');

      expect(cards.length).toBe(3);
      expect(cards[0]).toContain('USD 1000.00');
      expect(cards[1]).toContain('USD 1450.50');
      expect(cards[2]).toContain('-\u2060USD 450.50');
      expect(cards.every(card => card.includes('USD'))).withContext('each names the base currency').toBeTrue();
    });

    it("gives each member a line: who, then income, expense and net", () => {
      const lines = Array.from(element().querySelectorAll('.member-line'));

      expect(lines.length).toBe(2);
      const [first, second] = lines;
      expect(first.querySelector('app-member-chip')?.textContent).toContain('Alex');
      expect(second.querySelector('app-member-chip')?.textContent).toContain('Sam Ito');

      const figures = (line: Element) =>
        Array.from(line.querySelectorAll('.member-figure')).map(figure => ({
          label: figure.querySelector('dt')?.textContent?.trim(),
          value: figure.querySelector('dd')?.textContent?.trim()
        }));
      expect(figures(first)).toEqual([
        { label: 'common.income', value: 'USD 1000.00' },
        { label: 'common.expense', value: 'USD 250.50' },
        { label: 'common.balance', value: 'USD 749.50' }
      ]);
      // A negative net keeps its sign on the figure: a word joiner holds it there.
      expect(figures(second)[2]).toEqual({ label: 'common.balance', value: '-\u2060USD 1200.00' });
      expect(second.querySelectorAll('.member-figure dd')[2].classList).toContain('negative');
    });

    it('shows a net below the smallest unit as zero, unsigned and not in the expense tone', () => {
      viewer.set(createUser({ id: 'alex', preferences: { baseCurrency: 'JPY' } as User['preferences'] }));
      ledger.totalsByMember.set([{ member: alex, totals: totals(100, 100.3, 2) }]);
      render();

      const net = memberLine('Alex')?.querySelectorAll('.member-figure dd')[2] as HTMLElement;
      expect(net.textContent?.trim()).toBe('JPY 0.00');
      expect(net.classList).not.toContain('negative');
    });
  });

  describe('its rows', () => {
    beforeEach(() => {
      answered();
      render();
    });

    it('lists every member\'s rows, newest first as the ledger merged them', () => {
      const described = rowsShown().map(debug =>
        (debug.componentInstance as TransactionRowComponent).transaction().description
      );

      expect(described).toEqual(['Matcha', 'Pay', 'Bouldering']);
    });

    it('shows them read-only: no row opens, and nothing in the list is a control', () => {
      for (const debug of rowsShown()) {
        const shown = debug.componentInstance as TransactionRowComponent;
        expect(shown.interactive()).toBeFalse();
        expect(shown.swipeActions()).toBeFalse();
      }
      const list = element().querySelector('.overview-rows') as HTMLElement;
      expect(list.querySelectorAll('button, a, [tabindex]').length).toBe(0);
    });

    it("resolves each row's category through its own member's categories", () => {
      const [matcha, pay] = rowsShown();

      expect((matcha.componentInstance as TransactionRowComponent).categories()).toBe(samCategories);
      expect((pay.componentInstance as TransactionRowComponent).categories()).toBe(alexCategories);
      expect(matcha.nativeElement.querySelector('.row-category')?.textContent).toContain('Tea shop');
      expect(pay.nativeElement.querySelector('.row-category')?.textContent).toContain('Climbing gym');
    });

    it('names whose each row is', () => {
      const [matcha, pay] = rowsShown();

      expect((matcha.componentInstance as TransactionRowComponent).member()).toBe(sam);
      expect((pay.componentInstance as TransactionRowComponent).member()).toBe(alex);
      expect(matcha.nativeElement.querySelector('.row-meta app-member-chip')?.textContent).toContain('Sam Ito');
    });
  });

  describe('its notes about members', () => {
    beforeEach(() => {
      answered();
      render();
    });

    it('names a member whose records the rules no longer share', () => {
      ledger.unavailable.set([kai]);
      render();

      expect(text()).toContain('household.overview.unavailable:{"name":"Kai"}');
    });

    it('names a member cut at the cap', () => {
      ledger.truncated.set([sam]);
      render();

      expect(text()).toContain(
        `household.overview.truncated:{"name":"Sam Ito","cap":${HOUSEHOLD_LEDGER_ROW_CAP}}`
      );
    });

    it('names a member whose transactions may not all have been read', () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, transactions: [alex] });
      render();

      expect(text()).toContain('household.overview.incomplete:{"name":"Alex"}');
      expect(text()).not.toContain('household.overview.categoriesIncomplete');
    });

    it('says a member\'s categories may not all have been read, apart from their figures', () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, categories: [sam] });
      render();

      expect(text()).toContain('household.overview.categoriesIncomplete:{"name":"Sam Ito"}');
      expect(text()).not.toContain('household.overview.incomplete:');
    });

    it('leaves a member\'s unread budgets and goals to the section that shows them', () => {
      ledger.incomplete.set({ ...NOTHING_FAILED, budgets: [alex], goals: [sam] });
      render();

      expect(element().querySelector('.overview-note')).toBeNull();
    });

    it('names an unnamed member all the same', () => {
      ledger.unavailable.set([{ uid: 'anon', displayName: '' }]);
      render();

      expect(text()).toContain('household.overview.unavailable:{"name":"household.unnamedMember"}');
    });

    it('says nothing while every member reads in full', () => {
      expect(element().querySelector('.overview-note')).toBeNull();
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

    it('keeps the heading, the period, every member line and every row inside the section', () => {
      answered();
      const long: HouseholdMemberIdentity = { uid: 'long', displayName: 'W'.repeat(100) };
      ledger.totalsByMember.set([
        { member: long, totals: totals(123456.78, 98765.43) },
        { member: alex, totals: totals(0, 1200) }
      ]);
      ledger.rows.update(rows => [
        row('long', 'tx-l1', { description: 'Rent', type: 'expense', amount: 98765.43 }),
        ...rows
      ]);
      render();
      TestBed.inject(FitTextRegistry).flush();

      const section = (element().querySelector('.overview') as HTMLElement).getBoundingClientRect();
      // The rows are measured in the padded card they really sit in, one of
      // them naming the long-named member. A row clips its own content, so
      // its line 3, where the name sits, is measured as well as its box.
      const parts = Array.from(element().querySelectorAll<HTMLElement>(
        '.overview-head, .member-line, .overview-row, .overview-row .row-meta'
      ));
      expect(parts.length).toBe(11);
      for (const part of parts) {
        const label = part.className;
        expect(part.scrollWidth).withContext(`nothing overflows ${label}`).toBeLessThanOrEqual(part.clientWidth);
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(section.left - 0.5);
        expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(section.right + 0.5);
      }
    });
  });

  describe('its empty and waiting states', () => {
    it('shows progress, not an empty period, while a member has not answered', () => {
      expect(element().querySelector('app-loading-spinner mat-spinner')?.getAttribute('aria-label'))
        .toBe('household.overview.loading');
      expect(element().querySelector('app-empty-state')).toBeNull();
      expect(element().querySelector('app-stat-card')).toBeNull();
    });

    it('says the period is empty once every member answered with nothing', () => {
      ledger.totalsByMember.set([{ member: alex, totals: totals(0, 0, 0) }]);
      ledger.loading.set(false);
      render();

      expect(emptyState()).toContain('household.overview.emptyTitle');
      expect(emptyState()).not.toContain('household.overview.offlineTitle');
      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(element().querySelectorAll('.member-line').length).withContext('a member line at zero').toBe(1);
    });

    it('offline with nothing cached, a household of one, says so rather than calling the period empty', () => {
      online.set(false);
      ledger.totalsByMember.set([{ member: alex, totals: totals(0, 0, 0) }]);
      ledger.loading.set(false);
      render();

      expect(emptyState()).toContain('household.overview.offlineTitle');
      expect(emptyState()).not.toContain('household.overview.emptyTitle');
      expect(element().querySelector('app-stat-card')).withContext('no zeros that are not known').toBeNull();
      expect(element().querySelector('mat-spinner')).toBeNull();
    });

    it('offline before any answer, says the same rather than waiting', () => {
      online.set(false);
      render();

      expect(emptyState()).toContain('household.overview.offlineTitle');
      expect(element().querySelector('mat-spinner')).toBeNull();
    });

    it('offline with rows cached, shows them', () => {
      online.set(false);
      answered();
      render();

      expect(rowsShown().length).toBe(3);
      expect(element().querySelector('app-empty-state')).toBeNull();
    });

    it("offline with only the viewer's own rows cached, says nothing is known rather than show the others at zero", () => {
      online.set(false);
      ledger.totalsByMember.set([
        { member: alex, totals: totals(1000, 250.5, 2) },
        { member: sam, totals: totals(0, 0, 0) }
      ]);
      ledger.combined.set(totals(1000, 250.5, 2));
      ledger.rows.set([row('alex', 'tx-a1', { type: 'income', amount: 1000 })]);
      ledger.loading.set(false);
      render();

      expect(emptyState()).toContain('household.overview.offlineTitle');
      expect(element().querySelector('app-stat-card')).withContext('no household total').toBeNull();
      expect(element().querySelectorAll('.member-line').length).withContext('no line at zero').toBe(0);
      expect(rowsShown().length).toBe(0);
    });

    it('offline in a household of one, shows what the viewer has cached', () => {
      online.set(false);
      ledger.totalsByMember.set([{ member: alex, totals: totals(1000, 0, 1) }]);
      ledger.combined.set(totals(1000, 0, 1));
      ledger.rows.set([row('alex', 'tx-a1', { type: 'income', amount: 1000 })]);
      ledger.loading.set(false);
      render();

      expect(rowsShown().length).toBe(1);
      expect(element().querySelectorAll('.member-line').length).toBe(1);
      expect(element().querySelector('app-empty-state')).toBeNull();
    });

    it('offline, puts a note in place of the figures of another member with nothing cached', () => {
      online.set(false);
      answered();
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      const kaiLine = memberLine('Kai');
      expect(kaiLine?.querySelector('.member-figures')).withContext('no zeros').toBeNull();
      expect(kaiLine?.textContent).toContain('household.overview.notLoaded');
      expect(memberLine('Sam Ito')?.querySelector('.member-figures')).withContext('a cached member keeps figures')
        .not.toBeNull();
      expect(memberLine('Alex')?.querySelector('.member-figures')).not.toBeNull();
    });

    it('online, shows another member with nothing in the period at zero', () => {
      answered();
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      expect(memberLine('Kai')?.querySelector('.member-figures')).not.toBeNull();
      expect(memberLine('Kai')?.textContent).not.toContain('household.overview.notLoaded');
    });
  });
});
