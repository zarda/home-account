# 84. The production config secret answers to a committed digest

**Status:** Accepted, implemented · **Date:** 2026-08-31 · **Issues:** #349

## Context

`deploy-web` builds the shipped bundle from the `PROD_ENVIRONMENT_TS` secret,
which is a verbatim copy of the gitignored `environment.prod-local.ts`
([0077](0077-merges-deploy-what-they-changed.md),
[../deploy.md](../deploy.md)). Two artifacts that must agree, and nothing in
the repo could compare them: the secret is write-only once it enters GitHub,
and the file is gitignored precisely because it carries production Firebase
keys.

**The two failure modes are not symmetric.** An unset or empty secret fails
the deploy loudly — 0077 added an explicit guard for it. A *stale* one is
silent by construction: the build succeeds, the bundle ships, and it carries
whatever configuration was last uploaded. Editing the local file without
re-running `gh secret set` in the same breath was the whole exposure, and the
only thing standing in front of it was a sentence in the runbook telling the
owner not to forget. 0077 filed it under known gaps for exactly that reason.

**Anything that makes the drift visible must not print configuration.** That
constraint is what rules out the obvious answers — echoing the secret, or
diffing it against anything checked in — and it is why the guard's design is
about what it is structurally unable to reveal, not only about what it
happens not to print.

## Decision

**The repo commits a sha256 digest of the config's bytes, and `deploy-web`
refuses to build when the secret it just wrote does not hash to it.**
`scripts/check-prod-env.mjs` is both halves: `--write` records the digest of
the real local file into the tracked
`src/environments/environment.prod-local.sha256`, and the default mode
recomputes the digest of whatever is on disk and compares.

**One normalization rule, so the same content hashes the same however it got
to disk.** The hash runs over the bytes with a trailing run of CR/LF
stripped, which reconciles the three forms this content legitimately takes:
an editor-saved file (trailing newline), `gh secret set … < …ts` (a verbatim
read, newline included — the value GitHub actually stores), and
`deploy-web`'s `printf '%s' "$PROD_ENVIRONMENT_TS" > …ts` (no trailing
newline). Only the trailing run is stripped; a blank line in the middle of
the file still changes the digest.

**Digests only, never content.** The comparison is a pure function of two
digest strings — it never receives file content at all, so no failure path
can leak configuration by accident rather than by care. Every message the
script prints is a hex digest, a path, or the ritual below.

**The compare runs in `deploy-web`, before the build; the `ci` job runs the
self-test alone.** In `deploy-web` it sits between the step that writes the
secret and the production build, so a drifted secret costs seconds instead of
a full Angular build. In `ci` the compare would be meaningless: that job's own
"Create local environment stubs" step writes a `ci-stub` placeholder to the
same path, so a compare there would fail on every single run by construction
and prove nothing about the secret. What is worth proving in `ci` is that the
checker itself still works, which is what `--self-test` does.

**Editing production config is now a four-step ritual, and the guard makes
any half-completed one loud:** edit `environment.prod-local.ts` → `gh secret
set PROD_ENVIRONMENT_TS < src/environments/environment.prod-local.ts` →
`node scripts/check-prod-env.mjs --write` → commit the digest.

Rejected: **logging a digest at deploy time and leaving a human to compare
it** — the issue's first suggestion. It surfaces drift only to someone who
reads a *green* run's logs and remembers the previous value, which is the
same memory burden #349 exists to remove, dressed as tooling. Rejected: **a
serial or version field inside the config that the build prints** — the
issue's second suggestion. It lives inside the artifact being compared, so it
goes stale in exactly the moment the editor forgets to bump it: it fails
whenever the discipline it replaces fails. Rejected: **committing the config
encrypted.** It needs a second secret to hold the key and puts the ciphertext
in git forever, to solve a problem a 64-character digest solves.

## Departures from the issue

- The issue's acceptance criterion offered a logged digest *or* a printed
  serial; the digest half was taken and the logging half was turned into a
  hard compare. A number that nobody reads has the same failure mode as the
  discipline it replaces.
- "docs/deploy.md describes the guard and drops the bare-discipline wording"
  landed with this record rather than with the guard's own commit, which was
  scoped to the script and the workflow.

## Things that only became apparent while building

- **The self-test that proves the red path is the one CI runs, and it leaked
  a frightening line into every green run.** The checker's self-test spawns
  itself as a real child process against fixtures so the CLI wiring is proven
  and not just the pure functions — and `execFileSync`'s default `stdio`
  pipes a failing child's stderr straight through to the parent *while still*
  capturing it for the assertions. The deliberately-failing fixture therefore
  printed a "does not match the committed digest" line into `deploy-web`'s log
  on every successful run. Explicit `stdio: ['ignore', 'pipe', 'pipe']` fixed
  it. Nothing sensitive was ever in that output — digests only, as designed —
  but a guard whose healthy state looks like its failure state is not much of
  a guard.
- **The failure message cannot be tailored to the case, and shouldn't try.**
  A missing digest file could mean the ritual was never run, or that only its
  last step was skipped; the guard cannot know whether the secret is currently
  in sync with the local file, because that is the very thing it exists to
  answer. Both failure shapes therefore print the whole ritual. Re-running
  `gh secret set` when it was not strictly needed is idempotent; telling
  someone to skip a step they actually needed is not.

## Known gaps

- **A run queued across the digest's merge goes red rather than standing
  down.** The compare is between the secret as it is *now* and the digest as
  of the commit being built. A run that was queued before the digest landed
  therefore compares the new secret against its own older checkout and fails,
  which is indistinguishable from real drift. It is rare — it needs a deploy
  in flight during the ritual — and the recovery is to re-run the job on the
  newer commit.
- **The guard is loud about half-finished rituals, not about untouched
  ones.** If the local file is edited and *neither* `gh secret set` nor
  `--write` follows, the secret and the committed digest still agree with each
  other: they are both simply old, and the deploy ships old config exactly as
  it did before. What #349 asked for was that forgetting the secret upload
  stop being silent, and it now is; a change that never leaves the laptop is
  still a change nothing can see.
- **A digest proves bytes, not correctness.** A secret updated to a
  wrong-but-consistent configuration passes every check here. This guard
  answers "are these the bytes we recorded", and nothing more.
