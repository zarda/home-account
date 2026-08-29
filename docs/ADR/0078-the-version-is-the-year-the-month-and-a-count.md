# 78. The version is the year, the month, and a count

**Status:** Accepted, implemented · **Date:** 2026-08-29

Adopted alongside [0077](0077-merges-deploy-what-they-changed.md): once every
merge deploys itself, the version's job is to say *when a build is from*, and
the old numbers never said that.

## Context

The scheme this replaces ended at `1.28.146`. The major had never moved, the
minor was a hand-advanced counter with no stated meaning, and only the last
number carried a rule anyone used: it goes up by one per release and never
resets. Semver's compatibility contract is written for things with
consumers; an app with no API surface pays the ceremony and collects none of
the benefit. Meanwhile the one question the version is actually asked — on
the About page, and stamped into every feedback record as `appVersion` — is
"how old is this build?", which `1.28.146` cannot answer.

## Decision

**Versions are `YY.M.N`: the year's last two digits, the calendar month, and
the running release count.** The count carries straight on from the old
scheme — the first version under this record is `26.8.147` — and keeps its
old rule: it never resets, not at a month boundary and not at a year one.
December is `26.12.x`, the following January is `27.1.x`, and `N` keeps
climbing through both, so it doubles as a total-release odometer and two
releases can never share a version.

**The month is unpadded because the tooling rejects the alternative.** npm
validates the `version` field as semver, and semver forbids leading zeros in
a numeric identifier: `26.08.147` is not a version, `26.8.147` is. Zero
padding was the preferred spelling and is simply unavailable.

Rejected: **resetting the count each month.** It discards the odometer and
the continuity with 146 releases of history for no gain — the year and month
already provide the calendar. Rejected: **carrying the date in build
metadata** (`1.28.146+2026.08`). The About page and the feedback records
read `package.json` verbatim, and semver defines `+` as ignorable, which is
the opposite of the point.

## Consequences

- Ordering stays monotonic across the switch: `26` outranks `1` everywhere
  semver is compared, so every new version sorts after every old one.
- The bump ritual is unchanged: `npm version <next> --no-git-tag-version`,
  its own `chore: bump version to <next>` commit, touching exactly
  `package.json` and `package-lock.json`. Only the value's shape changed.
- A feedback record's `appVersion` now dates the build that filed it, which
  is what a triage read actually wants from it.
- The iOS target keeps its own decoupled `MARKETING_VERSION`; nothing about
  this record touches it.
