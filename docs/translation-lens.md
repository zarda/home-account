# The translation lens

A note saved with a transaction, and a receipt photo stored against one, can
each be read back in the app's own language, on demand. Neither record
changes: what appears is a **view** of it, and it is gone when the page
reloads.

This exists because the app keeps what it was given in the script it was given
in. A photographed receipt is stored as it was photographed, and a note taken
off one reproduces the body exactly as printed rather than translating it,
because a translated extraction throws the evidence away and nothing
downstream can tell that it happened
([ADR 0008](ADR/0008-universal-receipt-language-support.md)). The cost is a
trip abroad that fills the ledger with notes and photographs their owner
cannot read, and this is what pays it back.

Why nothing is persisted, why the app's own providers answer rather than a
translation API, and what was rejected on the way, is in
[ADR 0095](ADR/0095-a-translation-is-a-lens-never-a-write.md). Why the photo
needed a viewer before it could have a lens, and why its panel never replaces
the image, is in
[ADR 0129](ADR/0129-a-receipt-photo-is-read-through-a-lens-and-the-image-is-the-original.md).
This document is the part you need when using either one, working out why a
translation did or did not arrive, or changing them.

`TranslationService` is **not** this. That is the i18n resolver, which turns a
dotted key into a UI string and has nothing to do with user data
([i18n.md](i18n.md)). This is `NoteTranslationService` and
`ReceiptTranslationService`, and all three are neighbours in `core/services`.

## Two surfaces

| Surface | Where it lives | Service | Prompt |
|---|---|---|---|
| A stored note | `<app-note-translation>`, placed in three hosts | `NoteTranslationService` | `translateNote` |
| A stored receipt photo | the receipt viewer dialog | `ReceiptTranslationService` | `translateReceiptImage` |

They share the answer shape, the failure vocabulary, the analytics event, the
provider preference and the rule that a cut-off answer is refused. They are
**not** one component — see
[Changing the lens](#changing-the-lens) for why, and for what you have to
change twice.

Everything down to *What is never written* is the note. The photo starts at
[The receipt photo](#the-receipt-photo).

## Where the note's controls are

| Door | Where | What it opens |
|---|---|---|
| The note icon | A transactions row that has a note, labelled *View note* | The note dialog, with the lens under the note |
| *View note* | Both action menus — the desktop row's ⋮ and the mobile row's overflow | The same dialog |
| Beneath the note field | The transaction form, under the note textarea | The lens, on whatever is currently typed |

The list swaps to the table layout at `min-width: 768px`, so the standalone
icon button is a desktop door; on a phone the note is reached through the row's
overflow menu. Both land on the same dialog.

The lens itself is one component used in all three places, so it behaves
identically in each. It renders **nothing at all** for a blank note, which is
what lets each host place it unconditionally rather than guarding.

**The dialog steps its own copy of the note aside while a translation is
showing.** Two copies of the same paragraph on a phone-sized dialog leave no
clear answer to which one is being read. The form does the opposite on purpose
— its note field stays visible, because a form field that vanishes while a
panel is open is a worse surprise.

**In the form, the lens follows the field.** The note control's `valueChanges`
feeds a signal, so typing a character into a translated note resets the panel:
a translation of text that no longer exists must not be left standing beside
the edited note.

## What is sent, and when

Only on a press, and only ever the note itself.

- **The whole note**, as stored, in one request to the `translateNote` prompt.
- **To the `translation` provider** — Settings → AI Processing → Provider
  Preferences → **Note Translation**. If that provider has no key the façade
  falls back gemini → openai → claude, like every other feature.
- **Nothing else.** No description, amount, date, category, tag or id. The
  prompt takes the note text and the language instruction and nothing more.

The target language is the app's current UI language, named by the same
`languageInstruction` sentence every user-facing prompt carries — the prompt
names no languages of its own, for the reason in
[prompts.md](prompts.md#do-not-enumerate-what-the-model-already-knows).

The answer is JSON: the translation, and the source language **named in the
target language**, so an English reader sees "Japanese" rather than a tag or
`日本語`.

`ai_assist_used` records `feature: 'translation'` for a request actually
issued — after the cache check, never for a cache hit
([analytics.md](analytics.md)).

## The cache

One `Map`, in the service, in memory. It is what makes flipping between a note
and its translation worth offering: a note re-read after collapsing it, or the
same receipt reopened from the list, costs one request for the session rather
than one per look.

The key is three things, any of which changes the answer:

```
{UI locale} \0 {answering provider} \0 {the note text}
```

**The answering provider, not the preference.** The façade falls back when the
preferred provider has no key, so keying on the preference would serve
Gemini's answer under a switch to OpenAI that never happened. NUL-separated
because a note may contain anything a keyboard can type.

It is emptied on **any change of account**, not only on sign-out: notes are
the most personal text in the app, and a shared device must never show one
account's note under another's session.

It never holds a failure. A rate limit or a dropped connection says nothing
about the note, and the retry the screen offers has to be able to reach a
provider.

The cache is per session and per tab, so a reload pays again and two tabs each
pay once. That is the price of writing nothing.

## The marker, and the way back

An arrived translation renders as a panel: a marker line — *Translated from
{language}* — the translated text, and a **Show original** button. The panel
is `role="status"`, so it is announced without stealing focus.

Focus does move on each press, because each press removes the control that was
pressed. Translate is replaced by the panel, so focus lands on Show original;
Show original removes the panel, so focus goes back to Translate. Without it a
keyboard reader is dropped on `<body>` and has to walk the whole surface again
to get back to the note they were reading.

Re-showing costs nothing — the answer is still in the component — which is
what makes flipping back and forth reasonable.

## When it fails

Five classes, through the shared `parseAIError`. Only the failures a reader can
act on get their own wording; everything else is one honest sentence.

| Failure | Key | What it says |
|---|---|---|
| Bad or rejected API key | `noteTranslation.failedKey` | Names Settings → AI Processing |
| Rate limited | `noteTranslation.failedRateLimited` | Try again in a minute |
| No connection | `noteTranslation.failedOffline` | Check the network |
| The answer came back cut short | `noteTranslation.failedIncomplete` | Try again |
| Anything else | `noteTranslation.failed` | Could not translate this note |

**A cut-off answer is a failure, not a partial translation.** A truncated
response, or one whose `translation` is missing or blank, is refused. Half a
note reads exactly like a whole one and the reader has no way to tell the
third line is missing — so this is the one place the app does *not* read an
answer as far as it goes
([ADR 0066](ADR/0066-an-answers-budget-follows-its-question.md)).

**With no provider configured** the Translate button is shown and disabled,
with a hint naming where a key goes. A control that vanishes teaches nobody
that the feature exists.

**A blank note never reaches a provider.** A model handed nothing to translate
answers with prose rather than JSON, which the parser then classes as a
cut-short answer — a spent request reported as a failure the note never
caused.

**An answer for a note that has since changed is dropped.** Every request and
every reset bumps a token, and an answer whose token has moved lands as a
no-op. The note text cannot serve as that identity: editing away and back asks
the same question twice, and in the form it happens routinely.

## What is never written

Nothing. There is no field, no migration, no cache on disk.

- Not on the transaction — `Transaction.note` is untouched, and so are
  `receiptUrl` and `receiptUrls`. The stored image is downloaded, sent and
  forgotten; nothing is ever uploaded back over it.
- Not in the JSON backup or the CSV export
  ([backup-restore.md](backup-restore.md), [csv-format.md](csv-format.md)).
- Not in `localStorage` or IndexedDB.
- Not in an insight snapshot, which never stores model prose in any case
  ([insights.md](insights.md)).

The translation lives in the component and in the session cache, and both are
gone on reload. Nothing in account deletion has to sweep it.

## The receipt photo

The second surface. A stored receipt opens **in the app**, and the reading
hangs underneath it.

### The viewer

`ReceiptViewerDialogComponent`, opened through the exported
`openReceiptViewer(dialog, { transaction, slot })` — never `dialog.open`
directly, so the width is decided in one place. It is a dialog rather than a
route: a photo does not belong in the browser's history, and closing it
returns to whatever asked for it.

- **One image at a time**, addressed by its storage **slot**. A slot is not a
  position — a removed image leaves a tombstone rather than renumbering
  ([ADR 0006](ADR/0006-multi-image-receipt-storage.md)) — and a caller holding
  a slot that has since been cleared opens on the transaction's first stored
  image instead of on nothing.
- **Arrows only when there is more than one**, with a counter between them
  that is `aria-hidden`: the image's own `alt` already reads
  *Receipt image 1 of 3*.
  Moving between images clears the panel, the error and the spinner — each
  photo is its own question.
- **The image is capped at `60dvh`** and the rest is a scroll away inside the
  dialog. *Open in new tab* is still in the actions row, which is where zoom
  lives: the viewer has none.

`receiptImageSlots(transaction)` is the model helper that lists live images
with their slots. Use it rather than walking `receiptUrls`, which carries
positional tombstones.

### The doors

| Door | Where | Opens on |
|---|---|---|
| The receipt icon | A transactions **table** row, with the image count as a badge | The transaction's first stored image |
| *View receipt* | Both action menus — the desktop row's ⋮ and the mobile row's overflow | The first stored image |
| A thumbnail in the receipt strip | The transaction form, under the receipt controls | That thumbnail's own slot |
| A tile | The receipt image manager | That tile's own slot |

The table starts at `min-width: 768px`, so the icon is a desktop door. On a
phone the row's receipt mark is an **indicator**, not a control: the door
there is *View receipt* in the overflow menu.

### What is sent, and when

Only on a press, and only ever the image.

- **The bytes of one stored image**, downloaded through
  `ReceiptImageService.loadAsDataUrl` and sent as a data URL on the vision
  transport. The prompt itself carries no image — it is the instruction that
  travels with one.
- **Nothing else.** No description, amount, date, category, tag, id or note.
- The same target-language sentence every user-facing prompt carries, and the
  same `{ translation, sourceLanguage }` answer the note prompt asks for.

### The provider has to be able to see

This is the one thing the note lens does not have to check. A configured
provider is not necessarily a vision-capable one — Gemini can be configured
for text with no vision model — so three seams sit in front of the call:

- `hasVisionProvider` — true when at least one configured provider takes
  images. The Translate button reads it: with nothing that can see, the button
  is **shown and disabled** with a hint naming Settings → AI Processing.
- `resolveVisionProvider('translation')` — the `translation` preference when
  it can see, else the first of `gemini → openai → claude` that can, else
  null. The same fallback order every resolver in the façade uses, from one
  shared helper.
- `translateReceiptImage` throws *Translating a receipt image needs a
  vision-capable provider* when nothing qualifies.

### The cache

The same idea as the note's, keyed on the image rather than the text:

```
{UI locale} \0 {answering provider} \0 {transaction id} \0 {slot}
```

The **answering** provider, for the same reason the note cache uses it — the
vision fallback means the preference is not necessarily who replies. The slot
is in the key because one transaction can hold several photos, each a
different receipt to read. The bytes are not: replacing a receipt writes a new
slot rather than editing one.

Emptied on any change of account, like the note cache. A photograph of a
receipt carries at least what a note carries.

### The panel, and the focus rule

An arrived translation renders below the image: the marker *Translated from
{language}*, the text as `pre-wrap` so the receipt's lines stay lines, and a
**Hide translation** button. `role="status"`, so it is announced without
stealing focus.

The image never goes away, which is why the control says *Hide translation*
and not *Show original* — there is nothing to restore.

Focus moves on each press, because each press removes the control that was
pressed: Translate → the spinner, so focus lands on Hide translation when the
answer arrives (or on Retry when it fails); Hide translation → back to
Translate; an arrow pressed at either end of the strip disables itself, so
focus goes to the other arrow. It is only moved when it was actually
abandoned — on `<body>`, or still inside the dialog — so a pointer user's
caret stays where they put it.

### When it fails

The five classes in the table above, plus one this lens can hit and the note
lens cannot:

| Failure | Key | What it says |
|---|---|---|
| The image could not be downloaded | `receiptViewer.failedDownload` | Suggests opening it in a new tab instead |

`ReceiptTranslationService.failureKey` answers that one and delegates every
other to `NoteTranslationService.failureKey`, so the two lenses classify a
model failure through one switch rather than two that can drift. A failed
download is usually a storage bucket without CORS configuration
([storage-cors-setup.md](storage-cors-setup.md)).

## Changing the lens

- **Both prompts live in
  `src/app/core/prompts/translation.prompts.ts`** — `renderTranslateNote` and
  `renderTranslateReceiptImage` — and both are rendered once in
  `CloudLLMProviderBase`, so all three providers are covered by construction.
  `npm run prompts:check` fails on a language list written as quoted tags;
  spelled out as prose it would pass the check, and review is the other guard.
- **The answer is mapped in one place.** `mapTranslationResponse` in the base
  turns a provider response into `NoteTranslation` for both, and it is where
  the refusal lives: a truncated answer, or one whose `translation` is missing
  or blank, throws rather than returning half a reading. Change it and you
  change both lenses, which is the point.
- New user-facing copy goes in all three catalogs — `noteTranslation.*` for
  the note, `receiptViewer.*` for the photo ([i18n.md](i18n.md)).
- **A new note door** means placing `<app-note-translation>` and deciding
  whether the host hides its own copy of the note — that is what the two-way
  `showingTranslation` is for.
- **A new receipt door** means calling `openReceiptViewer` with the
  transaction and, where the door knows one, the slot it was pressed on.
  Gate it on the transaction actually having an image; the viewer's
  empty-state guard is defensive, not a path a door should take.
- The two lenses are deliberately separate components. The note lens stands
  its answer in for the text and reports `showingTranslation` outward; this
  one adds a panel beside an image that never moves, and resets per image
  rather than per edit. One component serving both would be a component with
  two modes.
