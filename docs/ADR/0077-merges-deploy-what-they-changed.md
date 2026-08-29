# 77. Merges deploy what they changed

**Status:** Accepted, implemented · **Date:** 2026-08-29

CI has proven every merge for months while the deploy stayed a laptop act,
and the gap between those two is the one
[0035](0035-what-the-emulator-cannot-see-is-checked-from-the-files.md) could
only document: nothing in CI could see whether the live project matched the
repo. This record closes the deploy half of that gap — merged rules, indexes
and app code now ship themselves — and leaves the console watch manual.
Reference documentation lives in [../deploy.md](../deploy.md); the version
scheme that rides along is
[0078](0078-the-version-is-the-year-the-month-and-a-count.md).

## Context

**A green merge changed nothing for users until someone remembered it.** The
README's release instruction was a bare `firebase deploy` on a laptop, and
the repo's own documents record what forgetting looks like: a rules
tightening that was never deployed protects nothing, an index entry that
never left the file throws `failed-precondition` on its first real query
(#249), and both classes shipped while every local gate stayed green
([../emulator-blind-spots.md](../emulator-blind-spots.md)). "Deploy the rules
after merging" had become a recurring post-merge chore tracked in heads, not
in tooling.

**Deploys have different blast radii.** The feedback pipeline's runbook
([../feedback.md](../feedback.md)) is explicit that releases ship without a
functions deploy: only a change under `functions/` or a rotated secret needs
one, every functions deploy rebuilds a container image and re-pins secret
versions, and a bare `firebase deploy` would drag that machinery into every
release. Any automation had to keep that boundary, not flatten it.

**The production build cannot run from the repo alone.** `angular.json`
swaps in the gitignored `environment.prod-local.ts` via `fileReplacements`,
and the build fails loudly without it — by design, so placeholders never
ship. The ci job writes a stub to keep lint and tests type-checking, which
means the artifact CI has always built is exactly the one that must never be
served.

## Decision

**Every push to `main` that passes the full ci job fans out into deploy jobs
gated by what the push actually changed.** A `changes` job diffs
`github.event.before..github.sha` and classifies the paths; `deploy-web`
ships `--only hosting,firestore,storage` (hosting plus both rules files plus
the index file), and `deploy-functions` ships `--only functions`. Both
require the ci job green on the merge commit, and both run only from `main`.

### The diff decides, and a dispatch can override it

The exclusions are matched first: `docs/**`, `ios/**`, `.github/**`,
markdown anywhere (a README under `functions/` included), `.gitignore` and
`LICENSE` deploy nothing — the only paths excluded are ones that cannot
reach a deployed target. Then `functions/**` deploys functions, and
`firebase.json` deploys both, because it configures both. Everything else
deploys the web, so the rules files, `package.json`, `angular.json` and
`scripts/` (whose postinstall patch edits a dependency the bundle compiles)
all count. This keeps the
feedback runbook's boundary automatically: a release that does not touch
`functions/` ships without a functions deploy, with no one needing to
remember the rule.

`workflow_dispatch` grew two checkbox inputs, because two legitimate deploys
are invisible to any diff: redeploying unchanged code, and the functions
re-pin after a secret rotation. A plain dispatch stays what it always was —
a CI run and nothing more.

Rejected: **tag- or release-triggered deploys.** The failure being fixed is
a ritual that depended on someone remembering it; replacing it with a
different ritual keeps the failure and adds bookkeeping. Rejected:
**deploying every target on every merge.** It violates the runbook boundary
above and turns every docs typo into a container build. Rejected: **a
dispatch-only functions workflow** (the first draft of this design). It
preserves the boundary but reintroduces the memory burden — a merged
functions fix would sit undeployed until someone noticed, which is the
rules-drift failure wearing a different hat.

### The classification fails open, in twenty lines the workflow owns

When the previous commit cannot be resolved — a rewritten history, a first
push — everything deploys. The asymmetry is deliberate: over-deploying
re-releases identical content and costs minutes; under-deploying is the
failure mode where merged rules protect nobody, which is the reason this
record exists. The diff also runs with rename detection and path quoting
disabled: under git's defaults a rename collapses to its destination path
and a non-ASCII path arrives shell-quoted, and either would have slipped a
file past the globs — both were caught in review before the first deploy.

Rejected: **a marketplace paths-filter action.** This job holds deploy
credentials, and a path classifier is a `case` statement — importing a
third-party action here trades twenty auditable lines for a supply-chain
dependency in the most sensitive workflow the repo has. The industry got a
demonstration of exactly this trade in 2025, when a widely-used
changed-files action was compromised and dumped CI secrets.

### A scoped service-account key, consumed as Application Default Credentials

`google-github-actions/auth` writes the key held in the
`FIREBASE_SERVICE_ACCOUNT` secret and exports
`GOOGLE_APPLICATION_CREDENTIALS`, which firebase-tools honors. The account
carries deploy-shaped roles, not ownership; the grants are enumerated in
[../deploy.md](../deploy.md) along with the rotation commands.

Rejected: **`firebase login:ci` tokens** — deprecated by the CLI itself.
Rejected: **Workload Identity Federation.** Keyless is the better ceiling,
but a pool, a provider and an attribute mapping for a single-owner repo buy
little over a granular-role key with a written rotation habit. The revisit
condition is recorded in the doc: if key creation is ever policy-blocked,
WIF is the path.

### Index deletions never happen from CI

The deploy runs `--non-interactive` without `--force`. Verified against the
pinned firebase-tools 15.20.0 (`lib/firestore/api.js`): in that mode index
*additions* apply unconditionally, while for indexes present in the project
but absent from the file the CLI logs what it found, declines the deletion,
and continues the deployment. That is precisely the policy the reference doc
already demanded of humans — read the deletion list before accepting it — so
deleting an index stays a deliberate local act with `--force`, and CI can
never destroy an index behind anyone's back.

### The real production config rides a secret, not the repo

`deploy-web` rebuilds from scratch with the `PROD_ENVIRONMENT_TS` secret
written over the stub — the ci job's artifact is never reused, because it is
built against stub config by design. The secret mirrors the gitignored
`environment.prod-local.ts` byte for byte, so the file's own property — the
build fails loudly when it is missing — carries over to CI via an explicit
guard on the empty secret.

## Consequences

- **Within one deploy, rules land before the app.** The CLI's target order
  is fixed (storage, then firestore, then hosting), so a merge that changes
  both has a few seconds of new rules against the old app, and a failed
  hosting phase leaves that state standing. The manual two-step ritual had
  the same exposure for longer; rules changes must stay compatible with the
  shipping app either way.
- **The Hosting release history now names the merge.** `-m "$GITHUB_SHA"`
  stamps each release; only hosting releases carry a message, so the sha
  trail lives there alone.
- **A merge touching `functions/` deploys the function**, with the workspace
  test gate re-run in front of the deploy even though the ci job already ran
  it — a dispatch-triggered deploy has no PR run behind it.
- **The deploy jobs must never become required checks.** They are skipped on
  every pull request by design, and a skipped `if:` job satisfies a required
  check, which would make the protection theater. `ci` keeps its name and
  remains the meaningful gate.
- **Concurrent merges serialize per target, and ordering is enforced by a
  check, not by the queue.** Each deploy job has its own concurrency group
  with `cancel-in-progress: false`, but GitHub hands the pending slot to
  whichever run finished ci last — queue order, not commit order — so a slow
  run can arrive carrying a commit `main` has moved past. Right before
  deploying, each job therefore re-checks `main` and stands down when the
  newer commits touch its own target; when they do not, it proceeds, because
  its built output is identical to what the tip would produce. The groups
  are separate because a shared one would let a web deploy silently discard
  a requested functions deploy.

## Things that only became apparent while building

- **The stub environment file is needed even for the production build.**
  `tsconfig.app.json` includes `src/**/*.ts`, so `environment.ts` is a root
  file of the program and its re-export from `.vscode/environment` must
  resolve — `fileReplacements` redirects module resolution, it does not
  remove the file from the compilation. The deploy job therefore writes the
  stub *and* the real prod-local file.
- **`-m` looked like it labeled the deploy; it labels one target.** Rules
  releases have no message field, so the commit trail is only as complete as
  Hosting's history.
- **The credential can be sequenced out of reach of the web build, but not
  the functions one.** In `deploy-web`, auth runs after `npm ci` and the
  build, so no third-party install or build script executes while the key
  file exists on the runner. `deploy-functions` cannot have that property:
  `firebase.json`'s predeploy re-runs the workspace install and build inside
  `firebase deploy`, after auth — the same exposure every laptop deploy of
  the function has always had.

## Known gaps

- **The deploy returns before composite indexes finish building.** A merge
  can be green while its new index is still building and the query it serves
  still errors; the console watch — every entry **Enabled** — remains the
  manual half of the release, as the reference doc says.
- **`PROD_ENVIRONMENT_TS` drifts silently.** Nothing can compare a GitHub
  secret to a gitignored local file; editing `environment.prod-local.ts`
  without re-running `gh secret set` deploys the old config with no signal.
- **The functions IAM set is iterated, not proven.** The web roles match the
  CLI's own upfront permission check; the gen-2 functions deploy's full set
  is confirmed only by the first dispatch, whose 403s name the missing
  permission (the same first-run experience the feedback runbook records).
- **A workflow change ships unexercised.** `.github/**` deploys nothing, so
  an edit to the deploy jobs themselves is first proven by the next merge
  that actually deploys — or by a manual dispatch, which is the cheap way to
  find out on purpose.
