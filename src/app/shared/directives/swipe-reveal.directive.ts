import {
  AfterViewInit,
  Directive,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  input,
  output,
} from '@angular/core';

import { SwipeRevealHandle, SwipeRevealRegistry } from './swipe-reveal.registry';

/**
 * Slides its host sideways to reveal a drawer of actions parked behind it.
 *
 * The host is the row's visible surface; the drawer is a sibling the caller
 * passes in, off-canvas at rest from the caller's own stylesheet. During a
 * drag the two move in lockstep — the drawer enters exactly as fast as the
 * surface leaves — so the revealed zone always equals the drawer's visible
 * part and the surface can stay transparent, which keeps the row's hover and
 * highlight painting on the host underneath.
 *
 * The gesture must coexist with three other owners of a touch, and each has
 * a dedicated guard:
 *
 *   - The row's own horizontal scroller (the category strip): a pointerdown
 *     whose target is inside `swipeRevealIgnore` never starts a gesture, and
 *     `touch-action: pan-y` deliberately stays off the scroller's ancestors.
 *   - The list's vertical scroll: the first 8px of travel decide the axis,
 *     and a mostly-vertical start abandons the gesture without having written
 *     anything.
 *   - The row's tap-to-activate: any drag suppresses the click that follows
 *     it (capture phase, before the row's own handler), and a tap while open
 *     closes rather than activates.
 *
 * State (open/closed, events, the `swipe-open` class on the host's parent)
 * settles synchronously on pointerup; the transition that follows is only
 * paint. That is what makes the gesture drivable by synthetic events in a
 * spec — nothing to await — and `setPointerCapture` is try/caught because
 * synthetic events have no active pointer to capture.
 *
 * Velocity is sampled only across gaps of at least a frame (15ms): a fling
 * is read from real elapsed time, while back-to-back synthetic dispatches
 * measure as velocity 0 and settle by the half-width rule alone.
 */
@Directive({
  selector: '[appSwipeReveal]',
  exportAs: 'appSwipeReveal',
  standalone: true,
})
export class SwipeRevealDirective implements SwipeRevealHandle, AfterViewInit, OnDestroy {
  /** First 8px of travel pick the axis; under that a touch is still a tap. */
  private static readonly AXIS_LOCK_PX = 8;
  /** Faster than this opens (leftward) or closes (rightward) regardless of distance. */
  private static readonly FLING_PX_PER_MS = 0.3;
  /** Velocity is only trusted across at least a frame of real time. */
  private static readonly VELOCITY_SAMPLE_MS = 15;
  private static readonly SETTLE_MS = 150;

  swipeRevealEnabled = input(false);
  /** CSS selector; a pointerdown whose target matches never starts a gesture. */
  swipeRevealIgnore = input('');
  swipeRevealWidth = input(144);
  swipeRevealDrawer = input<HTMLElement | null>(null);

  swipeRevealOpened = output<void>();
  swipeRevealClosed = output<void>();

  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly registry = inject(SwipeRevealRegistry);
  private readonly zone = inject(NgZone);

  private state: 'idle' | 'tracking' | 'dragging' = 'idle';
  private isOpen = false;
  /** The surface's logical translateX, always in [-width, 0]. */
  private offset = 0;
  private startX = 0;
  private startY = 0;
  private baseOffset = 0;
  private suppressClick = false;
  private sampleX = 0;
  private sampleT = 0;
  private velocity = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.swipeRevealEnabled() || !event.isPrimary) return;

    // A new touch means the post-drag click, if there was one, has already
    // happened — browsers dispatch the synthesized click before the next
    // pointerdown. A stale flag here would swallow the tap this touch is
    // about to become.
    this.suppressClick = false;

    // Attention moved to this row: whichever other row is open retires, even
    // when this touch never becomes a swipe — or lands on the ignored strip.
    this.registry.interact(this);

    const ignore = this.swipeRevealIgnore();
    const target = event.target as Element | null;
    if (ignore && target?.closest(ignore)) return;

    this.state = 'tracking';
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.baseOffset = this.offset;
    this.sampleX = event.clientX;
    this.sampleT = performance.now();
    this.velocity = 0;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.state === 'idle') return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;

    if (this.state === 'tracking') {
      if (Math.abs(dy) >= SwipeRevealDirective.AXIS_LOCK_PX && Math.abs(dy) > Math.abs(dx)) {
        // The list scroll owns it. Nothing was written, so there is nothing
        // to undo — the whole point of deciding before touching the DOM.
        this.state = 'idle';
        return;
      }
      if (Math.abs(dx) >= SwipeRevealDirective.AXIS_LOCK_PX && Math.abs(dx) >= Math.abs(dy)) {
        this.state = 'dragging';
        this.suppressClick = true;
        try {
          this.host.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic events (Karma) have no active pointer to capture.
          // Capture is a nicety on real devices, not a dependency: the
          // listeners sit on the surface either way.
        }
      } else {
        return;
      }
    }

    const now = performance.now();
    if (now - this.sampleT >= SwipeRevealDirective.VELOCITY_SAMPLE_MS) {
      this.velocity = (event.clientX - this.sampleX) / (now - this.sampleT);
      this.sampleX = event.clientX;
      this.sampleT = now;
    }

    this.offset = Math.min(0, Math.max(-this.swipeRevealWidth(), this.baseOffset + dx));
    this.writeTransforms(false);
  };

  private readonly onPointerUp = (): void => {
    const wasDragging = this.state === 'dragging';
    this.state = 'idle';
    if (!wasDragging) return;

    let open: boolean;
    if (this.velocity <= -SwipeRevealDirective.FLING_PX_PER_MS) {
      open = true;
    } else if (this.velocity >= SwipeRevealDirective.FLING_PX_PER_MS) {
      open = false;
    } else {
      open = this.offset < -this.swipeRevealWidth() / 2;
    }
    this.settle(open);
  };

  private readonly onPointerCancel = (): void => {
    // The browser claimed the gesture (it became a scroll). A half-open row
    // must never survive that.
    if (this.state === 'dragging') this.settle(false);
    this.state = 'idle';
  };

  private readonly onClickCapture = (event: MouseEvent): void => {
    if (this.suppressClick) {
      // The click the browser synthesizes after a drag. Capture phase, so it
      // dies before the row's own activate handler ever sees it.
      this.suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (this.isOpen) {
      // A tap on the open surface means "put it back", not "open the editor".
      event.stopPropagation();
      event.preventDefault();
      this.close();
    }
  };

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const container = this.host.parentElement ?? this.host;
    if (!container.contains(event.target as Node)) {
      this.close();
    }
  };

  ngAfterViewInit(): void {
    // Outside the zone: pointermove during a drag runs per frame and writes
    // only inline styles; app-wide change detection has no business there.
    this.zone.runOutsideAngular(() => {
      this.host.addEventListener('pointerdown', this.onPointerDown);
      this.host.addEventListener('pointermove', this.onPointerMove);
      this.host.addEventListener('pointerup', this.onPointerUp);
      this.host.addEventListener('pointercancel', this.onPointerCancel);
      this.host.addEventListener('click', this.onClickCapture, true);
    });
  }

  ngOnDestroy(): void {
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('pointercancel', this.onPointerCancel);
    this.host.removeEventListener('click', this.onClickCapture, true);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.registry.closed(this);
  }

  /** Close the drawer. The Escape binding and the action buttons route here. */
  close(): void {
    if (!this.isOpen && this.offset === 0) return;
    this.settle(false);
  }

  private settle(open: boolean): void {
    this.offset = open ? -this.swipeRevealWidth() : 0;
    this.writeTransforms(true);

    if (open === this.isOpen) return;
    this.isOpen = open;

    // The state class rides the host's parent — the element that owns both
    // the surface and the drawer — where a stylesheet can reach either.
    this.host.parentElement?.classList.toggle('swipe-open', open);

    if (open) {
      this.registry.opened(this);
      document.addEventListener('pointerdown', this.onDocumentPointerDown);
    } else {
      this.registry.closed(this);
      document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    }

    this.zone.run(() => (open ? this.swipeRevealOpened.emit() : this.swipeRevealClosed.emit()));
  }

  /**
   * Drawer at width + offset: enters exactly as fast as the surface leaves,
   * so the revealed zone always equals the drawer's visible part.
   *
   * State is final before the settle transition starts — the animation is
   * only paint, which is what keeps every rest point synchronous and the
   * gesture drivable without waiting on frames.
   */
  private writeTransforms(animate: boolean): void {
    const drawer = this.swipeRevealDrawer();
    const transition = animate ? `transform ${SwipeRevealDirective.SETTLE_MS}ms ease` : '';
    this.host.style.transition = transition;
    this.host.style.transform = `translateX(${this.offset}px)`;
    if (drawer) {
      drawer.style.transition = transition;
      drawer.style.transform = `translateX(${this.swipeRevealWidth() + this.offset}px)`;
    }
    if (animate) {
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.host.style.transition = '';
        if (drawer) drawer.style.transition = '';
        this.settleTimer = null;
      }, SwipeRevealDirective.SETTLE_MS + 50);
    }
  }
}
