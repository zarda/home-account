# 95. A translation is a lens, never a write

**Status:** Accepted, implemented · **Date:** 2026-09-02 · **Issues:** #157

Reference documentation lives in [../translation-lens.md](../translation-lens.md).

## Context

A receipt's note is stored in the script it was printed in, deliberately.
[ADR 0008](0008-universal-receipt-language-support.md) is the rule: every
extraction prompt reproduces the body exactly as printed rather than
translating it, because a translated extraction throws the evidence away and
nothing downstream can tell that it happened. The consequence is the one #157
opened on — a trip abroad fills the ledger with notes the account holder
cannot read, and the only surface showing a note at all was a tooltip on an
icon, which is not a place to read three lines and is unreachable from a
phone.

So the feature is not "translate the notes". It is "read this one, now",
against a record that must not move. Two facts shape everything below.

**The stored note is the evidence.** Whatever is shown beside it is a view of
it, and the moment a translation is persisted the account holds two versions
of one fact with nothing saying which is the original. Search, export, backup,
the CSV contract and every future reader would then have to choose.

**The app already talks to three providers, and each costs the user a key.**
The question is not whether a translation service exists — several do — but
whether this feature is worth another credential in Settings, another failure
mode, and another vendor holding a person's receipt notes.

## Decision

**A translation is produced on demand, shown beside the note, and written
nowhere.** No field on `Transaction`, no migration, nothing in the backup or
the CSV. The answer lives in the lens component and in an in-memory session
cache; a reload loses both, which is the correct lifetime for a view.

**The backend is the user's own configured providers, through a fifth prompt
feature.** `translateNote` joins the registry beside receipt scanning,
categorization, insights and search, rendered once in `CloudLLMProviderBase`
so provider parity and `npm run prompts:check` cover Gemini, OpenAI and Claude
by construction ([ADR 0005](0005-prompt-registry-and-provider-parity.md),
[ADR 0025](0025-provider-variation-lives-in-the-transport-seam.md)). A
provider preference of its own — `llmProviderPreferences.translation` — so an
account with three keys can send its notes to the one it trusts with them.

**The prompt names no languages.** The target arrives as the same
`languageInstruction` sentence every other user-facing prompt already carries.
A hand-written list of source or target languages would be a ceiling on the
app's own locales and one more thing to extend by hand — written as quoted
tags, that is exactly what `prompts:check` fails on; spelled out as prose
instead, it would pass the check and fail only on review, the other guard
([ADR 0064](0064-the-country-comes-off-the-paper-before-the-phone.md) is the
same rule for countries). The answer comes back as JSON,
`{ translation, sourceLanguage }`, so the marker above the panel can name the
source language *in the language the reader is reading* — "Translated from
Japanese" under an English UI, not from a tag the app would have to map.

**A cut-off answer is a failure, never a partial translation.** A truncated
response, or one whose `translation` is missing or blank, throws
`AI_ANSWER_INCOMPLETE`. This is the one place where reading an answer as far
as it goes ([ADR 0066](0066-an-answers-budget-follows-its-question.md)) is the
wrong instinct: half a note reads exactly like a whole one, and the reader has
no way to tell that the third line is missing. The failure is named in the
copy — "came back cut short" — so a retry is the obvious next move.

**A blank note never reaches a provider.** A model handed nothing to translate
answers with prose rather than the JSON the prompt asked for, which the error
parser then classes as a cut-short answer: a spent request reported as a
failure the note never caused.

**The cache keys on the note, the locale, and the provider that will actually
answer.** `resolveProvider('translation')`, not the stored preference: the
façade falls back gemini → openai → claude when the preferred provider has no
key, so keying on the preference would serve Gemini's answer under a switch to
OpenAI that never happened. It is cleared on any change of account, not only
on sign-out — notes are the most personal text in the app, and a shared device
must never show one account's note under another's session.

**The lens is one component, used from three doors.** The transactions list
(the row's notes icon, and *View note* in both the desktop and the mobile
action menus) opens a read-only note dialog carrying the lens; the edit form
carries it beneath the note field, fed by a signal the note control's
`valueChanges` writes. The same behaviour in each is the point: the lens owns
the request, the failure, the focus moves and the reset, and reports back only
whether its answer is currently standing in for the note, so a host that draws
the note itself can step aside while it is.

Its accessibility contract is part of the decision rather than a detail. The
arrived panel is `role="status"`, so the translation is announced without
stealing focus. Focus does move on each press, because each press removes the
control that was pressed: Translate is replaced by the panel, so focus lands
on **Show original**; Show original removes the panel, so focus goes back to
**Translate**. Without that a keyboard reader is dropped on `<body>` and has
to walk the whole surface again to get back to the note they were reading.

**A monotonic request token, not the note text, decides which answer is
current.** In the form the note is edited while a request is running, routinely
— including back to text an in-flight request also asked about, which makes
the text useless as an identity. Every request and every reset bumps the token;
an answer whose token has moved lands as a no-op.

**The reset fires on an actual note change, never on the first pass.** The
effect's first run happens on the first change-detection pass, and resetting
there would discard a `showingTranslation` the host bound before it ever ran.

**`ai_assist_used` gains `feature: 'translation'`, counted on real calls
only** — after the cache check, before the request, like every other AI
feature's event. A second look at a note the session already translated costs
nothing and is recorded as nothing.

Rejected: **a dedicated translation API.** Google Cloud Translation is the
obvious answer and is better at exactly this job, but it is a fourth
credential to obtain, store, encrypt and revoke, for a feature that reads one
paragraph on demand; it is text-only, so the photo half of #157 would need
something else again; and it puts receipt notes in front of a vendor the user
did not choose for their financial data. The registry's fifth feature reuses
the keys, the encryption, the error taxonomy, the parity check and the
provider preferences that already exist.

Rejected: **persisting the translation.** A `noteTranslation` field would have
to be invalidated when the note is edited, carried through backup, restore and
CSV, and reconciled with whatever locale it was produced for. It also changes
what the account stores about a person from what they wrote to what a model
said they wrote.

Rejected: **translating at extraction time.** That is the thing #143 forbade
and ADR 0008 records. The receipt's own script is the evidence, and an
extraction that translates cannot be checked against the paper.

Rejected: **a marker naming the source language from a language tag.** The
model already knows what it read; asking it to name the language in the target
language is one field on an answer that was being parsed anyway, and it avoids
shipping a tag-to-name table that would be a language list by another route.

## Consequences

- **The new service is `NoteTranslationService`, not `TranslationService`.**
  That name belongs to the i18n resolver, which has nothing to do with user
  data ([i18n.md](../i18n.md)). The two are neighbours in `core/services` and
  the collision is worth stating once rather than discovering in a merge.
- The note dialog is read-only on purpose. Editing a note stays in the
  transaction form, which owns validation and saving; a second editable copy
  of one field is a second way for the two to disagree.
- Failures classify through the shared `parseAIError` into five copy keys —
  bad key, rate limit, no connection, cut short, and one honest sentence for
  everything else. No new error taxonomy.
- The lens renders nothing at all for a blank note, so every host can place it
  unconditionally instead of guarding.
- With no provider configured the button is shown and disabled, with a hint
  naming where a key goes. A control that vanishes teaches nobody that the
  feature exists.

## Departures from the issues

- **#157 asked for two halves; this ships one.** The note half is complete;
  the photo half is not built. Translating a receipt image needs an in-app
  image viewer first — every receipt currently opens in a browser tab — and
  that viewer is the larger part of the work. The issue stays open.

## Things that only became apparent while building

- **The dialog has to hide its own copy of the note.** Stacking the
  translation under the original leaves two versions of the same text on a
  phone-sized dialog and no clear answer to which one is being read. The lens
  therefore reports `showingTranslation` outward as a two-way binding, and the
  host decides what to do about it — the form keeps its field visible, because
  a form field that disappears while a panel is open is a worse surprise.
- **`afterNextRender` is the only moment the replacement button exists.** Both
  focus moves target a control that is created in the same tick the old one is
  destroyed, and the registration has to be skipped when the view is already
  gone: the form's lens sits inside a dialog the user can close mid-request,
  and registering on a destroyed injector throws NG0911
  ([ADR 0090](0090-a-render-callback-is-registered-only-while-the-view-can-run-it.md)).

## Known gaps

- **The disabled Translate button drops out of the tab order**, so the hint
  explaining why it is disabled is reached only by linear browsing rather than
  by tabbing to the control it belongs to.
- **The error branch leaves focus on the body.** Both success directions move
  focus deliberately; the failure path replaces the button with an alert and a
  retry and moves nothing.
- **Editing away and back spends two calls.** The reset orphans the first
  request rather than cancelling it — nothing here can cancel a request in
  flight — so a second Translate on the restored text is a second billed
  answer for the same note.
- **The cache is per session and per tab.** Two tabs on the same account each
  pay for the first look at the same note, and a reload pays again. That is
  the price of writing nothing.
- **The photo half of #157 is not built.** See above.
