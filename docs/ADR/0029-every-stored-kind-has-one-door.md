# 29. Every stored kind has one door, and the hub is checked against the deletion cascade

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #232

Reference documentation lives in [../data.md](../data.md).

## Context

The app persists thirteen kinds of per-user record, and managing them meant
knowing thirteen different doors. Two had none at all: insight snapshots were
only readable through the Reports tab that generates them, and the merchant
memory only had a count-and-clear card on the AI page. The pattern kept
repeating — a feature grew a stored record, the record got a page, and the
page got whatever entry point the feature happened to have. `/search-history`
was the newest instance: it existed, worked, and was reachable only from a
link inside the smart-search dialog.

What made this more than a missing menu item is that nothing in the codebase
knew what "everything stored" was, so nothing could tell when the list grew.
The issue proposed either promoting the existing Data Management panel or
building a new hub, and left open how much of it should be counted.

## Decision

**The catalogue is keyed to the deletion cascade's own step ids.**
`AccountDeletionService.cloudSteps` already enumerates every kind the app
stores — it had to, to erase them — and nothing read it. `STORED_DATA_KINDS`
mirrors it, and a spec fails when a cascade step is neither catalogued nor
listed in `NOT_A_RECORD_KIND` with a stated reason. That check is the point
of the change: a stored kind that the cascade erases but nothing lists is a
record with no door, which is the defect the issue filed. Rejected: a
hand-maintained list — it would have drifted the same way the entry points
did, and the drift is invisible until someone goes looking. Rejected: naming
the kinds only in the template, which no spec can enforce.

**Counts are server-side aggregates that degrade to unknown, never to zero.**
`FirestoreService.countDocuments` already wrapped `getCountFromServer` and had
no callers; the hub is its first. It downloads no documents, which is the
difference between a page costing twelve reads and one costing the whole
account. It is also server-only — it does not fall back to the offline cache —
so a count that cannot be fetched resolves to `null` and the row renders a
dash. A wrong number on a page whose entire job is telling you what you have
stored is worse than no number. Rejected: deriving counts from the subscribed
signals each feature already holds, which reports whatever a subscription
happened to deliver and reads zero for any collection nobody is watching.

**Each count resolves on its own.** They are issued together and written into
the signal as they land, rather than awaited as a set, so one slow collection
delays its own row and nothing else. A result that arrives after the session
changed is dropped: twelve reads are in flight at once, and a sign-out
mid-flight would otherwise land one account's totals on the next account's
page (ADR 0009).

**Data Management moves out of Settings and onto the hub.** It was an
expansion panel among several, which made data work one section of a settings
page rather than the place data work happens. It sits below the index on
`/data`, unchanged, and Settings keeps a link card — the treatment the AI
settings page already gets. Rejected: promoting the existing component in
place and growing it into the hub, which the issue offered as the smaller
change; the file was already 505 lines of TypeScript and this would only have
made it the largest in the feature tree.

**A row links at the section, not at the page containing it.** Half the kinds
are managed inside a tab or an expansion panel, so `?tab=` and `?panel=` open
the named one. An unrecognized value resolves to the first section rather than
to nothing: `indexOf` returns -1 on a miss and a `MatTabGroup` handed -1
renders no tab at all, so a stale link would show an empty page rather than
the wrong one. The names are checked in both directions — the catalogue's
values must appear in the target page's declared list, and the smoke
walkthrough asserts each list still matches the strip it describes.

**Sidebar only.** An eighth entry beside About. The bottom nav is at five
slots including the centre action, and a sixth crowds the labels at phone
width; mobile reaches the hub through the drawer.

## Consequences

- Opening `/data` costs twelve aggregate reads. They are cheap (Firestore
  bills one read per 1000 index entries) but they are not free, and they are
  issued on every visit — there is no cache.
- The hub is a navigation surface offline. Every row still links, and every
  count reads as a dash.
- Adding a stored kind now requires a decision about its door before the
  suite passes, which is the intended cost.

## Things that only became apparent while building

- "Not countable" and "count unavailable" had to be distinct states. The API
  keys row has no collection behind it — `users/{uid}/secrets/providers` is
  one document holding encrypted keys — and a single number-or-null model
  would have left it on a loading placeholder forever.
- The Categories row reads 0 on an account that plainly has categories, and
  it is right: `loadCategories` merges stored documents with code-defined
  defaults, so the built-ins genuinely are not stored. The count was correct
  and the wording was not; the row now says what is being counted. It is the
  only kind with this shape.
- The catalogue asked for a `database` icon, which this app's icon font does
  not have — Material Icons paints the literal word, 144px wide, and the
  sidebar entry simply looked bare. Every icon the hub introduces was probed
  against the live font before it shipped.

## Known gaps

- Receipt images are not a row. They are Storage objects swept by the
  transactions step rather than a record kind of their own, so they have no
  cascade id to key a catalogue entry to; the image manager stays reachable
  from the Data Management section below the index.
- The counts are not live. A record deleted on the page the row links to
  leaves the hub's number stale until the next visit.
- Saved searches and category memory link at the page that manages them
  (`/transactions`, `/ai`) but not at the panel or card within it, because
  neither surface has a section to name.
