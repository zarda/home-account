import { keepThePageWhereFound } from './page-scroll';

describe('keepThePageWhereFound', () => {
  const page = () => document.scrollingElement ?? document.documentElement;
  /** Where this spec found the page, put back by hand: the helper is what is under test. */
  let outside: ScrollToOptions = {};
  let room: HTMLElement;

  // A page with room to scroll both ways, left away from its top-left corner
  // as an earlier spec would leave it.
  beforeEach(() => {
    outside = { top: page().scrollTop, left: page().scrollLeft, behavior: 'instant' };
    room = document.body.appendChild(document.createElement('div'));
    room.style.height = '3000px';
    room.style.width = '3000px';
    page().scrollTo({ top: 700, left: 300, behavior: 'instant' });
  });

  // Runs after the helper's own afterEach, which an inner describe's comes before.
  afterEach(() => {
    expect([page().scrollTop, page().scrollLeft]).withContext('the scroll the case found, top and left').toEqual([700, 300]);
    room.remove();
    page().scrollTo(outside);
  });

  describe('called in a describe', () => {
    keepThePageWhereFound();

    it('puts back the scroll a case moved further down and across', () => {
      expect([page().scrollTop, page().scrollLeft]).withContext('the page as the case found it').toEqual([700, 300]);
      page().scrollTo({ top: 2000, left: 1200, behavior: 'instant' });
      expect([page().scrollTop, page().scrollLeft]).withContext('the case moved the page').toEqual([2000, 1200]);
    });

    it('puts back the scroll a case reset to the top, not the top', () => {
      page().scrollTo({ top: 0, left: 0, behavior: 'instant' });
      expect([page().scrollTop, page().scrollLeft]).withContext('the case reset the page').toEqual([0, 0]);
    });
  });
});
