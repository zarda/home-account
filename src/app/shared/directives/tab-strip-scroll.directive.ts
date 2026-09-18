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

  constructor() {
    // Before the group's first check, so its own `[disablePagination]` binding
    // carries this down to the header on the very first pass — the header has
    // then never measured itself for pagination and never shows the chevrons.
    this.tabGroup.disablePagination = true;

    // The landing tab. `selectedIndexChange` is deliberately silent on the
    // first pass (MatTabGroup skips the emit when there was no previous
    // index), so a `?tab=` link that opens on a later tab has nothing else to
    // scroll it into view.
    afterNextRender(() => this.reveal(this.tabGroup.selectedIndex ?? 0));

    this.tabGroup.selectedIndexChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((index) => this.reveal(index));

    this.tabGroup.focusChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => queueMicrotask(() => this.reveal(event.index)));
  }

  /**
   * `scrollIntoView` rather than arithmetic on `offsetLeft`: it moves the
   * strip by the least it can, and it is the one spelling that is already
   * right in RTL, where the scroll origin is at the other end.
   */
  private reveal(index: number): void {
    const tab = this.host.querySelectorAll('.mat-mdc-tab-labels > .mat-mdc-tab')[index];
    tab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
}
