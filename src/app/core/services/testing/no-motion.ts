import { ANIMATION_MODULE_TYPE, type Provider } from '@angular/core';

/**
 * Turns Material and the CDK overlay's motion off for one TestBed, so a dialog,
 * a snackbar or a menu leaves the DOM when the app is stable instead of after an
 * `animationend` that a headless run may never fire.
 *
 * It answers `ANIMATION_MODULE_TYPE` from `@angular/core` rather than Material's
 * `MATERIAL_ANIMATIONS`: Material reads both, but a bare CDK overlay reads only
 * the former, so the latter would leave it animating.
 */
export function provideNoMotion(): Provider {
  return { provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' };
}
