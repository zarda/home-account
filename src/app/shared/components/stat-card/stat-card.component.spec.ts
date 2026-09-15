import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StatCardComponent } from './stat-card.component';
import { FitTextDirective } from '../../directives/fit-text.directive';
import { FitTextRegistry } from '../../directives/fit-text.registry';

@Component({
  standalone: true,
  imports: [StatCardComponent],
  template: `
    <app-stat-card
      [label]="'Total Income'"
      [labelSuffix]="'USD'"
      [value]="value()"
      [icon]="'trending_up'"
      [tone]="'income'"
      [delta]="delta()"
      [deltaCaption]="'vs previous period'"
      [invertDelta]="invert()"
      [detail]="detail()"
      [detailTone]="'positive'"
    />
  `,
})
class HostComponent {
  value = signal('$1,234.00');
  delta = signal<number | null>(null);
  invert = signal(false);
  detail = signal('');
}

describe('StatCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = <T extends HTMLElement>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders label, suffix, value, and a toned icon tile', () => {
    expect(el('.stat-label')!.textContent).toContain('Total Income');
    expect(el('.stat-label-suffix')!.textContent).toContain('USD');
    expect(el('.stat-value')!.textContent).toContain('$1,234.00');
    expect(el('.stat-icon')!.classList).toContain('tone-income');
    expect(el('.stat-value')!.classList).toContain('tone-income');
  });

  it('hides delta chip and detail line by default', () => {
    expect(el('.delta-chip')).toBeNull();
    expect(el('.stat-detail')).toBeNull();
  });

  it('shows a positive tinted chip for a rise on a normal metric', () => {
    host.delta.set(12.34);
    fixture.detectChanges();

    const chip = el('.delta-chip')!;
    expect(chip.classList).toContain('positive');
    expect(chip.textContent).toContain('12.3%');
    expect(chip.textContent).toContain('arrow_upward');
    expect(el('.delta-caption')!.textContent).toContain('vs previous period');
  });

  it('inverts chip colors for metrics where a rise is bad', () => {
    host.delta.set(5);
    host.invert.set(true);
    fixture.detectChanges();
    expect(el('.delta-chip')!.classList).toContain('negative');

    host.delta.set(-5);
    fixture.detectChanges();
    expect(el('.delta-chip')!.classList).toContain('positive');
  });

  it('pins a word joiner after a leading minus so the sign cannot wrap alone', () => {
    host.value.set('-$1,234.00');
    fixture.detectChanges();
    expect(el('.stat-value')!.textContent).toContain('-\u2060$1,234.00');

    host.value.set('$1,234.00');
    fixture.detectChanges();
    expect(el('.stat-value')!.textContent).not.toContain('\u2060');
  });

  it('renders the toned detail line when provided', () => {
    host.detail.set('+$120.00');
    fixture.detectChanges();

    const detail = el('.stat-detail')!;
    expect(detail.textContent).toContain('+$120.00');
    expect(detail.classList).toContain('detail-positive');
  });
});

/**
 * The dashboard's financial summary at the 1024px breakpoint (lg:grid-cols-3,
 * sidebar open) once handed the Net Balance card a value column narrow
 * enough — about 137px, well under "-NT$9,316" at the base font — that
 * `overflow-wrap: break-word` did exactly what its name says and broke the
 * figure between digits. appFitText is the house answer (docs/ui-overflow.md
 * G3): scale to the 12px floor before ever breaking a line.
 *
 * Real component styles, the probe attached to the document because only an
 * attached element has a layout box, and a fixed container width standing in
 * for the narrow grid column — same shape as truncation-guard.spec.ts.
 */
@Component({
  standalone: true,
  imports: [StatCardComponent],
  template: `
    <div class="narrow">
      <app-stat-card
        [label]="'Net Balance'"
        [value]="value()"
        [icon]="'account_balance_wallet'"
        [tone]="'neutral'"
      />
    </div>
  `,
  // Narrower than the value box ever measured live, so the base --text-2xl
  // font overflows regardless of which font Karma's platform falls back to.
  styles: ['.narrow { width: 180px; }'],
})
class NarrowHostComponent {
  value = signal('-NT$9,316');
}

describe('StatCardComponent real layout: an amount narrower than its box', () => {
  let fixture: ComponentFixture<NarrowHostComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NarrowHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(NarrowHostComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();

    // The directive's own MutationObserver/ResizeObserver fire from real
    // browser callbacks, outside the zone; nothing in a plain (non-fakeAsync)
    // spec waits long enough for either to land before the assertions below
    // run. Marking the directive directly and flushing is what makes the
    // registry measure it here, deterministically — the same fix
    // transaction-preview-table.overflow.spec.ts uses for the same reason.
    // Optional: a regression that drops appFitText from the template leaves
    // nothing to mark, and the assertions below still fail on their own —
    // the dedicated directive-presence case is what names that failure.
    const directive = fixture.debugElement
      .query(By.directive(FitTextDirective))
      ?.injector.get(FitTextDirective);
    if (directive) {
      const registry = TestBed.inject(FitTextRegistry);
      registry.markDirty(directive);
      registry.flush();
    }
  });

  afterEach(() => host.remove());

  it('carries appFitText on the value, so a later refactor cannot silently drop it', () => {
    expect(fixture.debugElement.query(By.directive(FitTextDirective))).not.toBeNull();
  });

  it('scales the amount to fit on one line instead of breaking between digits', () => {
    const value = host.querySelector('.stat-value') as HTMLElement;

    // The painted extent, not just the box: a range over the text node reads
    // one rect per line it actually occupies, dedup'd by top so an invisible
    // WORD JOINER landing in its own zero-width rect cannot read as a second
    // line.
    const range = document.createRange();
    range.selectNodeContents(value);
    const lineTops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    expect(lineTops.size).withContext('the whole value paints on one line').toBeLessThanOrEqual(1);

    expect(value.scrollWidth)
      .withContext("nothing hides past the value's own box")
      .toBeLessThanOrEqual(value.clientWidth + 1);

    expect(parseFloat(getComputedStyle(value).fontSize))
      .withContext('scaled no further than the 12px floor')
      .toBeGreaterThanOrEqual(12);

    expect(value.textContent).withContext('every digit is still there').toContain('-⁠NT$9,316');
  });
});
