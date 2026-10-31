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
 * any other key that names no item on a trigger only its parent repeats (the
 * sixth rule below takes any key, in a template's own repeats); a component
 * stamped through `NgComponentOutlet`, a dialog or a router outlet rather than
 * by its selector; a repeat written as `<ng-template ngFor>`; and a trigger
 * with no `aria-label` at all, whose name comes from its text.
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
 * parameters gives every copy the same name. The upload area had that shape:
 * each file's row read "Move up", "Move down" and "Remove", and two photos
 * from an iPhone are both image.jpg, so neither the buttons nor the rows could
 * be told apart by ear. The rule: inside a repeat in its own template, a
 * control does not take its whole name from one key with no parameters,
 * bound (`[attr.aria-label]="'key' | translate"`) or interpolated
 * (`aria-label="{{ 'key' | translate }}"`).
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
 *   - **"Once per item" is read in the template only**: an `@for` block, or an
 *     element under a repeating structural directive, as the fourth rule reads
 *     it there. Its cross-template reading errs toward "repeated" — the
 *     dashboard renders each card once through an `@switch` in its `@for` — and
 *     here that would freeze controls that are not repeated at all.
 *   - **A menu trigger the fourth rule reports is reported there**, once.
 *   - **What it found and could not fix is frozen** in ITEMLESS_FROZEN, by
 *     file and key with how many controls carry that key there (ADR 0145's
 *     floor), the way check-i18n.mjs counts its English fallbacks. A hit no
 *     row names fails, and so does a row whose count is not the tally: one
 *     more control named by a frozen key, or one fixed and still on the
 *     books. An edit that only moves a frozen control leaves the list alone.
 *
 * What it cannot see: a name built in TypeScript; a ternary between two bare
 * keys; a control repeated only by its parent's repeat, such as the goal
 * card's edit and delete buttons, stamped once per goal by the goals page;
 * and a name that comes from `aria-labelledby` or from the control's text.
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
 * An eighth rule keeps a toggle from rendering a control with no name.
 * `mat-checkbox`, `mat-slide-toggle` and `mat-radio-button` each render the
 * control a screen reader lands on (an `<input>`, or a `role="switch"`
 * button) inside themselves, and name it from the text projected into their
 * own label or from their `aria-label` and `aria-labelledby` inputs. One with
 * neither is announced as a checkbox or a switch and nothing more. The import
 * review card's row checkbox had that shape, one per row, under a Select all
 * whose text named it. The rule: a toggle projects text, or carries
 * `aria-label` or `aria-labelledby` as a literal, an interpolation or a bound
 * input (`[aria-label]`, `[aria-labelledby]`).
 *
 *   - **`[attr.aria-label]` is not a name here.** It is written on the host,
 *     not on the control inside, which stays unnamed (Material's host
 *     bindings clear the host's own `aria-label` and `aria-labelledby`). The
 *     input binding is the spelling that reaches the control.
 *   - **A `mat-icon` is not text.** MatIcon hides itself, so its ligature
 *     names nothing, and a toggle whose only content is an icon is unnamed.
 *   - **A slider is read the other way round.** `mat-slider` takes no name
 *     input and forwards no attribute to its thumbs, so a name on its host
 *     reaches nothing and the `<input matSliderThumb>` stays unnamed. The
 *     rule: a slider that carries a name on its host carries one on each
 *     thumb. A slider named nowhere is not that shape and is not read.
 *   - **What it found and could not fix is frozen** in UNNAMED_FROZEN, in
 *     ITEMLESS_FROZEN's rows with the tag as the key, set against the hits by
 *     the same helper: a hit no row names fails, and so does a row whose
 *     count is not the tally.
 *
 * What it cannot see: a name set in TypeScript or by a directive's host
 * binding; text the toggle projects inside an element hidden from a screen
 * reader, which counts here and names nothing; text only one branch of a
 * block renders; and whether the text or the name says anything.
 *
 * Reference documentation lives in docs/accessibility.md.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
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

/**
 * Reads the control-flow syntax in one run of text between two tags, pushing
 * a frame onto `frames` for each block it opens and removing one for each `}`.
 * `@for` opens a repeating block; any other `@name … {` (`@if`, `@else`,
 * `@empty`, `@switch`, `@case`, `@defer`, …) a plain one. Interpolations are
 * blanked first, because their braces are expressions; Angular rejects a bare
 * `{`, `}` or `@` in text, so what remains is block syntax.
 */
function readBlocks(text, frames) {
  const plain = text.replace(/\{\{[\s\S]*?\}\}/g, (body) => ' '.repeat(body.length));
  let i = 0;
  while (i < plain.length) {
    if (plain[i] === '@') {
      const keyword = /^@(\w+)/.exec(plain.slice(i));
      if (!keyword) { i += 1; continue; }
      if (keyword[1] === 'let') {
        // `@let name = expression;` declares a value and opens nothing.
        const end = plain.indexOf(';', i);
        i = end < 0 ? plain.length : end + 1;
        continue;
      }
      // The header runs to the first `{` outside its parentheses.
      let depth = 0;
      let j = i + keyword[0].length;
      for (; j < plain.length; j++) {
        if (plain[j] === '(') depth++;
        else if (plain[j] === ')') depth--;
        else if (plain[j] === '{' && depth === 0) break;
      }
      if (j < plain.length) frames.push({ element: null, repeat: keyword[1] === 'for' });
      i = j + 1;
      continue;
    }
    if (plain[i] === '}') {
      for (let k = frames.length - 1; k >= 0; k--) {
        if (frames[k].element === null) {
          frames.splice(k, 1);
          break;
        }
      }
    }
    i += 1;
  }
}

/**
 * Walks a template's opening tags in order, calling
 * `visit({ name, attrs, line, repeated, inTemplate })` for each. `repeated` is
 * true when the element is stamped once per item within this template: inside
 * an `@for` block, or on or under an element carrying a repeating structural
 * directive. `inTemplate` is true when an `<ng-template>` is open around it.
 */
export function walkTemplate(source, visit) {
  const masked = maskComments(source);
  // Open elements and blocks, innermost last. An element frame carries its
  // tag name; a block frame carries null.
  const frames = [];
  const tag = new RegExp(ANY_TAG.source, 'g');
  let last = 0;
  let match;
  while ((match = tag.exec(masked)) !== null) {
    readBlocks(masked.slice(last, match.index), frames);
    last = tag.lastIndex;
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = frames.map((frame) => frame.element).lastIndexOf(name);
      if (at >= 0) frames.length = at;
      continue;
    }
    const repeat = REPEAT_DIRECTIVE.test(attrs);
    visit({
      name,
      attrs,
      line: lineOf(masked, match.index),
      repeated: repeat || frames.some((frame) => frame.repeat),
      inTemplate: frames.some((frame) => frame.element === 'ng-template'),
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

/** A literal label that is one interpolation of the same, and nothing else. */
const BARE_KEY_INTERPOLATED = /^\s*\{\{\s*(['"])([\w.-]+)\1\s*\|\s*translate\s*\}\}\s*$/;

/**
 * The key a tag's `aria-label` consists of when it is one catalog key with no
 * parameters, with the label's offset in `attrs`; null otherwise.
 */
function bareKeyLabel(attrs) {
  for (const label of attrs.matchAll(LABEL_ATTR)) {
    const shape = label[1].startsWith('[') ? BARE_KEY_BOUND : BARE_KEY_INTERPOLATED;
    const key = shape.exec(label[2] ?? label[3])?.[2];
    if (key) return { key, index: label.index };
  }
  return null;
}

/**
 * Every control stamped once per item in this template whose `aria-label` is
 * one catalog key with no parameters. `line` is the label's own line, which is
 * where a finding is reported. A menu trigger the fourth rule reports is left
 * to it. Returns `{ line, tag, key }` for each.
 */
export function scanItemlessLabels(source) {
  const hits = [];
  walkTemplate(source, ({ name, attrs, line, repeated }) => {
    if (!repeated) return;
    if (!CONTROL_TAGS.has(name) && !CONTROL_ROLE.test(attrs)) return;
    if (MENU_TRIGGER.test(attrs) && itemlessName(attrs)) return;
    const label = bareKeyLabel(attrs);
    if (!label) return;
    const before = attrs.slice(0, label.index);
    hits.push({ line: line + before.split('\n').length - 1, tag: name, key: label.key });
  });
  return hits;
}

/**
 * Per-item controls named by a key with no parameters that the sixth rule
 * found when it landed, outside what that change fixed. Each row is a file, a
 * key, how many controls in that file carry it, and what repeats them. Empty
 * is the goal: a row is a debt with a name, and it goes when its controls name
 * their item.
 */
export const ITEMLESS_FROZEN = [
  {
    file: 'src/app/features/about/about.component.html',
    key: 'about.feedback.deleteLabel',
    count: 1,
    why: 'one delete button per sent feedback entry on the About page',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.notADuplicate',
    count: 1,
    why: 'one per review card row marked as a possible duplicate',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'common.description',
    count: 1,
    why: 'each review card row\'s description field, while it is edited',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'common.amount',
    count: 1,
    why: 'each review card row\'s amount field, while it is edited',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.splitAmount',
    count: 1,
    why: 'each review card row\'s split amount field, while a split is edited',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.placeName',
    count: 1,
    why: 'each review card row\'s place field, while it is edited',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.removeLocation',
    count: 1,
    why: 'one per review card row that carries a place',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.dismissCurrencySuggestion',
    count: 1,
    why: 'one per review card row that carries a currency suggestion',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.newTag',
    count: 1,
    why: 'each review card row\'s new tag field, while a tag is added',
  },
  {
    file: 'src/app/features/ai/import/transaction-preview-table/transaction-preview-table.component.html',
    key: 'import.notes',
    count: 1,
    why: 'each review card row\'s notes field, where its notes are shown',
  },
  {
    file: 'src/app/features/ai/search-history/search-answer-history.component.html',
    key: 'common.delete',
    count: 1,
    why: 'one delete button per saved answer in the search history',
  },
  {
    file: 'src/app/features/budgets/goals/goal-form/goal-form.component.html',
    key: 'common.delete',
    count: 1,
    why: 'one delete button per item row on the goal form',
  },
  {
    file: 'src/app/features/reports/insights/recurring-list/recurring-list.component.html',
    key: 'insights.convertToRule',
    count: 1,
    why: 'one per recurring group in the insights list',
  },
  {
    file: 'src/app/features/reports/insights/recurring-list/recurring-list.component.html',
    key: 'insights.showTransactions',
    count: 1,
    why: 'one per recurring group in the insights list',
  },
  {
    file: 'src/app/features/transactions/camera-capture/camera-capture.component.html',
    key: 'common.moveUp',
    count: 1,
    why: 'one per captured photo in the camera capture',
  },
  {
    file: 'src/app/features/transactions/camera-capture/camera-capture.component.html',
    key: 'common.moveDown',
    count: 1,
    why: 'one per captured photo in the camera capture',
  },
  {
    file: 'src/app/features/transactions/camera-capture/camera-capture.component.html',
    key: 'common.remove',
    count: 1,
    why: 'one per captured photo in the camera capture',
  },
  {
    file: 'src/app/features/transactions/receipt-images/receipt-image-manager.component.html',
    key: 'receiptImages.removeAllImages',
    count: 1,
    why: 'one per transaction in the receipt image manager',
  },
  {
    file: 'src/app/features/transactions/receipt-images/receipt-image-manager.component.html',
    key: 'receiptImages.convertToNote',
    count: 1,
    why: 'one per image of a transaction in the receipt image manager',
  },
  {
    file: 'src/app/features/transactions/receipt-images/receipt-image-manager.component.html',
    key: 'receiptImages.removeImage',
    count: 1,
    why: 'one remove button per image of a transaction in the receipt image manager',
  },
  {
    file: 'src/app/features/transactions/transaction-filters/transaction-filters.component.html',
    key: 'transactions.removeSearch',
    count: 2,
    why: 'one remove button per saved search, and one per recent search, in the search suggestions',
  },
  {
    file: 'src/app/features/transactions/transaction-form/transaction-form.component.html',
    key: 'common.remove',
    count: 1,
    why: 'one per pending receipt photo on the transaction form',
  },
  {
    file: 'src/app/features/transactions/transaction-form/transaction-form.component.html',
    key: 'receiptImages.convertToNote',
    count: 1,
    why: 'one per stored receipt image on the transaction form',
  },
  {
    file: 'src/app/features/transactions/transaction-form/transaction-form.component.html',
    key: 'receiptImages.removeImage',
    count: 1,
    why: 'one remove button per stored receipt image on the transaction form',
  },
  {
    file: 'src/app/features/transactions/transaction-list/transaction-list.component.html',
    key: 'transactions.viewNote',
    count: 1,
    why: 'one per desktop table row that carries a note',
  },
  {
    file: 'src/app/features/transactions/transaction-list/transaction-list.component.html',
    key: 'transactions.viewReceipt',
    count: 1,
    why: 'one per desktop table row that carries a receipt',
  },
  {
    file: 'src/app/shared/components/ai-search-dialog/ai-search-dialog.component.html',
    key: 'common.delete',
    count: 1,
    why: 'one delete button per answer in the search dialog\'s history',
  },
];

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
 * The names a toggle hands to the control inside it: `aria-label` or
 * `aria-labelledby`, literal, interpolated or bound to the input
 * (`[aria-label]`, `[aria-labelledby]`), each with a value. `[attr.aria-label]`
 * and `[attr.aria-labelledby]` are not among them, since they land on the
 * host, and neither is any other spelling that ends in the name, such as
 * `bind-attr.aria-label`.
 */
const TOGGLE_NAMES = new Set(['aria-label', 'aria-labelledby', '[aria-label]', '[aria-labelledby]']);

const toggleNamed = (attrs) =>
  attributesOf(attrs).some(({ name, value }) => value !== undefined && TOGGLE_NAMES.has(name));

/** MatSlider's thumb input, in each of its three spellings. */
const SLIDER_THUMBS = new Set(['matSliderThumb', 'matSliderStartThumb', 'matSliderEndThumb']);

const isSliderThumb = (attrs) => attributesOf(attrs).some(({ name }) => SLIDER_THUMBS.has(name));

/**
 * Any spelling of `aria-label` or `aria-labelledby`, bound to the attribute
 * or not: on a slider's host and on a plain input each lands where written.
 */
const anyAriaName = (attrs) => attributesOf(attrs).some(({ name }) => name.includes('aria-label'));

/**
 * True when a run of template text between two tags renders text: an
 * interpolation, or anything left once control-flow syntax is taken out.
 */
function projectsText(run) {
  const plain = run
    .replace(/\{\{[\s\S]*?\}\}/g, ' x ')
    .replace(/@let\b[^;]*;/g, ' ')
    .replace(/@\w+[^{]*\{/g, ' ')
    .replace(/[{}]/g, ' ');
  return /\S/.test(plain);
}

/**
 * Every toggle that hands the control inside it no name, and every slider
 * whose name sits on its host while a thumb carries none. A toggle is named
 * by text projected into it, outside any `mat-icon`, or by one of TOGGLE_NAMES.
 * Returns `{ line, tag }` for each, `line` being the opening tag's.
 */
export function scanUnnamedToggles(source) {
  const masked = maskComments(source);
  const hits = [];
  const judge = (entry) => {
    if (entry.tag === 'mat-slider') {
      if (anyAriaName(entry.attrs) && entry.thumbs.some((thumb) => !anyAriaName(thumb))) {
        hits.push({ line: entry.line, tag: entry.tag });
      }
      return;
    }
    if (entry.text || toggleNamed(entry.attrs)) return;
    hits.push({ line: entry.line, tag: entry.tag });
  };
  // The toggle or slider being read, and how many icons are open inside it.
  let open = null;
  let icons = 0;
  const tag = new RegExp(ANY_TAG.source, 'g');
  let last = 0;
  let match;
  while ((match = tag.exec(masked)) !== null) {
    if (open !== null && icons === 0 && projectsText(masked.slice(last, match.index))) open.text = true;
    last = tag.lastIndex;
    const [, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    const selfClosing = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(name);
    if (open === null) {
      if (closing || !(TOGGLE_TAGS.has(name) || name === 'mat-slider')) continue;
      const entry = { tag: name, line: lineOf(masked, match.index), attrs, text: false, thumbs: [] };
      if (selfClosing) judge(entry);
      else open = entry;
      continue;
    }
    if (closing) {
      if (name === 'mat-icon' && icons > 0) icons--;
      if (name === open.tag) {
        judge(open);
        open = null;
        icons = 0;
      }
      continue;
    }
    if (name === 'mat-icon' && !selfClosing) icons++;
    if (open.tag === 'mat-slider' && isSliderThumb(attrs)) open.thumbs.push(attrs);
  }
  return hits;
}

/**
 * Toggles and sliders the eighth rule found unnamed when it landed, outside
 * what that change fixed. Rows as ITEMLESS_FROZEN's, read by againstFrozen,
 * the key being the tag; `why` says which control it is and where its name
 * went instead. Empty is the goal.
 */
export const UNNAMED_FROZEN = [
  {
    file: 'src/app/features/budgets/budget-form/budget-form.component.html',
    key: 'mat-slider',
    count: 1,
    why: 'the alert threshold slider: its aria-labelledby sits on the mat-slider host, and its thumb is named by nothing',
  },
  {
    file: 'src/app/features/settings/ai-settings-page/ai-settings-page.component.html',
    key: 'mat-slide-toggle',
    count: 1,
    why: 'the Auto sync switch on the AI page: its label is a sibling span the switch never references',
  },
];

/**
 * Which templates belong to a component rendered once per item somewhere.
 * `templates` is a list of `{ key, selector, source }`, `selector` being the
 * owning component's element selector or null. A template is repeated when
 * another stamps its selector inside a repeat, or uses it at all inside a
 * template that is itself repeated; the second clause runs to a fixed point,
 * so a card inside a repeated row is repeated too. Returns the set of keys.
 */
export function repeatedTemplates(templates) {
  const bySelector = new Map();
  for (const { key, selector } of templates) {
    if (!selector) continue;
    if (!bySelector.has(selector)) bySelector.set(selector, []);
    bySelector.get(selector).push(key);
  }
  const uses = templates.map(({ key, source }) => {
    const found = [];
    walkTemplate(source, ({ name, repeated }) => {
      if (bySelector.has(name)) found.push({ name, repeated });
    });
    return { key, found };
  });
  const repeated = new Set();
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

  // The per-item rule reads each template's own repeats, and sets what it
  // finds against the rows frozen when it landed.
  const itemless = [];
  for (const template of sources) {
    for (const hit of scanItemlessLabels(template.source)) {
      itemless.push({ site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, key: hit.key });
    }
  }
  const { fresh, drift } = againstFrozen(itemless, ITEMLESS_FROZEN);
  for (const hit of fresh) findings.push({ rule: 'itemless', site: hit.site, tag: hit.tag, key: hit.key });
  for (const row of drift) findings.push({ rule: 'itemless-drift', site: row.file, ...row });

  // The id rule reads each template whole, since a reference may come before
  // the element it names.
  let idReferences = 0;
  for (const template of sources) {
    idReferences += readIds(template.source).references.length;
    for (const hit of scanDanglingIds(template.source)) {
      findings.push({ rule: 'idref', site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, attr: hit.attr, id: hit.id });
    }
  }

  // The toggle rule reads what each toggle projects and each slider's
  // thumbs, and sets what it finds against the rows frozen when it landed.
  let toggles = 0;
  let sliders = 0;
  const unnamed = [];
  for (const template of sources) {
    if (!/<mat-(checkbox|slide-toggle|radio-button|slider)\b/.test(template.source)) continue;
    walkTemplate(template.source, ({ name }) => {
      if (TOGGLE_TAGS.has(name)) toggles++;
      else if (name === 'mat-slider') sliders++;
    });
    for (const hit of scanUnnamedToggles(template.source)) {
      unnamed.push({ site: `${template.key}:${hit.line + template.offset}`, tag: hit.tag, key: hit.tag });
    }
  }
  const toggleVerdict = againstFrozen(unnamed, UNNAMED_FROZEN);
  for (const hit of toggleVerdict.fresh) findings.push({ rule: 'unnamed', site: hit.site, tag: hit.tag });
  for (const row of toggleVerdict.drift) findings.push({ rule: 'unnamed-drift', site: row.file, ...row });

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
  console.log(
    `Checked the controls stamped once per item across ${sources.length} template(s): ` +
      `${itemless.length} take their name from a key with no parameters, ` +
      `${ITEMLESS_FROZEN.reduce((sum, row) => sum + row.count, 0)} frozen by name.`
  );
  console.log(
    `Checked ${idReferences} id(s) named by a literal aria-labelledby, aria-describedby, ` +
      `aria-controls, aria-owns or for across ${sources.length} template(s).`
  );
  console.log(
    `Checked ${toggles} checkbox, slide toggle and radio button tag(s) and ${sliders} slider(s) ` +
      `across ${sources.length} template(s): ${unnamed.length} hand their control no name, ` +
      `${UNNAMED_FROZEN.reduce((sum, row) => sum + row.count, 0)} frozen by name.`
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
    const idrefFindings = findings.filter((f) => f.rule === 'idref');
    const unnamedFindings = findings.filter((f) => f.rule === 'unnamed');
    const unnamedDriftFindings = findings.filter((f) => f.rule === 'unnamed-drift');

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
        console.error(`  ${finding.site}  <${finding.tag}> '${finding.key}' | translate`);
        console.error(`    → give the key a slot for the item and fill it, as 'import.removeFileLabel' | translate: { position: i + 1, name: file.name }\n`);
      }
      console.error(
        `A control stamped once per item takes its whole name from its aria-label,\n` +
          `and a key with no parameters gives every copy the same one: a screen\n` +
          `reader moving down the list hears the same button again and nothing that\n` +
          `says which item it acts on. Name the item through the key's parameters,\n` +
          `as the upload area's remove and move buttons do, with whatever tells two\n` +
          `items apart (two photos from an iPhone are both image.jpg, so those name\n` +
          `the file's place too). A site that cannot be fixed in the same change is\n` +
          `frozen in ITEMLESS_FROZEN with its reason (ADR 0145).\n` +
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
      console.error(`\n${unnamedFindings.length} toggle(s) or slider(s) leave the control inside them unnamed:\n`);
      for (const finding of unnamedFindings) {
        if (finding.tag === 'mat-slider') {
          console.error(`  ${finding.site}  <mat-slider> named on its host, a thumb named by nothing`);
          console.error(`    → put the aria-label or aria-labelledby on each <input matSliderThumb>\n`);
        } else {
          console.error(`  ${finding.site}  <${finding.tag}> with no text and no aria-label or aria-labelledby`);
          console.error(`    → project its label as text, or bind the [aria-label] input, as the review card's row checkbox does\n`);
        }
      }
      console.error(
        `mat-checkbox, mat-slide-toggle and mat-radio-button render the control a\n` +
          `screen reader lands on inside themselves, and name it from the text\n` +
          `projected into their own label or from their aria-label and\n` +
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
      console.error(`\n${unnamedDriftFindings.length} frozen unnamed-toggle row(s) no longer match their count:\n`);
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

    process.exit(1);
  }

  console.log(
    `Every named mat-icon carries a literal aria-hidden, every progress indicator ` +
      `carries a name or is hidden inside the control that already announces it, ` +
      `every option icon sits beside its option's name, every repeated menu ` +
      `button names its item, every tooltip icon takes focus, every control ` +
      `stamped once per item names its item or is frozen by name, every id ` +
      `a literal reference names is declared in its own template, and every ` +
      `checkbox, slide toggle, radio button and host-named slider names the ` +
      `control inside it or is frozen by name.`
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
    'a commented-out repeated trigger is not a trigger',
    menuLines(`<!-- @for (c of list; track c.id) { ${BARE}</button> } -->`),
    []
  );

  // --- the menu rule: which components are repeated ---
  const repeatedKeys = (templates) =>
    [...repeatedTemplates(templates.map(([key, selector, source]) => ({ key, selector, source })))].sort();

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
  const itemlessLines = (source) => scanItemlessLabels(source).map((hit) => hit.line);
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
    [{ line: 5, tag: 'button', key: 'common.moveUp' }]
  );
  check(
    'the interpolated literal form',
    itemlessLines(`@for (s of searches; track s.id) {\n  <button aria-label="{{ 'transactions.removeSearch' | translate }}">x</button>\n}`),
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

  // --- the per-item rule: must not hit (the load-bearing half) ---
  check(
    'a parameterised key names its item, the fixed upload area',
    itemlessLines(
      `@for (file of files(); track file; let i = $index) {\n  <button [attr.aria-label]="'import.removeFileLabel' | translate: { position: i + 1, name: file.name }">x</button>\n}`
    ),
    []
  );
  check(
    'a key computed from the item names it through the key',
    itemlessLines(`@for (icon of icons; track icon) {\n  <button [attr.aria-label]="iconNameKeys[icon] | translate">x</button>\n}`),
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
  const unnamedTags = (source) => scanUnnamedToggles(source).map((hit) => `${hit.line} ${hit.tag}`);

  check(
    'a bare checkbox, the review card\'s row checkbox spread over several lines',
    scanUnnamedToggles(
      '<div class="card-select">\n  <mat-checkbox\n    [checked]="row.selected"\n' +
        '    (change)="toggleSelection(row, $event.checked)"\n  ></mat-checkbox>\n</div>'
    ),
    [{ line: 2, tag: 'mat-checkbox' }]
  );
  check(
    'a bare slide toggle beside a span that names nothing, the AI page\'s Auto sync switch',
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
    'a slider named on its host and not on its thumb, the budget form\'s threshold',
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
  const inlineToggle =
    "@Component({\n  selector: 'app-switch',\n  template: `\n    <p>x</p>\n    <mat-slide-toggle [checked]=\"on\" />\n  `,\n})\n";
  const inlineSwitch = inlineTemplateOf(inlineToggle);
  check(
    'an inline template in a .ts file, reported at the file\'s line',
    scanUnnamedToggles(inlineSwitch.source).map((hit) => hit.line + inlineSwitch.offset),
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
    'text inside a block',
    unnamedTags('<mat-checkbox>\n  @if (name) {\n    <span>{{ name }}</span>\n  }\n</mat-checkbox>'),
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
  check('a slider named nowhere is not this shape', unnamedTags('<mat-slider>\n  <input matSliderThumb>\n</mat-slider>'), []);
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
    'every frozen toggle row names its file, its tag, a count and why',
    UNNAMED_FROZEN.filter(
      (r) =>
        !/^src\/app\/.+\.(html|ts)$/.test(r.file) ||
        !(TOGGLE_TAGS.has(r.key) || r.key === 'mat-slider') ||
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
