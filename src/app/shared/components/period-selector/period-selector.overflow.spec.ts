import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { PeriodSelectorComponent } from './period-selector.component';
import { TranslationService } from '../../../core/services/translation.service';

/** Real en.json dashboard.* strings — the short labels below the tablet breakpoint. */
const LABELS: Record<string, string> = {
  'dashboard.thisMonthShort': 'Month',
  'dashboard.thisMonth': 'This Month',
  'dashboard.lastMonthShort': 'Last',
  'dashboard.lastMonth': 'Last Month',
  'dashboard.last3MonthsShort': '3M',
  'dashboard.last3Months': '3 Months',
  'dashboard.thisYearShort': 'Year',
  'dashboard.thisYear': 'This Year',
  'dashboard.selectMonth': 'Select Month',
};

/** The narrow-phone group width #452 was measured on. */
const HOST_WIDTH_PX = 343;

/** A desktop-width row — wide enough that the toggle must stop at its own content width. */
const DESKTOP_HOST_WIDTH_PX = 900;

@Component({
  standalone: true,
  imports: [PeriodSelectorComponent],
  template: `<div [style.width.px]="width"><app-period-selector /></div>`,
})
class PeriodSelectorOverflowProbeComponent {
  width = HOST_WIDTH_PX;
}

describe('overflow guard: the period selector', () => {
  let fixture: ComponentFixture<PeriodSelectorOverflowProbeComponent>;
  let host: HTMLElement;

  async function setUp(): Promise<void> {
    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => LABELS[key] ?? key);

    await TestBed.configureTestingModule({
      imports: [PeriodSelectorOverflowProbeComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PeriodSelectorOverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-font-scale');
    host?.remove();
  });

  function toggleGroup(): HTMLElement {
    return host.querySelector('.period-toggle') as HTMLElement;
  }

  function scroller(): HTMLElement {
    return host.querySelector('.period-toggle-scroller') as HTMLElement;
  }

  function pickerButton(): HTMLElement {
    return host.querySelector('.picker-btn') as HTMLElement;
  }

  it('keeps the calendar button beside the toggle group at the Extra large font scale', async () => {
    document.documentElement.style.setProperty('--app-font-scale', '1.3');
    await setUp();
    fixture.detectChanges();

    const group = toggleGroup().getBoundingClientRect();
    const button = pickerButton().getBoundingClientRect();

    // The real reason #452's second part cites: the picker no longer shares
    // the toggle group's row, so its top reads a whole row lower.
    expect(Math.abs(button.top - group.top))
      .withContext('calendar button top vs toggle group top')
      .toBeLessThanOrEqual(1);

    const segments = Array.from(toggleGroup().querySelectorAll('mat-button-toggle')) as HTMLElement[];
    for (const segment of segments) {
      expect(Math.abs(segment.getBoundingClientRect().top - group.top))
        .withContext(`segment "${segment.textContent?.trim()}" top vs group top`)
        .toBeLessThanOrEqual(1);
    }

    // The pill may be wider than the scroller's own box (it scrolls), but it
    // can never spill past what the scroller actually gives its content.
    expect(toggleGroup().getBoundingClientRect().width)
      .withContext('pill width vs scroller.scrollWidth — the pill never spills past its scroller')
      .toBeLessThanOrEqual(scroller().scrollWidth + 1);
  });

  it('stops the toggle group at its content width on a desktop row, at the default scale', async () => {
    await setUp();
    fixture.componentInstance.width = DESKTOP_HOST_WIDTH_PX;
    fixture.detectChanges();

    const toggle = toggleGroup();
    const scrollerEl = scroller();
    const scrollerRect = scrollerEl.getBoundingClientRect();
    const buttonRect = pickerButton().getBoundingClientRect();

    // #452 P2: `flex: 1 1 0` grows the scroller into the whole row's free
    // space (836px measured at a 900px host) instead of stopping at its own
    // content — a regression from the content-sized basis this replaced.
    expect(scrollerEl.scrollWidth)
      .withContext('scroller scrollWidth vs clientWidth — no internal overflow left uncapped')
      .toBe(scrollerEl.clientWidth);
    expect(scrollerRect.width)
      .withContext('scroller width ballooning to fill the desktop row (#452 P2 regression)')
      .toBeLessThan(450);

    expect(buttonRect.left - scrollerRect.right)
      .withContext('gap between the scroller and calendar button on the desktop row')
      .toBeGreaterThanOrEqual(7);
    expect(buttonRect.left - scrollerRect.right)
      .withContext('gap between the scroller and calendar button on the desktop row')
      .toBeLessThanOrEqual(9);

    expect(getComputedStyle(scrollerEl).paddingBlockEnd)
      .withContext('.period-toggle-scroller: padding-block-end — the gutter the kept scrollbar is drawn in')
      .toBe('12px');

    // The gutter moved outside the pill's rounded border: the pill itself
    // carries none, and its own height matches a segment's — no blank band.
    expect(getComputedStyle(toggle).paddingBlockEnd)
      .withContext('.period-toggle: padding-block-end — the pill carries no gutter of its own')
      .toBe('0px');

    // The pill's own border (1px top + 1px bottom, drawn outside the
    // content box) is the frame, not the band — strip it before comparing
    // so what's left is purely the pill's content height against a
    // segment's own rendered height.
    const segment = toggle.querySelector('.mat-button-toggle') as HTMLElement;
    const toggleStyle = getComputedStyle(toggle);
    const toggleBorderBlock = parseFloat(toggleStyle.borderTopWidth) + parseFloat(toggleStyle.borderBottomWidth);
    const toggleContentHeight = toggle.getBoundingClientRect().height - toggleBorderBlock;
    expect(Math.abs(toggleContentHeight - segment.getBoundingClientRect().height))
      .withContext('pill content height vs a segment\'s own height — no blank band left under the fill')
      .toBeLessThanOrEqual(1);
  });
});
