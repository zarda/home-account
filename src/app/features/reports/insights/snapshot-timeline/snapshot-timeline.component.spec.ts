import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { SnapshotTimelineComponent } from './snapshot-timeline.component';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightSnapshot, SnapshotStaleness } from '../../../../models';
import en from '../../../../../assets/i18n/en.json';
import ja from '../../../../../assets/i18n/ja.json';
import tc from '../../../../../assets/i18n/tc.json';

/**
 * Every reason the staleness comparison can produce. Built dynamically as
 * `insights.stale_${reason}`, which the i18n check script skips, so this list
 * plus the parity test below is the only thing standing between a typo and a raw
 * key rendered to the user.
 */
const STALE_REASON_KEYS = [
  'insights.stale_transactionsChanged',
  'insights.stale_baseCurrencyChanged',
  'insights.stale_timeZoneChanged',
];

describe('SnapshotTimelineComponent', () => {
  let component: SnapshotTimelineComponent;
  let fixture: ComponentFixture<SnapshotTimelineComponent>;

  function snapshot(monthKey: string): InsightSnapshot {
    return {
      id: monthKey, userId: 'u1', monthKey,
      detectorVersion: 1, schemaVersion: 1, status: 'complete',
      fingerprint: { tx: 'x:1', count: 1, timeZone: 'UTC', baseCurrency: 'USD' },
      totals: { income: 0, expense: 0, balance: 0, count: 0 },
      byCategory: [],
      facts: {} as InsightSnapshot['facts'],
      cards: [],
      generatedAt: Timestamp.fromDate(new Date(2026, 6, 1)),
      createdAt: Timestamp.fromDate(new Date(2026, 6, 1)),
      revision: 1,
    };
  }

  function build(
    snapshots: InsightSnapshot[],
    selectedMonth: string | null = null,
    staleness: SnapshotStaleness | null = null,
  ): void {
    fixture = TestBed.createComponent(SnapshotTimelineComponent);
    fixture.componentRef.setInput('snapshots', snapshots);
    fixture.componentRef.setInput('selectedMonth', selectedMonth);
    fixture.componentRef.setInput('staleness', staleness);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SnapshotTimelineComponent],
      providers: [
        {
          provide: TranslationService,
          useValue: { t: (key: string) => key, getIntlLocale: () => 'en-US' },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(SnapshotTimelineComponent, { set: { template: '<div></div>' } })
      .compileComponents();
  });

  describe('i18n coverage for dynamically built keys', () => {
    const locales: [string, Record<string, unknown>][] = [
      ['en', en as Record<string, unknown>],
      ['ja', ja as Record<string, unknown>],
      ['tc', tc as Record<string, unknown>],
    ];

    for (const [name, dictionary] of locales) {
      it(`resolves every staleness reason key in ${name}`, () => {
        const missing = STALE_REASON_KEYS.filter(key => {
          const value = key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary);
          return typeof value !== 'string' || value.length === 0;
        });
        expect(missing).toEqual([]);
      });
    }

    it('builds the same keys the component asks for', () => {
      build([snapshot('2026-06')]);
      const built = ['transactionsChanged', 'baseCurrencyChanged', 'timeZoneChanged']
        .map(reason => component.reasonLabel(reason));
      expect(built).toEqual(STALE_REASON_KEYS);
    });
  });

  describe('selection', () => {
    it('emits the month when one is picked', () => {
      build([snapshot('2026-06'), snapshot('2026-05')]);
      const emitted: (string | null)[] = [];
      component.monthSelected.subscribe(value => emitted.push(value));

      component.select('2026-05');
      expect(emitted).toEqual(['2026-05']);
    });

    it('emits null when the open month is picked again', () => {
      build([snapshot('2026-06')], '2026-06');
      const emitted: (string | null)[] = [];
      component.monthSelected.subscribe(value => emitted.push(value));

      component.select('2026-06');
      expect(emitted).toEqual([null]);
    });

    it('resolves the open snapshot', () => {
      build([snapshot('2026-06'), snapshot('2026-05')], '2026-05');
      expect(component.selected()?.monthKey).toBe('2026-05');
    });

    it('has no open snapshot by default', () => {
      build([snapshot('2026-06')]);
      expect(component.selected()).toBeNull();
    });
  });

  describe('staleness presentation', () => {
    it('lists data-change reasons as a warning', () => {
      build([snapshot('2026-06')], '2026-06', {
        isStale: true,
        reasons: ['transactionsChanged', 'baseCurrencyChanged'],
        currentFingerprint: 'abc:2',
      });
      expect(component.staleReasons())
        .toEqual(['transactionsChanged', 'baseCurrencyChanged']);
      expect(component.showsDetectorNote()).toBeFalse();
    });

    it('shows a detector change as a footnote, not a warning', () => {
      // Telling the user their data changed when only our code did would be
      // false, and would fire for every month the first time a threshold moves.
      build([snapshot('2026-06')], '2026-06', {
        isStale: false,
        reasons: ['detectorUpdated'],
        currentFingerprint: 'abc:1',
      });
      expect(component.staleReasons()).toEqual([]);
      expect(component.showsDetectorNote()).toBeTrue();
    });

    it('drops the detector reason from a warning that also has data changes', () => {
      build([snapshot('2026-06')], '2026-06', {
        isStale: true,
        reasons: ['detectorUpdated', 'transactionsChanged'],
        currentFingerprint: 'abc:2',
      });
      expect(component.staleReasons()).toEqual(['transactionsChanged']);
      expect(component.showsDetectorNote()).toBeFalse();
    });

    it('shows neither when nothing changed', () => {
      build([snapshot('2026-06')], '2026-06', {
        isStale: false, reasons: [], currentFingerprint: 'abc:1',
      });
      expect(component.staleReasons()).toEqual([]);
      expect(component.showsDetectorNote()).toBeFalse();
    });
  });

  describe('regenerate', () => {
    it('emits the open month', () => {
      build([snapshot('2026-06')], '2026-06');
      const emitted: string[] = [];
      component.regenerateRequested.subscribe(value => emitted.push(value));

      component.regenerate();
      expect(emitted).toEqual(['2026-06']);
    });

    it('emits nothing with no month open', () => {
      build([snapshot('2026-06')]);
      const emitted: string[] = [];
      component.regenerateRequested.subscribe(value => emitted.push(value));

      component.regenerate();
      expect(emitted).toEqual([]);
    });
  });

  it('formats a month key for display', () => {
    build([snapshot('2026-06')]);
    expect(component.monthLabel('2026-06')).toContain('2026');
    expect(component.monthLabel('nonsense')).toBe('nonsense');
  });

  it('reports having no snapshots', () => {
    build([]);
    expect(component.hasSnapshots()).toBeFalse();
  });
});
