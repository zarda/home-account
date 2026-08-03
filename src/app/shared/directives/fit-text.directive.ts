import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';

import { FitTextRegistry, FitTextTarget } from './fit-text.registry';

/**
 * Shrinks a value that does not fit, instead of letting it be cut off.
 *
 * The app's rule is that nothing truncates: text reflows onto more lines, and
 * anything that must stay on one line — an amount above all — scales down
 * until it fits. An ellipsised amount is not a shortened number, it is a
 * different one, and "¥123,4…" gives the reader no way to tell ¥123,400 from
 * ¥123,456,789. Scaling keeps every digit.
 *
 * Put `white-space: nowrap` on the host in the component's own stylesheet.
 * This directive deliberately writes no style at all while the value fits,
 * which is nearly always, so the nowrap has to come from the cascade.
 *
 *     <span class="amount" appFitText>{{ formatAmount() }}</span>
 */
@Directive({
  selector: '[appFitText]',
  standalone: true,
})
export class FitTextDirective implements FitTextTarget, AfterViewInit, OnDestroy {
  /**
   * The type scale bottoms out at 12px — `--text-xs`, below which the scale
   * says micro-text is not part of the system. A value scaled past that is
   * unreadable, so the floor is where scaling stops and wrapping starts.
   */
  private static readonly FLOOR_PX = 12;

  readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private readonly registry = inject(FitTextRegistry);
  private readonly zone = inject(NgZone);

  /** The stylesheet's font size, re-read on every pass. */
  private base = 0;
  private scaled = false;
  private wrapped = false;
  private mutation?: MutationObserver;

  ngAfterViewInit(): void {
    // Nothing is measured here. Every DOM read happens inside the registry's
    // batched pass, so a list rendering fifty of these does not force fifty
    // separate layouts during change detection.
    //
    // The parent's width is watched by the registry's shared observer. Text
    // is the other thing that changes — a converted amount arriving once the
    // exchange rates load — and a resize observer cannot see it. childList
    // and characterData only: writing a font-size is an attribute change, so
    // this callback can never re-enter itself.
    this.zone.runOutsideAngular(() => {
      this.mutation = new MutationObserver(() => this.registry.markDirty(this));
      this.mutation.observe(this.host, { childList: true, characterData: true, subtree: true });
    });

    this.registry.register(this);
  }

  ngOnDestroy(): void {
    this.mutation?.disconnect();
    this.registry.unregister(this);
  }

  /**
   * Nothing is written while the value fits — the overwhelmingly common case
   * does zero DOM work, which is what keeps this affordable in a list that
   * pages fifty rows at a time.
   */
  clearOverride(): void {
    if (!this.scaled && !this.wrapped) return;
    this.host.style.removeProperty('font-size');
    if (this.wrapped) {
      this.host.style.removeProperty('white-space');
      this.host.style.removeProperty('overflow-wrap');
      this.wrapped = false;
    }
    this.scaled = false;
  }

  /**
   * 1 when the content fits; otherwise how many times too wide it is.
   *
   * Two regimes, and the host can be in either depending on how its parent is
   * laid out, so both are measured and the worse one wins:
   *
   *   - The host has a width the container imposed on it — a flex item that
   *     was squeezed, a block. Its box is the space it was given, so
   *     scrollWidth against clientWidth is the answer directly.
   *   - The host is sized to its own content — an inline element, or a flex
   *     item under `align-items: flex-end`, which is exactly how `.row-amount`
   *     stacks its lines. Here scrollWidth *equals* clientWidth no matter how
   *     far the box sticks out, because the box grew with the text. The
   *     overflow is only visible against the parent's content box.
   *
   * Measuring only the first would silently do nothing on the amount column
   * this exists for.
   */
  overflowRatio(): number {
    const el = this.host;
    // Read after clearOverride has run, so this is the size the stylesheet
    // asks for rather than one this directive wrote — which also means a
    // font-size that changes at a breakpoint is picked up on the next pass
    // instead of being pinned to whatever it was at startup.
    this.base = parseFloat(getComputedStyle(el).fontSize) || 16;

    // 1px of slack throughout, so sub-pixel rounding does not read as overflow.
    let ratio = 1;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      ratio = el.scrollWidth / el.clientWidth;
    }

    const parent = el.parentElement;
    if (parent) {
      const cs = getComputedStyle(parent);
      const available =
        parent.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const width = el.getBoundingClientRect().width;
      if (available > 0 && width > available + 1) {
        ratio = Math.max(ratio, width / available);
      }
    }

    return ratio;
  }

  apply(ratio: number): void {
    if (ratio <= 1) return;

    // The 2% is not superstition. Type does not scale perfectly linearly —
    // hinting and sub-pixel rounding mean text set at exactly base/ratio
    // still lands a pixel or two over, and a pixel over is a clipped glyph,
    // which is the whole thing this exists to prevent. Buying the margin back
    // costs a fraction of a point of size.
    const target = (this.base / ratio) * 0.98;
    if (target >= FitTextDirective.FLOOR_PX) {
      this.host.style.fontSize = `${target}px`;
      this.scaled = true;
      return;
    }

    // Past the floor there is no size left to give. Wrapping a number reads
    // worse than shrinking one, which is why it is the last resort rather
    // than the first — but it is the only remaining option that still shows
    // every digit, and showing all of it badly beats showing some of it well.
    this.host.style.fontSize = `${FitTextDirective.FLOOR_PX}px`;
    this.host.style.whiteSpace = 'normal';
    this.host.style.overflowWrap = 'anywhere';
    this.scaled = true;
    this.wrapped = true;
  }
}
