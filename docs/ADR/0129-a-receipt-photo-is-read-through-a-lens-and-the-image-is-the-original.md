# 129. A receipt photo is read through a lens, and the image is the original

**Status:** Accepted, implemented · **Date:** 2026-09-13 · **Issues:** #157

Reference documentation lives in [../translation-lens.md](../translation-lens.md).

Applies [0095](0095-a-translation-is-a-lens-never-a-write.md) and closes the
gap it left open — "The photo half of #157 is not built."

## Context

0095 shipped one of #157's two halves and said exactly why it stopped:
"Translating a receipt image needs an in-app image viewer first — every
receipt currently opens in a browser tab — and that viewer is the larger part
of the work."

That was the whole obstacle. Before this branch, all three receipt
affordances were `<a target="_blank" rel="noopener">` around the stored
download URL: the transactions table's receipt icon, the edit form's strip
thumbnail, and the image manager's tile. Every one of them handed the reader
to the browser's own image viewer and lost, on the way out, the three things
that make a receipt worth opening — which transaction it belongs to, which of
its images this is, and any way to read a receipt printed in a script the
reader does not have. The mobile row had no door at all: its `receipt_long`
mark is a `<span>`, an indicator rather than a control, so on a phone a
stored photo was reachable only by opening the transaction for editing.

Two further facts shape the decision.

**The image is the evidence, exactly as the note is.** A receipt photo is
addressed by storage slot and removal leaves a tombstone rather than
renumbering ([ADR 0006](0006-multi-image-receipt-storage.md)); the bytes are
what a person would hold up against the row. Whatever a model says the
receipt says is a reading of it, and the moment that reading is written
anywhere the account holds two versions of one fact.

**A photo costs a provider that can see, which is not the same as a provider
being configured.** `hasAnyCloudProvider` says nothing about vision — Gemini
can be configured for text with no vision model at all — so the note lens's
availability test does not transfer.

## Decision

**The photo gets an in-app viewer, the lens hangs under it, and the image on
screen is always the stored original.**

### The viewer is a dialog, not a route

`ReceiptViewerDialogComponent`, opened through the exported
`openReceiptViewer(dialog, data)` rather than by three call sites — serving
five doors between them — each calling `dialog.open`. A route would put a
photo in the browser's history and give the reader a back button that leaves
the list; a dialog opens over the surface that asked for it and returns
there. The function exists so the width — `min(720px, calc(100vw - 32px))`,
wider than the app-wide default because the content is a photograph of
printed text — is decided once instead of three times.

### One image at a time, addressed by its slot

The dialog takes a transaction and an optional slot. A slot is not a
position: a removed image leaves a gap, and a caller can be holding a slot
that has since been cleared, so an unknown slot opens on the first stored
image rather than on nothing. Arrows appear only when the transaction has
more than one, and the counter beside them is `aria-hidden` because the
image's own `alt` already reads *Receipt image 1 of 3*.

`receiptImageSlots(transaction)` is the model helper that enumerates live
images with the slots they live at. It is not new behaviour — the image
manager had this as a private `imagesOf` — but it is now the sanctioned
enumeration beside `receiptImageUrls`, which drops the slots, and the manager
reads it instead of its own copy.

### The lens is a panel under the image, and the image never leaves

The note lens stands its answer **in for** the text it translates: the note
dialog steps its own copy aside, and the way back is labelled *Show
original*. That is the wrong shape here. A photograph is not a paragraph the
translation can replace — the point of reading a receipt in another language
is to look at the paper and the reading at the same time — so the panel sits
below the image, the image stays in the DOM throughout, and the control is
labelled *Hide translation*. There is nothing to restore.

The translated text is `white-space: pre-wrap`. A receipt's line structure is
the content; read as one paragraph it is not the receipt any more.

### The prompt is the note prompt's vision twin

`translateReceiptImage` joins the registry beside `translateNote` under the
same `translation` feature, rendered once in `CloudLLMProviderBase` so all
three providers are covered by construction
([ADR 0005](0005-prompt-registry-and-provider-parity.md)). It takes no image:
like every receipt prompt the photo travels on the vision transport that
attaches it, so the prompt is only the instruction, and it names no languages
for the reason [ADR 0064](0064-the-country-comes-off-the-paper-before-the-phone.md)
gives — the target arrives as the same `languageInstruction` sentence every
user-facing prompt carries.

It shares the note prompt's answer contract exactly — the same
`{ translation, sourceLanguage }` JSON, the same `NoteTranslation { text,
sourceLanguage }` type — and the mapping between the two is now one private
`mapTranslationResponse` that `translateText` and `translateReceiptImage`
both return through, rather than two copies of the same five lines.

That mapping carries 0095's refusal rule, and it is worth being precise about
whose rule it is. **A cut-off answer is refused, never salvaged** — that is
`translateText`'s rule, recorded in 0095, and
[ADR 0066](0066-an-answers-budget-follows-its-question.md) says the opposite
for the receipt extraction paths, which keep the rows that arrived whole
because a row is self-contained. A receipt read *as a document* is not rows:
half a receipt looks exactly like a whole one, and the reader has no way to
tell that the total is missing rather than absent from the paper. Sharing the
mapper is what makes the two translations physically incapable of disagreeing
about it.

### The provider is the account's own, behind a vision gate

The lens sends to `llmProviderPreferences.translation`, the same preference
the note lens uses — but only if that provider can see. Three pieces:

- `hasVisionProvider` — a computed on the façade, true when at least one
  configured provider also takes images. It is what the Translate button's
  enabled state reads.
- `resolveVisionProvider(feature)` — the preferred provider when it can see,
  else the first of the fallback order that can, else null.
- `resolveVision(feature)` — the private resolver behind
  `translateReceiptImage`, throwing *Translating a receipt image needs a
  vision-capable provider* when nothing qualifies.

The fallback order itself stopped being a local constant. It was a
`fallbackOrder` array declared inside `getBestAvailableProvider`; it is now
`PROVIDER_FALLBACK_ORDER`, a static read by one `firstEligibleProvider` that
both resolvers call with their own eligibility predicate. Two routes that
each carried the order would be two orders that drift.

### The cache keys on the slot, not on the image

`ReceiptTranslationService` is the photo half's own service, and its key is

```
{UI locale} \0 {answering provider} \0 {transaction id} \0 {slot}
```

NUL-separated, to match the note service's key rather than invent a second
convention for the same cache. Four fields because any of the four changes
the answer, and the provider is the one that *would answer* rather than the
stored preference — the same reason 0095 gives, now for the vision fallback.
The bytes are not in the key: an image at a slot is immutable in the way a
note is not, since replacing a receipt writes a new slot rather than editing
one.

It is cleared on any change of account, not only on sign-out. A photograph of
a receipt carries at least what a note carries.

`failureKey` delegates to `NoteTranslationService.failureKey` and adds
exactly one case of its own — a failed download, the one failure this lens
can hit that the note lens cannot, answered with
`receiptViewer.failedDownload`. Two lenses, one vocabulary, one switch.

`ai_assist_used` reuses `feature: 'translation'`, counted after the cache
check and before the call, like every other AI feature's event.

### One loader, in a service of its own

Reading a stored receipt back as bytes used to be a private method on
`ReceiptToNoteService`, which is a service about *converting a receipt into a
note and deleting the image* — nothing a viewer wants. It is now
`ReceiptImageService.loadAsDataUrl`, with the Storage-SDK-first ladder and
the CORS trap that forced it intact, and `ReceiptToNoteService` delegates.

`ReceiptToNoteService` keeps its own `RECEIPT_TO_NOTE_DOWNLOAD_FAILED`
constant and translates the new service's failure into it, rather than
leaking a second error identity into a call site that has been classifying
the old one for months.

### Five doors, one function

Every receipt affordance in the app now opens the viewer:

| Door | Was | Is |
|---|---|---|
| The transactions table's receipt icon | An anchor to the download URL | A `<button>`, propagation stopped so the row does not also open |
| *View receipt* in the desktop row's ⋮ menu | Did not exist | Opens the viewer |
| *View receipt* in the mobile row's overflow menu | Did not exist | Opens the viewer — the phone's first door to a receipt |
| The edit form's strip thumbnail | An anchor | A `<button>`, opening on that thumbnail's own slot |
| The image manager's tile | An anchor | A `<button>`, opening on that tile's own slot |

The viewer itself keeps *Open in new tab*, so the full-size image is still
one press away and the browser's zoom is still reachable. That link is the
only `target="_blank"` left anywhere near a receipt: every other one in the
app is a location maps chip or a provider's key page in Settings.

### What was rejected

- **A route for the viewer.** `/transactions/:id/receipt/:slot` reads well
  and costs a history entry per photo, a back button that leaves the list,
  and a second place that has to load a transaction by id. Nothing about
  reading a receipt wants to be linkable — the photo is private to the
  account and the URL would not survive being shared anyway.
- **Sharing one lens component with the note.** The two have genuinely
  different contracts: the note lens owns a two-way `showingTranslation` its
  host reacts to, resets on every edit of the text it was handed, and moves
  focus as it swaps a paragraph for its translation. This one resets per
  image, never hides anything, and has arrows in its focus graph. One
  component serving both would be a component with two modes, which is the
  shape that rots.
- **An overlay on the photo.** Text laid over the image is unreadable on a
  receipt — a photograph of thermal paper is exactly the background that
  defeats it — and an OCR-positioned overlay is a different feature with a
  different answer shape.
- **Caching by image bytes.** Hashing a data URL to key the cache buys
  nothing: the slot already identifies the image, and the hash would cost a
  download before the cache could be consulted, which is most of what the
  cache exists to avoid.
- **A dedicated OCR pass before the translation.** The app has a Vision OCR
  plugin on iOS, and feeding its text to the text prompt would have saved the
  vision transport. It also throws away the layout the model reads the
  receipt *with*, and it is iOS-only, so the web build would need the vision
  path regardless.

## Consequences

- **`docs/analytics.md` gained a Source entry.**
  `receipt-translation.service.ts` sends `ai_assist_used`, and
  `npm run analytics:check` reads that column — a service-only change that
  fails a gate no spec in the same task runs. It was caught by the next
  task's gate run, not by the review of the change that caused it.
- **The `translation` feature legend now covers both**: "a note or receipt
  photo read back in the UI language — neither the note nor the image is ever
  sent here".
- **Eight new `receiptViewer.*` keys in all three catalogs**, plus
  `transactions.viewReceipt` — which already existed as the icon's tooltip —
  reused as the label in both menus.
- **28 unit cases on the dialog, 12 on the service**, and three emulator
  cases: the desktop door, the phone door, and the lens leaving the stored
  document byte-identical.
- **The image manager's `imagesOf` is gone**, replaced by the model helper.
- **The anchor-to-button swap cost no styling.** Each of the three
  stylesheets first grew the same four-line UA reset — padding, border,
  background, cursor — and all three came back out: Tailwind's preflight
  already strips exactly those. What each door kept is the layout the link
  had, which preflight does not supply.

## Departures from the issues

- **The image is never replaced, so there is no *Show original*.** #157 is
  written as one feature across a note and a photo, and the note half's
  wording carried into the plan. The photo half cannot borrow it: the
  original is on screen the whole time, and a button offering to restore what
  never left would be a lie about what pressing it does. The control says
  *Hide translation*.
- **The viewer is more of the work than the lens was.** 0095 predicted this
  and it held: the dialog, the slot arithmetic, the four doors and the loader
  extraction are the branch; the prompt and the service are the small part.
- **Focus management was not in the plan.** The review found focus abandoned
  on `<body>` on four paths inside a modal — Translate → spinner, Retry →
  spinner, Hide → Translate, and an arrow that disables itself at either end
  of the strip. The note lens's `focusWhenRendered` was copied verbatim,
  including its two guards: nothing is registered on a destroyed injector
  (NG0911 —
  [ADR 0090](0090-a-render-callback-is-registered-only-while-the-view-can-run-it.md)),
  and focus is only moved when it was actually abandoned, so a pointer user's
  caret is never yanked.

## Things that only became apparent while building

- **An end arrow disables itself, and the browser drops focus from a control
  that becomes disabled.** Pressing *Previous* onto the first image removes
  the very control that was pressed, and the remaining arrow is the only
  thing left to take the focus. That is why the focus target on an arrow is
  the *other* arrow, not the one pressed.
- **A smoke spec cannot configure the TestBed in `beforeAll`.** The viewer's
  emulator spec uploads one real image once and opens the dialog three times,
  which reads as a `beforeAll`. It is green alone and fails after any earlier
  spec in the run has instantiated the test module — "Cannot configure the
  test module when the test module has already been instantiated" — and its
  `afterAll` then wedged the browser, so six later specs did not execute at
  all. The one-time upload now runs through a plain `Injector.create` with no
  TestBed in it, and each case calls `resetTestingModule` before configuring.
  A spec that passes alone and fails in the suite is the whole reason the
  suite is run whole.
- **A fake blob will not do for the upload.** `createImageBitmap` refuses
  one, and the upload path runs it, so the fixture is a genuinely decodable
  1×1 PNG from a base64 literal.
- **The no-provider hint had to be reworded to match its sibling.** It said
  "AI settings"; the note lens's says "Settings → AI Processing", which is
  the path the screen actually shows. Two hints about the same missing key,
  in three catalogs, naming two different places.

## Known gaps

- **No zoom and no pan.** The image is capped at `60dvh` and scrolls inside
  the dialog's content area; reading small print still means *Open in new
  tab* and the browser's own zoom. A gesture layer is a feature of its own.
- **No OCR overlay, so the translation is prose beside a photo.** Matching a
  translated line to the line it came from is the reader's job.
- **A translation is per slot, so a five-image receipt costs five calls.**
  Each photo is a separate request and a separate cache entry. Nothing
  stitches a receipt photographed in halves back together.
- **On a phone the list has one door, and it is behind a menu.** The receipt
  icon button lives in the table layout, which starts at `min-width: 768px`;
  the mobile row's receipt mark is an indicator, not a control. A tap on the
  mark itself does what a tap anywhere on the row does.
- **Two vision paths resolve differently.** `translateReceiptImage` falls
  back to any configured provider that can see; `extractStatementTransactions`
  resolves the configured provider first and then refuses if it cannot see,
  so a statement fails where a receipt translation would have fallen back.
  The two now share a message shape and not a resolver.
- **The cache is per session and per tab**, as 0095's is, and a reload pays
  again. That is the price of writing nothing.
