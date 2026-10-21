# 180. A saved key joins the wait, and a reader sees their own language

**Status:** Accepted, implemented · **Date:** 2026-10-19 · **Issues:** #497

Reference documentation lives in [../receipt-import.md](../receipt-import.md),
[../ai-models.md](../ai-models.md), [../i18n.md](../i18n.md),
[../csv-format.md](../csv-format.md), [../data.md](../data.md),
[../recurring.md](../recurring.md), [../performance.md](../performance.md),
[../testing.md](../testing.md) and [../ui-overflow.md](../ui-overflow.md).

This record takes the five parts of #497: a key saved on the AI settings
page that the queue's wait could not see, beside a failed key read that was
final for its attempt; a category the catalog cannot name, read in English
on five screens and in the exports; five filter options Material read as a
reset; a resume refusal that asked the owner to check the rule rather than
save it; and a model probe that sent the Gemini key in its URL.

Amends
[0178](0178-a-schedule-is-held-to-its-ranges-and-a-refusal-says-what-was-written.md).
Its ranges, its two refusals of an import, its cold catalog read and the
drain's wait for its providers stand. What changes is what that wait
follows: a key saved in settings is now a bring-up the wait joins, and a
bring-up whose own key read failed online is read once more before the wait
answers. The resume refusal now asks the owner to save the edited rule, and
`material:check`'s second rule holds an option bound to `undefined` as it
holds one bound to `null`.

It closes three gaps of 0178.

- **0178's *A key saved on the AI settings page is not waited for*** said a
  save there brought its provider up outside the bring-up the drain waits
  for, so a **Sync Now** pressed during it could still spend a retry. The
  page now saves through `AIStrategyService.applyProviderKey`, which makes
  the save the bring-up a wait joins before its first await.
- **0178's *An option bound to `undefined` still shows an empty field***
  left open whether an unset filter should read *All*. The owner chose
  *All*: the five selects set `canSelectNullableOptions`, and the gate's
  rule names `undefined` too.
- **0178's *No gate holds an English display fallback*** said the gate
  waited for a wave that fixed the sites. Every site a reader sees now reads
  `common.unknownCategory` through the one rule in core, and `i18n:check`
  has a fifth scan. The words stored on a row stay, by the owner's decision
  of 2026-10-15, in a table that is not a freeze (see *The gate*).

It narrows a gap of 0175 and a gap of 0178.

- **0175's *A drain whose key read fails still reads as a connection
  problem*.** A read that fails while online is now read once more before
  the drain goes on, so one transient failure no longer files a scan
  *Connection problem* and spends its retry. A read that fails again still
  does (see *Known gaps*).
- **0178's *A failed key read still files network*** also said the read is
  not tried again until the account or the connection changes. The drain's
  wait now tries it once more within the same attempt. No other caller does
  (see *Known gaps*).

It extends 0177, whose model probe now sends the Gemini key in the
`x-goog-api-key` header rather than in the URL, and whose self-test now
pins the `--repeat` bound and a drift on a later run.

`adr-index:check` reads no narrowing
([0172](0172-a-closure-is-named-on-both-rows-and-the-adr-index-is-checked-against-the-records.md)),
so those relations are kept on both rows by hand.

## Context

The branch that shipped 0178 found these five, none in its scope and none
new (#497). None lost data already stored.

- **A key saved in settings was outside the drain's wait.** Each key field
  saves on blur. Its handler awaited `ProviderKeyService.setKey` and then
  `CloudLLMProviderService.updateProviderApiKey`, outside `bringUpFor`.
  Pressing **Sync Now** is what blurs the field, so a drain's wait started
  while the write was still out, found the attempt's bring-up finished, and
  answered that the providers were up. The drain then sent the photo to a
  provider the key had not reached: the scan was filed *Connection problem*
  and spent a retry.
  - A refused write went on to the global error handler and its generic
    notice.
  - `AIStrategyService.updateCloudProviderApiKey`, another way to arm a key
    outside the wait, had no caller, and the page's `isGeminiAvailable` was
    a computed over a method that reads no signal, which no template read.
- **A failed key read was final for its attempt.** `ProviderKeyService`
  answers a failed read with `{}` and sets `loadFailed()`. The bring-up
  armed nothing, the wait answered, and nothing read the keys again until
  the account or the connection changed. One transient Firestore error
  could cost every queued entry its retries, one drain at a time (0178's
  *Known gaps*).
- **A category the catalog cannot name read in English.** Five screens
  wrote a literal `'Unknown'`: the dashboard's spending chart, which also
  draws the donut inside Category Breakdown; the Budgets Recurring tab; the
  import's category chip; Category Breakdown's list; and Spending Analysis.
  So did `ExportService.getCategoryName`, which five exports share: the
  detailed and summary CSV, the category-summary CSV and PDF, and the report
  PDF. Two more sites, the insight card and the snapshot comparison, printed
  the raw id in every language.
- **Five filter options read as a reset.** The transaction filters' *All*
  options were bound `[value]="undefined"` with no
  `canSelectNullableOptions`, so with no filter set each field showed
  empty, its label at rest. `material:check`'s rule named `null` only.
- **The resume refusal asked the owner to check.** For the commonest
  stalled shape, a monthly `dayOfMonth: -60`, the dialog opens with every
  field valid, so nothing said that Save was the repair. And saving leaves
  the rule paused, so a Resume still follows it.
- **The probe's Gemini key travelled in the URL**, as `?key=`, redacted in
  everything the probe printed, where the app's SDK sends it in
  `x-goog-api-key`. Nothing pinned `--repeat 10`, the bound, and the drift
  check had no case for a drift on a later run.

Four facts kept the fix small:

- **The strategy already keyed its bring-ups by attempt, and the wait
  compared them by identity** (0178), so a save only had to become the
  latest bring-up.
- **The rule for an unknown category existed.** 0178 put
  `categoryDisplayName` and `categoryNameOrUnknown` in
  `core/utils/category-display.utils.ts`, reading `common.unknownCategory`,
  which all three catalogs already hold.
- **The filters' fix had a precedent**, 0178's own four selects, and the
  gate had its shape; only its pattern was narrow.
- **The probe already had a transport seam, and an auth-header list that
  named `x-goog-api-key`**, so the header printed redacted with no new rule.

## Decision

**A key saved on the AI settings page goes through the strategy, which
makes the save the bring-up a waiting caller joins before its first await
and runs a full bring-up once the write lands. A wait whose bring-up's own
key read failed while online reads the keys once more. A category the
catalog cannot name reads `common.unknownCategory` on every screen and in
every export, and `i18n:check` fails on an English fallback a reader would
see, with the words stored on a row and the words only a model reads named
in two tables. The transaction filters' *All* options show their label, and
`material:check` holds an option bound to `undefined`. The resume refusal
asks for a save first. The probe sends the Gemini key in a header.**

Each commit is cited by its subject. Line numbers are the branch's final
code's. The mutation runs are each made with the specs of the commit that
added the code they take out, unless the text says the final code.

### A saved key is a bring-up of its own

`fix: a key saved in settings is part of the bring-up the drain waits for`
adds `applyProviderKey(provider, key)` to `AIStrategyService`
(`ai-strategy.service.ts:800-825`).

- **Everything that matters happens before its first await.** It reads the
  account, starts `ProviderKeyService.setKey`, which reads the account
  before its own first await, takes the bring-up in flight as `previous`,
  and installs the save as `initialization`, the bring-up a wait joins. A
  drain whose wait starts while the write is out follows the save.
- **It waits for the write and for `previous`** (`Promise.allSettled`), and
  then runs a full bring-up: the key read, the stored model ids, and Gemini
  cleared rather than armed from the build's key when none is stored. So
  saves come up one after another.
- **A refused write rejects the save**, with nothing brought up for it, but
  only once `previous` is up, so a wait the save took over does not answer
  early.
- **An account that signed out before the write landed** has nothing
  brought up for it: the save brings up only while the account it read is
  still the one signed in, in the same session. A switch that reaches the
  effect as one change moves no session (see *Known gaps*).
- **A save still out is tagged with its account** (`pendingKeySave`,
  `:153`). `bringUpFor` (`:253-265`) brings a new attempt for that account,
  a reconnect during the save or the account's first attempt when the save
  came first, up behind the save. Another account's attempt never waits on
  it. The sign-out branch drops the tag (`:225`).

At this commit the strategy spec's *a key saved in settings* holds twelve
cases: the write before the first await; a wait that starts during the save
held until the bring-up after the write; a wait already joined moved on to
the save; the save brought up only after the bring-up in flight; a refused
write rejecting while it still holds the wait; nothing brought up for an
account that signed out before its write landed, and the next account
brought up at once, three ways; a reconnect during the save brought up
behind it; the same account signing back in during its own save, brought
up at once; and a clear through the same write and a full bring-up. That
save still brings the account up a second time once its write lands, until
`fix: a provider wait whose key read failed reads the keys once more` adds
the signed-out count (see *A failed key read is read once more*).

Each part was taken out in turn, and each removal failed cases of its own.
Installing the save once its write and `previous` had settled failed nine,
the held and the moved-on wait among them. Dropping `previous` failed the
two ordering cases, and dropping the chain four, the reconnect during the
save among them. Dropping the account tag failed the three cases in which
the switch reaches the effect as one change, and so did dropping the save's
account check, since the signed-out count covers the sign-outs. Dropping
the sign-out unlink failed the sign-back-in case and the two the
whole-branch review added beside it.

A second top-level describe in the processor spec, *a key saved while Sync
Now drains*, runs the real strategy under the real processor with the key's
write held: *holds the photo until a key saved on a settled page is up* and
*holds the photo when the drain starts the account's first bring-up
itself*. Before the fix each sent the photo to a provider with no key, and
filed it failed with a retry spent. The provider smoke *waits for a key
saved through the strategy* holds it over the real graph on the emulators,
with a fake key that only builds a local client.

`fix: the AI page saves a key through the strategy and says when the save
fails` gives the page one `saveKey` (`ai-settings-page.component.ts:331-340`).

- **The three blur handlers** keep their `keysLoaded()` gate and call it.
  None writes the key store or arms a provider itself.
- **A refused save** logs and raises `aiPage.keySaveFailed`, *Could not
  save the API key. Try again.*, in place of the generic notice. The field
  keeps what was typed, so the next blur tries again. A refused clear
  leaves the key stored and its provider armed, so a field still empty when
  the refusal lands shows the stored key again, with its clear button to
  try again; one typed into meanwhile keeps the typing. A refused typed
  save never rewrites the field, even one emptied by hand since.
- **The three clear handlers** call their blur handler with `void`, so no
  rejection reaches the global handler.
- **The Test buttons stay on `updateProviderApiKey`**
  ([0179](0179-a-provider-arm-applies-only-if-nothing-superseded-it.md)
  records what a Test press reports).
- **Sync Now stays enabled during a save** (see *What was rejected*). A
  pin, *leaves Sync enabled while a key save is still in flight*, dispatches
  a real blur and holds the save; a mutation that disabled the button while
  a save ran failed it.

The page spec's *when the save is refused* holds the notice and the kept
value, every provider, a clear that lets no rejection out, which spies on
`console.error` (see *Things that only became apparent while building*),
the stored key shown again with its clear button after a refused clear,
a field typed into meanwhile kept as typed, and a field emptied by hand
during a refused typed save left empty. Dropping the restore's check of
the saved value failed that last case, and dropping its check of the field
the one before it.

### A failed key read is read once more

`fix: a provider wait whose key read failed reads the keys once more`:

- **The façade reports a bring-up's own read.** `initializeProviders`
  (`cloud-llm-provider.service.ts:106-130`) returns a `BringUpOutcome`
  (`:24-26`), `{ keyReadFailed }`, from every return, a superseded one
  included. `ProviderKeyService` never rejects a failed read: it answers
  `{}` and sets `loadFailed()`, so the flag is taken as the read lands
  (`:112`), before a later read can change it.
- **The wait retries on that outcome** (`ai-strategy.service.ts:306-333`).
  When the bring-up it waited for is still the current one, the device is
  online, its read failed and this call has had no fresh read, the wait
  starts one more bring-up for the same attempt, installs it as the latest,
  and answers on it, whatever that read finds.
- **One fresh read per call, shared.** Waits on the same failed bring-up
  join the one fresh read. A wait that moved on to a newer bring-up, after
  a reconnect or a save, counts it as its fresh read, whether or not that
  bring-up read the keys itself: a save whose write was refused reads
  nothing, and a bring-up started while the account's read is still out
  joins that read (see *Known gaps*).
- **Never on `loadFailed()`.** Opening Settings → AI reads the keys for the
  page (`ai-settings-page.component.ts:244-245`), which clears the flag and
  arms nothing (see *What was rejected*).
- **Offline, nothing is read again.** The reconnect's bring-up reads the
  keys.
- **A path that reads nothing answers `NOT_READ`** (`:45`),
  `{ keyReadFailed: false }`: a save for an account that has left or a
  session that has ended, an attempt queued behind such a save, a save
  whose hold its account's leaving ended, a bring-up that threw. A save
  whose write was refused answers otherwise (below).

The strategy's *a bring-up whose key read failed* holds seven cases: one
more read and an answer once it is up; one more read after the settings
page's own read has cleared the flag; only one more when every read fails;
one more shared by three waits, whether it fails or not; a later wait's
read of its own after the shared one failed too; and none when the wait
ends offline. The façade spec holds the outcome for a failed read, for a
good read after a failed one, and for a bring-up superseded over the same
failed read. Retrying on the flag instead failed the settings-page case and
five more. Dropping the outcome test failed 0178's four readiness pins and
five saved-key cases; one of the pins first needed a count after its await
to see it (see *Departures from the plan*). Reading the flag before the
read landed failed the façade's three. The provider smoke *reads the keys
once more when the wait ends online after a failed read* refuses the first
secrets read on the emulators and asks for the wait in the same task as the
strategy is built, so the start-up bring-up and the wait's share that one
read. It finds Gemini armed after exactly two reads.

The same commit carries the whole-branch review's fixes to the saved key,
which build on the outcome:

- **A refused save answers with `previous`'s own outcome** (`:815-818`).
  A wait that joined it, as the drain's does after Sync Now's own blur,
  still reads the keys once more when `previous`'s read failed. The page's
  own promise still rejects.
- **A save outlives no session.** The effect's signed-out branch bumps a
  count on every run (`session`, `:162`, bumped at `:226`): at a sign-out,
  and also at the start-up run before auth resolves and at a connectivity
  change while no one is signed in. A save brings up only while the count
  it took is current (`:810`), so nothing after a sign-out, even once the
  same account has signed back in. The new session's own bring-up reads
  the keys, which Firestore's local view shows with the write still out
  laid over them, so nothing is lost. A second bring-up would only
  supersede the one a wait follows (0179's counters), and the wait would
  answer on a bring-up that armed nothing.
- **An attempt queued behind a save brings up only for its own account in
  its own session** (`:259`): the count it took, and the account signed in.
  A switch that reaches the effect as one change moves no count, so with the
  count alone the departed account's queued reconnect read the next
  account's keys and superseded that account's own bring-up.
- **A save's hold on a wait ends when its account leaves** (`saveHold`,
  `:172`). The Firestore SDK keeps a departed account's write until that
  account is current again, so a wait on the write alone sat until then,
  with the drain's entry *processing*. Each save races its outcome against
  the hold current when it starts (`:815-818`). The effect releases that
  hold, and starts the next, on every signed-out run (`:227`) and on a run
  that finds another account signed in than the one the latest save is
  tagged with (`:233`). The wait then answers false, or follows the next account's
  bring-up, and the drain hands the entry back pending with no retry spent.

These add eight cases to *a key saved in settings*, twenty in all:

- a wait on a refused save behind a failed read, reading once more;
- a wait on the sign-back-in bring-up, and a reconnect from the session
  that ended, each answered only once the providers it follows are up, both
  over a façade double that supersedes as 0179's counters do;
- with the write still out, a wait on the save answering false at a
  sign-out, and following the next account's bring-up after a sign-out and
  after a switch that reaches the effect as one change;
- the departed account's queued reconnect bringing nothing up after such a
  switch;
- and a pin: a save made after the start-up run still holds a wait.

The same account signing back in during its own save is now brought up
once, not twice. The processor's describe gains two cases. In *holds the
photo until the providers are up when the account signs back in during a
save it left behind*, before the count, the save's late bring-up
superseded the sign-in's, and the photo went to a bring-up that armed
nothing. *Hands the photo back pending, its retry unspent, when the
account signs out during a save whose write is still out* answers pending
while the write is still out; the write it lands afterwards, with no one
signed in, brings nothing up.

Each was taken out in turn:

- Dropping the save's check of the count failed four cases: the
  sign-back-in case, the wait on its bring-up, the reconnect from the
  session that ended, and the processor's sign-back-in case. Dropping the
  bump failed the same four.
- Dropping the queued attempt's check of the count failed the reconnect
  from the ended session alone. Dropping its check of the account failed
  the queued reconnect after a one-change switch alone.
- Dropping the hold from the save's race failed the three waits across an
  account change and the processor's pending case. Releasing the hold only
  on a switch failed the two sign-out waits and that processor case, and
  releasing it only at a sign-out failed the one-change switch's wait.
- Not starting a new hold after a release failed the pin.
- A refused save answering `NOT_READ` again failed the case that reads once
  more behind it.

### Two entry points go

One removal per commit
([0048](0048-a-dead-capability-is-removed-not-guarded.md)).
`refactor: drop a strategy key setter nothing calls` removes
`AIStrategyService.updateCloudProviderApiKey`, an un-awaited arm outside the
wait. `refactor: drop the AI page's unread Gemini availability` removes the
page's `isGeminiAvailable`, its `GeminiService` inject and the two specs'
doubles for it.

### An unknown category reads in the reader's language

`fix(i18n): an unknown category reads in the reader's language on every
screen` routes five screens through `core/utils/category-display.utils.ts`:

- the spending chart's labels, and its legend with the legend's aria-label
  (`spending-chart.component.ts:86-87`, `:140-142`);
- the Budgets Recurring tab (`recurring-transactions.component.ts:87-89`);
- the import's category chip (`category-suggestion.component.ts:58-60`);
- Category Breakdown's list and Spending Analysis
  (`category-breakdown.component.ts:125`, `spending-analysis.component.ts:429`),
  which now compute the translated name and drop the template's
  `| translate`, so the rule has one copy
  ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)). `t()`
  reads the translations signal, so both computeds still follow a change of
  language.

Each spec maps `common.unknownCategory` to 不明 and fails on the literal.
The two report specs render the real template with a marking stub that
wraps each key in `‹…›`, so a pipe left in place shows as `‹‹…››`. The
walkthrough smoke seeds an expense in a category no catalog holds, larger
than every seeded total, and reads the dashboard legend's key, never
`Unknown`.

`fix(i18n): every export names an unknown category in the reader's
language` changes `ExportService.getCategoryName`
(`export.service.ts:271-273`), which feeds all five exports. The exporter
runs in the reader's locale, so a Japanese reader's files read 不明. The
round trip holds: the importer matches a Category cell by exact name, no
shipped category is named *Unknown*, 不明 or 未知, and such a row
re-imports onto its type's catch-all, counted as unmatched, as *Unknown*
always did. A pin over the shipped catalog holds the three words unmatched
for both types; naming a shipped Japanese category 不明 failed it.

`fix(i18n): an insight names a missing category in the reader's language,
not by its id` gives the insight card (`insight-card.component.ts:187-190`)
and the snapshot comparison (`snapshot-compare.component.ts:103-106`) the
same rule. Both printed the raw id: in the card's sentence and its category
list, and on a moved category's line.

### The gate

`test: fail the build on an English fallback a reader would see` adds a
fifth scan to `scripts/check-i18n.mjs`, as
[0145](0145-a-class-found-by-reading-becomes-a-gate.md) asks of a class
found by reading.

- **What it matches.** A string literal whose whole content is `Unknown` or
  `Other`, case-sensitive (`:555`), in every non-spec file under `src/app`
  but `core/services/testing/` (`:686`), whose fixture names a category
  *Other*. `'Unknown error'`, a key such as `settings.platformUnknown` and
  the receipt prompt's `merchant="Unknown"` default do not match.
- **How it reads a `.ts` file.** Through a regex-aware lexer copied from
  `check-colors.mjs` (`:528-635` there) into `check-i18n.mjs` (`:437-552`),
  so a comment never counts and a division is not read as a regex. The copy
  differs in one place: a string inside a `${…}` substitution is recorded
  (`check-i18n.mjs:511`), so `` `${name ?? 'Unknown'}` ``
  counts. A `.html` file, and an inline `template:` read the way scan 4
  reads one, are matched with HTML comments masked and offsets kept, so a
  reported line is real.
- **Two tables, passed in as a parameter**
  ([0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
  `MODEL_FACING_FALLBACKS` (`:570-589`) holds the three *Other* sites only a
  model reads. `STORED_FALLBACKS` (`:596-627`) holds five rows for the six
  sites that write *Unknown* onto a row as its description or merchant when
  a parse finds none, each with the owner's decision of 2026-10-15 as its
  reason. Two of the six are the same line in `cloud-llm-provider.base.ts`,
  so one row carries `count: 2`.
- **Rows are matched on file and trimmed text, never a line number, and
  tallied.** A hit with no row is an offence. A row whose tally differs from
  its count, either way, is drift and fails, so a row can neither outlive
  its site nor quietly cover a second one.
- **Not a freeze.** 0151 forbids a list that lets a fix wait. Nothing in
  either table is waiting to be fixed, and each row says why its word
  stays.

The run prints *Checked 426 files for an English "Unknown" or "Other"
fallback (8 rows allow 9 hits: 3 model-facing for 3, 5 stored for 6).* The
self-test went from 51 cases to 81. Planting `: 'Unknown'` back into the
spending chart failed the run, naming that file and line. The anchored
match, the inline-template path, the comment mask, the substitution
recording, the regex keywords, the tally and the row key were each mutated
in turn, and each mutation failed a case.

### The filters read All

`fix(ui): a transaction filter's All option shows its own label` sets the
bare `canSelectNullableOptions` on the five selects
(`transaction-filters.component.html:211`, `:221`, `:275`, `:286`, `:298`),
as 0178 did for its four. No `.ts` changes: `emitFilters` already drops
`undefined`, and the select settles on `undefined` whichever microtask
runs first, so no `compareWith` is needed. The same commit widens
`material:check`'s second rule (`check-material-imports.mjs:447`) to an
option bound `[value]="undefined"`, so CI never sees the gate without the
fix. Its cannot-see list drops the undefined option and gains an option
bound to an expression that is undefined without naming it, such as
`[value]="void 0"`. The self-test went from 60 cases to 65, and the live run
reads *Checked 41 mat-select elements across 96 templates (8 offer a null
or undefined option).*

The filters' real-template spec, *a filter's All option*, reads each
trigger's text and whether its label floats: *All* in Type, Category,
Currency and Country with nothing set, in Goal once there is a goal, after
Income and then All, and after Clear all, with a pin that a preset still
reads its own values. The walkthrough smoke opens the panel on
`/transactions`, reads `transactions.all` on the four triggers, and runs the
accessibility pass over the grid in both schemes.

### The refusal asks for a save

`fix(recurring): the resume refusal says to save the edited rule first`
rewords `settings.recurringResumeInvalidFrequency` in place: *Cannot resume:
this rule's schedule cannot advance. Edit the rule, check its interval and
day, and save it first.* ja and tc say the same in each catalog's voice.
The closing *first* is the sibling refusal's, as in *Edit the end date
first.*, because saving leaves the rule paused and a Resume still follows
it. The component spec's catalog cases hold the instruction to save in each
language.

### The probe

`test: the probe pins its repeat bound and a drift on a later run` adds pins
only. The bound is 10; `--repeat 10` and `--repeat 2` parse; `01`, `2.5`
and `1e1` are refused; a Gemini dry-run loop over the small prompts at
`--repeat 2` sends each prompt twice and prints `#2`; and a drift on the
last of two runs is reported as `jp#2`. Six mutations of the bound, the
pattern, the loop and the compare each failed one pin or two, and a bound
of 9 fails the pin on its value. The self-test went from 202 checks to
211.

`fix: the model probe sends the Gemini key in a header, not the URL` sends
Gemini's request to its model's path with the key in `x-goog-api-key`
(`probe.mjs:681-690`), through the injected transport, as the app's SDK
sends it. The redactor's `?key=` rule stays, as a second line. The
self-test now asserts that no request URL carries a query or a key, for
every provider, that Gemini's key is in the header, and that the printed
request shows `x-goog-api-key: <KEY>`: 222 checks. A dry run over the small
prompts printed every Gemini envelope with the header and no `?` in its
URL, and read no key.

### The reference docs

This record's commit, `docs: ADR 0180 and the references the saved key, the
unknown category, the filters and the probe changed`, brings the reference
docs to the code:

- **`receipt-import.md`:** a saved key and the one fresh read in the
  drain's wait, Sync Now's double press, and the rewritten Known gaps;
- **`ai-models.md`:** how a saved key reaches the providers, and the
  probe's check count and header;
- **`i18n.md`:** five scans, a section on the fifth, what the checker still
  cannot see, and the summary table; the root `README.md` with it;
- **`csv-format.md` and `data.md`:** the Category cell in the exporting
  locale, and the data page's own catalog;
- **`recurring.md`:** the refusal's sentence and what to do about it;
- **`performance.md` and `testing.md`:** `material:check`'s second rule
  and its count;
- **`ui-overflow.md`:** the clipped floated label (see *What the browser
  runs found*).

## What was rejected

- **Retrying on `ProviderKeyService.loadFailed()`.** It is one flag for the
  account, not the bring-up's. Opening Settings → AI, the issue's own flow,
  reads the keys for the page and clears it, arming nothing, so a wait that
  asked the flag after a failed bring-up would read it clear and answer on a
  bring-up that holds no key. A bring-up's own outcome cannot be cleared by
  anyone else.
- **Disabling Sync Now while a key save runs.** A key field saves on blur,
  and blur fires on Sync Now's own mousedown, so a button the save disabled
  would swallow the very press the issue is about. The chain makes that
  press safe instead. The button is disabled while a sync runs, which is
  another matter (see *What the browser runs found*).
- **Installing the save once its write lands.** A wait that starts during
  the write would then answer off the bring-up before it, which is the
  defect.
- **Translating the stored words at write time**, as the issue proposed.
  The owner kept them as they are: the word is the row's own data, which
  screens and exports show as stored, as they would a typed one.
- **A freeze of the stored sites.** 0151 forbids one, and nothing there is
  waiting to be fixed. The rows carry counts and reasons instead.
- **Matching the word anywhere in a literal.** `'Unknown error'`, a key
  ending in `Unknown` and the receipt prompt's prose would all hit. Only a
  literal that is the word alone matches.
- **Importing `check-colors.mjs`'s lexer.** That script's module scope loads
  `tailwind.config.js`; the copy keeps each gate runnable on its own.
- **Dropping the filters' *All* option**, the issue's other offer. The owner
  chose *All*, selectable, the shape 0178's four selects took.
- **Sending the probe's Gemini request through the SDK's own fetch.** That
  fetch is internal to the SDK, and the request would leave the transport
  the self-test traps.

## Consequences

- **No rules change, and only the web deploys**
  ([0077](0077-merges-deploy-what-they-changed.md)). One catalog key is
  added, `aiPage.keySaveFailed`, and one value is reworded. No stored shape
  changes.
- **What a reader sees change:**
  - on Settings → AI, a refused key save's own notice, and a press of
    **Sync Now** during a save that no longer spends a retry;
  - an unknown category in the reader's language on the dashboard's chart
    and legend, the Recurring tab, the import's category chip, Category
    Breakdown and Spending Analysis, in the five exports, and on the
    insight card and the snapshot comparison, which showed an id;
  - *All* in the five filters with nothing set;
  - the resume refusal's sentence;
  - and the fixes of the two browser runs (see *What the browser runs
    found*).
- **A key save holds a waiting drain a little longer.** Every blur of a key
  field writes, and then runs a full bring-up after the one in flight, so a
  drain that starts meanwhile waits for both, even when the key did not
  change.
- **A failed key read costs one more read per wait**, online only, shared
  by every wait on the same bring-up.
- **The stored words and the model-facing words stay English**, by the
  owner's decision and as 0178 records; the gate now names each, and fails
  if one moves.
- **The initial bundle.** Measured per input from the build's stats against
  a rebuild of `b8d400ac`, before the whole-branch review's fixes:
  `ai-strategy.service.ts` took 939 bytes, all of them this record's, for
  the saved-key chain and its account tag, the fresh read and its outcome,
  less the setter that went.
  `cloud-llm-provider.service.ts` took 375, shared with 0179's bring-up
  counter; the stats do not split one input by commit. `export.service.ts`
  came to 6 bytes less, but its import of `categoryNameOrUnknown` gave
  `category-display.utils.ts` a second initial importer, so the module was
  cut out of the entry chunk into an initial chunk of its own: 132 bytes and
  a sixtieth initial file, against 90 out of the entry chunk and 33 into the
  exporter's. The warning then moved to 2.411 MB
  ([../performance.md](../performance.md)). After that move, the browser
  run's fix for the clipped label added 156 bytes to the global stylesheet.
  With the first browser run's fixes in, and before the second run's and
  the whole-branch review's, the build measured 2,410,890 bytes
  (JavaScript 2,379,782, stylesheet 31,108), 110 under the warning. The
  second browser run's fixes then brought it to 2,410,982 (JavaScript
  2,379,786, stylesheet 31,196): the button rule added 88 bytes to the
  global stylesheet, and three initial chunks gained 4 bytes between them
  for the names their new content hashes import, which left 18 under the
  warning. The whole-branch review's fixes brought it to 2,411,095
  (JavaScript 2,379,899): the strategy's chunk took 115 bytes for the
  signed-out count and the outcome a refused save keeps, and two other
  chunks came out a byte smaller each. The warning moved to 2.412 MB, the
  whole kilobyte above. The review's second pass brought it to 2,411,435
  (JavaScript 2,380,239, stylesheet 31,196), 565 under that warning: the
  strategy's chunk took 336 bytes more, for a save's hold on a wait and the
  account check on an attempt queued behind a save, and the AI import
  service's chunk 4, though nothing in it changed. performance.md records
  the figure.
- **The first browser run saw it** in the emulator venue on 2026-10-19.
  Journeys 87 (steps 4 and 5) and 88 (steps 1 and 2) passed as regressions
  before the journeys below, and 96 (step 1), 94 (step 1), 83 (its step
  1's bounds on the transaction filters) and 80 (the swap to Sam and back)
  after them.
  - **Journey 99, a key saved while Sync Now drains.** With a scan queued
    and the Gemini field's empty save held, a real press of Sync Now left
    the entry processing, its retries unspent, and a readiness probe
    pending. Once the save was released the entry failed, with one retry
    spent and `AI_CLOUD_UNAVAILABLE`, as a drain with no key does, and its
    card read AIプロバイダー未設定, *No AI provider configured*, with no
    *Cloud* chip. A refused save read *Could not save the API key. Try
    again.*, and its Japanese sentence after a switch.
  - **Journey 98, an unknown category in Japanese.** An expense and a rule
    in a category no catalog holds read 不明 on the dashboard's legend and
    in its aria-label sentence, on the Recurring tab, first in Spending
    Analysis, and in Category Breakdown's list and donut. The detailed,
    summary and category-summary CSVs from Reports carried 不明 for that row
    alone. The data page's own CSV named every row 不明, the second defect
    below. The import's category chip and the insight surfaces were left to
    their specs.
  - **Journey 100, the filters.** In en and ja the five selects read *All*
    and すべて, floated. Income narrowed the list to one row, All brought
    back all eleven, and Clear all read *All* again.
  - **Journey 93, re-run.** The refusal read the new sentence in en and ja.
    After the repair's Save, a new step pressed Resume: *Recurring
    transaction resumed*, the rule active, its pointer unchanged and no row
    posted. The restore after it skipped the out-of-range rule, as before.
  - Journey 97 is 0179's. The pane's resource list held no vendor host.

## What the browser runs found

The first run was in the emulator venue on 2026-10-19, on this branch's
code before this record's commit. It found four defects. Each was fixed in
a commit of its own whose spec failed first, and each fix was re-checked in
the same venue. Three predate this wave: the double press, the data page's
cold catalog and the compact labels' offset. The fourth, the clipped
floated label, was exposed by Part 3.

- **Sync Now pressed twice reported two syncs for one.** A double click
  reached `syncQueue` twice. The second call found the drain running and
  returned at once with nothing synced, and the page raised *Queue synced
  successfully* for it as well; the entry spent one retry only.
  `fix(ui): Sync Now cannot be pressed twice into one sync` adds
  `queueSyncing` (`ai-settings-page.component.ts:131`) to the button's
  `[disabled]` (`.html:465`) and returns early from `syncQueue` while it
  holds (`:463-466`), because a second press can land before the render
  that disables the button, and the service marks itself syncing before its
  first await. The page spec holds both, with a real signal behind its
  double, so one page shows the second press refused and a later one run.
  The re-check's double click made one sync and raised one notice.
- **The data page exported and imported against an empty catalog.** `/data`
  never subscribed to `CategoryService.loadCategories()`, the per-page
  pattern whose absence
  [0176](0176-every-category-list-breaks-a-tie-by-id-over-cent-rounded-totals.md)
  found on the search surfaces, naming `/data` among the pages that load no
  catalog. Opened first, or from such a page, its CSV export read an empty
  signal and named every row's category unknown, 不明 in Japanese and
  *Unknown* before this record, and its CSV import counted every row
  unmatched, bound for its type's catch-all.
  `fix: the data page loads the category catalog its CSV export and import
  read` subscribes in `ngOnInit` and releases it in `ngOnDestroy`
  (`data-management.component.ts:94-100`), as `reports.component.ts:146-161`
  does. The page spec holds the subscription and its release. The CSV
  smoke's *names each row's category in the transactions CSV from the
  catalog the page loads itself* passed on the emulators, and failed with
  the subscription taken out. The re-check read 133 categories on the page;
  its CSV named each row's own category, and the file's re-import matched
  every row.
- **A compact filter field's resting label sat 9 px low.** At 1024 px every
  empty compact field's label, From, To, the two amounts and Tags, sat 9 px
  below the centre of its 40 px box; floated labels were right. The
  stylesheet forced the infix's paddings and height, but an outlined
  field's label sits in the notched outline, a sibling of the infix, which
  Material rests and floats by the form field's own height token.
  `fix(ui): a compact filter field's label rests inside its box` sets
  `--mat-form-field-container-height: 40px` and
  `--mat-form-field-container-vertical-padding: 8px` on the form field
  (`transaction-filters.component.scss:277-285`) and deletes the infix
  override. A real-template case measures a resting label against its box,
  and a pin holds a floated one on the top edge, which the naive fix, the
  label's `top` nudged into place, failed. The re-check, made without
  Clear all, read the two amounts and Tags at rest within 1 px of their
  boxes' centres, at 1024 and at 375 px, while From and To still held the
  month's dates; the second run, after Clear all, read all five there, at
  1280 and at 375 px.
- **A floated select label was cut mid-word.** In the 108 px compact
  selects, floated *Category* and *Currency* read *Categor* and *Currenc*,
  with no ellipsis. Material 22.1.4 caps an outlined select's notch at the
  field's width less 60 px, the room a resting label leaves for the arrow,
  and lifts the cap to less 24 px only under
  `.mdc-text-field--label-floating`, a class its form field no longer sets.
  Part 3 exposed it: every filter now opens floated on *All*, where before
  a label floated only once its filter was set. `fix(ui): a floated select
  label is not cut short by the room kept for its arrow` adds one global
  rule (`styles.scss:119-121`) that gives the notch Material's floated cap
  under `.mdc-notched-outline--notched`, the class the outline does set. A
  floated label sits on the top border, above the arrow, so it cannot
  overlap it, and a resting one keeps its room. A real-template case
  measures both labels whole at 108 px with the fonts pinned, and a pin
  holds a resting label's cap, which taking the outline's class out of the
  selector failed. The re-measure on the served bundle read Category,
  Currency and Country whole; the 328 px selects on Settings were
  unaffected.

The same run swept `/ai`, `/dashboard`, `/reports` and the Recurring tab at
375 px and found no overflow beyond a tag chip clipped inside its own
scrolling strip, by design. It could not drive an account deletion on
`/data`: the deletion asks for a fresh sign-in through a popup the pane
cannot complete (see *Known gaps*).

The second run was in the same venue the same day, on this branch's code
after this record's commit, with the first run's fixes in. Its pane was
hidden but took screenshots. Besides the journeys it swept the pages for
clipped text in English and Japanese and for wrapped text in all three
languages, each detector first validated on a known positive. It found
three more defects and confirmed a fourth that a review of one of their
fixes named, each older than this wave. Each was fixed in a commit of its
own whose spec failed first, and re-measured on the served bundle:

- **A filter date was cut short by its calendar button.** At a 1024 px
  pane the grid's six viewport-keyed tracks left the From and To inputs
  40 px for an 86 px date, and the date was cut at 1280 and at 375 px too,
  so `fix(ui): a filter date is not cut short by its calendar button` sets
  one `auto-fit` list of tracks, each floored at a date's width beside its
  button, and gives the date the end padding Material drops beside an icon
  suffix, which the compact rule had put back.
- **An import preview date broke onto a second line.** The data page's CSV
  preview held each date in a 90 px box, which split 2026年10月17日 before
  its 日 in every row, so `fix(ui): an import preview date stays on one
  line in every language` sizes the box in em, keeps the date on one line,
  and lets the row wrap rather than squeeze its description.
- **A button's wrapped label painted past its outline.** A Material
  text-label button squeezed by a narrow row kept its fixed 40 px while its
  label wrapped above and below the pill, on `/data` (履歴を見る on three
  lines at 375 px) and, the same defect in a second place, on `/ai`'s
  provider and Offline Queue cards, so `fix(ui): a button grows with a
  wrapped label instead of painting past its outline` lets every such
  button grow with its content
  ([../ui-overflow.md](../ui-overflow.md)) and lets those rows wrap.
- **A transaction's date broke in the desktop table.** The date column let
  a Japanese date such as 10月11日 break onto a second line at the Large
  and Extra large font scales, which the review of the preview date's fix
  named as the same defect in a second place, so `fix(ui): a transaction's
  date stays on one line in the desktop table` keeps the date whole and
  lets the table's layout widen its column.

It also found that every datepicker reads the browser's language, not the
account's, a gap in this record's own subject (see *Known gaps*).

## Departures from the issue

- **The fresh read keys on the bring-up's own read**, not on the global
  flag (see *What was rejected*). The issue asked for one fresh bring-up
  after a wait that ends online with a failed read, bounded to one per
  call, and that bound stands.
- **Sync Now stays enabled during a save.** The issue noted that it was not
  disabled while a save ran; it still is not, on purpose.
- **Part 1 is display only.** The issue proposed one translated fallback at
  write time for the words stored on a row. The owner kept them on
  2026-10-15. The gate names them in a table of their own, five rows for six
  sites with a count on each, beside the three model-facing *Other* sites
  the issue already allowed.
- **Wider than the issue's list.** The one export column feeds five
  exports, not one, and the insight card and the snapshot comparison
  printed a raw id, which the issue did not name. All of them take the same
  rule.
- **The sentence says "first".** The issue asked for *edit the rule and
  save it*. The sentence ends *and save it first.*, the sibling refusal's
  idiom, because saving leaves the rule paused.
- **The first-run drift was already pinned.** The issue said the drift
  check pinned the last run and not the first. At the base, the self-test
  held a drift on the first of two runs (`probe.mjs:1528-1534` at
  `b8d400ac`) and none on a later one, so the new pin is the later run.
- **Reading the code added the key-save notice and the two removals**,
  which the issue did not ask for.

## Departures from the plan

- **A readiness pin gained a count.** One of 0178's readiness pins, *starts
  the bring-up itself*, counted bring-ups only before its first await, so
  the mutation that dropped the outcome test passed it. It gained one count
  after the wait.
- **Sign-back-in cases beyond the plan's list.** *brings the account up at
  once when it signs back in during the save it left behind*, and the
  whole-branch review's *answers a wait on the sign-back-in bring-up only
  once it is up* and *brings nothing up behind the save left behind for a
  reconnect from the session that ended*, are the three cases in which the
  sign-out unlink alone bites.
- **Cases across an account change beyond the plan's list.** The
  whole-branch review added the four strategy cases and the processor case
  that hold a save's write past a sign-out or a switch, and the pin on a
  save made after the start-up run.
- **The refused clear is read on the console**, not on `window`'s
  `unhandledrejection` (see below).
- **The gate's walk exclusion is scan 5's alone.** Scans 1 to 4 still read
  `core/services/testing/`, so the key references there still count.
- **One must-not-hit case was reworded.** As planned, a regex-blind lexer
  still found no hit in it (see below).

## Things that only became apparent while building

- **Under zone.js an uncaught rejection never reaches `window`'s
  `unhandledrejection`.** It goes to `console.error` instead, so a case
  listening on `window` passed with the page's `catch` rethrowing. The
  committed case spies on the console and expects only the page's own line.
- **The account tag and the sign-out unlink cover for each other.** When
  another account signs in after a signed-out step, either alone keeps its
  bring-up from queueing behind the departed save. When the switch reaches
  the effect as one change, only the tag does; when the same account signs
  back in during its own save, only the unlink does.
- **A save that outlives a sign-out superseded the next session's
  bring-up.** The whole-branch review found it. A save whose write was
  still out at a sign-out, with the same account signed back in before it
  landed, passed its account check and ran a bring-up of its own. Under
  0179's counters that bring-up superseded the sign-in's, while
  `initialization` still pointed at the sign-in's, so a drain's wait
  answered on a bring-up that armed nothing. The account tag cannot tell
  two sessions of one account apart; the signed-out count can, and an
  attempt queued behind the save takes it too. The write lands in the new
  session because the Firestore SDK keeps a departed account's writes and
  sends them again once that account is current.
- **The count stopped the save's late bring-up, but not its hold on a
  wait.** The whole-branch review's second pass found it. A drain whose
  wait had joined a save whose write was still out at a sign-out sat on the
  save until that account was current again, since the SDK keeps the
  write, and its entry stayed *processing*; another account signing in did
  not release it either. No case had held a wait across an account change:
  each started its wait after the sign-in. And the queued attempt's count
  alone let a one-change switch run the departed account's reconnect for
  the next account.
- **A count taken before the first await cannot see a fresh read.** The
  fresh read starts after the wait resumes, so a case that counts
  bring-ups synchronously passes whether the wait retries or not.
- **The flag has to be taken as the read lands.** Taken before it, a
  bring-up reports the previous read's outcome; taken later, a newer read
  can have changed it. A bring-up superseded right after its read still
  reports its own, which no planned case held until the façade gained one.
- **A key-echo stub cannot see a double translation.** `t(t(name))` and
  `t(name)` read alike under it; a marking stub shows the second pass.
- **A regex-blind lexer can miss a hit by accident.** In `/['"]/; // "Other"`
  the misread quote flips the parity, and the commented word falls outside
  a string either way. The case reads `` /['"]/; // the model's "Other" ``,
  whose apostrophe closes the misread string, so only a lexer that reads
  the regex finds no hit.

## Known gaps

- **A switch that reaches the effect as one change is seen only through
  the save tag.** With no signed-out run between two accounts, the effect
  moves no session count and releases a save's hold only while the latest
  save is the departed account's. So two orders stay open. A save the next
  account makes before the effect runs takes over the tag, and a wait on
  the departed account's held save, with the next account's save behind
  it, stays parked until a sign-out. And after a switch away and straight
  back, the first account's late write brings up once more, which can
  supersede the bring-up its wait follows. No app flow produces a switch
  without a sign-out: the page's own switch passes one, and a foreign
  change reloads the page (ADR 0163), as 0179's *Known gaps* records for
  the provider arms.
- **An offline save holds a wait until the device reconnects.**
  `applyProviderKey` waits for the write's acknowledgement, which offline
  waits for the server. A drain whose wait joined the save does not answer
  until then, or until the account signs out or another account signs in,
  which ends the save's hold at once, and its entry stays processing in the
  meantime. A reload in that window sweeps it back to pending at the next
  launch, at the cost of one retry, as any interrupted drain does (0178's
  *A drain killed during the wait spends a retry*).
- **A key read that fails twice still files *network*.** The fresh read is
  one per wait. When it fails too, the drain goes on with no key, and the
  cloud's refusal is filed *Connection problem*, as 0175 records. And only
  the drain's wait reads again. The effect starts no second bring-up for
  the same attempt, and a search or a scan finds the providers the failed
  bring-up left down, until the account or the connection changes or a
  drain's fresh read arms them. A wait that moved on to a save whose write
  was refused counts that save as its fresh read, though the save read
  nothing; a wait that joined the save reads once more, on the outcome the
  save keeps from the bring-up it waited for. And a bring-up for a new
  connectivity attempt, started while the account's key read is still out,
  joins that read (`ProviderKeyService.resolve` shares one read per
  account), so a wait that moves on to it answers on the same failed read
  without reading again.
- **The stored words stay English.** Six sites write *Unknown* as a row's
  description or merchant when a parse finds none, and a reader sees that
  word in every language, in the list and in the exports, as any stored
  text. The receipt prompt's `merchant="Unknown"` default asks the model
  for the same word, which is then stored as read. Both stay by the owner's
  decision of 2026-10-15; the gate names the six sites, and not the prompt,
  which is prose. Two more stored defaults write *Unknown Merchant* as a
  scanned row's description (`native-receipt.service.ts:224`,
  `receipt-text-parser.ts:182`); they stay by the same decision, and scan 5,
  which reads a literal that is one word alone, does not see them. The
  three model-facing *Other* sites stay too, as 0178 records.
- **The `'User'` name fallbacks stay English.** The dashboard's greeting
  (`dashboard.component.ts:186`) and the settings page's name
  (`settings.component.ts:43`) show *User* in every language for an
  account with no display name, and a new account's profile stores it when
  the sign-in names nobody (`auth.service.ts:60`). Scan 5 knows two words.
  A follow-up is for the owner; no issue is filed yet. *Closed by*
  [0182](0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md):
  a nameless sign-in stores an empty name, every display reads a catalog
  word, and scan 5 knows `User`.
- **A datepicker reads in the browser's language, not the account's.**
  The Material datepicker's date adapter takes its locale once, at boot,
  from the browser's language (the `LOCALE_ID` factory beside
  `provideNativeDateAdapter` in `app.config.ts`), so on a Japanese account
  in an English browser every datepicker formats and parses month-first
  English dates and names its months and weekdays in English. And no
  `MatDatepickerIntl` is provided, so the toggle's name and the calendar's
  tooltips are English in every language. The second browser run found it.
  It is older than this wave and reaches every datepicker in the app, so it
  is out of scope here and left for a follow-up; no issue is filed yet.
  *Closed by*
  [0182](0182-a-control-reads-in-the-accounts-language-and-date-format-and-nothing-re-provides-materials-adapter-or-words.md):
  every picker reads the app's one adapter, which shows and reads the
  account's date format in its language and follows a change of either,
  and its labels come from the catalog.
- **A filter preset that names `null` still shows its field empty.** The
  *All* options are bound to `undefined`, and the select compares with
  `===`, so a preset that carries a filter as `null`, rather than leaving
  it out, matches no option. The gate reads templates, not models, and
  cannot see it.
- **The probe's Gemini request is not yet the app's.** The app's SDK also
  sends `x-goog-api-client`; the probe does not. And the header has been
  proven only offline: until a keyed run goes out, nothing shows the vendor
  taking the key from the probe's header.
- **A second probe still sends the Gemini key in its URL.**
  `docs/merchant-match-probe/probe.mjs:190`, the manual probe of #296,
  sends its key as `?key=` on its embeddings run, the class this record
  fixed in the model probe. It prints no URL, has no npm script and never
  runs in CI; it is left for a follow-up.
- **No gate holds a surface that reads the category catalog without
  loading it.** The data page is the second instance of the class, after
  0176's search history and dialog, and 0145 asks for a gate on a class
  found by reading. None is added, because the class cannot be decided
  cheaply from the source. `CategoryService.categories()` is read inside
  services, the exporter, the import service and the period totals among
  them, and whether a component's view is alive while some subscriber holds
  the catalog open is a fact of the running app, not of any one file. A
  source check would have to follow every service that reads the signal
  back to every component that can reach it, and still could not say whose
  subscription is alive when the read is made. The data page's spec holds
  its own subscription, and the CSV smoke holds its export from it. And a
  page that subscribes still waits for nothing: an
  export or an import started before the listener's first snapshot lands
  reads an empty catalog. That is the start-up window every subscribing
  page shares (0176's *A search made before the catalog's first snapshot
  still sees an empty list*).
- **Account deletion with the data page's listener open was not driven.**
  The deletion re-authenticates through a popup the pane cannot complete.
  The shell already holds live listeners while an account is deleted, so
  the page's categories listener is not a new kind of reader during it:
  inferred, and not observed.
