import { Injectable, NgZone, inject } from '@angular/core';

/**
 * A host the registry can measure and rescale. Implemented by
 * `FitTextDirective`; split out so the registry never depends on the
 * directive and the two can be tested apart.
 */
export interface FitTextTarget {
  readonly host: HTMLElement;
  /** Drop any font-size this registry set. Must be a no-op when none was. */
  clearOverride(): void;
  /** How many times wider the content is than its box; 1 means it fits. */
  overflowRatio(): number;
  /** Act on a ratio produced by `overflowRatio`. */
  apply(ratio: number): void;
}

/**
 * Drives every `[appFitText]` on the page from one observer and one frame.
 *
 * The naive shape — a ResizeObserver per element, watching the element —
 * fails twice over. Watching the host feeds the directive its own output: a
 * font-size change alters the host's `scrollWidth`, which wakes the observer,
 * which resizes again. Watching the *parent* cannot do that, because a
 * child's type size does not change its parent's width. And one observer per
 * element is the wrong order of magnitude for a transaction list, where fifty
 * rows carry two amounts each; one observer watching the shared parents costs
 * a fraction of a hundred watching individual spans.
 */
@Injectable({ providedIn: 'root' })
export class FitTextRegistry {
  private readonly zone = inject(NgZone);

  private readonly byParent = new Map<Element, Set<FitTextTarget>>();
  private readonly dirty = new Set<FitTextTarget>();
  private readonly lastWidth = new Map<Element, number>();

  private resize?: ResizeObserver;
  private frame = 0;

  register(target: FitTextTarget): void {
    const parent = target.host.parentElement;
    if (parent) {
      let siblings = this.byParent.get(parent);
      if (!siblings) {
        siblings = new Set();
        this.byParent.set(parent, siblings);
        this.observer().observe(parent);
      }
      siblings.add(target);
    }
    this.markDirty(target);
  }

  unregister(target: FitTextTarget): void {
    this.dirty.delete(target);
    const parent = target.host.parentElement;
    if (!parent) return;
    const siblings = this.byParent.get(parent);
    if (!siblings) return;
    siblings.delete(target);
    if (siblings.size === 0) {
      this.byParent.delete(parent);
      this.lastWidth.delete(parent);
      this.resize?.unobserve(parent);
    }
  }

  /** Queue a target for the next flush. Cheap and idempotent per frame. */
  markDirty(target: FitTextTarget): void {
    this.dirty.add(target);
    if (this.frame) return;
    // Outside the zone: a resize storm must not run app-wide change
    // detection. Nothing here touches component state, only inline styles.
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.flush();
      });
    });
  }

  /**
   * Resize every queued target. Public so the spec can run a pass without
   * waiting on an animation frame.
   *
   * Ordered write-then-read-then-write on purpose: clearing every override
   * first, measuring every target second, and applying third costs the
   * browser one layout for the whole batch. Doing clear/measure/apply per
   * element would force a synchronous layout per element instead.
   */
  flush(): void {
    if (this.dirty.size === 0) return;
    const batch = [...this.dirty];
    this.dirty.clear();

    for (const target of batch) target.clearOverride();
    const ratios = batch.map((target) => target.overflowRatio());
    batch.forEach((target, i) => target.apply(ratios[i]));
  }

  private observer(): ResizeObserver {
    if (!this.resize) {
      this.zone.runOutsideAngular(() => {
        this.resize = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const width = entry.contentRect.width;
            const last = this.lastWidth.get(entry.target);
            // Width only. Watching the parent instead of the host closes the
            // obvious feedback loop, but not the one through the other axis:
            // shrinking a value makes the host shorter, which makes the
            // parent shorter, which wakes this observer, which shrinks again.
            // Height never decides whether a value fits, so a height-only
            // change is not a reason to re-measure.
            if (last !== undefined && Math.abs(last - width) < 0.5) continue;
            this.lastWidth.set(entry.target, width);
            for (const target of this.byParent.get(entry.target) ?? []) {
              this.markDirty(target);
            }
          }
        });
      });
    }
    return this.resize!;
  }
}
