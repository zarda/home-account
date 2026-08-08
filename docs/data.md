# Your data

**Your Data** (`/data`, from the sidebar) is one page naming every kind of
record the app has stored for you, how much of each, and where it is managed.
It exists because the app grew a dozen kinds of stored record and each one got
whatever entry point its own feature happened to have — two of them ended up
with none at all. The reasoning, and what was rejected, is in
[ADR/0029](ADR/0029-every-stored-kind-has-one-door.md).

## The catalogue is the deletion cascade, read forwards

`AccountDeletionService.cloudSteps` enumerates every subcollection an account
erasure has to sweep. `STORED_DATA_KINDS` in `stored-data.service.ts` mirrors
that list, keyed to the same step ids, and `stored-data.service.spec.ts` fails
when the two disagree: a cascade step must either appear in the catalogue or
be named in `NOT_A_RECORD_KIND` with a reason.

The effect is that the next stored kind cannot be added without a decision
about its door. Adding a step to the cascade and nothing else breaks the suite.

| Kind | Collection | Managed from |
|---|---|---|
| Transactions | `transactions` | the Transactions page |
| Categories | `categories` | Settings → Categories |
| Budgets | `budgets` | Budgets → Budgets |
| Recurring rules | `recurring` | Budgets → Recurring |
| Goals | `goals` | Budgets → Goals |
| Saved searches | `savedSearches` | the Transactions filter panel |
| Search answers | `searchAnswers` | `/search-history` |
| Category memory | `categoryMemory` | the AI page |
| Import history | `imports` | `/import/history` |
| Monthly snapshots | `insightSnapshots` | Reports → Insights |
| API keys | `secrets/providers` (a document) | the AI page |
| Security activity | `securityEvents` | Settings → Preferences |

Deliberately absent, and why: the app lock credential and the offline receipt
queue are device-local rather than account data; the user document is the
profile itself; the Firebase Auth user is not a collection of records. Receipt
images are Storage objects swept by the transactions step rather than a record
kind of their own, so the image manager stays in the Data Management section
below the index.

## What the numbers mean

Counts come from `FirestoreService.countDocuments`, which is
`getCountFromServer` — a server-side aggregate that downloads no documents.
Twelve are issued when the page opens and each lands on its own row as it
arrives, so a slow collection delays only itself.

A row shows one of three things:

- **a number** — the count, as the server reports it;
- **a dash** — the count was attempted and could not be fetched. The aggregate
  is server-only and does not fall back to the offline cache, so this is what
  the whole page reads offline. A wrong number here would be worse than none;
- **nothing** — the kind has no countable collection. API keys are one
  document holding encrypted keys, not a collection of records.

Two counts are worth reading carefully:

- **Categories** counts what is *stored*, and the built-in categories are not.
  `CategoryService.loadCategories` merges stored documents with code-defined
  defaults, so a fresh account reads 0 while the category list is full. It is
  the only kind with this shape.
- The counts are a snapshot taken when the page opened. Deleting records on
  the page a row links to leaves the number stale until the next visit.

## Links land on the section, not the page

A row for a kind managed inside a tab or a panel carries a query parameter:
`/budgets?tab=recurring`, `/reports?tab=insights`, `/settings?panel=categories`.
Budgets and Reports read it into their tab index through
`tabIndexFromParam`; Settings expands the named panel and closes Preferences,
because the accordion is `multi` and Preferences is long enough to push the
requested panel below the fold.

A value naming no section opens the first one rather than nothing — `indexOf`
returns -1 on a miss and a `MatTabGroup` handed -1 renders no tab at all, so a
stale link shows the wrong section rather than an empty page. The names are
checked in both directions: `stored-data.service.spec.ts` asserts every `?tab=`
value appears in the target page's exported list, and `app.smoke.spec.ts`
asserts each list still has as many entries as the strip it describes.

## Export, import and the danger zone

The Data Management surface — full backup, CSV export, CSV/JSON restore,
receipt images, delete-all and account deletion — sits below the index on the
same page. It moved here from a Settings expansion panel; Settings keeps a link
card pointing at `/data`. Nothing about what those actions do changed, and the
consent flows in front of the destructive ones are unaltered. See
[docs/account-deletion.md](account-deletion.md) for the erasure cascade the
catalogue is checked against, and [docs/csv-format.md](csv-format.md) for what
the export contract carries.
