import { TestBed } from '@angular/core/testing';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';

import { APP_BREAKPOINTS } from './breakpoints';
import { injectIsMobileViewport } from './viewport';

describe('injectIsMobileViewport', () => {
  let state$: BehaviorSubject<BreakpointState>;
  let observe: jasmine.Spy;

  function state(matches: boolean): BreakpointState {
    return { matches, breakpoints: { [APP_BREAKPOINTS.mobile]: matches } };
  }

  beforeEach(() => {
    state$ = new BehaviorSubject<BreakpointState>(state(false));
    observe = jasmine.createSpy('observe').and.returnValue(state$.asObservable());

    TestBed.configureTestingModule({
      providers: [{ provide: BreakpointObserver, useValue: { observe } }],
    });
  });

  // The load-bearing assertion: widening this query (to tablet-down, say)
  // would silently re-open the gap against the bottom nav, which binds to the
  // mobile query alone.
  it("observes the app scale's mobile query and nothing else", () => {
    TestBed.runInInjectionContext(() => injectIsMobileViewport());

    expect(observe).toHaveBeenCalledOnceWith(APP_BREAKPOINTS.mobile);
  });

  it('follows the viewport across the breakpoint', () => {
    const isMobile = TestBed.runInInjectionContext(() => injectIsMobileViewport());

    expect(isMobile()).toBeFalse();

    state$.next(state(true));
    expect(isMobile()).toBeTrue();

    state$.next(state(false));
    expect(isMobile()).toBeFalse();
  });
});
