import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { SnapshotCompareComponent } from './snapshot-compare.component';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightSnapshot } from '../../../../models';
import { createCategory } from '../../../../core/services/testing/test-data';

describe('SnapshotCompareComponent', () => {
  let component: SnapshotCompareComponent;
  let fixture: ComponentFixture<SnapshotCompareComponent>;

  function snapshot(
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
