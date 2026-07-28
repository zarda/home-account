import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * The global `mat-icon.mat-icon` rule in styles.scss keeps an icon's box the
 * same size as its glyph. These assert the two ways that box has been lost.
 *
 * Global styles are loaded into the Karma bundle (see the test target's
 * `styles` in angular.json), so this measures the real cascade rather than a
 * copy of it.
 */
@Component({
  standalone: true,
  imports: [MatIconModule],
  template: `
    <!-- A long text sibling makes the flex line tight, which is what used to
         squeeze the icon. The container is deliberately narrow so the pressure
         does not depend on the size of the browser window running the test. -->
    <div class="probe-row" style="display: flex; align-items: flex-start; gap: 16px; width: 200px;">
      <mat-icon class="probe-icon">lock</mat-icon>
      <p style="margin: 0;">
        Transactions, receipts and notes are stored in your own account and are
        never sold or shared. Anonymous usage statistics are included in the
        free plan: only screens and features are recorded.
      </p>
    </div>

    <div class="probe-loose" style="display: flex; gap: 16px; width: 600px;">
      <mat-icon class="probe-icon-loose">copyright</mat-icon>
      <p style="margin: 0;">Short.</p>
    </div>
  `,
})
class IconBoxProbeComponent {}

describe('mat-icon box', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [IconBoxProbeComponent] }).compileComponents();
    const fixture = TestBed.createComponent(IconBoxProbeComponent);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    // Only an attached element has a layout box.
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  function box(selector: string): { width: number; fontSize: number } {
    const icon = host.querySelector(selector) as HTMLElement;
    return {
      width: icon.getBoundingClientRect().width,
      fontSize: parseFloat(getComputedStyle(icon).fontSize),
    };
  }

  it('does not shrink when a long text sibling tightens the flex line', () => {
    // Material gives mat-icon overflow:hidden, and an overflow that is not
    // visible collapses a flex item's automatic minimum size to zero — so
    // without flex-shrink:0 the icon is squeezed and, because the overflow is
    // hidden, the glyph is clipped to a sliver rather than scaled down. It was
    // measured at 9.9px of a 24px glyph on the About page's privacy card.
    const { width, fontSize } = box('.probe-icon');
    expect(width).toBeCloseTo(fontSize, 0);
  });

  it('is the same size whether or not the line is tight', () => {
    // The old behaviour depended on how much slack the neighbouring text left,
    // which is why one card on a page could look right while the one below it
    // was clipped — and why a longer translation could break a layout that had
    // always looked fine.
    expect(box('.probe-icon').width).toBeCloseTo(box('.probe-icon-loose').width, 0);
  });

  it('keeps a square box matching the glyph size', () => {
    const icon = host.querySelector('.probe-icon') as HTMLElement;
    const rect = icon.getBoundingClientRect();
    expect(rect.width).toBeCloseTo(rect.height, 0);
  });
});
