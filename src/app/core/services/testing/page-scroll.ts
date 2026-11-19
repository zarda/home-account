/// <reference types="jasmine" />

/**
 * Puts the page's scroll back where each case of the calling describe found
 * it. Called in a describe's body: a `beforeEach` records the page's scroll
 * and an `afterEach` restores it, both ways.
 *
 * A tall fixture, a `scrollIntoView` or a `focus()` below the fold scrolls
 * the document itself, and Karma's page is seldom at its top when a case
 * starts: jasmine's report above every fixture outgrows the frame, and a
 * `focus()` below it scrolls the page. A reset to the top is no cleanup: it
 * moves the next spec's fixture down by as far as the page had been
 * scrolled.
 */
export function keepThePageWhereFound(): void {
  let found: ScrollToOptions = {};
  beforeEach(() => {
    const page = document.scrollingElement ?? document.documentElement;
    found = { top: page.scrollTop, left: page.scrollLeft, behavior: 'instant' };
  });
  afterEach(() => {
    (document.scrollingElement ?? document.documentElement).scrollTo(found);
  });
}
