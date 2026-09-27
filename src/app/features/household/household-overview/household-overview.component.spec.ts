import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';

import { HOUSEHOLD_OVERVIEW_ROW_PAGE, HouseholdOverviewComponent } from './household-overview.component';
import {
  HouseholdLedgerService,
  LedgerRow,
  LedgerTotals,
  MemberTotals
} from '../../../core/services/household-ledger.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AuthService } from '../../../core/services/auth.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  createLocaleFormatStub,
  createTranslationStub,
  createUser,
  TranslationStub
} from '../../../core/services/testing';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { FitTextRegistry } from '../../../shared/directives/fit-text.registry';
import { HouseholdMemberIdentity, LEDGER_VIEW_CAP, User } from '../../../models';
import { clampWindowToNow, periodWindow } from '../../../core/utils/transaction-date.utils';
import en from '../../../../assets/i18n/en.json';

interface FakeLedger {
  rows: WritableSignal<LedgerRow[]>;
  totalsByMember: WritableSignal<MemberTotals[]>;
  combined: WritableSignal<LedgerTotals>;
  truncated: WritableSignal<boolean>;
  incomplete: WritableSignal<boolean>;
  loading: WritableSignal<boolean>;
  fromCache: WritableSignal<boolean>;
  setPeriod: jasmine.Spy;
}

// Alex is the viewer throughout.
const alex: HouseholdMemberIdentity = { uid: 'alex', displayName: 'Alex' };
const sam: HouseholdMemberIdentity = { uid: 'sam', displayName: 'Sam Ito' };
const kai: HouseholdMemberIdentity = { uid: 'kai', displayName: 'Kai' };

const totals = (income: number, expense: number, count = 1, atTodaysRate = false): LedgerTotals =>
  ({ income, expense, balance: income - expense, count, atTodaysRate });

/** A built-in's snapshot holds its translation key, which the viewer's language names. */
const GROCERIES = { name: 'categoryNames.groceries', icon: 'local_grocery_store', color: '#4CAF50' };
/** A custom category's snapshot holds its member's own text. */
const TEA_SHOP = { name: 'Tea shop', icon: 'local_cafe', color: '#795548' };

/**
 * en.json's period labels below the tablet breakpoint. The Karma window is
 * wider than that breakpoint, so the selector shows its long label there:
 * both keys carry the short copy so a phone-width strip holds what a phone
 * shows.
 */
const PHONE_PERIOD_LABELS: Record<string, string> = Object.fromEntries(
  (['thisMonth', 'lastMonth', 'last3Months', 'thisYear'] as const).flatMap(period => {
    const short = en.dashboard[`${period}Short` as const];
    return [[`dashboard.${period}Short`, short], [`dashboard.${period}`, short]];
  })
);

/** A shared row in the viewer's USD base, unless told otherwise. */
function row(memberUid: string, id: string, overrides: Partial<LedgerRow> = {}): LedgerRow {
  const amount = overrides.amount ?? 10;
  return {
    id: `${memberUid}_${id}`,
    memberUid,
    sourceId: id,
    type: 'expense',
    amount,
    currency: 'USD',
    date: Timestamp.fromDate(new Date()),
    description: id,
    categoryId: 'food_groceries',
    category: GROCERIES,
    inBase: amount,
    atTodaysRate: false,
    ...overrides
  };
}

// Rendered throughout (ADR 0144), the period selector and the rows included:
// what the page shows for each state of the ledger is the thing under test.
describe('HouseholdOverviewComponent', () => {
  let fixture: ComponentFixture<HouseholdOverviewComponent>;
  let ledger: FakeLedger;
  let online: WritableSignal<boolean>;
  let viewer: WritableSignal<User | null>;
  let announce: jasmine.Spy;

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

  /** Two members who each shared a row, the server's answer in. */
  function answered(): void {
    ledger.totalsByMember.set([
      { member: alex, totals: totals(1000, 250.5, 2) },
      { member: sam, totals: totals(0, 1200, 1) }
    ]);
    ledger.combined.set(totals(1000, 1450.5, 3));
    ledger.rows.set([
      row('sam', 'tx-s1', { description: 'Matcha', type: 'expense', amount: 1200, category: TEA_SHOP, categoryId: 'sam-tea' }),
      row('alex', 'tx-a1', { description: 'Pay', type: 'income', amount: 1000 }),
      row('alex', 'tx-a2', { description: 'Bouldering', type: 'expense', amount: 250.5 })
    ]);
    ledger.loading.set(false);
    ledger.fromCache.set(false);
  }

  beforeEach(async () => {
    ledger = {
      rows: signal([]),
      totalsByMember: signal([]),
      combined: signal(totals(0, 0, 0)),
      truncated: signal(false),
      incomplete: signal(false),
      loading: signal(true),
      fromCache: signal(false),
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
    // What a row counts as in the base: the figure it was handed.
    currency.amountInBase.and.callFake((t: { amount: number; amountInBaseCurrency?: number }) =>
      t.amountInBaseCurrency ?? t.amount);
    announce = jasmine.createSpy('announce');

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
        {
          provide: TranslationService,
          // One built-in's key in the viewer's language; every other key echoed.
          useValue: createTranslationStub({
            t: (key, params) =>
              key === GROCERIES.name ? 'Groceries' : params ? `${key}:${JSON.stringify(params)}` : key
          })
        },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        { provide: AnnouncerService, useValue: { announce } }
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

    it("says nothing of today's rate while every figure is exact", () => {
      expect(element().querySelector('.rate-caption')).toBeNull();
    });

    it("says at today's rate beside each figure that converted a row, and only there", () => {
      ledger.totalsByMember.set([
        { member: alex, totals: totals(1000, 250.5, 2) },
        { member: sam, totals: totals(0, 1200, 1, true) }
      ]);
      ledger.combined.set(totals(1000, 1450.5, 3, true));
      render();

      const household = element().querySelector('.overview-rate');
      expect(household?.textContent?.trim()).toBe('common.atTodaysRate');
      expect(household?.previousElementSibling?.tagName.toLowerCase())
        .withContext("under the household's figures")
        .toBe('app-financial-summary');
      expect(memberLine('Sam Ito')?.querySelector('.rate-caption')?.textContent?.trim()).toBe('common.atTodaysRate');
      expect(memberLine('Alex')?.querySelector('.rate-caption')).withContext('Alex shared only in the base').toBeNull();
      expect(element().querySelectorAll('.rate-caption').length).toBe(2);
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

    it("names each row's category from its snapshot: a built-in in the viewer's language, a custom one as typed", () => {
      const [matcha, pay] = rowsShown();

      expect(pay.nativeElement.querySelector('.row-category')?.textContent?.trim()).toBe('Groceries');
      expect(matcha.nativeElement.querySelector('.row-category')?.textContent?.trim()).toBe('Tea shop');
      // The snapshot's icon and colour, with no category of the viewer's read.
      expect(pay.nativeElement.querySelector('app-category-chip mat-icon')?.textContent?.trim())
        .toBe(GROCERIES.icon);
      expect(matcha.nativeElement.querySelector('app-category-chip mat-icon')?.textContent?.trim())
        .toBe(TEA_SHOP.icon);
    });

    it("shows each row in its own amount, with what it counts as in the viewer's base when that differs", () => {
      ledger.rows.set([
        row('sam', 'tx-e', { description: 'Cafe', amount: 10, currency: 'EUR', inBase: 12.5, atTodaysRate: true }),
        row('alex', 'tx-u', { description: 'Lunch', amount: 8 })
      ]);
      render();

      const [cafe, lunch] = rowsShown().map(debug => debug.nativeElement as HTMLElement);
      expect(cafe.querySelector('.row-amount')?.textContent).toContain('EUR 10.00');
      expect(cafe.querySelector('.amount-converted')?.textContent?.trim()).toBe('≈ USD 12.50');
      expect(lunch.querySelector('.row-amount')?.textContent).toContain('USD 8.00');
      expect(lunch.querySelector('.amount-converted')).toBeNull();
    });

    it("says at today's rate under each row it converted, and only there", () => {
      ledger.rows.set([
        row('sam', 'tx-e', { description: 'Cafe', amount: 10, currency: 'EUR', inBase: 12.5, atTodaysRate: true }),
        row('alex', 'tx-u', { description: 'Lunch', amount: 8 })
      ]);
      render();

      const [cafe, lunch] = rowsShown().map(debug => (debug.nativeElement as HTMLElement).closest('li') as HTMLElement);
      const caption = cafe.querySelector('.rate-caption');
      expect(caption?.textContent?.trim()).toBe('common.atTodaysRate');
      expect(caption?.previousElementSibling?.tagName.toLowerCase())
        .withContext('under the row whose figure it qualifies')
        .toBe('app-transaction-row');
      expect(lunch.querySelector('.rate-caption')).withContext('a row in the base is exact').toBeNull();
      expect(element().querySelectorAll('.overview-rows .rate-caption').length).toBe(1);
    });

    it('names whose each row is', () => {
      const [matcha, pay] = rowsShown();

      expect((matcha.componentInstance as TransactionRowComponent).member()).toBe(sam);
      expect((pay.componentInstance as TransactionRowComponent).member()).toBe(alex);
      expect(matcha.nativeElement.querySelector('.row-meta app-member-chip')?.textContent).toContain('Sam Ito');
    });
  });

  // Eight members at the ledger's cap is thousands of rows, each a row
  // component with fitted text, so the list is rendered a page at a time.
  describe('its rows, a page at a time', () => {
    const PAGE = HOUSEHOLD_OVERVIEW_ROW_PAGE;
    // Two and a half pages: three of every five rows are Alex's.
    const TOTAL = PAGE * 2.5;
    const ALEXS = TOTAL * 3 / 5;
    const SAMS = TOTAL - ALEXS;

    /** Newest first, as the ledger merges them: three of every five are Alex's. */
    const many = (count: number): LedgerRow[] =>
      Array.from({ length: count }, (_, at) =>
        row(at % 5 < 3 ? 'alex' : 'sam', `tx-${at}`, { description: `Row ${at}`, type: 'expense', amount: 1 })
      );

    const moreButton = (): HTMLButtonElement | null =>
      element().querySelector<HTMLButtonElement>('button.overview-more');
    const described = (): string[] => rowsShown().map(debug =>
      (debug.componentInstance as TransactionRowComponent).transaction().description
    );
    const rowItem = (at: number): HTMLElement =>
      (rowsShown()[at].nativeElement as HTMLElement).closest('li') as HTMLElement;
    const remaining = (count: number): string => `household.overview.showMore:{"count":${count}}`;

    function press(): void {
      moreButton()?.click();
      render();
    }

    /** Renders, then lets afterNextRender run: it fires on the app's own tick, which detectChanges alone does not run. */
    async function settle(): Promise<void> {
      render();
      await fixture.whenStable();
      TestBed.tick();
    }

    /** Two and a half pages of rows in the period, one unit spent on each. */
    function twoAndAHalfPages(): void {
      ledger.totalsByMember.set([
        { member: alex, totals: totals(0, ALEXS, ALEXS) },
        { member: sam, totals: totals(0, SAMS, SAMS) }
      ]);
      ledger.combined.set(totals(0, TOTAL, TOTAL));
      ledger.rows.set(many(TOTAL));
      ledger.loading.set(false);
      render();
    }

    function expectEveryRowCounted(): void {
      const cards = Array.from(element().querySelectorAll('app-stat-card')).map(card => card.textContent ?? '');
      expect(cards[1]).withContext("the household's spending").toContain(`USD ${TOTAL.toFixed(2)}`);
      const spent = (name: string) => memberLine(name)?.querySelectorAll('.member-figure dd')[1].textContent?.trim();
      expect(spent('Alex')).toBe(`USD ${ALEXS.toFixed(2)}`);
      expect(spent('Sam Ito')).toBe(`USD ${SAMS.toFixed(2)}`);
    }

    it('shows the newest page, and a button naming how many are left', () => {
      twoAndAHalfPages();

      expect(rowsShown().length).toBe(PAGE);
      expect(described()[0]).toBe('Row 0');
      expect(described()[PAGE - 1]).toBe(`Row ${PAGE - 1}`);
      const more = moreButton();
      expect(more).withContext('offered below the list').not.toBeNull();
      expect(more?.hasAttribute('mat-stroked-button')).toBeTrue();
      expect(more?.textContent).toContain(remaining(TOTAL - PAGE));
      expect(element().querySelector('.overview-rows button')).withContext('the list itself holds no control')
        .toBeNull();
    });

    it('shows the next page at each press, until none are left', () => {
      twoAndAHalfPages();

      press();
      expect(rowsShown().length).toBe(PAGE * 2);
      expect(described()[PAGE]).toBe(`Row ${PAGE}`);
      expect(described()[PAGE * 2 - 1]).toBe(`Row ${PAGE * 2 - 1}`);
      expect(moreButton()?.textContent).toContain(remaining(TOTAL - PAGE * 2));

      press();
      expect(rowsShown().length).toBe(TOTAL);
      expect(described()[TOTAL - 1]).toBe(`Row ${TOTAL - 1}`);
      expect(moreButton()).toBeNull();
    });

    it('counts every row in the totals, shown or not', () => {
      twoAndAHalfPages();
      expectEveryRowCounted();

      press();
      expectEveryRowCounted();

      press();
      expectEveryRowCounted();
    });

    it('keeps focus on the button while more are left', async () => {
      twoAndAHalfPages();
      const more = moreButton() as HTMLButtonElement;
      more.focus();

      press();
      await settle();

      expect(moreButton()).withContext('the same button, not a new one').toBe(more);
      expect(document.activeElement).toBe(more);
    });

    it('says how many rows are shown, and where the new ones went, at a press that leaves some hidden', () => {
      twoAndAHalfPages();

      press();

      const shown = `household.overview.shownCount:${JSON.stringify({ shown: PAGE * 2, total: TOTAL })}`;
      expect(announce.calls.allArgs()).toEqual([[shown, 'polite', 'replace']]);
    });

    it('says nothing at the press that shows the last rows, which moves focus to them instead', () => {
      twoAndAHalfPages();
      press();
      announce.calls.reset();

      press();

      expect(moreButton()).toBeNull();
      expect(announce).not.toHaveBeenCalled();
    });

    it('says nothing when the list starts again for another period or other members', () => {
      twoAndAHalfPages();
      press();
      announce.calls.reset();

      element().querySelector<HTMLButtonElement>('mat-button-toggle[value="lastMonth"] button')?.click();
      render();
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      expect(rowsShown().length).toBe(PAGE);
      expect(announce).not.toHaveBeenCalled();
    });

    it('moves focus to the first row the last press revealed, as the button goes', async () => {
      twoAndAHalfPages();
      press();
      moreButton()?.focus();

      press();
      await settle();

      expect(moreButton()).toBeNull();
      expect(document.activeElement).toBe(rowItem(PAGE * 2));
      expect(element().querySelectorAll('.overview-rows [tabindex]').length)
        .withContext('only the row focus was sent to can take it, and not by Tab')
        .toBe(1);
      expect(rowItem(PAGE * 2).getAttribute('tabindex')).toBe('-1');
    });

    it('moves focus to the last row shown when a change in the rows takes the focused button away', async () => {
      twoAndAHalfPages();
      press();
      moreButton()?.focus();

      ledger.rows.set(many(PAGE * 2));
      await settle();

      expect(moreButton()).toBeNull();
      expect(document.activeElement).withContext('not dropped on the document').toBe(rowItem(PAGE * 2 - 1));
      expect(element().querySelectorAll('.overview-rows [tabindex]').length).toBe(1);
    });

    it("moves focus to the list's heading when a change leaves no rows at all", async () => {
      twoAndAHalfPages();
      moreButton()?.focus();

      ledger.rows.set([]);
      await settle();

      const heading = element().querySelector<HTMLElement>('#household-rows-title') as HTMLElement;
      expect(emptyState()).toContain('household.overview.emptyTitle');
      expect(element().querySelector('app-empty-state h4')?.textContent)
        .withContext("the empty list's title sits inside the list's own heading, not beside it")
        .toContain('household.overview.emptyTitle');
      expect(element().querySelector('app-empty-state h3')).toBeNull();
      expect(document.activeElement).toBe(heading);
      expect(heading.getAttribute('tabindex')).withContext('script can focus it, Tab does not').toBe('-1');
    });

    it('leaves focus where the viewer moved it when a change takes the button away', async () => {
      twoAndAHalfPages();
      moreButton()?.focus();
      const lastMonth = element().querySelector<HTMLElement>('mat-button-toggle[value="lastMonth"] button') as HTMLElement;
      lastMonth.focus();

      ledger.rows.set(many(PAGE));
      await settle();

      expect(moreButton()).toBeNull();
      expect(document.activeElement).toBe(lastMonth);
      expect(element().querySelectorAll('.overview-rows [tabindex]').length).toBe(0);
    });

    it('still moves focus on when the button fires a blur as it is taken away', async () => {
      twoAndAHalfPages();
      const more = moreButton() as HTMLButtonElement;
      more.focus();

      // Chromium fires blur on a focused element as it leaves the page, and
      // may do so before anything here has seen the rows change.
      ledger.rows.set(many(PAGE));
      more.blur();
      await settle();

      expect(moreButton()).toBeNull();
      expect(document.activeElement).toBe(rowItem(PAGE - 1));
    });

    it('leaves focus where the viewer moved it as the rows changed', async () => {
      twoAndAHalfPages();
      moreButton()?.focus();
      const lastMonth = element().querySelector<HTMLElement>('mat-button-toggle[value="lastMonth"] button') as HTMLElement;

      ledger.rows.set(many(PAGE));
      lastMonth.focus();
      await settle();

      expect(moreButton()).toBeNull();
      expect(document.activeElement).toBe(lastMonth);
    });

    it('takes no focus when the viewer had already let it go from the button', async () => {
      twoAndAHalfPages();
      const more = moreButton() as HTMLButtonElement;
      more.focus();
      more.blur();

      ledger.rows.set(many(PAGE));
      await settle();

      expect(moreButton()).toBeNull();
      expect(document.activeElement).toBe(document.body);
      expect(element().querySelectorAll('.overview-rows [tabindex]').length).toBe(0);
    });

    it('starts again from the newest page when the period changes', () => {
      twoAndAHalfPages();
      press();
      expect(rowsShown().length).toBe(PAGE * 2);

      element().querySelector<HTMLButtonElement>('mat-button-toggle[value="lastMonth"] button')?.click();
      render();

      expect(rowsShown().length).toBe(PAGE);
      expect(moreButton()?.textContent).toContain(remaining(TOTAL - PAGE));
    });

    it('starts again from the newest page when the members change', () => {
      twoAndAHalfPages();
      press();
      expect(rowsShown().length).toBe(PAGE * 2);

      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      expect(rowsShown().length).toBe(PAGE);
    });

    it('keeps what it shows when rows arrive for the same members', () => {
      twoAndAHalfPages();
      press();

      ledger.rows.set(many(TOTAL + 1));
      ledger.totalsByMember.update(lines => lines.map(line => ({ ...line })));
      render();

      expect(rowsShown().length).toBe(PAGE * 2);
      expect(moreButton()?.textContent).toContain(remaining(TOTAL + 1 - PAGE * 2));
    });

    it('offers no button with a page of rows or fewer', () => {
      twoAndAHalfPages();
      ledger.rows.set(many(PAGE - 1));
      render();

      expect(rowsShown().length).toBe(PAGE - 1);
      expect(moreButton()).toBeNull();

      ledger.rows.set(many(PAGE));
      render();

      expect(rowsShown().length).toBe(PAGE);
      expect(moreButton()).toBeNull();
    });
  });

  describe('its notes', () => {
    beforeEach(() => {
      answered();
      render();
    });

    it('says the household shared more than the cap in the period', () => {
      ledger.truncated.set(true);
      render();

      const note = element().querySelector('.overview-note');
      expect(note?.textContent).toContain(`household.overview.truncated:{"cap":${LEDGER_VIEW_CAP}}`);
      expect(note?.classList).toContain('is-info');
      expect(note?.getAttribute('role')).toBe('status');
    });

    it("says the figures may be incomplete when the listener failed with only the cache's rows, and stops waiting", () => {
      ledger.fromCache.set(true);
      ledger.incomplete.set(true);
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      expect(text()).toContain('household.overview.incomplete');
      expect(element().querySelector('.overview-note')?.classList).not.toContain('is-info');
      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(rowsShown().length).toBe(3);
      expect(element().querySelectorAll('app-stat-card').length).toBe(3);
      // Online, and nothing more is coming: no call to connect, and no zeros.
      const kaiLine = memberLine('Kai');
      expect(kaiLine?.querySelector('.member-figures')).toBeNull();
      expect(kaiLine?.textContent).toContain('household.overview.memberFailed');
      expect(kaiLine?.textContent).not.toContain('household.overview.notLoaded');
    });

    it('says nothing while the rows read in full', () => {
      expect(element().querySelector('.overview-note')).toBeNull();
    });
  });

  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.width = '311px';
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels. Material's buttons and toggles take their face
      // from the --mat-sys tokens rather than from the host.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    it('fits the period toggle in its strip, so the strip neither scrolls nor draws a scrollbar', () => {
      // The strip's width depends on the labels, so it is measured with the
      // short ones a phone shows (en.json) rather than the echoed keys.
      const translation = TestBed.inject(TranslationService) as unknown as TranslationStub;
      const echo = translation.t;
      translation.t = (key, params) => PHONE_PERIOD_LABELS[key] ?? echo(key, params);
      translation.translationsVersion.update(version => version + 1);
      answered();
      render();

      const strip = element().querySelector('.period-toggle-scroller') as HTMLElement;
      // An echoed key is wider than any label, so a strip still showing one
      // measures the wrong copy.
      expect(strip.textContent).withContext('an echoed key in the strip').not.toContain('dashboard.');
      expect(strip.textContent).toContain(PHONE_PERIOD_LABELS['dashboard.lastMonthShort']);
      expect(strip.scrollWidth).withContext('the toggle overflows its strip').toBeLessThanOrEqual(strip.clientWidth);
      expect(strip.offsetHeight).withContext('the strip draws a horizontal scrollbar').toBe(strip.clientHeight);
    });

    it('keeps the heading, the period, every member line, every caption and every row inside the section', () => {
      answered();
      const long: HouseholdMemberIdentity = { uid: 'long', displayName: 'W'.repeat(100) };
      ledger.totalsByMember.set([
        { member: long, totals: totals(123456.78, 98765.43, 1, true) },
        { member: alex, totals: totals(0, 1200) }
      ]);
      ledger.combined.set(totals(123456.78, 99965.43, 2, true));
      ledger.rows.update(rows => [
        row('long', 'tx-l1', {
          description: 'Rent', type: 'expense', amount: 98765.43, currency: 'EUR', inBase: 123456.79, atTodaysRate: true
        }),
        ...rows
      ]);
      render();
      TestBed.inject(FitTextRegistry).flush();

      const section = (element().querySelector('.overview') as HTMLElement).getBoundingClientRect();
      // The rows are measured in the padded card they really sit in, one of
      // them naming the long-named member. A row clips its own content, so
      // its line 3, where the name sits, is measured as well as its box.
      const parts = Array.from(element().querySelectorAll<HTMLElement>(
        '.overview-head, .member-line, .rate-caption, .overview-row, .overview-row .row-meta'
      ));
      // The head; two member lines and their one caption; the household's
      // caption; four rows, each with its line 3; the converted row's caption.
      expect(parts.length).toBe(1 + 2 + 1 + 1 + 4 * 2 + 1);
      for (const part of parts) {
        const label = part.className;
        expect(part.scrollWidth).withContext(`nothing overflows ${label}`).toBeLessThanOrEqual(part.clientWidth);
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(section.left - 0.5);
        expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(section.right + 0.5);
      }
    });

    it('keeps the button for more rows inside the section, its label taking a second line', () => {
      answered();
      ledger.rows.set(Array.from({ length: HOUSEHOLD_OVERVIEW_ROW_PAGE * 1.5 }, (_, at) =>
        row('alex', `tx-${at}`, { description: `Row ${at}`, type: 'expense', amount: 1 })
      ));
      render();

      const section = (element().querySelector('.overview') as HTMLElement).getBoundingClientRect();
      const more = element().querySelector<HTMLElement>('button.overview-more') as HTMLElement;
      const box = more.getBoundingClientRect();
      expect(box.left).withContext('the button starts inside').toBeGreaterThanOrEqual(section.left - 0.5);
      expect(box.right).withContext('the button ends inside').toBeLessThanOrEqual(section.right + 0.5);
      // Measured at the label: the outlined button's own ripple layer sits a
      // pixel out over its border, so the button's scroll size always leads
      // its client size by one.
      const label = more.querySelector('.mdc-button__label') as HTMLElement;
      expect(label.scrollWidth).withContext('the label wraps within itself').toBeLessThanOrEqual(label.clientWidth);
      const text = label.getBoundingClientRect();
      expect(text.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(text.right).toBeLessThanOrEqual(box.right + 0.5);
      expect(text.top).withContext('the label sits inside the button').toBeGreaterThanOrEqual(box.top - 0.5);
      expect(text.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
      expect(box.height).withContext('the button grew to take the second line').toBeGreaterThan(40);
    });
  });

  describe('its empty and waiting states', () => {
    it('shows progress, not an empty period, while the ledger has not answered', () => {
      expect(element().querySelector('app-loading-spinner mat-spinner')?.getAttribute('aria-label'))
        .toBe('household.overview.loading');
      expect(element().querySelector('app-empty-state')).toBeNull();
      expect(element().querySelector('app-stat-card')).toBeNull();
    });

    it('says nobody has shared anything once the server answered with nothing', () => {
      ledger.totalsByMember.set([{ member: alex, totals: totals(0, 0, 0) }]);
      ledger.loading.set(false);
      render();

      expect(emptyState()).toContain('household.overview.emptyTitle');
      expect(emptyState()).toContain('household.overview.nothingShared');
      expect(emptyState()).not.toContain('household.overview.offlineTitle');
      expect(element().querySelector('mat-spinner')).toBeNull();
      expect(element().querySelectorAll('.member-line').length).withContext('a member line at zero').toBe(1);
    });

    it("online, waits for the server rather than call the cache's empty period empty", () => {
      ledger.totalsByMember.set([{ member: alex, totals: totals(0, 0, 0) }]);
      ledger.loading.set(false);
      ledger.fromCache.set(true);
      render();

      expect(element().querySelector('mat-spinner')).not.toBeNull();
      expect(element().querySelector('app-empty-state')).toBeNull();
      expect(element().querySelector('app-stat-card')).toBeNull();
    });

    it('offline with nothing cached, says so rather than calling the period empty', () => {
      online.set(false);
      ledger.totalsByMember.set([{ member: alex, totals: totals(0, 0, 0) }]);
      ledger.loading.set(false);
      ledger.fromCache.set(true);
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

    it('shows the rows the cache holds, offline or not', () => {
      answered();
      ledger.fromCache.set(true);
      render();
      expect(rowsShown().length).toBe(3);

      online.set(false);
      render();
      expect(rowsShown().length).toBe(3);
      expect(element().querySelector('app-empty-state')).toBeNull();
    });

    it('from the cache, puts a note in place of the figures of a member with nothing in it', () => {
      online.set(false);
      answered();
      ledger.fromCache.set(true);
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      const kaiLine = memberLine('Kai');
      expect(kaiLine?.querySelector('.member-figures')).withContext('no zeros').toBeNull();
      expect(kaiLine?.textContent).toContain('household.overview.notLoaded');
      expect(memberLine('Sam Ito')?.querySelector('.member-figures')).withContext('a cached member keeps figures')
        .not.toBeNull();
      expect(memberLine('Alex')?.querySelector('.member-figures')).not.toBeNull();
    });

    it('online, from the cache, says a member with nothing in it is loading rather than asking to connect', () => {
      answered();
      ledger.fromCache.set(true);
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      const kaiLine = memberLine('Kai');
      expect(kaiLine?.querySelector('.member-figures')).withContext('no zeros').toBeNull();
      expect(kaiLine?.textContent).toContain('household.overview.memberLoading');
      expect(kaiLine?.textContent).not.toContain('household.overview.notLoaded');
      expect(memberLine('Sam Ito')?.querySelector('.member-figures')).not.toBeNull();
    });

    for (const [when, fromCache] of [['before any answer', false], ['after the cache held nothing', true]] as const) {
      it(`says the shared rows could not be read when the listener failed ${when}, showing no figures`, () => {
        ledger.totalsByMember.set([{ member: alex, totals: totals(0, 0, 0) }, { member: sam, totals: totals(0, 0, 0) }]);
        ledger.combined.set(totals(0, 0, 0));
        ledger.rows.set([]);
        ledger.loading.set(false);
        ledger.fromCache.set(fromCache);
        ledger.incomplete.set(true);
        render();

        expect(emptyState()).toContain('household.overview.failedTitle');
        expect(emptyState()).toContain('household.overview.failedDescription');
        expect(text()).not.toContain('household.overview.nothingShared');
        expect(element().querySelector('app-financial-summary')).withContext('no zeros that are not known').toBeNull();
        expect(element().querySelectorAll('.member-line').length).toBe(0);
        expect(element().querySelector('mat-spinner')).toBeNull();
        expect(element().querySelector('.overview-note'))
          .withContext('the card says it; no note about figures that are not shown')
          .toBeNull();
      });
    }

    it('from the server, shows a member who shared nothing in the period at zero', () => {
      answered();
      ledger.totalsByMember.update(lines => [...lines, { member: kai, totals: totals(0, 0, 0) }]);
      render();

      expect(memberLine('Kai')?.querySelector('.member-figures')).not.toBeNull();
      expect(memberLine('Kai')?.textContent).not.toContain('household.overview.notLoaded');
    });
  });
});
