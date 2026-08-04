import { TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FitTextRegistry } from './directives/fit-text.registry';
import { CategorySuggestionComponent } from '../features/ai/import/category-suggestion/category-suggestion.component';
import { RecurringListComponent } from '../features/reports/insights/recurring-list/recurring-list.component';
import { CategoryService } from '../core/services/category.service';
import { TranslationService } from '../core/services/translation.service';
import { StorableRecurringSummary } from '../models';
import { createCategory } from '../core/services/testing';

/**
 * G3 says nothing truncates. `scripts/check-truncation.mjs` is what enforces
 * that across the whole app — it reads the source, so it catches the site
 * added tomorrow as well as the thirteen found today, which no fixed set of
 * TestBed configurations can.
 *
 * What a source check cannot see is whether the *replacement* works. Deleting
 * `text-overflow` only stops the app shortening a value; something still has
 * to happen to the content instead, and there are two answers. These measure
 * one of each, against the real cascade, at a fixed width:
 *
 *   - text wraps inside its own box and does not shove its neighbour out,
 *   - a label that cannot wrap scales instead, and the control it sits in
 *     survives the scaling.
 *
 * Same shape as overflow-guard.spec.ts: real component styles, the probe
 * attached to the document because only an attached element has a layout box,
 * and a fixed container width so nothing depends on the window running the
 * test.
 */

// --------------------------------------------------------------- the chip

@Component({
  standalone: true,
  imports: [CategorySuggestionComponent],
  template: `
    <div class="chip-clip">
      <app-category-suggestion
        [suggestedCategoryId]="'long'"
        [confidence]="0.9"
        [categories]="categories"
      />
    </div>
  `,
  // The import preview row this chip sits in, on a 375px phone.
  styles: [`.chip-clip { width: 240px; overflow: hidden; }`],
})
class ChipProbeComponent {
  readonly categories = [
    createCategory({
      id: 'long',
      name: 'Groceries, Household Supplies and Pantry Staples',
      icon: 'shopping_cart',
      color: '#FF5722',
    }),
  ];
}

describe('truncation guard: a label that cannot wrap', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChipProbeComponent, NoopAnimationsModule],
      providers: [
        { provide: TranslationService, useValue: { t: (key: string) => key } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(ChipProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    TestBed.inject(FitTextRegistry).flush();
  });

  afterEach(() => host.remove());

  it('shows the whole category name rather than an ellipsis', () => {
    const label = host.querySelector('.category-name') as HTMLElement;
    expect(getComputedStyle(label).textOverflow).withContext('no ellipsis').toBe('clip');
    expect(label.textContent?.trim())
      .withContext('every word present')
      .toBe('Groceries, Household Supplies and Pantry Staples');
  });

  it('scales the label to fit its cap instead of cutting it', () => {
    // appFitText, not wrapping: this is the control's own text inside a chip
    // the reviewer clicks, so it has to stay on one line. The directive writes
    // no style at all while a value fits, so a written font-size is the proof
    // that it engaged here.
    const label = host.querySelector('.category-name') as HTMLElement;
    expect(label.style.fontSize).withContext('directive scaled the label').not.toBe('');
    expect(label.scrollWidth)
      .withContext('nothing hiding past the right edge')
      .toBeLessThanOrEqual(label.clientWidth + 1);
  });

  it('keeps the chip a usable control while the label scales', () => {
    // `height: 32px` became `min-height: 32px` for this: at the 12px floor the
    // directive's last resort is to wrap, and a fixed height would have
    // clipped that — turning a shortened label into a hidden one.
    const button = host.querySelector('.category-button') as HTMLElement;
    const dropdown = host.querySelector('.dropdown-icon') as HTMLElement;
    const b = button.getBoundingClientRect();
    const d = dropdown.getBoundingClientRect();

    expect(b.height).withContext('chip keeps its touch target').toBeGreaterThanOrEqual(32);
    expect(d.right).withContext('the caret is still inside the chip').toBeLessThanOrEqual(b.right + 1);
    expect(b.right)
      .withContext('chip inside the row that holds it')
      .toBeLessThanOrEqual((host.querySelector('.chip-clip') as HTMLElement).getBoundingClientRect().right + 1);
  });
});

// ------------------------------------------------------------- a wrap case

function summary(label: string): StorableRecurringSummary {
  return {
    groups: [
      {
        key: 'rec:detected:food:long',
        source: 'detected',
        categoryId: 'food',
        label,
        cadence: 'monthly',
        medianIntervalDays: 30,
        occurrenceCount: 6,
        medianAmount: 42,
        monthlyEquivalent: 42,
        firstSeen: '2026-01-05',
        lastSeen: '2026-06-05',
        priceIncreased: false,
        userFlaggedCount: 0,
      },
    ],
    groupCount: 1,
    declaredGroupCount: 0,
    detectedGroupCount: 1,
    totalMonthlyEquivalent: 42,
    declaredMonthlyEquivalent: 0,
    detectedMonthlyEquivalent: 42,
    newGroupCount: 0,
    increasedGroupCount: 0,
  } as StorableRecurringSummary;
}

@Component({
  standalone: true,
  imports: [RecurringListComponent],
  template: `
    <div class="row-clip">
      <app-recurring-list [summary]="data" currency="USD" />
    </div>
  `,
  // The insights card on a 375px phone, less its own padding.
  styles: [`.row-clip { width: 311px; overflow: hidden; }`],
})
class RecurringRowProbeComponent {
  readonly data = summary(
    'Weekly grocery run at the farmers market on Ferry Building Embarcadero plus household supplies'
  );
}

describe('truncation guard: text that wraps', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecurringRowProbeComponent, NoopAnimationsModule],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            categories: signal([createCategory({ id: 'food', name: 'Groceries', icon: 'shopping_cart' })]),
          },
        },
        {
          provide: TranslationService,
          useValue: { t: (key: string) => key, currentLocale: signal('en') },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(RecurringRowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => host.remove());

  it('wraps a long label rather than shortening it', () => {
    const label = host.querySelector('.row-label') as HTMLElement;
    expect(label).withContext('recurring row rendered').not.toBeNull();
    expect(getComputedStyle(label).textOverflow).withContext('no ellipsis').toBe('clip');
    expect(getComputedStyle(label).whiteSpace).withContext('allowed to wrap').not.toBe('nowrap');

    // Taller than one line, and no scrollable remainder behind a clip.
    expect(label.getBoundingClientRect().height).withContext('it did wrap').toBeGreaterThan(24);
    expect(label.scrollWidth)
      .withContext('nothing hiding past the right edge')
      .toBeLessThanOrEqual(label.clientWidth + 1);
  });

  it('does not push the monthly figure out of the row', () => {
    // The other half of the trade. Deleting a truncation without declaring a
    // minimum moves the damage rather than fixing it: the text stops being
    // shortened and starts shoving its neighbour out of the box instead.
    const row = host.querySelector('.row-main') as HTMLElement;
    const amount = host.querySelector('.row-amount') as HTMLElement;
    expect(amount.getBoundingClientRect().right)
      .withContext('amount inside its row')
      .toBeLessThanOrEqual(row.getBoundingClientRect().right + 1);
  });
});
