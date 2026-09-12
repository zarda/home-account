# 128. A Material module a template never uses fails the build

**Status:** Accepted, implemented · **Date:** 2026-09-12 · **Issues:** #420

Reference documentation lives in [../performance.md](../performance.md).

## Context

Twenty `Mat*Module` entries across eighteen components named a module whose
template used none of that module's selectors.

A dead entry is not free. Each one puts its module's directives into the
component's template scope and its providers into the component's injector,
and each one is a claim about the template — *this component renders
chips* — that the next edit can falsify without anything saying so. The
entries accumulate the obvious way: a control is removed from a template and
its module is left behind, because nothing anywhere notices.

Nothing in this repository could notice:

- **ESLint's `no-unused-vars` counts the symbol as used** the moment it
  appears inside `imports: [...]`. The import is referenced; that is all the
  rule asks.
- **None of the nine guard scripts under `scripts/` looked at component
  metadata.** They read stylesheets, catalogs, prompt call sites, index
  definitions and the production config.
- **Angular's own `unusedStandaloneImports` diagnostic cannot see an
  NgModule.** `getUnusedSymbols` in the compiler pushes a symbol only when
  it is a standalone directive, component or pipe, so no `NG8113` is ever
  raised for a `Mat*Module` whatever level the check is set to. And the half
  it *can* see was at its default level: a warning, in a build whose output
  nobody reads line by line.

A hand survey found nineteen of the twenty. The twentieth was invisible to a
grep as well: `profile-settings.component.ts` declared `MatButtonModule`, and
its template has no `<button>` or `<a>` at all — the only "button" in it is
`<mat-button-toggle-group>`, which belongs to `MatButtonToggleModule` and is
live. `mat-button` **is** one of `MatButtonModule`'s attribute selectors, so
grepping the template for it finds `mat-button-toggle-group`, reads as a use,
and stops. What separates the two is the boundary after the name, which a
substring search does not have and a selector match does.

## Decision

**Both halves get a gate: a script for the modules Angular cannot see, and
Angular's own diagnostic raised to an error for the ones it can.**

### The script

`scripts/check-material-imports.mjs`, run as `npm run material:check`, a CI
step directly after *Check direction*. It parses every `@Component`'s
`imports:` array and the template that component declares, and fails when a
listed Material module contributes no selector the template uses.

**The table is the risk, not the parser.** A selector the table misspells or
omits fails a component that is genuinely using its module — a false failure
on live code, which is strictly worse than the dead entry the check exists
to catch. So 29 modules are mapped to their full transitively-exported
selector sets, spelled as the installed `@angular/material` spells them, and
`--self-test` (43 cases) asserts every string in the table against the
selectors the package actually declares, plus the three re-export edges the
table leans on — List → Divider, Input → FormField, Select → Option —
and the trap fixtures. A Material upgrade that renames a selector therefore
fails the self-test, where the fix is the table, rather than failing the
app, where the fix would look like deleting a live import.

**Matching is lenient in every direction but one.** A selector with an
attribute part is matched on the attribute alone and never on the element it
is declared against, so an attribute wrapped onto its own line away from its
`<button` still reads as a use; bare and bound spellings both count; markup
inside an HTML comment counts as a use. Each of those can only make the
check miss a dead entry, never invent one.

**What it cannot see is named on screen.** Provider-only modules
(`MatNativeDateModule` contributes no selector at all, so "unused in the
template" says nothing about whether the component needs it) and modules
outside the table are skipped, counted **and printed by name**, so the
table's coverage is a fact in the output rather than an assumption. On the
swept tree: 293 entries across 89 components, 7 provider-only skips, 0
outside the table, no findings.

### The compiler flag

`tsconfig.json`'s `angularCompilerOptions` gains:

```json
"extendedDiagnostics": { "checks": { "unusedStandaloneImports": "error" } }
```

The existing count was measured before the level was raised, and came in at
**0**. A silent zero is not evidence that a diagnostic ran, so the mechanism
was probed rather than assumed: a deliberately unused `RouterLink` added to
one component's `imports` raised `NG8113`, and with the probe reverted the
build was clean again. `tsconfig.spec.json` extends the root config, so
spec-file test hosts are held to the same level; the full unit sweep — 5664
specs — compiled and ran under it with no `NG8113` anywhere.

**Zero against twenty is the argument for the script.** Angular's check was
already green, not because the codebase was clean, but because it never had
anything to say about the half that was rotting.

`"error"` rather than `"warning"` breaks the **dev** build as well as CI,
deliberately. A warning in an `ng serve` scrollback is precisely the state
the NgModule half had been in for the life of the repository.

### What was rejected

- **Deleting the twenty entries and leaving it at that.** Nobody added them
  on purpose; the twenty-first arrives the same way the first twenty did.
- **Deriving the selector table from the package on every run.** The
  self-test already derives it — from every `selector:` literal in the
  installed `fesm2022` bundles — and asserts the table against it. Doing
  that on the failure path of every run would make the one dangerous
  outcome, a false failure on live code, depend on parsing minified vendor
  code; a table in the file is reviewable in a diff and drifts loudly.
- **Leaving `unusedStandaloneImports` at `"warning"`.** At zero existing
  hits there is nothing to grandfather, and a warning is what the NgModule
  half already had.
- **Dropping the internal host selectors from the table** —
  `mat-tooltip-component`, `mat-dialog-container` and the like. Nobody
  writes them in a template, so they cost nothing, and trimming a table by
  judgement is how a table starts drifting from the package it mirrors.

## Consequences

- **Ten guard scripts where there were nine**, and one more CI step.
- **Six of the twenty were `MatDialogModule` on components that only open a
  dialog.** None of them renders `mat-dialog-content`, `mat-dialog-actions`,
  `mat-dialog-title` or `matDialogClose`. `MatDialog` resolves to the root
  injector, so dropping the module moves the component from a delegating
  child instance to the root one, with no behaviour change. Two specs had
  pinned exactly that shadowing; those pins and their provider overrides
  were no longer true and came out with the entries.
- **`npm run test:ci` is 5664 specs, green, under the flag**, so the
  diagnostic costs nothing at the spec tier either.

## Things that only became apparent while building

- **The gate found the entry the survey could not.** The twentieth was
  discovered by the script written to prevent the twenty-first, on the same
  tree the survey had just been over — and it is the substring trap in the
  other direction: a hand search for the dead module finds a live one with
  an overlapping name and stops.
- **The parser had to strip comments before anything else.** An apostrophe
  inside a `//` comment inside a decorator unbalanced the quote tracking and
  dropped the whole component from the run, silently — a gate that skips a
  file without saying so is worse than no gate, because its zero reads like
  proof. Comments are masked once, upstream, with newlines kept so reported
  line numbers still land; a commented-out entry no longer counts as a real
  one either. Masking handles the lexical forms that were thought of, so the
  run also counts `@Component(` per file over the masked source and reports
  any file whose count exceeds the blocks the parser resolved as **unparsed**,
  with a non-zero exit — a desync the mask does not know about fails loudly
  instead of shrinking the zero.
- **Provider-only is a real category, not an exemption.** A module that
  exports no selector cannot be judged by a template at all, which is a
  different statement from "it is used" and has to be reported as its own
  bucket.

## Known gaps

- **The table is a maintenance surface.** A Material module used in the app
  for the first time is skipped and counted rather than checked until
  someone adds it, and the output naming the skip is the only thing that
  says so.
- **Only `Mat*Module` entries are considered.** `FormsModule`,
  `ReactiveFormsModule`, `RouterModule` and any other NgModule in an
  `imports` array are outside both halves — the script does not know them
  and Angular's diagnostic structurally cannot see them.
- **Spec files are skipped.** A test host's `imports` belong to the spec
  that declares it, and its template is usually a stub that proves nothing
  either way.
- **Every leniency is a dead entry the check will miss.** A module whose
  only appearance in the template is inside an HTML comment passes; so does
  one whose attribute selector happens to collide with an attribute name the
  template uses for something else. That direction was chosen on purpose —
  the alternative is a false failure on live code — but it means a clean run
  is a floor, not a proof.
