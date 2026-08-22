# 63. An import suggests only what the account already knows

**Status:** Accepted, implemented · **Date:** 2026-08-22 · **Issues:** #314, #315, #320

Fills the slots [0059](0059-one-mapper-builds-every-imported-transaction.md)
opened and the review area
[0062](0062-the-review-step-can-correct-every-field-the-import-writes.md)
added. Reference documentation lives in
[../import-fields.md](../import-fields.md), with the per-feature detail in
[../receipt-import.md](../receipt-import.md) and
[../recurring.md](../recurring.md).

## Context

A transaction typed by hand carries a place and tags; one the scheduler posted
carries the id of the rule it belongs to. A transaction read off a receipt
carried none of the three. The row shapes had held `tags` and `location` since
0059 with no producer filling either, and `recurringId` was not on any of the
three shapes at all.

In each case the answer was already within reach and nothing went to fetch it:

- **The address is printed on the paper the reader is already looking at.** The
  receipt prompts asked for the merchant, the total, the date, the currency and
  the items — never for where. The one position the app did fetch, after an
  unreadable currency, to guess a currency from the country the phone was in,
  was used for that lookup and discarded.
- **Nothing in the app could say which tags an account uses.** Tags were typed
  into two chip inputs that each trimmed and lowercased on their own, and the
  two disagreed: only the form cut at `MAX_TAG_LENGTH`, so a longer tag typed
  into the filter could never match the stored one it was meant to find. There
  was no vocabulary to draw on and nowhere that built one.
- **The insights surface already decided whether a charge looks like a rule.**
  `isGroupCovered` matches a detected group against the active rules by cadence
  and by a merchant-name ladder. An import row is the same question with the
  cadence missing, and the import never asked it.

The alternative to all three is a model inventing them, which is worse than an
empty field: an address guessed from a chain's name, a tag in a vocabulary the
user does not keep, and a rule link that writes a transaction against the wrong
schedule are each wrong in a way that is hard to see and expensive to undo.

## Decision

**An import suggests only what the account already knows** — a place its own
receipt printed, a tag it already uses, a rule it already has. Nothing is
applied silently: everything lands as something the review step shows and can
take back off.

### The place, as printed

One `LOCATION_FIELD` fragment is rendered into all five receipt prompts
(`receiptParse`, `receiptSummary`, `statementTransactions`,
`multiImageReceipts`, `receiptItems`) and mirrored by one `@Guide` on the
on-device `ReceiptExtraction` struct. It asks for the branch name and/or street
address the receipt itself prints, exactly as printed and in the receipt's own
script — never translated, never transliterated, never inferred from the
merchant name — the same wording discipline the body text already gets
([0008](0008-universal-receipt-language-support.md)). The two item prompts
carry it once per receipt group, on the group's last item, the convention
`receiptDetails` and `receiptTotal` already use.

The answer is validated rather than trusted, the way a currency code is.
`readPrintedLocation` collapses whitespace, and drops a non-string, an empty
string, anything over 120 characters — a model echoing the receipt body is not
reporting an address — and anything equal to the merchant name, because the
prompt forbids inferring a place from the name and a model that did has not
answered the question. `printedLocationSlot` turns a survivor into the row's
slot and nothing at all into nothing at all, so absence keeps meaning "nobody
looked".

The in-form scan **prefills an empty Location field and never overwrites a
typed one**. The position fetched for the currency guess is *offered* as a
chip, not attached, and only when the receipt is dated today and no coordinate
is already on the form: a fix taken at home says nothing about where last
week's receipt was paid, and the coordinate is evidence about the phone rather
than about the paper.

### The tags, from the account's own vocabulary

The vocabulary is the tags on the last six months of transactions, plus the
tags memory holds, normalized through one `normalizeTag` that the form, the
filter and the suggester now share. `GroundingHistoryService.recent()` is the
single read behind it, gated on `ragInsightsLevel` and shared with the
categorization grounding, which used to run its own copy of the same query.

The ladder is categorization's, applied to tags:

1. **Memory answers first.** What the user kept for this merchant last time,
   read from a warm local map, so it works with the RAG level off — it is the
   user's own decision, not their history leaving the device.
2. **The model answers the rest** only when the level is on, the vocabulary is
   non-empty and a cloud provider is configured. It is sent the vocabulary and
   told to pick at most three from it, or none.
3. **Every answer is checked against the vocabulary** — in the adapter, by
   `applyTagSuggestions`, and again in `TagSuggestionService`, which is the
   seam the app owns and the only one an emulator run exercises with the
   adapter stubbed. A tag outside the vocabulary is not a tag, it is absent
   ([0046](0046-an-unrecognized-category-name-is-not-a-category.md)).

Whichever rung answered, a tag this merchant has had removed before is filtered
out. At confirm, `TagMemoryService` records per merchant what was kept and what
was taken off a suggestion; `remember` replaces the kept list (the last confirm
is the current opinion) and accumulates refusals, but a tag kept again stops
being refused. A tag both kept and removed for the same merchant in one batch
is recorded as neither — the batch contradicted itself and there is no decision
to store.

`tagMemory` mirrors `categoryMemory` deliberately, all the way down: a
`users/{uid}/tagMemory/{merchantKey}` collection with a closed key set in the
rules, a step in the deletion cascade, a row in the stored-data catalogue, and
a settings card with a count and a Forget all. It is not in the backup —
neither is category memory.

### The rule it looks like

`recurringId` gains a slot on all three row shapes and a truthy spread in the
mapper, so an accepted link travels to the write like every other field and a
declined one — a key holding `undefined` — never reaches Firestore.

`matchRecurringRule` is placed beside `isGroupCovered` because the name ladder
they share, `merchantNamesMatch`, is module-private. A rule is offered when it
is active, its type agrees, its name matches by the detector's own ladder
(normalized equality, containment at three characters or more, then bigram
similarity at the detector's threshold), and its amount is within the
detector's tolerance — checked when the currencies agree and also when the row's currency fell
back, since the printed figure is the only evidence such a row has; a figure
in a currency a reader did read is not comparable without a rate. First match wins.

**The link is offered unchecked.** Accepting writes `recurringId` and
`isRecurring: true`; declining restores whatever the source said about
`isRecurring`, including having said nothing. A wrong candidate costs a glance,
not a write.

**A stored row that already carries the offered rule's id is reported as a
duplicate of type `recurring_occurrence`**, whatever the amounts say. The
scheduler posts occurrences at the rule's own amount and under the rule's own
`description` — not its name — so a receipt for that charge need not match the
posted row on either field the ordinary detector compares. The rule id is the
only thing that reliably identifies it.

### The alternatives that were rejected

- **A `country` field now.** Deciding a country from the receipt rather than
  from where the phone happens to be is #156's whole subject, and it wants more
  signals than one prompt fragment can carry. The fragment is shaped so
  `country` can be asked for beside `location` when that is taken on. Worth
  knowing first: `prompts:check` catches hand-written currency and
  recognition-language runs, and a list of two-letter country codes matches
  neither pattern.
- **A payment method column on `Transaction`.** The receipt prints one and the
  prompts already reproduce it in the body; a new stored field is a schema, a
  rules change and a filter, for something no screen asks for yet.
- **Checking cadence for a single row.** One row has no gaps to observe. The
  amount stands in for the schedule, which is why it is compared at the
  detector's own tolerance rather than exactly.
- **Creating a rule from an import.** That is #48, and it is a write with a
  schedule attached — the wrong thing to offer from a checkbox on a review
  card.
- **Calling the model with an empty vocabulary.** An account with no tags would
  get tags invented for it, which is the failure this whole ladder exists to
  avoid. No vocabulary, no request.
- **Taking the tags out of the categorization answer** instead of a second
  call. Categorization skips every row memory already answered, so the rows
  most likely to deserve a tag are exactly the ones it does not send.
- **A `recurringId` equality filter in `buildTransactionWhere`.** It multiplies
  the composite index set `indexes:check` derives from that builder, for a
  lookup that is already affordable client-side over the ±2-day window
  duplicate detection loads anyway.
- **Attaching the scanned position outright.** See above: it describes the
  phone, not the receipt.

## Consequences

- **One more model request per 25-row chunk**, when the account has tags and
  the RAG level is on. `suggestTags` is chunked like categorization for the
  same reason — the answer is what the output budget has to hold — and is
  registered, documented and asserted like every other prompt
  ([0005](0005-prompt-registry-and-provider-parity.md)).
- **`tagMemory` must be deployed with the rules before it works in
  production.** The emulator loads the local file, so a run here is green while
  a live write is refused.
- **The on-device reader can now report a location and still suggests no
  tags.** The tag ladder's model rung needs a cloud provider; memory still
  answers on that path.
- **The wizard reads the rules once per batch through `listAll()`**, not from
  the rules signal, which is only warm on pages that subscribed to it
  ([0034](0034-a-correctness-read-enumerates-the-collection.md)). A failed read
  offers no links and does not fail the import.
- **The occurrence flag keys on the offered rule, not on an accepted link**,
  because detection runs after the offer and before the card exists. Such a row
  arrives deselected like any other duplicate, and declining the link does not
  re-run detection — a second pass per checkbox toggle was not worth the read.
- **No rules change for the link and no new index.** The transactions rules
  already validate `recurringId is string` over an open key set, and the
  occurrence lookup is a scan of rows already in memory.
- **The JSON backup door takes neither suggestion.** Its rows carry the tags,
  location, period and `isRecurring` the backup recorded; suggesting over them
  would argue with a file the app itself wrote.

## Things that only became apparent while building

- **There was no vocabulary anywhere**, and the two places that spelled a tag
  disagreed about length. `normalizeTag`/`normalizeTags` exist because a
  suggested tag has to be byte-identical to a stored one for the filter to find
  the row it was suggested for.
- **Two merchant normalizers meet on the same card.** Tag memory and duplicate
  detection key by `normalizeMerchantKey`, which strips everything outside
  letters and digits; the detector and the rule matcher use `normalizeMerchant`,
  which NFKC-folds, keeps word boundaries and drops a trailing digit run. Both
  are right for what they do and neither can be swapped for the other, so one
  row can be "the same merchant" for a tag and a different one for a rule.
- **A posted occurrence does not look like its rule.** It carries
  `rule.description`, which the conversion dialog prefills empty, and never
  `rule.name`. Any matching that reads descriptions would have missed exactly
  the rows this is meant to catch.
- **#320's CSV claim was already fixed.** Its "the wizard drops a CSV's
  Recurring column" had been closed by the mapper work in #325; it is pinned by
  a spec here rather than implemented again.
- **The scan's spinner outlives its own success toast.** The in-form scan
  reports the scan as done and then waits on the tag round-trip, so the
  scanning indicator is still turning after the user has been told it worked.

## Known gaps

- **A fallen-back row's figure is compared as-is, whatever the rule's
  currency.** A row whose currency fell back carries the account's base
  currency rather than anything anyone read, so the ordinary rule — skip the
  amount check when the currencies differ — would have offered it a rule in
  any other currency on name and type alone. The name ladder's containment
  rung meets "Gym" with "Gymboree", and an offered rule with a posted
  occurrence in the window *deselects* the row through the duplicate flag, so
  a name-only hit is not a cosmetic mistake. The candidate therefore carries
  `currencyFellBack` and the printed figure is compared against the rule's
  amount whatever currency the rule keeps. The cost is a row whose unread
  currency really did differ from the rule's: its figure will not agree and
  the link is not offered, so the reviewer ticks the box by hand. That was
  preferred to the alternative, because a wrong offer costs the reviewer a
  row they meant to import and a missing offer costs a tick.
- **The same merchant written two ways keys two memories.** "STARBUCKS #4412"
  and "Starbucks Shibuya" normalize to different keys, so a tag kept on one
  teaches the other nothing. That is #296, and it is the same limit category
  memory has.
- **A JSON backup row's `recurringId` stays out of the wizard's reach.** The
  slot exists on the row shapes, the backup door does not read it, and the
  review card only ever offers a link it matched itself.
- **The offline drain suggests nothing and keeps no address.**
  `OfflineQueueProcessorService` writes a queued receipt's rows from its own
  field list, so a photo taken offline lands without the location the reader
  now reads and with no review step on which anything could be offered — the
  separate door
  [0060](0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md)
  already recorded.
- **The on-device `location` field is compile-checked only.** The `@Guide` was
  added to the `ReceiptExtraction` struct and the build is green, but no device
  with Apple Intelligence has run it, so whether the model actually fills the
  field — and how it behaves on a receipt that prints no address — is
  unverified. A binary built before the field omits the key entirely, which
  `readPrintedLocation` reads as "no address printed", so an older install
  degrades to the behaviour it already had rather than failing.
- **A removed location is forgotten immediately.** Only tags remember a
  refusal; a place taken off a row is offered again on the next import of the
  same receipt.
