# 98. The browser journeys are a driven protocol, not a suite

**Status:** Accepted, implemented · **Date:** 2026-09-02

Reference documentation lives in [../e2e.md](../e2e.md).

## Context

No issue asks for this. It is a decision about how the repo tests itself,
taken because a branch needed evidence none of the existing layers could
produce.

Three layers of automated evidence already exist, and each is good at
something the others are not.

**Unit specs** run every pure function and every component in a TestBed. They
are where a week boundary, a plural form, a storage key or a folded figure is
decided, and they are the cheapest thing in the repo.

**The emulator smoke suite** runs the real services against the Firebase
emulators. For rules verdicts, query semantics and real reads and writes it is
the strongest evidence the repo produces —
[emulator-blind-spots.md](../emulator-blind-spots.md) is the honest list of
what it still cannot see.

**The screenshot harness** (`docs/ui-audit/tools/`) renders a seeded demo
account against the emulators, at two widths, in both themes, and is the right
instrument for pixel evidence across pages.

None of the three drives a journey. A journey is what a person does: open the
list, press a control, cross into a dialog, cross again into a form, and read
what came back. The three layers each stop at a boundary the journey does not:
the unit specs never leave one component, the smoke suite never renders one,
and the harness renders every page but visits them by URL, with no real
session, no provider key and no deployed rules behind it.

Two of this branch's surfaces made that gap concrete. A translation is only
proved by a real prompt reaching a real provider under a real key and coming
back parsed — the one thing every stub in the repo is built to avoid. A
preference write is only proved by landing on the real user document and being
read back through the deployed rules, which is precisely the class the
emulator cannot vouch for.

## Decision

**The journeys are written down and driven by a person, in a browser, against
the running app.** [e2e.md](../e2e.md) is the runbook: each journey names its
steps, the result that counts as a pass, and the screenshots to take. It is a
protocol, not a suite — it does not run in CI, and nothing goes red.

**Twice per branch.** Once as soon as the surfaces exist, so a defect is fixed
in the commit that owns the surface rather than layered on afterwards; once on
the final tree, for the evidence attached to the pull request. Screenshots go
to a scratch folder outside the repository and are attached to the PR;
committing them would add a folder of screenshots for every branch that ever
runs the protocol, and only curated evidence belongs under `docs/ui-audit/`.

**The run is a reader with three named writes, and it puts all three back.**
Because the dev server serves whatever checkout it was started from with that
checkout's own `.vscode/environment.ts`, on a developer machine it serves the
real project against the developer's own session. The rows on screen are real
transactions. So the writes are enumerated rather than assumed: the weekly
recap preference, the note-translation provider preference, and the provider
call a translation makes — which writes nothing but does spend the account's
own key. Each has a restore step, confirmed on screen rather than assumed, and
the recap's device-local keys are cleared from the page console at the end,
since switching the preference off does not remove them.

**Two silent traps own two mandatory checks before every run.** Neither is
theoretical, and both fail in the direction of a green run against the wrong
app.

- *The server is serving something else.* It serves the checkout it was
  started from — usually the main one, on whatever branch that happens to be —
  and a stale build cache shows yesterday's app with today's confidence. The
  check is to read the server's working directory, and then to find something
  the branch added *in the served page* rather than trusting the checkout.
- *The bundle names a different project.* The same browser is also used
  against the seeded demo project. The check reads the project id out of every
  script the page actually loaded and expects exactly the production one. A
  demo screen read as production is the more expensive mistake of the two.

A third check is a reading rule rather than a gate: judge the console by the
difference across a reload, not by its contents, because the share-target
worker re-registers on every web boot and the browser keeps entries across
reloads.

**A step that could be a spec is deleted from here and written as one.** The
protocol keeps only what needs a real browser, a real session and real data:
the router crossing with the overlay stack on top of it, layout at phone width
where a dialog either fits or does not, the wire, and a real preference write
read back through the deployed rules.

Rejected: **an automated suite over a committed emulator configuration.** The
design is known and was worked out in full: a committed environment file
behind a `useEmulators` gate, the seeded demo account the screenshot harness
already builds, the model stubbed at the wire so the answer is deterministic,
and a CI step to run it. It is the right answer to one question this protocol
cannot answer — *does a journey still pass when nobody is watching* — and it
is the wrong answer today for three reasons. Stubbing the model at the wire
removes the only thing the translation journeys exist to prove. The demo
account has no deployed rules behind it, so the preference journeys lose their
point too. And the journeys themselves are one branch old; automating a
walkthrough that is still changing shape means maintaining a suite that
mostly reports its own staleness. **Revisit it when a journey has to gate a
merge without a person present, and take it on once the protocol has run a few
branches and its journeys have stopped moving** — at that point the steps are
stable enough to be worth encoding, and the parts that need the wire can stay
here while the rest goes green in CI.

Rejected: **a real model in an automated test.** Every run costs the account's
own key, and the answer is different every time, so the assertion has to be so
loose it proves little — with a bill and a flake attached.

Rejected: **driving the live site without the two checks.** That is the same
run with the evidence removed: a pass that cannot say which app it passed
against. It is also why the protocol says plainly that the site is production
and that a run is a reader.

## Consequences

- The protocol has a home in the repository and is extended by the branch that
  adds a surface no spec can reach, rather than being re-derived each time.
- Every branch that touches a driven surface owes two runs and a set of
  screenshots on its pull request. That is the cost, stated up front.
- `emulator-blind-spots.md` gains an entry for the browser layer, so the list
  of what each layer cannot see stays complete.

## Things that only became apparent while building

These are properties of the surface the journeys are driven through, not of
the app, and they cost a run each before they were understood.

- **Pointer input can stall under viewport emulation, and stay stalled.** With
  an emulated width in force, clicks stop landing and go on not landing until
  the page is reloaded. Run the phone journey at the pane's own width when it
  is narrow enough, and reload before concluding that a control is broken.
- **Screenshots can freeze under a scaled emulation** — the image returned is
  the one from before the last interaction, which reads as a control that did
  nothing.
- **Desktop-only doors need a genuinely wide surface.** The list swaps to the
  table at 768px, so the row's note icon simply does not exist in a narrower
  pane, and the journey silently becomes the phone one.
- **The console log persists across reloads**, so a clean boot does not look
  like an empty console. Only entries new since the reload count.
- **A network log may record same-origin requests only.** A provider call goes
  to a third-party host and can be absent from it entirely, so the log cannot
  be used as proof that the request happened — the translated text on screen
  is the proof.

## Known gaps

- **Nothing enforces that the protocol ran.** It is a reviewer's expectation
  and a checklist, not a gate; a branch can merge without it.
- **A journey is only as good as its data.** The recap journey needs a week
  with something in it, and the provider journey needs more than one key
  configured. Both are recorded as skipped rather than faked.
- **The run leaves the browser in a state the protocol has to undo by hand.**
  The restores and the device-key clear are steps in a document, and a run
  abandoned halfway leaves them undone.
