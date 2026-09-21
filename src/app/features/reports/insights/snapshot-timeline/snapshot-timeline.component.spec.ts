import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { SnapshotTimelineComponent } from './snapshot-timeline.component';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightSnapshot, SnapshotStaleness } from '../../../../models';
import en from '../../../../../assets/i18n/en.json';
import ja from '../../../../../assets/i18n/ja.json';
import tc from '../../../../../assets/i18n/tc.json';
import { createTranslationStub } from '../../../../core/services/testing';

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

/**
 * The cases above override the template to `<div></div>`. They prove the
 * computeds, but the timeline's whole job is the chip row and the two
 * mutually exclusive strips under it: a warning when the user's own data
 * moved, and a quiet footnote when only the detector version did. Which of
 * those renders is a template decision (`@if … @else if`), and nothing until
 * here has ever rendered either.
 */
describe('SnapshotTimelineComponent, through its own template', () => {
  let fixture: ComponentFixture<SnapshotTimelineComponent>;
  let component: SnapshotTimelineComponent;

  function snap(monthKey: string): InsightSnapshot {
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

  function stale(reasons: SnapshotStaleness['reasons'], isStale: boolean): SnapshotStaleness {
    return { isStale, reasons, currentFingerprint: 'x:2' };
  }

  function render(
    snapshots: InsightSnapshot[],
    selectedMonth: string | null = null,
    staleness: SnapshotStaleness | null = null,
    isRegenerating = false,
  ): void {
    fixture.componentRef.setInput('snapshots', snapshots);
    fixture.componentRef.setInput('selectedMonth', selectedMonth);
    fixture.componentRef.setInput('staleness', staleness);
    fixture.componentRef.setInput('isRegenerating', isRegenerating);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const chips = () => Array.from(el().querySelectorAll('.month-chip')) as HTMLButtonElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SnapshotTimelineComponent],
      providers: [
        {
          // `monthLabel` formats through Intl with the service's own locale,
          // which the shared stub has no opinion about.
          provide: TranslationService,
          useValue: { ...createTranslationStub(), getIntlLocale: () => 'en-US' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SnapshotTimelineComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing when there is no stored month', () => {
    render([]);

    expect(el().querySelector('.timeline')).toBeNull();
    expect(el().textContent?.trim()).toBe('');
  });

  it('offers one labelled chip per stored month', () => {
    render([snap('2026-06'), snap('2026-05')]);

    expect(chips().map(c => c.textContent?.trim())).toEqual(['Jun 2026', 'May 2026']);
    expect(el().querySelector('.chip-row')?.getAttribute('role')).toBe('group');
    expect(el().querySelector('.chip-row')?.getAttribute('aria-label')).toBe('insights.timelineLabel');
    expect(chips().every(c => c.getAttribute('aria-pressed') === 'false')).toBeTrue();
  });

  it('marks the selected chip pressed and no other', () => {
    render([snap('2026-06'), snap('2026-05')], '2026-05');

    expect(chips().map(c => c.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(chips()[1].classList).toContain('selected');
  });

  it('emits the month a chip names, and clears it when the same chip is clicked again', () => {
    const emitted: (string | null)[] = [];
    component.monthSelected.subscribe(m => emitted.push(m));

    render([snap('2026-06')]);
    chips()[0].click();
    expect(emitted).toEqual(['2026-06']);

    render([snap('2026-06')], '2026-06');
    chips()[0].click();
    expect(emitted).toEqual(['2026-06', null]);
  });

  it('shows the viewing bar only once a month is selected, with a way back', () => {
    render([snap('2026-06')]);
    expect(el().querySelector('.viewing-bar')).toBeNull();

    const emitted: (string | null)[] = [];
    component.monthSelected.subscribe(m => emitted.push(m));
    render([snap('2026-06')], '2026-06');

    expect(text('.viewing-text')).toBe('insights.viewingMonth:{"month":"Jun 2026"}');
    (el().querySelector('.viewing-bar button') as HTMLButtonElement).click();
    expect(emitted).toEqual([null]);
  });

  it('warns with the reasons that mean the user\'s own data moved', () => {
    render([snap('2026-06')], '2026-06', stale(['transactionsChanged', 'baseCurrencyChanged'], true));

    expect(el().querySelector('.stale-strip')?.getAttribute('role')).toBe('status');
    expect(text('.stale-title')).toBe('insights.staleTitle');
    expect(
      Array.from(el().querySelectorAll('.stale-reason')).map(n => n.textContent?.trim())
    ).toEqual(['insights.stale_transactionsChanged', 'insights.stale_baseCurrencyChanged']);
    expect(el().querySelector('.detector-note')).toBeNull();
  });

  it('demotes a detector-only change to a footnote rather than a warning', () => {
    render([snap('2026-06')], '2026-06', stale(['detectorUpdated'], false));

    expect(el().querySelector('.stale-strip')).toBeNull();
    expect(text('.detector-note')).toContain('insights.detectorUpdatedNote');
  });

  it('asks for a regenerate of the month being viewed, and refuses while one runs', () => {
    const asked: string[] = [];
    component.regenerateRequested.subscribe(m => asked.push(m));
    render([snap('2026-06')], '2026-06', stale(['transactionsChanged'], true));

    const regenerate = el().querySelector('.stale-strip button') as HTMLButtonElement;
    expect(regenerate.disabled).toBeFalse();
    regenerate.click();
    expect(asked).toEqual(['2026-06']);

    render([snap('2026-06')], '2026-06', stale(['transactionsChanged'], true), true);
    expect((el().querySelector('.stale-strip button') as HTMLButtonElement).disabled).toBeTrue();
  });
});
