# The browser journey protocol

A small set of journeys driven by hand through the running app, in a browser
tab at `http://localhost:4200`. Each names its steps, the result that counts
as a pass, and the screenshot to take. This is the runbook: read it before
driving them for a branch, and extend it when a branch adds a surface no spec
can reach.

It is not a test suite and it does not run in CI. Why these checks are written
down and driven rather than automated, and what was rejected on the way, is in
[ADR 0098](ADR/0098-the-browser-journeys-are-a-driven-protocol-not-a-suite.md).

## Where it runs, and what that means

`npm start` (`ng serve`, port 4200) serves **whatever checkout it was started
from**, built with that checkout's `.vscode/environment.ts`. On a developer
machine that file names the real `home-accounter` project, and the browser
carries the developer's own signed-in session.

So the protocol runs against **production data**. The rows on screen are real
transactions, a preference change lands on the real user document behind the
deployed rules, and a translation is a real request to a real provider under
the account's own key.

That is the point of it — nothing else in the repo exercises the wire — and it
is the reason for every constraint below. Read the whole thing as one rule:
**the run is a reader with exactly three permitted writes, and it puts all
three back.**

The seeded alternative is [`docs/ui-audit/tools/`](ui-audit/tools/), which
renders a demo account against the emulators and is the right instrument for
pixel evidence across pages, widths and themes. It has no real session, no
provider key and no deployed rules, so it cannot answer anything the journeys
below ask. What the emulator suite itself cannot see is in
[emulator-blind-spots.md](emulator-blind-spots.md).

## Before every run

Three checks. The first two are mandatory, and neither is theoretical: the dev
server serves the checkout it was started from rather than the branch you have
in mind, and the same browser is also used against seeded demo projects. Skip
either and the run is green against the wrong app.

**1. The server is serving the branch under test.** The dev server serves the
checkout it was started from — usually the main one, on whatever branch that
happens to be:

```bash
lsof -a -p $(pgrep -f 'ng serve' | head -1) -d cwd
```

Then confirm the *served bundle* carries the branch's code, by looking for
something the branch added rather than trusting the checkout. For the note
translation and weekly recap surfaces that is the note button on a
Transactions row and the weekly-recap switch in Settings → Profile; for
another branch it is whatever that branch added. A stale `.angular/cache`, or
a server started before the checkout switched, shows yesterday's app with
today's confidence.

**2. The running bundle names the expected project.** Fetch every script the
page actually loaded and read the project id out of it:

```js
const ids = new Set();
for (const entry of performance.getEntriesByType('resource')) {
  if (!entry.name.endsWith('.js')) continue;
  const body = await fetch(entry.name).then(r => r.text());
  const matches = body.matchAll(/projectId:\s*['"]([^'"]+)['"]/g);
  for (const m of matches) ids.add(m[1]);
}
[...ids];
```

Expect exactly `["home-accounter"]`. A demo project id, or none at all, means
the tab is not showing what you think it is — in either direction, and a demo
screen read as production is the more expensive mistake. Restart the server
rather than reading on.

**3. Judge the console by the difference, not by its contents.** The
share-target service worker re-registers on every web boot
(`ShareIntakeService.init`), and the browser keeps console entries across
reloads, so a clean boot does not look like an empty console. Count
`error`-level entries before a reload and after it; only the new ones count.

A 404 on a `.js` chunk is almost always stale — a request from a build that is
no longer served. Prove that rather than chasing it: nothing currently served
should reference the chunk.

```js
const chunk = 'chunk-XXXXXXXX.js';  // the name from the 404
const sources = ['/index.html', ...performance.getEntriesByType('resource')
  .map(e => e.name).filter(n => n.endsWith('.js'))];
const hits = [];
for (const url of sources) {
  const body = await fetch(url).then(r => r.text());
  if (body.includes(chunk)) hits.push(url);
}
hits;  // empty ⇒ stale; anything listed ⇒ a real missing chunk, fix the build
```

## Panes and viewports

Some browsers are driven inside an embedded pane rather than a full window,
and a pane behaves differently enough to cost a run before it is understood.
None of these is a property of the app; all four have produced a false
failure.

- **Pointer input can stall under viewport emulation, and stay stalled.** With
  an emulated width in force, clicks stop landing and go on not landing until
  the page is reloaded. So run the phone journey at the pane's **own** width
  when it is already narrow enough, and reload before concluding that a
  control does nothing.
- **A screenshot can freeze under a scaled emulation** — the image that comes
  back is the one from before the last interaction, which reads exactly like a
  control that did nothing. Confirm against the page's text, not the picture.
- **A desktop-only door needs a pane genuinely wide enough for the table.**
  The list swaps to the table at `min-width: 768px`, so below that the row's
  note icon does not exist and journey 2 silently becomes journey 4.
- **A network log may record same-origin requests only.** A provider call goes
  to a third-party host and can be missing from the log entirely, so its
  absence proves nothing. The translated text on screen is the proof the
  provider answered.

The console's own quirk is check 3 above: entries persist across reloads, so
only the difference counts.

## What a run may touch

Three writes are authorised. Each is put back before the run ends, and the
restore is *confirmed on screen*, not assumed.

| Action | What it writes | How it is put back |
|---|---|---|
| Translating a note | Nothing. A provider call under the account's own key; the answer lives in the component and the service's in-memory cache, and both are gone on reload | Nothing to undo |
| The weekly-recap switch | `preferences.enableWeeklyRecap` on the user document | Switched off at the end, and the dashboard checked to confirm the card is gone |
| The Note Translation provider select | `preferences.llmProviderPreferences.translation` | Set back to the value it held, then reloaded and read back |

Everything else is read-only. Every dialog is closed or **cancelled** — the
edit dialog in journey 5 opens on a real transaction and is left by Cancel,
never Save — and nothing is created, edited, deleted or imported.

**Clear the recap's device state at the end**, from the page console:

```js
Object.keys(localStorage)
  .filter(k => k.startsWith('home-account.recap.'))
  .forEach(k => localStorage.removeItem(k));
```

Those are `home-account.recap.dismissed.<uid>` and
`home-account.recap.narrative.<uid>`. Both are per browser profile rather than
per account document, so they are not undone by switching the preference off:
a dismissal left behind opens the user's next real week already dismissed, and
a narrative left cached serves them the write-up this run paid for.

## The journeys

| # | Journey | What only a real browser can show | Screenshots |
|---|---|---|---|
| 1 | Boot | The app starting against a real session | `01-boot.png` |
| 2 | Note lens, desktop, from the icon | The real prompt reaching the real provider and coming back parsed | `02-note-dialog.png`, `02-translating.png`, `02-translated.png`, `02-restored.png` |
| 3 | The same note from the menu | The session cache surviving a second opening of the dialog | `03-cached.png` |
| 4 | Note lens, phone | The Material overlay stack at 390px | `04-note-dialog-phone.png` |
| 5 | The lens in the edit form | The router crossing from list to form, and the lens resetting under a live control | `05-form-lens.png`, `05-form-translated.png`, `05-form-reset.png` |
| 6 | Weekly recap | A real preference write, and the card reading real last-week rows through the deployed rules | `06-recap-desktop.png`, `06-recap-phone.png` |
| 7 | Translation provider select | The preference surviving a reload as a real document read | `07-provider-select.png` |

Screenshot names are the journey number and what is on screen; a re-run
overwrites rather than accumulating.

### 1. Boot

Open `http://localhost:4200`. The dashboard renders signed in, with real
figures rather than a loading state that never resolves. Reload once.

**Pass:** no new `error`-level console entries across the reload, counted as
described above.

### 2. Note lens, desktop, from the icon

Desktop width — at least 1024px. The list swaps to the table at
`min-width: 768px`, so anything wider is safe and a narrower window silently
runs journey 4 instead.

Transactions → a row whose note is in a script the app's current language does
not read → the note button on that row (the notes icon, labelled *View note*)
→ the note dialog: the transaction's description as a subtitle, the note at
full length, line breaks intact → **Translate**.

**Pass:** the spinner appears, then the panel: the marker reading *Translated
from …* with the source language named, a translation that keeps every line of
the original, and the original itself hidden — the dialog steps its own copy
aside while the lens is showing a translation, rather than stacking two copies
of the same text. **Show original** puts it back and removes the panel.

Four shots, in that order: the dialog before, the spinner, the translation,
the original restored. The spinner is the one that has to be caught live.

### 3. The same note from the menu

The same row's actions menu (⋮) → **View note** → the same dialog → Translate.

**Pass:** the translation appears immediately, with no spinner. The service
caches by note text for the session, so the second ask costs nothing. A
spinner here means the cache is not being hit and the account is paying twice
for the same answer.

### 4. Note lens, phone

A 390px-wide viewport (device emulation, or a window narrowed to 390 CSS
pixels). Below `min-width: 768px` the table is replaced by the mobile row
list, and the note is reached through the row's trailing overflow menu →
**View note**. Prefer a genuinely narrow window to emulation where the choice
exists — see [Panes and viewports](#panes-and-viewports).

**Pass:** the dialog fits — with it open, in the console:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth;
```

`true`. A long unbroken note in a foreign script is the case that has pushed
dialogs wide before, so use one.

### 5. The lens in the edit form

Desktop. Click the row itself → the edit dialog → the lens sits beneath the
note field → Translate → the panel appears. Now append one character to the
note.

**Pass:** the panel resets to the Translate button. The lens watches the note
it was handed, and a translation of text that no longer exists must not be
left standing beside the edited note.

Three shots: the lens under the note field, the panel after Translate, the
panel reset after the edit.

Leave by **Cancel**. Never Save: the note has been altered by this journey, and
saving would write the run's stray character to a real transaction.

### 6. Weekly recap

Settings → Profile → **Weekly recap**, between the bill reminders and the
usage statistics → switch on.

**Pass, in order:**

- No permission prompt appears. On the web the card needs nothing from the
  operating system; the Monday nudge is a notification, and notifications are
  the installed app's business ([reminders.md](reminders.md)).
- Dashboard: the card sits directly under the budget alert banner, showing
  last week's spend, the change against the week before, up to three leading
  categories, the budgets line and the bills line — and the narrative
  paragraph when a provider key exists and the account's grounding level is
  not `off`. The card is whole without the narrative; a missing paragraph is
  not a failure ([rag-insights.md](rag-insights.md)).
- Close the card (×) → it goes → reload → it stays gone. The dismissal is
  device-local and keyed by the recapped week's Monday.
- Settings → switch off → Dashboard → no card.

**Precondition:** the card only appears when last week had something to say —
at least one transaction in it, or spend in the week before. On a genuinely
quiet week nothing renders and the journey proves nothing; run it on a week
with data, or record it as skipped and say why.

Take the card at desktop and at 390px.

### 7. Translation provider select

Settings → **AI Processing** (`/ai`) → the **Provider Preferences** card → the
fifth select, **Note Translation**. Choose another configured provider →
reload → the choice is still there → set it back → reload → confirm the
original value.

**Precondition:** the Provider Preferences card only renders when more than
one provider is configured. With a single key there is nothing to choose and
the journey is skipped rather than faked.

## Evidence

Screenshots go to a scratch folder **outside the repo**, named as above, and
are attached to the pull request. **None are committed.** That is the same
rule the screenshot harness follows: only curated evidence lands under
`docs/ui-audit/`. A protocol run's shots are evidence for one review, not a
reference for the next branch, and committing them would add a folder of
screenshots to the repository for every branch that ever runs it.

## What belongs in a spec instead

If a step is checking logic — a figure, a rules verdict, a storage key, a
plural form, a week boundary — it is a unit or smoke spec. Those are cheaper,
repeatable, and they run in CI, where a journey never will.

The protocol keeps only what needs a real browser, a real session and real
data:

- the router crossing from list to dialog to form, with the real overlay stack
  on top of it;
- layout at phone width, where a Material dialog either fits or does not;
- the wire — a real prompt, a real key, a real answer parsed by the real
  client;
- a real preference write landing on the real user document, read back through
  the deployed rules.

A journey that could be a spec should be deleted from here and written as one.

## When it runs

Twice per branch.

**Once as soon as the surfaces exist**, before the rest of the branch is built
on top of them. Defects found then are fixed in the commit that owns the
surface, which is much cheaper than a fix layered on afterwards.

**Once on the final tree**, for the evidence attached to the pull request. The
second run is also the one that must end with every restore confirmed and the
recap's `localStorage` keys cleared — that is the state the user's browser is
left in.
