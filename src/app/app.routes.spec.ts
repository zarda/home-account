import { ChangeDetectionStrategy, Component, Type, reflectComponentType } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { authGuard } from './core/guards';
import { routedHouseholdId } from './features/household/household-route';

/** Stands in for the household page, whose own spec renders it: here the question is only which instance a URL reaches. */
@Component({
  selector: 'app-household-stub',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
class StubPage {}

/**
 * Where a page sits in the route table decides who can open it. A page
 * that is a child of the guarded layout route is signed-in only without a
 * guard of its own, and one declared anywhere else is open to anybody who
 * types its URL. Nothing on the page itself would show the difference.
 */
describe('the route table', () => {
  const layout = (): Route | undefined =>
    routes.find(route => route.path === '' && route.canActivate?.includes(authGuard));

  /** Every route, however deep, with the path it is reached by. */
  function everyRoute(table: Route[] = routes, prefix = ''): { route: Route; path: string }[] {
    return table.flatMap(route => {
      const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
      return [{ route, path }, ...everyRoute(route.children ?? [], path)];
    });
  }

  it('has one guarded layout route holding the signed-in pages', () => {
    expect(layout()).withContext('the empty-path route carrying authGuard').toBeDefined();
    expect(layout()?.children?.length).toBeGreaterThan(0);
  });

  describe('/household', () => {
    const household = (): Route | undefined =>
      layout()?.children?.find(route => route.path === 'household');

    it('is a child of the guarded layout route', () => {
      expect(household()).withContext('a household child of the layout route').toBeDefined();
    });

    it('is declared nowhere else', () => {
      const elsewhere = routes.filter(route => route.path === 'household');

      expect(elsewhere).withContext('a top-level household route would skip authGuard').toEqual([]);
    });

    it('carries no guard of its own, relying on the layout route', () => {
      expect(household()).toBeDefined();
      expect(household()?.canActivate).toBeUndefined();
      expect(household()?.canMatch).toBeUndefined();
    });

    it('loads its page lazily', async () => {
      const route = household();

      expect(route?.component).withContext('an eager component would join the initial bundle').toBeUndefined();
      expect(route?.loadComponent).toBeDefined();
      const page = (await route?.loadComponent?.()) as Type<unknown> | undefined;
      expect(page && reflectComponentType(page)?.selector).toBe('app-household');
    });

    /**
     * /household/{hid} names the household the page shows. It is a child of
     * /household with no component of its own, not a second route to the
     * page: the router rebuilds a page whenever a navigation moves it to
     * another route entry, so a switch between two entries would close every
     * household listener, open them again, and take focus to the document.
     */
    describe('/household/:hid', () => {
      const child = (): Route | undefined => household()?.children?.find(route => route.path === ':hid');

      it('is a child of /household that renders nothing of its own', () => {
        expect(child()).withContext('a :hid child of the household route').toBeDefined();
        expect(child()?.component).toBeUndefined();
        expect(child()?.loadComponent).toBeUndefined();
        expect(child()?.children).withContext('nothing below it').toEqual([]);
      });

      it('carries no guard of its own either', () => {
        expect(child()).toBeDefined();
        expect(child()?.canActivate).toBeUndefined();
        expect(child()?.canMatch).toBeUndefined();
      });

      it('is the only route naming a household', () => {
        const named = everyRoute().filter(({ path }) => /^household\//.test(path));

        expect(named.map(({ path }) => path)).toEqual(['household/:hid']);
      });

      describe('as the router reaches it', () => {
        let harness: RouterTestingHarness;

        beforeEach(async () => {
          const route = household() as Route;
          TestBed.configureTestingModule({
            providers: [provideRouter([{ ...route, loadComponent: undefined, component: StubPage }])]
          });
          harness = await RouterTestingHarness.create();
        });

        it('keeps one page from /household to one household and on to another', async () => {
          const first = await harness.navigateByUrl('/household', StubPage);
          const second = await harness.navigateByUrl('/household/h1', StubPage);
          const third = await harness.navigateByUrl('/household/h2', StubPage);

          expect(second).withContext('/household to /household/h1').toBe(first);
          expect(third).withContext('/household/h1 to /household/h2').toBe(first);
        });

        it('names the household to the page, and none at /household', async () => {
          const router = TestBed.inject(Router);

          await harness.navigateByUrl('/household/h1');
          expect(routedHouseholdId(router)).toBe('h1');

          await harness.navigateByUrl('/household');
          expect(routedHouseholdId(router)).toBeNull();
        });
      });
    });
  });
});
