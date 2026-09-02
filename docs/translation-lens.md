# The note translation lens

A note saved with a transaction can be read back in the app's own language, on
demand. The stored note never changes: what appears is a **view** of it, and
it is gone when the page reloads.

This exists because notes are deliberately stored in the script they were
printed in. Every receipt extraction prompt reproduces the body exactly as
printed rather than translating it, because a translated extraction throws the
evidence away and nothing downstream can tell that it happened
([ADR 0008](ADR/0008-universal-receipt-language-support.md)). The cost is a
trip abroad that fills the ledger with notes their owner cannot read, and this
is what pays it back.

Why nothing is persisted, why the app's own providers answer rather than a
translation API, and what was rejected on the way, is in
[ADR 0095](ADR/0095-a-translation-is-a-lens-never-a-write.md). This document is
the part you need when using it, working out why a translation did or did not
arrive, or changing the lens.

`TranslationService` is **not** this. That is the i18n resolver, which turns a
dotted key into a UI string and has nothing to do with user data
([i18n.md](i18n.md)). This is `NoteTranslationService`, and the two are
neighbours in `core/services`.

## Where the controls are

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

- Not on the transaction — `Transaction.note` is untouched.
- Not in the JSON backup or the CSV export
  ([backup-restore.md](backup-restore.md), [csv-format.md](csv-format.md)).
- Not in `localStorage` or IndexedDB.
- Not in an insight snapshot, which never stores model prose in any case
  ([insights.md](insights.md)).

The translation lives in the component and in the session cache, and both are
gone on reload. Nothing in account deletion has to sweep it.

## The photo half

Not built. #157 asked for two lenses — a note and a receipt image — and this
is the note one.

Translating a receipt photo needs somewhere to show it first: receipt images
have no in-app viewer at all today, and every one opens in a browser tab. That
viewer is the larger part of the work, and the issue stays open for it.

## Changing the lens

- The prompt lives in `src/app/core/prompts/translation.prompts.ts` and is
  rendered once in `CloudLLMProviderBase`, so all three providers are covered
  by construction. `npm run prompts:check` fails on a language list written as
  quoted tags; spelled out as prose it would pass the check, and review is the
  other guard.
- New user-facing copy goes in all three catalogs under `noteTranslation.*`
  ([i18n.md](i18n.md)).
- A new door means placing `<app-note-translation>` and deciding whether the
  host hides its own copy of the note — that is what the two-way
  `showingTranslation` is for.
