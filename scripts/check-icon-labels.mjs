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
 * any other key that names no item (only `common.moreActions` is known to be
 * item-less); a component stamped through `NgComponentOutlet`, a dialog or a
 * router outlet rather than by its selector; a repeat written as
 * `<ng-template ngFor>`; and a trigger with no `aria-label` at all, whose
 * name comes from its text.
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
 * `visit({ name, attrs, line, repeated })` for each. `repeated` is true when
 * the element is stamped once per item within this template: inside an
 * `@for` block, or on or under an element carrying a repeating structural
 * directive.
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
    });
    const selfClosing = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(name);
    if (!selfClosing) frames.push({ element: name, repeat });
  }
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
    const inline = /\btemplate:\s*`([\s\S]*?)`/.exec(source)?.[1];
    if (inline === undefined) continue;
    // A hit's line counts from the template's first line, the backtick's.
    const offset = lineOf(source, source.indexOf(inline)) - 1;
    templates.push({ key: posix(file), selector, source: inline, offset });
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

  if (findings.length > 0) {
    findings.sort((a, b) => a.site.localeCompare(b.site));
    const iconFindings = findings.filter((f) => f.rule === 'icon');
    const progressFindings = findings.filter((f) => f.rule === 'progress');
    const optionFindings = findings.filter((f) => f.rule === 'option');
    const menuFindings = findings.filter((f) => f.rule === 'menu');

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

    process.exit(1);
  }

  console.log(
    `Every named mat-icon carries a literal aria-hidden, every progress indicator ` +
      `carries a name or is hidden inside the control that already announces it, ` +
      `every option icon sits beside its option's name, and every repeated menu ` +
      `button names its item.`
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
