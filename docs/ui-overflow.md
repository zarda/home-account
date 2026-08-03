# Overflow: what the app does when content does not fit

The rule is that **nothing truncates**. Text reflows onto more lines; a value
that has to stay on one line scales down to a 12px floor and only then wraps.
No ellipsis, nothing clipped away, no control pushed out of reach.

Why it is that rule rather than an ellipsis, and what was rejected on the way,
is in [ADR 0009](ADR/0009-nothing-truncates.md). This document is the part you
need when adding a screen.

## The five invariants

Each is written so it can be checked, because a rule nobody can check is a rule
that quietly stops being true.

---

### G1 — Every flex or grid item holding user data declares its minimum

`min-width: auto` is the default, and it floors an item at its own min-content
size — a promise the container may not be able to keep. The item then refuses
to shrink and pushes its neighbour out of the box instead, which in this app is
usually a button.

Say which one it is:

```scss
.details { flex: 1; min-width: 0; }        // I may shrink to nothing; I reflow
.amount  { flex-shrink: 0; max-width: 50%; } // I keep my content; cap me instead
```

**Check:** every `flex: 1` / `flex: 1 1 …` block contains a `min-width` or a
`max-width`.

**Corollary.** In any row with an unshrinkable trailing control, the sum of
everything that will not yield — fixed widths, gaps, caps — must be under the
narrowest container the row ships in. Write the arithmetic in a comment; see
the top of `transaction-row.component.scss`, which shows where its 7rem floor
comes from.

---

### G2 — `1fr` is never written bare, and `minmax(0, 1fr)` is not always the fix

`repeat(N, 1fr)` means `repeat(N, minmax(auto, 1fr))`, and that `auto` floors
each track at its min-content size. Same defect as G1, one layout mode over.

Which fix depends on what is in the track:

| Track holds | Use |
|---|---|
| text — form fields, cards, stat tiles | `repeat(N, minmax(0, 1fr))` |
| a fixed-size child — icon buttons, swatches | `repeat(auto-fill, minmax(<child>, 1fr))` |

Getting that backwards makes things worse, and the app has a worked example.
`.icons-grid` in the category dialog is five 44px buttons: min-content is
5×44 + 4×8 = 252px, and the dialog is 288px wide on a 320px screen before its
own padding. `minmax(0, 1fr)` gives 41.6px tracks and clips every button.
`auto-fill` drops a column instead, and the button keeps its touch target.

**Check:**

```bash
grep -rn "grid-template-columns" src --include='*.scss' | grep "1fr" | grep -v "minmax("
```

comes back empty.

---

### G3 — Nothing truncates

No `text-overflow: ellipsis`. Text wraps, with `overflow-wrap: anywhere` where
the content may contain an unbreakable run such as a pasted URL. A value that
must not break carries `appFitText` and scales to 12px — `--text-xs`, the floor
the type scale already declares — and wraps only past that.

**`anywhere`, not `break-word`.** Only `anywhere` reduces an element's
min-content size. `break-word` leaves the element still refusing to shrink,
still pushing its neighbours out, and looking like a fix.

**Two corollaries worth knowing, because they made three rules in this app dead
code for a long time:**

- `text-overflow` has no effect on a flex or grid container. A rule that sets
  both `display: flex` and `text-overflow` does nothing.
- A bare text node inside a flex container is an *anonymous flex item*. No
  selector reaches it, and `min-width: 0` on the parent does not apply to it.
  If you need to style the text, wrap it in an element.

**Check:** no rule sets both `display: (inline-)flex|grid` and `text-overflow`.

---

### G4 — Nothing is clipped that cannot be reached another way

Every `overflow: hidden` is paired with either a scroll affordance or a visible
indicator, and no interactive element sits in the clipped region.

- `overflow-x: hidden` does not prevent overflow, it destroys the evidence.
- **It also does more than you asked.** When one axis is not `visible`, the
  other computes from `visible` to `auto` — so `overflow-x: hidden` silently
  makes the box a *vertical* scroll container.
- Never hide a scrollbar. It is the only thing telling the reader there is more
  off the edge.
- An overflow indicator (`+3`, a fade) gets `flex-shrink: 0`. It has to outlive
  the things it counts, or a visible truncation becomes a silent one.

**Check:** no `scrollbar-width: none` or `::-webkit-scrollbar { display: none }`
on a scrolling element.

**Check, specific to this app:** no `overflow-x: auto` on any **ancestor** of
`app-transaction-list`. `findScrollParent` walks up for the first vertically
scrolling ancestor and adopts it as the sliding window's paging root; the rule
above means an `overflow-x` up there becomes one, and paging stops with no
error. `transaction-overflow.smoke.spec.ts` asserts the root is still
`.main-container`.

---

### G5 — Screen-sized boxes use `dvh` and inset by `--safe-*`

iOS resolves `vh` against the *largest* viewport — the one with Safari's
toolbars collapsed — so a `vh`-sized box is taller than what is on screen
whenever they are showing.

```scss
min-height: 100vh; // fallback where dvh is unsupported
min-height: 100dvh;
```

Every full-bleed or `position: fixed` box pads by `max(<gutter>, var(--safe-…))`
on each edge it touches. **The larger, never the sum** — a gutter already wider
than the inset costs nothing, and adding them indents the content twice. Exactly
one element owns each inset.

Read the **variables**, never `env(safe-area-inset-*)` directly. That
indirection is what makes the behaviour testable: `env()` cannot be overridden
from a stylesheet, a custom property can, and these insets are 0px on every
machine CI runs on. `safe-area.spec.ts` depends on it.

**Check:** every `[0-9]vh` is immediately followed by a `dvh` line; every
`position: fixed` block references a `--safe-*` or is nested inside one that
does.

---

## Where each rule is enforced

| | |
|---|---|
| `shared/directives/fit-text.directive.spec.ts` | the directive: scales, floors at 12px, writes nothing when the value fits, does not oscillate |
| `shared/overflow-guard.spec.ts` | a hostile row keeps its menu, amount and `+N` inside the clipping card — and an ordinary row still does not reflow at 375px |
| `shared/safe-area.spec.ts` | `max()` not sum; one owner per inset |
| `features/transactions/transaction-overflow.smoke.spec.ts` | the same on a real page, plus the paging root |
| `docs/ui-audit/tools/capture-overflow.mjs` | five pages × seven widths × (en, ja, faked insets), run before/after a layout change |

The first four run in CI. The harness needs a dev server and the emulators, so
it is a before/after instrument for UI pull requests, like `capture-dialogs.mjs`.

## Using `appFitText`

Put `white-space: nowrap` on the host in the component's stylesheet — the
directive writes no style at all while the value fits, so the nowrap has to
come from the cascade.

```html
<span class="amount" appFitText>{{ formatAmount() }}</span>
```

It measures in a batched pass rather than during change detection, shares one
`ResizeObserver` across the app, and skips the DOM write entirely in the common
case. Use it for values that must not break: amounts, the header wordmark,
navigation labels. Do not use it for prose — prose should wrap.
