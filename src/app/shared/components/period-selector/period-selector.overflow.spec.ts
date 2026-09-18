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
  });

  it('stops the toggle group at its content width on a desktop row, at the default scale', async () => {
    await setUp();
    fixture.componentInstance.width = DESKTOP_HOST_WIDTH_PX;
    fixture.detectChanges();

    const toggle = toggleGroup();
    const toggleRect = toggle.getBoundingClientRect();
    const buttonRect = pickerButton().getBoundingClientRect();

    // #452 P2: `flex: 1 1 0` grows the toggle into the whole row's free space
    // (836px measured at a 900px host) instead of stopping at its own
    // content — a regression from the content-sized basis this replaced.
    expect(toggle.scrollWidth)
      .withContext('toggle scrollWidth vs clientWidth — no internal overflow left uncapped')
      .toBe(toggle.clientWidth);
    expect(toggleRect.width)
      .withContext('toggle width ballooning to fill the desktop row (#452 P2 regression)')
      .toBeLessThan(450);

    expect(buttonRect.left - toggleRect.right)
      .withContext('gap between toggle group and calendar button on the desktop row')
      .toBeGreaterThanOrEqual(7);
    expect(buttonRect.left - toggleRect.right)
      .withContext('gap between toggle group and calendar button on the desktop row')
      .toBeLessThanOrEqual(9);
  });
});
