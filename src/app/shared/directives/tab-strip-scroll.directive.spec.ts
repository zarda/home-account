import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { TabStripScrollDirective } from './tab-strip-scroll.directive';
import { afterTwoFrames, provideNoMotion } from '../../core/services/testing';

/**
 * Everything here is geometric, so the probe measures real layout rather than
 * asserting on what the directive wrote. Same shape as fit-text.directive.spec:
 * the host is attached to the document, because only an attached element has a
 * layout box, and the strip has a fixed width so the result does not depend on
 * the size of the browser window running the test.
 *
 * The strip's own scroller lives in styles.scss, keyed on the directive's
 * attribute; Karma bundles styles.scss, so the rule is in force here exactly
 * as it is in the app.
 *
 * The width below is what the failure messages quote; the probe's own
 * `.strip-box` rule is what actually sets it.
 */
const STRIP_WIDTH_PX = 300;

/** Five labels long enough that the strip cannot hold two of them. */
const TAB_LABELS = [
  'Spending Analysis',
  'Category Breakdown',
  'Monthly Comparison',
  'Spending Patterns',
  'Cash-flow Forecast',
];

/**
 * FocusKeyManager switches on `keyCode`, which a constructed KeyboardEvent
 * leaves at 0 — `key` alone dispatches an event the strip ignores.
 */
const ARROW_RIGHT_KEY_CODE = 39;

@Component({
  standalone: true,
  imports: [MatTabsModule, TabStripScrollDirective],
  template: `
    <div class="strip-box">
      <mat-tab-group appTabStripScroll [(selectedIndex)]="index">
        @for (label of labels; track label) {
          <mat-tab [label]="label">
            <p>{{ label }}</p>
          </mat-tab>
        }
      </mat-tab-group>
    </div>
  `,
  styles: [
    `
      .strip-box {
        width: 300px;
      }
    `,
  ],
})
class TabStripScrollProbeComponent {
  readonly index = signal(0);
  readonly labels = TAB_LABELS;
}

/**
 * How wide the count the first label gains late is, px — the Budgets tab's
 * count, which arrives with the first snapshot. Wide on purpose, so the move
 * it makes stands well clear of a pixel's rounding.
 */
const LATE_BADGE_PX = 80;

/**
 * The same strip, opened on its last tab as a `?tab=goals` link opens the
 * budgets page, inside a page that scrolls, with a count its first label
 * gains after it opened.
 *
 * The labels are pinned to Verdana, as docs/testing.md has a width spec pin
 * its face: one case leans on the first two tabs not fitting the strip
 * together, another on the first one fitting it with its count.
 */
@Component({
  standalone: true,
  imports: [MatTabsModule, TabStripScrollDirective],
  template: `
    <div class="page">
      <div class="strip-box">
        <mat-tab-group appTabStripScroll [(selectedIndex)]="index">
          @for (label of labels; track label) {
            <mat-tab>
              <ng-template mat-tab-label>
                {{ label }}
                @if ($first && badge()) {
                  <span class="late-badge">12</span>
                }
              </ng-template>
              <p>{{ label }}</p>
            </mat-tab>
          }
        </mat-tab-group>
      </div>
      <div class="below"></div>
    </div>
  `,
  styles: [
    `
      .page {
        --mat-tab-label-text-font: Verdana, 'DejaVu Sans', sans-serif;
        block-size: 200px;
        overflow-y: auto;
      }

      .strip-box {
        width: 300px;
      }

      .late-badge {
        display: inline-block;
        inline-size: 80px;
      }

      .below {
        block-size: 1000px;
      }
    `,
  ],
})
class TabStripLateLabelProbeComponent {
  readonly index = signal(TAB_LABELS.length - 1);
  readonly labels = TAB_LABELS;
  /** The first label's count, which is not there until the snapshot is. */
  readonly badge = signal(false);
}

let host: HTMLElement;

function header(): HTMLElement {
  return host.querySelector('.mat-mdc-tab-header') as HTMLElement;
}

function container(): HTMLElement {
  return host.querySelector('.mat-mdc-tab-label-container') as HTMLElement;
}

function list(): HTMLElement {
  return host.querySelector('.mat-mdc-tab-list') as HTMLElement;
}

function tabs(): HTMLElement[] {
  return Array.from(host.querySelectorAll('.mat-mdc-tab')) as HTMLElement[];
}

/** The strip is only worth measuring while it has more tabs than it can show. */
function expectStripOverflows(): void {
  const strip = container();
  expect(strip.scrollWidth)
    .withContext(`${TAB_LABELS.length} tabs in ${STRIP_WIDTH_PX}px: scrollWidth vs clientWidth`)
    .toBeGreaterThan(strip.clientWidth + 1);
}

/**
 * A later tab the reader can see, and see because the strip scrolled to it.
 *
 * The rect on its own proves nothing: Material's pagination puts the same
 * tab in view by translating the list, leaving the scroller at rest. The
 * scroll offset is what says which of the two did it.
 */
function expectStripScrolledTo(index: number, when = ''): void {
  expect(container().scrollLeft)
    .withContext(`the strip's scroll offset after revealing tab ${index}${when}`)
    .toBeGreaterThan(0);
  expectTabWhole(index, when);
}

/** The tab lies wholly inside the strip, whatever the strip's offset. */
function expectTabWhole(index: number, when = ''): void {
  const box = container().getBoundingClientRect();
  const tab = tabs()[index].getBoundingClientRect();
  expect(tab.x)
    .withContext(`tab ${index} ("${TAB_LABELS[index]}") start edge vs the scroller's${when}`)
    .toBeGreaterThanOrEqual(box.x - 1);
  expect(tab.x + tab.width)
    .withContext(`tab ${index} ("${TAB_LABELS[index]}") end edge vs the scroller's${when}`)
    .toBeLessThanOrEqual(box.x + box.width + 1);
}

function pressArrowRight(view: { detectChanges(): void }): void {
  container().dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      keyCode: ARROW_RIGHT_KEY_CODE,
      bubbles: true,
    })
  );
  view.detectChanges();
}

describe('TabStripScrollDirective', () => {
  let fixture: ComponentFixture<TabStripScrollProbeComponent>;
  let probe: TabStripScrollProbeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabStripScrollProbeComponent],
      providers: [provideNoMotion()],
    }).compileComponents();

    fixture = TestBed.createComponent(TabStripScrollProbeComponent);
    probe = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    host?.remove();
  });

  it('leaves the pagination chevrons out of an overflowing strip', () => {
    expectStripOverflows();

    expect(header().classList.contains('mat-mdc-tab-header-pagination-controls-enabled'))
      .withContext('pagination controls enabled on an overflowing strip')
      .toBeFalse();

    const chevrons = Array.from(
      host.querySelectorAll('.mat-mdc-tab-header-pagination')
    ) as HTMLElement[];
    expect(chevrons.length).withContext('chevron count').toBe(2);
    for (const chevron of chevrons) {
      expect(getComputedStyle(chevron).display)
        .withContext(`${chevron.className}: display`)
        .toBe('none');
    }

    const list = host.querySelector('.mat-mdc-tab-list') as HTMLElement;
    expect(getComputedStyle(list).transform)
      .withContext('the tab list: transform (Material pages by translating it)')
      .toBe('none');
  });

  it('is a scroller a finger or a trackpad can drive', () => {
    const strip = container();
    expectStripOverflows();

    expect(getComputedStyle(strip).overflowX)
      .withContext('the label container: overflow-x')
      .toBe('auto');

    expect(getComputedStyle(strip).scrollbarWidth)
      .withContext('the label container: scrollbar-width')
      .toBe('thin');

    expect(getComputedStyle(strip).paddingBlockEnd)
      .withContext('the label container: padding-block-end — the gutter the bar is drawn in')
      .toBe('12px');

    const before = tabs()[0].getBoundingClientRect().x;
    strip.scrollLeft = 200;

    expect(strip.scrollLeft)
      .withContext('a scroll offset written by the reader, read back')
      .toBe(200);
    expect(before - tabs()[0].getBoundingClientRect().x)
      .withContext('how far the first tab travelled for those 200px')
      .toBeCloseTo(200, 0);
  });

  it('brings a newly selected tab into view', async () => {
    probe.index.set(TAB_LABELS.length - 1);
    fixture.detectChanges();
    // selectedIndexChange is emitted from a microtask in ngAfterContentChecked.
    await fixture.whenStable();

    expectStripOverflows();
    expectStripScrolledTo(TAB_LABELS.length - 1);
  });

  it('keeps the tab the arrow keys walk to in view', async () => {
    pressArrowRight(fixture);
    pressArrowRight(fixture);
    pressArrowRight(fixture);
    await fixture.whenStable();

    expect(document.activeElement)
      .withContext('the focused element after three ArrowRights')
      .toBe(tabs()[3]);
    expectStripOverflows();
    expectStripScrolledTo(3);
  });

  it('keeps a clicked tab in view when the reader scrolled to it first', async () => {
    const strip = container();
    strip.scrollLeft = strip.scrollWidth;
    fixture.detectChanges();

    const last = TAB_LABELS.length - 1;
    tabs()[last].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expectStripOverflows();
    expectStripScrolledTo(last);
  });

  it("rests the active tab's underline on the divider, below the scrollbar's gutter", () => {
    const listStyle = getComputedStyle(list());
    expect(listStyle.borderBlockEndWidth)
      .withContext('the tab list: border-block-end-width — the divider the underline rests on')
      .toBe('1px');

    expect(getComputedStyle(header()).borderBottomWidth)
      .withContext('the tab header: border-bottom-width — Material draws no second divider here')
      .toBe('0px');

    const listRect = list().getBoundingClientRect();
    const activeTab = host.querySelector('.mdc-tab--active') as HTMLElement;
    const tabRect = activeTab.getBoundingClientRect();
    const borderWidth = parseFloat(listStyle.borderBlockEndWidth);

    expect(Math.abs(tabRect.bottom - (listRect.bottom - borderWidth)))
      .withContext("the active tab's rect bottom vs the list's rect bottom minus the border width")
      .toBeLessThanOrEqual(1);
  });
});

/**
 * The landing reveal measures the labels as the first render left them, and
 * a count, a late font or a turned phone moves them after it. Each case here
 * changes a size after the strip has opened and its observer's first report
 * has landed, then waits two frames for the next report.
 */
describe('TabStripScrollDirective, when the labels change after the strip opens', () => {
  let fixture: ComponentFixture<TabStripLateLabelProbeComponent>;
  let probe: TabStripLateLabelProbeComponent;
  let observe: jasmine.Spy<ResizeObserver['observe']>;
  const last = TAB_LABELS.length - 1;

  beforeEach(async () => {
    // Before anything is built, so the directive's own observer is among the calls.
    observe = spyOn(ResizeObserver.prototype, 'observe').and.callThrough();

    await TestBed.configureTestingModule({
      imports: [TabStripLateLabelProbeComponent],
      providers: [provideNoMotion()],
    }).compileComponents();

    fixture = TestBed.createComponent(TabStripLateLabelProbeComponent);
    probe = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    // The landing reveal is a render hook, which zone-mode detectChanges never runs.
    TestBed.tick();
    await fixture.whenStable();
    // Every observe() delivers a first report; let it land before a case moves anything.
    await afterTwoFrames();

    expectStripOverflows();
    expectStripScrolledTo(last, ', on landing');
  });

  afterEach(() => {
    host?.remove();
  });

  function stripBox(): HTMLElement {
    return host.querySelector('.strip-box') as HTMLElement;
  }

  function widenTheFirstTab(): void {
    probe.badge.set(true);
    fixture.detectChanges();
  }

  it('keeps the landing tab whole when a label before it widens', async () => {
    const before = container().scrollWidth;
    widenTheFirstTab();
    await afterTwoFrames();

    expect(container().scrollWidth - before)
      .withContext("how far the late count widened the strip's content")
      .toBeGreaterThanOrEqual(LATE_BADGE_PX - 1);
    expectStripScrolledTo(last, ', after a label before it widened');
  });

  it('keeps the landing tab whole when the strip narrows', async () => {
    stripBox().style.width = `${STRIP_WIDTH_PX - 60}px`;
    await afterTwoFrames();

    expect(container().clientWidth)
      .withContext(`the strip, narrowed from ${STRIP_WIDTH_PX}px`)
      .toBeLessThan(STRIP_WIDTH_PX - 50);
    expectStripScrolledTo(last, ', after the strip narrowed');
  });

  it('keeps the landing tab whole when the strip widens past its labels and narrows again', async () => {
    stripBox().style.width = `${container().scrollWidth + 40}px`;
    await afterTwoFrames();
    expect(container().scrollLeft)
      .withContext('the strip, wide enough for every tab: the browser clamps its offset')
      .toBe(0);

    stripBox().style.width = '';
    await afterTwoFrames();
    expectStripScrolledTo(last, ', after the strip widened past its labels and narrowed again');
  });

  it('keeps the landing tab whole when a label before it widens while the strip has no box', async () => {
    stripBox().style.display = 'none';
    await afterTwoFrames();
    expect(container().clientWidth).withContext('the strip, hidden: its width').toBe(0);

    widenTheFirstTab();
    await afterTwoFrames();
    stripBox().style.display = '';
    await afterTwoFrames();
    expectStripScrolledTo(last, ', after a label before it widened while the strip had no box');
  });

  it('keeps a tab the reader picked whole when a label before it widens', async () => {
    // The reader scrolls back to the start and picks the second tab before the count lands.
    container().scrollLeft = 0;
    probe.index.set(1);
    fixture.detectChanges();
    // selectedIndexChange is emitted from a microtask in ngAfterContentChecked.
    await fixture.whenStable();
    expectStripScrolledTo(1, ', once picked');

    widenTheFirstTab();
    await afterTwoFrames();
    expectStripScrolledTo(1, ', after a label before it widened');
  });

  it('leaves a strip the reader scrolled where they left it when a label widens', async () => {
    container().scrollLeft = 0;
    widenTheFirstTab();
    await afterTwoFrames();

    expect(container().scrollLeft)
      .withContext("the strip's offset: the reader scrolled it back to the start before the count arrived")
      .toBe(0);
  });

  it('keeps the tab the keys walked to in view, not the selected one, when a label widens', async () => {
    pressArrowRight(fixture);
    await fixture.whenStable();
    expect(document.activeElement)
      .withContext('focus after ArrowRight from the last tab (the key manager wraps)')
      .toBe(tabs()[0]);

    widenTheFirstTab();
    await afterTwoFrames();
    expectTabWhole(0, ', the tab the keys are on, after its label widened');
  });

  it('never moves the page around the strip to reveal a tab', async () => {
    const page = host.querySelector('.page') as HTMLElement;
    page.scrollTop = 400;
    expect(page.scrollTop).withContext('the page, scrolled down past the strip').toBe(400);

    widenTheFirstTab();
    await afterTwoFrames();
    expect(page.scrollTop)
      .withContext('the scroller the strip sits in, after a reveal while the strip was scrolled out of it')
      .toBe(400);
  });

  it("lets go of the label row's observer when the strip is destroyed", () => {
    const row = host.querySelector('.mat-mdc-tab-labels');
    const ours = observe.calls.all().find((call) => call.args[0] === row)?.object;
    expect(ours).withContext('the observer that watches the label row').toBeDefined();

    const disconnect = spyOn(ResizeObserver.prototype, 'disconnect').and.callThrough();
    fixture.destroy();
    expect(disconnect.calls.all().some((call) => call.object === ours))
      .withContext('the label-row observer, disconnected on destroy')
      .toBeTrue();
  });
});
