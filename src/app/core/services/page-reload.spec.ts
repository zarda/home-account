import { TestBed } from '@angular/core/testing';
import { PAGE_RELOAD, pageReloadFactory } from './page-reload';

describe('the page reload seam', () => {
  // A real location.reload inside Karma aborts the whole run ("Some of your
  // tests did a full page reload!"), so every case hands the factory a fake
  // location, and the one that resolves the real token never calls it.
  let reload: jasmine.Spy;

  beforeEach(() => {
    reload = jasmine.createSpy('reload');
  });

  it('reloads the location it was handed, on the web', () => {
    const handed = { reload };
    const reloadPage = pageReloadFactory(() => false, handed);

    expect(reload).not.toHaveBeenCalled();
    reloadPage!();

    expect(reload).toHaveBeenCalledOnceWith();
    // Pin: called on the handed location itself. A bare `location.reload`
    // handed back unbound type-checks and still records this call, but a real
    // Location throws "Illegal invocation" when its reload runs detached.
    expect(reload.calls.mostRecent().object).toBe(handed);
  });

  it('is absent on a device, where nothing reloads', () => {
    expect(pageReloadFactory(() => true, { reload })).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('resolves from the root injector to a function in a browser', () => {
    // Never called: this one would reload Karma's own page.
    expect(typeof TestBed.inject(PAGE_RELOAD)).toBe('function');
  });
});
