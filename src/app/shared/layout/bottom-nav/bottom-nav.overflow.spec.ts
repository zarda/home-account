import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { BottomNavComponent } from './bottom-nav.component';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
import { FitTextRegistry } from '../../directives/fit-text.registry';

/** Real en.json nav.* strings — the four destinations the bar actually renders. */
const LABELS: Record<string, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.transactions': 'Transactions',
  'nav.add': 'Add',
  'nav.budgets': 'Budgets',
  'nav.reports': 'Reports',
};

/** The phone width #452 was measured on. */
const HOST_WIDTH_PX = 375;

/** Somewhere for the test router to land; the nav is what is under test. */
@Component({ standalone: true, template: '' })
class StubPage {}

@Component({
  standalone: true,
  imports: [BottomNavComponent],
  template: `<div [style.width.px]="width"><app-bottom-nav /></div>`,
})
class BottomNavOverflowProbeComponent {
  width = HOST_WIDTH_PX;
}

describe('overflow guard: the bottom nav', () => {
  let fixture: ComponentFixture<BottomNavOverflowProbeComponent>;
  let host: HTMLElement;
  let registry: FitTextRegistry;

  async function setUp(): Promise<void> {
    const mockQuickAdd = jasmine.createSpyObj('QuickAddService', [
      'openAddTransaction',
      'openScanReceipt',
      'openImportPhotos',
    ]);
    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => LABELS[key] ?? key);

    await TestBed.configureTestingModule({
      imports: [BottomNavOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        provideRouter([
          { path: 'dashboard', component: StubPage },
          { path: 'transactions', component: StubPage },
          { path: 'budgets', component: StubPage },
          { path: 'reports', component: StubPage },
        ]),
        { provide: QuickAddService, useValue: mockQuickAdd },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BottomNavOverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    registry = TestBed.inject(FitTextRegistry);
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-font-scale');
    host?.remove();
  });

  function labels(): HTMLElement[] {
    return Array.from(host.querySelectorAll('.nav-label'));
  }

  function items(): HTMLElement[] {
    return Array.from(host.querySelectorAll('.nav-item'));
  }

  /**
   * The real reason #452's first part cites: two fitted labels sit flush
   * against each other, with nothing readable as a boundary between them.
   */
  function expectGutterBetweenLabels(): void {
    const labelEls = labels();
    expect(labelEls.length).withContext('nav-label count').toBe(4);

    const rects = labelEls.map((label) => label.getBoundingClientRect());
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i + 1].left - rects[i].right)
        .withContext(`gap between "${labelEls[i].textContent}" and "${labelEls[i + 1].textContent}"`)
        .toBeGreaterThanOrEqual(4);
    }

    const itemRects = items().map((item) => item.getBoundingClientRect());
    labelEls.forEach((label, i) => {
      const rect = label.getBoundingClientRect();
      expect(rect.left)
        .withContext(`"${label.textContent}" left vs its nav-item`)
        .toBeGreaterThanOrEqual(itemRects[i].left - 1);
      expect(rect.right)
        .withContext(`"${label.textContent}" right vs its nav-item`)
        .toBeLessThanOrEqual(itemRects[i].right + 1);
    });
  }

  it('keeps a gutter between labels at the Extra large font scale', async () => {
    document.documentElement.style.setProperty('--app-font-scale', '1.3');
    await setUp();
    fixture.detectChanges();
    registry.flush();

    expectGutterBetweenLabels();
  });

  it('keeps the same gutter at the default scale, at no cost to the fit budget', async () => {
    await setUp();
    fixture.detectChanges();
    registry.flush();

    expectGutterBetweenLabels();

    for (const label of labels()) {
      if (!label.style.fontSize) continue;
      expect(parseFloat(label.style.fontSize))
        .withContext(`"${label.textContent}" inline font-size`)
        .toBeGreaterThanOrEqual(12);
    }
  });
});
