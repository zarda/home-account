// Silences the @angular/fire zone wrapper's injection-context warnings across
// the smoke suite (#355). Every @angular/fire call is wrapped so it can hop
// in and out of NgZone; when the wrapper can't find an active Angular
// injector — the normal case for a raw SDK call in a beforeAll/afterAll hook
// or a spec body, module scope included — it falls back to calling the
// underlying SDK function directly, but logs first:
//   - a per-call line, "Firebase API called outside injection context: <fn>",
//     gated on the SDK's current log level.
//   - a one-time advisory, "Calling Firebase APIs outside of an Injection
//     context may destabilize...", gated on a module-level `alreadyWarned`
//     flag that never resets for the life of the loaded @angular/fire
//     module — one bundle for the whole Karma run, so whichever spec file
//     runs first burns it for every file after.
//
// Wrapping every one-off SDK call in `runInInjectionContext` against a
// TestBed-derived injector was considered and rejected: that injector is
// torn down between specs, and a Firestore listener or timer that re-enters
// it after teardown is exactly the NG0205 crash this suite already guards
// against elsewhere (see app.smoke.spec.ts's header and teardown notes) —
// manufacturing more injector-bound calls only widens that blast radius.
// Turning the noise off at the log-level/console layer instead touches
// nothing about injector lifetime.
//
// Import the Firebase SDK through @angular/fire (never the root `firebase/*`
// packages): @angular/fire bundles its own pinned Firebase major, so an app
// or instance built from root `firebase/*` is a different, incompatible copy
// from the one the rest of the suite gets via @angular/fire (see
// app.smoke.spec.ts's header for the full explanation).
//
// Idempotent and side-effect-free beyond the two warnings above, so every
// smoke file calls it for itself at module scope instead of relying on some
// designated "first" file — that keeps every file order-independent and
// correct when run standalone (e.g. `--include` a single spec). Verified: no
// other smoke spec asserts on console.warn, so silencing it globally is safe.
//
// This file compiles into the app program (tsconfig.app.json excludes only
// *.spec.ts, not testing helpers — see the other testing/mock-*.ts files
// here), so it stays jasmine-free rather than pulling in jasmine's ambient
// types.
import { setLogLevel, LogLevel } from '@angular/fire';
import { getApps } from '@angular/fire/app';

export function silenceFirebaseWarnings(): void {
  setLogLevel(LogLevel.SILENT); // kills every per-call "Firebase API called outside injection context: <fn>" line
  // The one-time advisory (angular-fire.mjs warnOutsideInjectionContext) still prints under
  // isDevMode() regardless of level — burn its alreadyWarned flag behind a temporary filter.
  const warn = console.warn;
  try {
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('outside of an Injection context')) return;
      warn.apply(console, args as []);
    };
    getApps(); // zone-wrapped + side-effect-free; outside any context → hits the catch branch once
  } finally {
    console.warn = warn; // no lasting monkey-patch
  }
}
