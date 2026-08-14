# 40. The native seams answer to XCTest, and the plugins stay shells

**Status:** Accepted, implemented · **Date:** 2026-08-14 · **Issues:** follow-up to #261/#253

Reference documentation lives in [../share-import.md](../share-import.md).

## Context

The Swift half of the share pipeline had no automated coverage of any kind.
The Xcode project carried no test target; every defect that shipped there —
the octet-stream typing, the destroy-on-drain, the wreckage that was
re-walked forever — was found by reading, and every fix was verified by a
hand-driven simulator session. The web gates are structurally blind to this
code, and the repo's own docs said so in three places.

Two things made tests awkward. The plugin logic lived inside
`CAPPlugin` methods: a `CAPPluginCall` is not sanely constructible outside
the bridge, and the registered plugin object is a Capacitor `Proxy` whose
methods cannot be spied — the same wall the web side hit, which is why
`NativeShareService` exists there. And the extension's code belongs to an
app-extension target, which cannot be imported by a test bundle at all.

## Decision

**The logic moves out of the shells.** `ShareIntakeStore` is a pure
Foundation enum that takes the folder as a parameter — collect, complete,
clear, the wreckage sweep, the orphan grace — and `ShareIntakePlugin`
shrinks to the App Group lookup plus forwarding. The data-URL strip moves to
`DataURL`, shared with the Vision OCR plugin. The extension's `stash` and
`acceptedTypes` widen from private to internal, and
`ShareViewController.swift` is compiled into the test bundle directly — the
standard answer to an unimportable extension target.

**The test bundle is a standalone logic target.** `AppTests`
(`com.apple.product-type.bundle.unit-test`, hand-added to the pbxproj in the
same synthetic-id convention as the extension target) has no `TEST_HOST` and
links nothing but XCTest: it compiles the three shared sources and drives
them against temp directories. Rejected: hosted tests via `@testable import
App` — booting the whole Capacitor web view and Firebase to test file
operations buys nothing and adds every kind of flake; linking Capacitor into
the bundle so the plugin files themselves compile — the shells contain
nothing worth that dependency; XCUITest driving Photos and the share sheet —
cross-app automation is fragile by design, and the documented manual
procedure covers what it would.

**Local only, by explicit choice.** `npm run test:ios` runs the suite
against an installed simulator; CI does not. The repository is public, so a
macOS runner would be free — recorded here so the decision can be revisited
— but the user chose to keep CI as it is for now. The README and
share-import.md say "not enforced" rather than "not covered".

## Consequences

- Twenty-one tests pin the seams every prior session verified by hand: the
  sidecar contract (concrete MIME, all four keys, epoch stamp, rollback),
  fetch-without-delete, wreckage and stale-orphan sweeping with the
  write-order grace, id validation on completion, and the any-mediatype
  strip.
- The suite needs a simulator named in the script's destination (iPhone 17
  today); a machine without it edits one string.
- The first octet-stream fallback run pays a cold LaunchServices lookup for
  the unknown extension (~20 s once per boot); everything else is
  milliseconds.
- `ShareViewController.swift` now compiles into two targets. That is
  membership, not sharing a framework — the extension still ships alone.

## Known gaps

- CI never runs the suite; the gate exists but is not enforced. A
  paths-filtered macOS job is the obvious next step if that changes.
- The shells themselves — App Group resolution, the Capacitor bridging, the
  activation listener — stay untested, deliberately thin.
- The extension's provider loop (`NSItemProvider` matching,
  `loadFileRepresentation`, the transcode request) is exercised only by the
  manual simulator procedure in share-import.md; the tests start where the
  delivered file lands.
