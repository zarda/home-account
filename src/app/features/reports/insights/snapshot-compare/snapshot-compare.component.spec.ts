import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { SnapshotCompareComponent } from './snapshot-compare.component';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightSnapshot } from '../../../../models';
import { createCategory } from '../../../../core/services/testing/test-data';
import { createTranslationStub, createLocaleFormatStub } from '../../../../core/services/testing';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';

function snapshotFor(
  monthKey: string,
  expense: number,
  byCategory: { categoryId: string; total: number; count: number }[] = [],
  baseCurrency = 'USD',
): InsightSnapshot {
  return {
    id: monthKey, userId: 'u1', monthKey,
    detectorVersion: 1, schemaVersion: 1, status: 'complete',
    fingerprint: { tx: 'x:1', count: 1, timeZone: 'UTC', baseCurrency },
    totals: { income: 4000, expense, balance: 4000 - expense, count: 10 },
    byCategory,
    facts: {
      recurring: { totalMonthlyEquivalent: 50, groupCount: 2 },
    } as unknown as InsightSnapshot['facts'],
    cards: [],
    generatedAt: Timestamp.fromDate(new Date(2026, 6, 1)),
    createdAt: Timestamp.fromDate(new Date(2026, 6, 1)),
    revision: 1,
  };
}

describe('SnapshotCompareComponent', () => {
  let component: SnapshotCompareComponent;
  let fixture: ComponentFixture<SnapshotCompareComponent>;

  const snapshot = snapshotFor;

  function build(snapshots: InsightSnapshot[]): void {
    fixture = TestBed.createComponent(SnapshotCompareComponent);
    fixture.componentRef.setInput('snapshots', snapshots);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SnapshotCompareComponent],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            categories: signal([
              createCategory({ id: 'food', name: 'categoryNames.groceries' }),
            ]),
          },
        },
        {
          provide: TranslationService,
          useValue: { t: (key: string) => key, getIntlLocale: () => 'en-US' },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(SnapshotCompareComponent, { set: { template: '<div></div>' } })
      .compileComponents();
  });

  describe('availability', () => {
    it('needs two months', () => {
      build([snapshot('2026-06', 100)]);
      expect(component.canCompare()).toBeFalse();
    });

    it('is available with two', () => {
      build([snapshot('2026-06', 118), snapshot('2026-05', 100)]);
      expect(component.canCompare()).toBeTrue();
    });
  });

  describe('defaults', () => {
    it('starts on the two most recent months, older on the left', () => {
      build([snapshot('2026-06', 118), snapshot('2026-05', 100), snapshot('2026-04', 90)]);
      expect(component.selectedFrom()).toBe('2026-05');
      expect(component.selectedTo()).toBe('2026-06');
    });

    it('honours an explicit pick', () => {
      build([snapshot('2026-06', 118), snapshot('2026-05', 100), snapshot('2026-04', 90)]);
      component.onFromChange('2026-04');
      expect(component.selectedFrom()).toBe('2026-04');
      expect(component.selectedTo()).toBe('2026-06');
    });
  });

  describe('comparison', () => {
    it('reports the spending change', () => {
      build([snapshot('2026-06', 118), snapshot('2026-05', 100)]);
      expect(component.comparison()?.expenseChange).toBe(18);
      expect(component.comparison()?.expenseChangeRatio).toBe(0.18);
      expect(component.refusal()).toBeNull();
    });

    it('splits categories into changed and unchanged', () => {
      build([
        snapshot('2026-06', 200, [
          { categoryId: 'food', total: 118, count: 6 },
          { categoryId: 'transport', total: 101, count: 3 },
        ]),
        snapshot('2026-05', 200, [
          { categoryId: 'food', total: 100, count: 5 },
          { categoryId: 'transport', total: 100, count: 3 },
        ]),
      ]);
      expect(component.changed().map(entry => entry.categoryId)).toEqual(['food']);
      expect(component.unchanged().map(entry => entry.categoryId)).toEqual(['transport']);
    });

    it('refuses across base currencies rather than subtracting them', () => {
      build([
        snapshot('2026-06', 118, [], 'JPY'),
        snapshot('2026-05', 100, [], 'USD'),
      ]);
      expect(component.comparison()).toBeNull();
      expect(component.refusal()).toBe('insights.compareCurrencyMismatch');
    });

    it('refuses to compare a month with itself', () => {
      build([snapshot('2026-06', 118), snapshot('2026-05', 100)]);
      component.onFromChange('2026-06');
      expect(component.refusal()).toBe('insights.compareSameMonth');
    });
  });

  it('resolves a category id to its localised name', () => {
    build([snapshot('2026-06', 118), snapshot('2026-05', 100)]);
    expect(component.categoryName('food')).toBe('categoryNames.groceries');
    expect(component.categoryName('unknown')).toBe('unknown');
  });

  it('formats a month key for display', () => {
    build([snapshot('2026-06', 118), snapshot('2026-05', 100)]);
    expect(component.monthLabel('2026-06')).toContain('2026');
    expect(component.monthLabel('bad')).toBe('bad');
  });
});

/**
 * The cases above override the template to `<div></div>`, so the compare
 * panel's own shape is unproven by them: it renders nothing at all below two
 * snapshots, the two `mat-select` pickers are the only way a user changes
 * either side, and the refusal message and the comparison body are mutually
 * exclusive branches. The up/down classes on the headline and each row are
 * pure template logic that nothing else evaluates.
 */
describe('SnapshotCompareComponent, through its own template', () => {
  let fixture: ComponentFixture<SnapshotCompareComponent>;
  let component: SnapshotCompareComponent;

  function render(snapshots: InsightSnapshot[]): void {
    fixture.componentRef.setInput('snapshots', snapshots);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const headline = (index: number) =>
    (Array.from(el().querySelectorAll('.headline')) as HTMLElement[])[index];

  /**
   * MatSelect renders its panel into the CDK overlay, outside the fixture, so
   * a case that opened one closes it again — otherwise the next case finds a
   * stray listbox in the document.
   */
  function openSelect(index: number): HTMLElement {
    const trigger = (Array.from(el().querySelectorAll('mat-select')) as HTMLElement[])[index];
    (trigger.querySelector('.mat-mdc-select-trigger') as HTMLElement).click();
    fixture.detectChanges();
    return document.querySelector('.mat-mdc-select-panel') as HTMLElement;
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SnapshotCompareComponent, NoopAnimationsModule],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            categories: signal([createCategory({ id: 'food', name: 'categoryNames.groceries' })]),
          },
        },
        {
          provide: TranslationService,
          useValue: { ...createTranslationStub(), getIntlLocale: () => 'en-US' },
        },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SnapshotCompareComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing at all with fewer than two stored months', () => {
    render([snapshotFor('2026-06', 1000)]);

    expect(el().querySelector('.compare')).toBeNull();
    expect(el().textContent?.trim()).toBe('');
  });

  it('labels both pickers and offers every stored month in each', () => {
    render([snapshotFor('2026-06', 1200), snapshotFor('2026-05', 1000)]);

    expect(
      Array.from(el().querySelectorAll('mat-label')).map(n => n.textContent?.trim())
    ).toEqual(['insights.compareFrom', 'insights.compareTo']);

    const panel = openSelect(0);
    expect(Array.from(panel.querySelectorAll('mat-option')).map(o => o.textContent?.trim()))
      .toEqual(['June 2026', 'May 2026']);
  });

  it('re-compares when the "from" side is picked through its own select', () => {
    render([
      snapshotFor('2026-06', 1200),
      snapshotFor('2026-05', 1000),
      snapshotFor('2026-04', 400),
    ]);
    const before = component.selectedFrom();

    const panel = openSelect(0);
    (Array.from(panel.querySelectorAll('mat-option')) as HTMLElement[])[2].click();
    fixture.detectChanges();

    expect(component.selectedFrom()).toBe('2026-04');
    expect(component.selectedFrom()).not.toBe(before);
  });

  it('shows the two headline figures, signed up or down', () => {
    render([snapshotFor('2026-06', 1200), snapshotFor('2026-05', 1000)]);

    expect(headline(0).querySelector('.headline-label')?.textContent?.trim())
      .toBe('insights.compareSpending');
    const spending = headline(0).querySelector('.headline-value') as HTMLElement;
    expect(spending.textContent).toContain('$200.00');
    expect(spending.classList).toContain('up');
    expect(spending.classList).not.toContain('down');

    expect(headline(1).querySelector('.headline-label')?.textContent?.trim())
      .toBe('insights.compareRecurring');
  });

  it('marks a fall as down rather than up', () => {
    render([snapshotFor('2026-06', 800), snapshotFor('2026-05', 1000)]);

    // The headline is the change, not the month's own total.
    const spending = headline(0).querySelector('.headline-value') as HTMLElement;
    expect(spending.textContent).toContain('-$200.00');
    expect(spending.classList).toContain('down');
    expect(spending.classList).not.toContain('up');
  });

  it('lists the categories that moved, by name, with their own direction', () => {
    render([
      snapshotFor('2026-06', 1200, [{ categoryId: 'food', total: 500, count: 5 }]),
      snapshotFor('2026-05', 1000, [{ categoryId: 'food', total: 300, count: 3 }]),
    ]);

    const rows = Array.from(el().querySelectorAll('.change-row')) as HTMLElement[];
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.change-name')?.textContent?.trim()).toBe('categoryNames.groceries');
    expect(rows[0].querySelector('.change-amount')?.classList).toContain('up');
    expect(rows[0].querySelector('.change-amount')?.textContent).toContain('$200.00');
  });

  it('says which categories held steady rather than leaving it an absence', () => {
    render([
      snapshotFor('2026-06', 1000, [{ categoryId: 'food', total: 300, count: 3 }]),
      snapshotFor('2026-05', 1000, [{ categoryId: 'food', total: 300, count: 3 }]),
    ]);

    expect(text('.unchanged-line')).toContain('insights.compareUnchanged');
    expect(text('.unchanged-line')).toContain('categoryNames.groceries');
    expect(el().querySelector('.change-list')).toBeNull();
  });

  it('shows the refusal instead of a comparison when the two sides are not comparable', () => {
    render([
      snapshotFor('2026-06', 1200, [], 'USD'),
      snapshotFor('2026-05', 1000, [], 'JPY'),
    ]);

    expect(component.refusal()).not.toBeNull();
    expect(text('.compare-refusal')).toBe(component.refusal());
    expect(el().querySelector('.headline-row')).toBeNull();
  });
});
