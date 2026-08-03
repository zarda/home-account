import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { FitTextDirective } from './fit-text.directive';
import { FitTextRegistry } from './fit-text.registry';

/**
 * The directive's whole job is geometric, so these measure real layout rather
 * than assert on the styles it wrote. Same shape as icon-box.spec.ts: the
 * probe is attached to the document, because only an attached element has a
 * layout box, and every container has a fixed width so the result does not
 * depend on the size of the browser window running the test.
 *
 * The containers are flex columns because that is how the directive is used —
 * `.row-amount` and `.nav-item` are both flex, which blockifies the span and
 * gives it a clientWidth to measure against.
 */
@Component({
  standalone: true,
  imports: [FitTextDirective],
  template: `
    <div class="fits-box"><span class="fits" appFitText>-$42.00</span></div>

    <!-- Nine figures plus a currency prefix in a column sized for about six.
         align-items: flex-end is what .row-amount uses, which makes the span
         shrink-to-fit — the regime where its own scrollWidth is useless and
         only the parent's content box shows the overflow. -->
    <div class="tight-box"><span class="tight" appFitText>-¥123,456,789</span></div>

    <!-- Narrower than the floor can rescue: scaling stops, wrapping starts. -->
    <div class="hopeless-box"><span class="hopeless" appFitText>-¥987,654,321,000</span></div>
  `,
  // In the stylesheet, not on the elements: the specs below read `el.style`
  // to prove the directive wrote nothing at all, and an inline style
  // attribute in the template would be indistinguishable from its output.
  styles: [
    `
      .fits-box,
      .tight-box,
      .hopeless-box {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }
      .fits-box {
        width: 300px;
      }
      .tight-box {
        width: 95px;
      }
      .hopeless-box {
        width: 30px;
      }
      .fits,
      .tight,
      .hopeless {
        white-space: nowrap;
        font-size: 16px;
      }
    `,
  ],
})
class FitTextProbeComponent {}

describe('appFitText', () => {
  let host: HTMLElement;
  let registry: FitTextRegistry;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FitTextProbeComponent] }).compileComponents();
    const fixture = TestBed.createComponent(FitTextProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    // Attach before the first pass: a detached element has no layout box, so
    // every measurement would come back zero.
    document.body.appendChild(host);
    fixture.detectChanges();

    registry = TestBed.inject(FitTextRegistry);
    // Run the batch synchronously instead of waiting on an animation frame.
    registry.flush();
  });

  afterEach(() => host.remove());

  function el(selector: string): HTMLElement {
    return host.querySelector(selector) as HTMLElement;
  }

  function fontPx(selector: string): number {
    return parseFloat(getComputedStyle(el(selector)).fontSize);
  }

  /** Long enough for a resize-observer callback and the frame it schedules. */
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 150));
  }

  it('leaves a value that already fits completely untouched', () => {
    const fits = el('.fits');
    // Not "the font size is unchanged" — no style was written at all. A list
    // paging fifty rows does this measurement constantly, and the common case
    // has to cost zero DOM writes, not cheap ones.
    expect(fits.style.fontSize).toBe('');
    expect(fits.style.whiteSpace).toBe('');
    expect(fontPx('.fits')).toBeCloseTo(16, 0);
  });

  it('shrinks an oversized value until it fits its column', () => {
    const box = el('.tight-box').getBoundingClientRect();
    const value = el('.tight').getBoundingClientRect();
    // Measured against the container, not the span's own box: a shrink-to-fit
    // span grows with its text, so its own box always "fits" itself.
    expect(value.width).toBeLessThanOrEqual(box.width);
    // And it actually had to do something to get there.
    expect(fontPx('.tight')).toBeLessThan(16);
  });

  it('keeps every character of the value it shrank', () => {
    // The point of scaling over ellipsising: a shortened amount is a
    // different number, and the reader cannot tell that it was shortened.
    expect(el('.tight').textContent?.trim()).toBe('-¥123,456,789');
    expect(el('.hopeless').textContent?.trim()).toBe('-¥987,654,321,000');
  });

  it('never scales below the 12px floor of the type scale', () => {
    // 30px of column for a thirteen-glyph amount is unwinnable by scaling.
    // Below --text-xs the value stops being readable, so the floor holds and
    // the overflow is dealt with another way.
    expect(fontPx('.hopeless')).toBeGreaterThanOrEqual(12);
  });

  it('wraps rather than clips once the floor is reached', () => {
    const hopeless = el('.hopeless');
    expect(hopeless.style.whiteSpace).toBe('normal');
    // Wrapped onto more lines, not cut off at one.
    expect(hopeless.getBoundingClientRect().height).toBeGreaterThan(20);
  });

  it('restores the stylesheet size when the container grows again', async () => {
    expect(fontPx('.tight')).toBeLessThan(16);

    // The shared observer watches the parent, so a container that grows wakes
    // it exactly as one that shrinks does — otherwise a phone rotating back to
    // landscape would keep amounts at the size the narrow layout needed.
    el('.tight-box').style.width = '400px';
    await settle();
    registry.flush();

    expect(fontPx('.tight')).toBeCloseTo(16, 0);
    expect(el('.tight').style.fontSize).toBe('');
  });

  it('does not re-enter its own observer when it writes a font size', async () => {
    // The resize observer fires once for each element the moment it is
    // observed. Let that land first, so the spy below can only be seeing
    // wake-ups the style write actually caused.
    await settle();

    const spy = spyOn(registry, 'markDirty').and.callThrough();
    // A font-size write is an attribute mutation, and this directive watches
    // childList and characterData only — so its own output must not wake it.
    // If it did, a shrink would trigger a measure would trigger a shrink.
    el('.tight').style.fontSize = '9px';
    await settle();

    expect(spy).not.toHaveBeenCalled();
  });

  it('settles instead of oscillating when the parent is sized by its content', async () => {
    // The shape this runs in: .amount sits in .row-amount, which is
    // shrink-to-fit, inside a row that caps it. Shrinking the value shrinks
    // the parent, which is a resize, which is a reason to measure again — the
    // ingredients of a loop that never stops. It terminates because a pass
    // clears the override before measuring, so every pass sees the same
    // uncapped width and reaches the same answer, and the observer then sees
    // no net width change to report.
    await settle();

    const spy = spyOn(registry, 'markDirty').and.callThrough();
    await settle();
    await settle();

    expect(spy).not.toHaveBeenCalled();
    // Still correct after settling, not merely quiet.
    const box = el('.tight-box').getBoundingClientRect();
    expect(el('.tight').getBoundingClientRect().width).toBeLessThanOrEqual(box.width);
  });

  it('re-measures when the value itself changes', async () => {
    await settle();

    const spy = spyOn(registry, 'markDirty').and.callThrough();
    // The converted line of a foreign amount arrives once the exchange rates
    // load, long after layout settled. No resize observer can see that.
    el('.fits').textContent = '-¥123,456,789,000';
    await settle();

    expect(spy).toHaveBeenCalled();
  });
});
