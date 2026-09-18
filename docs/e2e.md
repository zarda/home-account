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
**the run is a reader with exactly four permitted writes, and it puts all
four back.**

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
chip on a scanned row's review card; for the tag, location and added-row
controls it is **Add tag** in a scanned row's extras and **Add a row** under
the list; for the split, merge and worker-reminder surfaces it is **Split**
in a scanned row's extras — **Merge into…** stands beside it only once a
second filled row shares the currency, so on a one-receipt review it shows
after journey 15's split — and a `notificationclick` listener in the served
worker: `await fetch('/share-target-sw.js').then(r => r.text())` contains
`notificationclick`. The worker is served straight from `public/`, so that
fetch reads the branch's file whether or not the page has re-registered it.
For the row-removal and phone-width chip surfaces it is **Remove** in a
scanned row's extras and the category chip's own stylesheet:
`getComputedStyle(document.querySelector('.category-button')).minInlineSize === '0px'`,
where the flat `min-width: auto` it replaced reads `auto`. For the import
honesty surfaces it is the dropzone's fourth file-type chip, the backup icon
beside the word **JSON**, and the list its hidden input enforces:
`document.querySelector('app-file-dropzone input[type=file]').accept` ends in
`.json`, where `1c0f3d2`'s ends in `.webp`. For the phone-width caret and
per-currency total surfaces it is any review card's category chip, where the
caret now follows the name:
`document.querySelector('.category-button .mdc-button__label + .dropdown-icon') !== null`
is `true` on this branch and `false` on `2c35002`, where the caret projects
through the leading slot instead. For the processing-signal and rate-rung
surfaces it is the served catalog and the Settings line:
`(await fetch('/assets/i18n/en.json').then(r => r.json())).settings.ratesLabel`
is defined on this branch and `undefined` on `0139d46`, and
`document.querySelector('app-rate-status') !== null` with Settings →
Preferences open, where the line sits under the base-currency select. For
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

Some browsers are driven inside an embedded pane rather than a full
window, and a pane behaves differently enough to cost a run before it is
understood. None of these is a property of the app bar the ninth, which
is the app's own timing; eight of the eleven have produced a false failure,
the ninth cost a run a second provider call, the tenth stops a run
before it starts, and the last is a door nothing in a pane opens — its
only control on the page is a switch with a write behind it.

- **Pointer input can stall under viewport emulation, and stay stalled.** With
  an emulated width in force, clicks stop landing and go on not landing until
  the page is reloaded. So run the phone journey at the pane's **own** width
  when it is already narrow enough, and reload before concluding that a
  control does nothing.
- **A screenshot can freeze under a scaled emulation** — the image that comes
  back is the one from before the last interaction, which reads exactly like a
  control that did nothing. Confirm against the page's text, not the picture.
- **A hidden pane stops painting, and the app's render scheduler with it.**
  Angular schedules a render on `requestAnimationFrame` raced against a
  timer, and a pane the host is not showing throttles both, so a click lands
  in the model while the view lags behind it — a control that did nothing,
  read from a screenshot that never updated, and focus that never arrived.
  Front the pane before reading anything off it. Where it cannot be fronted,
  `ng.applyChanges(ng.getComponent(document.querySelector('app-import-wizard')))`
  after each action renders what the model already holds — state only, so it
  proves nothing about what the app would have painted — and everything
  `afterNextRender` does, focus above all, is left to the specs that pin it.
  An overlay's position and its close animation cannot be judged without
  frames either: the merge menu reported a negative left and stayed in the
  DOM until closed through its trigger, an artefact of the pane and not a
  finding.
- **A hidden pane delivers no ResizeObserver callbacks either.** `appFitText`
  re-measures a label when the box around it changes, through an observer the
  browser runs with its frames — and a pane the host is not showing runs
  none, so after a style or width change the label sits overflowing its box
  with no font-size written, which reads exactly like the directive failing.
  Flush the registry by script, the way the overflow probe does —
  `const d = ng.getDirectives(label).find(x => x.overflowRatio);
  d.registry.markDirty(d); d.registry.flush();` — and read the font-size
  after: state only, diagnostic-grade, as the render flush above is; a
  fronted pane does this on its own. A card born after the last flush — a
  split's part, a row added by hand — has a label no flush has reached, and
  it reads as the same overflow until it gets one of its own. The pane's
  390px emulation also raises the root font to 20.8px, so a label reads
  18.2px where a phone reads 14 — the fit is what is pinned, never the
  number.
- **A desktop-only door needs a pane genuinely wide enough for the table.**
  The list swaps to the table at `min-width: 768px`, so below that the row's
  note icon does not exist and journey 2 silently becomes journey 4.
- **A network log may record same-origin requests only.** A provider call goes
  to a third-party host and can be missing from the log entirely, so its
  absence proves nothing. The translated text on screen is the proof the
  provider answered.
- **A pane's Escape key reaches no dialog.** The key tool's Escape lands
  somewhere the CDK overlay's own keydown handler never sees: the receipt
  viewer and the note dialog both stay open with focus inside and nothing in
  the console, which reads exactly like a dialog that has stopped honouring
  Escape. The app honours it — a synthetic `keydown` (`key: 'Escape'`,
  `keyCode: 27`) dispatched on the open dialog closes it, which is how this
  was settled — so close dialogs through their own Close or Cancel control,
  which every journey does anyway, and never conclude an Escape defect from a
  pane.

  Two things about a key the run constructs itself, since the same trick is
  what drives the tab strips. The pane's Chromium leaves `keyCode` at 0 on a
  `new KeyboardEvent(...)` unless it is passed explicitly, and code still
  reading `keyCode` sees nothing. And Material's tab header listens for
  keydown on the **label container**, not on the header element — so an arrow
  key dispatched on the header, or on the group, reaches no key manager and
  reads exactly like a strip that ignores the keyboard. Dispatch from the
  focused tab.
- **A pane clears viewport emulation between turns.** A width set for a phone
  journey is gone by the next turn, and any measurement that crosses that
  boundary describes a layout that no longer exists — one run read a
  zero-size box before the image had loaded and came back to find the dialog
  apparently gone, which is the pane's reset and not the app. Set the width
  and take every measurement of it inside one turn. The app is not upset by
  the change either way: an open viewer watched through a mobile→desktop swap
  stayed open while the table re-rendered underneath it.
- **The wizard's back arrow navigates asynchronously.** The click returns
  before the route has changed, so a file handed to the dropzone's input in
  the same breath goes to the wizard the run thought it had left and joins
  that batch. In run 1 that cost a second real provider call on the account —
  the one thing *What a run may touch* exists to account for. Read
  `location.pathname` and wait for it to change before handing the next file
  over.
- **A pane may have no way to open a file.** The import journeys start by
  handing the wizard a receipt, and a pane with no file picker cannot open
  one — the dropzone's own click leads nowhere. Hand the file to the
  dropzone's hidden input from the page console instead; the recipe is under
  [Fixtures](#fixtures). Where the browser can open a file directly, do that
  on the same input. Every file the journeys use goes in that way — the
  receipt, the CSV and, since the picker started taking it, the `.json`
  backup — so what a run drives is the door a pick would have opened.
- **A notification is raised by script.** The one control that leads to a
  web notification is the reminders switch in Settings → Profile, and the
  click that turns it on asks the operating system for permission, writes
  `preferences.enableReminders` on the user document and sweeps — raising
  whatever is due and logging it as delivered in this browser's storage.
  None of that is the run's to do for the sake of one notification, so
  journey 14 calls the reminder service's own web seam from the console,
  the way the file door above is already fed from one:

  ```js
  ng.getComponent(document.querySelector('app-reminder-settings')).reminders
    .showWebNotification('Home Account', 'Journey 14', 'e2e-14');
  ```

  `ng` is the development build's own debug global — a server started on the
  production configuration has none. `reminders` is the component's injected
  service and the seam is `protected` — TypeScript's words, which the running
  page does not enforce, so both are reachable without either being public.
  The seam is what the sweep itself calls, so the evidence is the wire the
  sweep uses: the registration's `showNotification` call, the notification
  the operating system shows, and the permission state the pane reports. It
  never asks for permission — that request is the switch's — and the switch
  is never touched.

The console's own quirk is check 3 above: entries persist across reloads, so
only the difference counts.

## What a run may touch

Five writes are authorised — four on the account, one on the device only.
Each is put back before the run ends, and the restore is *confirmed on
screen*, not assumed. The other six rows write nothing at all and are listed
with them anyway: four still cost the account a real provider call, one not
even that, and the last leaves a notification standing in the operating
system rather than anything on the account — what an import journey or a
raised notification leaves behind is worth stating rather than leaving to be
inferred.

| Action | What it writes | How it is put back |
|---|---|---|
| Translating a note | Nothing. A provider call under the account's own key; the answer lives in the component and the service's in-memory cache, and both are gone on reload | Nothing to undo |
| Translating a receipt photo | Nothing. One provider call under the account's own key, the answer in the component and the service's in-memory cache; the stored image is downloaded and read, never rewritten, and the transaction is untouched | Nothing to undo |
| The weekly-recap switch | `preferences.enableWeeklyRecap` on the user document | Switched off at the end, and the dashboard checked to confirm the card is gone |
| The Note Translation provider select | `preferences.llmProviderPreferences.translation` | Set back to the value it held, then reloaded and read back |
| The dashboard layout editor | `preferences.dashboardLayout` | Reset, then reloaded and read back absent |
| A purchase split in the form | Three transaction documents — a remainder row and two parts, sharing one `splitGroupId` and one `createdAt` — where an unsplit add would have written one | Each of the three deleted through the list, and a search for the journey's own description confirmed to return none |
| Seeding, ageing or clearing the rate cache, and re-entering the ladder over a failing fetch (journey 19, **only on the user's explicit word**) | Nothing on the account. `localStorage['home-account.exchangeRates']` on this browser profile — the same key whether the run seeds a fresh stamp, ages it past the twelve-hour window or removes it — and one extra provider fetch on the next boot when the key is cleared. The re-entry adds no request of its own: it runs under a `window.fetch` wrapper that rejects `open.er-api.com` and passes everything else to the real one, and both the wrapper and the theme classes it reads the warning colour under live on the page only | The value read before the change is written back verbatim, `window.fetch` and the root element's classes restored to what was kept, the page reloaded — which drops the wrapper with the page — and the Settings line read again to confirm the rung it reports is the one it reported at the start |
| Scanning a receipt | One provider call under the account's own key, and — when analytics consent is on — one `receipt_import` analytics event with outcome `ok` at extraction; no document | Nothing to undo — the run leaves before Import |
| Handing the wizard a backup file | Nothing. The parse is local and `checkDuplicates` only reads history; the rows sit on the review step | Nothing to undo — the run leaves before Import |
| Handing the wizard a CSV | One grounded categorization call under the account's own key, covering in one batch every description the category memory does not know — the CSV door climbs the same ladder the image doors do — and a tag-suggestion call beside it where the account's grounding is on and it has a vocabulary to offer. No analytics event: a CSV is no receipt import ([analytics.md](analytics.md)), and nothing on this path reports `ai_assist_used`. No document | Nothing to undo — the run leaves before Import |
| Raising one test notification through the worker | Nothing on the account. One OS notification from this browser profile, tagged `e2e-14` | Closed by the journey: `(await navigator.serviceWorker.getRegistration()).getNotifications({ tag: 'e2e-14' }).then(ns => ns.forEach(n => n.close()))` — by tag, so a bill reminder the account's own sweep raised in this profile is left standing |

The failed-attempt record is written only by the attempt's `failed` and the
import's own record only by `confirmImport`, so an extraction left
unconfirmed leaves nothing behind — which is why the import journeys end by
reading Import History and the Transactions list and finding them unchanged.
A row removed on the review step leaves nothing behind, the way an
unconfirmed extraction does. A backup file does not open an attempt at all:
that handle is opened for receipt images and for nothing else. The confirm
step is visited and left rather than avoided — journey 17 reads its summary —
and it writes nothing either: its progress bar and the *Importing 1 of 2...*
line under it are shown only while a write is running, and no run performs
one — journey 20 counts the bars on it and finds none. The wizard's
processing step and the camera dialog's status line are each no longer read
in passing: journey 20 records the former and journey 18 the latter, each
with an observer armed before the run starts, because each moves once and
leaves. The confirm step's figures are one line per currency now rather than
a single sum across them. The bulk currency switch journey 17 performs changes
rows on the review step only, which is memory until Import is pressed, and
Import never is.

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

**A backup, for the JSON door.** Journey 13 wants a restored backup rather
than a receipt, and that is three rows of JSON — short enough to write by
hand, and never written into the repo. Put it beside `jp.png` in the scratch
folder the server above serves, as `backup.json`:

```json
{
  "transactions": [
    {
      "description": "Journey 13 dated row",
      "amount": 12.5,
      "currency": "USD",
      "type": "expense",
      "date": { "seconds": 1773576000, "nanoseconds": 0 }
    },
    {
      "description": "Journey 13 dateless row",
      "amount": 3.25,
      "currency": "USD",
      "type": "expense"
    },
    {
      "description": "Journey 13 categoryless row",
      "amount": 4.75,
      "currency": "USD",
      "type": "expense",
      "date": { "seconds": 1773576000, "nanoseconds": 0 }
    }
  ]
}
```

`{ seconds }` is the shape a stored date takes once a backup has been
through `JSON.stringify`: a Firestore Timestamp with no `toDate` left on it.
`1773576000` is noon UTC on 15 March 2026 — midday rather than midnight, so
the day it renders is the same in every zone within eleven hours of UTC,
where a midnight value renders as the 14th west of it. The second row
carries no `date` key at all, which is the case the door dates today and
marks assumed. None of the three names a `categoryId`, which is the door's
other case: the fallback category at the grade a default earns, rather than
the full one a category the backup named would keep. The third row is there
to make that count three — three rows, three chips, a header reading
*3 / 3* — and it is named for the case all three share.

The descriptions are deliberately things the account calls nothing: all
three rows go through the duplicate check against real history, and a match
would deselect the row it hit and could leave the step with nothing
selected.

Fetch it and put it on the same hidden input the PNG goes on. The picker takes
`.json` since
[ADR 0113](ADR/0113-the-wizards-picker-takes-a-backup-and-grades-the-category-it-defaulted.md),
so the backup enters by the door every other fixture uses:

```js
const blob = await (await fetch('http://127.0.0.1:8123/backup.json')).blob();
const file = new File([blob], 'backup.json', { type: 'application/json' });
const dt = new DataTransfer(); dt.items.add(file);
const input = document.querySelector('app-file-dropzone input[type=file]');
input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
```

**A CSV with a fraction, for journey 17.** Three rows: one in a currency that
stores no fraction, one whose fraction is finer than the cent, and one
smaller than the currency it will be switched into, written by hand beside
the others as `fraction.csv`:

```
Date,Type,Description,Amount,Currency
2026-03-15,expense,Journey 17 yen row,179.33,JPY
2026-03-15,expense,Journey 17 cent row,4.126,USD
2026-03-15,expense,Journey 17 sub-unit row,0.4,USD
```

The `Type` column is why all three rows read as expenses: with no such
column the sign decides, and these amounts are unsigned
([csv-format.md](csv-format.md)). The descriptions are things the account
calls nothing, for the reason the backup's are — and, on this file, for one
more: a description the category memory has never seen is what sends the
row to the provider, which is the call journey 17 is there to make. The
sub-unit row is smaller than the currency it will be switched into — forty
cents is nothing in yen — so the bulk switch on that journey has a figure to
round away to nothing.

```js
const blob = await (await fetch('http://127.0.0.1:8123/fraction.csv')).blob();
const file = new File([blob], 'fraction.csv', { type: 'text/csv' });
const dt = new DataTransfer(); dt.items.add(file);
const input = document.querySelector('app-file-dropzone input[type=file]');
input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
```

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
| 11 | Review: a tag and a location | The browser's own suggestion list behind the tag field, and the country menu over a real receipt's address | `11-tag-added.png`, `11-country-menu.png` |
| 12 | Review: a row added by hand | A blank card arriving under a real pointer with the caret already in it, and Continue held until it is filled | `12-row-added.png` |
| 13 | Review: a backup row without a date | A restored backup going in through the picker that takes one since ADR 0113, and the date question its dateless row raises | `13-backup-date.png` |
| 14 | Reminders through the worker | A real registration raising a real OS notification, and the permission state the pane reports | `14-worker-notification.png` |
| 15 | Review: split and merge | Two cards born under a real pointer from one, both wearing the receipt badge, and the merge menu folding one back | `15-split-parts.png`, `15-merge-menu.png` |
| 16 | Review: a row removed | A card leaving under a real pointer, focus landing on its neighbour, and the empty review step with Continue held | `16-row-removed.png`, `16-empty-review.png` |
| 17 | Review: a fraction from a file | A CSV's fraction landing whole under a real parse, the Split trigger it earns, the confirm step's per-currency summary, and the snackbar a bulk currency switch raises over the row it blanks | `17-csv-fraction.png`, `17-confirm-summary.png`, `17-bulk-blanked.png` |
| 18 | Camera: the capture status line | The dialog's own step line resolving from the catalogs while a real provider reads a real photo, and the thumbnail's bound `alt` | `18-camera-analyzing.png` |
| 19 | Settings: which rate rung is loaded | Which rung a real boot actually lands on, what the account is told about it, and the two failed-fetch rungs rendered in a real browser under both themes | `19-rate-line.png`, `19-expired-light.png`, `19-expired-dark.png`, `19-fallback-light.png`, `19-fallback-dark.png` |
| 20 | The wizard's processing step on a backup | The step line and the bar as a real render sequence, with no gap where a deleted step was, and nothing left standing afterwards | `20-processing-step.png`, `20-confirm-summary.png` |
| 21 | Receipt lens, desktop, from the list icon | A real stored photo decoded and laid out under the dialog's cap, and the real vision prompt coming back as a receipt rather than a summary of one | `21-viewer-open.png`, `21-translating.png`, `21-translated.png`, `21-cached.png` |
| 22 | The viewer at phone width | The only door a phone has to a receipt, and a photograph fitting a 375px viewport with its controls still reachable | `22-viewer-phone.png` |
| 23 | The viewer over the edit form | Two Material dialogs stacked by a real router-free overlay, and the form surviving underneath unsubmitted | `23-form-thumbnail.png`, `23-viewer-over-form.png` |
| 24 | Dashboard: the account's arrangement | One DOM order painting as computed desktop grid areas and as a single phone column, with no divergence between the two | `24-desktop-areas.png`, `24-phone-stack.png` |
| 25 | The dashboard layout editor: hide, move, reset | A hidden card composing nothing in the running page, a keyboard move landing with the announcer's own words, a real reload holding the arrangement, and Reset deleting the account's preference rather than freezing today's default | `25-hide.png`, `25-moved.png`, `25-reset.png` |
| 26 | The dashboard layout editor at phone width, in both themes | Every row, switch and move control inside a 390px viewport, and the selected and disabled states distinct in light and dark | `26-phone-editor.png` |
| 27 | The transaction form: a purchase split across categories | A held submit while the split cannot stand, a remainder that recomputes with every part, three real rows sharing one group id, the badge reaching assistive technology, and the dashboard chart crediting each category | `27-split-form.png`, `27-parts-listed.png`, `27-part-confirm.png` |
| 28 | Settings: the accessibility toggle-groups share their row | The font-size group's three segments distributed as evenly as the theme toggle beside them, at the group's own capped width | `28-font-scale-toggle.png` |
| 29 | The repaired grids at tablet and desktop | Declarations a browser was silently dropping now producing real columns, on the widths a 756px Karma window cannot see | `29-reports-grids-768.png`, `29-reports-grids-1280.png`, `29-settings-ai-grids-1280.png`, `29-filter-grid-1280.png` |
| 30 | The tab strips scroll | A strip driven by a real scroll, a real click and real arrow keys, with no chevrons anywhere in it | `30-budgets-strip-375.png`, `30-reports-strip-375.png`, `30-reports-strip-1280.png` |
| 31 | Every route at the account's own font scale | The layouts at 1.3 as the account actually renders them, against the same page at 1.0 | `31-nav-labels-375.png`, `31-amounts-375.png`, `31-model-selects-375.png`, `31-period-picker-375.png` |
| 32 | The papercuts: targets, floors and a fallback | Tap targets and a table floor measured in a real layout, and Material's own touch target underneath two of them | `32-table-floor-768.png`, `32-sidebar-nav-1280.png`, `32-budget-menu-375.png`, `32-avatar-fallback.png` |
| 33 | Import review: the duplicate check reads the account | A twin outside anything this session browsed, found by a real import against a real cache | `33-duplicate-banner.png` |

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

Open the wizard: the Add menu's **Import from File**, or `/import/file` typed in.
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
- **A fraction on a yen row.** Type `538.4` → Enter → the row reads
  *-¥538*: the figure is rounded to what the currency stores before it
  lands, and the trigger names the rounded value. `0.4` is refused — the
  field stays open, marked invalid, *Enter an amount — at least ¥1* beside
  it, and Escape is the way out.
- **The description.** Tap it → edit → Enter. An emptied field is a reviewer
  starting over, not a row that reads as nothing: it closes and changes
  nothing.
- **The category.** The chip beside the currency opens the category menu →
  pick another → the chip's icon, name and confidence dot all follow the
  choice, the dot going green because the reviewer's own pick is the confident
  one.
- **Notes.** This row came with the reader's own note, so its box is already
  on the card — a row with none shows a **Notes** button that opens the same
  box. Extend the note, then click away: it is filed on the way out, not
  keystroke by keystroke, and the box stays up as a filed note with the row's
  editing slot empty.
- **A currency switch.** The currency chip's menu → **USD** → the row reads
  *-$538.00*: the figure is whole in both currencies, and the dollar renders
  the two places the yen does not. Type `12.34` into the amount → *-$12.34* →
  the menu again → **JPY** → *-¥12*. The figure follows the currency it is
  stored in, and a switch rounds it to what the new one holds rather than
  converting it — nothing on this card converts anything. A switch that moves
  the amount — `12.34` to `¥12` here — sends the row back through the
  duplicate check on the same rule an amount edit follows; a switch between
  figures already whole in both currencies fires nothing. Type `538` back
  before leaving, so journey 15 finds the printed total on the row it splits.

An edit to the date, amount, type or description sends that row back
through the duplicate check, and so does a currency switch that moves the
amount. A verdict of *Duplicate* deselects the row and the badge's × (*Not
a duplicate — import it*) overrules it; a re-check that cannot reach
history says so once, in a snackbar — *Couldn't re-check for duplicates —
the earlier verdict stands.* Neither is guaranteed with a one-receipt
fixture against a real account: they are what to recognise if they
appear, not part of the pass.

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
question chip standing and an editor open — the tag editor, whose field
stands in the extras row beside the chips already on it.

**Pass:** nothing spills sideways. With the editor open, in the console:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth;
```

`true`. At phone width the date and currency chips do not share a line — they
stack one per line, as observed at 375px, and the type toggle wraps with them.
That is the meta row wrapping as it is built to, not a failure; no threshold
for it is pinned anywhere, so do not read one off a single run. The chips and
the editors keep their 40px tap targets at every width.

Two more readings, in journey 15's order: with the split field open on the
card, and — once the split has made two — with the merge menu open over
the part. What is pinned is what these controls own: every **Split**,
**Merge into…** and **Remove** trigger inside its own card's box and 40px
tall, and the open split field inside that box too — the 288px probe's own
reading of them, taken here at the wizard's real width:

```js
[...document.querySelectorAll('.transaction-card')].every(card => {
  const c = card.getBoundingClientRect();
  const inside = el => {
    const b = el.getBoundingClientRect();
    return b.left >= c.left && b.right <= c.right;
  };
  return [...card.querySelectorAll('.split-input')].every(inside) &&
    [...card.querySelectorAll('.split-trigger, .merge-trigger, .remove-trigger')]
      .every(t => inside(t) && t.getBoundingClientRect().height >= 40);
});
```

`true` both times. The card's own `scrollWidth` inside its `clientWidth` is
the pass here now, on every card:

```js
[...document.querySelectorAll('.transaction-card')]
  .every(c => c.scrollWidth <= c.clientWidth + 1);
```

`true`. The pixel of slack is the 288px probe's own, for a sub-pixel width
that reads one over with nothing hiding. The category suggestion chip that
used to push a real receipt's card wider than that no longer can: its
section now shrinks with the card instead of sizing itself to the label's
own width, and the label scales down through `appFitText`, wrapping rather
than overflowing once it reaches the 12px floor. *Groceries* at 185px reaching
12px past a 240px card is what the first run recorded against a follow-up
of its own — closed now, and history.

The chip's caret is gone at this width. From the chip's menu, pick the
account's longest category name for the row under test — a local change to
a row that is never imported, and the original is picked back before
leaving. Then, in the console:

```js
getComputedStyle(document.querySelector('.transaction-card .dropdown-icon')).display;
```

`'none'` — the caret yields the width to the name, which is the only place
the name can get any: the chip stays beside the other extras, so what it
has is the card's row share. And the label's own line count, read from its
text rather than its height:

```js
const label = document.querySelector('.transaction-card .category-name');
const r = document.createRange(); r.selectNodeContents(label);
r.getClientRects().length;
```

**at most 3**, on a name of about thirty characters — the probe's own
reading, taken here at a real phone's width. Three is what the caret's
width bought: the probe measured five lines with the caret standing and
three without it, and two lines would need the chip on a line of its own, a
layout this wave did not take. A run at a real 375px phone viewport saw the
pass criterion met exactly, not just under it: the card **225px**, the
label's box **68px** at the 12px floor, and the account's longest category
name, *Hotels & Accommodation* (22 rendered characters), at **3** lines.

Take that reading with the card on screen. A card read before it scrolls
into view answers a collapsed **34px**, with a **0px** label, under
viewport emulation — that is the pane's width, not the card's, so scroll
the card into view before measuring it.

One shot: the review card, question chip and open tag editor together.

### 11. Review: a tag and a location

The same review as journey 8, on the same `jp.png` row, with the date
question already answered by Keep. Everything below is in the card's extras
row, where the date chip stood.

**Add tag** is the last control in that row, after whatever tags the reader
suggested. Tap it → the field opens in its place, placeholder *New tag*,
pointed at a list of the tags the account already files by, so the browser
offers them itself and narrows them as the letters go in. Type `lunch` →
Enter → the tag renders as a chip of its own, its remove button named
*Remove tag lunch*, and focus is back on **Add tag** for the next one. The
field spells what it takes the way the account already spells it — trimmed,
lowercased, cut at 30 characters — so a capital typed here comes back
lowered, which is the spelling the transaction filter finds the row by.
Escape leaves the row alone, and so does a tag it already carries.

Then the location, on the same row. `jp.png` prints its shop's address, so
the chip arrives with a name in it and the country beside it, and both are
corrected in place:

- **The name.** Tap it → the field opens on the name as it stands → edit →
  Enter → the chip reads what was typed. Emptying it withdraws the name
  rather than the location: a country under it keeps the chip, in the
  country-only shape a receipt with no printed address arrives in.
- **The country.** The button beside the name reads the country in the app's
  own language, or shows a globe when the row has none, and opens a menu of
  countries named and ordered in that language. Pick another → the button
  reads it. Open it again → **No country** at the top → the button falls
  back to the globe. A country picked here replaces the one the reader
  concluded, so the reader's answer cannot come back once the picked one is
  withdrawn.

**Pass:** every change shows on the card, and nothing reached the account —
Transactions is unchanged and `/import/history` has no new run.

**Precondition:** the list behind the tag field is the account's own
vocabulary — the tags on its transactions from the last six months, plus
what the tag memory remembers, plus the tags the batch itself arrived with.
The first of those three is empty while the account's grounding level is
`off` ([rag-insights.md](rag-insights.md)), which leaves only what the memory
has learned — nothing, on an account that has never kept a suggested tag, and
that is how the list came back empty on the first run. A bare field still
takes a typed tag, so the tag half of the journey stands either way; the
list half is recorded as skipped rather than faked. **No country** is
likewise there only while the row has a country: if this receipt's row
arrived without one, pick a country first and withdraw it after.

Two shots: the new tag on the card, and the country menu open.

Leave the way journey 9 leaves — the review step's **Back**, then the
wizard's own back arrow.

### 12. Review: a row added by hand

The same review. **Add a row** sits under the whole list rather than in any
row: it adds one instead of editing one, and the notice that tells a
reviewer to add what the reader was cut short of has to point at a control
they can reach without scrolling a batch of twenty.

Tap it → a blank card appears at the end of the list with the description
editor already open and the caret in it, the hint *Fill in 1 row before
continuing* stands under the list, and Continue is disabled. Type a
description → Enter → the hint stays, because the amount is still nothing:
the card reads *Add an amount* where a figure belongs, and the description
now reads what was typed. Tap *Add an amount* → type `120` → Enter → the
hint goes and Continue enables.

The row takes the day and the currency of the row above it, which is what it
is missing from — on this review, August 14th and ¥, so the filled row reads
*-¥120*. That day was copied rather than read off anything, so the row asks
no date question of its own; its category is the fallback offered to a row
nothing suggested one for, wearing the low-confidence dot that says so. While it
was blank its extras carried **Remove**, **Add location** and **Add tag** and
nothing else — no Split on a row with no amount, no Merge into… on a blank
one; filled, it gains **Split**. **Merge into…** joins it only while the
scanned row shares its currency and carries no duplicate badge of its own —
a flagged row takes part in no merge, on either side. The location trigger
is what a row with no location shows in place of the chip journey 11 edits.

**Pass:** the added row shows filled, Continue enabled, and nothing reached
the account. Leave by the review step's **Back** and the wizard's back
arrow, as journey 9 does; Import is never pressed.

One shot: the added card filled, with the hint gone.

### 13. Review: a backup row without a date

Open the wizard as journey 8 does — the Add menu's **Import from File**, or
`/import/file` typed in. This journey's file is a `.json` backup, which the
picker takes since
[ADR 0113](ADR/0113-the-wizards-picker-takes-a-backup-and-grades-the-category-it-defaulted.md)
— the share sheet still takes images, PDF and CSV only — so it goes
in through the hidden input like every other file, the recipe and the rows
under [Fixtures](#fixtures). The zone shows it the way it shows a CSV:
the file's name, its size, the `backup` icon and the label *JSON*. There is
no *What are these images?* question, because nothing here is an image, and
**Process with AI** enables.

**Process with AI** → the processing step, which makes no provider call here
— the door parses the file itself, and only the duplicate check leaves the
browser → **Continue** → Review.

**Pass:** three rows, the header reading *3 / 3*. The two whose `date` was a
`{ seconds }` timestamp read *Mar 15, 2026* with the ordinary calendar glyph
and no question, which is the whole point of the journey: the shape a stored
date arrives in is read as a date. The one with no `date` at all reads today
and carries the question chip *Date set to today — keep it?*; its date button
wears the plain glyph too, because nobody graded these rows and the chip is
that row's only mark. Continue is enabled with the question standing — a date
question holds Continue only on a row a receipt reader produced, and these
came off a file — and the header shows no **Keep all dates**, which counts the
same rows. **Keep** settles the chip the way journey 8's Keep does: the chip
goes and the button takes the check.

Every row's category chip reads *Other* and wears the low-confidence dot,
tooltip *Low confidence (30%) — please review and select the correct
category*. Nobody named a category in this file, so the door says as much
instead of vouching for the one it fell back to. A `categoryId` the backup
did name would keep the full grade and the green dot, which is a case this
fixture deliberately does not carry — three rows, one reading.

Then **Back**, and out by the wizard's back arrow. Nothing is imported.

One shot: the three rows together, with the question chip on the dateless
one.

### 14. Reminders through the worker

Any page, from the console:

```js
const reg = await navigator.serviceWorker.getRegistration();
[reg.active.scriptURL, Notification.permission];
```

The script URL ends in `/share-target-sw.js`: the share-target worker the
app registers at scope `/` on every web boot is the registration a reminder
is now raised on. Record the permission with it.

**Precondition for the OS half:** `granted`. The pane may not prompt — the
only prompt in the app is the reminders switch's, and the same click writes a
preference and sweeps the account ([Panes and viewports](#panes-and-viewports))
— and `granted` comes from the browser's own site settings for the origin,
never from the app. A `default` or `denied` state is recorded, and the OS half
of the journey is skipped rather than faked. The registration half still
stands on either: the wrapper below still sees the call arrive with the
sweep's own arguments, the constructor is never touched, and the seam resolves
`false` on the platform's own refusal (*No notification permission has been
granted for this origin*). That is what the first run proved, in a pane that
reported `denied`; the notification itself waits for a profile that grants.

Then Settings → Profile, the page `app-reminder-settings` is on — the bill
reminders block journey 6 walks past — and, in the console, wrap the
registration's method so the call's arguments are kept, then raise one
through the service's own seam:

```js
const orig = reg.showNotification.bind(reg);
reg.showNotification = (...a) => { window.__shown = a; return orig(...a); };
await ng.getComponent(document.querySelector('app-reminder-settings')).reminders
  .showWebNotification('Home Account', 'Journey 14', 'e2e-14');
```

**Pass, on a granting profile:** the call resolves `true`; `window.__shown` is
`['Home Account', { body: 'Journey 14', tag: 'e2e-14' }]` — the title, then
the body and the tag as one options object, which is the shape the sweep
hands over; `(await reg.getNotifications()).map(n => n.tag)` contains
`e2e-14`; and the operating system shows it, *Home Account* over
*Journey 14*. That the wrapper saw the call is what says it went through the
registration and not the constructor, which touches no registration at all.
Nothing was written, and the switch is untouched.

Close it with the restore in [What a run may touch](#what-a-run-may-touch)
before leaving the page — by its tag, never every notification the
registration holds, since a bill reminder the account's own sweep raised in
this profile may be standing beside it. Clicking it instead is the worker's
`notificationclick`, which closes the notification and focuses an open tab,
or opens one at `/` — fine to try, and not part of the pass.

One shot: the notification, where the pane can see the operating system's
notification surface; otherwise the console with the three readings above,
and say so beside the shot.

What this journey does not prove is the Android device. Desktop Chromium
exercised the same registration API here, and Android Chrome is where the
constructor throws and the registration is the only way through — but the
device is a check on the deployed site after the merge, not something a
pane reaches, and it is recorded as that rather than assumed from this run.

### 15. Review: split and merge

The same review as journey 8, on the same `jp.png` row, fed the same way,
with the date question answered by **Keep** first: Continue is then held by
nothing, so whatever holds or frees it below is this journey's own doing.

**Split** is in the card's extras, ahead of **Add location** and **Add
tag**, on any row worth at least two of its currency's minor units — ¥2 on a
yen row, $0.02 on a dollar one; below that the trigger is not offered at
all, since no figure would leave both halves above the floor. Tap it → the
field opens in its place, empty, placeholder *Amount for the new row*, with
the caret in it → type `179`, a third of the printed ¥538 → Enter → two
cards. The original now reads *-¥359*, and directly under it stands the
part at *-¥179* with its description editor already open and the caret in
it: it was born holding the original's description, which a line item taken
out on its own rarely keeps. Enter with the copied name left standing closes
the editor and keeps it, the way journey 9's description editor keeps an
unchanged one. A fractional figure typed here — `179.4` — rounds the same
way, ¥179 off and ¥359 left. Escape leaves the row alone and so does an
emptied field, while a figure the row cannot spare — the whole ¥538, or
more — holds the field open, marked invalid, with *Enter an amount smaller
than the row's — at least ¥1* next to it, the way the amount editor refuses
a figure it cannot read.

Both cards wear the receipt badge, *Receipt 1 (photo 1)*: one photo, two
transactions, each of which would attach its own copy at an import this run
never reaches. An amount flag, if the row wore one, goes with the split the
way a hand-typed figure clears it. Continue stays enabled — the part is born
filled, and the kept date travels with it — and both halves go back through
the duplicate check, the original for its new amount and the part because
it is new; a part is exempt from reading as its original's twin within the
batch, so the batch half of that re-check flags neither.

Then **Merge into…** in the part's extras, after **Split**. The trigger
exists only while another filled row shares the currency, which until the
split none did. Open it → the menu lists the original alone, as
*description · amount · date* — the row's description, *¥359*, *Aug 14,
2026* — since the two are the only rows. Pick it → one card again, at the
printed total *-¥538*, the badge still reading photo 1, and focus on the
survivor's description trigger: its own **Merge into…** left with the last
other row. The survivor is the original — its description, its date and the
marks the review put on it stand, and the amount is the one thing summed.
That new figure sends it back through the duplicate check alone, the row
that merged away owing no verdict, and once that settles there is no
duplicate badge. A *Duplicate* verdict from either re-check is journey 9's
case — what to recognise against a real account, not part of the pass. A run
that strays onto the confirm step sees an *Items merged* card reading 1 after
the merge: the survivor is marked merged and that card counts it — not a
defect, and not on this journey's path.

A blank row and a flagged one are kept off both sides: a card still reading
*Add a description* or *Add an amount*, or wearing the duplicate badge,
offers no **Merge into…** and is listed in no other row's menu, so a merge
never answers a question the reviewer was not shown; a row in another
currency is not listed either, because nothing here converts.

**Pass:** the split shows two parts and the merge shows one, and nothing
reached the account — Transactions is unchanged and `/import/history` has
no new run. Leave by the review step's **Back** and the wizard's back arrow,
as journey 9 does; Import is never pressed.

Two shots: the two cards after the split, and the merge menu open over the
part.

### 16. Review: a row removed

The same review as journey 8, on the same `jp.png` row, with the date
question already answered by **Keep**.

**Add a row**, journey 12's mechanics: the blank card lands at the end of the
list with its description editor open and the caret in it, the hint *Fill in
1 row before continuing* stands under the list, and Continue is disabled.
**Remove** in the blank card's extras → the card goes, the hint goes with it,
Continue enables, and focus lands on the scanned row's own **Remove** — the
previous row's, since the removed one was last.

Then **Remove** on the scanned row, the list's last one left: the card goes,
the empty state stands in its place — *No transactions to import* — the
header reads *0 / 0*, Continue is disabled again with nothing left to select,
and focus lands on **Add a row**. Both landings are focus readings left to
the specs, where the pane cannot show them.

**Pass:** both removals show on the card, and nothing reached the account —
Transactions is unchanged and `/import/history` has no new run. Leave by the
review step's **Back** and the wizard's back arrow, as journey 9 does; Import
is never pressed.

Two shots: the list after the first removal, and the empty review step after
the second.

### 17. Review: a fraction from a file

Open the wizard as journey 8 does — the Add menu's **Import from File**, or
`/import/file` typed in. This journey's file is `fraction.csv`, in through
the hidden input like every other ([Fixtures](#fixtures)); the zone shows it
with the table icon and the label *CSV*, and there is no *What are these
images?* question, because nothing here is an image.

**Process with AI** → the processing step. Its line under the heading now
reads the catalog's own text for the app's locale rather than an English
sentence the service set — it moves too fast to be certain of catching, the
unit and smoke specs pin which key it renders, and what a runner confirms is
only that nothing English appears there under a non-English locale. The
parse is local, and then the ladder asks the configured provider to
categorize the three descriptions the category memory does not know — one
real call under the account's own key, and, where the account's grounding is
on and it has a tag vocabulary to offer, a second for tag suggestions: both
are named by the row [What a run may touch](#what-a-run-may-touch) records —
before the duplicate check reads history → **Continue** → Review.

The yen row reads *-¥179*, the cent row *-$4.13*, and the sub-unit row
*-$0.40*. The file says `179.33`, `4.126` and `0.4`; what the card shows is
what each currency can hold, rounded where the row was built rather than on
the way to the screen — the same figure a reviewer would type by hand and
the same one an import would write. None of the three is asked a date
question: nobody graded these dates, so *Mar 15, 2026* stands on all three
with the plain calendar glyph, and Continue is held by nothing. Whatever
category the provider picked is not part of the pass — it is a real answer
to a real description, and it is allowed to be anything. All three rows
carry **Split** in their extras, each worth at least two of its own minor
units (journey 15's floor). The cent row and the sub-unit row also carry
**Merge into…** now, since a second filled row shares each one's currency;
the yen row carries none — nothing else in the batch is in JPY, and nothing
here converts between currencies.

**Continue** → the confirm step. The summary counts **3** transactions and
the Import button reads *Import 3 Transactions*, enabled, with no date
question and no unfilled row to hold it — and no progress bar under the
cards, which is shown only while a write runs. The expense card now reads
two lines, *-¥179* and *-$4.53*, one per currency in the batch; the income
card reads a single zero line in the account's own currency, since nothing
here is income. A batch is totalled per currency now, and nothing here
converts.

**Back** to Review, with all three rows still ticked, then
**Currency for selected** → **JPY**: a snackbar reads *1 amount rounds to
nothing in JPY — add it again*, the sub-unit row's amount is replaced by
its *Add an amount* placeholder, and Continue is held by it. Nothing is
switched back and nothing is written — the batch is memory — and the
journey leaves by the wizard's back arrow without pressing Import. Then, on
`/import/history`, the records already there read their totals in the
account's own currency, and none of them in dollars it never had.

**Pass:** all three figures whole on the card, **Split** standing on the
rows that clear the floor, the confirm step's per-currency summary, the
snackbar's count on the bulk switch, and Import History showing no `$` on a
record that was never in dollars — and nothing on the account: Transactions
is unchanged and `/import/history` has no new run.

Three shots: the review card with its three rows, the confirm step's
summary, and the snackbar over the blanked row.

### 18. Camera: the capture status line

The other import door, and the one whose status line the wizard's specs say
nothing about. Add menu → **Import from Camera** opens the capture dialog.

Feed `jp.png` to the dialog's **library** input rather than its camera one —
the capture area holds two hidden inputs and only the second omits
`capture="environment"`, which is what lets a desktop browser answer at all:

```js
const blob = await (await fetch('http://127.0.0.1:8123/jp.png')).blob();
const file = new File([blob], 'jp.png', { type: 'image/png' });
const dt = new DataTransfer(); dt.items.add(file);
const input = document.querySelectorAll('app-camera-capture input[type=file]')[1];
input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
```

The thumbnail appears with its number. Read its `alt` before going on: it is
*Receipt image 1 of 1*, bound through `receiptImages.imageNumber` with both
numbers placed by the catalog rather than by the template.

The line itself is on screen for as long as the provider takes and then
leaves with the dialog, so **arm an observer before pressing anything**:

```js
window.__j18 = [];
const host = document.querySelector('app-camera-capture');
new MutationObserver(() => {
  const p = host.querySelector('.processing-overlay p');
  const text = p ? p.textContent.trim() : null;
  const last = window.__j18.at(-1);
  if (!last || last.text !== text) window.__j18.push({ t: Math.round(performance.now()), text });
}).observe(host, { childList: true, subtree: true, characterData: true });
```

Then **Process with AI**, and read `window.__j18` once the dialog has gone.

**Pass:** the recorded sequence is one line and one disappearance — the
catalog's own sentence for the app's locale (*Analyzing receipt…* in
English, `ai.scanning`, the single-photo branch) standing from the moment the
overlay appears until it goes, and `null` after. Nothing English appears
under a non-English locale, and nothing names a processing *mode*: the five
English mode labels that used to be interpolated into this line are gone,
not translated. The overlay leaves with the processing flag, **before** the
dialog closes onto the wizard's Review step — one provider call, no error
card, and no new `error`-level console entry.

One shot: the overlay with its line, while the provider is reading.

The dialog hands off to `/import/file` at Review. Leave from there the way
journey 9 does, by the wizard's back arrow; **Import is never pressed**, so
the scan costs one provider call and, when analytics consent is on, one
analytics event, and writes no document
([What a run may touch](#what-a-run-may-touch)).

### 19. Settings: which rate rung is loaded

Settings → **Preferences** → the base-currency field, labelled *Currency*.
The line under the select is the rate marker.

#### The read half

Read the line, and read the rung behind it from the page console:

```js
ng.getComponent(document.querySelector('app-rate-status')).rateSource();
```

**Pass:** on any boot that follows another within twelve hours — which is
nearly every boot — the rung is `'cached'` and the line still reads
*Exchange rates updated {{date}}*, in the user's own date format, with no
warning styling. That is the decision, not a slip: the ladder's first rung is
the device cache, a fresh one is at most twelve hours of market data, and it
makes the same claim about the table's age a live fetch does. A line that
said *saved* there would report an ordinary boot as a degraded one.

#### The write half

**It runs only on the user's explicit word**, and every write in it is on the
device: `localStorage['home-account.exchangeRates']` on this browser profile,
nothing on the account ([What a run may touch](#what-a-run-may-touch)). Read
the string first and keep it **outside the page** — copied down beside the
run's notes, because every reload below clears anything left on `window`, and
the restore at the end needs it verbatim.

**A fresh cache.** Stamp the kept table with the current clock and reload:

```js
const kept = localStorage.getItem('home-account.exchangeRates');  // copy it down
localStorage.setItem('home-account.exchangeRates', JSON.stringify({
  ...JSON.parse(kept), lastUpdatedMs: Date.now()
}));
```

The ladder's first rung takes it: the rung reads `'cached'` and the line reads
the same sentence with today's date. That the boot asked for nothing is not
read off the network log — that log may record same-origin requests only
([Panes and viewports](#panes-and-viewports)), so the absence of a rates
request there proves nothing.

**No cache.** Remove the key and reload: the ladder misses the cache, fetches,
and the rung reads `'live'` — with the *same sentence* on screen, which is the
thing being confirmed. That boot costs one extra provider fetch.

**The restore.** Write the copied string back verbatim with `setItem`, reload,
and confirm on screen that the line and the rung are the ones they were at the
start.

#### The two rungs a boot cannot reach

`expired` (a cache past the twelve-hour window and a failing fetch) and
`fallback` (no cache and a failing fetch) both need the rates request to fail,
and no arrangement of the cache alone makes it fail — an expired cache simply
goes to the network and succeeds.

Neither mechanism the issue offered reaches them:

- **Request blocking on `open.er-api.com`.** The pane the protocol runs in
  exposes no request blocking and no offline mode, so a failed fetch cannot be
  arranged from outside the app.
- **The seeded harness under [`docs/ui-audit/tools/`](ui-audit/tools/).** It
  can stub `fetch` before the service is constructed, but it renders a demo
  account against the emulators, and only after `.vscode/environment.ts` is
  swapped and an uncommitted `app.config.ts` edit points the app at them.
  There is no real session and no deployed rules behind it — which is the
  whole reason this protocol exists beside it.

The app offers no seam of its own either: the endpoint is a module constant,
`fetch` is the global, there is no environment field naming it and no service
worker sees it. What it does offer is the ladder. `CurrencyService` is
root-provided, `RateStatusComponent` holds it as `private currencyService`,
and `initializeRates()` is the exact method a boot runs — so the ladder can be
re-entered on the running page with the fetch failing underneath it, and the
line repaints through the same signal a boot writes.

The access is journey 14's class, and it is worth naming rather than glossing:
`private` is TypeScript's word, which the running page does not enforce, and a
private method called from the console is diagnostic-grade. What it proves is
the rung the ladder chooses and the line the component renders for it — not
the boot sequence, which is why the journey ends with a real reload.

The ladder's logic stays where it belongs: `currency.service.spec.ts` walks
all four rungs and `rate-status.component.spec.ts` pins `rate-line-stale` on
the two that failed. What this half adds is the one thing neither can — the
line as a browser paints it, in the warning colour each theme gives it.

**Keep the string, the real `fetch` and the theme classes, and fail only the
rates host.** This half reloads nothing until it is over, so a page global
holds all three across it:

```js
window.__j19 = {
  cache: localStorage.getItem('home-account.exchangeRates'),
  fetch: window.fetch,
  theme: document.documentElement.className
};
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href : input.url;
  return url.startsWith('https://open.er-api.com/')
    ? Promise.reject(new Error('journey 19'))
    : window.__j19.fetch.call(window, input, init);
};
```

Selective for the reason `currency-fallback.smoke.spec.ts` fakes it the same
way: the Firestore transport and the auth token exchange ride `window.fetch`
too, and a blanket rejection takes the session down with the rates.

**`expired`** — age the kept table past the twelve-hour window and re-enter:

```js
const line = () => document.querySelector('app-rate-status .rate-line');
const rates = ng.getComponent(document.querySelector('app-rate-status'))
  .currencyService;
localStorage.setItem('home-account.exchangeRates', JSON.stringify({
  ...JSON.parse(window.__j19.cache), lastUpdatedMs: Date.now() - 13 * 3600e3
}));
await rates.initializeRates();
[rates.rateSource(), line().textContent.trim(), line().className,
  getComputedStyle(line()).color];
```

`'expired'`, the line reading *Could not update exchange rates — using saved
rates from …* with the cache's **own** date in the user's date format, the
class list carrying `rate-line-stale`, and the colour `rgb(180, 83, 9)` —
`--color-warning-text` in light. In a pane the host is not showing, flush with
`ng.applyChanges(ng.getComponent(document.querySelector('app-rate-status')))`
before reading the text ([Panes and viewports](#panes-and-viewports)).

**Dark**, for the same line:

```js
const root = document.documentElement;
root.classList.add('dark-theme'); root.classList.remove('light-theme');
getComputedStyle(line()).color;        // 'rgb(251, 191, 36)'
root.className = window.__j19.theme;   // both classes back as they were
```

That is what `ThemeService.applyTheme` does to the root element and nothing
besides. The Settings theme control is not used: that click writes
`preferences.theme` on the user document, and this journey has no account
write in it.

**`fallback`** — remove the key and re-enter, with the fetch still failing:

```js
localStorage.removeItem('home-account.exchangeRates');
await rates.initializeRates();
[rates.rateSource(), line().textContent.trim(), line().className,
  getComputedStyle(line()).color];
```

`'fallback'`, the line reading *Could not fetch exchange rates — using
built-in approximate rates* with **no date on screen**, and the same warning
colour — read in dark the same way, for `rgb(251, 191, 36)`.

**Do not read `lastUpdated()` here.** `setDefaultRates()` installs the
constants and names the rung, and it leaves that signal alone on purpose, so a
re-entry that has already been through `expired` still carries the cache's
date in it. Nothing on screen is wrong — the template's `fallback` branch
takes no date and says *approximate* in words — so the criterion here is the
sentence and the rung, never a null stamp. The null belongs to a service built
with no cache at all, and that is where `currency-fallback.smoke.spec.ts` pins
it, beside the `1/149.5` constant a real write converted through.

**The restore.** Put the real `fetch` and the kept string back, and re-enter
once more:

```js
window.fetch = window.__j19.fetch;
localStorage.setItem('home-account.exchangeRates', window.__j19.cache);
await rates.initializeRates();
[rates.rateSource(), line().textContent.trim()];
```

The rung and the line are the ones the journey started on. Then **reload**:
the wrapper goes with the page, the boot walks the ladder the ordinary way,
and the line reads the same — which is what says the restore is real rather
than a signal that was told so.

**Pass:** both unreachable rungs read on screen, each with its own sentence,
`rate-line-stale` and `--color-warning-text` in both themes; the theme classes
and the cache back as they were; and the starting rung and line confirmed
after a real reload, with no new `error`-level console entry across it.

Five shots: the line under the currency select at the start, and each warning
line in light and dark.

### 20. The wizard's processing step on a backup

Journey 13's fixture, read for what happens *before* the review step. Open
the wizard and feed it `backup.json` as [Fixtures](#fixtures) describes.

The processing step's line moves once and the card then leaves, so arm an
observer on the wizard before pressing **Process with AI** — recording the
line and the bar together, since the two are the pair that has to agree:

```js
window.__j20 = [];
const host = document.querySelector('app-import-wizard');
new MutationObserver(() => {
  const p = host.querySelector('.processing-card .processing-status');
  const bar = host.querySelector('.processing-card mat-progress-bar');
  const text = p ? p.textContent.trim() : null;
  const value = bar ? bar.getAttribute('aria-valuenow') : null;
  const last = window.__j20.at(-1);
  if (!last || last.text !== text || last.value !== value) window.__j20.push({ text, value });
}).observe(host, { childList: true, subtree: true, characterData: true });
```

**Pass — the sequence.** Three entries and nothing else: *Reading the file…*
at 20, *Checking for duplicates…* at 80, then the card gone with a null bar.
The JSON door has two steps, and there is **no third entry between them** —
that is the deleted `converting` step, which was set and overwritten inside
one synchronous block and never had a frame of its own. No English sentence
from the service appears at any point.

**Continue** → Review: three cards, the header reading *3 / 3*. The dated
row carries *Mar 15, 2026* and *-$12.50*; the dateless row landed on today
and is asked about; the third is the categoryless one. **Continue** → the
confirm step: *3 Transactions*, one expense line of *-$20.50* (all three
rows are USD) and a single income line of zero in the account's own
currency, since nothing here is income. No importing section, and

```js
document.querySelectorAll('mat-progress-bar').length;   // 0
```

— a bar belongs to a run in flight, and there is none: no door left one
standing behind it and the confirm step has not begun.

**Import is never pressed.** Leave by the wizard's back arrow, then read
`/import/history`: the record count is what it was before the journey, no
record names `backup.json`, and no card anywhere on the page contains the
text `NaN` — a record that carries no totals of either kind renders a zero
in the account's own currency.

Two shots: the processing card mid-run, and the confirm step's summary.

### 21. Receipt lens, desktop, from the list icon

Desktop width — at least 1024px, for the reason journey 2 gives: the receipt
icon lives in the table, and below `min-width: 768px` it does not exist.

A row with a stored receipt **printed in a script the app's current language
does not read** — the whole point is a photograph the account holder cannot
read off the paper.

Transactions → the row's receipt icon (`.receipt-icon-button`, `receipt_long`,
with the image count as a badge past one) → the viewer.

**Pass — what opens.** A dialog, not a tab: the transaction's description as
a subtitle, the stored photo itself, and *Translate receipt* enabled. A
one-image transaction shows no arrows. The photo is the stored one at its own
resolution, laid out inside the dialog's cap — read both from the page:

```js
const img = document.querySelector('.receipt-image');
[img.naturalWidth, img.naturalHeight, img.getBoundingClientRect().height,
  innerHeight * 0.6];
```

the natural size is the upload's, and the rendered height is at or under
`60dvh`. The actions row still carries *Open in new tab* with
`rel="noopener"`.

**Translate receipt** → the spinner → the panel.

**Pass — the wire.** The marker reads *Translated from …* naming the language
the receipt was printed in, the panel is `role="status"`, and the reading is
the **receipt**, not a summary of one: every printed line in order, as
`white-space: pre-wrap`, with every figure intact — item prices, the
discount, the amount paid and the printed timestamps all identical to the
photo beside them. Count the lines and read a few figures back rather than
eyeballing it. The photo is still in the DOM: nothing was replaced.

A provider call does not have to appear in the network log — it goes to a
third-party host, and the log may record same-origin requests only
([Panes and viewports](#panes-and-viewports)). The translated text is the
proof it answered.

**Pass — focus.** After the answer, `document.activeElement` is the
**Hide translation** button, not `<body>`. That matters more here than on the
note lens: this is a modal, and focus on `<body>` inside one leaves a keyboard
reader with no way back to the dialog short of tabbing the whole surface.

**Hide translation** → the panel goes, *Translate receipt* is back, and focus
is on it. Press it again.

**Pass — the cache.** The panel returns in well under a second with **no
spinner**: the service caches by transaction, slot, locale and answering
provider for the session, so a second look at the same photo costs nothing. A
spinner here means the account is paying twice for one answer.

Close through the dialog's own **Close** button — the pane's Escape key
reaches no dialog, which is a pane artefact and not a finding
([Panes and viewports](#panes-and-viewports)). The list underneath is
unchanged: same row count, same row.

Four shots: the viewer as it opens, the spinner, the translation beside the
photo, and the cached second answer.

### 22. The viewer at phone width

375px wide, at the pane's **own** width where possible — pointer input stalls
under emulation, and this journey is a menu and a dialog
([Panes and viewports](#panes-and-viewports)). Take every measurement in the
same turn that sets the width: a pane clears the emulation between turns.

Below `min-width: 768px` the table is gone and the list is
`app-transaction-row` elements. The row's receipt mark is an **indicator**,
not a control, so the door is the trailing overflow menu (⋮) →
**View receipt** — this is the only door a phone has to a stored receipt.

**Pass — the menu.** With a receipt on the row and a note on it, the menu
reads *View note*, *View receipt*, *Edit*, *Delete*, in that order.

**Pass — the fit.** With the viewer open, from the console:

```js
const r = sel => document.querySelector(sel).getBoundingClientRect();
[r('.receipt-image'), r('mat-dialog-container'),
  r('.translate-button').height, innerWidth];
```

The image's box and the dialog's both sit inside the viewport width with
nothing negative and nothing past the right edge; the Translate control is at
least 40px tall. Then the page-level check journey 4 uses:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth;
```

`true`. A tall receipt photographed in portrait is the case that pushes a
dialog wide, so use one.

Leave by **Close**.

One shot: the viewer at 375px with the photo and the Translate control both
on screen.

### 23. The viewer over the edit form

Desktop. Click a row **with a stored receipt** → the edit dialog → the
receipt strip under the receipt controls.

**Pass — the thumbnail is a control.** Each stored image is a
`<button type="button">` with a bound `alt` reading *Receipt image n of N*,
and there is no `target="_blank"` anchor left anywhere in the strip:

```js
document.querySelectorAll('.receipt-strip a[target="_blank"]').length;   // 0
```

Click a thumbnail → the viewer opens **over** the form.

**Pass — the stack.** Two dialog containers on the page, the form still
mounted underneath, and the viewer showing that thumbnail's own slot — not
the transaction's first image. **Close** → the viewer is gone and the form is
still open, still unsubmitted, with the values it had.

Leave the form by **Cancel**. Never Save.

**Pass — nothing left behind.** No dialog containers remain, the list has the
row count it started with, and the row is the one it was: the viewer reads a
transaction and writes nothing to it.

Two shots: the receipt strip in the form, and the viewer stacked over it.

### 24. Dashboard: the account's arrangement

`/dashboard`, desktop width — at least 1024px, the breakpoint the grid areas
below apply from.

Read the stored preference and the rendered order together, from the
console:

```js
ng.getComponent(document.querySelector('app-dashboard')).authService.currentUser()
  ?.preferences?.dashboardLayout;
[...document.querySelectorAll('.dashboard-grid > *')].map(el => el.tagName);
```

**Pass — the default account.** `dashboardLayout` is `undefined` and the DOM
order is Recent Transactions, Upcoming Bills, Spending by Category, AI
Insights, Budget Progress — `DASHBOARD_CARD_IDS`' own order, unmodified.
Then, in the console:

```js
const grid = document.querySelector('.dashboard-grid');
[grid.style.getPropertyValue('--dashboard-areas'),
  getComputedStyle(grid).gridTemplateAreas.replace(/'/g, '"')];
```

Both read `"chart recent" "insights upcoming" "insights budgets"` (quotes
normalised per [Panes and viewports](#panes-and-viewports) — the computed
value comes back double-quoted). That is `dashboardGridAreas()` fed the
default order: `chart` and `insights` form the main column, the rail is
`recent`, `upcoming`, `budgets`, and the areas pair main row *i* with rail
row *i*.

At 390px, or the pane's own width — see
[Panes and viewports](#panes-and-viewports):

```js
document.querySelector('.dashboard-grid').style.getPropertyValue('--dashboard-areas');
document.documentElement.scrollWidth === document.documentElement.clientWidth;
```

**Pass — the phone.** No named areas apply below the desktop breakpoint (the
custom property is still set, but nothing in the mobile stylesheet reads it),
the grid is one column, and the card elements appear in the same order top to
bottom as the DOM order read above — reading order and drawing order are the
same list. `true` on the width check.

Two shots: the desktop grid with its computed areas, and the phone stack.

### 25. The dashboard layout editor: hide, move, reset

The one journey in this section with a real write:
`preferences.dashboardLayout` on the account, restored to what it held
before the run — absent, for an account that has never customized the
dashboard, which is the case this journey is written against. An account
that already has a stored layout should read and keep that value aside first,
the way journey 19 keeps the exchange-rate cache, and write it back verbatim
at the end instead of relying on Reset to reach the same absent state.

Open the editor from the dashboard's own **Customize dashboard** link, or
`/settings?panel=dashboard` directly. The Dashboard panel is expanded and
Preferences is not.

**Pass — the starting rows.** Five rows in default order, each named by its
own title (`aria-labelledby`, not a bound `aria-label` — the house idiom),
all five switches on, **Reset** disabled (nothing stored yet).

**Hide.** Turn the **AI Insights** switch off.

**Pass — the write, and what it does not do.** The switch's own row reads
`aria-checked="false"`, the other four stay `true`, and **Reset** enables.
On `/dashboard`, `app-ai-summary` is gone from the grid, the remaining four
cards keep the account's order, and the areas recompute: a shortened main
column now repeats `chart` down the rows the rail still has, per
`dashboardGridAreas()`'s own rule. Read `sessionStorage`'s key count before
and after navigating to the dashboard with the card hidden — unchanged: a
hidden AI Insights card never ran the query that would have cached an
answer, which is the whole point of "a hidden card composes nothing."

**Move.** Back on the editor, press **Move up** on Upcoming Bills once.

**Pass — order, focus and the announcement.** The row moves ahead of Recent
Transactions; the live region reads *Upcoming Bills moved to position 1 of
5* (or the account's language for it); and because that press disabled
*that* row's own **Move up** (nothing left above it), focus lands on the
*same* row's **Move down** rather than staying on a button that just
disappeared under the pointer.

**Reload**, and read the stored preference again.

**Pass — persistence.** `preferences.dashboardLayout` survived the reload
with the order and the hidden set the two steps above produced, and the
dashboard renders that same arrangement.

**Reset.** Back on the editor, press **Reset**.

**Pass — a delete, not a write.** `dashboardLayout` is a document read that
comes back `undefined` — not the default order written out — **Reset**
disables again, and every row and switch is back to where journey 24 found
them. Reload once more and confirm the same absence.

Three shots: the AI Insights switch off with the dashboard beside it, the
moved row with its live-region text visible in the accessibility tree, and
the editor after Reset.

### 26. The dashboard layout editor at phone width, in both themes

390px, or the pane's own width where already narrower — see
[Panes and viewports](#panes-and-viewports). `/settings?panel=dashboard`.

**Pass — the fit.** Every row sits inside the viewport with no horizontal
page overflow (`scrollWidth === clientWidth` on the document element, as
journey 4 checks it); each row's drag handle, each **Move up**/**Move
down** and **Reset** measure at least 40px tall; each switch's touch target
does too.

**Pass — the themes.** Swap the root element's theme class the way journey
19 does —
`root.classList.add('dark-theme'); root.classList.remove('light-theme')`
is exactly what `ThemeService.applyTheme` does and nothing besides, never
the Settings theme control itself — and read a selected
switch's track and handle colour against an unselected one's, and an
enabled move button's colour against a disabled one's, in both dark and
light. Selected reads distinctly from unselected, and enabled distinctly
from disabled, in both themes. Restore the root's original classes when
done.

One shot: the editor at 390px, with every control's box visible.

### 27. The transaction form: a purchase split across categories

`/transactions`, the add-transaction dialog, any width. Expense, amount
NT$3, category Food & Drinks, description `e2e-27 split` — a description
nothing else in the account uses, so the restore step below can search on it
safely.

Press **Split across categories**.

**Pass — the first row.** One part row appears with its category unset and
its amount blank; the Goal field below the category picker is no longer
rendered, and the footer under the split section reads *"Every part needs a
category"* with `role="alert"`.

Set the row's category to **Home & Garden** and its amount to **1**.

**Pass — the remainder.** The footer switches to *"NT$2 stays on the main
category"*.

Press **Split across categories** again and set the second row to
**Transport**, amount **1**.

**Pass — the remainder recomputes.** The footer now reads *"NT$1 stays on
the main category"*.

Change the second row's amount to **3**.

**Pass — the invalid state, and the held submit.** The footer switches to
the invalid line, `role="alert"`, and the dialog's primary button disables
— a split that would leave nothing on the main category cannot be saved,
whole-purchase math or not.

Set the second row's amount back to **1**, then remove both rows.

**Pass — the goal field returns.** With no parts left, the Goal field is
back where it was and the footer is gone.

Add the two rows again — Home & Garden 1, Transport 1 — leaving NT$1 on
Food & Drinks, and press the dialog's submit.

**Pass — the write** (the one this journey is authorised to make; see
[What a run may touch](#what-a-run-may-touch)). The three new rows read
back — from the list or the console — as three NT$1 transactions: the
remainder row on Food & Drinks and two parts, all three sharing one
`splitGroupId` (the remainder row's own id) and one `createdAt`. The list
shows three new entries, each carrying the split badge next to its category
— `aria-label` *"Part of a split purchase"*, with `aria-hidden="false"`
written literally on the icon rather than only bound, which is the only way
`MatIcon` lets that label reach a screen reader. The dashboard's Spending
by Category chart credits Food & Drinks one more unit and shows a new Home
& Garden slice for the amount just added.

Open one of the parts for edit.

**Pass — the notice.** The row reads *"One part of a split purchase. Its
other parts are edited on their own,"* and the rest of the form still edits
that one row's own fields normally.

Delete each of the three rows through the list, one at a time.

**Pass — the confirmation, and the restore.** Each delete reads *"Delete
this part of \"e2e-27 split\"? Its other parts stay,"* naming the purchase
rather than the ordinary delete message. After the third, the list shows no
row for the description, the dashboard chart reads what it did before the
journey started, and the console shows no errors.

Three shots: the split section mid-entry with the remainder line showing,
the list with all three parts and their badges, and one delete confirmation
with its part-specific message.

### 28. Settings: the accessibility toggle-groups share their row

`/settings?panel=preferences`, the Accessibility group, default account,
default font scale.

Read the three `mat-button-toggle` segments of `.font-scale-toggle` and the
group itself from the console:

```js
const group = document.querySelector('.font-scale-toggle');
[...group.querySelectorAll('mat-button-toggle')].map(el => el.getBoundingClientRect());
group.getBoundingClientRect();
```

**Pass — the distribution.** The three segments' widths agree to within
about a pixel of each other — the sub-pixel remainder a shared divider
border leaves between adjacent `flex: 1` segments, not a gap in the fix —
and the last segment's right edge sits at the group's own right edge. Read
`scrollWidth` against `clientWidth` on the group: equal, so no label is
clipped or pushed onto a scrollbar.

**Pass — the theme toggle beside it.** The same measurement taken on
`.theme-section`'s own `mat-button-toggle-group` shows the same equal
distribution — both toggle-groups this app has share their row identically,
not only the one this fix touched first.

This journey is not where the Extra-large label wrap and the checkmark's
removal below 420px are proven — a pane resized that narrow is exactly the
case [Panes and viewports](#panes-and-viewports) warns is unreliable under a
hidden pane, and both groups' container queries need a container width no
ordinary run reaches. `accessibility-settings.overflow.spec.ts` measures
that case directly, at the two host widths the group has to fit inside
across all three font catalogs — see [docs/accessibility.md](accessibility.md)
and [docs/ui-overflow.md](ui-overflow.md) for what it pins and why a spec
rather than this protocol is where it belongs.

One shot: the two toggle groups side by side at their default width.

### 29. The repaired grids at tablet and desktop

Any account. Eleven grid declarations were invalid and dropped at parse time,
so six pages rendered one column wherever the rule applied. The rules start at
600, 768 and 1024px; Karma's window is 756px, so three of them cannot be read
as layout in a spec at all — this is where the render is proved.

The pane is narrower than 1024px, so set the width and read the DOM inside the
one turn ([Panes and viewports](#panes-and-viewports)). For each grid:

```js
getComputedStyle(document.querySelector('.summary-cards')).gridTemplateColumns;
```

**Pass — Reports.** At 768px: `.summary-cards` 3 tracks, `.stats-grid` 4,
`.summary-stats` 2. At 1280px: 3, 4 and 4 — the last is the one whose 1024px
rule no spec can see.

**Pass — Settings and AI.** At 1280px, `/settings` `.settings-grid` reads 2
tracks; `/ai` reads 3 on `.provider-preferences-grid` and 2 on
`.info-cards-grid`.

**Pass — Transactions.** The filter panel opens through its own signal
(`ng.getComponent(document.querySelector('app-transaction-filters'))
.expanded.set(true)`) rather than a click, because the grid is what is being
read, not the trigger. `.filter-grid` reads 6 tracks at 1280px and 3 at 768px.

A track count of 1 anywhere above is the defect: the declaration was dropped
and the mobile default is what is painting.

Four shots: Reports at both widths, the two settings pages at 1280, and the
open filter panel.

### 30. The tab strips scroll

`/budgets` (three tabs) and `/reports` (five) at the pane's own 375px width.
Pointer input stalls under emulation ([Panes and viewports](#panes-and-viewports)),
so the scroll itself is set by script; the keys are real and are sent from the
focused tab, because Material's keydown listener sits on the label container
and an event dispatched on the header element never reaches it.

```js
const strip = document.querySelector('.mat-mdc-tab-label-container');
getComputedStyle(strip).overflowX;                         // 'auto'
getComputedStyle(document.querySelector('.mat-mdc-tab-header')).transform;
document.querySelectorAll('.mat-mdc-tab-header-pagination').length;
```

**Pass — no pagination.** The chevrons compute to `display: none` and the
header carries no pagination class; the header's own `transform` reads `none`,
so nothing is being paged. `scrollbar-width` is `thin`, not `none`.

**Pass — it scrolls, and a selection is revealed.** Setting `scrollLeft = 200`
on budgets lands at 183.5, the strip's own maximum — it really is a scroller
with a real end. Selecting the last tab (Goals) brings it into view, and a
click on the last tab after scrolling to the end leaves it in view rather than
snapping back to 0. On reports, selecting Forecast reveals it at 405.5.

**Pass — the keyboard.** Four `ArrowRight` presses from the focused tab move
focus 1 → 4, each landing tab inside the strip's box, with `scrollLeft`
0 → 111 → 258 → 406. This is the case Material's own focus reset breaks: it
writes `scrollLeft = 0` after every focus change, so without the microtask
correction the strip would return to the start on each press.

**Pass — desktop at the account's scale.** Reports at 1280px and scale 1.3:
the label list measures 1170px inside a 968px container — genuinely
overflowing — with still no chevrons, and the strip scrolls.

Three shots: both strips at 375px mid-scroll, and the reports strip
overflowing at 1280.

### 31. Every route at the account's own font scale

The account's own `--app-font-scale` is 1.3, which is what a reload renders.
Compare against 1.0 by overriding the inline variable on `documentElement`
inside the same turn — it persists nothing:

```js
document.documentElement.style.setProperty('--app-font-scale', '1.0');
```

Walk `/dashboard`, `/transactions`, `/budgets`, `/reports`, `/settings`, `/ai`
and `/import/history` at 375px, at both scales, in both themes.

**Pass — the nav labels keep a gutter.** At 1.3 the three gaps between the
bottom nav's labels measure 8, 61.3 and 20.1px, with every label inside its
own item's box and one of them fitted down to 14.7px by `appFitText`. At 1.0
the gaps are 18.4, 73 and 37.4px and no label is fitted. The number that
matters is that the smallest gap is not zero: before the gutter, two fitted
labels sat flush.

**Pass — a four-digit amount stays on the row.** Four rows carrying
four-digit amounts render them unwrapped beside their descriptions at both
scales. A wrapped amount here means the description's floor is in `rem` again.

**Pass — the model names wrap whole.** On `/ai`, all four select triggers wrap
to two lines with no ellipsis, each value's `scrollWidth` equal to its
`clientWidth` (227/227).

**Pass — the period picker keeps its row.** On `/dashboard` at 1.3 the toggle
group (271px), the 8px gap and the calendar button (56px) total 335 and share
one row; at 1.0 the toggle sits at its own content width (240px) rather than
stretching to fill.

Four shots: the nav at 375/1.3, a list of four-digit amounts, the AI selects
wrapped, and the period row at 1.3.

### 32. The papercuts: targets, floors and a fallback

`/transactions` at 768px, `/budgets` and `/settings` at 375px, the sidebar at
1280px. Read boxes, not pictures.

**Pass — the desktop table fits.** `.table-scroll` reads `scrollWidth` equal to
`clientWidth` (712/712). The 712 is the *pane's* number, not the app's: the
pane's `.main-container` is 760px of a 768px viewport, an 8px scrollbar. The
stylesheet's floor is 704, which leaves room for a classic 16px scrollbar too,
so it fits here and on the platforms that draw a wider one.

**Pass — the sidebar does not scroll sideways.** At 1280px the nav reads
255/255 with each row 239px wide. Before `width: auto`, Material's own
`width: 100%` sized the row to the nav *plus* its margins.

**Pass — the targets.** The budget card's menu button measures 52×52 at the
account's 1.3 (`w-10` is rem-based, so 40 at 1.0) — met by its own box. In the
table, the note button and the actions trigger each have a 32px glyph box and
a 40px `::after` hit box, *and* a `.mat-mdc-button-touch-target` span that
Material ships at 48×48 with `display: block` — so those two already had a
target and the overhang is belt-and-braces. The receipt icon is the real gain:
an 18px glyph on a plain `<button>` with no Material target at all.

**Pass — the avatar falls back.** Dispatch an `error` event on the photo in
the header and again on the settings card: each swaps to its placeholder,
and resetting the source signal puts the image back. Flush each component
(`ng.applyChanges(ng.getComponent(el))`) before reading — a hidden pane paints
nothing on its own.

Four shots: the table at its floor, the sidebar at 1280, the budget card's
menu button at 1.3, and both avatars fallen back.

### 33. Import review: the duplicate check reads the account

`/import`, with the session deliberately *not* having browsed the window the
twin lives in. Build a one-row CSV in the page that copies a real expense from
three months back — the same date, description and amount — and hand it to the
dropzone's hidden input as a `File` ([Fixtures](#fixtures)); a pane cannot open
a file picker.

The point is the cache. A listener's first emission holds whatever this
session browsed, and the twin is outside it — so before #427 this row came
back clean and the import would have written a second copy.

**Pass — the banner stands and Continue is held.** Processing resolves one
row, and the review step raises the duplicate banner with **Exclude all
duplicates** and **Include anyway**, holding Continue until one is chosen.

**Pass — nothing is written.** Leave by the back arrow, not by continuing; no
confirmation dialog appears. `/transactions` still shows the same count it did
before the journey, and `/import/history` still shows its previous record
count with the same newest entry. Like every other import journey this one
leaves before Import, so what it costs the account is the CSV door's own
categorization call and nothing else — see
[What a run may touch](#what-a-run-may-touch).

One shot: the review step with the duplicate banner standing.

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
