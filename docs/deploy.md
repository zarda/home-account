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
| `PROD_ENVIRONMENT_TS` | the verbatim content of the gitignored `src/environments/environment.prod-local.ts` | `gh secret set PROD_ENVIRONMENT_TS < src/environments/environment.prod-local.ts` |

`PROD_ENVIRONMENT_TS` drifts silently: nothing can compare a GitHub secret
to a gitignored file, so re-run that `gh secret set` after **every** edit to
the local file, in the same breath. An unset or empty secret fails the
deploy loudly; a stale one deploys old config with no signal at all.

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

The CI deploy runs `--non-interactive` without `--force`. In that mode
(verified against the pinned firebase-tools 15.20.0) index **additions**
apply, while indexes that exist in the project but not in the file are
logged, declined, and left standing — the deployment continues. Deleting an
index is a local, deliberate act:

```bash
npx firebase deploy --only firestore:indexes --project home-accounter --force
```

and only after reading the deletion list the CLI prints. The console watch
also stays human: a deploy returns before index builds finish, so after any
merge that adds entries, watch Firestore → Indexes until every entry reads
**Enabled** ([emulator-blind-spots.md](emulator-blind-spots.md)).

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
   timestamps; Firestore → Indexes shows every entry **Enabled**.
3. https://home-accounter.web.app loads; hard-reload once (the service
   worker serves the cached shell until it updates); About shows the new
   version; one signed-in read and write works.
4. The next pull request shows both deploy jobs as skipped (`changes` runs
   and reports nothing to deploy), and a docs-only merge deploys nothing.
