import { Type, reflectComponentType } from '@angular/core';
import { Route } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './core/guards';

/**
 * Where a page sits in the route table decides who can open it. A page
 * that is a child of the guarded layout route is signed-in only without a
 * guard of its own, and one declared anywhere else is open to anybody who
 * types its URL. Nothing on the page itself would show the difference.
 */
describe('the route table', () => {
  const layout = (): Route | undefined =>
    routes.find(route => route.path === '' && route.canActivate?.includes(authGuard));

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
  });
});
