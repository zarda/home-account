import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, QueryList, ViewChildren, signal } from '@angular/core';

import { SwipeRevealDirective } from './swipe-reveal.directive';

/**
 * The gesture is geometric, so these drive it with synthetic PointerEvents
 * and assert on the transforms it writes and the state it settles into. Same
 * shape as the other layout specs: the probe is attached to the document,
 * because only an attached element has a layout box, and the sticky-chip test
 * needs real geometry.
 *
 * Synthetic PointerEvents have no active pointer, so `setPointerCapture`
 * throws `NotFoundError` in here — the directive try/catches it, which is
 * what makes this spec possible at all. Capture only matters on a real
 * device, where the listeners sit on the surface anyway.
 *
 * Velocity is sampled only across gaps of at least 15ms — a real frame — so
 * the back-to-back dispatches below always measure as velocity 0 and settle
 * purely by the half-width rule. The one fling test waits real time between
 * moves instead.
 */
@Component({
  standalone: true,
  imports: [SwipeRevealDirective],
  template: `
    @for (row of rows; track row) {
      <div class="probe-row" (click)="clicks[row] = (clicks[row] ?? 0) + 1">
        <div class="drawer" #drawer>
          <button type="button">Edit</button>
        </div>
        <div
          class="surface"
          appSwipeReveal
          [swipeRevealEnabled]="enabled()"
          swipeRevealIgnore=".strip-like"
          [swipeRevealDrawer]="drawer"
          (swipeRevealOpened)="openedFlags[row] = true"
          (swipeRevealClosed)="openedFlags[row] = false"
        >
          <span class="content">Row {{ row }}</span>
          <div class="strip-like">
            <span class="chip">alpha</span>
            <span class="chip">beta</span>
            <span class="chip">gamma</span>
            <span class="chip">delta</span>
            <span class="chip">epsilon</span>
            <span class="chip sticky-chip">+2</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .probe-row {
        position: relative;
        width: 343px;
        overflow: hidden;
      }
      /* Off-canvas at rest from the stylesheet, exactly as the row component
         will do it; the directive only writes inline transforms on top. */
      .drawer {
        position: absolute;
        top: 0;
        bottom: 0;
        right: 0;
        width: 144px;
        transform: translateX(144px);
      }
      .surface {
        position: relative;
        padding: 8px;
      }
      .content {
        display: block;
      }
      .strip-like {
        display: flex;
        gap: 4px;
        width: 200px;
        overflow-x: auto;
        white-space: nowrap;
      }
      .chip {
        flex-shrink: 0;
        padding: 0 8px;
      }
      .sticky-chip {
        position: sticky;
        right: 0;
        background: #ddd;
      }
    `,
  ],
})
class SwipeProbeComponent {
  @ViewChildren(SwipeRevealDirective) swipes!: QueryList<SwipeRevealDirective>;
  readonly rows = [0, 1];
  enabled = signal(true);
  clicks: Record<number, number> = {};
  openedFlags: Record<number, boolean> = {};
}

describe('SwipeRevealDirective', () => {
  let fixture: ComponentFixture<SwipeProbeComponent>;
  let component: SwipeProbeComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SwipeProbeComponent] }).compileComponents();
    fixture = TestBed.createComponent(SwipeProbeComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => host.remove());

  function surface(index: number): HTMLElement {
    return host.querySelectorAll('.surface')[index] as HTMLElement;
  }

  function drawer(index: number): HTMLElement {
    return host.querySelectorAll('.drawer')[index] as HTMLElement;
  }

  function row(index: number): HTMLElement {
    return host.querySelectorAll('.probe-row')[index] as HTMLElement;
  }

  function content(index: number): HTMLElement {
    return host.querySelectorAll('.content')[index] as HTMLElement;
  }

  function pointer(target: HTMLElement, type: string, x: number, y: number): void {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  /** A committed left swipe: locks horizontal, travels well past half of 144. */
  function dragOpen(index: number): void {
    pointer(content(index), 'pointerdown', 300, 20);
    pointer(surface(index), 'pointermove', 288, 21);
    pointer(surface(index), 'pointermove', 140, 22);
    pointer(surface(index), 'pointerup', 140, 22);
  }

  it('snaps open past half the drawer width', () => {
    dragOpen(0);

    expect(surface(0).style.transform).withContext('surface slid left').toBe('translateX(-144px)');
    expect(drawer(0).style.transform).withContext('drawer slid in').toBe('translateX(0px)');
    expect(row(0).classList).withContext('state class on the gesture container').toContain('swipe-open');
    expect(component.openedFlags[0]).withContext('opened event emitted').toBeTrue();
  });

  it('snaps back closed from a drag short of half', () => {
    pointer(content(0), 'pointerdown', 300, 20);
    pointer(surface(0), 'pointermove', 288, 21);
    pointer(surface(0), 'pointermove', 260, 22);
    pointer(surface(0), 'pointerup', 260, 22);

    expect(surface(0).style.transform).withContext('surface back at rest').toBe('translateX(0px)');
    expect(drawer(0).style.transform).withContext('drawer back off-canvas').toBe('translateX(144px)');
    expect(row(0).classList).not.toContain('swipe-open');
    expect(component.openedFlags[0]).withContext('never opened, so no closed event either').toBeUndefined();
  });

  it('opens on a fling that never reaches half', async () => {
    pointer(content(0), 'pointerdown', 300, 20);
    pointer(surface(0), 'pointermove', 290, 20);
    await new Promise((resolve) => setTimeout(resolve, 25));
    pointer(surface(0), 'pointermove', 270, 20);
    await new Promise((resolve) => setTimeout(resolve, 25));
    pointer(surface(0), 'pointermove', 240, 20);
    pointer(surface(0), 'pointerup', 240, 20);

    // 60px of travel is well short of the 72px half — the speed is what opens it.
    expect(surface(0).style.transform).withContext('fling opened the drawer').toBe('translateX(-144px)');
  });

  it('never engages on a mostly-vertical movement, which belongs to the list scroll', () => {
    pointer(content(0), 'pointerdown', 300, 20);
    pointer(surface(0), 'pointermove', 298, 48);
    pointer(surface(0), 'pointermove', 200, 60);
    pointer(surface(0), 'pointerup', 200, 60);

    expect(surface(0).style.transform).withContext('no transform ever written').toBe('');
    content(0).click();
    expect(component.clicks[0]).withContext('the tap after it still lands').toBe(1);
  });

  it('never engages from a pointerdown inside the ignored strip', () => {
    const chip = host.querySelectorAll('.chip')[0] as HTMLElement;
    pointer(chip, 'pointerdown', 60, 40);
    pointer(surface(0), 'pointermove', 20, 41);
    pointer(surface(0), 'pointerup', 20, 41);

    expect(surface(0).style.transform)
      .withContext('a drag born on the strip scrolls the strip, never the row')
      .toBe('');
  });

  it('suppresses the click that follows a drag', () => {
    dragOpen(0);

    content(0).click();
    expect(component.clicks[0])
      .withContext('the synthesized click after a drag must not activate the row')
      .toBeUndefined();
  });

  it('turns a tap on the open surface into close, not activate', () => {
    dragOpen(0);
    expect(row(0).classList).toContain('swipe-open');

    // A deliberate second tap is its own pointerdown/up pair before the
    // click — which is also what clears the drag's click-suppression flag,
    // exactly as the browser-synthesized click would have upstream.
    pointer(content(0), 'pointerdown', 300, 20);
    pointer(surface(0), 'pointerup', 300, 20);
    content(0).click();

    expect(row(0).classList).withContext('tap closed the drawer').not.toContain('swipe-open');
    expect(surface(0).style.transform).toBe('translateX(0px)');
    expect(component.clicks[0]).withContext('and did not activate the row').toBeUndefined();
  });

  it('closes the previously open row when another row is touched', () => {
    dragOpen(0);
    expect(row(0).classList).toContain('swipe-open');

    dragOpen(1);

    expect(row(1).classList).withContext('second row open').toContain('swipe-open');
    expect(row(0).classList).withContext('first row closed').not.toContain('swipe-open');
    expect(surface(0).style.transform).toBe('translateX(0px)');
    expect(component.openedFlags[0]).withContext('closed event reached the first row').toBeFalse();
  });

  it('closes on close(), which is the Escape route, and on a pointerdown outside', () => {
    dragOpen(0);
    component.swipes.first.close();
    expect(row(0).classList).withContext('close() closed it').not.toContain('swipe-open');
    expect(surface(0).style.transform).toBe('translateX(0px)');

    dragOpen(0);
    expect(row(0).classList).toContain('swipe-open');
    pointer(document.body as HTMLElement, 'pointerdown', 10, 500);
    expect(row(0).classList).withContext('outside pointerdown closed it').not.toContain('swipe-open');
  });

  it('snaps closed when the browser claims the gesture with pointercancel', () => {
    pointer(content(0), 'pointerdown', 300, 20);
    pointer(surface(0), 'pointermove', 288, 21);
    pointer(surface(0), 'pointermove', 180, 22);
    pointer(surface(0), 'pointercancel', 180, 22);

    expect(surface(0).style.transform)
      .withContext('a half-open row must never survive a cancelled gesture')
      .toBe('translateX(0px)');
    expect(row(0).classList).not.toContain('swipe-open');
  });

  it('does nothing at all while disabled', () => {
    component.enabled.set(false);
    fixture.detectChanges();
    expect(component.swipes.first.swipeRevealEnabled())
      .withContext('precondition: the binding reached the input signal')
      .toBeFalse();

    dragOpen(0);

    expect(surface(0).style.transform).toBe('');
    expect(row(0).classList).not.toContain('swipe-open');
    content(0).click();
    expect(component.clicks[0]).withContext('clicks pass through untouched').toBe(1);
  });

  it('keeps the sticky chip pinned inside the strip while the surface is translated', () => {
    // position: sticky resolves against its scrollport, and the scrollport
    // translates with the surface — a transform changes containing blocks for
    // fixed, not for sticky. This is the assertion that pins that down for
    // the row's +N indicator.
    const strip = surface(0).querySelector('.strip-like') as HTMLElement;
    expect(strip.scrollWidth).withContext('strip genuinely overflows').toBeGreaterThan(strip.clientWidth);

    dragOpen(0);

    const chip = strip.querySelector('.sticky-chip') as HTMLElement;
    const chipRect = chip.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    expect(chipRect.right).withContext('chip inside the visible strip').toBeLessThanOrEqual(stripRect.right + 1);
    expect(chipRect.left).withContext('chip not scrolled out of view').toBeGreaterThanOrEqual(stripRect.left - 1);
  });
});
