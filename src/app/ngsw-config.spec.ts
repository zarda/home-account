import ngswConfig from '../../ngsw-config.json';
import { PDF_WORKER_SRC } from './core/utils/pdf-raster.utils';

/**
 * Analytics requests must reach the network untouched.
 *
 * No service worker is registered in production today: angular.json's
 * 'production' configuration builds the ngsw artifacts, but nothing calls
 * provideServiceWorker, and 'production-local' (npm run build:ios) does not
 * even build them. So this asserts a property that is currently free — the
 * Angular service worker only intercepts URLs matching a configured group, and
 * analytics traffic is cross-origin to hosts that match none of them.
 *
 * The point is to keep it free. Caching a measurement beacon would replay
 * stale hits or swallow live ones, and neither failure is visible from inside
 * the app. assetGroups[].resources.urls accepts absolute cross-origin URLs
 * just as dataGroups[].urls does, so the whole config is searched rather than
 * one section of it.
 */
const ANALYTICS_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'app-measurement.com',
];

describe('ngsw-config', () => {
  it('should not route analytics hosts through any cache group', () => {
    const serialized = JSON.stringify(ngswConfig);

    for (const host of ANALYTICS_HOSTS) {
      expect(serialized.includes(host)).withContext(host).toBeFalse();
    }
  });

  it('caches the pdfjs worker through an asset group', () => {
    // The worker is copied to /assets rather than left at the bundle root: the
    // app group globs '/*.js', which does not match '.mjs', so a root-level
    // worker would be uncached and the first offline PDF import would fail
    // with a worker error rather than a network one.
    const groups = (ngswConfig as { assetGroups: { resources: { files?: string[] } }[] }).assetGroups;
    const patterns = groups.flatMap(g => g.resources.files ?? []);

    expect(patterns).toContain('/assets/**');
    expect(PDF_WORKER_SRC.startsWith('assets/')).toBeTrue();
    expect(PDF_WORKER_SRC.endsWith('.mjs')).toBeTrue();
    // The root-level globs genuinely do not cover it, which is why it moved.
    expect(patterns).not.toContain('/*.mjs');
  });
});
