# Deploys

Every push to `main` that passes the full CI pipeline deploys itself; which
targets ship is decided by what the push changed. This doc is the runbook:
the classification, the secrets, the service account, the manual overrides,
and the checks that stay human. The reasoning and the rejected alternatives
are in [ADR 0077](ADR/0077-merges-deploy-what-they-changed.md); the version
scheme is in [ADR 0078](ADR/0078-the-version-is-the-year-the-month-and-a-count.md).

## What deploys when

The `changes` job in `.github/workflows/ci.yml` diffs the push and classifies
every path. Both deploy jobs require the ci job green on the same commit, and
neither ever runs from a branch other than `main` — on a pull request the
`changes` job still runs (and finds nothing to deploy) while both deploy jobs
show as skipped.

| The push touched | What deploys |
|---|---|
| `functions/**` | `deploy-functions` — `firebase deploy --only functions` |
| `firebase.json` | both jobs (it configures both) |
| `docs/**`, `ios/**`, `.github/**`, any `*.md`, `.gitignore`, `LICENSE` | nothing |
| anything else — `src/**`, the rules and index files, `package.json`, `angular.json`, `scripts/**`, … | `deploy-web` — `firebase deploy --only hosting,firestore,storage` |

The exclusions are matched first, so a markdown file under `functions/`
counts as markdown, not as a functions change.

`deploy-web` ships four things in one command: the hosting bundle,
`firestore.rules`, `firestore.indexes.json`, and `storage.rules`. The CLI's
target order is fixed — storage, then firestore, then hosting — so rules land
before the new app does. The hosting release is stamped with the commit sha
(`-m`), which is where to look when asking what is live.

Runs can finish out of order, so right before deploying each job re-checks
`main`: if the branch has moved past the run's commit with changes relevant
to that job's target, the deploy stands down and leaves the release to the
newer commit's run; if the newer commits are irrelevant to it (docs, or the
other target), it proceeds, because its built output is identical.

The classification fails open: when the previous commit cannot be resolved
(first push, rewritten history), everything deploys. Over-deploying
re-releases identical content; under-deploying is the failure mode
[emulator-blind-spots.md](emulator-blind-spots.md) exists to warn about.

`deploy-web` rebuilds from scratch against the real production config (see
the `PROD_ENVIRONMENT_TS` secret below). The build the ci job makes is
stub-configured for lint and tests and is never served.

## The manual override

Actions → **CI** → *Run workflow* on `main` offers two checkboxes:
**deploy_web** and **deploy_functions**. A plain dispatch with neither
checked is just a CI run. The checkboxes exist for the two deploys no diff
can see:

- **Redeploying unchanged code** — check `deploy_web`.
- **The functions re-pin after a secret rotation** — check
  `deploy_functions`. A full functions deploy re-pins every secret to its
  latest live version, which is the repair and the habit
  [feedback.md](feedback.md) records; the `secrets:set` convenience redeploy
  is still to be declined.

## Secrets: two inventories

**GitHub Actions secrets** (repo → Settings → Secrets → Actions) feed the
deploy jobs:

| Secret | Holds | Refresh with |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the deploy service account's JSON key | the rotation commands below |
| `PROD_ENVIRONMENT_TS` | the verbatim content of the gitignored `src/environments/environment.prod-local.ts` | the four-step ritual below |

Nothing can compare a GitHub secret to a gitignored file, so the repo keeps a
digest of one instead. Editing production config is four steps, all in the
same breath:

1. Edit `src/environments/environment.prod-local.ts`.
2. `gh secret set PROD_ENVIRONMENT_TS < src/environments/environment.prod-local.ts`
3. `node scripts/check-prod-env.mjs --write`
4. Commit the resulting `src/environments/environment.prod-local.sha256`.

`deploy-web` hashes the secret it just wrote and compares it against that
committed digest *before* the production build, so a half-finished ritual
fails in seconds instead of shipping old config silently
([ADR 0084](ADR/0084-the-production-config-secret-answers-to-a-committed-digest.md)).
Only sha256 digests are ever committed or printed — never a byte of the
configuration — and the hash ignores a trailing newline, so the stored
secret, the saved file and the deploy job's `printf` all agree.

A deploy that lands between the `gh secret set` and the digest's merge fails
that compare: finish the ritual and re-run the job. An unset or empty secret
still fails the deploy loudly, as it always did.

**GCP Secret Manager** holds the five `FEEDBACK_SMTP_*` / `FEEDBACK_EMAIL_TO`
values the Cloud Function reads. They are not GitHub secrets, they never
pass through CI, and their lifecycle (set, verify, re-pin) is
[feedback.md](feedback.md)'s runbook, not this one.

## The service account

Deploys authenticate as
`github-deploy@home-accounter.iam.gserviceaccount.com` via
`google-github-actions/auth`, which exports `GOOGLE_APPLICATION_CREDENTIALS`
for firebase-tools. One-time creation, run by the repo owner:

```bash
gcloud iam service-accounts create github-deploy \
  --project home-accounter --display-name "GitHub Actions deploy"

# Web deploy (hosting + rules + indexes)
for role in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding home-accounter \
    --member serviceAccount:github-deploy@home-accounter.iam.gserviceaccount.com \
    --role "$role"
done

# Functions deploy
gcloud projects add-iam-policy-binding home-accounter \
  --member serviceAccount:github-deploy@home-accounter.iam.gserviceaccount.com \
  --role roles/cloudfunctions.admin
gcloud projects add-iam-policy-binding home-accounter \
  --member serviceAccount:github-deploy@home-accounter.iam.gserviceaccount.com \
  --role roles/secretmanager.viewer
PROJECT_NUMBER=$(gcloud projects describe home-accounter --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --project home-accounter \
  --member serviceAccount:github-deploy@home-accounter.iam.gserviceaccount.com \
  --role roles/iam.serviceAccountUser

# The CLI also preflights ActAs on the App Engine default account, and its
# Blaze check reads the Cloud Billing API — which must be enabled once, an
# owner-level act that deliberately stays out of the deploy account's hands
gcloud iam service-accounts add-iam-policy-binding \
  home-accounter@appspot.gserviceaccount.com \
  --project home-accounter \
  --member serviceAccount:github-deploy@home-accounter.iam.gserviceaccount.com \
  --role roles/iam.serviceAccountUser
gcloud services enable cloudbilling.googleapis.com --project home-accounter

# Key → GitHub secret (delete the key file immediately after)
gcloud iam service-accounts keys create /tmp/github-deploy-key.json \
  --iam-account github-deploy@home-accounter.iam.gserviceaccount.com
gh secret set FIREBASE_SERVICE_ACCOUNT < /tmp/github-deploy-key.json
rm /tmp/github-deploy-key.json
```

**How sure is that role list?** The three web roles
(`firebasehosting.admin`, `firebaserules.admin`, `datastore.indexAdmin`)
match the permission check firebase-tools itself runs before deploying, so
they are certain. `firebase.viewer` covers the project-metadata and
API-enablement reads around them; if a first run 403s naming
`serviceusage.services.get` or `.use`, grant
`roles/serviceusage.serviceUsageViewer` / `Consumer` respectively. The
functions set (`cloudfunctions.admin`, `secretmanager.viewer`,
`iam.serviceAccountUser`) is verified — and it took two rounds beyond the
initial grants, exactly the iteration this section prescribes.
firebase-tools 15.28 preflights `iam.serviceAccounts.ActAs` on the App
Engine default account (`home-accounter@appspot.gserviceaccount.com`) even
though the runtime account is the compute default, and its Blaze check
needs the Cloud Billing API enabled once (15.20 checked neither, which is
why the first dispatched deploy sailed through and the next CLI version did
not). A future major may add another link; the procedure is unchanged: read
the error, grant or enable exactly what it names, re-run the failed job.
The first manual deploy went through the same iteration
([feedback.md](feedback.md), troubleshooting).

### Key rotation

Service-account keys never expire, so rotation is a habit, not an event:

```bash
gcloud iam service-accounts keys create /tmp/new-key.json \
  --iam-account github-deploy@home-accounter.iam.gserviceaccount.com
gh secret set FIREBASE_SERVICE_ACCOUNT < /tmp/new-key.json
rm /tmp/new-key.json
gcloud iam service-accounts keys list \
  --iam-account github-deploy@home-accounter.iam.gserviceaccount.com
gcloud iam service-accounts keys delete <OLD_KEY_ID> \
  --iam-account github-deploy@home-accounter.iam.gserviceaccount.com
```

A semi-annual reminder (Jan 1 / Jul 1) opens a GitHub issue for this via
`rotation-reminder.yml`, and it can also be dispatched manually at any time.

If key creation is ever refused (`iam.disableServiceAccountKeyCreation`),
the path forward is Workload Identity Federation — the revisit condition
ADR 0077 records.

## Index deletions never happen from CI

The CI deploy runs `--non-interactive` without `--force`. In that mode index
**additions** apply, while indexes that exist in the project but not in the
file are logged, declined, and left standing — the deployment continues. That
contract was last re-read at firebase-tools 15.28.2 (`lib/firestore/api.js`),
and the major is held there by `scripts/check-firebase-tools-major.mjs`, which
fails CI when the lockfile's resolved major is anything but 15 and prints
what to re-verify before the pin is raised
([ADR 0086](ADR/0086-the-firebase-tools-major-stays-pinned-by-a-gate-not-a-habit.md)).
Deleting an index is a local, deliberate act:

```bash
npx firebase deploy --only firestore:indexes --project home-accounter --force
```

and only after reading the deletion list the CLI prints.

## The index wait

A deploy returns before Firestore finishes building the indexes it just
accepted, so `deploy-web` runs `scripts/wait-for-indexes.mjs` straight after
the deploy: it polls the Firestore Admin API every 15 seconds for up to ten
minutes and fails the job if anything is still building when the bound is
hit. **Red there means shipped but unverified** — the release already
happened, nothing needs rolling back, and the recovery is to re-run the job
once the indexes are built, because re-deploying identical content is safe.
The Firebase console (Firestore → Indexes, every entry **Enabled**) is the
fallback for reading state when that step is the one that failed
([emulator-blind-spots.md](emulator-blind-spots.md),
[ADR 0087](ADR/0087-the-deploy-is-not-green-until-its-indexes-are-built.md)).

## Manual fallback

When CI is unavailable, the deploys it runs are reproducible locally — the
real `environment.prod-local.ts` is already in place on a working checkout:

```bash
npm run build:web
npx firebase deploy --only hosting,firestore,storage --project home-accounter
npx firebase deploy --only functions --project home-accounter
```

Always `--only`. A bare `firebase deploy` drags every target into one
release, which is exactly what the classification exists to prevent.

No CI wait runs on this path: after a local deploy that adds indexes, watch
Firestore → Indexes in the console yourself until every entry reads
**Enabled**.

## Versioning

Versions are **`YY.M.N`** — year tail, calendar month, running release
count. The count never resets: December is `26.12.x`, January is `27.1.x`,
and `N` climbs through both. The month is unpadded because npm enforces
semver and semver rejects leading zeros (`26.8.147`, not `26.08.147`). Bump
with `npm version <next> --no-git-tag-version` in its own
`chore: bump version to <next>` commit; it touches exactly `package.json`
and `package-lock.json`, and the iOS `MARKETING_VERSION` is deliberately
untouched.

## First-run checklist

Kept here because it is also the anything-looks-wrong checklist:

1. Actions run on the merge commit: `ci` and `changes` green, the expected
   deploy job(s) ran. A 403 names the missing IAM permission — grant it,
   re-run the failed job.
2. Firebase console: Hosting release history shows the merge sha as the
   release message; Firestore → Rules and Storage → Rules show fresh release
   timestamps. Index builds are CI's job now — the *Wait for Firestore
   composite indexes* step holds the run until every one is ready — so
   Firestore → Indexes is the fallback to read when that step is the one that
   went red.
3. https://home-accounter.web.app loads; hard-reload once (the service
   worker serves the cached shell until it updates); About shows the new
   version; one signed-in read and write works.
4. The next pull request shows both deploy jobs as skipped (`changes` runs
   and reports nothing to deploy), and a docs-only merge deploys nothing.
