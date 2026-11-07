import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTabGroup } from '@angular/material/tabs';

/**
 * Makes a Material tab strip scroll under a finger or a trackpad, the way
 * every other horizontal strip in the app does (G7).
 *
 * Material's tab header is the one strip that is not a scroller. It clips its
 * label container, moves the list of titles by `transform`, and drives that
 * transform from two chevron buttons at the ends and nothing else — the
 * chevrons carry `touch-action: none` and own the only touch listeners, so a
 * finger dragged across the titles moves nothing at all and a trackpad has
 * no scroller to send its delta to.
 *
 * Turning the pagination off is only half of it. `disablePagination` makes
 * every one of the header's own scroll methods return early and takes the
 * chevrons out of the layout, but the label container is still
 * `overflow: hidden`, which would leave the later tabs unreachable by any
 * means at all. The container is therefore given a real scroller in
 * styles.scss, keyed on this directive's own attribute so no tab group that
 * has not opted in is touched — and what is left here is keeping the tab the
 * reader is on inside it.
 *
 * That last part is not optional either. `_setTabFocus` writes
 * `scrollLeft = 0` on the container after every change of focus index —
 * arrow keys and clicks alike, since a click sets the focus index too — which
 * against a real scroller yanks the strip back to the first tab each time
 * someone picks a later one. The `focusChange` subscription runs before that
 * write (the group re-emits the header's `indexFocused` synchronously), so
 * the correction is queued as a microtask and lands after it.
 *
 * And the landing reveal is not the last word. It measures the labels as the
 * first render left them, and they do not stay that way: the budgets tab's
 * count arrives with the first snapshot, a font or a catalog lands late, the
 * phone turns. Each one moves the tab the strip was showing, and nothing
 * selects or focuses anything to bring it back — a `?tab=goals` link at
 * 375px opened with Goals cut to its first letter. So the strip watches its
 * labels and its own width and puts that tab back, unless the reader has
 * moved the strip since, because then where it rests is theirs.
 *
 *     <mat-tab-group appTabStripScroll>
 */
@Directive({
  selector: 'mat-tab-group[appTabStripScroll]',
  standalone: true,
})
export class TabStripScrollDirective {
  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly tabGroup = inject(MatTabGroup);
  private readonly destroyRef = inject(DestroyRef);

  /** The tab the last reveal was for, and the offset it left the strip at. */
  private readonly revealed = { index: 0, at: 0 };

  constructor() {
    // Before the group's first check, so its own `[disablePagination]` binding
    // carries this down to the header on the very first pass — the header has
    // then never measured itself for pagination and never shows the chevrons.
    this.tabGroup.disablePagination = true;

    // The landing tab. `selectedIndexChange` is deliberately silent on the
    // first pass (MatTabGroup skips the emit when there was no previous
    // index), so a `?tab=` link that opens on a later tab has nothing else to
    // scroll it into view.
    afterNextRender(() => {
      this.reveal(this.tabGroup.selectedIndex ?? 0);
      this.followLateLabels();
    });

    this.tabGroup.selectedIndexChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((index) => this.reveal(index));

    this.tabGroup.focusChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => queueMicrotask(() => this.reveal(event.index)));
  }

  /**
   * Reveals the last-revealed tab again whenever the label row or the strip
   * changes size. Those two are enough. The strip's width is the room; the
   * row's width is the labels' total once they overflow it, and while they
   * fit it is the strip's own width, with every tab in view, until the
   * moment they outgrow it. So a label that grows or shrinks shows up as a
   * change to one of the two — short of two labels changing by equal and
   * opposite amounts at once — and Material's way, an observer on each tab,
   * would see nothing more that can cut the revealed one. A reveal writes
   * only `scrollLeft`, which neither size depends on, so the observer never
   * feeds itself.
   *
   * The reader's scroll is told from ours by the offset: every reveal records
   * where it left the strip, and an offset that differs at the next report
   * was put there by someone else — a finger, a trackpad, the scrollbar, the
   * browser's find. The strip is then theirs until the next selection or
   * focus change reveals again. The one move the browser makes on its own is
   * a clamp, when the strip widens or its labels shrink below the offset, and
   * that is compared as ours, so a strip that fits for a while and then
   * overflows again still brings its tab back; a reader's offset is only
   * overruled once the browser has already clamped it away. The tab put back
   * is the one last revealed, not the selected one: the arrow keys move focus
   * without selecting, and a late badge must not carry the strip away from
   * the tab the keys are on.
   *
   * A strip with no box (`display: none` on it or above it) reports a zero
   * width. There is nothing to measure then, and recording a reveal against
   * it would leave zeros as the offset to compare the next report with.
   *
   * Built in the render hook, so never on the server and outside the zone;
   * all it touches is the scroller.
   */
  private followLateLabels(): void {
    const strip = this.strip();
    const row = strip?.querySelector('.mat-mdc-tab-labels');
    if (!strip || !row || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (strip.clientWidth === 0) return;
      // Where the last reveal rests now that the browser has clamped it.
      const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const ours = Math.sign(this.revealed.at) * Math.min(Math.abs(this.revealed.at), max);
      if (Math.abs(strip.scrollLeft - ours) > 1) return;
      this.reveal(this.revealed.index);
    });
    observer.observe(row);
    observer.observe(strip);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /**
   * Moves the strip, and only the strip, by the least that brings the tab
   * wholly inside it. `scrollIntoView` would scroll every scroller around it
   * as well, `.main-container` included under `block: 'nearest'` — harmless
   * while a reveal only followed a tap or a key on the strip, wrong once one
   * follows a badge that lands while the reader is down the page. Both rects
   * are viewport coordinates, and a larger `scrollLeft` moves the content
   * left in either direction, so the arithmetic holds in RTL as written.
   *
   * The index is recorded even when its tab is not there yet, so the first
   * report that finds it reveals that tab and not the first.
   */
  private reveal(index: number): void {
    const strip = this.strip();
    if (!strip) return;
    this.revealed.index = index;
    const tab = strip.querySelectorAll('.mat-mdc-tab-labels > .mat-mdc-tab')[index];
    if (!tab) return;
    const room = strip.getBoundingClientRect();
    const start = room.left + strip.clientLeft;
    const end = start + strip.clientWidth;
    const { left, right } = tab.getBoundingClientRect();
    if (left < start) {
      strip.scrollLeft += left - start;
    } else if (right > end) {
      strip.scrollLeft += Math.min(right - end, left - start);
    }
    this.revealed.at = strip.scrollLeft;
  }

  private strip(): HTMLElement | null {
    return this.host.querySelector<HTMLElement>('.mat-mdc-tab-label-container');
  }
}
