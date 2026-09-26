import { Route } from '@angular/router';

import { routes } from '../../app.routes';
import {
  ANALYTICS_CONSENT_DEFAULTS,
  ANALYTICS_GTAG_CONFIG,
  isConfiguredMeasurementId,
  pageFields,
} from './analytics.config';

describe('isConfiguredMeasurementId', () => {
  it('should reject every placeholder this repository actually ships', () => {
    // .github/workflows/ci.yml writes 'ci-stub' into both generated
    // environment files, and the two committed templates ship
    // 'YOUR_MEASUREMENT_ID'. Both are non-empty, so a presence check would arm
    // analytics in CI and let the unit suite talk to Google.
    expect(isConfiguredMeasurementId('ci-stub')).toBeFalse();
    expect(isConfiguredMeasurementId('YOUR_MEASUREMENT_ID')).toBeFalse();
  });

  it('should reject an absent or empty value', () => {
    expect(isConfiguredMeasurementId('')).toBeFalse();
    expect(isConfiguredMeasurementId(null)).toBeFalse();
    expect(isConfiguredMeasurementId(undefined)).toBeFalse();
  });

  it('should accept a real measurement id', () => {
    expect(isConfiguredMeasurementId('G-NFNEJ4S8JR')).toBeTrue();
  });

  it('should require the G- prefix rather than any non-empty string', () => {
    expect(isConfiguredMeasurementId('NFNEJ4S8JR')).toBeFalse();
    expect(isConfiguredMeasurementId('UA-12345-6')).toBeFalse();
    expect(isConfiguredMeasurementId('g-nfnej4s8jr')).toBeFalse();
  });
});

describe('ANALYTICS_GTAG_CONFIG', () => {
  it('should suppress the automatic page view', () => {
    // Navigation is reported as screen_view from the router. Leaving
    // send_page_view on would double-count the first screen and then never
    // fire again, because gtag cannot see a single-page navigation.
    expect(ANALYTICS_GTAG_CONFIG.send_page_view).toBeFalse();
  });

  it('should switch the advertising signals off', () => {
    // The property is measurement-only. Setting these here as well as in the
    // console means the browser never contacts the advertising domains.
    expect(ANALYTICS_GTAG_CONFIG.allow_google_signals).toBeFalse();
    expect(ANALYTICS_GTAG_CONFIG.allow_ad_personalization_signals).toBeFalse();
  });
});

describe('ANALYTICS_CONSENT_DEFAULTS', () => {
  it('should deny every advertising consent type', () => {
    expect(ANALYTICS_CONSENT_DEFAULTS.ad_storage).toBe('denied');
    expect(ANALYTICS_CONSENT_DEFAULTS.ad_user_data).toBe('denied');
    expect(ANALYTICS_CONSENT_DEFAULTS.ad_personalization).toBe('denied');
  });

  it('should grant analytics storage', () => {
    // The instance only exists after an explicit opt-in; denying here would
    // put the tag into cookieless ping mode, which measures nothing useful.
    expect(ANALYTICS_CONSENT_DEFAULTS.analytics_storage).toBe('granted');
  });
});

describe('pageFields', () => {
  it('should strip the query string from page_location', () => {
    // gtag attaches the full URL to every hit on its own — a channel no
    // parameter allowlist covers. Today's query states are harmless
    // (?showAll, ?date, ?action, ?tx — a transaction id, stripped from the
    // URL once consumed), but the first route to carry a search term would
    // leak it silently.
    const location = {
      origin: 'https://example.com',
      pathname: '/transactions',
      search: '?date=2026-07-27&action=add',
    } as Location;

    expect(pageFields(location).page_location).toBe('https://example.com/transactions');
  });

  it("should write a household's id in the path as its route template", () => {
    // /household/{hid} names the household shown. An id is never sent, and
    // every household is one screen, as screen_name reports it.
    for (const pathname of ['/household/Xk3f9QmZ2pL7vB1nR8tY', '/household/Xk3f9QmZ2pL7vB1nR8tY/']) {
      const location = { origin: 'https://example.com', pathname } as Location;

      expect(pageFields(location).page_location).withContext(pathname).toBe('https://example.com/household/:hid');
    }
    const bare = { origin: 'https://example.com', pathname: '/household' } as Location;
    expect(pageFields(bare).page_location).toBe('https://example.com/household');
  });

  it('should write every route parameter the route table declares as its template', () => {
    // pageFields sees only window.location, not the router, so it cannot
    // read a template off the activated route. This walks the real table
    // instead: a renamed or a second parameterised route fails here rather
    // than quietly sending its ids.
    const paths = (table: Route[], prefix = ''): string[] =>
      table.flatMap(route => {
        const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
        return [path, ...paths(route.children ?? [], path)];
      });
    const templates = paths(routes).filter(path => path.split('/').some(segment => segment.startsWith(':')));
    const id = 'Xk3f9QmZ2pL7vB1nR8tY';

    expect(templates.length).withContext('a parameterised route to check').toBeGreaterThan(0);
    for (const template of templates) {
      const pathname = `/${template
        .split('/')
        .map(segment => (segment.startsWith(':') ? id : segment))
        .join('/')}`;
      const sent = pageFields({ origin: 'https://example.com', pathname } as Location).page_location;

      expect(sent).withContext(template).not.toContain(id);
      expect(sent).withContext(template).toBe(`https://example.com/${template}`);
    }
  });

  it('should report a constant page title', () => {
    // There is no TitleStrategy and no route title, so the field carries no
    // information; pinning it keeps a future document.title from leaking.
    const location = { origin: 'https://example.com', pathname: '/about' } as Location;

    expect(pageFields(location).page_title).toBe('HomeAccount');
  });
});
