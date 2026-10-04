import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { UpcomingBillsComponent } from './upcoming-bills.component';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { ThemeService } from '../../../core/services/theme.service';
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

describe('UpcomingBillsComponent', () => {
  let fixture: ComponentFixture<UpcomingBillsComponent>;
  let component: UpcomingBillsComponent;
  let currency: jasmine.SpyObj<CurrencyService>;
  let categoryHelper: jasmine.SpyObj<CategoryHelperService>;

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

    await TestBed.configureTestingModule({
      imports: [UpcomingBillsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: currency },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        {
          provide: LocaleFormatService,
          useValue: { locale: 'en-US', formatDate: (value: Date) => `day ${value.getDate()}` },
        },
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
