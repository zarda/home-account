import { billRoute, budgetRoute, recapRoute, safeAppRoute } from './notification-route.utils';

describe('notification routes', () => {
  describe('builders', () => {
    it('opens the dashboard on the bill a reminder names', () => {
      expect(billRoute('rule-1')).toBe('/dashboard?bill=rule-1');
    });

    it('encodes a rule id that would otherwise end or split the query', () => {
      expect(billRoute('a&b=c#d/e f\\g')).toBe('/dashboard?bill=a%26b%3Dc%23d%2Fe%20f%5Cg');
    });

    it('opens the budgets tab for a budget alert', () => {
      expect(budgetRoute()).toBe('/budgets?tab=budgets');
    });

    it('opens the dashboard on the week a recap announces', () => {
      expect(recapRoute('2026-08-31')).toBe('/dashboard?recap=2026-08-31');
    });

    it('encodes the week key', () => {
      expect(recapRoute('2026 08&31')).toBe('/dashboard?recap=2026%2008%2631');
    });

    it('builds only routes the validator lets through', () => {
      const built = [
        billRoute('rule-1'),
        billRoute('//evil.example\\x\n'),
        budgetRoute(),
        recapRoute('2026-08-31'),
      ];

      for (const route of built) expect(safeAppRoute(route)).withContext(route).toBe(route);
    });
  });

  describe('safeAppRoute', () => {
    it('accepts a same-origin path, with or without a query', () => {
      expect(safeAppRoute('/')).toBe('/');
      expect(safeAppRoute('/dashboard?bill=rule-1')).toBe('/dashboard?bill=rule-1');
      expect(safeAppRoute('/budgets?tab=recurring')).toBe('/budgets?tab=recurring');
    });

    it('refuses anything that is not a string', () => {
      for (const candidate of [undefined, null, 42, {}, ['/dashboard']]) {
        expect(safeAppRoute(candidate)).withContext(String(candidate)).toBeNull();
      }
    });

    it('refuses an empty or relative path', () => {
      expect(safeAppRoute('')).toBeNull();
      expect(safeAppRoute('dashboard')).toBeNull();
      expect(safeAppRoute('./dashboard')).toBeNull();
      expect(safeAppRoute(' /dashboard')).toBeNull();
    });

    it('refuses a scheme', () => {
      expect(safeAppRoute('https://evil.example/')).toBeNull();
      expect(safeAppRoute('javascript:alert(1)')).toBeNull();
      expect(safeAppRoute('data:text/html,x')).toBeNull();
    });

    it('refuses a protocol-relative path', () => {
      expect(safeAppRoute('//evil.example/')).toBeNull();
      expect(safeAppRoute('///evil.example/')).toBeNull();
    });

    it('refuses a backslash, which a URL parser reads as a slash', () => {
      expect(safeAppRoute('/\\evil.example/')).toBeNull();
      expect(safeAppRoute('/dashboard\\x')).toBeNull();
    });

    it('refuses a control character, which a URL parser strips', () => {
      // A tab or newline between the slashes is removed before parsing, so
      // `/\t/evil.example` would open as `//evil.example`.
      expect(safeAppRoute('/\t/evil.example/')).toBeNull();
      expect(safeAppRoute('/\n/evil.example/')).toBeNull();
      expect(safeAppRoute('/\r/evil.example/')).toBeNull();
      expect(safeAppRoute('/dashboard\u0000')).toBeNull();
      expect(safeAppRoute('/dashboard\u007f')).toBeNull();
      expect(safeAppRoute('/dashboard\u0085')).toBeNull();
    });
  });
});
