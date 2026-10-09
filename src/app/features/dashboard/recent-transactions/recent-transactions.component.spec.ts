import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { Timestamp } from '@angular/fire/firestore';
import { BehaviorSubject } from 'rxjs';
import { RecentTransactionsComponent } from './recent-transactions.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { FirestoreService } from '../../../core/services/firestore.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DashboardLayoutService } from '../dashboard-layout.service';
import { DashboardCardMenuComponent } from '../dashboard-card-menu/dashboard-card-menu.component';
import { Transaction } from '../../../models';
import {
  createUser,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  textLines,
  withTheme,
} from '../../../core/services/testing';
import { parseDayKey } from '../../../core/utils/transaction-date.utils';

// The card as the dashboard renders it, with its own menu in the header slot.
@Component({
  standalone: true,
  imports: [RecentTransactionsComponent, DashboardCardMenuComponent],
  template: `
    <app-recent-transactions>
      <app-dashboard-card-menu card-actions [card]="'recent'" [visible]="['recent']" />
    </app-recent-transactions>
  `,
})
class RecentWithMenuHostComponent {}

describe('RecentTransactionsComponent', () => {
  let component: RecentTransactionsComponent;
  let fixture: ComponentFixture<RecentTransactionsComponent>;
  let categoryHelper: jasmine.SpyObj<CategoryHelperService>;
  let dateFormat: jasmine.SpyObj<DateFormatService>;
  let router: Router;
  // The account's household index, as the share chips read it.
  let households: BehaviorSubject<Record<string, unknown>[]>;

  beforeEach(async () => {
    households = new BehaviorSubject<Record<string, unknown>[]>([]);
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName',
      'getCategoryIcon',
      'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Food');
    categoryHelper.getCategoryIcon.and.returnValue('restaurant');
    categoryHelper.getCategoryColor.and.returnValue('#fff');
    dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('2026-06-15');
    dateFormat.formatRelativeDate.and.returnValue('today');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [RecentTransactionsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: FirestoreService, useValue: { subscribeToCollection: () => households } },
        // The menu the rail describe projects; nothing there presses it.
        { provide: DashboardLayoutService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecentTransactionsComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it("marks a shared row with the account's live households, as the transactions list does", () => {
    const joined = Timestamp.fromMillis(1_000);
    households.next([
      { id: 'h1', name: 'Home', role: 'owner', since: joined, joinedAt: joined },
      { id: 'h2', name: 'Old flat', role: 'member', since: joined, joinedAt: joined, endedAt: joined },
    ]);
    fixture.componentRef.setInput('transactions', [
      { id: 't1', description: 'Dinner', amount: 5, currency: 'USD', type: 'expense', categoryId: 'c1', date: Timestamp.now(),
        sharedWith: ['households/h1'] } as Transaction,
      { id: 't2', description: 'Coffee', amount: 3, currency: 'USD', type: 'expense', categoryId: 'c1', date: Timestamp.now() } as Transaction,
    ]);
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.directive(TransactionRowComponent));
    expect([...(rows[0].componentInstance as TransactionRowComponent).householdNames()]).toEqual([['h1', 'Home']]);
    expect(rows[0].nativeElement.querySelector('.row-shared')).withContext('the shared row').not.toBeNull();
    expect(rows[1].nativeElement.querySelector('.row-shared')).withContext('a private row').toBeNull();
  });

  // Row anatomy (category chip, amounts, converted line, dates) is covered
  // by the shared TransactionRowComponent spec; here we assert the rows
  // are rendered through it.
  it('renders each transaction through the shared row component', () => {
    fixture.componentRef.setInput('transactions', [
      { id: 't1', description: 'Coffee', amount: 5, currency: 'USD', type: 'expense', categoryId: 'c1', date: Timestamp.now() } as Transaction,
      { id: 't2', description: 'Salary', amount: 100, currency: 'USD', type: 'income', categoryId: 'c1', date: Timestamp.now() } as Transaction,
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('app-transaction-row');
    expect(rows.length).toBe(2);
    expect(categoryHelper.getCategoryName).toHaveBeenCalledWith('c1', jasmine.any(Map));
    expect(dateFormat.formatRelativeDate).toHaveBeenCalled();
  });

  // The card projects no menu and opts out of the drawer, so the row button
  // and the row's own click are the whole of what opens a transaction here.
  it('navigates from a row by its button or by a click anywhere on it', () => {
    const navSpy = spyOn(router, 'navigate');
    fixture.componentRef.setInput('transactions', [
      { id: 't1', description: 'Coffee', amount: 5, currency: 'USD', type: 'expense', categoryId: 'c1', date: Timestamp.fromDate(new Date(2026, 5, 15)) } as Transaction,
    ]);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('app-transaction-row') as HTMLElement;
    (row.querySelector('.row-activate') as HTMLElement).click();
    (row.querySelector('.row-date') as HTMLElement).click();

    const opened: Parameters<Router['navigate']> = [['/transactions'], { queryParams: { date: '2026-06-15' } }];
    expect(navSpy.calls.allArgs()).toEqual([opened, opened]);
  });

  it('onAddTransaction navigates to the transactions page in add mode', () => {
    const navSpy = spyOn(router, 'navigate');
    component.onAddTransaction();
    expect(navSpy).toHaveBeenCalledWith(['/transactions'], { queryParams: { action: 'add' } });
  });

  it('onTransactionClick navigates with the local date as a query param', () => {
    const navSpy = spyOn(router, 'navigate');
    const txn = { date: Timestamp.fromDate(new Date(2026, 5, 15)) } as Transaction;
    component.onTransactionClick(txn);
    expect(navSpy).toHaveBeenCalledWith(['/transactions'], { queryParams: { date: '2026-06-15' } });
  });

  it('onTransactionClick handles a plain Date value', () => {
    const navSpy = spyOn(router, 'navigate');
    const txn = { date: new Date(2026, 0, 5) } as unknown as Transaction;
    component.onTransactionClick(txn);
    expect(navSpy).toHaveBeenCalledWith(['/transactions'], { queryParams: { date: '2026-01-05' } });
  });

  describe('colours', () => {
    /** What `color: var(token)` computes to under the palette on <html> now. */
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

    it('paints the title in the primary text token, at AA or better on the card, in both themes', () => {
      const title = fixture.nativeElement.querySelector('.card-title') as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          expect(ratio(paintedColor(title), paintedBackground(title)))
            .withContext(`${theme} title on the card`)
            .toBeGreaterThanOrEqual(4.5);
          expect(getComputedStyle(title).color)
            .withContext(`${theme} title`)
            .toBe(tokenColour('--text-primary'));
        });
      }
    });

    it('paints View all in the accent at rest, and a different AA colour hovered, in both themes', () => {
      const link = fixture.nativeElement.querySelector('.view-all-link') as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          try {
            expect(ratio(paintedColor(link), paintedBackground(link)))
              .withContext(`${theme} link at rest on the card`)
              .toBeGreaterThanOrEqual(4.5);
            const rest = getComputedStyle(link).color;
            expect(rest).withContext(`${theme} link at rest`).toBe(tokenColour('--color-accent'));

            link.style.color = hoverValue(link, '.view-all-link', 'color');
            expect(ratio(paintedColor(link), paintedBackground(link)))
              .withContext(`${theme} link hovered on the card`)
              .toBeGreaterThanOrEqual(4.5);
            expect(getComputedStyle(link).color).withContext(`${theme} hover differs from rest`).not.toBe(rest);
          } finally {
            link.style.removeProperty('color');
          }
        });
      }
    });
  });

  // At 1024 px the dashboard's rail is about 229 px wide, too narrow for the
  // title, View all and the menu on one line. The title may wrap; the link
  // and the menu stay one line, together.
  describe('header beside its menu, at the rail width', () => {
    const COPY: Record<string, string> = {
      'dashboard.recentTransactions': 'Recent Transactions',
      'dashboard.viewAll': 'View All',
    };
    let host: HTMLElement;

    beforeEach(() => {
      const translation = TestBed.inject(TranslationService) as unknown as jasmine.SpyObj<TranslationService>;
      translation.t.and.callFake((key: string) => COPY[key] ?? key);
      const railFixture = TestBed.createComponent(RecentWithMenuHostComponent);
      host = railFixture.nativeElement as HTMLElement;
      host.style.display = 'block';
      host.style.width = '229px';
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
      railFixture.detectChanges();
    });

    afterEach(() => host.remove());

    it('keeps View all on one line, with the menu trigger on its row, inside the card', () => {
      const link = host.querySelector('.view-all-link') as HTMLElement;
      const trigger = host.querySelector('.card-menu-trigger') as HTMLElement | null;
      expect(trigger).withContext('the projected menu trigger').not.toBeNull();

      expect(textLines(link)).withContext('View all lines').toBe(1);
      const linkBox = link.getBoundingClientRect();
      const triggerBox = trigger!.getBoundingClientRect();
      expect(Math.abs((triggerBox.top + triggerBox.bottom) / 2 - (linkBox.top + linkBox.bottom) / 2))
        .withContext('trigger centred on the link row')
        .toBeLessThanOrEqual(1);
      expect(triggerBox.left).withContext('trigger after the link').toBeGreaterThanOrEqual(linkBox.right);
      expect(triggerBox.right)
        .withContext('trigger inside the card')
        .toBeLessThanOrEqual(host.querySelector('mat-card')!.getBoundingClientRect().right);
    });

    // Three cards stack in the rail, and Budget Progress keeps its title whole
    // and drops its actions to the row below. A title broken to keep the
    // actions beside it reads as a different header, so at every width the
    // actions share a row only with a title on one line. Swept, because where
    // the break falls depends on the font, and Karma serves none of the app's.
    it('never breaks the title to keep the actions beside it, at any rail width', () => {
      const title = host.querySelector('.card-title') as HTMLElement;
      const link = host.querySelector('.view-all-link') as HTMLElement;
      let beside = 0;

      for (let width = 200; width <= 420; width += 10) {
        host.style.width = `${width}px`;
        if (link.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1) continue;
        beside++;
        expect(textLines(title)).withContext(`title lines beside the actions at ${width} px`).toBe(1);
      }
      expect(beside).withContext('widths with the actions beside the title').toBeGreaterThan(0);
    });
  });

  /**
   * The two halves of the round trip are exact inverses, and only asserting
   * them together catches a drift in either. This side always wrote a local
   * day; the transactions page read it back with `new Date()`, which is UTC,
   * so clicking an evening row west of UTC pre-filtered to the following day.
   */
  it('emits a day the transactions page parses back to the same local day', () => {
    const navSpy = spyOn(router, 'navigate');

    for (const local of [new Date(2026, 5, 15), new Date(2026, 7, 31, 20, 30)]) {
      component.onTransactionClick({ date: Timestamp.fromDate(local) } as Transaction);

      const emitted = navSpy.calls.mostRecent().args[1]!.queryParams!['date'] as string;
      const parsed = parseDayKey(emitted);

      expect(parsed).not.toBeNull();
      expect(parsed!.getFullYear()).toBe(local.getFullYear());
      expect(parsed!.getMonth()).toBe(local.getMonth());
      expect(parsed!.getDate()).toBe(local.getDate());
    }
  });
});
