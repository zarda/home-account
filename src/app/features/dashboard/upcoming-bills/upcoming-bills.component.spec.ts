import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { RuleFocusOutcome, UpcomingBillsComponent } from './upcoming-bills.component';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { AccessibilityService } from '../../../core/services/accessibility.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { ThemeService } from '../../../core/services/theme.service';
import { addDays, dayKey, startOfDay } from '../../../core/utils/transaction-date.utils';
import { DashboardLayoutService } from '../dashboard-layout.service';
import { DashboardCardMenuComponent } from '../dashboard-card-menu/dashboard-card-menu.component';
import {
  CATEGORY_FALLBACK_COLOR,
  CATEGORY_PALETTE,
  Category,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS,
  RecurringOccurrence,
} from '../../../models';
import {
  AUDIT_SCHEMES,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  textLines,
  withScheme,
  withTheme,
} from '../../../core/services/testing';

function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    recurringId: 'r1',
    name: 'Rent',
    type: 'expense',
    amount: 1200,
    currency: 'USD',
    categoryId: 'housing',
    date: new Date(2026, 8, 1, 9, 0),
    ...overrides,
  };
}

// The card as the dashboard renders it, with its own menu in the header slot.
@Component({
  standalone: true,
  imports: [UpcomingBillsComponent, DashboardCardMenuComponent],
  template: `
    <app-upcoming-bills [occurrences]="[]" [categories]="categories" baseCurrency="USD" [net]="0">
      <app-dashboard-card-menu card-actions [card]="'upcoming'" [visible]="['upcoming']" />
    </app-upcoming-bills>
  `,
})
class UpcomingWithMenuHostComponent {
  readonly categories = new Map<string, Category>();
}

describe('UpcomingBillsComponent', () => {
  let fixture: ComponentFixture<UpcomingBillsComponent>;
  let component: UpcomingBillsComponent;
  let currency: jasmine.SpyObj<CurrencyService>;
  let categoryHelper: jasmine.SpyObj<CategoryHelperService>;
  let reducedMotion: ReturnType<typeof signal<boolean>>;

  function render(occurrences: RecurringOccurrence[], net = 0, olderCount = 0, baseCurrency = 'USD'): void {
    fixture.componentRef.setInput('occurrences', occurrences);
    fixture.componentRef.setInput('categories', new Map<string, Category>());
    fixture.componentRef.setInput('baseCurrency', baseCurrency);
    fixture.componentRef.setInput('net', net);
    fixture.componentRef.setInput('olderCount', olderCount);
    fixture.detectChanges();
  }

  /** The net footer's amount, as the card bound it. */
  function netAmount(): AmountDisplayComponent {
    return fixture.debugElement.query(By.css('.net-footer app-amount-display'))
      .componentInstance as AmountDisplayComponent;
  }

  beforeEach(async () => {
    currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'convert']);
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName',
      'getCategoryIcon',
      'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Housing');
    categoryHelper.getCategoryIcon.and.returnValue('home');
    categoryHelper.getCategoryColor.and.returnValue('#123456');

    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    // A double rather than the real one, whose effect writes the preference
    // onto <html> as a class every later spec would inherit.
    reducedMotion = signal(false);

    await TestBed.configureTestingModule({
      imports: [UpcomingBillsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AccessibilityService, useValue: { reducedMotion } },
        { provide: CurrencyService, useValue: currency },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        {
          provide: LocaleFormatService,
          useValue: { locale: 'en-US', formatDate: (value: Date) => `day ${value.getDate()}` },
        },
        // The menu the rail describe projects; nothing there presses it.
        { provide: DashboardLayoutService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpcomingBillsComponent);
    component = fixture.componentInstance;
  });

  it('groups occurrences by local day, keeping the order they arrive in', () => {
    render([
      occurrence({ recurringId: 'r1', date: new Date(2026, 8, 1, 9, 0) }),
      occurrence({ recurringId: 'r2', date: new Date(2026, 8, 1, 21, 30) }),
      occurrence({ recurringId: 'r3', date: new Date(2026, 8, 4, 8, 0) }),
    ]);

    const days = component.days();
    expect(days.length).toBe(2);
    expect(days[0].key).toBe('2026-09-01');
    expect(days[0].occurrences.map(o => o.recurringId)).toEqual(['r1', 'r2']);
    expect(days[1].key).toBe('2026-09-04');
    expect(days[1].occurrences.map(o => o.recurringId)).toEqual(['r3']);

    expect(fixture.nativeElement.querySelectorAll('.day-group').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.bill-row').length).toBe(3);
  });

  // Two occurrences an hour apart across local midnight belong to different
  // days; a UTC-keyed grouping would fold them together east of Greenwich.
  it('splits a local midnight boundary into two days', () => {
    render([
      occurrence({ recurringId: 'r1', date: new Date(2026, 8, 1, 23, 30) }),
      occurrence({ recurringId: 'r2', date: new Date(2026, 8, 2, 0, 30) }),
    ]);

    expect(component.days().map(d => d.key)).toEqual(['2026-09-01', '2026-09-02']);
  });

  // Future occurrences carry no base-currency snapshot, so the row shows the
  // rule's own figure — converting it here would contradict the rule the user
  // typed in.
  it('renders each row in the rule currency, expenses negative', () => {
    render([
      occurrence({ recurringId: 'r1', type: 'expense', amount: 1200, currency: 'USD' }),
      occurrence({
        recurringId: 'r2',
        type: 'income',
        amount: 380000,
        currency: 'JPY',
        date: new Date(2026, 8, 2, 9, 0),
      }),
    ]);

    expect(currency.formatCurrency).toHaveBeenCalledWith(1200, 'USD');
    expect(currency.formatCurrency).toHaveBeenCalledWith(380000, 'JPY');
    expect(currency.convert).not.toHaveBeenCalled();

    const amounts = fixture.nativeElement.querySelectorAll('.bill-row app-amount-display');
    expect(amounts.length).toBe(2);
    expect(amounts[0].textContent).toContain('USD 1200');
    expect(amounts[1].textContent).toContain('JPY 380000');
  });

  it('shows the window net in the base currency with a sign', () => {
    render([occurrence()], -742.5);

    const footer = fixture.nativeElement.querySelector('.net-footer');
    expect(footer.textContent).toContain('dashboard.upcomingNet');
    expect(footer.textContent).toContain('-');
    expect(currency.formatCurrency).toHaveBeenCalledWith(742.5, 'USD');
  });

  // #440 P4: a window whose income and bills cancel out moved nothing either
  // way, so its net takes neither the income nor the expense tone.
  it('leaves a net of exactly zero in the neutral tone, unsigned', () => {
    render(
      [
        occurrence({ recurringId: 'r1', type: 'expense', amount: 1200 }),
        occurrence({ recurringId: 'r2', type: 'income', amount: 1200, date: new Date(2026, 8, 2, 9, 0) }),
      ],
      0
    );

    expect(netAmount().type()).toBe('neutral');
    const footer = fixture.nativeElement.querySelector('.net-footer');
    expect(footer.textContent).not.toContain('+');
    expect(footer.textContent).not.toContain('-');
  });

  // Less than half a yen formats as ¥0, so a signed or coloured one would be
  // a figure the card cannot show.
  it('snaps a net below the base currency\'s smallest unit to an unsigned neutral zero', () => {
    render([occurrence({ currency: 'JPY', amount: 0.4 })], -0.4, 0, 'JPY');

    expect(netAmount().type()).toBe('neutral');
    expect(netAmount().amount()).toBe(0);
    const footer = fixture.nativeElement.querySelector('.net-footer');
    expect(footer.textContent).not.toContain('+');
    expect(footer.textContent).not.toContain('-');
  });

  // #429 P1: a scheduled occurrence has no write-time snapshot, so its net
  // still converts live — the one figure on this card that must say so.
  it('marks the scheduled net as converted at today\'s rate', () => {
    render([occurrence()], -742.5);

    const footer = fixture.nativeElement.querySelector('.net-footer');
    expect(footer.textContent).toContain('common.atTodaysRate');
  });

  it('shows the empty state and no net footer when nothing is scheduled', () => {
    render([]);

    expect(component.days()).toEqual([]);
    const emptyState = fixture.nativeElement.querySelector('.empty-container app-empty-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent).toContain('dashboard.noUpcomingBills');
    expect(fixture.nativeElement.querySelector('.net-footer')).toBeNull();
  });

  // The window has a floor now, so occurrences older than it never reach the
  // card. Saying how many there are is the difference between a card that
  // looks up to date and one that admits a stalled rule. The `t` stub returns
  // the raw key, so the assertion is on the key, not the plural string —
  // translation-keys.spec.ts owns that.
  it('names the occurrences older than the window', () => {
    render([occurrence()], 0, 3);

    const notes = fixture.nativeElement.querySelectorAll('.older-note');
    expect(notes.length).toBe(1);
    expect(notes[0].textContent).toContain('dashboard.upcomingOlderHidden');
  });

  it('says nothing when nothing is older', () => {
    render([occurrence()], 0, 0);

    expect(fixture.nativeElement.querySelector('.older-note')).toBeNull();
  });

  // Nothing inside the window and a stalled rule behind it is exactly the
  // state the note is for, so it must survive the empty branch.
  it('the note stands with the empty state', () => {
    render([], 0, 2);

    expect(fixture.nativeElement.querySelector('.empty-container app-empty-state')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.older-note')).toBeTruthy();
  });

  it('links the header through to the recurring rules', () => {
    render([occurrence()]);

    const link = fixture.nativeElement.querySelector('.view-all-link');
    // The rules live on the Budgets page's second tab, so the bare /budgets
    // route would land on envelopes.
    expect(link.getAttribute('href')).toBe('/budgets?tab=recurring');
    expect(link.textContent).toContain('dashboard.viewAll');
  });

  // #446: a bill reminder's link names a rule, not a day, so the card picks
  // the row of that rule nearest today.
  describe('a link to one rule', () => {
    let attached: HTMLElement;
    let outcomes: RuleFocusOutcome[];

    /** Noon, so no zone's midnight or DST change moves the row to another day. */
    function dueIn(days: number, recurringId: string): RecurringOccurrence {
      const day = addDays(startOfDay(new Date()), days);
      return occurrence({ recurringId, date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12) });
    }

    function rowOn(days: number, recurringId: string): HTMLElement {
      const day = dayKey(addDays(startOfDay(new Date()), days));
      return attached.querySelector(`.bill-row[data-day="${day}"][data-rule-id="${recurringId}"]`) as HTMLElement;
    }

    function highlighted(): HTMLElement[] {
      return Array.from(attached.querySelectorAll('.bill-row-highlight')) as HTMLElement[];
    }

    /** The rows lay out first, then the link arrives: render hooks run on an application tick. */
    function focus(ruleId: string | null): void {
      fixture.componentRef.setInput('focusRuleId', ruleId);
      fixture.detectChanges();
      TestBed.tick();
      fixture.detectChanges();
    }

    beforeEach(() => {
      attached = fixture.nativeElement as HTMLElement;
      document.body.appendChild(attached);
      outcomes = [];
      component.ruleFocus.subscribe(outcome => outcomes.push(outcome));
    });

    afterEach(() => attached.remove());

    it('marks every row with its rule, focusable by script and not by Tab', () => {
      render([dueIn(-2, 'r1'), dueIn(3, 'r2')]);

      const rows = Array.from(attached.querySelectorAll('.bill-row')) as HTMLElement[];
      expect(rows.map(row => row.getAttribute('data-rule-id'))).toEqual(['r1', 'r2']);
      for (const row of rows) {
        expect(row.getAttribute('tabindex')).withContext(row.dataset['ruleId']!).toBe('-1');
      }
    });

    it('focuses and highlights the upcoming row when it is nearer than one past due', () => {
      render([dueIn(-3, 'r1'), dueIn(1, 'r1'), dueIn(1, 'r2'), dueIn(8, 'r1')]);

      focus('r1');

      expect(outcomes).toEqual(['focused']);
      expect(document.activeElement).toBe(rowOn(1, 'r1'));
      expect(highlighted()).toEqual([rowOn(1, 'r1')]);
    });

    it('focuses and highlights the past-due row when it is the nearer', () => {
      render([dueIn(-1, 'r1'), dueIn(4, 'r1')]);

      focus('r1');

      expect(outcomes).toEqual(['focused']);
      expect(document.activeElement).toBe(rowOn(-1, 'r1'));
      expect(highlighted()).toEqual([rowOn(-1, 'r1')]);
    });

    // A reminder only ever names an occurrence today or later.
    it('takes the upcoming row when a past-due one is as near', () => {
      render([dueIn(-2, 'r1'), dueIn(2, 'r1')]);

      focus('r1');

      expect(document.activeElement).toBe(rowOn(2, 'r1'));
    });

    it('keeps the highlight for two seconds, and the focus after it', () => {
      jasmine.clock().install();
      try {
        render([dueIn(1, 'r1')]);
        focus('r1');

        jasmine.clock().tick(1999);
        fixture.detectChanges();
        expect(highlighted()).withContext('at 1999 ms').toEqual([rowOn(1, 'r1')]);

        jasmine.clock().tick(1);
        fixture.detectChanges();
        expect(highlighted()).withContext('at 2000 ms').toEqual([]);
        expect(document.activeElement).toBe(rowOn(1, 'r1'));
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('says the rule is absent when no row names it, and moves nothing', () => {
      render([dueIn(1, 'r1')]);
      const before = document.activeElement;

      focus('gone');

      expect(outcomes).toEqual(['absent']);
      expect(document.activeElement).toBe(before);
      expect(highlighted()).toEqual([]);
    });

    it('says the rule is absent from an empty window', () => {
      render([]);

      focus('r1');

      expect(outcomes).toEqual(['absent']);
    });

    it('scrolls the row to the middle of the view, smoothly', () => {
      const scroll = spyOn(Element.prototype, 'scrollIntoView');
      render([dueIn(1, 'r1')]);

      focus('r1');

      expect(scroll).toHaveBeenCalledOnceWith({ block: 'center', behavior: 'smooth' });
      expect(scroll.calls.mostRecent().object).toBe(rowOn(1, 'r1'));
    });

    it('scrolls without animation when motion is reduced', () => {
      const scroll = spyOn(Element.prototype, 'scrollIntoView');
      reducedMotion.set(true);
      render([dueIn(1, 'r1')]);

      focus('r1');

      expect(scroll).toHaveBeenCalledOnceWith({ block: 'center', behavior: 'auto' });
    });

    it('asks nothing of a cleared link, and answers the same rule again once asked again', () => {
      render([dueIn(1, 'r1')]);
      focus('r1');
      focus(null);
      expect(outcomes).toEqual(['focused']);

      (document.activeElement as HTMLElement).blur();
      focus('r1');

      expect(outcomes).toEqual(['focused', 'focused']);
      expect(document.activeElement).toBe(rowOn(1, 'r1'));
    });
  });

  // At 1024 px the dashboard's rail is about 229 px wide, too narrow for the
  // title, View all and the menu on one line. The title may wrap; the link
  // and the menu stay one line, together.
  describe('header beside its menu, at the rail width', () => {
    const COPY: Record<string, string> = {
      'dashboard.upcomingBills': 'Upcoming Bills',
      'dashboard.viewAll': 'View All',
    };
    let host: HTMLElement;

    beforeEach(() => {
      const translation = TestBed.inject(TranslationService) as unknown as jasmine.SpyObj<TranslationService>;
      translation.t.and.callFake((key: string) => COPY[key] ?? key);
      const railFixture = TestBed.createComponent(UpcomingWithMenuHostComponent);
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

  // Not the category tile or its glyph: those paint the category's own colour,
  // and 'category tiles' below measures them.
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

    it('paints every line in its text token, at AA or better on the card, in both themes', () => {
      render([occurrence()], -1200, 2);
      const lines = [
        ['title', '.card-title', '--text-primary'],
        ['day header', '.day-header', '--text-muted'],
        ['bill name', '.bill-name', '--text-primary'],
        ['bill category', '.bill-category', '--text-muted'],
        ['older note', '.older-note', '--text-muted'],
        ['net label', '.net-label', '--text-secondary'],
        ['rate caption', '.rate-caption', '--text-muted'],
      ] as const;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          for (const [label, selector, token] of lines) {
            const el = fixture.nativeElement.querySelector(selector) as HTMLElement;
            expect(el).withContext(label).toBeTruthy();
            expect(ratio(paintedColor(el), paintedBackground(el)))
              .withContext(`${theme} ${label} on the card`)
              .toBeGreaterThanOrEqual(4.5);
            expect(getComputedStyle(el).color)
              .withContext(`${theme} ${label}`)
              .toBe(tokenColour(token));
          }
        });
      }
    });

    it('paints View all in the accent at rest, and a different AA colour hovered, in both themes', () => {
      render([occurrence()]);
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

  // Every colour a category can take: the seeded ones, the picker's palette
  // and the fallback for a missing category.
  describe('category tiles', () => {
    const COLOURS = [
      ...new Set(
        [
          ...[...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].map(group => group.color),
          ...CATEGORY_PALETTE,
          CATEGORY_FALLBACK_COLOR,
        ].map(color => color.toLowerCase())
      ),
    ];

    it('draws every category glyph at AA or better on its own tile, in both themes', () => {
      expect(COLOURS.length).toBe(31);
      const colourOf = new Map(COLOURS.map((color, i) => [`cat${i}`, color]));
      categoryHelper.getCategoryColor.and.callFake((id: string) => colourOf.get(id)!);
      render([...colourOf.keys()].map((categoryId, i) => occurrence({ recurringId: `r${i}`, categoryId })));

      const rows = Array.from(fixture.nativeElement.querySelectorAll('.bill-row')) as HTMLElement[];
      expect(rows.length).toBe(COLOURS.length);
      for (const scheme of AUDIT_SCHEMES) {
        withScheme(TestBed.inject(ThemeService), scheme, () => {
          fixture.detectChanges();
          rows.forEach((row, i) => {
            const glyph = row.querySelector('mat-icon') as HTMLElement;
            const tile = paintedBackground(glyph.parentElement as HTMLElement);
            // The tile is redrawn for the scheme, so the dark pass is not the light one again.
            expect(scheme === 'dark' ? Math.max(...tile) < 128 : Math.min(...tile) > 128)
              .withContext(`${scheme} ${COLOURS[i]} tile drawn for the scheme`)
              .toBeTrue();
            expect(ratio(paintedColor(glyph), tile))
              .withContext(`${scheme} ${COLOURS[i]} glyph on its tile`)
              .toBeGreaterThanOrEqual(4.5);
          });
        });
      }
    });
  });
});
