import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatTabsModule } from '@angular/material/tabs';

import { TabStripScrollDirective } from './tab-strip-scroll.directive';

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

describe('TabStripScrollDirective', () => {
  let fixture: ComponentFixture<TabStripScrollProbeComponent>;
  let probe: TabStripScrollProbeComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabStripScrollProbeComponent, NoopAnimationsModule],
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
  function expectStripScrolledTo(index: number): void {
    const strip = container();
    expect(strip.scrollLeft)
      .withContext(`the strip's scroll offset after revealing tab ${index}`)
      .toBeGreaterThan(0);

    const box = strip.getBoundingClientRect();
    const tab = tabs()[index].getBoundingClientRect();
    expect(tab.x)
      .withContext(`tab ${index} ("${TAB_LABELS[index]}") start edge vs the scroller's`)
      .toBeGreaterThanOrEqual(box.x - 1);
    expect(tab.x + tab.width)
      .withContext(`tab ${index} ("${TAB_LABELS[index]}") end edge vs the scroller's`)
      .toBeLessThanOrEqual(box.x + box.width + 1);
  }

  function pressArrowRight(): void {
    container().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        keyCode: ARROW_RIGHT_KEY_CODE,
        bubbles: true,
      })
    );
    fixture.detectChanges();
  }

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
    pressArrowRight();
    pressArrowRight();
    pressArrowRight();
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
