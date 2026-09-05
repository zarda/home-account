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
Transactions row and the weekly-recap switch in Settings → Profile; for the
import review corrections it is the date button and the *keep it?* question
chip on a scanned row's review card; for another branch it is whatever that
branch added. A stale `.angular/cache`, or a server started before the
checkout switched, shows yesterday's app with today's confidence.

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
None of these is a property of the app; four of the five have produced a
false failure, and the fifth stops a run before it starts.

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
- **A pane may have no way to open a file.** The import journeys start by
  handing the wizard a receipt, and a pane with no file picker cannot open
  one — the dropzone's own click leads nowhere. Hand the file to the
  dropzone's hidden input from the page console instead; the recipe is under
  [Fixtures](#fixtures). Where the browser can open a file directly, do that
  on the same input.

The console's own quirk is check 3 above: entries persist across reloads, so
only the difference counts.

## What a run may touch

Three writes are authorised. Each is put back before the run ends, and the
restore is *confirmed on screen*, not assumed. A fourth action writes nothing
at all and is listed with them because it still costs the account a real
provider call.

| Action | What it writes | How it is put back |
|---|---|---|
| Translating a note | Nothing. A provider call under the account's own key; the answer lives in the component and the service's in-memory cache, and both are gone on reload | Nothing to undo |
| The weekly-recap switch | `preferences.enableWeeklyRecap` on the user document | Switched off at the end, and the dashboard checked to confirm the card is gone |
| The Note Translation provider select | `preferences.llmProviderPreferences.translation` | Set back to the value it held, then reloaded and read back |
| Scanning a receipt | One provider call under the account's own key, and — when analytics consent is on — one `receipt_import` analytics event with outcome `ok` at extraction; no document | Nothing to undo — the run leaves before Import |

The failed-attempt record is written only by the attempt's `failed` and the
import's own record only by `confirmImport`, so an extraction left
unconfirmed leaves nothing behind — which is why the import journeys end by
reading Import History and the Transactions list and finding them unchanged.

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

## Fixtures

The import journeys need a receipt, and a real one carries a real merchant, a
real card and a real day. The repo renders its own instead:

```bash
node docs/model-probe/render.mjs
```

One PNG per case lands in `docs/model-probe/receipts/`. They are derived and
gitignored (`docs/model-probe/.gitignore`), so none of them is ever
committed; the markup they come from is. Rendering borrows the Chromium the
screenshot harness already installed under `docs/ui-audit/tools`, so the
folder needs nothing of its own.

The journeys below use `receipts/jp.png`: a Japanese convenience-store
receipt printed **2026年8月14日**, total **¥538**. A past day read confidently
and graded high is exactly the case nothing flagged before this branch — the
row arrives dated August 14th, sure of itself, and used to be imported that
way without a word. `cropped.png` is the second case when one is wanted: the
same long receipt cut off mid-item, with no printed total, so the amount is
summed from the items and stamped with the review grade that fires the amount
flag.

`jp.png` prints its shop's address, so its row carries a location of its own;
the country-only chip needs a receipt with no address on it and does not
appear in this run.

**Feeding the dropzone.** The wizard needs a `File` on the dropzone's hidden
input. Two ways to put one there, both from the page console.

Serve the PNG over HTTP from a scratch folder outside the repo and fetch it —
this is what the first run used, and it is the better one. Any static server
will do provided it answers the dev origin with CORS (`Access-Control-Allow-
Origin`); a plain `python3 -m http.server` does not, so give it the header or
use a server that does.

```js
const blob = await (await fetch('http://127.0.0.1:8123/jp.png')).blob();
const file = new File([blob], 'jp.png', { type: 'image/png' });
const dt = new DataTransfer(); dt.items.add(file);
const input = document.querySelector('app-file-dropzone input[type=file]');
input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
```

Or paste the bytes, with `B64` from `base64 -i docs/model-probe/receipts/jp.png`
and `Uint8Array.from(atob(B64), c => c.charCodeAt(0))` in place of the blob.
It needs no server and it is the fallback rather than the default: a
megabyte-scale literal is slow through a console and can be truncated without
saying so.

Either way the dropzone reads `input.files` on `change`
(`FileDropzoneComponent.onFileSelect`), and `.png` is among the wizard's
accepted types, so this is the same path the file picker takes. Where the
browser can open a file directly, use it on that same input. Nothing here
writes to the repo — the fixture is gitignored and the scratch copy lives
outside it.

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
| 8 | Review: a receipt dated before today | A real receipt read by the real provider, and the date question that holds Continue | `08-date-question.png`, `08-date-kept.png`, `08-date-picker.png` |
| 9 | Review: inline corrections | The card's editors under a real pointer, and the duplicate re-check a correction fires | `09-inline-edits.png` |
| 10 | Review at phone width | The review card at 390px with a question standing and an editor open | `10-review-phone.png` |

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

### 8. Review: a receipt dated before today

Open the wizard: the Add menu's **Import photos**, or `/import/file` typed in.
The route is a child of the layout route, a page of its own — `/ai` is the
sibling settings page, not a parent of it.

Feed `jp.png` to the dropzone as [Fixtures](#fixtures) describes → *What are
these images?* appears with **Receipts** already chosen (a statement would
keep one row per line instead of collapsing the receipt into one transaction)
→ **Process with AI** → the processing step runs against the real provider →
**Continue** → Review.

**Pass:** the row's date button is amber, reading *Aug 14, 2026* — the date in
the app's own language — with the warning glyph in place of the calendar one
and no caret: it opens a modal picker and says so on `aria-haspopup="dialog"`,
while the currency chip beside it is the one that wears a caret for its menu.
The question chip *Dated Aug 14, 2026 — keep it?* sits in the card's extras,
bordered amber; hover the flag or the chip's Keep half and the reason reads
*This receipt is dated Aug 14, 2026, not today. A wrong day files it where you
will not see it — keep it, or pick another day.* Below the card the hint
*Check 1 date before continuing* stands where Continue is disabled.

Tap **Keep**: the chip goes, the date button turns green and swaps the glyph
for a check, its name now leading with *Date checked*, the hint goes, and
Continue enables. The header's **Keep all dates** answers every row still
asked in one tap; it is there only while a question is, so on a single
receipt it leaves with the first Keep.

On a re-run, take the picker first: the chip's calendar button — and the date
button itself — opens the touch picker on August 2026 with the 14th active.
Pick today: the button reads today's date, checked, and the question is
settled the same way Keep settles it, because a picked day and a kept day
clear the same marks.

Three shots: the question standing, the row after Keep, the picker open.

The confirm step has a *Dates to check* card for the same count, but it is
reachable only through the camera hand-off's non-linear stepper. A run that
starts at the dropzone never sees it, and its absence is not a failure.

**When the provider is down.** This has already happened once: the model
answered 503 twice across every feature, and the wizard classified it
correctly — the error-server card, *Service Unavailable*, the
temporary-unavailability copy, Try Again and Back. That is an upstream
outage, not a branch defect, and it blocks the journey rather than failing it.

The rest of the journey can still be driven without the wire, by handing the
wizard a result through the camera hand-off door it already reads on entry
(`history.replaceState` with the hand-off state, then reload) — the same door
the smoke spec uses, driving the real card in a real browser. Everything below
the extraction was proved that way on the first run: the button, the question
chip, the hint, both disabled states, the seeded picker, Keep, and the
editors.

What that substitute does **not** prove is the one thing only this journey
can: a real prompt, a real key, a real answer parsed by the real client, and a
real receipt's date arriving on the card. Record the run as blocked, and
re-run journey 8 in full on the final pass, when the model answers.

### 9. Review: inline corrections

The same review, on the same row. Every editor here is a trigger that swaps
itself for an input and swaps back on the way out, so nothing is committed by
the act of opening one.

- **The amount.** Tap it → the field opens with the caret already in it and
  the sign left outside, where the type toggle owns it → type `540` → Enter →
  the row reads *-¥540*, an amount flag beside it is gone (a hand-typed
  figure settles the reading), and focus is back on the amount trigger, which
  now names the new value. Escape leaves the figure alone.
- **The description.** Tap it → edit → Enter. An emptied field is a reviewer
  starting over, not a row that reads as nothing: it closes and changes
  nothing.
- **The category.** The chip beside the currency opens the category menu →
  pick another → the chip's icon, name and confidence dot all follow the
  choice, the dot going green because the reviewer's own pick is the confident
  one.
- **Notes.** The **Notes** button under the card opens a textarea with the
  caret in it; type, then click away — the note is filed on the way out, not
  keystroke by keystroke.

An edit to the date, amount, type or description sends that row back through
the duplicate check. A verdict of *Duplicate* deselects the row and the
badge's × (*Not a duplicate — import it*) overrules it; a re-check that cannot
reach history says so once, in a snackbar — *Couldn't re-check for duplicates
— the earlier verdict stands.* Neither is guaranteed with a one-receipt
fixture against a real account: they are what to recognise if they appear, not
part of the pass.

Leave by the review step's **Back**, then the wizard's own back arrow to
Transactions. The processing step behind the review offers Continue and
nothing else once it has succeeded, so the stepper's header is the only way
further back — and neither route imports anything.

**Pass:** every correction shows on the card, and nothing reached the account
— Transactions is unchanged and `/import/history` has no new run. Import is
never pressed.

One shot: the card carrying the corrections.

### 10. Review at phone width

390px, or the pane's own width where it is already narrower — see
[Panes and viewports](#panes-and-viewports). The same review, with the
question chip standing and an editor open.

**Pass:** nothing spills sideways. With the editor open, in the console:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth;
```

`true`. At phone width the date and currency chips do not share a line — they
stack one per line, as observed at 375px, and the type toggle wraps with them.
That is the meta row wrapping as it is built to, not a failure; no threshold
for it is pinned anywhere, so do not read one off a single run. The chips and
the editors keep their 40px tap targets at every width.

One shot: the review card, question chip and open editor together.

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
