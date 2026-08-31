# 86. The firebase-tools major stays pinned by a gate, not a habit

**Status:** Accepted, implemented · **Date:** 2026-08-31 · **Issues:** #351

## Context

`deploy-web` runs `firebase deploy --only hosting,firestore,storage
--non-interactive` and deliberately never passes `--force`. That combination
is safe only because of one specific firebase-tools behavior, recorded in
[0077](0077-merges-deploy-what-they-changed.md) and leaned on by both
reference docs: index *additions* apply unconditionally, while indexes that
exist in the project but not in `firestore.indexes.json` are logged, declined,
and left standing — and the deployment continues. Without that, a
non-interactive deploy would have to either delete indexes behind everyone's
back or fail every release that happened to have a stale index in the
project.

**Nothing in CI can notice if that behavior changes.** The emulator suite
never touches `firebase deploy`, and the only place the real command runs is
the deploy job itself, against production. A major bump could change the
prompt semantics and the first evidence would be a deploy behaving
differently.

**Dependabot bumps firebase-tools on its own schedule**, and a dependency
bump PR is exactly the context in which a behavioral contract buried in a
transitive CLI's prompt handling gets waved through. #351 asked that the next
major be re-verified rather than assumed.

## Decision

**The verified major is a number in a script, and CI fails when the
lockfile's resolved major is anything but the pinned one.**
`scripts/check-firebase-tools-major.mjs` reads
`packages["node_modules/firebase-tools"].version` out of `package-lock.json`,
compares its major against `PINNED_MAJOR = 15`, and exits non-zero when they
differ. `npm run firebase-tools:check` chains its own self-test in front of
it, as `i18n:check` does, and the `ci` job runs it beside the other static
checks.

**The lockfile is the truth, not `package.json`.** The manifest says
`^15.20.0` — a caret range is a statement about what *may* be installed. The
lockfile's resolved entry is the version `npx firebase` will actually run,
which is `15.28.2` as of this record. A gate reading the range would be
watching the wrong number.

**The failure names what to re-verify before the pin can be raised**, so a
Dependabot 16 arrives as a red check with a checklist instead of a green
merge: re-read `node_modules/firebase-tools/lib/firestore/api.js`'s
non-interactive deletion path and confirm it still declines and continues,
update [../deploy.md](../deploy.md) and
[../emulator-blind-spots.md](../emulator-blind-spots.md) if the behavior
changed, then raise `PINNED_MAJOR`. A separate, differently-worded failure
fires when the lockfile entry is missing or its version does not parse — a
checker that quietly stops finding the thing it checks is worse than one that
fails, because it looks identical to a pass.

Rejected: **a note in the workflow or the runbook telling a reviewer to
re-read `api.js` on a major bump.** That is the same discipline the issue is
about, written one place further from where it would have to be remembered.
Rejected: **pinning the exact version.** It blocks patch and minor updates for
a contract only a major can plausibly change, and the manifest's range is not
what runs anyway. Rejected: **proving the behavior in CI instead of reading
it.** Demonstrating decline-and-continue requires a real project holding an
index the file does not have — a live deploy against production state, run
for the purpose of watching it decline. Reading the source is the verification
that can actually be performed; the gate exists to make sure it *is* performed.

### The re-verification, done at 15.28.2

`lib/firestore/api.js:85-121`, read directly rather than inferred:
`shouldDeleteIndexes = options.force`, so without `--force` it is false. In
that state, `deploy-web`'s `--non-interactive` run logs only the count of
indexes it found but the file does not declare, then points at `--force` —
the branch that names each one (`prettyIndexString`) is the interactive path
a `--non-interactive` deploy never reaches. `confirm({ default: false })`
then returns its default through the non-interactive prompt guard instead of
prompting. Additions apply, deletions are skipped, the deployment continues.
That is the contract 0077 recorded, still holding, now with the version it
was read at written next to it.

## Departures from the issue

- The issue asked for "a note on the Dependabot PR" when a 16.x lands. A note
  is written by whoever remembers to write it; a failing check is written by
  the bump itself. The check carries the note's content as its failure text,
  which puts the words in front of the person who has to act on them.
- The issue's second criterion — deploy job and both docs updated in the same
  PR that takes the major — is now the third item of the checklist the failure
  prints, rather than an expectation held elsewhere.

## Things that only became apparent while building

- **The documents were pinned to a version that was never installed.** 0077
  and the runbook both said "the pinned firebase-tools 15.20.0"; that is the
  floor of the manifest's caret range, and the lockfile had resolved 15.28.2
  for some time. The same runbook's IAM section already described 15.28
  preflight behavior that 15.20 does not have — so one document disagreed with
  itself about which CLI was running. Naming a *major* plus the exact version
  the contract was last read at is the shape that cannot drift that way, and
  ending that drift is half of what this gate is for.
- **The gate needs a way to prove its own red path.** `PINNED_MAJOR` is
  overridable through `FIREBASE_TOOLS_EXPECTED_MAJOR` for exactly that, so the
  failure text can be exercised without hand-editing the pin it guards; the
  value checked into the file is the real gate.

## Known gaps

- **The gate proves nobody was surprised; it does not prove the behavior.**
  It fires on a major bump. If a minor release changed the prompt semantics,
  nothing here would catch it — this trades entirely on majors being where
  such a change is allowed to happen.
- **Raising the pin is one line, and nothing checks that the re-read
  happened.** A hurried bump can edit `PINNED_MAJOR` and turn the check green
  without ever opening `api.js`. The gate makes the decision conscious; it
  cannot make it careful.
- **Nothing re-verifies at deploy time.** The check runs in `ci` against the
  lockfile, and the deploy trusts it. A runner that somehow resolved a
  different firebase-tools than the lockfile pins would not be noticed here.
