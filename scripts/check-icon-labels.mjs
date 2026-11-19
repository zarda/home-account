#!/usr/bin/env node
/**
 * Catches a `<mat-icon>` that carries an accessible name and is announced to
 * nobody.
 *
 * Angular Material's MatIcon sets `aria-hidden="true"` on its own host
 * element in its constructor, unless the template carries a *literal*
 * `aria-hidden` attribute. It reads that attribute through
 * `HostAttributeToken`, which sees the static text in the template and
 * nothing else — so `[attr.aria-hidden]="…"` does not satisfy it, and
 * neither does `role="img"` or `[attr.aria-label]`. An icon written to be
 * read is therefore hidden from the reader it was written for, and every
 * signal that something is wrong points the other way: the role is right,
 * the label is right, the tooltip works for a sighted user, and the rendered
 * DOM only disagrees at runtime.
 *
 * Three icons in this tree had exactly that shape — the amount and date
 * verification flags on the transaction form and the amount flag on the
 * import review card — and each was the only thing telling a screen-reader
 * user that a scanned figure needed checking. The correct spelling was
 * already here twice, on the split indicator in `transaction-list` and
 * `transaction-row`, so this is a class that had been met, solved, and never
 * swept for.
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - **The rule keys on `mat-icon`, not on `role="img"`.** A `role="img"`
 *     on any other element is fine as written: nothing runs a constructor
 *     that hides it. `category-suggestion.component.html`'s confidence dot
 *     is a `<span role="img">` with a bound label and no `aria-hidden`, and
 *     it is correct. A rule scoped to the role would fail it and teach the
 *     next person to add a pointless attribute.
 *
 *   - **Any literal `aria-hidden` counts, whatever its value.** Not just
 *     `"false"`. An icon that carries a label *and* a literal
 *     `aria-hidden="true"` is a deliberate choice, and the tree has two of
 *     them: the date and currency flags on the import review card sit inside
 *     a button that carries its own `[attr.aria-label]`, so hiding the icon
 *     is what stops the button being announced twice. Demanding `"false"`
 *     would fail both and the fix would make the card worse.
 *
 *   - **An unlabelled icon is not this gate's business.** A decorative icon
 *     with no name needs nothing; MatIcon's default is already right for it.
 *     This checks only the icons that went to the trouble of having a name.
 *
 *   - **A source scan rather than a spec.** The defect is an interaction
 *     between a constructor and a template's literal text, so a Karma
 *     assertion has to instantiate the owning component to see one — and the
 *     three sites live in two components whose specs both blanked their
 *     templates, which is how all three survived. Reading the source catches
 *     every site, including the one added next month by the same copy-paste.
 *
 * What it deliberately cannot see:
 *   - An icon whose attributes arrive from a directive's host bindings or a
 *     spread rather than the template's own text. MatIcon reads the static
 *     attribute, so such an icon is hidden too, but there is no text pattern
 *     for it.
 *   - Whether a label is any *good*. An `aria-label` bound to an expression
 *     that resolves to an empty string passes here and announces nothing —
 *     the inverse defect, and one no source scan can judge.
 *   - `aria-labelledby`. It names another element as the accessible name and
 *     is not in use on any icon in this tree; adding it would need the same
 *     literal `aria-hidden`, and this gate would not say so.
 *   - An `<svg>` or `<i>` used as an icon instead of `<mat-icon>`. Nothing
 *     hides those, so nothing needs to un-hide them.
 *   - A `mat-icon` inside a string that is not a template at all — a test
 *     fixture in a `.spec.ts`, say. Spec files are skipped for that reason.
 *
 * A second, unrelated defect shares this file because it shares the shape:
 * Angular Material's `mat-spinner`, `mat-progress-bar` and
 * `mat-progress-spinner` all render `role="progressbar"` and none of them
 * takes a name from anywhere — unlike a button or a heading, a progressbar's
 * accessible name has no content to fall back to, so a bare one is silent by
 * construction, on every route, for as long as it is on screen. The fix is
 * either of two things, and only a human reading the surrounding markup can
 * choose which: a translated `[attr.aria-label]`, when the indicator is the
 * only thing saying work is happening; or a literal `aria-hidden="true"`,
 * when it sits inside a button or a `role="status"` that already carries
 * visible text and naming the indicator too would announce the same state
 * twice. This rule only checks that ONE of those two escape hatches was
 * used — same as the icon rule, it cannot tell a good `aria-label` from an
 * empty one, and it cannot tell whether the control an `aria-hidden`
 * indicator sits inside is actually the one announcing the state, only that
 * something declared the choice deliberately.
 *
 * A third rule keeps an option's icon out of its name. MatOption projects a
 * `mat-icon` that is its own direct child into a slot beside its label, and
 * everything else into the label, whose text is the option's `viewValue`:
 * what a closed select shows, what typeahead matches and what the trigger
 * announces. An icon wrapped in a `<div>` or `<span>` with the name goes into
 * the label with it, so its ligature leads the name. Four category selects
 * had that shape: typeahead matched icon names on all four, and the split
 * part's closed field read "restaurantFood". The open list looked right,
 * because the icon font draws the ligature as a glyph. The rule: inside a
 * `mat-option`, a `mat-icon` has no element between it and the option.
 * Control-flow blocks are not elements and do not count — a block whose only
 * root is the icon is projected as the icon.
 *
 * What it cannot see: a block that holds the icon beside other nodes, which
 * Angular projects as a whole into the label; and an `ngProjectAs` wrapper,
 * which it flags although it would be projected into the icon's slot.
 *
 * A fourth rule keeps a repeated menu button from sharing one name. An
 * overflow button is a single glyph, so its `aria-label` is its whole name,
 * and `common.moreActions` names no item: every copy says "More actions". In
 * a list, a screen reader moving from button to button hears the same name
 * down the page and nothing that says which row the menu edits or deletes.
 * Four lists had that shape — the desktop transaction table, the budget
 * cards, the recurring rules and the category manager — while the phone
 * transaction row beside the first already named its row with
 * `common.moreActionsFor`. The rule: a `matMenuTriggerFor` element stamped
 * once per item does not take its name from `common.moreActions`, with or
 * without parameters (the sentence has no slot for one).
 *
 *   - **"Once per item" is read two ways.** Inside the template, the element
 *     sits in an `@for` block, or on or under an element carrying `*ngFor`,
 *     `*cdkVirtualFor` or a table's `*matCellDef` / `*matRowDef`. Across
 *     templates, the element belongs to a component whose selector another
 *     template stamps that way, or uses at all inside a component that is
 *     itself repeated. The budget card's button sits in no repeat in its own
 *     template; the overview's `@for` is what repeats it, and a per-file scan
 *     would pass it.
 *   - **A trigger rendered once may keep "More actions".** A single page
 *     menu has nothing to be told apart from, and failing it would teach the
 *     next person to invent an item for it.
 *   - **It errs toward "repeated".** An `@for` whose `@switch` or `@if`
 *     renders a given branch once still counts: the dashboard's arranged
 *     cards, and the bottom bar's add button among its links. A menu there
 *     that one day says "More actions" sits beside other cards' menus that
 *     would say the same.
 *
 * What it cannot see: a name built in TypeScript and bound as an expression;
 * a component stamped through `NgComponentOutlet`, a dialog or a router
 * outlet rather than by its selector; and a repeat written as
 * `<ng-template ngFor>`. A trigger with no `aria-label` at all, whose name
 * comes from its text, is the sixth rule's, below, as is any other key that
 * names no item.
 *
 * A fifth rule puts a flag's tooltip within reach of the keyboard. MatTooltip
 * opens for a pointer and for keyboard focus, and a `mat-icon` takes focus
 * from nothing: without a `tabindex` its sentence is shown to the mouse and to
 * a screen reader's browse mode, and to nobody who reaches the field by Tab.
 * Three flags had that shape — the form's amount and date flags and the review
 * card's amount flag — and their sentence is the whole reason the figure is
 * marked. The rule: a `mat-icon` with a `matTooltip`, a name and a literal
 * `aria-hidden="false"` carries a literal `tabindex`.
 *
 *   - **Only an icon that is named and un-hidden.** One with a literal
 *     `aria-hidden="true"` is decoration inside a control that already takes
 *     focus and already names itself: the form's type flag sits in its
 *     segment, whose own name carries the sentence. One with no literal
 *     `aria-hidden` at all fails the first rule and is reported once, there.
 *   - **An `<ng-template>` around the icon exempts it.** The wizard's seal
 *     icon is stamped through an outlet into a step header, which is the
 *     `role="tab"` control and the tab stop; a second stop inside it would nest
 *     a focusable element in a tab.
 *   - **Any literal `tabindex` counts, whatever its value**, as any literal
 *     `aria-hidden` does above; the bound forms do not, because this gate
 *     cannot evaluate them.
 *
 * What it cannot see: a tooltip that arrives from a directive's host binding;
 * a `tabindex="-1"`, which is literal and passes although Tab skips it; and
 * whether the icon's ancestors are themselves the tab stop.
 *
 * A sixth rule widens the fourth from one key on one kind of control to any.
 * A control stamped once per item whose `aria-label` is a catalog key with no
 * parameters gives every copy the same name, and so does one with no
 * `aria-label` whose own text is such a key. The upload area had that shape:
 * each file's row read "Move up", "Move down" and "Remove", and two photos
 * from an iPhone are both image.jpg, so neither the buttons nor the rows could
 * be told apart by ear. The rule: a control stamped once per item, by its own
 * template or by another's, does not take its whole name from one key with no
 * parameters, or from a ternary between two such keys, piped once after it or
 * in each branch; bound (`[attr.aria-label]="'key' | translate"`) or
 * interpolated (`aria-label="{{ 'key' | translate }}"`), either is bare. A
 * ternary with parameters on either branch passes.
 *
 *   - **Only a control.** A button, a link, a form field, a Material toggle
 *     or an element with a control's literal `role`: what a user acts on, so
 *     what the name has to tell apart. A repeated status — the split
 *     indicator's icon, a row's spinner — says the same thing of every item
 *     and may say it in the same words.
 *   - **Only a key with nothing beside it.** A key given parameters has a
 *     slot for the item, and a key computed from the item
 *     (`iconNameKeys[icon] | translate`) names it through the key. Whether a
 *     slot is filled with something that tells the items apart is a reading
 *     question: two photos named image.jpg need their place as well.
 *   - **A ternary between two such keys is one of them.**
 *     `(pinned ? 'a.unpin' : 'a.pin') | translate`, or the pipe in each
 *     branch, gives every copy one of two names, neither of which says which
 *     item it acts on: the search history's pin buttons had that shape. A
 *     ternary with parameters on either branch, or on the pipe after it, has
 *     a slot.
 *   - **A control's own text is read too (readOwnTexts).** A link, a button,
 *     a Material toggle or an element with a control's role takes its name
 *     from what it holds when no `aria-label` or `aria-labelledby` names it,
 *     in any spelling, and text that is one key with no parameters, or a
 *     ternary between two, names no item as such a label does: every
 *     transaction row's swipe drawer read "Edit" and "Delete". The text is
 *     every run the control holds, its descendants' included, outside a
 *     `mat-icon` (MatIcon hides its ligature) and outside an element with a
 *     literal `aria-hidden="true"`, with control-flow syntax taken out; it
 *     is bare when what is left is that one interpolation. An `<img>` whose
 *     alt is not empty and a component add to the name as the eighth rule
 *     reads them, so a key beside one is not bare. walkTemplate reads
 *     opening tags only, so the text pass keeps its own stack of open
 *     elements. Each control records where its name comes from, `via:
 *     'label'` or `via: 'text'`, and both kinds feed the same tally across
 *     templates and the same freeze: a key is one name, however a control
 *     comes by it, so the dashboard's two View All links, one in each of two
 *     cards, are two cases of one switch reaching one key. A text hit is
 *     reported at the control's opening tag, since its text may run over
 *     several lines, and its fix has a hint of its own: keep the visible
 *     words, add the item, in an `aria-label` whose sentence holds them, so a
 *     speech user can say what they see (WCAG 2.5.3).
 *   - **Two text-named controls are exempt.** One inside a `<mat-menu>`: its
 *     panel is open only for the one trigger that opened it, and that trigger
 *     is already held to name its item, by the fourth rule and this one. That
 *     holds for a menu stamped once per item, and not for a control a repeat
 *     inside the menu stamps: its copies share the one open panel under one
 *     name, so it is read. A control named by its `aria-label` is read inside
 *     a menu as anywhere.
 *     And one with a bound `aria-describedby` (`[attr.aria-describedby]`,
 *     `[aria-describedby]`, or a literal that interpolates,
 *     `aria-describedby="{{ r.hintId }}"`): the household's six buttons are
 *     named by what they do and described by their item. That second
 *     exemption is a Known gap, not a pattern to copy: a description is read
 *     after the name, after a pause or not at all, and a name that holds the
 *     item is still the better fix. A literal `aria-describedby` with no
 *     interpolation points every copy at one element, so it exempts nothing.
 *   - **"Once per item" is read two ways, as the fourth rule reads it.**
 *     Inside the template, an `@for` block or an element under a repeating
 *     structural directive. Across templates, a component another template
 *     stamps that way: the goals page stamps one card per goal, so the goal
 *     card's Edit and Delete are repeated although nothing repeats in the
 *     card's own template.
 *   - **An `@case` on the `@for`'s own item is held apart.** The fourth
 *     rule's reading errs toward "repeated", and here that would flag
 *     controls rendered once: the dashboard's `@for` stamps each card through
 *     an `@switch (card)`, so each `@case` renders for the one item that
 *     matches it, and the insights card's Refresh is one button on the page.
 *     An `@case` under an `@switch` whose subject is the nearest `@for`'s item
 *     lifts that `@for`, inside the template and across it. What two or
 *     more of the switch's cases reach still repeats, whether a component's
 *     selector or a control under one bare key, and whether a case writes it
 *     or reaches it through a component it stamps, at any depth: every card
 *     that reaches one of those cases renders a copy, so the page holds one
 *     copy per such card. The card menu is a selector the cases write, into
 *     all five cards; the empty state is one they reach, through four of the
 *     cards they stamp. The tally is per switch and per selector or key
 *     (heldApartAcross). An `@default`, an `@switch` on something the item
 *     holds (`c.kind`) and an outer `@for` around the switch's own still
 *     repeat. The fourth rule reads every `@for` as repeating, as before.
 *   - **A menu trigger the fourth rule reports is reported there**, once.
 *   - **What it found and could not fix is frozen** in ITEMLESS_FROZEN, by
 *     file and key with how many controls carry that key there (ADR 0145's
 *     floor), the way check-i18n.mjs counts its English fallbacks. A hit no
 *     row names fails, and so does a row whose count is not the tally: one
 *     more control named by a frozen key, or one fixed and still on the
 *     books. An edit that only moves a frozen control leaves the list alone.
 *
 * What it cannot see: a name built in TypeScript; a ternary nested in
 * another, or with a branch that is not a quoted key; a label wrapped whole
 * in parentheses, or a branch in doubled parentheses; a component stamped
 * through an outlet or a dialog rather than by its selector, as the fourth
 * rule cannot; a selector or key that two switches on the same item each
 * reach in one case, since the tally counts the cases of one switch; an item
 * the list holds twice, whose `@case` then renders twice; a name that comes
 * from `aria-labelledby`; text that is more than one interpolation, such as a
 * bare key beside literal words or beside a second bare key, or whose one
 * bare key sits beside a component or an `<img>` that adds to the name; the
 * text a toggle projects when an `[attr.aria-label]` sits on its host, which
 * names nothing inside and keeps the text pass away; whether a bound
 * `aria-describedby` points each copy at its own element, so one bound to a
 * constant (`[attr.aria-describedby]="hintId"`) points every copy at one and
 * still exempts its control, as one that reads the item does; and an element
 * the rule does not count as a control, such as a chip or a button toggle.
 *
 * A seventh rule keeps a reference from pointing at nothing. `aria-labelledby`,
 * `aria-describedby`, `aria-controls`, `aria-owns` and a label's `for` name
 * another element by its id, and an id no element carries resolves to nothing
 * without a word: the browser drops it, axe lists it for review and not as a
 * violation, and the control keeps whatever else names it, often nothing. The
 * import wizard's receipt-or-statement chips had that shape: the listbox's
 * `aria-labelledby` said `image-kind-label`, the question above it carried
 * that word as a class and not as an id, and the listbox had no name. The
 * rule: each id a literal one of those attributes lists is declared by a
 * literal `id` in the same template.
 *
 *   - **The whole template is read before any reference is judged.** A
 *     reference may come before the element it names, as a field's hint does.
 *   - **Only literal values, on both sides.** A bound or interpolated
 *     reference is an expression this gate cannot evaluate, so it is not
 *     read; a bound or interpolated `id` declares nothing for the same reason.
 *   - **The same template only.** Which templates share a page is decided at
 *     run time, so an id in a child component's template, a dialog or the
 *     shell does not count. Every literal reference in the tree names an id in
 *     its own template.
 *
 * What it cannot see: a reference or an id set in TypeScript or by a
 * directive's host binding; an id declared twice, or once per item in a
 * repeat, which leaves the reference ambiguous rather than empty; and whether
 * the element an id names holds any text.
 *
 * An eighth rule keeps a control from rendering with no name, in any state of
 * its blocks. `mat-checkbox`, `mat-slide-toggle` and `mat-radio-button` each
 * render the control a screen reader lands on (an `<input>`, or a
 * `role="switch"` button) inside themselves, and name it from the text
 * projected into their own label or from their `aria-label` and
 * `aria-labelledby` inputs. One with neither is announced as a checkbox or a
 * switch and nothing more. The import review card's row checkbox had that
 * shape, one per row, under a Select all whose text named it. A button, a
 * link and an element with a control's literal role are named the same way,
 * by what they hold when no `aria-label` or `aria-labelledby` names them, in
 * any spelling (each lands on a plain element, as on a slider's thumb). And
 * what a control holds names it only in the states that render it: the
 * transaction filter toggle's only words were its badge's count, inside an
 * `@if (activeFilterCount() > 0)`, so with no filter set it had no name, and
 * this gate counted the badge as text. The rule: a toggle carries
 * `aria-label` or `aria-labelledby` as a literal, an interpolation or a bound
 * input (`[aria-label]`, `[aria-labelledby]`), a plain control carries either
 * in any spelling, each with a value that is not blank (an empty one names
 * nothing, and the name comes from what the control holds), or what the
 * control holds renders in every state of its blocks (readTree, heldBy).
 * Anything outside every block renders always; an `@if` renders in every
 * state when it ends in a plain `@else`, an `@switch` when it has an
 * `@default` and an `@for` when it has an `@empty`, each with something in
 * every branch.
 *
 *   - **`[attr.aria-label]` is not a toggle's name.** It is written on the
 *     host, not on the control inside, which stays unnamed (Material's host
 *     bindings clear the host's own `aria-label` and `aria-labelledby`). The
 *     input binding is the spelling that reaches the control.
 *   - **What renders a name.** Text and interpolations; an `<img>` whose alt
 *     is not empty; and, read as words since what they render is not in this
 *     template, a component (a tag with a hyphen), an `<ng-content>`, and an
 *     element that a binding (`[textContent]`, `[innerText]`, `[innerHTML]`)
 *     or a template outlet fills. An `<ng-container>` is no component: what
 *     it holds is read. A `mat-icon` is not text: MatIcon hides itself, so its
 *     ligature names nothing, and a control whose only content is an icon is
 *     unnamed, unless the icon is written to be read, named with a literal
 *     `aria-hidden="false"`. An icon that carries a control's role is no
 *     different: its own ligature does not name it. Nor is anything inside an
 *     element with a literal `aria-hidden="true"`, or inside an
 *     `<ng-template>`, which is stamped elsewhere if at all.
 *   - **A control that holds nothing fails too.** It is the case of every
 *     branch with no block: an icon button with no `aria-label` is unnamed in
 *     every state. A hit says which it is (`sometimes`), since the fixes
 *     differ.
 *   - **An `@switch` needs an `@default`**, or Angular's exhaustive
 *     `@default never;`, which has no body and which the compiler checks
 *     against the subject's type, so that a value added later fails the
 *     build. Cases that cover every value without saying so are read as
 *     incomplete: the gate cannot read the type. **A `@defer` is read as an
 *     `@if` with no `@else`**, whatever follows it: its main block renders
 *     once loaded, and nothing says what shows when loading fails.
 *   - **A slider is read by its thumbs.** `mat-slider` takes no name input
 *     and forwards no attribute to its thumbs, so a name on its host reaches
 *     nothing: a screen reader lands on each `<input matSliderThumb>`, which
 *     is named by what it carries itself. The rule: each thumb carries
 *     `aria-label` or `aria-labelledby` with a value that is not blank, as a
 *     literal, an interpolation or a binding (`[aria-label]`,
 *     `[aria-labelledby]`, `[attr.aria-label]`, `[attr.aria-labelledby]`),
 *     whatever its host carries.
 *   - **What it found and could not fix is frozen** in UNNAMED_FROZEN, in
 *     ITEMLESS_FROZEN's rows with the tag as the key, set against the hits by
 *     the same helper: a hit no row names fails, and so does a row whose
 *     count is not the tally.
 *
 * What it cannot see: a name set in TypeScript or by a directive's host
 * binding; a `title`, which names a control only when nothing else does and
 * is not read here, so a control named by one alone fails; a structural
 * `*ngIf`, whose element is read as rendering always (no template here uses
 * one); whether a component, a projection or a binding renders any words; an
 * element hidden by a bound `[attr.aria-hidden]`, read as rendering; an
 * `aria-label` bound to an expression that is null in some states, read as
 * naming the control in every state, so what the control holds is not read
 * at all (the camera's process button and the form's submit button take that
 * shape, and rely on their `@else` words while the label is null); an element
 * the rule does not count as a control, such as a chip or a button toggle;
 * and whether the text or the name says anything.
 *
 * A ninth rule keeps two controls that can show together from sharing a
 * name. The sixth reads controls stamped once per item, but a control
 * rendered once can share its whole name too, with another of its own
 * template. The transaction form had that shape: a scan can offer a currency
 * and a position at once, each offer with a dismiss beside it, and both read
 * "Close"; and each of the AI page's three provider cards held a remove for
 * its key, all three "Remove". A screen reader moving between them heard one
 * name again and nothing that said which offer it closed or which key it
 * removed. The rule: two controls of one template, each named by an
 * `aria-label` that is a bare key (bareKeyLabel, a ternary's either branch
 * being its key), do not share a key when both can render at once.
 *
 *   - **Two controls render at once unless their blocks keep them apart.**
 *     Each `@if`, `@else if` and `@else` is an arm of one chain, and each
 *     `@case` and `@default` an arm of its switch (readBlocks, armOf); an
 *     `@else` takes its chain from the arm the same run of text closed last,
 *     which Angular puts just before it. Two controls never render at once
 *     when, at the deepest chain both sit in, they sit in different arms
 *     (exclusiveArms), so the two arms of an `@if…@else` may share a name and
 *     two independent `@if`s may not. The cases of a switch on the nearest
 *     `@for`'s own item are no arms: each item renders its own case, so two
 *     cards show two of them at once. An `@defer` and the blocks after it,
 *     and an `@for` and its `@empty`, are read as rendering together.
 *   - **Only what the sixth rule leaves.** A control stamped once per item,
 *     in its template or by another, or reached by two cases of one
 *     held-apart switch, is the sixth rule's and is reported there, once;
 *     so is every control of a repeated component (readPerItem). A control
 *     rendered once beside a repeated one under its key is not a hit here:
 *     the repeated one's fix, a slot for its item, sets the two apart.
 *   - **Only a control named by its `aria-label`.** Two controls named by
 *     their own text read the words a sighted user sees too, and no rule
 *     reads them: the AI page's Get API Key links and Test Key buttons had
 *     that shape, and carry their provider in an `aria-label` now.
 *   - **One template.** Which templates share a page is decided at run time,
 *     as the seventh rule says, so the shared dialog header's own *Close*,
 *     beside a dismiss in the form it heads, is not read.
 *
 * What it cannot see: a name built in TypeScript; a control named by its own
 * text, beside another or beside a label-named one; a field named by its
 * `<mat-label>`, as the AI page's key fields and model selects are, each
 * card's by its provider now; a ternary nested in another, and the other
 * spellings bareKeyLabel does not read; a menu trigger named by
 * `common.moreActions`, which the fourth rule reads and this one leaves out;
 * controls in two templates shown on one page; and two blocks that their
 * conditions keep apart without an `@else`, such as two `@if`s on one signal
 * and on its negation, read as rendering together.
 *
 * A tenth rule keeps a single-choice group from being entered with no name.
 * A `mat-button-toggle-group` that is not `multiple` renders
 * `role="radiogroup"` on its own host, as a `mat-radio-group` does, and a
 * screen reader entering one says the group's name before its first choice.
 * The category manager's Expenses / Income group had none, nor had seven more
 * toggle groups (the transaction form's type, the period selector's quick
 * ranges, the forecast's horizon among them): each announced its first
 * choice and its place among the others, and nothing that said what was
 * being chosen. The axe pass the specs run reads no radiogroup's name, so
 * nothing failed. The rule: each such group, and any element with a literal
 * `role="radiogroup"`, carries `aria-label` or `aria-labelledby` in any
 * spelling, with a value that is not blank (readGroups). A `multiple` group
 * renders `role="group"` and is not read.
 *
 * What it cannot see: a name or a role set in TypeScript or by a directive's
 * host binding, or bound through `[attr.role]`; a `[multiple]` bound to an
 * expression, read as multiple whatever it holds; and whether the name says
 * what is chosen.
 *
 * Reference documentation lives in docs/accessibility.md.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

const SOURCE_DIR = 'src/app';
const DOC = 'docs/accessibility.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/** The opening tag, which routinely spans several lines. */
const ICON_TAG = /<mat-icon\b([^>]*)>/g;

/**
 * Any spelling that gives the icon an accessible name: the explicit image
 * role, or an aria-label in literal, property or attribute-binding form.
 */
const NAMED = /role\s*=\s*"img"|aria-label/;

/**
 * A literal `aria-hidden="…"` attribute — the only thing MatIcon's
 * constructor reads. The lookbehind rejects the bound forms, whose names end
 * in `.` or `[`: `[attr.aria-hidden]=` and `[aria-hidden]=`.
 */
const LITERAL_HIDDEN = /(?<![\w.[-])aria-hidden\s*=\s*"/;

/** The opening tag of any of the three progress indicators. */
const PROGRESS_TAG = /<mat-(spinner|progress-bar|progress-spinner)\b([^>]*)>/g;

/**
 * Any spelling that names the indicator: a literal, property-bound or
 * attribute-bound `aria-label`, or `aria-labelledby` — which contains
 * `aria-label` as a substring, so the one test covers both.
 */
const PROGRESS_NAMED = /aria-label/;

/**
 * A literal `aria-hidden="true"`, and nothing looser than that. Unlike
 * MatIcon's constructor quirk above, nothing reads this attribute specially:
 * a bound `[attr.aria-hidden]` is just as invisible to a screen reader as
 * the literal form, but this gate cannot evaluate it, so it does not count —
 * and `aria-hidden="false"` is a value someone wrote on purpose, which this
 * rule takes at its word and still requires a name for.
 */
const PROGRESS_HIDDEN = /(?<![\w.[-])aria-hidden\s*=\s*"true"/;

/**
 * A tooltip on the tag: `matTooltip="…"` or `[matTooltip]="…"`. The lookbehind
 * rejects a longer name ending in it, and the `=` rejects the options that
 * extend it — `matTooltipPosition`, `matTooltipClass`, `[matTooltipDisabled]`.
 */
const TOOLTIP = /(?<![\w.-])(?:\[matTooltip\]|matTooltip)\s*=/;

/** A literal `aria-hidden="false"`: the icon is meant to be read. */
const LITERAL_VISIBLE = /(?<![\w.[-])aria-hidden\s*=\s*"false"/;

/**
 * A literal `tabindex="…"`. The bound spellings, `[tabindex]` and
 * `[attr.tabindex]`, are not literal and are rejected by the lookbehind.
 */
const LITERAL_TABINDEX = /(?<![\w.[-])tabindex\s*=\s*"/;

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line. Handles `//`, `/* *​/`
 * and `<!-- -->`; a commented-out icon is not an icon.
 * (Copied from check-direction.mjs, which copied it from check-truncation.mjs
 * — each gate script stays runnable on its own.)
 */
export function maskComments(source) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const four = source.slice(i, i + 4);
    if (state === 'code') {
      if (quote) {
        if (source[i] === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === quote) quote = '';
        out += source[i]; i += 1; continue;
      }
      if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
        quote = source[i]; out += source[i]; i += 1; continue;
      }
      if (two === '//') { state = 'line'; out += '  '; i += 2; continue; }
      if (two === '/*') { state = 'block'; out += '  '; i += 2; continue; }
      if (four === '<!--') { state = 'html'; out += '    '; i += 4; continue; }
      out += source[i]; i += 1; continue;
    }
    if (state === 'line') {
      if (source[i] === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (state === 'block') {
      if (two === '*/') { state = 'code'; out += '  '; i += 2; continue; }
      out += source[i] === '\n' ? '\n' : ' '; i += 1; continue;
    }
    // html
    if (source.slice(i, i + 3) === '-->') { state = 'code'; out += '   '; i += 3; continue; }
    out += source[i] === '\n' ? '\n' : ' '; i += 1;
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Every named icon in one file's source that carries no literal
 * `aria-hidden`. Returns `{ line, attrs }` for each.
 */
export function scan(source) {
  const masked = maskComments(source);
  const hits = [];
  ICON_TAG.lastIndex = 0;
  let match;
  while ((match = ICON_TAG.exec(masked)) !== null) {
    const attrs = match[1];
    if (!NAMED.test(attrs)) continue;
    if (LITERAL_HIDDEN.test(attrs)) continue;
    hits.push({ line: lineOf(masked, match.index), attrs: attrs.replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

/**
 * Every progress indicator in one file's source that carries no accessible
 * name and no literal `aria-hidden="true"`. Returns `{ line, tag, attrs }`
 * for each.
 */
export function scanProgress(source) {
  const masked = maskComments(source);
  const hits = [];
  PROGRESS_TAG.lastIndex = 0;
  let match;
  while ((match = PROGRESS_TAG.exec(masked)) !== null) {
    const attrs = match[2];
    if (PROGRESS_NAMED.test(attrs)) continue;
    if (PROGRESS_HIDDEN.test(attrs)) continue;
    hits.push({
      line: lineOf(masked, match.index),
      tag: `mat-${match[1]}`,
      attrs: attrs.replace(/\s+/g, ' ').trim(),
    });
  }
  return hits;
}

/**
 * Any opening or closing tag. The attribute part steps over quoted values
 * whole, so a binding such as `[class.wide]="a > b"` does not end the tag.
 */
const ANY_TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

/** Elements that never close, so they never hold an icon. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/**
 * Every `mat-icon` inside a `mat-option` with an element between the two.
 * Returns `{ line, wrapper }` for each, `wrapper` being the element it sits
 * in.
 */
export function scanOptionIcons(source) {
  const masked = maskComments(source);
  const hits = [];
  // The elements open inside the current option, innermost last; null while
  // outside any option.
  let open = null;
  ANY_TAG.lastIndex = 0;
  let match;
  while ((match = ANY_TAG.exec(masked)) !== null) {
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    const selfClosing = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(name);
    if (open === null) {
      if (!closing && !selfClosing && name === 'mat-option') open = [];
      continue;
    }
    if (closing) {
      if (open.length === 0) open = null;
      else open.pop();
      continue;
    }
    if (name === 'mat-icon' && open.length > 0) {
      hits.push({ line: lineOf(masked, match.index), wrapper: open[open.length - 1] });
    }
    if (!selfClosing) open.push(name);
  }
  return hits;
}

/**
 * A structural directive that stamps its element once per item. A table's
 * header and footer defs render once, so they are not listed.
 */
const REPEAT_DIRECTIVE = /\*(ngFor|cdkVirtualFor|matCellDef|matRowDef|cdkCellDef|cdkRowDef)\b/;

/** MatMenuTrigger's selector, in either spelling. */
const MENU_TRIGGER = /\bmatMenuTriggerFor\b|\bmat-menu-trigger-for\b/;

/**
 * Each `aria-label` in a tag — literal, property-bound or attribute-bound —
 * with its value. `aria-labelledby` is not followed by `=` and never matches.
 */
const ARIA_LABEL = /(?:\[(?:attr\.)?aria-label\]|(?<![\w.[-])aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The catalog key that names no item, closed by its quote so `moreActionsFor` is not it. */
const ITEMLESS_KEY = /(['"])common\.moreActions\1/;

/** An `@for` header's item: `(card of cards(); track card)` gives `card`. */
const FOR_ITEM = /^\s*\(\s*([A-Za-z_$][\w$]*)\s+of\b/;

/** An `@switch` header's subject, the expression inside its parentheses. */
const SWITCH_SUBJECT = /^\s*\(([\s\S]*)\)\s*$/;

/**
 * The frame a block opens, from its keyword, its header, the frames open
 * around it and the block frame the same run of text closed last, as
 * readBlocks describes.
 */
function openBlock(keyword, header, frames, { casesApart, at, closed }) {
  if (keyword === 'for') {
    return { element: null, repeat: true, at, item: FOR_ITEM.exec(header)?.[1] ?? null };
  }
  if (keyword === 'switch') {
    const subject = SWITCH_SUBJECT.exec(header)?.[1].trim() ?? null;
    const nearest = frames.findLast((frame) => frame.repeat);
    const onItem = nearest?.element === null && nearest.item !== null && nearest.item === subject;
    return { element: null, repeat: false, at, subject, on: onItem ? nearest : null };
  }
  if (keyword === 'if') return { element: null, repeat: false, at, chainAt: at };
  if (keyword === 'else') {
    // `} @else {` and `} @else if (…) {` sit in the one run of text that
    // closed the arm before them, since Angular allows nothing but blanks and
    // comments between the two, so that arm's frame carries the chain on.
    return { element: null, repeat: false, at, chainAt: closed?.chainAt ?? at };
  }
  if (keyword === 'case' || keyword === 'default') {
    const parent = frames.at(-1);
    const switchAt = parent?.subject === undefined ? at : parent.at;
    const onItem = Boolean(parent?.on);
    if (keyword === 'case' && casesApart && onItem) {
      return { element: null, repeat: false, at, switchAt, onItem, lifts: parent.on };
    }
    return { element: null, repeat: false, at, switchAt, onItem };
  }
  return { element: null, repeat: false, at };
}

/**
 * The arms a block frame puts an element in: `{ chainAt, armAt }`, `chainAt`
 * naming the `@if` or `@switch` by where its `@` sits and `armAt` the branch
 * by its own, for an `@if`, `@else if` or `@else` and for an `@case` or
 * `@default`. The cases of a switch on the nearest `@for`'s own item are no
 * arms: every item renders its own case, so two of them show at once on two
 * cards. Null for any other frame.
 */
function armOf(frame) {
  if (frame.chainAt !== undefined) return { chainAt: frame.chainAt, armAt: frame.at };
  if (frame.switchAt !== undefined && !frame.onItem) return { chainAt: frame.switchAt, armAt: frame.at };
  return null;
}

/**
 * What follows `@default` in Angular's exhaustive default, `@default never;`,
 * as the compiler spells it: blanks on one line, then `never`.
 */
const DEFAULT_NEVER = /^[^\S\r\n]+never\b/;

/**
 * The head of the block whose `@` sits at `i` in a run with its
 * interpolations set aside: `{ keyword, header, opens, next }`, `opens` being
 * whether a body follows and `next` where reading carries on, or null when no
 * keyword follows the `@`. A head runs to the first `{` outside its
 * parentheses, but two open nothing and end at their `;`: `@let name =
 * expression;`, which declares a value, and the exhaustive `@default never;`,
 * which has no body (the compiler proves that some `@case` matches), its
 * keyword read as the compiler names it, `'default never'`. readBlocks and
 * readTree both read heads through it.
 */
function readBlockHead(plain, i) {
  const keyword = /^@(\w+)/.exec(plain.slice(i));
  if (!keyword) return null;
  const from = i + keyword[0].length;
  const exhaustive = keyword[1] === 'default' && DEFAULT_NEVER.test(plain.slice(from));
  if (keyword[1] === 'let' || exhaustive) {
    const end = plain.indexOf(';', from);
    const to = end < 0 ? plain.length : end;
    const name = exhaustive ? 'default never' : keyword[1];
    return { keyword: name, header: plain.slice(from, to), opens: false, next: to + 1 };
  }
  let depth = 0;
  let j = from;
  for (; j < plain.length; j++) {
    if (plain[j] === '(') depth++;
    else if (plain[j] === ')') depth--;
    else if (plain[j] === '{' && depth === 0) break;
  }
  return { keyword: keyword[1], header: plain.slice(from, j), opens: j < plain.length, next: j + 1 };
}

/**
 * Reads the control-flow syntax in one run of text between two tags, pushing
 * a frame onto `frames` for each block it opens and removing one for each `}`.
 * `@for` opens a repeating block; any other `@name … {` (`@if`, `@else`,
 * `@empty`, `@switch`, `@case`, `@defer`, …) a plain one; an `@let` and an
 * `@default never;` open none (readBlockHead). Interpolations are blanked
 * first, because their braces are expressions; Angular rejects a bare `{`,
 * `}` or `@` in text, so what remains is block syntax.
 *
 * An `@for` frame records its item's name, and an `@switch` frame its
 * subject, with `on` set to the `@for` frame whose item it is when the
 * nearest repeat around the switch is that `@for`. With `casesApart`, an
 * `@case` under such a switch `lifts` that `@for`: it renders for the one
 * item that matches, so its contents are stamped once. `@default` lifts
 * nothing, since every other item lands in it. `base` is the run's offset in
 * the template, so `at` names each block by where its `@` sits.
 *
 * Each arm of a conditional records its chain, `chainAt`: an `@if` its own
 * `at`, and an `@else` or `@else if` the chain of the arm this run of text
 * closed last, which is the arm before it. Each `@case` and `@default`
 * records its switch's `at` as `switchAt`, and `onItem` when that switch is
 * on the nearest `@for`'s own item. armOf reads them.
 */
function readBlocks(text, frames, { casesApart = false, base = 0 } = {}) {
  const plain = text.replace(/\{\{[\s\S]*?\}\}/g, (body) => ' '.repeat(body.length));
  let closed = null;
  let i = 0;
  while (i < plain.length) {
    if (plain[i] === '@') {
      const head = readBlockHead(plain, i);
      if (!head) { i += 1; continue; }
      if (head.opens) frames.push(openBlock(head.keyword, head.header, frames, { casesApart, at: base + i, closed }));
      i = head.next;
      continue;
    }
    if (plain[i] === '}') {
      for (let k = frames.length - 1; k >= 0; k--) {
        if (frames[k].element === null) {
          [closed] = frames.splice(k, 1);
          break;
        }
      }
    }
    i += 1;
  }
}

/**
 * Walks a template's opening tags in order, calling
 * `visit({ name, attrs, line, at, repeated, inTemplate, cases, arms, inMenu,
 * repeatedInMenu })` for each, `at` being the tag's offset in the template
 * (readOwnTexts keys on it). `repeated` is true when the element is stamped
 * once per item within this template: inside an `@for` block, or on or under
 * an element carrying a repeating structural directive. `inTemplate` is true
 * when an `<ng-template>` is open around it.
 *
 * With `casesApart`, an `@case` on the nearest `@for`'s own item holds that
 * `@for` apart (readBlocks), so an element under it is not repeated by it,
 * and `cases` lists each such `@case` around the element as
 * `{ switchAt, caseAt }`. Without it, `cases` is empty and every `@for`
 * repeats.
 *
 * `arms` is the element's arm ancestry, outermost first: each branch of a
 * conditional or a switch around it, as `{ chainAt, armAt }` (armOf). Two
 * elements show at once only if, at the deepest chain both sit in, they sit
 * in the same arm (exclusiveArms).
 *
 * `inMenu` is true when a `<mat-menu>` is open around the element, and
 * `repeatedInMenu` when a repeat inside the innermost such menu, or the
 * element's own repeating directive, stamps it there: every copy then sits in
 * the one panel the menu opens.
 */
export function walkTemplate(source, visit, { casesApart = false } = {}) {
  const masked = maskComments(source);
  // Open elements and blocks, innermost last. An element frame carries its
  // tag name; a block frame carries null.
  const frames = [];
  const tag = new RegExp(ANY_TAG.source, 'g');
  let last = 0;
  let match;
  while ((match = tag.exec(masked)) !== null) {
    readBlocks(masked.slice(last, match.index), frames, { casesApart, base: last });
    last = tag.lastIndex;
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = frames.map((frame) => frame.element).lastIndexOf(name);
      if (at >= 0) frames.length = at;
      continue;
    }
    const repeat = REPEAT_DIRECTIVE.test(attrs);
    const cases = frames.filter((frame) => frame.lifts);
    const lifted = new Set(cases.map((frame) => frame.lifts));
    const menuAt = frames.findLastIndex((frame) => frame.element === 'mat-menu');
    const repeatAt = frames.findLastIndex((frame) => frame.repeat && !lifted.has(frame));
    visit({
      name,
      attrs,
      line: lineOf(masked, match.index),
      at: match.index,
      repeated: repeat || repeatAt >= 0,
      inTemplate: frames.some((frame) => frame.element === 'ng-template'),
      cases: cases.map((frame) => ({ switchAt: frame.switchAt, caseAt: frame.at })),
      arms: frames.map(armOf).filter((arm) => arm !== null),
      inMenu: menuAt >= 0,
      repeatedInMenu: menuAt >= 0 && (repeat || repeatAt > menuAt),
    });
    const selfClosing = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(name);
    if (!selfClosing) frames.push({ element: name, repeat });
  }
}

/** An icon the fifth rule is about: a tooltip, a name and a literal `aria-hidden="false"`. */
function isTooltipFlag(name, attrs) {
  return name === 'mat-icon' && TOOLTIP.test(attrs) && NAMED.test(attrs) && LITERAL_VISIBLE.test(attrs);
}

/**
 * Every named, un-hidden `mat-icon` that carries a tooltip and no literal
 * `tabindex`, outside any `<ng-template>`. Returns `{ line, attrs }` for each.
 */
export function scanTooltipIcons(source) {
  const hits = [];
  walkTemplate(source, ({ name, attrs, line, inTemplate }) => {
    if (!isTooltipFlag(name, attrs) || inTemplate) return;
    if (LITERAL_TABINDEX.test(attrs)) return;
    hits.push({ line, attrs: attrs.replace(/\s+/g, ' ').trim() });
  });
  return hits;
}

/** True when one of the tag's `aria-label`s is drawn from the item-less key. */
function itemlessName(attrs) {
  for (const label of attrs.matchAll(ARIA_LABEL)) {
    if (ITEMLESS_KEY.test(label[1] ?? label[2])) return true;
  }
  return false;
}

/**
 * Every menu trigger named by the item-less key that is stamped once per
 * item: inside a repeat in this template, or anywhere in it when
 * `componentRepeated` says another template repeats the component it belongs
 * to. Returns `{ line, tag, attrs }` for each.
 */
export function scanMenuTriggers(source, componentRepeated = false) {
  const hits = [];
  walkTemplate(source, ({ name, attrs, line, repeated }) => {
    if (!MENU_TRIGGER.test(attrs)) return;
    if (!repeated && !componentRepeated) return;
    if (!itemlessName(attrs)) return;
    hits.push({ line, tag: name, attrs: attrs.replace(/\s+/g, ' ').trim() });
  });
  return hits;
}

/** The elements the sixth rule counts as controls by their tag alone. */
const CONTROL_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea',
  'mat-select', 'mat-checkbox', 'mat-slide-toggle', 'mat-radio-button',
]);

/** A literal `role` that makes any element a control. */
const CONTROL_ROLE = /(?<![\w.[-])role\s*=\s*"(?:button|link|checkbox|switch|radio|menuitem|tab)"/;

/**
 * Each `aria-label` in a tag with its value, the first group saying how it is
 * written: `[attr.aria-label]` or `[aria-label]` bound, `aria-label` literal.
 */
const LABEL_ATTR = /(\[(?:attr\.)?aria-label\]|(?<![\w.[-])aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** A bound label that is one quoted key piped through translate, and nothing else. */
const BARE_KEY_BOUND = /^\s*(['"])([\w.-]+)\1\s*\|\s*translate\s*$/;

/**
 * A bound label that is a ternary between two quoted keys, piped through
 * translate once after it with no parameters, and nothing else:
 * `(pinned ? 'a.unpin' : 'a.pin') | translate`. The condition may read `?.`
 * and `??`.
 */
const BARE_TERNARY_PIPED_ONCE =
  /^\s*\(\s*(?:[^?{}]|\?\.|\?\?)+?\?\s*(['"])([\w.-]+)\1\s*:\s*(['"])([\w.-]+)\3\s*\)\s*\|\s*translate\s*$/;

/**
 * The same ternary with the pipe in each branch, and no parameters on either:
 * `pinned ? ('a.unpin' | translate) : ('a.pin' | translate)`. The second
 * branch may go without its parentheses, `pinned ? ('a.unpin' | translate) :
 * 'a.pin' | translate`, since the conditional reads its last branch as a pipe;
 * the first may not, where a `:` after the pipe would be its parameter, and
 * Angular rejects that spelling. A label wrapped whole in parentheses,
 * `(pinned ? ('a.unpin' | translate) : ('a.pin' | translate))`, or a branch
 * in doubled parentheses is not read, as `('a.pin' | translate)` is not for
 * one key.
 */
const BARE_TERNARY_PIPED_EACH =
  /^\s*(?:[^?{}]|\?\.|\?\?)+?\?\s*\(\s*(['"])([\w.-]+)\1\s*\|\s*translate\s*\)\s*:\s*(?:\(\s*(['"])([\w.-]+)\3\s*\|\s*translate\s*\)|(['"])([\w.-]+)\5\s*\|\s*translate)\s*$/;

/** A literal label's one interpolation, when the label is that and nothing else. */
const ONE_INTERPOLATION = /^\s*\{\{([^{}]*)\}\}\s*$/;

/**
 * The key a bound expression consists of when it names no item: one quoted
 * key piped with no parameters, or a ternary between two such keys, which
 * gives every copy one of two names and is no better. A ternary's two keys
 * are reported together, `whenTrue : whenFalse`. Null otherwise.
 */
function bareKeyOf(expression) {
  const key = BARE_KEY_BOUND.exec(expression)?.[2];
  if (key) return key;
  const once = BARE_TERNARY_PIPED_ONCE.exec(expression);
  if (once) return `${once[2]} : ${once[4]}`;
  const each = BARE_TERNARY_PIPED_EACH.exec(expression);
  return each ? `${each[2]} : ${each[4] ?? each[6]}` : null;
}

/**
 * The key a tag's `aria-label` consists of when it names no item, with the
 * label's offset in `attrs`; null otherwise. Bare is one quoted key piped
 * with no parameters, or a ternary between two such keys, piped once after it
 * or in each branch (bareKeyOf), either bound or as a literal that is one
 * interpolation. A ternary with parameters on either branch, or on the pipe
 * after it, is not bare.
 */
function bareKeyLabel(attrs) {
  for (const label of attrs.matchAll(LABEL_ATTR)) {
    const value = label[2] ?? label[3];
    const expression = label[1].startsWith('[') ? value : ONE_INTERPOLATION.exec(value)?.[1];
    const key = expression === undefined ? null : bareKeyOf(expression);
    if (key) return { key, index: label.index };
  }
  return null;
}

/**
 * The controls whose name can come from what they hold. An input, a select
 * and a textarea are named by a label or an attribute, never by their content;
 * an element with a control's literal `role` (CONTROL_ROLE) is read too.
 */
const TEXT_NAMED_TAGS = new Set(['a', 'button', 'mat-checkbox', 'mat-slide-toggle', 'mat-radio-button']);

/** An `aria-describedby` bound to an expression, which can name each copy's own item. */
const BOUND_DESCRIBEDBY = new Set(['[attr.aria-describedby]', '[aria-describedby]']);

/**
 * True when a tag's `aria-describedby` is bound: in brackets, or a literal
 * that interpolates (`aria-describedby="{{ r.hintId }}"`), which Angular binds
 * the same way, as bareKeyLabel reads an interpolated `aria-label`. Whether
 * the expression gives each copy its own element is not read.
 */
const describedByBound = (attrs) =>
  attributesOf(attrs).some(
    ({ name, value }) =>
      value !== undefined && (BOUND_DESCRIBEDBY.has(name) || (name === 'aria-describedby' && value.includes('{{')))
  );

/** A literal `aria-hidden="true"` among a tag's attributes, read as an attribute and never inside another's value. */
const literallyHidden = (attrs) =>
  attributesOf(attrs).some(({ name, value }) => name === 'aria-hidden' && value === 'true');

/** Elements with a hyphen that are no component: what they hold is read, or nothing is. */
const NOT_COMPONENTS = new Set(['ng-container', 'ng-template', 'mat-icon']);

/**
 * True when an element adds to the name of the control it sits in, beside any
 * text: an `<img>` whose alt is not empty, and a component, any tag with a
 * hyphen but those NOT_COMPONENTS lists, an `<ng-content>` among them, as
 * spokenBy reads them; neither when it carries a literal `aria-hidden="true"`.
 */
const addsToName = (name, attrs) =>
  !literallyHidden(attrs) &&
  (name === 'img'
    ? attributesOf(attrs).some(({ name: attr, value }) => ALT_NAMES.has(attr) && value)
    : name.includes('-') && !NOT_COMPONENTS.has(name));

/**
 * What readOwnTexts adds to a control's runs where an element adds to its
 * name (addsToName): not blank and no interpolation, so a bare key beside it
 * is not the control's whole text (ownTextKey).
 */
const BESIDE_THE_TEXT = ' \u0001 ';

/**
 * The key a control's own text consists of when it names no item, or null.
 * `runs` are the runs of template text the control holds. Control-flow syntax
 * is taken out, with each interpolation set aside first, since its braces
 * are an expression's, as readTree sets them aside; the text is bare when
 * what is left is one interpolation and that is one key with no parameters, or
 * a ternary between two, piped through translate (bareKeyOf).
 */
function ownTextKey(runs) {
  const interpolations = [];
  const plain = runs
    .join(' ')
    .replace(/\{\{([\s\S]*?)\}\}/g, (_, body) => {
      interpolations.push(body);
      return ` \u0000${interpolations.length - 1}\u0000 `;
    })
    // The two heads that end at a `;` (readBlockHead), then the rest.
    .replace(/@(?:let\b|default[^\S\r\n]+never\b)[^;]*;/g, ' ')
    .replace(/@\w+[^{]*\{/g, ' ')
    .replace(/[{}]/g, ' ')
    .trim();
  const only = /^\u0000(\d+)\u0000$/.exec(plain);
  return only ? bareKeyOf(interpolations[Number(only[1])]) : null;
}

/**
 * The sixth rule's text pass: each control in a template that takes its name
 * from its own text, and whose text is one key with no parameters (or a
 * ternary between two), by its opening tag's offset, mapped to that key.
 * walkTemplate reads opening tags only, so this pass keeps its own stack of
 * open elements.
 *
 * A control takes its name from its text when no `aria-label` or
 * `aria-labelledby` names it, in any spelling (THUMB_NAMES). Its text is every
 * run of text it holds, its descendants' included, outside a `mat-icon` (whose
 * ligature MatIcon hides) and outside an element with a literal
 * `aria-hidden="true"`, with BESIDE_THE_TEXT where an `<img>` with an alt or a
 * component adds to the name (addsToName), so that a bare key beside one is
 * not read as bare. A control with a bound `aria-describedby`
 * (describedByBound) is left out, the household's "named by what it does,
 * described by its item" (a Known gap, see the header). The other exemption,
 * a control inside a `<mat-menu>`, is readHeldApart's, which knows from
 * walkTemplate whether a repeat inside the menu stamps it.
 */
function readOwnTexts(source) {
  const masked = maskComments(source);
  const found = new Map();
  // Open elements, innermost last: `{ name, hidden, control }`, `control`
  // being the runs a text-named control has gathered, or null.
  const open = [];
  const tag = new RegExp(ANY_TAG.source, 'g');
  let last = 0;
  let match;
  while ((match = tag.exec(masked)) !== null) {
    const run = masked.slice(last, match.index);
    if (!open.some((frame) => frame.hidden)) {
      for (const frame of open) frame.control?.runs.push(run);
    }
    last = tag.lastIndex;
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = open.map((frame) => frame.name).lastIndexOf(name);
      if (at >= 0) {
        for (const frame of open.slice(at)) {
          if (frame.control) {
            const key = ownTextKey(frame.control.runs);
            if (key) found.set(frame.control.at, key);
          }
        }
        open.length = at;
      }
      continue;
    }
    const selfClosing = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(name);
    if (addsToName(name, attrs) && !open.some((frame) => frame.hidden)) {
      for (const frame of open) frame.control?.runs.push(BESIDE_THE_TEXT);
    }
    if (selfClosing) continue;
    const textNamed =
      (TEXT_NAMED_TAGS.has(name) || CONTROL_ROLE.test(attrs)) && !thumbNamed(attrs) && !describedByBound(attrs);
    open.push({
      name,
      hidden: name === 'mat-icon' || literallyHidden(attrs),
      control: textNamed ? { at: match.index, runs: [] } : null,
    });
  }
  return found;
}

/**
 * One template read for the sixth rule, an `@case` on the `@for`'s own item
 * held apart: each control named by a bare key (`{ line, tag, key, via,
 * repeated, cases, arms }`), and, when `selectors` is given, each use of one
 * of them (`{ name, repeated, cases }`). `via` says where the name comes
 * from: `'label'`, its `aria-label`, `line` being the label's own; or
 * `'text'`, its own text (readOwnTexts), `line` being the opening tag's. Both
 * kinds feed the same tally across templates (heldApartAcross): a key is one
 * name, however a control comes by it. `arms` is walkTemplate's, which the
 * ninth rule reads.
 *
 * A control named by its text inside a `<mat-menu>` is left out, since the
 * menu's panel opens for the one trigger that names the item, unless a repeat
 * inside the menu stamps it (walkTemplate's `repeatedInMenu`): its copies then
 * share the one panel, and the trigger's name tells none of them apart.
 */
function readHeldApart(source, selectors = null) {
  const controls = [];
  const stamps = [];
  const texts = readOwnTexts(source);
  walkTemplate(
    source,
    ({ name, attrs, line, at, repeated, cases, arms, inMenu, repeatedInMenu }) => {
      if (selectors?.has(name)) stamps.push({ name, repeated, cases });
      if (!CONTROL_TAGS.has(name) && !CONTROL_ROLE.test(attrs)) return;
      if (MENU_TRIGGER.test(attrs) && itemlessName(attrs)) return;
      const label = bareKeyLabel(attrs);
      if (label) {
        const before = attrs.slice(0, label.index);
        controls.push({
          line: line + before.split('\n').length - 1,
          tag: name,
          key: label.key,
          via: 'label',
          repeated,
          cases,
          arms,
        });
        return;
      }
      const key = texts.get(at);
      if (key && (!inMenu || repeatedInMenu)) controls.push({ line, tag: name, key, via: 'text', repeated, cases, arms });
    },
    { casesApart: true }
  );
  return { controls, stamps };
}

/** Each element selector the templates' components carry, with the templates that carry it. */
function selectorIndex(templates) {
  const bySelector = new Map();
  for (const { key, selector } of templates) {
    if (!selector) continue;
    if (!bySelector.has(selector)) bySelector.set(selector, []);
    bySelector.get(selector).push(key);
  }
  return bySelector;
}

/**
 * The one exception to the hold-apart. A held-apart `@case` reaches what it
 * writes and what every component it stamps reaches, to any depth: their
 * selectors, and the bare keys their controls are named by. A selector or key
 * that two or more cases of one switch reach renders once per item reaching
 * any of them, whichever template holds it, so it stays repeated. The tally is
 * per switch and per selector or key. `templates` is a list of
 * `{ key, selector, source }`. Returns `{ selectors, keys, slots }`: the
 * selectors so reached; by template, the keys so reached that its own
 * controls carry; and, by the template holding the switch, each
 * `switchAt key` so reached, written in its cases or below them.
 */
export function heldApartAcross(templates) {
  const bySelector = selectorIndex(templates);
  const reads = new Map(templates.map(({ key, source }) => [key, readHeldApart(source, bySelector)]));
  // What a template reaches: the selectors it and the components under it
  // use, and each bare key their controls carry, with the templates holding
  // it. Read to a fixed point, as repeatedTemplates reads repetition, so
  // components that stamp each other, or one that stamps itself, reach the
  // same whichever of them a switch's cases read first.
  const reachOf = new Map();
  for (const { key } of templates) {
    const found = { selectors: new Set(), keys: new Map() };
    for (const control of reads.get(key).controls) {
      if (!found.keys.has(control.key)) found.keys.set(control.key, new Set());
      found.keys.get(control.key).add(key);
    }
    reachOf.set(key, found);
  }
  const sizeOf = ({ selectors, keys }) =>
    [...keys.values()].reduce((n, holders) => n + holders.size, selectors.size);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, found] of reachOf) {
      const was = sizeOf(found);
      for (const { name } of reads.get(key).stamps) {
        found.selectors.add(name);
        for (const target of bySelector.get(name)) {
          const below = reachOf.get(target);
          for (const selector of below.selectors) found.selectors.add(selector);
          for (const [label, holders] of below.keys) {
            if (!found.keys.has(label)) found.keys.set(label, new Set());
            for (const holder of holders) found.keys.get(label).add(holder);
          }
        }
      }
      if (sizeOf(found) > was) grew = true;
    }
  }
  const selectors = new Set();
  const keys = new Map();
  const slots = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const { key } of templates) {
    const { controls, stamps } = reads.get(key);
    // Per switch and per selector or key: the cases that reach it, and the
    // templates below the cases whose controls carry the key.
    const tally = new Map();
    const reached = (switchAt, caseAt, kind, id, holders = []) => {
      const slot = `${switchAt} ${kind} ${id}`;
      if (!tally.has(slot)) tally.set(slot, { switchAt, kind, id, cases: new Set(), holders: new Set() });
      tally.get(slot).cases.add(caseAt);
      for (const holder of holders) tally.get(slot).holders.add(holder);
    };
    for (const control of controls) {
      for (const { switchAt, caseAt } of control.cases) reached(switchAt, caseAt, 'key', control.key);
    }
    for (const stamp of stamps) {
      for (const { switchAt, caseAt } of stamp.cases) {
        reached(switchAt, caseAt, 'selector', stamp.name);
        for (const target of bySelector.get(stamp.name)) {
          const below = reachOf.get(target);
          for (const selector of below.selectors) reached(switchAt, caseAt, 'selector', selector);
          for (const [label, holders] of below.keys) reached(switchAt, caseAt, 'key', label, holders);
        }
      }
    }
    for (const { switchAt, kind, id, cases, holders } of tally.values()) {
      if (cases.size < 2) continue;
      if (kind === 'selector') {
        selectors.add(id);
        continue;
      }
      add(slots, key, `${switchAt} ${id}`);
      for (const holder of holders) add(keys, holder, id);
    }
  }
  return { selectors, keys, slots };
}

/**
 * Every control stamped once per item whose `aria-label` is one catalog key
 * with no parameters, or a ternary between two (see bareKeyLabel): inside a
 * repeat in this template, an `@case` on the `@for`'s own item held apart
 * (walkTemplate's `casesApart`) unless two or more cases of that switch reach
 * the same key (heldApartAcross), or anywhere in it when `componentRepeated`
 * says another template stamps the component it belongs to once per item.
 * `across` is heldApartAcross's verdict for this template, read over every
 * template by the run: `keys`, the keys of its controls that two cases of a
 * switch elsewhere reach through what they stamp, and `slots`, each
 * `switchAt key` its own switches reach in two cases. Without it, this
 * template is read alone. A control with no `aria-label` is read by its own
 * text (readOwnTexts) and judged the same way. `line` is where a finding is
 * reported: the label's own line for a control named by its label, the
 * opening tag's for one named by its text. A menu trigger the fourth rule
 * reports is left to it. Returns `{ line, tag, key, via }` for each, `via`
 * being `'label'` or `'text'`.
 */
export function scanItemlessLabels(source, componentRepeated = false, across = null) {
  return readPerItem(source, componentRepeated, across)
    .filter((control) => control.perItem)
    .map(({ line, tag, key, via }) => ({ line, tag, key, via }));
}

/**
 * A template's controls named by a bare key (readHeldApart), each with
 * `perItem` set when the sixth rule reads it as stamped once per item, as
 * scanItemlessLabels describes `componentRepeated` and `across`.
 */
function readPerItem(source, componentRepeated, across) {
  const { controls } = readHeldApart(source);
  const apart = across ?? {
    keys: new Set(),
    slots: heldApartAcross([{ key: '', selector: null, source }]).slots.get('') ?? new Set(),
  };
  const reachedApart = (control) =>
    apart.keys.has(control.key) || control.cases.some(({ switchAt }) => apart.slots.has(`${switchAt} ${control.key}`));
  return controls.map((control) => ({
    ...control,
    perItem: control.repeated || componentRepeated || reachedApart(control),
  }));
}

/**
 * Whether two arm ancestries (walkTemplate's `arms`) never render at once:
 * at the deepest chain both sit in, they sit in different arms. Below a
 * chain where they part, nothing is shared, so that chain is the deepest.
 */
function exclusiveArms(a, b) {
  const armIn = new Map(b.map(({ chainAt, armAt }) => [chainAt, armAt]));
  for (let i = a.length - 1; i >= 0; i--) {
    const { chainAt, armAt } = a[i];
    if (armIn.has(chainAt)) return armIn.get(chainAt) !== armAt;
  }
  return false;
}

/** The keys a bare key names its control by: one, or a ternary's two (bareKeyOf). */
const keysOf = (key) => key.split(' : ');

/**
 * The ninth rule over one template: each control named by its `aria-label`
 * with a bare key (bareKeyLabel) that shares one of its keys, a ternary's
 * either branch, with another such control of the template that can render
 * beside it, so the two read one name side by side. Two controls render
 * beside each other unless they sit in different arms of one `@if` chain or
 * one switch (exclusiveArms). A control the sixth rule reads as stamped once
 * per item is its, not this rule's (readPerItem, with `componentRepeated`
 * and `across` as scanItemlessLabels takes them), and a control named by its
 * own text is not read. Returns `{ line, tag, key, beside }` for each, `line`
 * the label's own and `beside` the lines of the controls it shares a key
 * with.
 */
export function scanSiblingLabels(source, componentRepeated = false, across = null) {
  const once = readPerItem(source, componentRepeated, across).filter(
    (control) => !control.perItem && control.via === 'label'
  );
  const hits = [];
  for (const control of once) {
    const keys = new Set(keysOf(control.key));
    const beside = once.filter(
      (other) =>
        other !== control && keysOf(other.key).some((key) => keys.has(key)) && !exclusiveArms(control.arms, other.arms)
    );
    if (beside.length > 0) {
      hits.push({ line: control.line, tag: control.tag, key: control.key, beside: beside.map((other) => other.line) });
    }
  }
  return hits;
}

/**
 * The binding the sixth rule's fix hint gives as its model: the upload
 * area's own, which names a photo by its place among the photos and its
 * name. The self-test holds it to file-dropzone.component.html, so the hint
 * never quotes a binding the tree no longer has.
 */
export const ITEMLESS_MODEL = "'import.movePhotoUpLabel' | translate: { position: photoNumber(file), name: file.name }";

/** The fix the sixth rule prints under each hit, ITEMLESS_MODEL its example. */
export function itemlessHint() {
  return `give the key a slot for the item and fill it, as ${ITEMLESS_MODEL}`;
}

/**
 * The binding the sixth rule's hint for a text-named control gives as its
 * model: the goal card's View Transactions, whose name holds the words it
 * shows and the goal. The self-test holds it to goal-progress-card's
 * template, as it holds ITEMLESS_MODEL to the upload area's.
 */
export const ITEMLESS_TEXT_MODEL = "'goal.viewTransactionsNamed' | translate: { name: goal().name }";

/**
 * The fix the sixth rule prints under a hit named by its own text,
 * ITEMLESS_TEXT_MODEL its example. The name a screen reader hears has to hold
 * the words a sighted user sees, so a speech user can say them (WCAG 2.5.3).
 */
export function itemlessTextHint() {
  return (
    'keep the visible words, add the item: bind [attr.aria-label] to a key whose sentence holds ' +
    `the control's own text and a slot for the item, as ${ITEMLESS_TEXT_MODEL}`
  );
}

/**
 * The binding the ninth rule's fix hint gives as its model: the AI page's
 * remove, which names the key it removes by its provider. The self-test holds
 * it to ai-settings-page's template, as it holds ITEMLESS_MODEL to the upload
 * area's.
 */
export const SIBLING_MODEL = "'settings.removeApiKey' | translate: { provider: providerName('gemini') }";

/** The fix the ninth rule prints under each hit, SIBLING_MODEL its example. */
export function siblingHint() {
  return `name each by what it acts on, with a key of its own or a slot for it filled, as ${SIBLING_MODEL}`;
}

/**
 * Per-item controls named by a key with no parameters that the sixth rule
 * found when it landed, outside what that change fixed. Each row is a file, a
 * key, how many controls in that file carry it, and what repeats them. Empty
 * is the goal: a row is a debt with a name, and it goes when its controls name
 * their item.
 */
export const ITEMLESS_FROZEN = [];

/**
 * Sets one rule's hits (`{ site, tag, key }`, `site` a repo-relative
 * `file:line`) against its frozen rows. A hit and a row match on the hit's
 * file and their key, so a frozen control that only moves still matches.
 * Hits are tallied per row: `fresh` are the hits no row names, and `drift` the
 * rows whose tally is not their count (a tally of 0 is a row with nothing left
 * to freeze), each with the sites it matched. Both fail.
 */
export function againstFrozen(hits, frozen) {
  const fileOf = (site) => site.slice(0, site.lastIndexOf(':'));
  const matched = frozen.map(() => []);
  const fresh = [];
  for (const hit of hits) {
    const index = frozen.findIndex((row) => row.file === fileOf(hit.site) && row.key === hit.key);
    if (index === -1) fresh.push(hit);
    else matched[index].push(hit.site);
  }
  const drift = frozen
    .map((row, index) => ({ file: row.file, key: row.key, count: row.count, sites: matched[index] }))
    .filter((row) => row.sites.length !== row.count);
  return { fresh, drift };
}

/** The attributes that name other elements by id, each a list of one or more. */
const IDREF_ATTRS = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for']);

/**
 * Each attribute in a tag, with its value when it has one, quoted or not. A
 * quoted value is stepped over whole, so a word inside an expression is never
 * read as an attribute. A bound attribute keeps its brackets in its name, so
 * `[attr.aria-labelledby]` and `[for]` are not the literal ones.
 */
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/**
 * The literal ids a template declares, and each id its literal references
 * name, `{ line, tag, attr, id }` with the attribute's own line. A value
 * holding an interpolation is neither.
 */
export function readIds(source) {
  const declared = new Set();
  const references = [];
  walkTemplate(source, ({ name, attrs, line }) => {
    for (const attribute of attrs.matchAll(ATTRIBUTE)) {
      const attr = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (value === undefined || value.includes('{{')) continue;
      if (attr === 'id') {
        declared.add(value);
        continue;
      }
      if (!IDREF_ATTRS.has(attr)) continue;
      const at = line + attrs.slice(0, attribute.index).split('\n').length - 1;
      for (const id of value.split(/\s+/).filter(Boolean)) references.push({ line: at, tag: name, attr, id });
    }
  });
  return { declared, references };
}

/**
 * Every id a literal reference names that no literal `id` in the same
 * template declares, before or after it. Returns `{ line, tag, attr, id }`
 * for each.
 */
export function scanDanglingIds(source) {
  const { declared, references } = readIds(source);
  return references.filter((reference) => !declared.has(reference.id));
}

/** The Material toggles that render their own control and name it from their label or their inputs. */
const TOGGLE_TAGS = new Set(['mat-checkbox', 'mat-slide-toggle', 'mat-radio-button']);

/**
 * The attributes of a tag as ATTRIBUTE reads them, `{ name, value }`, the
 * value undefined where none is written. A word inside another attribute's
 * value is never one of them.
 */
function attributesOf(attrs) {
  return Array.from(attrs.matchAll(ATTRIBUTE), (attribute) => ({
    name: attribute[1],
    value: attribute[2] ?? attribute[3] ?? attribute[4],
  }));
}

/**
 * True when a tag carries one of `names` with a value that is not blank. An
 * empty or blank `aria-label` or `aria-labelledby` names nothing: the name is
 * then computed from what the control holds, as though the attribute were not
 * written, so it is read as not written. An `<img>` with an empty alt is
 * silent the same way (spokenBy).
 */
const namedBy = (names) => (attrs) =>
  attributesOf(attrs).some(({ name, value }) => names.has(name) && value !== undefined && value.trim() !== '');

/**
 * The names a toggle hands to the control inside it: `aria-label` or
 * `aria-labelledby`, literal, interpolated or bound to the input
 * (`[aria-label]`, `[aria-labelledby]`), each with a value that is not blank.
 * `[attr.aria-label]` and `[attr.aria-labelledby]` are not among them, since
 * they land on the host, and neither is any other spelling that ends in the
 * name, such as `bind-attr.aria-label`.
 */
const TOGGLE_NAMES = new Set(['aria-label', 'aria-labelledby', '[aria-label]', '[aria-labelledby]']);

const toggleNamed = namedBy(TOGGLE_NAMES);

/** MatSlider's thumb input, in each of its three spellings. */
const SLIDER_THUMBS = new Set(['matSliderThumb', 'matSliderStartThumb', 'matSliderEndThumb']);

const isSliderThumb = (attrs) => attributesOf(attrs).some(({ name }) => SLIDER_THUMBS.has(name));

/**
 * The names a slider's thumb carries itself. The thumb is a plain input, so
 * the attribute bindings land on it too; each needs a value that is not
 * blank (namedBy).
 */
const THUMB_NAMES = new Set([...TOGGLE_NAMES, '[attr.aria-label]', '[attr.aria-labelledby]']);

const thumbNamed = namedBy(THUMB_NAMES);

/**
 * The block keywords that carry on the block before them rather than open
 * one of their own: an `@if`'s `@else` and `@else if`, an `@for`'s `@empty`,
 * and a `@defer`'s `@placeholder`, `@loading` and `@error`.
 */
const CHAIN_CONTINUES = new Set(['else', 'empty', 'placeholder', 'loading', 'error']);

/**
 * Opens one block in the tree readTree builds: a new chain, a further branch
 * of the chain just closed, or a case of the open switch. `open` is the stack
 * of open frames, innermost last; the branch opened goes on top of it.
 */
function openTreeBlock(keyword, header, open) {
  const parent = open.at(-1);
  const branch = { type: 'branch', children: [] };
  const previous = parent.children.at(-1);
  if (CHAIN_CONTINUES.has(keyword) && previous?.type === 'chain') {
    previous.branches.push(branch);
    if (keyword === 'empty' || (keyword === 'else' && !/^\s*if\b/.test(header))) previous.complete = true;
  } else if ((keyword === 'case' || keyword === 'default') && parent.type === 'chain') {
    parent.branches.push(branch);
    if (keyword === 'default') parent.complete = true;
  } else if (keyword === 'switch') {
    // A switch's own body holds its cases and nothing that renders.
    const chain = { type: 'chain', kind: keyword, branches: [], complete: false, children: [] };
    parent.children.push(chain);
    open.push(chain);
    return;
  } else {
    parent.children.push({ type: 'chain', kind: keyword, branches: [branch], complete: false });
  }
  open.push(branch);
}

/**
 * A template read as a tree, for the eighth rule. An element is
 * `{ type: 'element', name, attrs, line, children }`; a run of text that
 * renders something, an interpolation or anything left once block syntax is
 * taken out, is `{ type: 'text' }`; a block is a chain of its branches,
 * `{ type: 'chain', kind, branches, complete }`, `kind` being the keyword
 * that opened it and each branch `{ type: 'branch', children }`. A chain is
 * complete when, whatever its condition, one of its branches renders: an `@if`
 * that ends in a plain `@else`, an `@switch` with an `@default` or closed by
 * the exhaustive `@default never;`, which the compiler holds to a `@case` for
 * every value its subject's type takes, an `@for` with an `@empty`. A `@defer`
 * never is, whatever follows it. Returns the root, a branch holding the
 * template's top level.
 *
 * Interpolations are set aside before block syntax is read, as readBlocks
 * sets them aside, since their braces are an expression's; an `@let`
 * declares a value and renders nothing (readBlockHead).
 */
function readTree(source) {
  const masked = maskComments(source);
  const root = { type: 'branch', children: [] };
  // Open elements, branches and switches, innermost last.
  const open = [root];
  const readRun = (run) => {
    const plain = run.replace(/\{\{[\s\S]*?\}\}/g, (body) => 'x'.padEnd(body.length));
    let from = 0;
    const text = (to) => {
      if (/\S/.test(plain.slice(from, to))) open.at(-1).children.push({ type: 'text' });
    };
    let i = 0;
    while (i < plain.length) {
      if (plain[i] === '}') {
        text(i);
        const block = open.findLastIndex((frame) => frame.type !== 'element');
        if (block > 0) open.length = block;
        i += 1;
        from = i;
        continue;
      }
      const head = plain[i] === '@' ? readBlockHead(plain, i) : null;
      if (!head) {
        i += 1;
        continue;
      }
      text(i);
      if (head.opens) openTreeBlock(head.keyword, head.header, open);
      else if (head.keyword === 'default never' && open.at(-1).type === 'chain') open.at(-1).complete = true;
      i = head.next;
      from = i;
    }
    text(plain.length);
  };
  const tag = new RegExp(ANY_TAG.source, 'g');
  let last = 0;
  let match;
  while ((match = tag.exec(masked)) !== null) {
    readRun(masked.slice(last, match.index));
    last = tag.lastIndex;
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = open.map((frame) => (frame.type === 'element' ? frame.name : null)).lastIndexOf(name);
      if (at > 0) open.length = at;
      continue;
    }
    const element = { type: 'element', name, attrs, line: lineOf(masked, match.index), children: [] };
    open.at(-1).children.push(element);
    if (!/\/\s*$/.test(attrs) && !VOID_ELEMENTS.has(name)) open.push(element);
  }
  readRun(masked.slice(last));
  return root;
}

/** What renders nothing that names a control, and what names it in every state. */
const SILENT = { ever: false, always: false };
const SPOKEN = { ever: true, always: true };

/** The spellings of an image's alternative text. */
const ALT_NAMES = new Set(['alt', '[alt]', '[attr.alt]']);

/**
 * Attributes that fill an element with something the template does not hold
 * as a child: text a property binding writes, or a template an outlet stamps.
 */
const FILLED_BY = new Set(['[textContent]', '[innerText]', '[innerHTML]', '*ngTemplateOutlet', '[ngTemplateOutlet]']);

/**
 * What a list of nodes renders that can name the control holding them:
 * `ever`, in at least one state of their blocks; `always`, in every state.
 * One node that renders in every state is enough.
 */
function spokenIn(nodes) {
  const parts = nodes.map(spokenBy);
  return { ever: parts.some((part) => part.ever), always: parts.some((part) => part.always) };
}

/** What an element renders inside itself (spokenIn), or SPOKEN when FILLED_BY fills it. */
function heldBy(element) {
  return attributesOf(element.attrs).some(({ name }) => FILLED_BY.has(name)) ? SPOKEN : spokenIn(element.children);
}

/**
 * What one node renders that can name its control (spokenIn). Text does. A
 * chain renders in every state when it is complete and each of its branches
 * does. Of the elements, a `mat-icon` renders its name only when it is written
 * to be read, named with a literal `aria-hidden="false"` (the first rule's
 * shape), since MatIcon hides it and its ligature otherwise; one with a
 * literal `aria-hidden="true"` and an `<ng-template>`, stamped elsewhere if at
 * all, render nothing; an `<img>` renders its alt when that is not empty; an
 * `<ng-content>` and a component, any other tag with a hyphen but an
 * `<ng-container>`, are read as words, since what they render is not in this
 * template; any other element renders what it holds (heldBy).
 */
function spokenBy(node) {
  if (node.type === 'text') return SPOKEN;
  if (node.type === 'chain') {
    const parts = node.branches.map((branch) => spokenIn(branch.children));
    return { ever: parts.some((part) => part.ever), always: node.complete && parts.every((part) => part.always) };
  }
  if (node.name === 'mat-icon') return NAMED.test(node.attrs) && LITERAL_VISIBLE.test(node.attrs) ? SPOKEN : SILENT;
  if (node.name === 'ng-template' || literallyHidden(node.attrs)) return SILENT;
  if (node.name === 'img') {
    return attributesOf(node.attrs).some(({ name, value }) => ALT_NAMES.has(name) && value) ? SPOKEN : SILENT;
  }
  if (node.name === 'ng-content' || (node.name.includes('-') && node.name !== 'ng-container')) return SPOKEN;
  return heldBy(node);
}

/** True when a list of nodes holds a control-flow block, at any depth. */
function holdsBlock(nodes) {
  return nodes.some((node) => node.type === 'chain' || (node.type === 'element' && holdsBlock(node.children)));
}

/** Controls named by a label or an attribute, never by what they hold, whatever role they carry. */
const FIELD_TAGS = new Set(['select', 'textarea', 'mat-select']);

/**
 * Every control in a template the eighth rule reads, in the order its opening
 * tags come: `{ line, tag, kind, named, ever, always, blocks }`. `kind` is
 * `'toggle'` for a checkbox, a slide toggle or a radio button, `'slider'` for
 * a slider, and `'plain'` for a button, a link or an element with a control's
 * literal role (CONTROL_ROLE), a void element or a field (FIELD_TAGS) aside.
 * `named` is true when an attribute names it: for a toggle one of
 * TOGGLE_NAMES (toggleNamed); for a plain control any spelling of
 * `aria-label` or `aria-labelledby` with a value that is not blank, since each
 * lands on a plain element, as on a slider's thumb (thumbNamed); for a slider,
 * every thumb carrying one. `ever` and `always` say what it holds (heldBy),
 * and `blocks` whether that is read through a control-flow block.
 */
function readControls(source) {
  const found = [];
  const thumbsIn = (nodes) =>
    nodes.flatMap((node) => {
      if (node.type === 'chain') return node.branches.flatMap((branch) => thumbsIn(branch.children));
      if (node.type !== 'element') return [];
      return [...(isSliderThumb(node.attrs) ? [node.attrs] : []), ...thumbsIn(node.children)];
    });
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'chain') {
        for (const branch of node.branches) visit(branch.children);
        continue;
      }
      if (node.type !== 'element') continue;
      const { name, attrs, line } = node;
      if (name === 'mat-slider') {
        const named = thumbsIn(node.children).every(thumbNamed);
        found.push({ line, tag: name, kind: 'slider', named, ever: named, always: named, blocks: false });
      } else if (
        (TEXT_NAMED_TAGS.has(name) || CONTROL_ROLE.test(attrs)) &&
        !VOID_ELEMENTS.has(name) &&
        !FIELD_TAGS.has(name)
      ) {
        const toggle = TOGGLE_TAGS.has(name);
        found.push({
          line,
          tag: name,
          kind: toggle ? 'toggle' : 'plain',
          named: toggle ? toggleNamed(attrs) : thumbNamed(attrs),
          // An icon that is itself the control is read as spokenBy reads one
          // inside a control: MatIcon hides it, ligature and all.
          ...(name === 'mat-icon' ? spokenBy(node) : heldBy(node)),
          blocks: holdsBlock(node.children),
        });
      }
      visit(node.children);
    }
  };
  visit(readTree(source).children);
  return found;
}

/**
 * Every control that names nothing in some state of its blocks, or in all of
 * them: a toggle or a plain control (readControls) that no attribute names
 * and that holds nothing rendering in every state, and a slider with a thumb
 * no attribute names, whatever the slider's host carries. Returns
 * `{ line, tag, sometimes }` for each, `line` being the opening tag's and
 * `sometimes` true when what the control holds renders in some states and
 * not in others: words inside an `@if` with no `@else`, an `@switch` with no
 * `@default` or an `@for` with no `@empty`.
 */
export function scanUnnamedControls(source) {
  return unnamedAmong(readControls(source));
}

/** The controls among readControls' that scanUnnamedControls reports, as it reports them. */
function unnamedAmong(controls) {
  return controls
    .filter((control) => !control.named && !control.always)
    .map(({ line, tag, ever }) => ({ line, tag, sometimes: ever }));
}

/**
 * Controls the eighth rule found unnamed in some state or in all, toggles and
 * sliders when it landed and buttons, links and controls by role when it
 * widened, outside what each change fixed. Rows as ITEMLESS_FROZEN's, read by
 * againstFrozen, the key being the tag; `why` says which control it is and
 * where its name went instead. Empty is the goal.
 */
export const UNNAMED_FROZEN = [];

/** The tags the tenth rule reads as a single-choice group (readGroups). */
const GROUP_TAGS = new Set(['mat-button-toggle-group', 'mat-radio-group']);

/** A literal `role="radiogroup"` on any other element. */
const RADIOGROUP_ROLE = /(?<![\w.[-])role\s*=\s*"radiogroup"/;

/**
 * True when a toggle group lets more than one choice stand: a literal
 * `multiple`, or `[multiple]` bound to anything but `false`. Such a group
 * renders `role="group"`, which a reader enters without needing its name.
 * A literal `multiple="false"` is read as Material's boolean input reads it.
 */
function isMultiple(attrs) {
  return attributesOf(attrs).some(
    ({ name, value }) =>
      (name === 'multiple' && value?.trim() !== 'false') || (name === '[multiple]' && value?.trim() !== 'false')
  );
}

/**
 * Every single-choice group in a template: a `mat-button-toggle-group` that is
 * not `multiple` (isMultiple), a `mat-radio-group`, and any element with a
 * literal `role="radiogroup"`. Each carries its role on its own host, so every
 * spelling of `aria-label` or `aria-labelledby` lands where the role is, as on
 * a slider's thumb (THUMB_NAMES), each with a value that is not blank.
 * Returns `{ line, tag, named }` for each, `line` being the opening tag's.
 */
function readGroups(source) {
  const found = [];
  walkTemplate(source, ({ name, attrs, line }) => {
    const single =
      name === 'mat-button-toggle-group' ? !isMultiple(attrs) : GROUP_TAGS.has(name) || RADIOGROUP_ROLE.test(attrs);
    if (single) found.push({ line, tag: name, named: thumbNamed(attrs) });
  });
  return found;
}

/** The single-choice groups readGroups finds with no name, as `{ line, tag }`. */
export function scanUnnamedGroups(source) {
  return readGroups(source)
    .filter((group) => !group.named)
    .map(({ line, tag }) => ({ line, tag }));
}

/**
 * The binding the tenth rule's hint shows, as the category manager's type
 * group carries it. The self-test holds the hint to that template, so the
 * model cannot drift from the code it quotes.
 */
const GROUP_MODEL = `[attr.aria-label]="'settings.categoryType' | translate"`;

/** What the tenth rule asks of an unnamed group. */
export function groupHint() {
  return (
    `name the group with a key that says what it chooses, ${GROUP_MODEL}, or with ` +
    `aria-labelledby on a visible label beside it, as the theme group does`
  );
}

/**
 * Which templates belong to a component rendered once per item somewhere.
 * `templates` is a list of `{ key, selector, source }`, `selector` being the
 * owning component's element selector or null. A template is repeated when
 * another stamps its selector inside a repeat, or uses it at all inside a
 * template that is itself repeated; the second clause runs to a fixed point,
 * so a card inside a repeated row is repeated too. Returns the set of keys.
 *
 * With `casesApart`, a selector under an `@case` on the `@for`'s own item is
 * stamped once (walkTemplate), as the dashboard stamps each of its cards,
 * unless two or more of that switch's cases reach it, written there or
 * stamped by what they stamp (heldApartAcross, or `apart` when the caller
 * has it): then it renders once per item that reaches any of them, as the
 * dashboard's card menu and empty state render once per card, and stays
 * repeated.
 */
export function repeatedTemplates(templates, { casesApart = false, apart = null } = {}) {
  const bySelector = selectorIndex(templates);
  const uses = templates.map(({ key, source }) => {
    const found = [];
    walkTemplate(
      source,
      ({ name, repeated }) => {
        if (bySelector.has(name)) found.push({ name, repeated });
      },
      { casesApart }
    );
    return { key, found };
  });
  // A component two cases of one held-apart switch reach, written there or
  // stamped by what they stamp, renders once per item reaching either.
  const reachedApart = casesApart ? (apart ?? heldApartAcross(templates)).selectors : new Set();
  const repeated = new Set(templates.filter(({ selector }) => reachedApart.has(selector)).map(({ key }) => key));
  let grew = true;
  while (grew) {
    grew = false;
    for (const { key, found } of uses) {
      for (const use of found) {
        if (!use.repeated && !repeated.has(key)) continue;
        for (const target of bySelector.get(use.name)) {
          if (!repeated.has(target)) {
            repeated.add(target);
            grew = true;
          }
        }
      }
    }
  }
  return repeated;
}

/**
 * The sixth rule over every template at once, as the run reads it: which
 * components another template stamps once per item, an `@case` on the
 * `@for`'s own item held apart (repeatedTemplates with `casesApart`), and
 * each template's controls scanned with its component's verdict and the keys
 * two cases of a held-apart switch reach in it (heldApartAcross,
 * scanItemlessLabels). `templates` is a list of
 * `{ key, selector, source, offset }`. Returns `{ hits, keys, apart }`: each
 * hit as `{ site, tag, key, via }`, `site` the template's key and the hit's
 * line in its file (the label's, or the opening tag's for a control named by
 * its text), `keys` the set of repeated templates, and `apart`
 * heldApartAcross's verdict, which scanSiblingsAcross reads too.
 */
export function scanItemlessAcross(templates) {
  const apart = heldApartAcross(templates);
  const keys = repeatedTemplates(templates, { casesApart: true, apart });
  const hits = [];
  for (const template of templates) {
    for (const hit of scanItemlessLabels(template.source, keys.has(template.key), acrossOf(apart, template.key))) {
      hits.push({ site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, key: hit.key, via: hit.via });
    }
  }
  return { hits, keys, apart };
}

/** heldApartAcross's verdict for one template, as scanItemlessLabels takes it. */
function acrossOf(apart, key) {
  return { keys: apart.keys.get(key) ?? new Set(), slots: apart.slots.get(key) ?? new Set() };
}

/**
 * The ninth rule over every template, each read with what the sixth rule
 * decided of it (`keys`, the repeated templates, and `apart`, as
 * scanItemlessAcross returns them), so a control the sixth rule reports is
 * not reported twice. Returns `{ hits, read }`: each hit as
 * `{ site, tag, key, beside }`, `beside` the lines in its file of the
 * controls it shares a key with, and `read` how many controls rendered once
 * and named by a bare `aria-label` were read.
 */
export function scanSiblingsAcross(templates, { keys, apart }) {
  const hits = [];
  let read = 0;
  for (const template of templates) {
    const componentRepeated = keys.has(template.key);
    const across = acrossOf(apart, template.key);
    read += readPerItem(template.source, componentRepeated, across).filter(
      (control) => !control.perItem && control.via === 'label'
    ).length;
    for (const hit of scanSiblingLabels(template.source, componentRepeated, across)) {
      hits.push({
        site: `${template.key}:${hit.line + template.offset}`,
        tag: hit.tag,
        key: hit.key,
        beside: hit.beside.map((line) => line + template.offset),
      });
    }
  }
  return { hits, read };
}

/**
 * The inline `template:` literal in a component's `.ts` source, with the
 * number of lines before it, so a line found in the template plus `offset` is
 * the line in the file; null when the source has none.
 */
export function inlineTemplateOf(source) {
  const inline = /\btemplate:\s*`([\s\S]*?)`/.exec(source)?.[1];
  if (inline === undefined) return null;
  // A hit's line counts from the template's first line, the backtick's.
  return { source: inline, offset: lineOf(source, source.indexOf(inline)) - 1 };
}

/**
 * The templates under `files`, each with its owning component's element
 * selector: an `.html` file through the `templateUrl` that names it, an
 * inline `template:` literal through its own file. A `.ts` file with no
 * inline template contributes nothing.
 */
function templatesOf(files) {
  const selectorOfHtml = new Map();
  const templates = [];
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('@Component')) continue;
    const selector = /\bselector:\s*['"]([a-z][\w-]*)['"]/.exec(source)?.[1] ?? null;
    const url = /\btemplateUrl:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
    if (url) {
      selectorOfHtml.set(posix(join(dirname(file), url)), selector);
      continue;
    }
    const inline = inlineTemplateOf(source);
    if (inline === null) continue;
    templates.push({ key: posix(file), selector, source: inline.source, offset: inline.offset });
  }
  for (const file of files) {
    if (!file.endsWith('.html')) continue;
    const key = posix(file);
    const source = readFileSync(file, 'utf8');
    templates.push({ key, selector: selectorOfHtml.get(key) ?? null, source, offset: 0 });
  }
  return templates;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.html') || (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))) {
      found.push(path);
    }
  }
  return found;
}

function posix(path) {
  return path.split(sep).join('/');
}

function run() {
  const files = walk(SOURCE_DIR);
  const findings = [];
  let icons = 0;
  let named = 0;
  let progressTags = 0;
  let progressNamed = 0;
  let optionFiles = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const hasIcon = source.includes('<mat-icon');
    // A file with a progress indicator and no mat-icon must still be read,
    // for the progress rule below.
    const hasProgress = /<mat-(spinner|progress-bar|progress-spinner)\b/.test(source);
    if (!hasIcon && !hasProgress) continue;
    const masked = maskComments(source);

    if (hasIcon) {
      ICON_TAG.lastIndex = 0;
      let match;
      while ((match = ICON_TAG.exec(masked)) !== null) {
        icons++;
        if (NAMED.test(match[1])) named++;
      }
      for (const hit of scan(source)) {
        findings.push({ rule: 'icon', site: `${posix(file)}:${hit.line}`, tag: 'mat-icon', attrs: hit.attrs });
      }
      if (/<mat-option\b/.test(masked)) {
        optionFiles++;
        for (const hit of scanOptionIcons(source)) {
          findings.push({ rule: 'option', site: `${posix(file)}:${hit.line}`, tag: 'mat-icon', wrapper: hit.wrapper });
        }
      }
    }

    if (hasProgress) {
      PROGRESS_TAG.lastIndex = 0;
      let match;
      while ((match = PROGRESS_TAG.exec(masked)) !== null) {
        progressTags++;
        if (PROGRESS_NAMED.test(match[2]) || PROGRESS_HIDDEN.test(match[2])) progressNamed++;
      }
      for (const hit of scanProgress(source)) {
        findings.push({ rule: 'progress', site: `${posix(file)}:${hit.line}`, tag: hit.tag, attrs: hit.attrs });
      }
    }
  }

  // The menu rule needs every template at once: whether a component is
  // repeated is decided by the templates that use it.
  const sources = templatesOf(files);
  const repeatedKeys = repeatedTemplates(sources);
  let triggers = 0;
  let repeatedTriggers = 0;
  for (const template of sources) {
    if (!MENU_TRIGGER.test(template.source)) continue;
    const componentRepeated = repeatedKeys.has(template.key);
    walkTemplate(template.source, ({ attrs, repeated }) => {
      if (!MENU_TRIGGER.test(attrs)) return;
      triggers++;
      if (repeated || componentRepeated) repeatedTriggers++;
    });
    for (const hit of scanMenuTriggers(template.source, componentRepeated)) {
      findings.push({ rule: 'menu', site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, attrs: hit.attrs });
    }
  }

  // The tooltip rule needs the same structure: an <ng-template> around an icon
  // exempts it, and only a template's own tags say whether one is open.
  let tooltipFlags = 0;
  let reachableFlags = 0;
  for (const template of sources) {
    if (!template.source.includes('<mat-icon')) continue;
    walkTemplate(template.source, ({ name, attrs, inTemplate }) => {
      if (!isTooltipFlag(name, attrs)) return;
      tooltipFlags++;
      if (inTemplate || LITERAL_TABINDEX.test(attrs)) reachableFlags++;
    });
    for (const hit of scanTooltipIcons(template.source)) {
      findings.push({ rule: 'tooltip', site: `${template.key}:${hit.line + template.offset}`, tag: 'mat-icon', attrs: hit.attrs });
    }
  }

  // The per-item rule reads each template's own repeats and the components
  // other templates stamp per item, holding apart an @case on the @for's own
  // item, and sets what it finds against the rows frozen when it landed.
  const { hits: itemless, keys: itemlessKeys, apart } = scanItemlessAcross(sources);
  const { fresh, drift } = againstFrozen(itemless, ITEMLESS_FROZEN);
  for (const hit of fresh) findings.push({ rule: 'itemless', site: hit.site, tag: hit.tag, key: hit.key, via: hit.via });
  for (const row of drift) findings.push({ rule: 'itemless-drift', site: row.file, ...row });

  // The sibling rule reads the controls rendered once, with what the per-item
  // rule decided, so no control is reported by both.
  const siblings = scanSiblingsAcross(sources, { keys: itemlessKeys, apart });
  for (const hit of siblings.hits) {
    findings.push({ rule: 'sibling', site: hit.site, tag: hit.tag, key: hit.key, beside: hit.beside });
  }

  // The id rule reads each template whole, since a reference may come before
  // the element it names.
  let idReferences = 0;
  for (const template of sources) {
    idReferences += readIds(template.source).references.length;
    for (const hit of scanDanglingIds(template.source)) {
      findings.push({ rule: 'idref', site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, attr: hit.attr, id: hit.id });
    }
  }

  // The unnamed-control rule reads what each control holds across the
  // branches of its blocks, and each slider's thumbs, and sets what it finds
  // against the rows frozen when it landed.
  const controlKinds = { toggle: 0, plain: 0, slider: 0 };
  let byContent = 0;
  let throughBlocks = 0;
  const unnamed = [];
  for (const template of sources) {
    const controls = readControls(template.source);
    for (const control of controls) {
      controlKinds[control.kind]++;
      if (control.kind === 'slider' || control.named) continue;
      byContent++;
      if (control.blocks) throughBlocks++;
    }
    for (const hit of unnamedAmong(controls)) {
      unnamed.push({ site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, key: hit.tag, sometimes: hit.sometimes });
    }
  }
  const unnamedVerdict = againstFrozen(unnamed, UNNAMED_FROZEN);
  for (const hit of unnamedVerdict.fresh) {
    findings.push({ rule: 'unnamed', site: hit.site, tag: hit.tag, sometimes: hit.sometimes });
  }
  for (const row of unnamedVerdict.drift) findings.push({ rule: 'unnamed-drift', site: row.file, ...row });

  // The group rule reads each single-choice group's own tag.
  let groups = 0;
  let unnamedGroups = 0;
  for (const template of sources) {
    groups += readGroups(template.source).length;
    for (const hit of scanUnnamedGroups(template.source)) {
      unnamedGroups++;
      findings.push({ rule: 'group', site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag });
    }
  }

  const templates = files.filter((file) => file.endsWith('.html')).length;
  console.log(
    `Checked ${icons} mat-icon tag(s) across ${templates} template(s) and ` +
      `${files.length - templates} inline-template source file(s): ${named} carry an accessible name.`
  );
  console.log(
    `Checked ${progressTags} progress indicator tag(s) (mat-spinner, mat-progress-bar, ` +
      `mat-progress-spinner): ${progressNamed} carry a name or are hidden inside a control ` +
      `that already announces it.`
  );
  console.log(`Checked the option icons in ${optionFiles} file(s) that hold both a mat-option and a mat-icon.`);
  console.log(
    `Checked ${triggers} menu trigger(s) across ${sources.length} template(s): ` +
      `${repeatedTriggers} are stamped once per item, ${repeatedKeys.size} template(s) belonging to a repeated component.`
  );
  console.log(
    `Checked ${tooltipFlags} named icon(s) with a tooltip: ${reachableFlags} take focus ` +
      `or are stamped through an ng-template.`
  );
  const itemlessByText = itemless.filter((hit) => hit.via === 'text').length;
  console.log(
    `Checked the controls stamped once per item across ${sources.length} template(s): ` +
      `${itemless.length} take their name from a key with no parameters ` +
      `(${itemless.length - itemlessByText} by their aria-label, ${itemlessByText} by their own text), ` +
      `${ITEMLESS_FROZEN.reduce((sum, row) => sum + row.count, 0)} frozen by name; ` +
      `${itemlessKeys.size} template(s) belong to a component another template stamps once per item.`
  );
  console.log(
    `Checked ${siblings.read} control(s) rendered once and named by an aria-label with a key with no ` +
      `parameters across ${sources.length} template(s): ${siblings.hits.length} share a key with a ` +
      `control of their template that can show beside them.`
  );
  console.log(
    `Checked ${idReferences} id(s) named by a literal aria-labelledby, aria-describedby, ` +
      `aria-controls, aria-owns or for across ${sources.length} template(s).`
  );
  console.log(
    `Checked ${controlKinds.toggle} checkbox, slide toggle and radio button tag(s), ` +
      `${controlKinds.plain} button(s), link(s) and element(s) with a control's role, and ` +
      `${controlKinds.slider} slider(s) across ${sources.length} template(s): ${byContent} take their name ` +
      `from what they hold, ${throughBlocks} of them through a control-flow block; ${unnamed.length} name ` +
      `nothing in some state of their blocks or in all, ` +
      `${UNNAMED_FROZEN.reduce((sum, row) => sum + row.count, 0)} frozen by name.`
  );
  console.log(
    `Checked ${groups} single-choice group(s), toggle groups that are not multiple, radio groups and ` +
      `elements with role="radiogroup", across ${sources.length} template(s): ${unnamedGroups} carry no name.`
  );

  if (findings.length > 0) {
    findings.sort((a, b) => a.site.localeCompare(b.site));
    const iconFindings = findings.filter((f) => f.rule === 'icon');
    const progressFindings = findings.filter((f) => f.rule === 'progress');
    const optionFindings = findings.filter((f) => f.rule === 'option');
    const menuFindings = findings.filter((f) => f.rule === 'menu');
    const tooltipFindings = findings.filter((f) => f.rule === 'tooltip');
    const itemlessFindings = findings.filter((f) => f.rule === 'itemless');
    const driftFindings = findings.filter((f) => f.rule === 'itemless-drift');
    const siblingFindings = findings.filter((f) => f.rule === 'sibling');
    const idrefFindings = findings.filter((f) => f.rule === 'idref');
    const unnamedFindings = findings.filter((f) => f.rule === 'unnamed');
    const unnamedDriftFindings = findings.filter((f) => f.rule === 'unnamed-drift');
    const groupFindings = findings.filter((f) => f.rule === 'group');

    if (iconFindings.length > 0) {
      console.error(`\n${iconFindings.length} icon(s) carry a name nothing can read:\n`);
      for (const finding of iconFindings) {
        console.error(`  ${finding.site}  <${finding.tag} ${finding.attrs}>`);
        console.error(`    → add a literal aria-hidden="false"\n`);
      }
      console.error(
        `MatIcon sets aria-hidden="true" on itself at construction unless the\n` +
          `template carries a literal aria-hidden attribute — a bound\n` +
          `[attr.aria-hidden] does not count, because HostAttributeToken reads the\n` +
          `static attribute. So role="img" and a bound aria-label are not enough on\n` +
          `their own, and the icon is announced to nobody. Write aria-hidden="false"\n` +
          `beside the label, as transaction-list.component.html:135 does. An icon\n` +
          `that is meant to stay silent inside an already-labelled control takes a\n` +
          `literal aria-hidden="true" instead, which this check accepts.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (progressFindings.length > 0) {
      console.error(`\n${progressFindings.length} progress indicator(s) carry no accessible name:\n`);
      for (const finding of progressFindings) {
        console.error(`  ${finding.site}  <${finding.tag} ${finding.attrs}>`);
        console.error(`    → add [attr.aria-label] with a translated key, or a literal\n` +
          `      aria-hidden="true" if a control around it already announces the state\n`);
      }
      console.error(
        `mat-spinner, mat-progress-bar and mat-progress-spinner all render\n` +
          `role="progressbar" with no accessible name of their own — there is no\n` +
          `content for one to come from, unlike a button or a heading. Name it with a\n` +
          `translated [attr.aria-label], or hide the redundant progressbar node with a\n` +
          `literal aria-hidden="true" when it sits inside a button or role="status"\n` +
          `that already carries visible text for the same state.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (optionFindings.length > 0) {
      console.error(`\n${optionFindings.length} option icon(s) sit inside the option's name:\n`);
      for (const finding of optionFindings) {
        console.error(`  ${finding.site}  <mat-icon> inside <${finding.wrapper}>`);
        console.error(`    → make the mat-icon a direct child of the mat-option\n`);
      }
      console.error(
        `MatOption projects only a mat-icon that is its own direct child beside its\n` +
          `label; anything else, an icon in a wrapper included, goes into the label,\n` +
          `whose text is the option's viewValue. The icon's ligature then leads the\n` +
          `name in a closed select, in typeahead and in what the trigger announces.\n` +
          `Drop the wrapper, as recurring-form-dialog.component.html does, and size\n` +
          `the icon with a \`mat-option > mat-icon\` rule if it needs a size.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (menuFindings.length > 0) {
      console.error(`\n${menuFindings.length} repeated menu button(s) share a name that names no item:\n`);
      for (const finding of menuFindings) {
        console.error(`  ${finding.site}  <${finding.tag} ${finding.attrs}>`);
        console.error(`    → name the item: 'common.moreActionsFor' | translate: { description: <its visible name> }\n`);
      }
      console.error(
        `Every copy of a menu button stamped once per item announces the same\n` +
          `"More actions", so a screen reader moving through the list hears a run of\n` +
          `identical buttons and nothing that says which row the menu acts on. Name\n` +
          `the item, as the phone row in transaction-list.component.html does. A\n` +
          `button repeated by its parent counts: the budget card is one per budget.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (tooltipFindings.length > 0) {
      console.error(`\n${tooltipFindings.length} tooltip icon(s) the keyboard cannot reach:\n`);
      for (const finding of tooltipFindings) {
        console.error(`  ${finding.site}  <${finding.tag} ${finding.attrs}>`);
        console.error(`    → add a literal tabindex="0"\n`);
      }
      console.error(
        `MatTooltip opens for a pointer and for keyboard focus, and a mat-icon takes\n` +
          `focus from nothing. Without a literal tabindex the icon's sentence reaches\n` +
          `a mouse and a screen reader's browse mode and no one who tabs to the\n` +
          `field. Write tabindex="0" beside the label, as the transaction form's\n` +
          `amount flag does. An icon stamped through an <ng-template> into a control\n` +
          `that is itself the tab stop is exempt.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (itemlessFindings.length > 0) {
      console.error(`\n${itemlessFindings.length} repeated control(s) take a name that names no item:\n`);
      for (const finding of itemlessFindings) {
        if (finding.via === 'text') {
          console.error(`  ${finding.site}  <${finding.tag}> text {{ '${finding.key}' | translate }}`);
          console.error(`    → ${itemlessTextHint()}\n`);
        } else {
          console.error(`  ${finding.site}  <${finding.tag}> '${finding.key}' | translate`);
          console.error(`    → ${itemlessHint()}\n`);
        }
      }
      console.error(
        `A control stamped once per item takes its whole name from its aria-label,\n` +
          `or from its own text when it has none, and a key with no parameters gives\n` +
          `every copy the same one: a screen reader moving down the list hears the\n` +
          `same button again and nothing that says which item it acts on. Name the\n` +
          `item through the key's parameters, as the upload area's photo arrows do,\n` +
          `with whatever tells two items apart (two photos from an iPhone are both\n` +
          `image.jpg, so those name the photo's place among the photos too). A control\n` +
          `named by its text keeps the words it shows inside the name that adds the\n` +
          `item, so a speech user can say what they see: the goal card's View\n` +
          `Transactions reads "View Transactions for" and the goal. A control repeated\n` +
          `by its parent counts: the goal card is one per goal. A site that cannot be\n` +
          `fixed in the same change is frozen in ITEMLESS_FROZEN with its reason\n` +
          `(ADR 0145).\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (driftFindings.length > 0) {
      console.error(`\n${driftFindings.length} frozen per-item label row(s) no longer match their count:\n`);
      for (const finding of driftFindings) {
        console.error(`  ${finding.file}  '${finding.key}'  frozen ${finding.count}, found ${finding.sites.length}`);
        for (const site of finding.sites) console.error(`    at ${site}`);
        console.error(
          finding.sites.length > finding.count
            ? `    → name the item in the new control's key instead of freezing it\n`
            : `    → lower the row's count to what is left, or drop the row if nothing is\n`
        );
      }
      console.error(
        `ITEMLESS_FROZEN counts the frozen controls per file and key. A tally above\n` +
          `the count is a new control named by a frozen key; a tally below it is a\n` +
          `fixed debt still on the books, and the list is edited in the same commit\n` +
          `as the template. An edit that only moves a frozen control changes nothing.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (siblingFindings.length > 0) {
      console.error(`\n${siblingFindings.length} control(s) share a name with a control that can show beside them:\n`);
      for (const finding of siblingFindings) {
        const beside = finding.beside.map((line) => `:${line}`).join(', ');
        console.error(`  ${finding.site}  <${finding.tag}> '${finding.key}' | translate, beside ${beside}`);
        console.error(`    → ${siblingHint()}\n`);
      }
      console.error(
        `Two controls of one template named by one key with no parameters read one\n` +
          `name, and when both can render at once a screen reader moving between\n` +
          `them hears the same button twice and nothing that says which offer it\n` +
          `closes or which key it removes. Name each by what it acts on: the\n` +
          `transaction form's two dismissals have a key each, and the AI page's three\n` +
          `removes name their provider. Two controls in different arms of one\n` +
          `@if…@else, or in different cases of one @switch, never show together and\n` +
          `may share a name.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (idrefFindings.length > 0) {
      console.error(`\n${idrefFindings.length} id reference(s) name an id their template never declares:\n`);
      for (const finding of idrefFindings) {
        console.error(`  ${finding.site}  <${finding.tag}> ${finding.attr} names '${finding.id}'`);
        console.error(`    → give the element it means a literal id="${finding.id}", in this template\n`);
      }
      console.error(
        `aria-labelledby, aria-describedby, aria-controls, aria-owns and a label's\n` +
          `for name another element by its id. An id no element carries resolves to\n` +
          `nothing and says so nowhere: the control loses the name or the hint the\n` +
          `attribute was written to give it, and axe lists the reference for review,\n` +
          `not as a violation. Put a literal id on the element meant, beside its\n` +
          `class, as the import wizard's question above its receipt-or-statement\n` +
          `chips carries id="image-kind-label".\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (unnamedFindings.length > 0) {
      console.error(`\n${unnamedFindings.length} control(s) name nothing in some state of their blocks, or in all:\n`);
      for (const finding of unnamedFindings) {
        const toggle = TOGGLE_TAGS.has(finding.tag);
        if (finding.tag === 'mat-slider') {
          console.error(`  ${finding.site}  <mat-slider> with a thumb named by nothing`);
          console.error(`    → put the aria-label or aria-labelledby on each <input matSliderThumb>\n`);
        } else if (finding.sometimes) {
          console.error(`  ${finding.site}  <${finding.tag}> whose words sit only in a block that can render none`);
          console.error(
            `    → put words in every branch and close the block with an @else, an @empty, or an @default ` +
              `(an exhaustive @default never; closes an @switch), keep words outside it, or ` +
              (toggle ? `bind the [aria-label] input\n` : `name it with an aria-label, as the filter toggle does\n`)
          );
        } else if (toggle) {
          console.error(`  ${finding.site}  <${finding.tag}> with no text and no aria-label or aria-labelledby`);
          console.error(`    → project its label as text, or bind the [aria-label] input, as the review card's row checkbox does\n`);
        } else {
          console.error(`  ${finding.site}  <${finding.tag}> with no words and no aria-label or aria-labelledby`);
          console.error(`    → name it with an aria-label that says what it does, or give it words\n`);
        }
      }
      console.error(
        `A button, a link and an element with a control's role take their name from\n` +
          `what they hold when no aria-label or aria-labelledby names them, and what\n` +
          `they hold counts only where it renders in every state: words inside an @if\n` +
          `with no @else are gone while the condition is false, and so is the name.\n` +
          `The transaction filter toggle had that shape, its only words a badge's\n` +
          `count inside an @if, and no name with no filter set. mat-checkbox,\n` +
          `mat-slide-toggle and mat-radio-button render the control a screen reader\n` +
          `lands on inside themselves, and name it from the text projected into their\n` +
          `own label, held to the same reading, or from their aria-label and\n` +
          `aria-labelledby inputs. With neither, it is announced as a checkbox or a\n` +
          `switch and nothing more. [attr.aria-label] does not reach it: it is\n` +
          `written on the host, and the control inside stays unnamed. mat-slider has\n` +
          `no such input and forwards nothing to its thumbs, so a slider's name goes\n` +
          `on each thumb. A site that cannot be fixed in the same change is frozen\n` +
          `in UNNAMED_FROZEN with its reason (ADR 0145).\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (unnamedDriftFindings.length > 0) {
      console.error(`\n${unnamedDriftFindings.length} frozen unnamed-control row(s) no longer match their count:\n`);
      for (const finding of unnamedDriftFindings) {
        console.error(`  ${finding.file}  <${finding.key}>  frozen ${finding.count}, found ${finding.sites.length}`);
        for (const site of finding.sites) console.error(`    at ${site}`);
        console.error(
          finding.sites.length > finding.count
            ? `    → name the new control instead of freezing it\n`
            : `    → lower the row's count to what is left, or drop the row if nothing is\n`
        );
      }
      console.error(
        `UNNAMED_FROZEN counts the frozen controls per file and tag. A tally above\n` +
          `the count is a new unnamed control beside a frozen one; a tally below it\n` +
          `is a fixed debt still on the books, and the list is edited in the same\n` +
          `commit as the template. An edit that only moves a frozen control changes\n` +
          `nothing.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    if (groupFindings.length > 0) {
      console.error(`\n${groupFindings.length} single-choice group(s) carry no name:\n`);
      for (const finding of groupFindings) {
        console.error(`  ${finding.site}  <${finding.tag}> with no aria-label or aria-labelledby`);
        console.error(`    → ${groupHint()}\n`);
      }
      console.error(
        `A toggle group that is not multiple and a radio group render\n` +
          `role="radiogroup" on their own host, and a screen reader entering one\n` +
          `says the group's name before its first choice. With none, it hears the\n` +
          `first choice and its place among the others, and nothing that says what\n` +
          `is being chosen. axe reads no radiogroup's name, so no spec fails for it.\n` +
          `Name the group on its host, in any spelling: the role is there.\n` +
          `Reference: ${DOC}.\n`
      );
    }

    process.exit(1);
  }

  console.log(
    `Every named mat-icon carries a literal aria-hidden, every progress indicator ` +
      `carries a name or is hidden inside the control that already announces it, ` +
      `every option icon sits beside its option's name, every repeated menu ` +
      `button names its item, every tooltip icon takes focus, every control ` +
      `stamped once per item names its item, by its aria-label or by its own ` +
      `text, or is frozen by name, no two controls of one template that can ` +
      `show together share a bare key as their aria-label, every id ` +
      `a literal reference names is declared in its own template, and every ` +
      `button, link, control by role, checkbox, slide toggle and radio button ` +
      `is named in every state of its blocks, and every slider on each of its ` +
      `thumbs, or is frozen by name, and every single-choice group carries a name.`
  );
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }
  const lines = (source) => scan(source).map((hit) => hit.line);

  // --- must hit ---
  check(
    'role=img with a bound label and no literal aria-hidden',
    lines('<mat-icon role="img" [attr.aria-label]="tip()">error_outline</mat-icon>'),
    [1]
  );
  check(
    'the real shape, spread over several lines',
    lines(
      '<mat-icon\n  matIconSuffix\n  class="verify-flag"\n  [matTooltip]="tip()"\n' +
        '  role="img"\n  [attr.aria-label]="tip()"\n>error_outline</mat-icon>'
    ),
    [1]
  );
  check('a literal aria-label alone', lines('<mat-icon aria-label="Close">close</mat-icon>'), [1]);
  check('a property-bound aria-label alone', lines('<mat-icon [aria-label]="x">a</mat-icon>'), [1]);
  check(
    'a bound aria-hidden does not count as literal',
    lines('<mat-icon role="img" [attr.aria-hidden]="false" [attr.aria-label]="x">a</mat-icon>'),
    [1]
  );
  check(
    'two in one file report both lines',
    lines('<mat-icon role="img" [attr.aria-label]="a">x</mat-icon>\n<div></div>\n<mat-icon aria-label="b">y</mat-icon>'),
    [1, 3]
  );

  // --- must not hit: the load-bearing half ---
  check(
    'the correct spelling, already shipping',
    lines('<mat-icon class="split-indicator" role="img" aria-hidden="false" [attr.aria-label]="k | translate">call_split</mat-icon>'),
    []
  );
  check(
    'deliberately silent inside an already-labelled control',
    lines('<mat-icon class="verify-flag" [matTooltip]="t()" aria-hidden="true">error_outline</mat-icon>'),
    []
  );
  check('a plain decorative icon with no name', lines('<mat-icon>close</mat-icon>'), []);
  check('a decorative icon that is explicitly hidden', lines('<mat-icon aria-hidden="true">check</mat-icon>'), []);
  check(
    'a span with role=img is not a mat-icon',
    lines('<span class="confidence-dot" role="img" [attr.aria-label]="label()"></span>'),
    []
  );
  check(
    'a labelled button wrapping an unnamed icon',
    lines('<button [attr.aria-label]="label()"><mat-icon aria-hidden="true">close</mat-icon></button>'),
    []
  );
  check('aria-labelledby is not an aria-label', lines('<mat-icon aria-labelledby="x" aria-hidden="true">a</mat-icon>'), []);

  // --- comments ---
  check(
    'a commented-out icon is not an icon (html comment)',
    lines('<!-- <mat-icon role="img" [attr.aria-label]="x">a</mat-icon> -->'),
    []
  );
  check(
    'a line comment in an inline template is masked',
    lines('// <mat-icon role="img" [attr.aria-label]="x">a</mat-icon>\n<mat-icon aria-label="b">y</mat-icon>'),
    [2]
  );

  // --- reporting ---
  check(
    'the reported attributes are collapsed to one line',
    scan('<mat-icon\n  role="img"\n  [attr.aria-label]="x"\n>a</mat-icon>').map((hit) => hit.attrs),
    ['role="img" [attr.aria-label]="x"']
  );

  // --- the progress rule: must hit ---
  const progressLines = (source) => scanProgress(source).map((hit) => hit.line);

  check('a bare mat-progress-bar hits', progressLines('<mat-progress-bar mode="determinate"></mat-progress-bar>'), [1]);
  check('a bare mat-spinner hits', progressLines('<mat-spinner diameter="20"></mat-spinner>'), [1]);
  check('a bare mat-progress-spinner hits', progressLines('<mat-progress-spinner diameter="20"></mat-progress-spinner>'), [1]);
  check(
    'a bound [attr.aria-hidden] does not count as literal, so it still hits',
    progressLines('<mat-spinner [attr.aria-hidden]="true"></mat-spinner>'),
    [1]
  );
  check(
    'aria-hidden="false" does not hide it from the tree, so it still hits',
    progressLines('<mat-progress-bar aria-hidden="false"></mat-progress-bar>'),
    [1]
  );

  // --- the progress rule: must not hit (the load-bearing half) ---
  check('a literal aria-label names it', progressLines('<mat-spinner aria-label="Loading"></mat-spinner>'), []);
  check(
    'a bound [attr.aria-label] names it',
    progressLines('<mat-progress-bar [attr.aria-label]="label() | translate"></mat-progress-bar>'),
    []
  );
  check('aria-labelledby names it', progressLines('<mat-progress-bar aria-labelledby="x"></mat-progress-bar>'), []);
  check(
    'a literal aria-hidden="true" hides it inside a control that already announces the state',
    progressLines('<mat-spinner aria-hidden="true"></mat-spinner>'),
    []
  );

  // --- the progress rule: comments ---
  check(
    'a commented-out progress bar is not a progress bar (html comment)',
    progressLines('<!-- <mat-progress-bar></mat-progress-bar> -->'),
    []
  );
  check(
    'a line comment in an inline template is masked, the next tag still checked',
    progressLines('// <mat-spinner></mat-spinner>\n<mat-progress-bar></mat-progress-bar>'),
    [2]
  );

  // --- the progress rule: reporting ---
  check(
    'the reported attributes are collapsed to one line',
    scanProgress('<mat-progress-bar\n  mode="determinate"\n  [value]="v"\n></mat-progress-bar>').map(
      (hit) => hit.attrs
    ),
    ['mode="determinate" [value]="v"']
  );

  // --- the option rule: must hit ---
  const optionLines = (source) => scanOptionIcons(source).map((hit) => hit.line);

  check(
    'an icon in a div beside the name, the shape four selects had',
    optionLines(
      '<mat-option [value]="cat.id">\n  <div class="category-option">\n' +
        '    <mat-icon [style.color]="cat.color">{{ cat.icon }}</mat-icon>\n' +
        '    <span>{{ cat.name | translate }}</span>\n  </div>\n</mat-option>'
    ),
    [3]
  );
  check(
    'an icon in a span whose binding holds a >',
    optionLines('<mat-option><span [class.wide]="a > b"><mat-icon>x</mat-icon></span></mat-option>'),
    [1]
  );
  check(
    'an icon two wrappers deep',
    optionLines('<mat-option><div><span><mat-icon>x</mat-icon></span></div></mat-option>'),
    [1]
  );
  check(
    'an ng-container is a wrapper too',
    optionLines('<mat-option><ng-container><mat-icon>x</mat-icon></ng-container></mat-option>'),
    [1]
  );
  check(
    'a wrapped icon after a direct one in the same option',
    optionLines('<mat-option><mat-icon>a</mat-icon>\n<span><mat-icon>b</mat-icon></span></mat-option>'),
    [2]
  );
  check(
    'the wrapper is named in the report',
    scanOptionIcons('<mat-option><span class="x"><mat-icon>a</mat-icon></span></mat-option>').map(
      (hit) => hit.wrapper
    ),
    ['span']
  );

  // --- the option rule: must not hit (the load-bearing half) ---
  check(
    'an icon that is the option\'s direct child',
    optionLines(
      '<mat-option [value]="category.id">\n  <mat-icon [style.color]="category.color">{{ category.icon }}</mat-icon>\n' +
        '  {{ category.name | translate }}\n</mat-option>'
    ),
    []
  );
  check(
    'an icon whose only parent is a control-flow block',
    optionLines(
      '<mat-option [value]="p.value">\n  {{ p.label }}\n  @if (ok(p)) {\n' +
        '    <mat-icon class="option-status">check_circle</mat-icon>\n  }\n</mat-option>'
    ),
    []
  );
  check(
    'a void or self-closing element before the icon does not wrap it',
    optionLines('<mat-option><img src="a.png"><br><app-flag /><mat-icon>x</mat-icon></mat-option>'),
    []
  );
  check(
    'a wrapped icon in a select trigger is not in an option',
    optionLines(
      '<mat-select-trigger><div class="category-option"><mat-icon>x</mat-icon></div></mat-select-trigger>\n' +
        '<mat-option><mat-icon>x</mat-icon>Food</mat-option>'
    ),
    []
  );
  check(
    'a wrapped icon after the option has closed',
    optionLines('<mat-option>Food</mat-option>\n<button><span><mat-icon>close</mat-icon></span></button>'),
    []
  );
  check(
    'a commented-out wrapped option is not an option',
    optionLines('<!-- <mat-option><div><mat-icon>x</mat-icon></div></mat-option> -->'),
    []
  );

  // --- the menu rule: must hit ---
  const menuLines = (source, componentRepeated = false) =>
    scanMenuTriggers(source, componentRepeated).map((hit) => hit.line);
  const BARE =
    '<button mat-icon-button [matMenuTriggerFor]="menu" [attr.aria-label]="\'common.moreActions\' | translate">';

  check(
    'a bare trigger in an @for, the category manager\'s shape',
    menuLines(`@for (category of list; track category.id) {\n  <div>\n    ${BARE}</button>\n  </div>\n}`),
    [3]
  );
  check(
    'a bare trigger in a table cell stamped by *matCellDef, the desktop table\'s shape',
    menuLines(`<td mat-cell *matCellDef="let row">\n  ${BARE}</button>\n</td>`),
    [2]
  );
  check(
    'a bare trigger under an *ngFor element',
    menuLines(`<li *ngFor="let item of items">\n  <span>${BARE}</span>\n</li>`),
    [2]
  );
  check(
    'a bare trigger in an @if inside an @for',
    menuLines(`@for (r of rows(); track r.id) {\n  @if (r.ok) {\n    ${BARE}</button>\n  }\n}`),
    [3]
  );
  check(
    'a bare trigger anywhere in a component another template repeats',
    menuLines(`<mat-card>\n  ${BARE}</button>\n</mat-card>`, true),
    [2]
  );
  check(
    'the item-less key with parameters still names no item',
    menuLines(
      `@for (b of list; track b.id) {\n  <button [matMenuTriggerFor]="m" [attr.aria-label]="'common.moreActions' | translate: { description: b.name }">x</button>\n}`
    ),
    [2]
  );
  check(
    'the literal interpolated form',
    menuLines(`@for (b of list; track b.id) {\n  <button [matMenuTriggerFor]="m" aria-label="{{ 'common.moreActions' | translate }}">x</button>\n}`),
    [2]
  );
  check(
    'an interpolation in an @for header row does not hide the block',
    menuLines(`@for (b of list; track b.id) {\n  <span>{{ b.name }}</span>\n  ${BARE}</button>\n}`),
    [3]
  );

  // --- the menu rule: must not hit (the load-bearing half) ---
  check(
    'a repeated trigger that names its item',
    menuLines(
      `@for (t of rows; track t.id) {\n  <button [matMenuTriggerFor]="m" [attr.aria-label]="'common.moreActionsFor' | translate: { description: t.description }">x</button>\n}`
    ),
    []
  );
  check('a bare trigger rendered once, a page\'s own menu', menuLines(`<div class="toolbar">\n  ${BARE}</button>\n</div>`), []);
  check(
    'a bare trigger after its @for has closed',
    menuLines(`@for (c of list; track c.id) {\n  <span>{{ c }}</span>\n}\n${BARE}</button>`),
    []
  );
  check(
    'a bare trigger in the @empty branch, which renders once',
    menuLines(`@for (c of list; track c.id) {\n  <span>{{ c }}</span>\n} @empty {\n  ${BARE}</button>\n}`),
    []
  );
  check(
    'a bare trigger in a header cell, which renders once',
    menuLines(`<th mat-header-cell *matHeaderCellDef>\n  ${BARE}</button>\n</th>`),
    []
  );
  check(
    'a bare trigger after the repeated element has closed',
    menuLines(`<td mat-cell *matCellDef="let row">x</td>\n${BARE}</button>`),
    []
  );
  check(
    'a repeated button that opens no menu',
    menuLines(`@for (c of list; track c.id) {\n  <button [attr.aria-label]="'common.moreActions' | translate">x</button>\n}`),
    []
  );
  check(
    'a repeated trigger named by its text, with no aria-label',
    menuLines(`@for (c of list; track c.id) {\n  <button mat-button [matMenuTriggerFor]="m">{{ 'import.viewTransactions' | translate }}</button>\n}`),
    []
  );
  check(
    'the menu\'s own @for over its items is not around its trigger',
    menuLines(`${BARE}</button>\n<mat-menu #menu="matMenu">\n  @for (g of goals; track g.id) {\n    <button mat-menu-item>{{ g.name }}</button>\n  }\n</mat-menu>`),
    []
  );
  check(
    'a @let declaration opens no block',
    menuLines(`@let total = sum();\n${BARE}</button>`),
    []
  );
  check(
    'an exhaustive @default never; opens no block, so the @for around it closes at its own brace',
    menuLines(
      "@for (row of rows(); track row.id) {\n  @switch (row.kind) {\n    @case ('a') {\n      <span>a</span>\n    }\n" +
        `    @default never;\n  }\n  ${BARE}</button>\n}\n${BARE}</button>`
    ),
    [8]
  );
  check(
    'a commented-out repeated trigger is not a trigger',
    menuLines(`<!-- @for (c of list; track c.id) { ${BARE}</button> } -->`),
    []
  );

  // --- the menu rule: which components are repeated ---
  const repeatedKeys = (templates, options) =>
    [...repeatedTemplates(templates.map(([key, selector, source]) => ({ key, selector, source })), options)].sort();

  check(
    'a card stamped in its parent\'s @for is repeated, the budget card\'s shape',
    repeatedKeys([
      ['overview', 'app-overview', '@for (b of budgets(); track b.id) {\n  <app-card [budget]="b" />\n}'],
      ['card', 'app-card', `<mat-card>${BARE}</button></mat-card>`],
    ]),
    ['card']
  );
  check(
    'a component used once inside a repeated one is repeated too',
    repeatedKeys([
      ['list', 'app-list', '@for (r of rows; track r.id) {\n  <app-row [r]="r"></app-row>\n}'],
      ['row', 'app-row', '<div><app-row-menu /></div>'],
      ['menu', 'app-row-menu', BARE + '</button>'],
    ]),
    ['menu', 'row']
  );
  check(
    'a component rendered once is not repeated',
    repeatedKeys([
      ['page', 'app-page', '<header><app-toolbar /></header>\n@for (r of rows; track r.id) {\n  <span>{{ r }}</span>\n}'],
      ['toolbar', 'app-toolbar', BARE + '</button>'],
    ]),
    []
  );
  check(
    'a template with no selector is never repeated by name',
    repeatedKeys([
      ['page', 'app-page', '@for (r of rows; track r.id) {\n  <app-ghost />\n}'],
      ['orphan', null, BARE + '</button>'],
    ]),
    []
  );

  // --- the tooltip rule: must hit ---
  const tooltipLines = (source) => scanTooltipIcons(source).map((hit) => hit.line);
  const FLAG =
    '<mat-icon class="verify-flag" [matTooltip]="tip()" matTooltipPosition="above" role="img" aria-hidden="false" [attr.aria-label]="tip()">error_outline</mat-icon>';

  check('a named, un-hidden icon with a tooltip and no tabindex, the form\'s amount flag', tooltipLines(FLAG), [1]);
  check(
    'the form\'s amount flag in its field, spread over several lines',
    tooltipLines(
      '<mat-form-field>\n  @if (doubted) {\n    <mat-icon\n      matIconSuffix\n      class="verify-flag"\n' +
        '      [matTooltip]="tip()"\n      matTooltipPosition="above"\n      role="img"\n' +
        '      aria-hidden="false"\n      [attr.aria-label]="tip()"\n    >error_outline</mat-icon>\n  }\n</mat-form-field>'
    ),
    [3]
  );
  check(
    'a literal matTooltip and a literal aria-label',
    tooltipLines('<mat-icon matTooltip="Check" aria-hidden="false" aria-label="Check">error_outline</mat-icon>'),
    [1]
  );
  check(
    'a bound tabindex is not literal',
    tooltipLines(FLAG.replace('<mat-icon ', '<mat-icon [tabindex]="0" ')),
    [1]
  );
  check(
    'an attribute-bound tabindex is not literal either',
    tooltipLines(FLAG.replace('<mat-icon ', '<mat-icon [attr.tabindex]="0" ')),
    [1]
  );
  check(
    'an icon after an ng-template has closed is outside it',
    tooltipLines('<ng-template #seal>\n  <span></span>\n</ng-template>\n' + FLAG),
    [4]
  );
  check(
    'an icon beside an ng-template is outside it',
    tooltipLines('<ng-template #seal></ng-template><div>' + FLAG + '</div>'),
    [1]
  );
  check(
    'a flag that takes focus does not excuse the next one',
    tooltipLines(FLAG.replace('<mat-icon ', '<mat-icon tabindex="0" ') + '\n' + FLAG),
    [2]
  );
  check(
    'the tooltip rule reports its attributes collapsed to one line',
    scanTooltipIcons('<mat-icon\n  [matTooltip]="t()"\n  aria-label="x"\n  aria-hidden="false"\n>a</mat-icon>').map(
      (hit) => hit.attrs
    ),
    ['[matTooltip]="t()" aria-label="x" aria-hidden="false"']
  );

  // --- the tooltip rule: must not hit (the load-bearing half) ---
  check('a literal tabindex="0"', tooltipLines(FLAG.replace('<mat-icon ', '<mat-icon tabindex="0" ')), []);
  check(
    'the wizard\'s seal icon, stamped through an ng-template into a tab header',
    tooltipLines(
      '<mat-stepper>\n  <ng-template #sealIcon>\n    <mat-icon\n      class="seal-icon"\n      aria-hidden="false"\n' +
        '      role="img"\n      [attr.aria-label]="\'import.stepSealed\' | translate"\n' +
        '      [matTooltip]="\'import.stepSealed\' | translate"\n    >lock</mat-icon>\n  </ng-template>\n</mat-stepper>'
    ),
    []
  );
  check(
    'an icon several elements and a block deep inside an ng-template',
    tooltipLines('<ng-template #seal>\n  <div>\n    @if (sealed) {\n      ' + FLAG + '\n    }\n  </div>\n</ng-template>'),
    []
  );
  check(
    'a flag deliberately silent inside a control that names itself, the form\'s type flag',
    tooltipLines('<mat-icon class="verify-flag" [matTooltip]="tip()" matTooltipPosition="above" aria-hidden="true">error_outline</mat-icon>'),
    []
  );
  check(
    'a named tooltip icon with no literal aria-hidden is the first rule\'s, and is reported there once',
    [
      tooltipLines('<mat-icon role="img" [matTooltip]="t()" [attr.aria-label]="t()">a</mat-icon>'),
      lines('<mat-icon role="img" [matTooltip]="t()" [attr.aria-label]="t()">a</mat-icon>'),
    ],
    [[], [1]]
  );
  check(
    'a named icon with no tooltip, the split indicator',
    tooltipLines('<mat-icon class="split-indicator" role="img" aria-hidden="false" [attr.aria-label]="k | translate">call_split</mat-icon>'),
    []
  );
  check(
    'an unnamed icon with a tooltip',
    tooltipLines('<mat-icon [matTooltip]="t()" aria-hidden="false">info</mat-icon>'),
    []
  );
  check(
    'a tooltip option alone is not a tooltip',
    tooltipLines('<mat-icon matTooltipPosition="above" [matTooltipDisabled]="off" role="img" aria-hidden="false" aria-label="x">a</mat-icon>'),
    []
  );
  check(
    'an element that is not a mat-icon',
    tooltipLines('<span [matTooltip]="t()" role="img" aria-hidden="false" [attr.aria-label]="t()"></span>'),
    []
  );
  check('a commented-out flag is not a flag', tooltipLines('<!-- ' + FLAG + ' -->'), []);

  // --- the per-item rule: must hit ---
  const itemlessLines = (source, componentRepeated = false) =>
    scanItemlessLabels(source, componentRepeated).map((hit) => hit.line);
  const REMOVE = '<button mat-icon-button [attr.aria-label]="\'common.remove\' | translate">x</button>';

  check(
    'a bare key on a button in an @for, the upload area\'s remove button',
    itemlessLines(`@for (file of files(); track file) {\n  <div class="file-item">\n    ${REMOVE}\n  </div>\n}`),
    [3]
  );
  check(
    'the line reported is the label\'s, the tag spread over several lines',
    scanItemlessLabels(
      '@for (file of files(); track file; let i = $index) {\n  <button\n    mat-icon-button\n' +
        '    (click)="moveFileUp(i, $event)"\n    [attr.aria-label]="\'common.moveUp\' | translate"\n  >x</button>\n}'
    ),
    [{ line: 5, tag: 'button', key: 'common.moveUp', via: 'label' }]
  );
  check(
    'the interpolated literal form',
    itemlessLines(`@for (s of searches; track s.id) {\n  <button aria-label="{{ 'common.remove' | translate }}">x</button>\n}`),
    [2]
  );
  check(
    'a form field in a repeated row',
    itemlessLines(`@for (row of rows; track row.id) {\n  <input matInput [attr.aria-label]="'common.amount' | translate">\n}`),
    [2]
  );
  check(
    'an element with a control\'s role',
    itemlessLines(`@for (c of chips; track c) {\n  <span role="button" tabindex="0" [attr.aria-label]="'common.remove' | translate"></span>\n}`),
    [2]
  );
  check(
    'a table cell stamped by *matCellDef',
    itemlessLines(`<td mat-cell *matCellDef="let t">\n  @if (t.note) {\n    <button [attr.aria-label]="'transactions.viewNote' | translate">x</button>\n  }\n</td>`),
    [3]
  );
  check(
    'a menu trigger named by another bare key, which the fourth rule does not read',
    itemlessLines(`@for (b of list; track b.id) {\n  <button [matMenuTriggerFor]="m" [attr.aria-label]="'common.options' | translate">x</button>\n}`),
    [2]
  );
  check(
    'a ternary between two bare keys piped once, the search history\'s pin button',
    scanItemlessLabels(
      '@for (record of history.answers(); track record.id) {\n  <button\n    mat-icon-button\n' +
        '    [attr.aria-pressed]="!!record.pinned"\n    [attr.aria-label]="\n' +
        '      (record.pinned ? \'aiSearch.historyUnpin\' : \'aiSearch.historyPin\') | translate\n    "\n' +
        '    (click)="togglePin(record)"\n  >x</button>\n}'
    ),
    [{ line: 5, tag: 'button', key: 'aiSearch.historyUnpin : aiSearch.historyPin', via: 'label' }]
  );
  check(
    'a ternary between two bare keys, each branch piped',
    itemlessLines(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="r.on ? ('a.turnOff' | translate) : ('a.turnOn' | translate)">x</button>\n}`),
    [2]
  );
  check(
    'a ternary between two bare keys in the interpolated literal form',
    itemlessLines(`@for (r of rows; track r.id) {\n  <button aria-label="{{ (r.on ? 'a.turnOff' : 'a.turnOn') | translate }}">x</button>\n}`),
    [2]
  );
  check(
    'a ternary whose condition reads ?. and ?? is still a ternary',
    itemlessLines(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="((r?.on ?? false) ? 'a.turnOff' : 'a.turnOn') | translate">x</button>\n}`),
    [2]
  );
  check(
    'a ternary between two bare keys, the first branch piped in parentheses and the last bare',
    [
      scanItemlessLabels(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="r.on ? ('a.turnOff' | translate) : 'a.turnOn' | translate">x</button>\n}`),
      itemlessLines(`@for (r of rows; track r.id) {\n  <button aria-label="{{ r.on ? ('a.turnOff' | translate) : 'a.turnOn' | translate }}">x</button>\n}`),
    ],
    [[{ line: 2, tag: 'button', key: 'a.turnOff : a.turnOn', via: 'label' }], [2]]
  );

  // --- the per-item rule: must not hit (the load-bearing half) ---
  check(
    'a parameterised key names its item, the upload area\'s photo arrows',
    itemlessLines(`@for (file of files(); track file) {\n  <button [attr.aria-label]="${ITEMLESS_MODEL}">x</button>\n}`),
    []
  );
  check(
    'a key computed from the item names it through the key',
    itemlessLines(`@for (icon of icons; track icon) {\n  <button [attr.aria-label]="iconNameKeys[icon] | translate">x</button>\n}`),
    []
  );
  check(
    'a ternary with parameters on either branch has a slot for the item',
    [
      itemlessLines(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="r.on ? ('a.turnOff' | translate: { name: r.name }) : ('a.turnOn' | translate)">x</button>\n}`),
      itemlessLines(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="r.on ? ('a.turnOff' | translate) : ('a.turnOn' | translate: { name: r.name })">x</button>\n}`),
    ],
    [[], []]
  );
  check(
    'a ternary whose bare last branch takes parameters has a slot for the item',
    itemlessLines(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="r.on ? ('a.turnOff' | translate) : 'a.turnOn' | translate: { name: r.name }">x</button>\n}`),
    []
  );
  check(
    'a ternary piped once with parameters has a slot for the item',
    itemlessLines(`@for (r of rows; track r.id) {\n  <button [attr.aria-label]="(r.on ? 'a.turnOff' : 'a.turnOn') | translate: { name: r.name }">x</button>\n}`),
    []
  );
  check(
    'the pin button fixed, one key whose parameters name the answer',
    itemlessLines(
      '@for (record of history.answers(); track record.id) {\n  <button\n    mat-icon-button\n' +
        '    [attr.aria-pressed]="!!record.pinned"\n' +
        '    [attr.aria-label]="\'aiSearch.historyPinLabel\' | translate: { query: record.query, date: recordDateLabel(record) }"\n' +
        '  >x</button>\n}'
    ),
    []
  );
  check('a bare key outside any repeat, a page\'s own button', itemlessLines(`<div class="toolbar">\n  ${REMOVE}\n</div>`), []);
  check(
    'a bare key after its @for has closed',
    itemlessLines(`@for (f of files; track f) {\n  <span>{{ f.name }}</span>\n}\n${REMOVE}`),
    []
  );
  check(
    'a bare key in the @empty branch, which renders once',
    itemlessLines(`@for (f of files; track f) {\n  <span>{{ f.name }}</span>\n} @empty {\n  ${REMOVE}\n}`),
    []
  );
  check(
    'a repeated status that is not a control, the split indicator',
    itemlessLines(
      `@for (t of rows; track t.id) {\n  <mat-icon role="img" aria-hidden="false" [attr.aria-label]="'transactions.splitPart' | translate">call_split</mat-icon>\n}`
    ),
    []
  );
  check(
    'a repeated spinner is a status too',
    itemlessLines(`@for (g of groups; track g.id) {\n  <mat-spinner diameter="16" [attr.aria-label]="'receipts.loading' | translate"></mat-spinner>\n}`),
    []
  );
  check(
    'a literal label holding pipe text is literal text, not a key',
    itemlessLines(`@for (f of files; track f) {\n  <button aria-label="'common.remove' | translate">x</button>\n}`),
    []
  );
  check(
    'a repeated "More actions" trigger is the fourth rule\'s, and is reported there once',
    [
      itemlessLines(`@for (c of list; track c.id) {\n  ${BARE}</button>\n}`),
      menuLines(`@for (c of list; track c.id) {\n  ${BARE}</button>\n}`),
    ],
    [[], [2]]
  );
  check(
    'a commented-out repeated button is not a button',
    itemlessLines(`<!-- @for (f of files; track f) { ${REMOVE} } -->`),
    []
  );

  // --- the per-item rule: the fix hint ---
  const DROPZONE = join(SOURCE_DIR, 'features/ai/import/file-dropzone/file-dropzone.component.html');
  check(
    'the fix hint\'s model is a binding the upload area carries; if it left the upload area, update ITEMLESS_MODEL',
    existsSync(DROPZONE) && readFileSync(DROPZONE, 'utf8').includes(`[attr.aria-label]="${ITEMLESS_MODEL}"`),
    true
  );
  check('the fix hint quotes its model', itemlessHint().includes(ITEMLESS_MODEL), true);

  // --- the per-item rule: the frozen list ---
  const row = { file: 'src/app/x.component.html', key: 'common.remove', count: 1, why: 'a fixture row' };
  const hitAt = (site, key = 'common.remove') => ({ site, tag: 'button', key });
  const driftOf = (sites, frozen = row) => ({ file: frozen.file, key: frozen.key, count: frozen.count, sites });

  check(
    'a hit no row names fails',
    againstFrozen([hitAt('src/app/y.component.html:7')], []),
    { fresh: [hitAt('src/app/y.component.html:7')], drift: [] }
  );
  check('a frozen control passes', againstFrozen([hitAt('src/app/x.component.html:3')], [row]), { fresh: [], drift: [] });
  check(
    'a frozen control that an edit above it moved still passes',
    againstFrozen([hitAt('src/app/x.component.html:41')], [row]),
    { fresh: [], drift: [] }
  );
  check(
    'a frozen row that matches nothing any more fails',
    againstFrozen([], [row]),
    { fresh: [], drift: [driftOf([])] }
  );
  check(
    'one more control named by a frozen key in the same file fails',
    againstFrozen([hitAt('src/app/x.component.html:3'), hitAt('src/app/x.component.html:9')], [row]),
    { fresh: [], drift: [driftOf(['src/app/x.component.html:3', 'src/app/x.component.html:9'])] }
  );
  check(
    'a frozen key in another file is not frozen there',
    againstFrozen([hitAt('src/app/x.component.html:3'), hitAt('src/app/y.component.html:3')], [row]),
    { fresh: [hitAt('src/app/y.component.html:3')], drift: [] }
  );
  check(
    'a frozen control whose key changed is not the frozen one',
    againstFrozen([hitAt('src/app/x.component.html:3', 'common.delete')], [row]),
    { fresh: [hitAt('src/app/x.component.html:3', 'common.delete')], drift: [driftOf([])] }
  );
  check(
    'a row frozen at two controls passes at two and fails at one',
    [
      againstFrozen([hitAt('src/app/x.component.html:3'), hitAt('src/app/x.component.html:9')], [{ ...row, count: 2 }]),
      againstFrozen([hitAt('src/app/x.component.html:9')], [{ ...row, count: 2 }]),
    ],
    [
      { fresh: [], drift: [] },
      { fresh: [], drift: [driftOf(['src/app/x.component.html:9'], { ...row, count: 2 })] },
    ]
  );
  check(
    'every frozen row names its file, its key, a count and why it repeats',
    ITEMLESS_FROZEN.filter(
      (r) => !/^src\/app\/.+\.(html|ts)$/.test(r.file) || !r.key || !(Number.isInteger(r.count) && r.count > 0) || !r.why
    ),
    []
  );
  check(
    'no file and key is frozen twice',
    ITEMLESS_FROZEN.map((r) => `${r.file} ${r.key}`).filter((pair, i, pairs) => pairs.indexOf(pair) !== i),
    []
  );

  // --- the id rule: must hit ---
  const danglingIds = (source) => scanDanglingIds(source).map((hit) => `${hit.line} ${hit.attr} ${hit.id}`);
  const QUESTION = '<span class="image-kind-label">{{ \'import.imageKindQuestion\' | translate }}</span>';

  check(
    'aria-labelledby naming a class and not an id, the wizard\'s receipt-or-statement chips',
    scanDanglingIds(
      `<div class="image-kind">\n  ${QUESTION}\n  <mat-chip-listbox\n    [value]="imageKind()"\n` +
        '    aria-labelledby="image-kind-label"\n  >\n  </mat-chip-listbox>\n</div>'
    ),
    [{ line: 5, tag: 'mat-chip-listbox', attr: 'aria-labelledby', id: 'image-kind-label' }]
  );
  check(
    'aria-describedby naming nothing',
    danglingIds('<mat-slide-toggle aria-describedby="lock-hint"></mat-slide-toggle>'),
    ['1 aria-describedby lock-hint']
  );
  check(
    'aria-controls naming nothing',
    danglingIds('<button aria-controls="filters-panel">x</button>'),
    ['1 aria-controls filters-panel']
  );
  check(
    'aria-owns naming nothing',
    danglingIds('<div role="combobox" aria-owns="results"></div>'),
    ['1 aria-owns results']
  );
  check('a label\'s for naming nothing', danglingIds('<label for="amount">x</label>\n<input name="amount">'), ['1 for amount']);
  check(
    'one dangling id in a list of two, and only that one',
    danglingIds('<span id="hint">a</span>\n<input aria-describedby="hint error">'),
    ['2 aria-describedby error']
  );
  check(
    'an id declared only inside a comment does not count',
    danglingIds('<!-- <span id="theme-label">x</span> -->\n<mat-button-toggle-group aria-labelledby="theme-label">'),
    ['2 aria-labelledby theme-label']
  );
  check(
    'a bound or interpolated id declares nothing',
    danglingIds('<span [id]="\'q\'">a</span>\n<span id="{{ \'r\' }}">b</span>\n<div aria-labelledby="q r"></div>'),
    ['3 aria-labelledby q', '3 aria-labelledby r']
  );
  check(
    'an id another template declares is not declared in this one',
    [
      danglingIds('<app-question></app-question>\n<mat-radio-group aria-labelledby="format-label">'),
      danglingIds('<span id="format-label">x</span>'),
    ],
    [['2 aria-labelledby format-label'], []]
  );
  const inlineComponent =
    "import { Component } from '@angular/core';\n\n@Component({\n  selector: 'app-question',\n" +
    '  template: `\n    <p class="question">x</p>\n    <ul aria-labelledby="question"></ul>\n  `,\n})\n' +
    'export class QuestionComponent {}\n';
  const inline = inlineTemplateOf(inlineComponent);
  check(
    'an inline template in a .ts file, reported at the file\'s line',
    scanDanglingIds(inline.source).map((hit) => hit.line + inline.offset),
    [7]
  );

  // --- the id rule: must not hit (the load-bearing half) ---
  check(
    'the fixed wizard, the question carrying its id beside its class',
    danglingIds(
      '<span class="image-kind-label" id="image-kind-label">x</span>\n' +
        '<mat-chip-listbox aria-labelledby="image-kind-label"></mat-chip-listbox>'
    ),
    []
  );
  check(
    'an id declared before the reference',
    danglingIds('<span id="theme-label">x</span>\n<mat-button-toggle-group aria-labelledby="theme-label">'),
    []
  );
  check(
    'an id declared after the reference',
    danglingIds('<ul aria-labelledby="history-label">\n</ul>\n<h3 id="history-label">x</h3>'),
    []
  );
  check(
    'every attribute and both ids of a list, all declared',
    danglingIds(
      '<span id="a">x</span><span id="b">y</span><div id="c"></div><label for="d">z</label><input id="d">\n' +
        '<div aria-labelledby="a b" aria-describedby="b" aria-controls="c" aria-owns="c"></div>'
    ),
    []
  );
  check(
    'a bound reference is not read',
    danglingIds(
      '<div [attr.aria-labelledby]="\'nowhere\'" [attr.aria-describedby]="hintId()" [aria-controls]="panel"></div>\n' +
        '<mat-datepicker-toggle matIconSuffix [for]="picker"></mat-datepicker-toggle>'
    ),
    []
  );
  check(
    'an interpolated reference is not read, the dashboard layout\'s card titles',
    danglingIds('<mat-slide-toggle aria-labelledby="dashboard-card-{{ id }}-title"></mat-slide-toggle>'),
    []
  );
  check(
    'a repeat\'s *ngFor and @for are not a for',
    danglingIds('<li *ngFor="let x of xs">a</li>\n@for (x of xs; track x) {\n  <span>{{ x }}</span>\n}'),
    []
  );
  check(
    'a word inside a bound value is not an attribute',
    danglingIds('<div [title]="\'aria-labelledby=nowhere for=nothing\'"></div>'),
    []
  );
  check(
    'an inline template whose reference is declared',
    scanDanglingIds(inlineTemplateOf(inlineComponent.replace('class="question"', 'class="question" id="question"')).source),
    []
  );
  check('a component source with no inline template has none', inlineTemplateOf("@Component({ templateUrl: './x.html' })"), null);

  // --- the toggle rule: must hit ---
  const unnamedTags = (source) => scanUnnamedControls(source).map((hit) => `${hit.line} ${hit.tag}`);

  check(
    'a bare checkbox, the review card\'s row checkbox spread over several lines',
    scanUnnamedControls(
      '<div class="card-select">\n  <mat-checkbox\n    [checked]="row.selected"\n' +
        '    (change)="toggleSelection(row, $event.checked)"\n  ></mat-checkbox>\n</div>'
    ),
    [{ line: 2, tag: 'mat-checkbox', sometimes: false }]
  );
  check(
    'a bare slide toggle beside a span it never references',
    unnamedTags(
      '<span>{{ \'aiPage.autoSync\' | translate }}</span>\n<mat-slide-toggle\n  [checked]="autoSync()"\n' +
        '  color="primary">\n</mat-slide-toggle>'
    ),
    ['2 mat-slide-toggle']
  );
  check(
    'a bare radio button',
    unnamedTags('<mat-radio-group aria-label="Format">\n  <mat-radio-button [value]="csv"></mat-radio-button>\n</mat-radio-group>'),
    ['2 mat-radio-button']
  );
  check('a self-closing toggle with no name', unnamedTags('<mat-checkbox [checked]="on" />'), ['1 mat-checkbox']);
  check(
    'an attribute-bound aria-label is written on the host, not the control',
    unnamedTags('<mat-checkbox [attr.aria-label]="label()"></mat-checkbox>'),
    ['1 mat-checkbox']
  );
  check(
    'an attribute-bound aria-labelledby is too',
    unnamedTags('<span id="t">x</span>\n<mat-slide-toggle [attr.aria-labelledby]="\'t\'"></mat-slide-toggle>'),
    ['2 mat-slide-toggle']
  );
  check(
    'a name inside another attribute\'s value names nothing',
    unnamedTags('<mat-checkbox [matTooltip]="\'aria-label=x\'"></mat-checkbox>'),
    ['1 mat-checkbox']
  );
  check(
    'a thumb whose only aria word sits inside another attribute\'s value is unnamed',
    unnamedTags('<mat-slider aria-label="Level">\n  <input matSliderThumb [matTooltip]="\'aria-label\'">\n</mat-slider>'),
    ['1 mat-slider']
  );
  check(
    'a thumb\'s name inside another attribute\'s value makes no thumb',
    unnamedTags('<mat-slider aria-label="Level">\n  <input matSliderThumb aria-label="Level">\n  <span [title]="\'matSliderThumb\'"></span>\n</mat-slider>'),
    []
  );
  check(
    'an icon alone is not text',
    unnamedTags('<mat-checkbox>\n  <mat-icon>star</mat-icon>\n</mat-checkbox>'),
    ['1 mat-checkbox']
  );
  check(
    'text in one toggle does not name the next',
    unnamedTags('<mat-checkbox>All</mat-checkbox>\n<mat-checkbox [checked]="one"></mat-checkbox>'),
    ['2 mat-checkbox']
  );
  check(
    'text inside an @if with no @else names the toggle in one state only',
    scanUnnamedControls('<mat-checkbox>\n  @if (name) {\n    <span>{{ name }}</span>\n  }\n</mat-checkbox>'),
    [{ line: 1, tag: 'mat-checkbox', sometimes: true }]
  );
  check(
    'text inside a literally hidden element names no toggle',
    unnamedTags('<mat-checkbox>\n  <span aria-hidden="true">{{ count }}</span>\n</mat-checkbox>'),
    ['1 mat-checkbox']
  );
  check(
    'a slider named on its host alone, by a literal aria-labelledby, leaves its thumb unnamed',
    unnamedTags(
      '<mat-slider min="50" max="100" step="5" aria-labelledby="threshold-label" discrete>\n' +
        '  <input matSliderThumb formControlName="alertThreshold">\n</mat-slider>'
    ),
    ['1 mat-slider']
  );
  check(
    'a range slider named on its host, one thumb named and one not',
    unnamedTags(
      '<mat-slider [attr.aria-label]="range">\n  <input matSliderStartThumb aria-label="From">\n' +
        '  <input matSliderEndThumb>\n</mat-slider>'
    ),
    ['1 mat-slider']
  );
  check(
    'a slider named on its host alone, by an interpolated aria-label, leaves its thumb unnamed',
    unnamedTags('<mat-slider aria-label="{{ \'budget.alertWhenReaches\' | translate }}">\n  <input matSliderThumb>\n</mat-slider>'),
    ['1 mat-slider']
  );
  check('a slider named nowhere', unnamedTags('<mat-slider>\n  <input matSliderThumb>\n</mat-slider>'), ['1 mat-slider']);
  check(
    'a thumb inside a block is still a thumb, in every branch, and named in each it passes',
    [
      unnamedTags(
        '<mat-slider>\n  @if (range()) {\n    <input matSliderStartThumb aria-label="From">\n' +
          '    <input matSliderEndThumb aria-label="To">\n  } @else {\n    <input matSliderThumb>\n  }\n</mat-slider>'
      ),
      unnamedTags(
        '<mat-slider>\n  @if (range()) {\n    <input matSliderStartThumb aria-label="From">\n' +
          '    <input matSliderEndThumb aria-label="To">\n  } @else {\n    <input matSliderThumb aria-label="Level">\n  }\n</mat-slider>'
      ),
    ],
    [['1 mat-slider'], []]
  );
  check(
    'a thumb\'s aria-labelledby with no value names nothing',
    unnamedTags('<mat-slider>\n  <input matSliderThumb aria-labelledby>\n</mat-slider>'),
    ['1 mat-slider']
  );
  const inlineToggle =
    "@Component({\n  selector: 'app-switch',\n  template: `\n    <p>x</p>\n    <mat-slide-toggle [checked]=\"on\" />\n  `,\n})\n";
  const inlineSwitch = inlineTemplateOf(inlineToggle);
  check(
    'an inline template in a .ts file, reported at the file\'s line',
    scanUnnamedControls(inlineSwitch.source).map((hit) => hit.line + inlineSwitch.offset),
    [5]
  );

  // --- the toggle rule: must not hit (the load-bearing half) ---
  check(
    'projected text, the review card\'s Select all',
    unnamedTags('<mat-checkbox\n  [checked]="allSelected()"\n>\n  {{ \'import.selectAll\' | translate }}\n</mat-checkbox>'),
    []
  );
  check(
    'text projected inside an element, the goal card\'s checklist item',
    unnamedTags('<mat-checkbox [checked]="item.done">\n  <span class="item-label">{{ item.name }}</span>\n</mat-checkbox>'),
    []
  );
  check('literal text', unnamedTags('<mat-radio-button value="csv">CSV</mat-radio-button>'), []);
  check(
    'an icon beside text, the review card\'s recurring link',
    unnamedTags(
      '<mat-checkbox class="recurring-link">\n  <mat-icon aria-hidden="true">autorenew</mat-icon>\n' +
        '  {{ \'import.linkRecurring\' | translate: { rule: match.name } }}\n</mat-checkbox>'
    ),
    []
  );
  check(
    'text in both branches of an @if names the toggle in both states',
    unnamedTags('<mat-checkbox>\n  @if (name) {\n    <span>{{ name }}</span>\n  } @else {\n    {{ \'common.untitled\' | translate }}\n  }\n</mat-checkbox>'),
    []
  );
  check('a literal aria-label', unnamedTags('<mat-checkbox aria-label="Choose"></mat-checkbox>'), []);
  check(
    'an interpolated aria-label',
    unnamedTags('<mat-slide-toggle aria-label="{{ \'settings.enable\' | translate }}" />'),
    []
  );
  check(
    'a bound name, the fixed row checkbox',
    unnamedTags('<mat-checkbox\n  [checked]="row.selected"\n  [aria-label]="selectLabel(row)"\n></mat-checkbox>'),
    []
  );
  check(
    'a literal aria-labelledby',
    unnamedTags('<span id="lock-label">x</span>\n<mat-slide-toggle aria-labelledby="lock-label"></mat-slide-toggle>'),
    []
  );
  check(
    'an interpolated aria-labelledby, the dashboard layout\'s switches',
    unnamedTags('<mat-slide-toggle\n  [checked]="shown"\n  aria-labelledby="dashboard-card-{{ id }}-title"\n/>'),
    []
  );
  check('a bound aria-labelledby', unnamedTags('<mat-radio-button [aria-labelledby]="labelId"></mat-radio-button>'), []);
  check(
    'a slider whose thumb carries the name',
    unnamedTags('<mat-slider>\n  <input matSliderThumb [attr.aria-label]="\'budgets.threshold\' | translate">\n</mat-slider>'),
    []
  );
  check(
    'a slider named on its host and on every thumb',
    unnamedTags(
      '<mat-slider aria-labelledby="t">\n  <input matSliderStartThumb aria-labelledby="t">\n' +
        '  <input matSliderEndThumb aria-label="To">\n</mat-slider>'
    ),
    []
  );
  check(
    'a thumb named by a literal aria-labelledby, its host named by nothing',
    unnamedTags(
      '<span id="threshold-label">x</span>\n<mat-slider discrete>\n' +
        '  <input matSliderThumb formControlName="alertThreshold" aria-labelledby="threshold-label">\n</mat-slider>'
    ),
    []
  );
  check(
    'a thumb named in each spelling that lands on it',
    ['aria-label="x"', 'aria-labelledby="t"', '[aria-label]="x"', '[aria-labelledby]="t"', '[attr.aria-label]="x"', '[attr.aria-labelledby]="t"'].map(
      (name) => unnamedTags(`<mat-slider>\n  <input matSliderThumb ${name}>\n</mat-slider>`)
    ),
    [[], [], [], [], [], []]
  );
  check('a commented-out toggle is not a toggle', unnamedTags('<!-- <mat-checkbox></mat-checkbox> -->'), []);

  // --- the toggle rule: the frozen list ---
  const switchRow = { file: 'src/app/x.component.html', key: 'mat-slide-toggle', count: 1, why: 'a fixture row' };
  const unnamedAt = (site, tag = 'mat-slide-toggle') => ({ site, tag, key: tag });
  const switchDrift = (sites) => ({ file: switchRow.file, key: switchRow.key, count: switchRow.count, sites });

  check(
    'a frozen switch passes, wherever an edit above it moved it',
    [
      againstFrozen([unnamedAt('src/app/x.component.html:12')], [switchRow]),
      againstFrozen([unnamedAt('src/app/x.component.html:40')], [switchRow]),
    ],
    [
      { fresh: [], drift: [] },
      { fresh: [], drift: [] },
    ]
  );
  check(
    'a second unnamed switch in the frozen file drifts the count',
    againstFrozen([unnamedAt('src/app/x.component.html:12'), unnamedAt('src/app/x.component.html:30')], [switchRow]),
    { fresh: [], drift: [switchDrift(['src/app/x.component.html:12', 'src/app/x.component.html:30'])] }
  );
  check(
    'a frozen switch named and its row left behind drifts the count',
    againstFrozen([], [switchRow]),
    { fresh: [], drift: [switchDrift([])] }
  );
  check(
    'a checkbox in the file whose switch is frozen is not frozen',
    againstFrozen([unnamedAt('src/app/x.component.html:12'), unnamedAt('src/app/x.component.html:20', 'mat-checkbox')], [switchRow]),
    { fresh: [unnamedAt('src/app/x.component.html:20', 'mat-checkbox')], drift: [] }
  );
  check(
    'every frozen unnamed-control row names its file, its tag, a count and why',
    UNNAMED_FROZEN.filter(
      (r) =>
        !/^src\/app\/.+\.(html|ts)$/.test(r.file) ||
        // A role makes any element a control, so the key is any lower-case tag.
        !/^[a-z][a-z0-9-]*$/.test(r.key ?? '') ||
        !(Number.isInteger(r.count) && r.count > 0) ||
        !r.why
    ),
    []
  );
  check(
    'no file and tag is frozen twice',
    UNNAMED_FROZEN.map((r) => `${r.file} ${r.key}`).filter((pair, i, pairs) => pairs.indexOf(pair) !== i),
    []
  );

  // --- the branch rule: must hit ---
  check(
    'the filter toggle\'s old shape: its only words are its badge\'s, inside an @if with no @else',
    scanUnnamedControls(
      '<button\n  class="filter-toggle"\n  [class.has-filters]="activeFilterCount() > 0"\n  (click)="expanded.set(!expanded())"\n>\n' +
        '  <mat-icon>tune</mat-icon>\n  @if (activeFilterCount() > 0) {\n' +
        '    <span class="filter-badge">{{ activeFilterCount() }}</span>\n  }\n</button>'
    ),
    [{ line: 1, tag: 'button', sometimes: true }]
  );
  check(
    'an @switch with no @default renders no words for any other value',
    unnamedTags(
      '<button mat-button (click)="next()">\n  @switch (step()) {\n    @case (\'review\') {\n' +
        "      {{ 'import.review' | translate }}\n    }\n    @case ('save') {\n      {{ 'common.save' | translate }}\n    }\n  }\n</button>"
    ),
    ['1 button']
  );
  check(
    'an @for with no @empty renders no words for an empty list',
    unnamedTags('<button mat-stroked-button>\n  @for (tag of tags(); track tag) {\n    <span>{{ tag }}</span>\n  }\n</button>'),
    ['1 button']
  );
  check(
    'an @else if with no final @else leaves a state with no words',
    unnamedTags(
      "<button mat-button>\n  @if (saving()) {\n    {{ 'common.saving' | translate }}\n  } @else if (dirty()) {\n" +
        "    {{ 'common.save' | translate }}\n  }\n</button>"
    ),
    ['1 button']
  );
  check(
    'an @else that holds only an icon names nothing in its state',
    unnamedTags(
      "<button mat-button>\n  @if (busy()) {\n    <mat-icon>sync</mat-icon>\n  } @else {\n    {{ 'common.retry' | translate }}\n  }\n</button>"
    ),
    ['1 button']
  );
  check(
    'an inner @if with no @else inside a complete outer one',
    unnamedTags(
      "<button mat-button>\n  @if (a()) {\n    @if (b()) {\n      {{ 'x.b' | translate }}\n    }\n  } @else {\n" +
        "    {{ 'x.c' | translate }}\n  }\n</button>"
    ),
    ['1 button']
  );
  check(
    'a link and an element with a control\'s role are read too',
    unnamedTags(
      '<a [routerLink]="path">\n  @if (label) {\n    {{ label }}\n  }\n</a>\n<div role="button" tabindex="0">\n' +
        "  @if (busy) {\n    <mat-icon>sync</mat-icon>\n  } @else {\n    {{ 'common.upload' | translate }}\n  }\n</div>"
    ),
    ['1 a', '6 div']
  );
  check(
    'a button that holds nothing but an icon and carries no name names nothing in any state',
    scanUnnamedControls('<button mat-icon-button (click)="close()">\n  <mat-icon>close</mat-icon>\n</button>'),
    [{ line: 1, tag: 'button', sometimes: false }]
  );
  check(
    'words inside a literally hidden element, an <img> with an empty alt and an <ng-template> name nothing',
    [
      unnamedTags("<button>\n  <span aria-hidden=\"true\">{{ 'common.close' | translate }}</span>\n</button>"),
      unnamedTags('<button>\n  <img src="close.svg" alt="">\n</button>'),
      unnamedTags("<button>\n  <ng-template>{{ 'common.close' | translate }}</ng-template>\n</button>"),
    ],
    [['1 button'], ['1 button'], ['1 button']]
  );
  check(
    'an <ng-container> is no component: what it holds is read',
    unnamedTags(
      "<button mat-flat-button>\n  @if (busy()) {\n    <ng-container>\n      <mat-icon>sync</mat-icon>\n    </ng-container>\n" +
        "  } @else {\n    {{ 'common.export' | translate }}\n  }\n</button>"
    ),
    ['1 button']
  );
  check(
    'an @defer is read as an @if with no @else, whatever follows it',
    unnamedTags(
      "<button>\n  @defer {\n    {{ 'x.ready' | translate }}\n  } @placeholder {\n    {{ 'x.wait' | translate }}\n  }\n</button>"
    ),
    ['1 button']
  );
  check(
    'a control inside an @if, an @for, an @empty, an @case or an @default is read there, at its own line',
    [
      scanUnnamedControls('@if (open()) {\n  <button mat-icon-button (click)="close()">\n    <mat-icon>close</mat-icon>\n  </button>\n}'),
      unnamedTags(
        '@for (row of rows(); track row.id) {\n  <button mat-icon-button>\n    <mat-icon>delete</mat-icon>\n  </button>\n' +
          '} @empty {\n  <mat-checkbox />\n}'
      ),
      unnamedTags(
        "@switch (step()) {\n  @case ('a') {\n    <mat-checkbox />\n  }\n  @default {\n" +
          '    <a [routerLink]="path"><mat-icon>home</mat-icon></a>\n  }\n}'
      ),
    ],
    [[{ line: 2, tag: 'button', sometimes: false }], ['2 button', '6 mat-checkbox'], ['3 mat-checkbox', '6 a']]
  );
  check(
    'an empty or blank aria-label or aria-labelledby names nothing, on a button, a toggle or a thumb',
    [
      unnamedTags('<button mat-icon-button aria-label="">\n  <mat-icon>close</mat-icon>\n</button>'),
      unnamedTags('<a routerLink="/" aria-labelledby=" ">\n  <mat-icon>home</mat-icon>\n</a>'),
      unnamedTags('<mat-checkbox aria-label=" "></mat-checkbox>'),
      unnamedTags('<mat-slider>\n  <input matSliderThumb aria-label="">\n</mat-slider>'),
    ],
    [['1 button'], ['1 a'], ['1 mat-checkbox'], ['1 mat-slider']]
  );
  check(
    'an exhaustive @switch, closed by @default never;, whose one case holds only an icon names nothing in that case',
    scanUnnamedControls(
      "<button mat-button>\n  @switch (step()) {\n    @case ('review') {\n      <mat-icon>search</mat-icon>\n    }\n" +
        "    @case ('save') {\n      {{ 'common.save' | translate }}\n    }\n    @default never;\n  }\n</button>"
    ),
    [{ line: 1, tag: 'button', sometimes: true }]
  );
  check(
    'a control after an exhaustive @switch is read where it stands, not as part of the switch',
    unnamedTags(
      "@switch (step()) {\n  @case ('a') {\n    <span>a</span>\n  }\n  @default never;\n}\n" +
        '<button mat-icon-button>\n  <mat-icon>close</mat-icon>\n</button>'
    ),
    ['7 button']
  );
  check(
    'an icon with a control\'s role is not named by its ligature, which MatIcon hides, as it is by an aria-label',
    [
      scanUnnamedControls('<mat-icon role="button" tabindex="0" (click)="close()">close</mat-icon>'),
      scanUnnamedControls('<mat-icon role="button" tabindex="0" aria-label="Close" (click)="close()">close</mat-icon>'),
    ],
    [[{ line: 1, tag: 'mat-icon', sometimes: false }], []]
  );

  // --- the branch rule: must not hit (the load-bearing half) ---
  check(
    'an @if…@else with words in both, the transaction list\'s select toggle',
    unnamedTags(
      '<button mat-button class="select-toggle" (click)="toggleSelectMode()">\n' +
        "  <mat-icon>{{ inSelectMode() ? 'done' : 'checklist' }}</mat-icon>\n  @if (inSelectMode()) {\n" +
        "    {{ 'transactions.select.done' | translate }}\n  } @else {\n    {{ 'transactions.select.start' | translate }}\n  }\n</button>"
    ),
    []
  );
  check(
    'an @switch…@default with words in every case',
    unnamedTags(
      "<button mat-button>\n  @switch (step()) {\n    @case ('review') {\n      {{ 'import.review' | translate }}\n    }\n" +
        "    @default {\n      {{ 'common.next' | translate }}\n    }\n  }\n</button>"
    ),
    []
  );
  check(
    'an exhaustive @switch, closed by @default never;, with words in every case, and one with words after it',
    [
      unnamedTags(
        "<button mat-button>\n  @switch (step()) {\n    @case ('review') {\n      {{ 'import.review' | translate }}\n    }\n" +
          "    @case ('save') {\n      {{ 'common.save' | translate }}\n    }\n    @default never;\n  }\n</button>"
      ),
      unnamedTags(
        "<button mat-button>\n  @switch (step()) {\n    @case ('review') {\n      <mat-icon>search</mat-icon>\n    }\n" +
          "    @default never;\n  }\n  {{ 'common.next' | translate }}\n</button>"
      ),
    ],
    [[], []]
  );
  check(
    'an @for…@empty with words in both',
    unnamedTags(
      "<button mat-stroked-button>\n  @for (tag of tags(); track tag) {\n    <span>{{ tag }}</span>\n  } @empty {\n" +
        "    {{ 'transactions.addTag' | translate }}\n  }\n</button>"
    ),
    []
  );
  check(
    'an @else if chain closed by an @else, with words in each',
    unnamedTags(
      "<button mat-button>\n  @if (saving()) {\n    {{ 'common.saving' | translate }}\n  } @else if (dirty()) {\n" +
        "    {{ 'common.save' | translate }}\n  } @else {\n    {{ 'common.saved' | translate }}\n  }\n</button>"
    ),
    []
  );
  check(
    'a bound aria-label names the control whatever its blocks hold, the filter toggle fixed',
    unnamedTags(
      '<button\n  class="filter-toggle"\n  [attr.aria-label]="activeFilterCount() > 0\n' +
        "    ? ('transactions.filtersToggleActive' | translate: { active: activeFilterCount() })\n" +
        "    : ('transactions.filtersToggle' | translate)\"\n  [attr.aria-expanded]=\"expanded()\"\n>\n" +
        '  <mat-icon>tune</mat-icon>\n  @if (activeFilterCount() > 0) {\n' +
        '    <span class="filter-badge" aria-hidden="true">{{ activeFilterCount() }}</span>\n  }\n</button>'
    ),
    []
  );
  check(
    'a button named by an aria-label or aria-labelledby in each spelling, its content in an @if',
    ['aria-label="x"', 'aria-labelledby="t"', '[aria-label]="x"', '[aria-labelledby]="t"', '[attr.aria-label]="x"', '[attr.aria-labelledby]="t"'].map(
      (name) => unnamedTags(`<button ${name}>\n  @if (n) {\n    {{ n }}\n  }\n</button>`)
    ),
    [[], [], [], [], [], []]
  );
  check(
    'a role-button whose branch stamps a component, the Data page\'s upload area',
    unnamedTags(
      '<div class="import-dropzone" role="button" tabindex="0" (click)="fileInput.click()">\n  @if (isImporting()) {\n' +
        "    <app-loading-spinner [message]=\"'settings.processingFile' | translate\" />\n  } @else {\n" +
        "    <mat-icon>cloud_upload</mat-icon>\n    <span class=\"dropzone-text\">{{ 'settings.uploadPrompt' | translate }}</span>\n  }\n</div>"
    ),
    []
  );
  check(
    'an <img [alt]> beside an @if that holds a spinner, the form\'s stored-receipt thumbnail',
    unnamedTags(
      '<button type="button" class="receipt-preview" (click)="openReceipt(stored)">\n' +
        "  <img\n    [src]=\"stored.url\"\n    [alt]=\"'receiptImages.imageNumber' | translate: { index: i + 1, total: 2 }\"\n  />\n" +
        '  @if (busyStoredSlot() === stored.slot) {\n    <div class="scanning-overlay">\n' +
        "      <app-loading-spinner [message]=\"'receiptImages.converting' | translate\" />\n    </div>\n  }\n</button>"
    ),
    []
  );
  check(
    'words outside every block name the control beside an @if with no @else',
    unnamedTags(
      "<button mat-button>\n  {{ 'transactions.filters' | translate }}\n  @if (count() > 0) {\n" +
        '    <span class="badge">{{ count() }}</span>\n  }\n</button>'
    ),
    []
  );
  check(
    'a nested @if complete at every level, beside an @let',
    unnamedTags(
      "<button mat-button>\n  @let n = count();\n  @if (n > 1) {\n    @if (all()) {\n      {{ 'x.all' | translate }}\n" +
        "    } @else {\n      {{ 'x.some' | translate: { n } }}\n    }\n  } @else {\n    {{ 'x.one' | translate }}\n  }\n</button>"
    ),
    []
  );
  check(
    'an icon written to be read names the control holding it, as an icon left hidden does not',
    [
      unnamedTags('<button>\n  <mat-icon role="img" aria-hidden="false" [attr.aria-label]="tip()">error</mat-icon>\n</button>'),
      unnamedTags('<button>\n  <mat-icon role="img" [attr.aria-label]="tip()">error</mat-icon>\n</button>'),
    ],
    [[], ['1 button']]
  );
  check(
    'a block around the control is not in it',
    unnamedTags("@if (canSave()) {\n  <button mat-button>{{ 'common.save' | translate }}</button>\n}"),
    []
  );
  check(
    'projected content, text a property binding writes and a template an outlet stamps each count',
    [
      unnamedTags('<button mat-button (click)="go()">\n  <ng-content />\n</button>'),
      unnamedTags('<button [textContent]="label()"></button>'),
      unnamedTags('<button>\n  <ng-container *ngTemplateOutlet="labelTemplate" />\n</button>'),
    ],
    [[], [], []]
  );
  check(
    'an input, a select and a textarea are named by a label, not by what they hold, whatever role they carry',
    unnamedTags(
      '<input type="checkbox" role="switch">\n<select role="button">\n  @if (a) {\n    <option>A</option>\n  }\n</select>\n' +
        '<textarea role="button"></textarea>'
    ),
    []
  );
  check(
    'each spelling of a binding or an outlet that fills an element counts as words',
    ['[textContent]', '[innerText]', '[innerHTML]', '*ngTemplateOutlet', '[ngTemplateOutlet]'].map((attribute) =>
      unnamedTags(`<button>\n  <span ${attribute}="label"></span>\n</button>`)
    ),
    [[], [], [], [], []]
  );
  check(
    'each spelling of an image\'s alt counts as words',
    ['alt="Close"', '[alt]="label"', '[attr.alt]="label"'].map((attribute) =>
      unnamedTags(`<button>\n  <img src="close.svg" ${attribute}>\n</button>`)
    ),
    [[], [], []]
  );
  check(
    'words after a self-closing or a void element are the control\'s own',
    [
      unnamedTags('<button>\n  <mat-icon svgIcon="save" /> Save\n</button>'),
      unnamedTags('<button>\n  <img src="save.svg" alt="">Save\n</button>'),
    ],
    [[], []]
  );
  check(
    'an @let renders nothing and hides nothing after it',
    [
      unnamedTags('<button mat-button>\n  @let n = count();\n  {{ n }}\n</button>'),
      unnamedTags('<button mat-icon-button>\n  @let n = count();\n  <mat-icon>close</mat-icon>\n</button>'),
    ],
    [[], ['1 button']]
  );
  check('a commented-out button is not a button', unnamedTags('<!-- <button><mat-icon>x</mat-icon></button> -->'), []);

  check(
    'a control read through a block says so, at any depth, and one inside a block or holding none does not',
    [
      "<button mat-button>\n  @if (a()) {\n    {{ 'x.a' | translate }}\n  } @else {\n    {{ 'x.b' | translate }}\n  }\n</button>",
      "<button mat-button>\n  <span>\n    @if (a()) {\n      {{ 'x.a' | translate }}\n    } @else {\n" +
        "      {{ 'x.b' | translate }}\n    }\n  </span>\n</button>",
      "@if (canSave()) {\n  <button mat-button>{{ 'common.save' | translate }}</button>\n}",
      "<button mat-button>{{ 'common.save' | translate }}</button>",
    ].map((source) => readControls(source).map((control) => control.blocks)),
    [[true], [true], [false], [false]]
  );

  // --- the branch rule: what the header lists as unseen ---
  check(
    'a title is not read as a name, so a control named by one alone fails: the header lists it as unseen',
    unnamedTags('<button mat-icon-button title="Close">\n  <mat-icon>close</mat-icon>\n</button>'),
    ['1 button']
  );
  check(
    'an element under a structural *ngIf is read as rendering always: the header lists it as unseen',
    unnamedTags('<button mat-button>\n  <span *ngIf="label">{{ label }}</span>\n</button>'),
    []
  );
  check(
    'an element hidden by a bound [attr.aria-hidden] is read as rendering: the header lists it as unseen',
    unnamedTags('<button mat-button>\n  <span [attr.aria-hidden]="true">{{ label }}</span>\n</button>'),
    []
  );
  check(
    'an aria-label bound to an expression that is null in some states names the control in all, the camera\'s ' +
      'process button with its @else words gone: the header lists it as unseen',
    unnamedTags(
      '<button mat-flat-button\n  [attr.aria-label]="processing() ? (\'import.processWithAI\' | translate) : null"\n>\n' +
        '  @if (processing()) {\n    <mat-spinner diameter="18" aria-hidden="true"></mat-spinner>\n  }\n</button>'
    ),
    []
  );

  // --- the per-item rule across templates: a component another stamps per item ---
  const EDIT = '<button mat-icon-button [attr.aria-label]="\'common.edit\' | translate">x</button>';
  const REFRESH = '<button mat-icon-button [attr.aria-label]="\'ai.refresh\' | translate">x</button>';
  // The dashboard's shape: one @for over the arranged cards, an @switch on
  // the card itself, and each @case stamping its own card component.
  const arranged = (insights, chart) =>
    `@for (card of arrangedCards(); track card) {\n  @switch (card) {\n` +
    `    @case ('insights') {\n      <app-summary>${insights}</app-summary>\n    }\n` +
    `    @case ('chart') {\n      <app-chart>${chart}</app-chart>\n    }\n  }\n}`;
  const CARDS = [
    ['summary', 'app-summary', `<mat-card>\n  ${REFRESH}\n  <ng-content />\n</mat-card>`],
    ['chart', 'app-chart', '<mat-card><ng-content /></mat-card>'],
  ];
  // The goal card's shape: its Edit sits in no repeat of its own template.
  const GOAL_CARD = `<mat-card>\n  <div class="goal-actions">\n    ${EDIT}\n  </div>\n</mat-card>`;

  check(
    'a bare key in no repeat of its own template is reported only when its component is said to be repeated',
    [itemlessLines(GOAL_CARD), itemlessLines(GOAL_CARD, true)],
    [[], [3]]
  );

  // The run's own path: the verdict across templates and each template's scan
  // with it, both through scanItemlessAcross.
  const itemlessSites = (templates) =>
    scanItemlessAcross(templates.map(([key, selector, source]) => ({ key, selector, source, offset: 0 }))).hits.map(
      (hit) => hit.site
    );

  check(
    'a bare key in a card its parent stamps in a plain @for is reported at the card\'s line, through the run\'s path',
    itemlessSites([
      ['goals', 'app-goals', '@for (goal of goals(); track goal.id) {\n  <app-goal-card [goal]="goal" />\n}'],
      ['card', 'app-goal-card', GOAL_CARD],
    ]),
    ['card:3']
  );
  check(
    'the same card stamped under an @case on the @for\'s own item is held apart, through the run\'s path',
    itemlessSites([
      ['dashboard', 'app-dashboard', '@for (card of cards(); track card) {\n  @switch (card) {\n    @case (\'goal\') {\n      <app-goal-card />\n    }\n  }\n}'],
      ['card', 'app-goal-card', GOAL_CARD],
    ]),
    []
  );
  {
    const keys = repeatedKeys([['dashboard', 'app-dashboard', arranged('', '')], ...CARDS], { casesApart: true });
    check(
      'the dashboard\'s @switch on the @for\'s own item renders each card once',
      [keys, itemlessLines(CARDS[0][2], keys.includes('summary'))],
      [[], []]
    );
  }
  check(
    'an @case on the item, read in its own template, is not repeated',
    itemlessLines(`@for (card of cards(); track card) {\n  @switch (card) {\n    @case ('insights') {\n      ${REFRESH}\n    }\n  }\n}`),
    []
  );
  check(
    'rule 4\'s default still counts the dashboard\'s cards as repeated',
    repeatedKeys([['dashboard', 'app-dashboard', arranged('', '')], ...CARDS]),
    ['chart', 'summary']
  );
  check(
    'an @switch (c.kind) on something the item holds still repeats',
    itemlessLines(`@for (c of cards(); track c.id) {\n  @switch (c.kind) {\n    @case ('insights') {\n      ${REFRESH}\n    }\n  }\n}`),
    [4]
  );
  check(
    'an @case on the item under an outer @for over rows still repeats',
    itemlessLines(
      `@for (row of rows(); track row.id) {\n  @for (card of row.cards; track card) {\n    @switch (card) {\n` +
        `      @case ('insights') {\n        ${REFRESH}\n      }\n    }\n  }\n}`
    ),
    [5]
  );
  check(
    'an @default under an @switch on the item still repeats, since every other item lands in it',
    itemlessLines(`@for (card of cards(); track card) {\n  @switch (card) {\n    @default {\n      ${REFRESH}\n    }\n  }\n}`),
    [4]
  );
  check(
    'a selector stamped in two cases of one lifted switch still repeats, the card menu\'s shape',
    repeatedKeys(
      [
        ['dashboard', 'app-dashboard', arranged('<app-card-menu [card]="card" />', '<app-card-menu [card]="card" />')],
        ['menu', 'app-card-menu', `<button [matMenuTriggerFor]="m" [attr.aria-label]="'dashboard.cardActions' | translate: { card: card() }">x</button>`],
      ],
      { casesApart: true }
    ),
    ['menu']
  );
  const DELETE = '<button mat-icon-button [attr.aria-label]="\'common.delete\' | translate">x</button>';
  const twoCases = (first, second) =>
    `@for (card of cards(); track card) {\n  @switch (card) {\n` +
    `    @case ('a') {\n      ${first}\n    }\n    @case ('b') {\n      ${second}\n    }\n  }\n}`;
  check(
    'a bare key written in two cases of one lifted switch still repeats, as the card menu does',
    itemlessLines(twoCases(DELETE, DELETE)),
    [4, 7]
  );
  check(
    'a bare key written in only one case of a lifted switch is lifted, beside another key in the other case',
    itemlessLines(twoCases(DELETE, EDIT)),
    []
  );

  // --- the per-item rule across templates: what a held-apart case reaches through what it stamps ---
  const RETRY = '<button mat-icon-button [attr.aria-label]="\'common.retry\' | translate">x</button>';
  check(
    'a component every case reaches only through the card it stamps still repeats',
    repeatedKeys(
      [
        ['dashboard', 'app-dashboard', twoCases('<app-a />', '<app-b />')],
        ['a', 'app-a', '<mat-card><app-shared /></mat-card>'],
        ['b', 'app-b', '<mat-card><div><app-shared /></div></mat-card>'],
        ['shared', 'app-shared', RETRY],
      ],
      { casesApart: true }
    ),
    ['shared']
  );
  check(
    'a component one case writes and another reaches through its card still repeats',
    repeatedKeys(
      [
        ['dashboard', 'app-dashboard', twoCases('<app-shared />', '<app-b />')],
        ['b', 'app-b', '<mat-card><app-shared /></mat-card>'],
        ['shared', 'app-shared', RETRY],
      ],
      { casesApart: true }
    ),
    ['shared']
  );
  check(
    'the empty state two of the dashboard\'s cards stamp is repeated, two levels down too',
    repeatedKeys(
      [
        ['dashboard', 'app-dashboard', arranged('', '')],
        ['summary', 'app-summary', '<mat-card>\n  @if (empty) {\n    <app-empty-state />\n  }\n</mat-card>'],
        ['chart', 'app-chart', '<mat-card><app-chart-body /></mat-card>'],
        ['body', 'app-chart-body', '<app-empty-state />'],
        ['empty', 'app-empty-state', '<button mat-button>{{ actionLabel }}</button>'],
      ],
      { casesApart: true }
    ),
    ['empty']
  );
  check(
    'a component that stamps itself is read to an end, and still repeats when two cases reach it',
    repeatedKeys(
      [
        ['dashboard', 'app-dashboard', twoCases('<app-tree />', '<app-b />')],
        ['b', 'app-b', '<mat-card><app-tree /></mat-card>'],
        ['tree', 'app-tree', '@if (kids) {<app-tree />}'],
      ],
      { casesApart: true }
    ),
    ['tree']
  );
  // A stamps B and B stamps A: each case reaches both, and through A the
  // Retry that X holds, whichever case the switch reads first.
  const stampEachOther = [
    ['a', 'app-a', '<div><app-b /><app-x /></div>'],
    ['b', 'app-b', '@if (open) {<app-a />}'],
    ['x', 'app-x', RETRY],
  ];
  check(
    'components that stamp each other reach the same whichever case reads them first',
    [
      itemlessSites([
        ['dashboard', 'app-dashboard', twoCases(`${RETRY}<app-a />`, '<app-b />')],
        ...stampEachOther,
      ]),
      itemlessSites([
        ['dashboard', 'app-dashboard', twoCases('<app-b />', `${RETRY}<app-a />`)],
        ...stampEachOther,
      ]),
    ],
    [
      ['dashboard:4', 'x:1'],
      ['dashboard:7', 'x:1'],
    ]
  );
  check(
    'a bare key every case reaches only through the card it stamps is reported at each card\'s line, through the run\'s path',
    itemlessSites([
      ['dashboard', 'app-dashboard', twoCases('<app-a />', '<app-b />')],
      ['a', 'app-a', `<mat-card>\n  ${RETRY}\n</mat-card>`],
      ['b', 'app-b', `<mat-card>\n  ${RETRY}\n</mat-card>`],
    ]),
    ['a:2', 'b:2']
  );
  check(
    'a bare key one case writes and another reaches through its card is reported at both, and the page\'s own copy is not',
    itemlessSites([
      ['dashboard', 'app-dashboard', `${RETRY}\n` + twoCases(RETRY, '<app-b />')],
      ['b', 'app-b', `<mat-card>\n  ${RETRY}\n</mat-card>`],
    ]),
    ['dashboard:5', 'b:2']
  );
  check(
    'a bare key two levels below one case and written in another is reported at both',
    itemlessSites([
      ['dashboard', 'app-dashboard', twoCases('<app-a />', RETRY)],
      ['a', 'app-a', '<mat-card><app-inner /></mat-card>'],
      ['inner', 'app-inner', `<div>\n  ${RETRY}\n</div>`],
    ]),
    ['dashboard:7', 'inner:2']
  );
  check(
    'a component and a key only one case reaches stay lifted, however deep',
    [
      repeatedKeys(
        [
          ['dashboard', 'app-dashboard', twoCases('<app-a />', '<app-b />')],
          ['a', 'app-a', '<mat-card><app-shared /></mat-card>'],
          ['b', 'app-b', `<mat-card>${EDIT}</mat-card>`],
          ['shared', 'app-shared', RETRY],
        ],
        { casesApart: true }
      ),
      itemlessSites([
        ['dashboard', 'app-dashboard', twoCases('<app-a />', '<app-b />')],
        ['a', 'app-a', '<mat-card><app-shared /></mat-card>'],
        ['b', 'app-b', `<mat-card>${EDIT}</mat-card>`],
        ['shared', 'app-shared', RETRY],
      ]),
    ],
    [[], []]
  );

  // --- the per-item rule, a control's own text: must hit ---
  check(
    'a repeated button named by one bare visible key is reported at its opening tag, the import history\'s View',
    scanItemlessLabels(
      '@for (item of history(); track item.id) {\n  <button\n    mat-button\n    (click)="open(item)"\n  >\n' +
        "    <mat-icon>open_in_new</mat-icon>\n    {{ 'import.viewTransaction' | translate }}\n  </button>\n}"
    ),
    [{ line: 2, tag: 'button', key: 'import.viewTransaction', via: 'text' }]
  );
  check(
    'an exhaustive @default never; is block syntax, not text, beside a bare key',
    itemlessLines(
      "@for (t of rows; track t.id) {\n  <button mat-button>\n    @switch (t.kind) {\n      @case ('a') {\n" +
        "        <mat-icon>edit</mat-icon>\n      }\n      @default never;\n    }\n    {{ 'common.edit' | translate }}\n  </button>\n}"
    ),
    [2]
  );
  check(
    'text a child element holds is the control\'s, the swipe drawer\'s Edit',
    itemlessLines(
      "@for (t of rows; track t.id) {\n  <button class=\"swipe-action\">\n    <mat-icon>edit</mat-icon>\n" +
        "    <span>{{ 'common.edit' | translate }}</span>\n  </button>\n}"
    ),
    [2]
  );
  check(
    'an icon\'s ligature and a literally hidden child are not text',
    itemlessLines(
      '@for (c of cards; track c.id) {\n  <button>\n    <mat-icon>{{ c.icon }}</mat-icon>\n' +
        "    <span aria-hidden=\"true\">{{ c.emoji }}</span>\n    {{ 'common.open' | translate }}\n  </button>\n}"
    ),
    [2]
  );
  check(
    'a bare ternary in the text, the insight card\'s show and hide toggle',
    scanItemlessLabels(
      '@for (c of cards(); track c.id) {\n  <button (click)="toggle(c)" [attr.aria-expanded]="c.open">\n' +
        "    <mat-icon>{{ c.open ? 'expand_less' : 'expand_more' }}</mat-icon>\n    <span>\n" +
        "      {{ (c.open ? 'insights.hideTransactions' : 'insights.showTransactions') | translate }}\n    </span>\n  </button>\n}"
    ),
    [{ line: 2, tag: 'button', key: 'insights.hideTransactions : insights.showTransactions', via: 'text' }]
  );
  check(
    'a repeated toggle named by one bare visible key is reported at its opening tag, each of the three',
    ['mat-checkbox', 'mat-slide-toggle', 'mat-radio-button'].map((toggle) =>
      scanItemlessLabels(
        `@for (r of rules; track r.id) {\n  <${toggle} [checked]="r.on" (change)="flip(r)">\n` +
          `    {{ 'common.enabled' | translate }}\n  </${toggle}>\n}`
      )
    ),
    ['mat-checkbox', 'mat-slide-toggle', 'mat-radio-button'].map((toggle) => [
      { line: 2, tag: toggle, key: 'common.enabled', via: 'text' },
    ])
  );
  check(
    'a link and an element with a control\'s role are read by their text too',
    itemlessLines(
      "@for (r of rows; track r.id) {\n  <a [routerLink]=\"r.path\">{{ 'common.open' | translate }}</a>\n" +
        "  <span role=\"button\" tabindex=\"0\">{{ 'common.remove' | translate }}</span>\n}"
    ),
    [2, 3]
  );
  check(
    'a literal aria-describedby names one element for every copy, so it exempts nothing',
    itemlessLines(
      "@for (r of rows; track r.id) {\n  <button aria-describedby=\"row-hint\">{{ 'common.remove' | translate }}</button>\n}\n" +
        '<p id="row-hint">x</p>'
    ),
    [2]
  );
  const CONTRIBUTE =
    "<button mat-stroked-button (click)=\"contribute.emit()\">\n      <mat-icon>add</mat-icon>\n" +
    "      {{ 'goal.contribute' | translate }}\n    </button>";
  check(
    'a text-named button in a card its parent stamps per item is reported at the card\'s line, the goal card\'s shape',
    itemlessSites([
      ['goals', 'app-goals', '@for (goal of goals(); track goal.id) {\n  <app-goal-card [goal]="goal" />\n}'],
      ['card', 'app-goal-card', `<mat-card>\n  <mat-card-actions>\n    ${CONTRIBUTE}\n  </mat-card-actions>\n</mat-card>`],
    ]),
    ['card:3']
  );
  const VIEW_ALL = (route) =>
    `<a routerLink="${route}" class="view-all-link">\n    {{ 'dashboard.viewAll' | translate }}\n` +
    '    <mat-icon>chevron_right</mat-icon>\n  </a>';
  check(
    'one bare visible key two cases of a held-apart switch reach is reported in each card, the dashboard\'s View All',
    itemlessSites([
      ['dashboard', 'app-dashboard', twoCases('<app-a />', '<app-b />')],
      ['a', 'app-a', `<mat-card>\n  ${VIEW_ALL('/transactions')}\n</mat-card>`],
      ['b', 'app-b', `<mat-card>\n  ${VIEW_ALL('/budgets')}\n</mat-card>`],
    ]),
    ['a:2', 'b:2']
  );
  check(
    'a key one case shows as text and another gives as a label is one name twice',
    itemlessSites([
      ['dashboard', 'app-dashboard', twoCases('<app-a />', '<app-b />')],
      ['a', 'app-a', "<mat-card>\n  <button>{{ 'common.retry' | translate }}</button>\n</mat-card>"],
      ['b', 'app-b', `<mat-card>\n  ${RETRY}\n</mat-card>`],
    ]),
    ['a:2', 'b:2']
  );
  const RETRY_TEXT = "<button mat-button>{{ 'common.retry' | translate }}</button>";
  check(
    'a text-named control written in two cases of one lifted switch still repeats, as a label-named one does',
    itemlessLines(twoCases(RETRY_TEXT, RETRY_TEXT)),
    [4, 7]
  );

  // --- the per-item rule, a control's own text: must not hit (the load-bearing half) ---
  check(
    'a visible key with parameters has a slot, and the rule does not judge what fills it',
    itemlessLines(
      '@for (item of history(); track item.id) {\n  <button mat-button [matMenuTriggerFor]="m">\n' +
        "    {{ 'import.viewTransactions' | translate: { count: item.ids.length } }}\n  </button>\n}"
    ),
    []
  );
  check(
    'a bare key beside the item\'s own value is more than one interpolation, a Remove that says its file',
    itemlessLines("@for (f of files; track f) {\n  <button mat-button>{{ 'common.remove' | translate }} {{ f.name }}</button>\n}"),
    []
  );
  check(
    'a bare key beside an <img> with an alt is not read as bare, in each spelling of the alt',
    ['alt="{{ r.name }}"', '[alt]="r.name"', '[attr.alt]="r.name"'].map((alt) =>
      itemlessLines(
        `@for (r of rows; track r.id) {\n  <button>\n    <img ${alt} src="x.png">\n` +
          "    {{ 'common.open' | translate }}\n  </button>\n}"
      )
    ),
    [[], [], []]
  );
  check(
    'a bare key beside a component is not read as bare, self-closing, with an empty body or projected',
    [
      '<app-avatar [user]="r" />',
      '<app-avatar [user]="r"></app-avatar>',
      '<span><app-avatar [user]="r" /></span>',
      '<ng-content />',
    ].map((beside) =>
      itemlessLines(
        `@for (r of rows; track r.id) {\n  <button>\n    ${beside}\n    {{ 'common.open' | translate }}\n  </button>\n}`
      )
    ),
    [[], [], [], []]
  );
  check(
    'a bound aria-label names the control whatever its text says, the goal card fixed',
    itemlessLines(
      '@for (goal of goals(); track goal.id) {\n  <button\n    mat-button\n' +
        "    [attr.aria-label]=\"'goal.viewTransactionsNamed' | translate: { name: goal.name }\"\n  >\n" +
        "    {{ 'goal.viewTransactions' | translate }}\n  </button>\n}"
    ),
    []
  );
  check(
    'a literal aria-label or an aria-labelledby names the control instead of its text',
    [
      itemlessLines("@for (r of rows; track r.id) {\n  <button aria-label=\"Open {{ r.name }}\">{{ 'common.open' | translate }}</button>\n}"),
      itemlessLines(
        '@for (r of rows; track r.id) {\n  <span [id]="r.id">{{ r.name }}</span>\n' +
          "  <button [attr.aria-labelledby]=\"r.id\">{{ 'common.open' | translate }}</button>\n}"
      ),
    ],
    [[], []]
  );
  const MENU_OF = (inside) =>
    '@for (c of list; track c.id) {\n' +
    "  <button [matMenuTriggerFor]=\"m\" [attr.aria-label]=\"'common.moreActionsFor' | translate: { description: c.name }\">x</button>\n" +
    `  <mat-menu #m="matMenu">\n    ${inside}\n  </mat-menu>\n}`;
  check(
    'a text-named item inside a <mat-menu> is exempt, its trigger naming the row',
    itemlessLines(
      MENU_OF("<button mat-menu-item (click)=\"edit(c)\">\n      <mat-icon>edit</mat-icon>\n      {{ 'common.edit' | translate }}\n    </button>")
    ),
    []
  );
  check(
    'a text-named control with a bound aria-describedby is exempt, the household\'s Remove',
    [
      itemlessLines(
        '@for (view of members(); track view.uid) {\n  <span [id]="view.nameId">{{ view.name }}</span>\n' +
          "  <button mat-stroked-button [attr.aria-describedby]=\"view.nameId\">\n    {{ 'household.members.remove' | translate }}\n  </button>\n}"
      ),
      itemlessLines("@for (r of rows; track r.id) {\n  <button [aria-describedby]=\"r.hintId\">{{ 'common.remove' | translate }}</button>\n}"),
    ],
    [[], []]
  );
  check(
    'an interpolated literal aria-describedby is bound, each copy pointing at its own element',
    itemlessLines("@for (r of rows; track r.id) {\n  <button aria-describedby=\"{{ r.hintId }}\">{{ 'common.remove' | translate }}</button>\n}"),
    []
  );
  check(
    'a bound aria-describedby exempts its control whatever it reads, a constant too: the header lists it as unseen',
    itemlessLines("@for (r of rows; track r.id) {\n  <button [attr.aria-describedby]=\"hintId\">{{ 'common.remove' | translate }}</button>\n}"),
    []
  );
  check(
    'a text-named button in the @empty branch, which renders once',
    itemlessLines(
      "@for (f of files; track f) {\n  <span>{{ f.name }}</span>\n} @empty {\n  <button mat-button>{{ 'import.browse' | translate }}</button>\n}"
    ),
    []
  );
  check(
    'a text-named button rendered once, a page\'s own',
    itemlessLines("<div class=\"toolbar\">\n  <button mat-button>{{ 'common.refresh' | translate }}</button>\n</div>"),
    []
  );
  check(
    'text after a control has closed is not its text',
    itemlessLines(
      "@for (r of rows; track r.id) {\n  <button [attr.aria-pressed]=\"r.on\"><mat-icon>close</mat-icon></button>\n  {{ 'common.close' | translate }}\n}"
    ),
    []
  );
  check(
    'a select\'s options are not its name',
    itemlessLines(
      "@for (r of rows; track r.id) {\n  <select [(ngModel)]=\"r.kind\">\n    <option value=\"a\">{{ 'common.yes' | translate }}</option>\n  </select>\n}"
    ),
    []
  );
  check(
    'a commented-out text-named button is not a button',
    itemlessLines("<!-- @for (r of rows; track r.id) { <button>{{ 'common.open' | translate }}</button> } -->"),
    []
  );

  // --- the per-item rule, a control's own text: guards ---
  check(
    'an <img> with an empty alt, a hidden <img> or component, and an icon add nothing beside a bare key',
    [
      '<img alt="" src="x.png">',
      '<img [alt]="r.name" aria-hidden="true" src="x.png">',
      '<app-avatar aria-hidden="true" [user]="r" />',
      '<span aria-hidden="true"><app-avatar [user]="r" /></span>',
      '<ng-container></ng-container>',
      '<mat-icon>person</mat-icon>',
    ].map((beside) =>
      itemlessLines(
        `@for (r of rows; track r.id) {\n  <button>\n    ${beside}\n    {{ 'common.open' | translate }}\n  </button>\n}`
      )
    ),
    [[2], [2], [2], [2], [2], [2]]
  );
  check(
    'an <img> or a component after the control has closed is not beside its text',
    itemlessLines(
      "@for (r of rows; track r.id) {\n  <button>{{ 'common.open' | translate }}</button>\n  <img [alt]=\"r.name\" src=\"x.png\">\n" +
        '  <app-avatar [user]="r" />\n}'
    ),
    [2]
  );
  check(
    'a label-named item inside a <mat-menu> is still read',
    scanItemlessLabels(MENU_OF("<button mat-menu-item [attr.aria-label]=\"'common.edit' | translate\">x</button>")),
    [{ line: 4, tag: 'button', key: 'common.edit', via: 'label' }]
  );
  // A menu rendered once whose items a repeat inside it stamps: every copy
  // sits in the one panel the trigger opens.
  const MENU_REPEATING = (inside) =>
    "<button [matMenuTriggerFor]=\"m\" [attr.aria-label]=\"'account.switchAccount' | translate\">x</button>\n" +
    `<mat-menu #m="matMenu">\n  @for (a of accounts(); track a.id) {\n    ${inside}\n  }\n</mat-menu>`;
  check(
    'a text-named item a repeat inside the <mat-menu> stamps is read, as its label-named twin is',
    [
      scanItemlessLabels(MENU_REPEATING("<button mat-menu-item (click)=\"pick(a)\">{{ 'common.select' | translate }}</button>")),
      scanItemlessLabels(MENU_REPEATING("<button mat-menu-item [attr.aria-label]=\"'common.select' | translate\">x</button>")),
      itemlessLines(
        "<mat-menu #m=\"matMenu\">\n  <button mat-menu-item *ngFor=\"let a of accounts\">{{ 'common.select' | translate }}</button>\n</mat-menu>"
      ),
      itemlessLines(
        "@for (r of rows; track r.id) {\n  <mat-menu #m=\"matMenu\">\n    @for (a of r.accounts; track a.id) {\n" +
          "      <button mat-menu-item>{{ 'common.select' | translate }}</button>\n    }\n  </mat-menu>\n}"
      ),
    ],
    [
      [{ line: 4, tag: 'button', key: 'common.select', via: 'text' }],
      [{ line: 4, tag: 'button', key: 'common.select', via: 'label' }],
      [2],
      [4],
    ]
  );
  check(
    'a repeat inside the <mat-menu> that does not hold the item leaves it exempt',
    itemlessLines(
      "@for (c of list; track c.id) {\n  <mat-menu #m=\"matMenu\">\n    <button mat-menu-item>{{ 'common.edit' | translate }}</button>\n" +
        '    @for (t of c.tags; track t) {\n      <span>{{ t }}</span>\n    }\n  </mat-menu>\n}'
    ),
    []
  );
  check(
    'the menu\'s exemption ends where the menu closes',
    itemlessLines(
      "@for (c of list; track c.id) {\n  <mat-menu #m=\"matMenu\">\n    <button mat-menu-item>{{ 'common.edit' | translate }}</button>\n" +
        "  </mat-menu>\n  <button mat-button>{{ 'common.delete' | translate }}</button>\n}"
    ),
    [5]
  );
  const GOAL_CARD_TEMPLATE = join(SOURCE_DIR, 'features/budgets/goals/goal-progress-card/goal-progress-card.component.html');
  check(
    'the text hint\'s model is a binding the goal card carries; if it left the goal card, update ITEMLESS_TEXT_MODEL',
    existsSync(GOAL_CARD_TEMPLATE) &&
      readFileSync(GOAL_CARD_TEMPLATE, 'utf8').includes(`[attr.aria-label]="${ITEMLESS_TEXT_MODEL}"`),
    true
  );
  check(
    'the text hint keeps the visible words, adds the item and quotes its model',
    [itemlessTextHint().startsWith('keep the visible words, add the item'), itemlessTextHint().includes(ITEMLESS_TEXT_MODEL)],
    [true, true]
  );

  // --- the sibling rule: the arm ancestry walkTemplate hands its visit ---
  const armsBy = (source, options = {}) => {
    const seen = {};
    walkTemplate(source, ({ name, arms }) => (seen[name] = arms), options);
    return seen;
  };
  const CHAIN = '@if (a) {\n  <i></i>\n} @else if (b) {\n  <b></b>\n} @else {\n  <u></u>\n}';
  check(
    'the arms of one @if, @else if and @else share their chain, the @if\'s, and differ from each other',
    (() => {
      const { i, b, u } = armsBy(CHAIN);
      const ifAt = CHAIN.indexOf('@if');
      return [
        [i, b, u].map((arms) => arms.length),
        [i, b, u].every((arms) => arms[0]?.chainAt === ifAt),
        new Set([i, b, u].map((arms) => arms[0]?.armAt)).size,
        i[0]?.armAt === ifAt,
      ];
    })(),
    [[1, 1, 1], true, 3, true]
  );
  const SWITCH = "@switch (mode()) {\n  @case ('a') {\n    <i></i>\n  }\n  @default {\n    <b></b>\n  }\n}";
  check(
    'the @case and @default of a switch share their chain, the @switch\'s, and differ from each other',
    (() => {
      const { i, b } = armsBy(SWITCH);
      const switchAt = SWITCH.indexOf('@switch');
      return [i.length, b.length, i[0]?.chainAt === switchAt, b[0]?.chainAt === switchAt, i[0]?.armAt !== b[0]?.armAt];
    })(),
    [1, 1, true, true, true]
  );
  check(
    'an element outside every block, and one under a @for, has no arms',
    (() => {
      const { i, b } = armsBy('<i></i>\n@for (r of rows; track r) {\n  <b></b>\n}');
      return [i, b];
    })(),
    [[], []]
  );
  check(
    'the cases of a switch on the @for\'s own item are no arms, held apart or not: each item renders its own',
    [true, false].map((casesApart) =>
      armsBy("@for (c of cards; track c) {\n  @switch (c) {\n    @case ('a') {\n      <i></i>\n    }\n  }\n}", { casesApart }).i
    ),
    [[], []]
  );
  check(
    'nested blocks give the arms outermost first',
    (() => {
      const source = '@if (a) {\n  @if (b) {\n    <i></i>\n  }\n}';
      const { i } = armsBy(source);
      return i.map(({ chainAt }) => chainAt);
    })(),
    [0, '@if (a) {\n  '.length]
  );

  // --- the sibling rule: must hit ---
  const siblingLines = (source, componentRepeated = false) =>
    scanSiblingLabels(source, componentRepeated).map((hit) => hit.line);
  const SIBLING = (key) => `<button mat-icon-button [attr.aria-label]="'${key}' | translate">x</button>`;
  check(
    'two controls of one template under one bare key, each in an @if of its own: the form\'s two dismissals',
    scanSiblingLabels(
      "@if (suggestedCurrency()) {\n  <button mat-icon-button [attr.aria-label]=\"'common.close' | translate\">\n" +
        '    <mat-icon>close</mat-icon>\n  </button>\n}\n<p>between</p>\n' +
        "@if (suggestedCoordinates()) {\n  <button mat-icon-button [attr.aria-label]=\"'common.close' | translate\">\n" +
        '    <mat-icon>close</mat-icon>\n  </button>\n}'
    ),
    [
      { line: 2, tag: 'button', key: 'common.close', beside: [8] },
      { line: 8, tag: 'button', key: 'common.close', beside: [2] },
    ]
  );
  check(
    'three in three @ifs of their own: the AI page\'s three removes',
    siblingLines(
      ['geminiApiKey', 'openaiApiKey', 'claudeApiKey']
        .map((field) => `@if (${field}()) {\n  ${SIBLING('common.remove')}\n}`)
        .join('\n')
    ),
    [2, 5, 8]
  );
  check(
    'a ternary key shares a key with a plain one when either branch is it',
    scanSiblingLabels(
      "<button [attr.aria-label]=\"(open() ? 'common.close' : 'common.open') | translate\">x</button>\n" + SIBLING('common.close')
    ),
    [
      { line: 1, tag: 'button', key: 'common.close : common.open', beside: [2] },
      { line: 2, tag: 'button', key: 'common.close', beside: [1] },
    ]
  );
  check(
    'two ternaries that share one branch',
    siblingLines(
      "<button [attr.aria-label]=\"(a ? 'x.on' : 'x.off') | translate\">x</button>\n" +
        "<button [attr.aria-label]=\"b ? ('y.on' | translate) : ('x.off' | translate)\">x</button>"
    ),
    [1, 2]
  );
  check('two outside every block', siblingLines(`${SIBLING('common.close')}\n${SIBLING('common.close')}`), [1, 2]);
  check(
    'one outside every block and one in an @if',
    siblingLines(`${SIBLING('common.close')}\n@if (open()) {\n  ${SIBLING('common.close')}\n}`),
    [1, 3]
  );
  check(
    'two in one arm of an @if',
    siblingLines(`@if (open()) {\n  ${SIBLING('common.close')}\n  ${SIBLING('common.close')}\n} @else {\n  <p>none</p>\n}`),
    [2, 3]
  );
  check(
    'an arm and an @if nested in that same arm',
    siblingLines(`@if (a) {\n  ${SIBLING('common.close')}\n  @if (b) {\n    ${SIBLING('common.close')}\n  }\n}`),
    [2, 4]
  );
  check(
    'an @if…@else pair beside a third control in an @if of its own: the pair is apart, each is beside the third',
    scanSiblingLabels(
      `@if (a) {\n  ${SIBLING('common.close')}\n} @else {\n  ${SIBLING('common.close')}\n}\n@if (b) {\n  ${SIBLING('common.close')}\n}`
    ).map(({ line, beside }) => [line, beside]),
    [
      [2, [7]],
      [4, [7]],
      [7, [2, 4]],
    ]
  );
  check(
    'a chain does not reach the next @if: two @if…@else chains, one control each in their first arms',
    siblingLines(
      `@if (a) {\n  ${SIBLING('common.close')}\n} @else {\n  <p>a</p>\n}\n@if (b) {\n  ${SIBLING('common.close')}\n} @else {\n  <p>b</p>\n}`
    ),
    [2, 7]
  );
  check(
    'the interpolated literal form beside the bound form',
    siblingLines(`<button aria-label="{{ 'common.close' | translate }}">x</button>\n${SIBLING('common.close')}`),
    [1, 2]
  );
  check(
    'two cases of a switch on the @for\'s own item, whose keys the per-item tally keeps apart, render on two cards at once',
    (() => {
      const source =
        "@for (card of cards(); track card) {\n  @switch (card) {\n    @case ('a') {\n      " + SIBLING('common.close') +
        "\n    }\n    @case ('b') {\n      <button [attr.aria-label]=\"(x ? 'common.close' : 'common.open') | translate\">x</button>\n" +
        '    }\n  }\n}';
      return [siblingLines(source), itemlessLines(source)];
    })(),
    [[4, 7], []]
  );

  // --- the sibling rule: must not hit ---
  check(
    'the two arms of one @if…@else',
    siblingLines(`@if (open()) {\n  ${SIBLING('common.close')}\n} @else {\n  ${SIBLING('common.close')}\n}`),
    []
  );
  check(
    'the three arms of an @if…@else if…@else',
    siblingLines(
      `@if (a) {\n  ${SIBLING('common.close')}\n} @else if (b) {\n  ${SIBLING('common.close')}\n} @else {\n  ${SIBLING('common.close')}\n}`
    ),
    []
  );
  check(
    'two @cases and the @default of a switch that is not on a @for item',
    siblingLines(
      `@switch (mode()) {\n  @case ('a') {\n    ${SIBLING('common.close')}\n  }\n  @case ('b') {\n    ${SIBLING('common.close')}\n  }\n` +
        `  @default {\n    ${SIBLING('common.close')}\n  }\n}`
    ),
    []
  );
  check(
    'a chain nested in one arm: its own two arms are apart',
    siblingLines(`@if (a) {\n  @if (b) {\n    ${SIBLING('common.close')}\n  } @else {\n    ${SIBLING('common.close')}\n  }\n}`),
    []
  );
  check(
    'an arm and an @if nested in the other arm are apart',
    siblingLines(`@if (a) {\n  ${SIBLING('common.close')}\n} @else {\n  @if (b) {\n    ${SIBLING('common.close')}\n  }\n}`),
    []
  );
  check(
    'an arm that closes after an element still hands its chain to the @else',
    siblingLines(
      `@if (a) {\n  <div class="row">\n    ${SIBLING('common.close')}\n  </div>\n} <!-- the other arm --> @else {\n  ${SIBLING('common.close')}\n}`
    ),
    []
  );
  check(
    'one repeated control is the per-item rule\'s, not this one\'s',
    [
      siblingLines(`@for (r of rows; track r.id) {\n  ${SIBLING('common.remove')}\n}`),
      itemlessLines(`@for (r of rows; track r.id) {\n  ${SIBLING('common.remove')}\n}`),
    ],
    [[], [2]]
  );
  check(
    'a repeated control beside one rendered once under its key: the per-item rule reports the repeated one',
    [
      siblingLines(`@for (r of rows; track r.id) {\n  ${SIBLING('common.remove')}\n}\n${SIBLING('common.remove')}`),
      itemlessLines(`@for (r of rows; track r.id) {\n  ${SIBLING('common.remove')}\n}\n${SIBLING('common.remove')}`),
    ],
    [[], [2]]
  );
  check(
    'two cases of a switch on the @for\'s own item under one key are the per-item rule\'s',
    (() => {
      const source =
        "@for (card of cards(); track card) {\n  @switch (card) {\n    @case ('a') {\n      " + SIBLING('common.viewAll') +
        "\n    }\n    @case ('b') {\n      " + SIBLING('common.viewAll') + '\n    }\n  }\n}';
      return [siblingLines(source), itemlessLines(source)];
    })(),
    [[], [4, 7]]
  );
  check(
    'controls of a component another template stamps per item are the per-item rule\'s',
    siblingLines(`${SIBLING('common.close')}\n${SIBLING('common.close')}`, true),
    []
  );
  check(
    'two text-named siblings: no rule reads them',
    siblingLines(
      "@if (a) {\n  <button mat-button>{{ 'common.close' | translate }}</button>\n}\n" +
        "@if (b) {\n  <button mat-button>{{ 'common.close' | translate }}</button>\n}"
    ),
    []
  );
  check(
    'a label-named control and a text-named one under one key: only label-named controls are read',
    siblingLines(`${SIBLING('common.close')}\n<button mat-button>{{ 'common.close' | translate }}</button>`),
    []
  );
  check(
    'a key with parameters on each: the AI page\'s removes, fixed',
    siblingLines(
      ['Gemini', 'OpenAI', 'Claude']
        .map(
          (provider) =>
            `@if (key${provider}()) {\n  <button [attr.aria-label]="'settings.removeApiKey' | translate: { provider: '${provider}' }">x</button>\n}`
        )
        .join('\n')
    ),
    []
  );
  check(
    'a key of its own on each: the form\'s two dismissals, fixed',
    siblingLines(
      `@if (a) {\n  ${SIBLING('transactions.dismissCurrencySuggestion')}\n}\n@if (b) {\n  ${SIBLING('transactions.dismissPositionSuggestion')}\n}`
    ),
    []
  );
  check(
    'a commented-out sibling is no sibling',
    siblingLines(`${SIBLING('common.close')}\n<!-- ${SIBLING('common.close')} -->`),
    []
  );

  // --- the sibling rule: the run's path ---
  // The run reads every template with the sixth rule's verdict first and hands
  // each template its share of it (scanItemlessAcross, scanSiblingsAcross).
  const siblingsAcross = (templates) => {
    const { hits, keys, apart } = scanItemlessAcross(templates);
    return {
      sibling: scanSiblingsAcross(templates, { keys, apart }).hits.map((hit) => hit.site),
      itemless: hits.map((hit) => hit.site),
    };
  };
  // Two controls under one key, each in an @if of its own: lines 2 and 5.
  const TWO_APART = `@if (a()) {\n  ${SIBLING('common.close')}\n}\n@if (b()) {\n  ${SIBLING('common.close')}\n}`;
  check(
    'a component another template stamps per item leaves its controls to the per-item rule, and one stamped once does not, through the run\'s path',
    [
      siblingsAcross([
        { key: 'list', selector: 'app-list', source: '@for (row of rows(); track row.id) {\n  <app-row />\n}', offset: 0 },
        { key: 'row', selector: 'app-row', source: TWO_APART, offset: 0 },
      ]),
      siblingsAcross([
        { key: 'page', selector: 'app-page', source: '<app-row />', offset: 0 },
        { key: 'row', selector: 'app-row', source: TWO_APART, offset: 0 },
      ]),
    ],
    [
      { sibling: [], itemless: ['row:2', 'row:5'] },
      { sibling: ['row:2', 'row:5'], itemless: [] },
    ]
  );
  check(
    'a key two cases of one held-apart switch reach through what they stamp is the per-item rule\'s, through the run\'s path',
    siblingsAcross([
      {
        key: 'dashboard',
        selector: 'app-dashboard',
        source:
          "@for (card of cards(); track card) {\n  @switch (card) {\n    @case ('a') {\n      <app-a />\n    }\n" +
          "    @case ('b') {\n      <app-b />\n    }\n  }\n}",
        offset: 0,
      },
      { key: 'a', selector: 'app-a', source: TWO_APART, offset: 0 },
      { key: 'b', selector: 'app-b', source: SIBLING('common.close'), offset: 0 },
    ]),
    { sibling: [], itemless: ['a:2', 'a:5', 'b:1'] }
  );
  {
    const templates = [{ key: 'inline', selector: 'app-inline', source: TWO_APART, offset: 10 }];
    const { keys, apart } = scanItemlessAcross(templates);
    check(
      'an inline template\'s hits, and the lines beside them, count from its file, through the run\'s path',
      scanSiblingsAcross(templates, { keys, apart }),
      {
        hits: [
          { site: 'inline:12', tag: 'button', key: 'common.close', beside: [15] },
          { site: 'inline:15', tag: 'button', key: 'common.close', beside: [12] },
        ],
        read: 2,
      }
    );
  }

  // --- the sibling rule: its hint ---
  const AI_PAGE_TEMPLATE = join(SOURCE_DIR, 'features/settings/ai-settings-page/ai-settings-page.component.html');
  check(
    'the sibling hint\'s model is a binding the AI page carries; if it left the AI page, update SIBLING_MODEL',
    existsSync(AI_PAGE_TEMPLATE) && readFileSync(AI_PAGE_TEMPLATE, 'utf8').includes(`[attr.aria-label]="${SIBLING_MODEL}"`),
    true
  );
  check(
    'the sibling hint names each control by what it acts on and quotes its model',
    [siblingHint().startsWith('name each by what it acts on'), siblingHint().includes(SIBLING_MODEL)],
    [true, true]
  );

  // --- the group rule: must hit ---
  const groupTags = (source) => scanUnnamedGroups(source).map((hit) => `${hit.line} ${hit.tag}`);
  check(
    'a single-choice toggle group with no name, its tag over several lines',
    groupTags('<div>\n  <mat-button-toggle-group\n    [(ngModel)]="selectedType"\n  >\n    <mat-button-toggle value="a">A</mat-button-toggle>\n  </mat-button-toggle-group>\n</div>'),
    ['2 mat-button-toggle-group']
  );
  check(
    'a radio group with no name',
    groupTags('<mat-radio-group [(ngModel)]="format">\n  <mat-radio-button value="csv">CSV</mat-radio-button>\n</mat-radio-group>'),
    ['1 mat-radio-group']
  );
  check('an element with a literal radiogroup role and no name', groupTags('<div role="radiogroup"><span role="radio">A</span></div>'), ['1 div']);
  check(
    'a blank aria-label or aria-labelledby names nothing',
    groupTags('<mat-button-toggle-group aria-label="">\n</mat-button-toggle-group>\n<mat-radio-group [attr.aria-labelledby]=" "></mat-radio-group>'),
    ['1 mat-button-toggle-group', '3 mat-radio-group']
  );
  check(
    'a literal multiple="false" or a [multiple] bound to false is single-choice',
    groupTags('<mat-button-toggle-group multiple="false"></mat-button-toggle-group>\n<mat-button-toggle-group [multiple]="false"></mat-button-toggle-group>'),
    ['1 mat-button-toggle-group', '2 mat-button-toggle-group']
  );
  check(
    'a group inside a block that may not render is read all the same',
    groupTags('@if (open()) {\n  <mat-button-toggle-group [value]="v()"></mat-button-toggle-group>\n}'),
    ['2 mat-button-toggle-group']
  );

  // --- the group rule: must not hit ---
  check(
    'a group named in any spelling, each landing on the host the role is on',
    groupTags(
      `<mat-button-toggle-group ${GROUP_MODEL}></mat-button-toggle-group>\n` +
        '<mat-button-toggle-group aria-labelledby="theme-label"></mat-button-toggle-group>\n' +
        '<mat-radio-group aria-label="Format"></mat-radio-group>\n' +
        `<mat-radio-group aria-label="{{ 'reports.format' | translate }}"></mat-radio-group>\n` +
        `<div role="radiogroup" [aria-label]="'dashboard.period' | translate"></div>\n` +
        '<div role="radiogroup" [attr.aria-labelledby]="labelId"></div>'
    ),
    []
  );
  check(
    'a multiple toggle group renders role="group" and is not read',
    groupTags('<mat-button-toggle-group multiple></mat-button-toggle-group>\n<mat-button-toggle-group [multiple]="many()"></mat-button-toggle-group>'),
    []
  );
  check(
    'a toggle, a radio button and other roles are not groups',
    groupTags('<mat-button-toggle value="a">A</mat-button-toggle>\n<mat-radio-button value="b">B</mat-radio-button>\n<div role="group"></div>'),
    []
  );
  check('a commented-out group is no group', groupTags('<!-- <mat-button-toggle-group></mat-button-toggle-group> -->'), []);

  // --- the group rule: its hint ---
  const CATEGORY_MANAGER_TEMPLATE = join(SOURCE_DIR, 'features/settings/category-manager/category-manager.component.html');
  check(
    'the group hint\'s model is a binding the category manager carries; if it left the category manager, update GROUP_MODEL',
    existsSync(CATEGORY_MANAGER_TEMPLATE) && readFileSync(CATEGORY_MANAGER_TEMPLATE, 'utf8').includes(GROUP_MODEL),
    true
  );
  check(
    'the group hint asks for a name that says what is chosen and quotes its model',
    [groupHint().startsWith('name the group with a key that says what it chooses'), groupHint().includes(GROUP_MODEL)],
    [true, true]
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!c.ok) {
      console.error(`       expected ${JSON.stringify(c.expected)}`);
      console.error(`       actual   ${JSON.stringify(c.actual)}`);
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} self-test failure(s) — the checker itself is broken.`);
    process.exit(1);
  }
  console.log(`check-icon-labels self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
