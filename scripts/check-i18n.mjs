#!/usr/bin/env node
/**
 * Checks that every user-facing string reaches the translation catalog.
 *
 * TranslationService.t() returns the key itself when a lookup misses, and
 * loading a locale replaces the whole dictionary, so there is no fallback to
 * English: a missing key renders as raw text like `import.noTransactions` —
 * silent in tests, visible in the UI. Six scans:
 *
 *   1. Every statically-written translation key must resolve in every locale.
 *      `t(` calls are read with a balanced-argument walk over the whole file,
 *      not a per-line regex: a call whose first argument is a ternary or
 *      starts on the next line is seen too (#260 shipped through the old
 *      line-by-line pattern). A literal counts as a key only when it is
 *      dot-namespaced, so comparison literals inside the ternary condition
 *      (`filters.type === 'expense' ? …`) are not mistaken for keys.
 *   2. A catalog leaf may be a plural object — members drawn from the CLDR
 *      cardinal categories, string values (#272). Only en.json carries
 *      members; ja and tc need no number agreement and stay plain strings.
 *      flatten() records the bare path either way, so the key sets stay
 *      comparable across shapes.
 *   3. A template must not hard-code `aria-label="…"` or `alt="…"` text:
 *      screen-reader users would hear English on every locale, and nothing
 *      else notices (#273). The bound forms pass — `[attr.aria-label]="'…'
 *      | translate"` (the convention), `[aria-label]="expr"`, `[alt]="'…'
 *      | translate"`, and `aria-label="{{ … }}"` / `alt="{{ … }}"`.
 *   4. A template must not hard-code a visible English sentence as a TEXT
 *      NODE either — the same defect as 3 one position over, and the one a
 *      reader sees rather than hears. Two or more words in a row fails.
 *   5. Code must not fall back to an English word: a string literal whose
 *      whole content is `Unknown`, `Other` or `User`, in non-spec src/app
 *      (core/services/testing/ skipped). A missing category read `Unknown`
 *      on every locale until #497; the fallback is common.unknownCategory.
 *      A missing display name read `User` the same way until #500; an
 *      account that names nobody stores '' and every display reads a
 *      catalog word through person-name.utils (common.unnamedAccount,
 *      household.unnamedMember, or the plain common.welcome). The match is
 *      case-sensitive, so a chat message's `role: 'user'` is not a hit.
 *      `.ts` files are lexed with a regex-aware lexer copied from
 *      check-colors.mjs, so a comment never counts, and their inline
 *      `template:` strings are read the way scan 4 reads them. A word only
 *      a model reads, or one stored on the row, sits in one of two tables
 *      passed into fallbackFindings (ADR 0151), matched on file and text and
 *      tallied per row: a count that moves either way fails.
 *   6. The Home Screen widget names the app in the device's language from
 *      its own string tables, which the web catalogs never reach:
 *      ios/App/HomeAccountWidget/<language>.lproj/Localizable.strings, one
 *      per NATIVE_TABLES row (en for en, ja for ja, zh-Hant for tc). The
 *      gallery name was English on every device until #441. Each table is
 *      read by a strict parser and must hold the en table's keys, each a
 *      catalog key whose value is the catalog's string, word for word. The
 *      tables must also be wired in project.pbxproj (a Localizable.strings
 *      variant group copied by the widget target's Resources phase, a table
 *      per language, each language in knownRegions), or the build never
 *      copies them. And the widget's Swift must not show a literal of its
 *      own: a string literal first after `Text(`, `Label(`,
 *      `LocalizedStringKey(`, `NSLocalizedString(`, `String(localized:`,
 *      `.configurationDisplayName(`, `.description(`, `.accessibilityLabel(`
 *      or a `LocalizedStringKey` declared with `{` or `=` fails unless it is
 *      a key of the en table; an interpolated literal or `Text(verbatim:)`
 *      fails either way. A type head needs an identifier boundary, so
 *      `UILabel(` and `RichText(` are not heads. Comments are masked with a
 *      Swift lexer (nested block comments, raw strings, interpolation).
 *
 * Beside the six, one more template check, which has no number: a
 * translated fragment must not be joined to a value by a comma.
 * `{{ 'common.welcome' | translate }}, {{ userName() }}` is a sentence only
 * English can punctuate: the comma sits in the template where no locale can
 * change it, while ja writes `、` and puts a suffix after the name and tc
 * writes `，`. The sentence is one key with a placeholder
 * (common.welcomeNamed). A translated interpolation followed by `,` or `、`
 * and then another interpolation fails (#500); `.ts` files are read through
 * their inline `template:` strings, comments are masked, and the line
 * reported is the comma's own.
 *
 * Key-set parity between locales is asserted in translation-keys.spec.ts,
 * which runs with the unit suite. Only literal keys can be checked; dynamic
 * keys (`'prefix.' + value | translate`, `t(chip.labelKey)`) are skipped and
 * counted in the summary. A commented-out call still counts as a reference —
 * that errs toward requiring keys that exist, never toward missing one.
 *
 * The text-node scan (4) needs masking scans 1 to 3 do not (scan 5 shares
 * two pieces of it, the inline-template reader and the comment masker, as
 * its bullet says, and lexes .ts code itself), and the decisions behind it
 * each have a cheaper alternative that is worse:
 *
 *   - `<mat-icon>` bodies are skipped whole. A Material ligature is markup,
 *     not prose, and `error_outline` or `arrow_drop_down` is two `[A-Za-z]{2,}`
 *     runs — 411 of them across 86 templates, which is this rule's entire
 *     false-positive surface. Skipping them needs a tag-name notion no other
 *     script under scripts/ has, and that cost is what buys the rule.
 *   - `{{ … }}` bodies are BLANKED, not skipped. A node is routinely mixed
 *     content — `{{ count }} of {{ total }} rows` — so stepping over the
 *     interpolation and reading the rest is the only way to see the English
 *     between two of them; blanking in place also keeps every line number.
 *   - Control-flow block headers are blanked too. `@if (isLoading()) {` and
 *     `@for (row of rows(); track row.id) {` sit in text position, so without
 *     this every such block reads as a two-word English sentence.
 *   - Comments are masked with maskHtmlComments — the `<!-- -->` flavour,
 *     copied in from check-direction.mjs, because the SCSS/TS masker would
 *     read the `//` in an href as a line comment. This file masked nothing
 *     before, deliberately: a commented-out `t()` call still counts as a
 *     reference, which errs toward keys existing. A commented-out sentence
 *     is the opposite case and must not fail.
 *   - The proper-noun allowlist is matched on the node's exact text AND its
 *     file, not on a line number. Line numbers rot on the first edit above
 *     them; the text is what was decided about. A seventh row is a
 *     deliberate edit here, and a row matching nothing fails.
 *   - Inline `template:` strings in `.ts` files are scanned too. ADR 0058's
 *     own "Things that only became apparent" records that its HTML sweep
 *     missed insight-transaction-list.component.ts for exactly this reason.
 *
 * What the text-node scan deliberately cannot see:
 *   - A single English word. `Save` alone is indistinguishable from a
 *     product name, an icon ligature that escaped the skip, or a unit; two
 *     words in a row is the cheapest rule with no false positives in this
 *     tree.
 *   - English reaching the DOM from TypeScript — a signal holding a
 *     sentence, `innerHTML`, a `MatSnackBar` message. Those are `t()` call
 *     sites, which scan 1 covers only when the key is literal.
 *   - `src/index.html`. It is outside src/app and its prose renders before
 *     Angular boots, so a translate pipe is impossible there.
 *   - An attribute that is visible without being aria-label or alt:
 *     `placeholder`, `title`, `matTooltip`. Scan 3's shape would extend to
 *     them; this one is about text nodes.
 *
 * What the fallback scan (5) deliberately cannot see:
 *   - Prose that starts with the word: `'Unknown error'`. Only a literal
 *     that is the word alone matches, which also keeps prompt text such as
 *     the receipt prompt's `merchant="Unknown"` default out, and keys like
 *     `settings.platformUnknown`.
 *   - Another English word for nobody: lowercase `user`, `Guest`,
 *     `Anonymous`, `Member`. The scan knows three words, the two a missing
 *     category produced and the one a missing name produced; the match is
 *     case-sensitive, which is also what keeps `role: 'user'` out.
 *   - A word built from a constant: `const UNKNOWN = 'Unknown'` fails where
 *     it is declared, but `'Unk' + 'nown'`, or a word read from data, does
 *     not stand whole in any literal.
 *   - `'Unknown Merchant'`, a two-word default of the same kind.
 *   - A single word in a template's text node (`@else { Unknown }`), which
 *     is not a literal and which scan 4 leaves to review.
 *   - A quoted word inside markup held in a TypeScript string that is not
 *     an inline `template:`: only inline templates take the quoted-word path.
 *
 * What the comma-join check deliberately cannot see:
 *   - A colon. `label: value` is accepted by decision (the about page, the
 *     profile example, the import errors and the budget alert write it in ja
 *     and tc), so a translated label, `:` and a value passes.
 *   - A joiner other than `,` and `、`: the full-width `，` and a dash pass.
 *   - A join with a word between, `{{ 'x' | translate }} and {{ y }}`, which
 *     is not this shape (scan 4 reads the word if it is English), and a comma
 *     that ends the element before the value begins.
 *   - A sentence assembled in code: `t('a.b') + ', ' + name`, or a template
 *     literal. Only template interpolations are read.
 *
 * What the widget scan (6) deliberately cannot see:
 *   - A word that is not a literal: `Text(labels.net)` shows a string the
 *     app wrote into the snapshot already translated (docs/widget.md), and
 *     a `LocalizedStringKey` held in a variable is read where it is declared.
 *   - A head the list does not name: `Button("…")`, `Toggle`,
 *     `.navigationTitle`, a function declared `-> LocalizedStringKey`.
 *   - A literal that is not the first thing after its head: a conditional
 *     of literals, `Text(isLocked ? "Locked" : "Signed out")`, an optional
 *     key, `let name: LocalizedStringKey? = "Home"`, and
 *     `LocalizedStringKey(stringLiteral: "Home")`.
 *   - Swift outside the top level of the widget's folder: a subfolder of it,
 *     the Share Extension and the app's own shell, and an Info.plist display
 *     name (InfoPlist.strings).
 *   - Which group holds the variant group: the wiring check reads the
 *     Resources phase, the tables and knownRegions. A variant group under
 *     another group points its tables at the wrong folder, which the build
 *     reports, not this scan.
 *   - A device language no table names: zh-Hans reads the en table.
 *   - A catalog placeholder: a `{{name}}` copied into a table is equal to
 *     the catalog and iOS shows it as written; the widget's one key has none.
 *
 * `--self-test` exercises the parser against known shapes and exits non-zero
 * if the checker itself is broken; npm's i18n:check chains it first, as
 * prompts:check does. Reference documentation lives in docs/i18n.md.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const LOCALES = ['en', 'ja', 'tc'];
const I18N_DIR = 'src/assets/i18n';
const SOURCE_DIR = 'src/app';

/** `'some.key' | translate` inside a template. */
const PIPE_KEY = /'([A-Za-z0-9_.]+)'\s*\|\s*translate/g;
/** A `| translate` whose left side is not a single quoted literal. */
const DYNAMIC_PIPE = /\|\s*translate/g;
/**
 * A literal `aria-label="…"` attribute. The bound forms never match: in
 * `[attr.aria-label]=` and `[aria-label]=` the name is followed by `]`, not
 * `=`, and the lookbehind keeps suffixed names (`data-aria-label`) out. The
 * lookahead exempts `aria-label="{{ … }}"`. (`aria-labelledby` never matches:
 * its name continues past `label`.)
 */
const STATIC_ARIA = /(?<![\w.[-])aria-label\s*=\s*"(?!\{\{)([^"]*)"/g;
/** A literal `alt="…"` attribute — same shape as STATIC_ARIA, and read for
 * the same reason: an `<img>`'s alt text reaches a screen reader exactly
 * like aria-label does. */
const STATIC_ALT = /(?<![\w.[-])alt\s*=\s*"(?!\{\{)([^"]+)"/g;

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** Two or more words in a row is prose; one is a name, a unit or a ligature. */
const WORD = /[A-Za-z]{2,}/g;
const MIN_WORDS = 2;

/**
 * Text nodes that are allowed to be English, by their exact text and the
 * file they stand in. Every row is a proper noun — a product this app talks
 * to, or a file format — which is written the same way in every locale, so
 * putting it in the catalog would mean maintaining three identical copies of
 * a brand name. Matched on text rather than line number: a line number rots
 * on the first edit above it, while the text is what was decided about.
 */
const PROPER_NOUNS = [
  {
    file: 'src/app/features/about/about.component.html',
    text: 'Angular Material',
    reason: 'the framework the app is built on, named in the credits',
  },
  {
    file: 'src/app/features/about/about.component.html',
    text: 'Google Gemini AI',
    reason: 'a vendor named in the credits',
  },
  {
    file: 'src/app/features/settings/ai-settings-page/ai-settings-page.component.html',
    text: 'Google Gemini',
    reason: "the provider card's own name",
  },
  {
    file: 'src/app/features/settings/ai-settings-page/ai-settings-page.component.html',
    text: 'OpenAI (ChatGPT)',
    reason: "the provider card's own name",
  },
  {
    file: 'src/app/features/settings/ai-settings-page/ai-settings-page.component.html',
    text: 'Anthropic Claude',
    reason: "the provider card's own name",
  },
  {
    file: 'src/app/features/ai/import/file-dropzone/file-dropzone.component.html',
    text: 'PNG, JPG',
    reason: 'file-format names; the surrounding hint is already a catalog key',
  },
];

/** A leaf may be a plural object: every key a CLDR category, every value a string. */
function isPluralObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every(key => PLURAL_CATEGORIES.has(key)) &&
    Object.values(value).every(member => typeof member === 'string')
  );
}

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child) && !isPluralObject(child)) {
      flatten(child, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

/**
 * Collects the keys named in the first argument of every `t(` call in a file.
 *
 * Walks the characters of the first argument — to the first top-level comma
 * or the balanced close — tracking paren depth and quote state, and gathers
 * every quoted literal shaped like a key (charset [A-Za-z0-9_.], at least one
 * dot). A first argument that yields no key-shaped literal (an identifier, a
 * template literal, `t(chip.labelKey)`) is dynamic: counted, not failed.
 * A call left unbalanced at end-of-file is ignored.
 */
function extractTCallKeys(text) {
  const keys = [];
  let dynamicCount = 0;
  const T_OPEN = /\bt\(/g;
  let open;
  while ((open = T_OPEN.exec(text)) !== null) {
    const literals = [];
    let depth = 1;
    let quote = null;
    let ended = false;
    let i = open.index + open[0].length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote.ch) {
          if (quote.ch !== '`') literals.push(text.slice(quote.start, i));
          quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = { ch, start: i + 1 }; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { ended = true; break; } }
      else if (ch === ',' && depth === 1) { ended = true; break; }
    }
    if (!ended) continue;
    const keyShaped = literals.filter(l => /^[A-Za-z0-9_.]+$/.test(l) && l.includes('.'));
    if (keyShaped.length > 0) {
      for (const key of keyShaped) keys.push({ key, index: open.index });
    } else {
      dynamicCount++;
    }
  }
  return { keys, dynamicCount };
}

/** Literal offences of a static-attribute regex, with their character index. */
function findStaticAttrOffences(text, regex) {
  const offences = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    offences.push({ index: match.index, value: match[1] });
  }
  return offences;
}

function findStaticAriaLabels(text) {
  return findStaticAttrOffences(text, STATIC_ARIA);
}

function findStaticAltTexts(text) {
  return findStaticAttrOffences(text, STATIC_ALT);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Blanks `<!-- -->` comments while preserving every byte offset, so a line
 * number taken from the masked text still points at the real line. Copied in
 * from check-direction.mjs — each gate script stays runnable on its own, and
 * running the SCSS/TS masker over markup would read the `//` in an href as a
 * line comment and blank the rest of the attribute.
 */
export function maskHtmlComments(source) {
  const out = source.split('');
  let i = 0;
  let inComment = false;
  while (i < source.length) {
    if (!inComment && source.startsWith('<!--', i)) {
      inComment = true;
      for (let k = i; k < i + 4; k += 1) out[k] = ' ';
      i += 4;
      continue;
    }
    if (inComment && source.startsWith('-->', i)) {
      inComment = false;
      for (let k = i; k < i + 3; k += 1) out[k] = ' ';
      i += 3;
      continue;
    }
    if (inComment && source[i] !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

/** Spaces over `[from, to)`, newlines kept so offsets and lines both survive. */
function blankRange(out, from, to) {
  for (let k = Math.max(0, from); k < Math.min(to, out.length); k += 1) {
    if (out[k] !== '\n') out[k] = ' ';
  }
}

/**
 * Everything in a template that is markup wearing the clothes of prose:
 * interpolation bodies, control-flow block headers, HTML entities and
 * `<mat-icon>` ligature bodies. Blanked rather than removed, so a line
 * number still means what it says.
 */
export function maskTemplateNoise(source) {
  const out = source.split('');

  let text = out.join('');
  for (let i = 0; i < text.length - 1; i += 1) {
    if (text[i] === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      blankRange(out, i, end === -1 ? text.length : end + 2);
    }
  }

  const blankEvery = pattern => {
    const current = out.join('');
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(current)) !== null) {
      blankRange(out, match.index, match.index + match[0].length);
      if (match[0] === '') pattern.lastIndex += 1;
    }
  };

  // `@if (…) {`, `@for (… ; track …) {`, `@else if (…) {`, `@empty {` — all
  // of which stand in text position and read as two English words.
  blankEvery(/@[A-Za-z]+[^{}]*\{/g);
  blankEvery(/&[A-Za-z#0-9]+;/g);

  text = out.join('');
  const openIcon = /<mat-icon\b[^>]*>/g;
  let match;
  while ((match = openIcon.exec(text)) !== null) {
    const bodyStart = match.index + match[0].length;
    const close = text.indexOf('</mat-icon>', bodyStart);
    if (close !== -1) blankRange(out, bodyStart, close);
  }

  return out.join('');
}

/**
 * The text nodes of a masked template, as `{ line, text }`.
 *
 * Tag skipping tracks quote state, because an attribute value routinely
 * holds a `>` — `[class.up]="row.change >= 0"` — and stopping at the first
 * one would spill the rest of the attribute into text position.
 */
export function textNodes(masked) {
  const nodes = [];
  let i = 0;
  let line = 1;
  let buffer = '';
  let bufferLine = 1;

  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '<') {
      if (buffer.trim() !== '') nodes.push({ line: bufferLine, text: buffer.trim() });
      buffer = '';
      let j = i + 1;
      let quote = null;
      while (j < masked.length) {
        const inner = masked[j];
        if (quote !== null) {
          if (inner === quote) quote = null;
        } else if (inner === '"' || inner === "'") quote = inner;
        else if (inner === '>') break;
        j += 1;
      }
      line += (masked.slice(i, Math.min(j + 1, masked.length)).match(/\n/g) ?? []).length;
      i = j + 1;
      bufferLine = line;
      continue;
    }
    if (ch === '\n') {
      line += 1;
      if (buffer.trim() === '') bufferLine = line;
    }
    buffer += ch;
    i += 1;
  }
  if (buffer.trim() !== '') nodes.push({ line: bufferLine, text: buffer.trim() });

  return nodes;
}

/** Text nodes of `source` carrying two or more English words. */
export function findVisibleEnglish(source) {
  return textNodes(maskTemplateNoise(maskHtmlComments(source))).filter(
    node => (node.text.match(WORD) ?? []).length >= MIN_WORDS
  );
}

/** An interpolation body that runs a value through the translate pipe. */
const TRANSLATED_BODY = /\|\s*translate\b/;
/**
 * What follows a closing `}}` when the next interpolation is joined to it: a
 * comma (`,` or the ideographic `、`), then only whitespace, then `{{`. Sticky,
 * so it is tried at one offset and never searches ahead into other markup.
 */
const COMMA_JOIN_TAIL = /\s*([,、])\s*\{\{/y;

/**
 * Every `{{ 'key' | translate }}` that a comma joins to the interpolation
 * after it, as `{ line, text }`: `{{ 'common.welcome' | translate }}, {{ name }}`.
 * A fragment of a sentence written in the template cannot be reordered or
 * repunctuated by a locale, and the comma it ends on is the English one; the
 * sentence belongs in one key with a placeholder. Read on the comment-masked
 * markup (offsets kept, so the line is the comma's own line).
 */
export function findCommaJoins(source) {
  const text = maskHtmlComments(source);
  const joins = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf('{{', from);
    if (open === -1) break;
    const close = text.indexOf('}}', open + 2);
    if (close === -1) break;
    from = close + 2;
    if (!TRANSLATED_BODY.test(text.slice(open + 2, close))) continue;
    COMMA_JOIN_TAIL.lastIndex = from;
    const tail = COMMA_JOIN_TAIL.exec(text);
    if (tail === null) continue;
    const comma = tail.index + tail[0].indexOf(tail[1]);
    joins.push({ line: lineOf(text, comma), text: text.slice(open, comma + 1).replace(/\s+/g, ' ') });
  }
  return joins;
}

/**
 * `source` with everything outside an inline `template:` literal blanked, so
 * the markup scanners can read a `.ts` file exactly as they read a `.html`
 * one and report the real line. Escapes are skipped; a `${}` substitution
 * holding a backtick is not handled and does not appear in this tree.
 */
export function inlineTemplatesOnly(source) {
  const out = source.split('').map(ch => (ch === '\n' ? '\n' : ' '));
  const opener = /template:\s*(['"`])/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    const quote = match[1];
    const start = match.index + match[0].length;
    let i = start;
    for (; i < source.length; i += 1) {
      if (source[i] === '\\') { i += 1; continue; }
      if (source[i] === quote) break;
    }
    for (let k = start; k < i && k < source.length; k += 1) out[k] = source[k];
    opener.lastIndex = i + 1;
  }
  return out.join('');
}

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
  'else', 'yield', 'await',
]);

/**
 * TypeScript, lexed far enough to know what is a string: comments blanked
 * with offsets kept, and the [start, end) of every top-level string literal's
 * contents. Unlike maskComments it knows a regex literal — `/['"]/` would
 * otherwise open a string, and the comment after it would read as code — and
 * a template literal's `${…}`, whose own strings belong to the template.
 * (Copied from check-colors.mjs; each gate script stays runnable on its own.)
 *
 * The copy differs in one place: a string inside a `${…}` substitution is
 * recorded too, alongside the template around it. check-colors reads a
 * template's text whole, so the substitution's strings stay with it there;
 * here a fallback is a literal of its own, and `${name ?? 'Unknown'}` puts
 * the word in front of a reader exactly as a bare `'Unknown'` does.
 */
export function lexTs(source) {
  const out = source.split('');
  const strings = [];
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };

  const regexAllowed = () => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    if (k < 0) return true;
    if (/[\w$]/.test(out[k])) {
      let s = k;
      while (s > 0 && /[\w$]/.test(out[s - 1])) s -= 1;
      return REGEX_KEYWORDS.has(out.slice(s, k + 1).join(''));
    }
    return !/[)\]'"`]/.test(out[k]);
  };

  const readQuoted = (quote, record) => {
    const start = i + 1;
    i += 1;
    while (i < source.length && source[i] !== quote && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
    if (record) strings.push([start, Math.min(i, source.length)]);
    if (source[i] === quote) i += 1;
  };

  const readRegex = () => {
    const start = i;
    let inClass = false;
    i += 1;
    while (i < source.length) {
      const c = source[i];
      if (c === '\n') { i = start + 1; return; } // a division after all
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i += 1;
        while (/[a-z]/i.test(source[i] ?? '')) i += 1;
        return;
      }
      i += 1;
    }
  };

  // Declarations, not arrows: a template's `${…}` is code, and code holds templates.
  function readTemplate(record) {
    const start = i + 1;
    i += 1;
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') { i += 2; continue; }
      // check-colors passes `false` here: see the doc comment for why this copy records.
      if (source[i] === '$' && source[i + 1] === '{') { i += 2; readCode(true, record); continue; }
      i += 1;
    }
    if (record) strings.push([start, Math.min(i, source.length)]);
    i += 1;
  }

  function readCode(untilBrace, record) {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      const next = source[i + 1];
      if (c === '/' && next === '/') {
        const s = i;
        while (i < source.length && source[i] !== '\n') i += 1;
        blank(s, i);
        continue;
      }
      if (c === '/' && next === '*') {
        const s = i;
        const e = source.indexOf('*/', i + 2);
        i = e === -1 ? source.length : e + 2;
        blank(s, i);
        continue;
      }
      if (c === "'" || c === '"') { readQuoted(c, record); continue; }
      if (c === '`') { readTemplate(record); continue; }
      if (c === '/' && regexAllowed()) { readRegex(); continue; }
      if (untilBrace) {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (depth === 0) { i += 1; return; }
          depth -= 1;
        }
      }
      i += 1;
    }
  }

  readCode(false, true);
  return { masked: out.join(''), strings };
}

/**
 * A string literal's whole content, when that content is a fallback word.
 * `User` is the word a missing display name fell back to (#500); like the
 * others it is case-sensitive, which keeps the providers' `role: 'user'` out.
 */
const FALLBACK_WORD = /^(?:Unknown|Other|User)$/;
/** The same, quoted, in markup: an interpolation or bound attribute's literal. */
const QUOTED_FALLBACK = /(['"`])(Unknown|Other|User)\1/g;

/**
 * Code that stores or sends an English fallback word, by the file and the
 * trimmed text of its line, and how many hits (fallback literals) the file's
 * lines of that text hold: a line with two literals counts 2.
 * Matched on text, never line number, for the PROPER_NOUNS reason. These are
 * not a freeze (ADR 0151): nothing here is waiting to be fixed, and a count
 * that moves either way fails.
 *
 * MODEL_FACING_FALLBACKS name a missing category inside a prompt: the model
 * reads the word, and no screen or export shows it.
 */
export const MODEL_FACING_FALLBACKS = [
  {
    file: 'src/app/core/services/nl-search.service.ts',
    text: "return category?.name ? this.translationService.t(category.name) : 'Other';",
    count: 1,
    reason: "a child's missing parent in the search prompt's category list (\"Other / Groceries\"); the model reads it",
  },
  {
    file: 'src/app/core/services/rag-context.service.ts',
    text: "return category?.name ? this.translationService.t(category.name) : 'Other';",
    count: 1,
    reason: 'a missing category in the spending context handed to the model; the model reads it',
  },
  {
    file: 'src/app/core/services/cloud-llm-provider.base.ts',
    text: "return name ? this.translationService.t(name) : 'Other';",
    count: 1,
    reason: "translateCategoryName's answer for a nameless category, which goes into a prompt; the model reads it",
  },
];

/**
 * STORED_FALLBACKS are written onto a row when a parse finds no text: the
 * word becomes the row's own data, as a typed one would. Screens and exports
 * show the stored text as it is; the owner chose to keep these words.
 */
export const STORED_FALLBACKS = [
  {
    file: 'src/app/core/services/ai-import.service.ts',
    text: "description: t['description'] as string || 'Unknown',",
    count: 1,
    reason: "a JSON import row's description when the file has none; stored on the row, kept by the owner's decision of 2026-10-15",
  },
  {
    file: 'src/app/core/services/cloud-llm-provider.base.ts',
    text: "merchant: parsed.merchant || 'Unknown',",
    count: 1,
    reason: "a scanned receipt's merchant when the model reads none; stored on the row, kept by the owner's decision of 2026-10-15",
  },
  {
    file: 'src/app/core/services/cloud-llm-provider.base.ts',
    text: "description: t.description || 'Unknown',",
    count: 2,
    reason: "a statement or multi-photo row's description when the model reads none; stored on the row, kept by the owner's decision of 2026-10-15",
  },
  {
    file: 'src/app/core/services/gemini.service.ts',
    text: "description: t.description || 'Unknown',",
    count: 1,
    reason: "a row itemized from a single receipt photo when the model reads no description; stored on the row, kept by the owner's decision of 2026-10-15",
  },
  {
    file: 'src/app/core/services/export.service.ts',
    text: "description: values[descCol] || 'Unknown',",
    count: 1,
    reason: "a CSV import row's description when its cell is empty; stored on the row, kept by the owner's decision of 2026-10-15",
  },
];

/**
 * Every string literal in `source` whose whole content is `Unknown`,
 * `Other` or `User`, as `{ line, word, text }` with `text` the trimmed line.
 * `kind` is `'ts'` or `'html'`. A `.ts` file is lexed for its literals and
 * also read through the markup path for its inline `template:` strings
 * (offsets kept, so the line is real); a literal both paths see is one hit.
 */
export function findEnglishFallbacks(source, kind) {
  const words = new Map(); // the word's offset -> the word
  const markup = maskHtmlComments(kind === 'html' ? source : inlineTemplatesOnly(source));
  QUOTED_FALLBACK.lastIndex = 0;
  let match;
  while ((match = QUOTED_FALLBACK.exec(markup)) !== null) words.set(match.index + 1, match[2]);
  if (kind === 'ts') {
    for (const [start, end] of lexTs(source).strings) {
      const content = source.slice(start, end);
      if (FALLBACK_WORD.test(content)) words.set(start, content);
    }
  }
  const lines = source.split('\n');
  return [...words]
    .sort(([a], [b]) => a - b)
    .map(([offset, word]) => {
      const line = lineOf(source, offset);
      return { line, word, text: lines[line - 1].trim() };
    });
}

/**
 * Hits across `files` (`{ file, source }`, `file` repo-relative with forward
 * slashes) set against `allowed` rows. Hits are tallied per row, as
 * check-colors.mjs's ALLOWED counts are: a row whose tally is not its
 * `count` is drift (a tally of 0 is a stale row), and a hit no row names is
 * an offence. The table is a parameter so the self-test can hand in its own.
 */
export function fallbackFindings(files, allowed) {
  const rowOf = new Map();
  allowed.forEach((row, index) => {
    const key = `${row.file}\n${row.text.trim()}`;
    if (!rowOf.has(key)) rowOf.set(key, index);
  });
  const tally = allowed.map(() => 0);
  const offences = [];
  for (const { file, source } of files) {
    for (const hit of findEnglishFallbacks(source, file.endsWith('.html') ? 'html' : 'ts')) {
      const index = rowOf.get(`${file}\n${hit.text}`);
      if (index === undefined) offences.push({ file, ...hit });
      else tally[index] += 1;
    }
  }
  const drift = allowed
    .map((row, index) => ({ file: row.file, text: row.text, count: row.count, hits: tally[index] }))
    .filter(row => row.hits !== row.count);
  return { offences, drift };
}

/**
 * The widget's string tables (scan 6), by `.lproj` language, and the web
 * catalog each one mirrors. iOS picks the table from the device's language;
 * a language with no row here (zh-Hans among them) reads the en table, the
 * development region's, where the web maps every `zh*` to tc.
 */
export const NATIVE_TABLES = { en: 'en', ja: 'ja', 'zh-Hant': 'tc' };
/** The table the widget's Swift keys must stand in: the development region's. */
const NATIVE_SOURCE_LANGUAGE = 'en';
const NATIVE_DIR = 'ios/App/HomeAccountWidget';
const NATIVE_TABLE = 'Localizable.strings';
const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
const WIDGET_TARGET = 'HomeAccountWidget';

/** The escapes a table may use; anything else is a parse failure, not a guess. */
const STRINGS_ESCAPES = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' };

/**
 * Steps over whitespace, `//` line comments and `/* … *\/` block comments
 * from `from`, the trivia a `.strings` table and project.pbxproj share.
 * Returns `{ at, unclosed }`: `at` is the first index past the trivia, or the
 * start of a block comment that never closes, with `unclosed` true. Each
 * reader decides what an unclosed comment means to it.
 */
function skipPlistTrivia(source, from) {
  let at = from;
  for (;;) {
    while (at < source.length && /\s/.test(source[at])) at += 1;
    if (source.startsWith('//', at)) {
      const end = source.indexOf('\n', at);
      at = end === -1 ? source.length : end;
    } else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2);
      if (end === -1) return { at, unclosed: true };
      at = end + 2;
    } else {
      return { at, unclosed: false };
    }
  }
}

/**
 * Reads a `.strings` table strictly: comments, whitespace and
 * `"key" = "value";` entries, both sides quoted, a string on one line, the
 * escapes above, each key once. Xcode's own reader is laxer (unquoted words,
 * any escape), and a laxer reader here could hold a table equal to the
 * catalog that the device reads differently. Returns `{ entries, error }`:
 * `entries` a Map in file order, `error` null or `{ line, message }` for the
 * first problem, where reading stops.
 */
export function parseStrings(source) {
  const entries = new Map();
  let i = 0;
  const fail = message => ({ entries, error: { line: lineOf(source, i), message } });
  /** Steps over the trivia; names a comment that never closes. */
  const skip = () => {
    const { at, unclosed } = skipPlistTrivia(source, i);
    i = at;
    return unclosed ? 'a comment that never closes' : null;
  };
  const quoted = () => {
    if (source[i] !== '"') return { error: 'expected a quoted string' };
    let text = '';
    for (i += 1; i < source.length && source[i] !== '\n'; i += 1) {
      if (source[i] === '"') {
        i += 1;
        return { text };
      }
      if (source[i] === '\\') {
        const escaped = STRINGS_ESCAPES[source[i + 1]];
        if (escaped === undefined) return { error: `an escape this reader does not take: \\${source[i + 1] ?? ''}` };
        text += escaped;
        i += 1;
      } else {
        text += source[i];
      }
    }
    return { error: 'a string that never closes on its line' };
  };
  for (;;) {
    let problem = skip();
    if (problem) return fail(problem);
    if (i >= source.length) return { entries, error: null };
    const entryAt = i;
    const key = quoted();
    if (key.error) return fail(key.error);
    if ((problem = skip())) return fail(problem);
    if (source[i] !== '=') return fail('expected = after the key');
    i += 1;
    if ((problem = skip())) return fail(problem);
    const value = quoted();
    if (value.error) return fail(value.error);
    if ((problem = skip())) return fail(problem);
    if (source[i] !== ';') return fail('expected ; after the value');
    i += 1;
    if (entries.has(key.text)) {
      i = entryAt;
      return fail(`the key ${key.text} is written twice`);
    }
    entries.set(key.text, value.text);
  }
}

/** The catalog value at a dotted key: a string, an object (a plural or a namespace), or undefined. */
function catalogLeaf(catalog, key) {
  let node = catalog;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Sets the widget's tables against the catalogs. `tables` maps each `.lproj`
 * language found to its table's source (null when the folder holds none);
 * `catalogs` maps each locale to its parsed JSON. Every table holds the en
 * table's keys exactly, each key names a string in the catalog its language
 * mirrors, and each value is that string. Returns `{ kind, where, message }`
 * findings; `kind` is one of coverage, missing, unmapped, parse, key set,
 * unknown, not a string, mismatch.
 */
export function nativeTableFindings(tables, catalogs, map = NATIVE_TABLES, locales = LOCALES) {
  const findings = [];
  const add = (kind, where, message) => findings.push({ kind, where, message });
  const mirrored = Object.values(map);
  for (const locale of locales) {
    if (!mirrored.includes(locale)) add('coverage', locale, `no widget table mirrors the ${locale} catalog`);
  }
  for (const [language, locale] of Object.entries(map)) {
    if (!locales.includes(locale)) add('coverage', language, `${language} mirrors ${locale}, which is not a catalog`);
  }
  for (const language of Object.keys(map)) {
    if (tables[language] == null) add('missing', language, `${language}.lproj/${NATIVE_TABLE} is not there`);
  }
  const parsed = new Map();
  for (const [language, source] of Object.entries(tables)) {
    if (!Object.hasOwn(map, language)) {
      add('unmapped', language, `${language}.lproj is a language NATIVE_TABLES does not map to a catalog`);
    } else if (source != null) {
      const { entries, error } = parseStrings(source);
      if (error) add('parse', `${language}:${error.line}`, error.message);
      else parsed.set(language, entries);
    }
  }
  const reference = parsed.get(NATIVE_SOURCE_LANGUAGE);
  for (const [language, entries] of parsed) {
    if (reference && language !== NATIVE_SOURCE_LANGUAGE) {
      for (const key of reference.keys()) {
        if (!entries.has(key)) add('key set', `${language} ${key}`, `lacks ${key}, which the en table holds`);
      }
      for (const key of entries.keys()) {
        if (!reference.has(key)) add('key set', `${language} ${key}`, `holds ${key}, which the en table does not`);
      }
    }
    const locale = map[language];
    const catalog = catalogs[locale];
    if (catalog === undefined) continue;
    for (const [key, value] of entries) {
      const expected = catalogLeaf(catalog, key);
      if (expected === undefined) {
        add('unknown', `${language} ${key}`, `${key} is not a key of ${locale}.json`);
      } else if (typeof expected !== 'string') {
        add('not a string', `${language} ${key}`, `${key} is a plural or a namespace in ${locale}.json, not a string`);
      } else if (expected !== value) {
        add('mismatch', `${language} ${key}`, `reads "${value}" where ${locale}.json reads "${expected}"`);
      }
    }
  }
  return findings;
}

/**
 * Reads project.pbxproj, an old-style property list: dictionaries
 * `{ key = value; }`, arrays `( a, b, )`, quoted or bare strings, comments.
 * Enough of the format to walk the object graph; throws on anything else.
 */
export function parsePbxproj(source) {
  let i = 0;
  const fail = message => {
    throw new Error(`${message} on line ${lineOf(source, i)}`);
  };
  /** Steps over the trivia; throws on a comment that never closes. */
  const skip = () => {
    const { at, unclosed } = skipPlistTrivia(source, i);
    i = at;
    if (unclosed) fail('a comment that never closes');
  };
  const BARE = /[A-Za-z0-9_$/:.\-+]+/y;
  const string = () => {
    skip();
    if (source[i] === '"') {
      let text = '';
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === '"') {
          i += 1;
          return text;
        }
        if (source[i] === '\\') {
          i += 1;
          text += { n: '\n', t: '\t' }[source[i]] ?? source[i];
        } else {
          text += source[i];
        }
      }
      fail('a string that never closes');
    }
    BARE.lastIndex = i;
    const bare = BARE.exec(source);
    if (!bare) fail(`unexpected ${JSON.stringify(source[i] ?? 'end of file')}`);
    i = BARE.lastIndex;
    return bare[0];
  };
  const value = () => {
    skip();
    if (source[i] === '{') {
      i += 1;
      const dict = {};
      for (;;) {
        skip();
        if (source[i] === '}') {
          i += 1;
          return dict;
        }
        const key = string();
        skip();
        if (source[i] !== '=') fail('expected =');
        i += 1;
        dict[key] = value();
        skip();
        if (source[i] !== ';') fail('expected ;');
        i += 1;
      }
    }
    if (source[i] === '(') {
      i += 1;
      const list = [];
      for (;;) {
        skip();
        if (source[i] === ')') {
          i += 1;
          return list;
        }
        list.push(value());
        skip();
        if (source[i] === ',') i += 1;
        else if (source[i] !== ')') fail('expected , or )');
      }
    }
    return string();
  };
  const root = value();
  skip();
  if (i < source.length) fail('text after the closing brace');
  return root;
}

/**
 * The tables reach the built widget only through project.pbxproj: a
 * `Localizable.strings` variant group copied by the widget target's own
 * Resources phase, a file reference per language inside it, and each
 * language in the project's knownRegions. A table on disk that is not wired
 * is never copied, and the device reads the key itself. Returns
 * `{ kind, where, message }` findings; `kind` is phase, table or region.
 */
export function pbxprojWiringFindings(source, languages, target = WIDGET_TARGET) {
  const root = parsePbxproj(source);
  const objects = root.objects ?? {};
  const findings = [];
  const add = (kind, where, message) => findings.push({ kind, where, message });
  const widget = Object.values(objects).find(o => o.isa === 'PBXNativeTarget' && o.name === target);
  const copied = (widget?.buildPhases ?? [])
    .map(id => objects[id])
    .filter(phase => phase?.isa === 'PBXResourcesBuildPhase')
    .flatMap(phase => phase.files ?? [])
    .map(id => objects[objects[id]?.fileRef]);
  const group = copied.find(o => o?.isa === 'PBXVariantGroup' && o.name === NATIVE_TABLE);
  if (group === undefined) {
    add('phase', target, `no ${NATIVE_TABLE} variant group in the ${target} target's Resources phase`);
  } else {
    const paths = (group.children ?? []).map(id => objects[id]?.path);
    for (const language of languages) {
      if (!paths.includes(`${language}.lproj/${NATIVE_TABLE}`)) {
        add('table', language, `the ${NATIVE_TABLE} variant group has no ${language}.lproj/${NATIVE_TABLE}`);
      }
    }
  }
  const regions = objects[root.rootObject]?.knownRegions ?? [];
  for (const language of languages) {
    if (!regions.includes(language)) add('region', language, `knownRegions does not list ${language}`);
  }
  return findings;
}

/**
 * Blanks Swift comments, keeping every offset, and records each string
 * literal by the offset of its opening delimiter. Block comments nest, as
 * Swift's do; a `//` inside a literal is text; `#"…"#` raw strings, `"""`
 * blocks and `\( … )` interpolation (code again, nested literals included)
 * are followed, so a literal's span is its real one.
 */
function lexSwift(source) {
  const masked = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (masked[k] !== '\n') masked[k] = ' ';
  };
  const literals = new Map(); // opening offset -> { from, to, hashes }, the content between the delimiters
  const OPEN = /(#*)("""|")/y;
  const stack = [];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    if (top?.kind === 'string') {
      const escape = `\\${'#'.repeat(top.hashes)}`;
      const close = `${top.delimiter}${'#'.repeat(top.hashes)}`;
      if (source.startsWith(escape, i)) {
        const next = i + escape.length;
        if (source[next] === '(') stack.push({ kind: 'code', depth: 1 });
        i = next + 1;
      } else if (source.startsWith(close, i)) {
        literals.set(top.start, { from: top.from, to: i, hashes: top.hashes });
        stack.pop();
        i += close.length;
      } else {
        i += 1;
      }
      continue;
    }
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (source.startsWith('/*', i)) {
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (source.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (source.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }
    OPEN.lastIndex = i;
    const open = OPEN.exec(source);
    if (open) {
      const from = i + open[0].length;
      stack.push({ kind: 'string', delimiter: open[2], hashes: open[1].length, start: i, from });
      i = from;
      continue;
    }
    if (top?.kind === 'code') {
      if (source[i] === '(') top.depth += 1;
      else if (source[i] === ')' && --top.depth === 0) stack.pop();
    }
    i += 1;
  }
  return { masked: masked.join(''), literals };
}

/**
 * Where the widget hands SwiftUI or Foundation text to show: `Text(`,
 * `Label(`, `LocalizedStringKey(`, `NSLocalizedString(`,
 * `String(localized:`, the `.configurationDisplayName(`, `.description(` and
 * `.accessibilityLabel(` modifiers, and a `LocalizedStringKey` declared with
 * `{` or `=`. A type head needs an identifier boundary before it, so
 * `UILabel(` and `RichText(` are not heads; a `.` may precede it
 * (`SwiftUI.Text(`).
 */
const SWIFT_HEAD =
  /(?<![A-Za-z0-9_])(?:Text|Label|LocalizedStringKey|NSLocalizedString)\(|\.(?:configurationDisplayName|description|accessibilityLabel)\(|(?<![A-Za-z0-9_])String\(\s*localized:|:\s*LocalizedStringKey\s*[{=]/g;

/**
 * A string literal standing first after a display head (SWIFT_HEAD) is a
 * hit when it is not a key of the widget's en table (`keys`), when it is
 * interpolated, or when it is `Text(verbatim:)`, which iOS never looks up.
 * An argument that is not a literal (a snapshot string, `Self.appName`) is
 * not read. Returns `{ line, reason, text }`, `text` the trimmed line.
 */
export function findSwiftDisplayLiterals(source, keys) {
  const { masked, literals } = lexSwift(source);
  const lines = source.split('\n');
  const hits = [];
  SWIFT_HEAD.lastIndex = 0;
  let head;
  while ((head = SWIFT_HEAD.exec(masked)) !== null) {
    let at = head.index + head[0].length;
    const space = () => {
      while (at < masked.length && /\s/.test(masked[at])) at += 1;
    };
    space();
    let verbatim = false;
    if (head[0] === 'Text(' && masked.startsWith('verbatim:', at)) {
      verbatim = true;
      at += 'verbatim:'.length;
      space();
    }
    if (head[0].endsWith('{') && /^return(?![A-Za-z0-9_])/.test(masked.slice(at, at + 7))) {
      at += 'return'.length;
      space();
    }
    const literal = literals.get(at);
    if (literal === undefined) continue;
    const content = source.slice(literal.from, literal.to);
    const interpolated = content.includes(`\\${'#'.repeat(literal.hashes)}(`);
    const reason = verbatim ? 'verbatim' : interpolated ? 'interpolated' : keys.has(content) ? null : 'not a key';
    if (reason !== null) {
      const line = lineOf(source, at);
      hits.push({ line, reason, text: lines[line - 1].trim() });
    }
  }
  return hits;
}

/** Each `.lproj` folder in the widget's folder, mapped to its table's source or null. */
function readNativeTables(dir) {
  const tables = {};
  for (const entry of readdirSync(dir).sort()) {
    const language = /^(.+)\.lproj$/.exec(entry)?.[1];
    if (language === undefined || !statSync(join(dir, entry)).isDirectory()) continue;
    const path = join(dir, entry, NATIVE_TABLE);
    tables[language] = existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  return tables;
}

/** Test doubles and fixtures, read by specs only (test-data.ts seeds an 'Other' category). */
const FALLBACK_SKIP = 'src/app/core/services/testing/';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (/\.(ts|html)$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function run() {
  const catalogs = {};
  const defined = {};
  for (const locale of LOCALES) {
    catalogs[locale] = JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8'));
    defined[locale] = flatten(catalogs[locale]);
  }

  /** key -> Set of `file:line` that reference it */
  const referenced = new Map();
  let dynamicCount = 0;
  const ariaOffences = [];
  const altOffences = [];
  const englishOffences = [];
  const commaOffences = [];
  const allowedSeen = new Set();
  let templatesScanned = 0;
  const fallbackFiles = [];

  for (const file of walk(SOURCE_DIR)) {
    const text = readFileSync(file, 'utf8');
    const where = index => `${relative('.', file)}:${lineOf(text, index)}`;

    const posix = relative('.', file).split(sep).join('/');
    if (!posix.startsWith(FALLBACK_SKIP)) fallbackFiles.push({ file: posix, source: text });

    const calls = extractTCallKeys(text);
    dynamicCount += calls.dynamicCount;
    for (const { key, index } of calls.keys) {
      const seen = referenced.get(key) ?? new Set();
      seen.add(where(index));
      referenced.set(key, seen);
    }

    text.split('\n').forEach((line, lineIndex) => {
      PIPE_KEY.lastIndex = 0;
      let match;
      while ((match = PIPE_KEY.exec(line)) !== null) {
        const seen = referenced.get(match[1]) ?? new Set();
        seen.add(`${relative('.', file)}:${lineIndex + 1}`);
        referenced.set(match[1], seen);
      }
      // Count `| translate` occurrences that no literal-key match accounts for.
      const pipes = line.match(DYNAMIC_PIPE)?.length ?? 0;
      if (pipes > 0) {
        const literals = line.match(PIPE_KEY)?.length ?? 0;
        dynamicCount += Math.max(0, pipes - literals);
      }
    });

    if (file.endsWith('.html')) {
      for (const offence of findStaticAriaLabels(text)) {
        ariaOffences.push({ site: where(offence.index), value: offence.value });
      }
      for (const offence of findStaticAltTexts(text)) {
        altOffences.push({ site: where(offence.index), value: offence.value });
      }
    }

    // A `.ts` file is read for its inline `template:` literals only —
    // everything else is blanked, so the same scanners run over both kinds
    // of template and report the file's real line either way.
    const markup = file.endsWith('.html') ? text : inlineTemplatesOnly(text);
    if (markup.trim() !== '') {
      templatesScanned += 1;
      const path = relative('.', file);
      for (const node of findVisibleEnglish(markup)) {
        const allowed = PROPER_NOUNS.findIndex(
          row => row.file === path.split(sep).join('/') && row.text === node.text
        );
        if (allowed === -1) {
          englishOffences.push({ site: `${path}:${node.line}`, value: node.text });
        } else {
          allowedSeen.add(allowed);
        }
      }
      for (const join of findCommaJoins(markup)) {
        commaOffences.push({ site: `${path}:${join.line}`, value: join.text });
      }
    }
  }

  const staleAllowances = PROPER_NOUNS.map((row, index) => ({ row, index }))
    .filter(({ index }) => !allowedSeen.has(index))
    .map(({ row }) => row);

  const fallbackRows = [...MODEL_FACING_FALLBACKS, ...STORED_FALLBACKS];
  const fallbacks = fallbackFindings(fallbackFiles, fallbackRows);
  const allowedHits = rows => rows.reduce((sum, row) => sum + row.count, 0);

  const nativeTables = readNativeTables(NATIVE_DIR);
  const tableFindings = nativeTableFindings(nativeTables, catalogs);
  let wiringFindings;
  try {
    wiringFindings = pbxprojWiringFindings(readFileSync(PBXPROJ, 'utf8'), Object.keys(NATIVE_TABLES));
  } catch (error) {
    wiringFindings = [{ kind: 'parse', where: PBXPROJ, message: `does not read: ${error.message}` }];
  }
  const sourceTable = nativeTables[NATIVE_SOURCE_LANGUAGE];
  const sourceKeys = new Set(sourceTable == null ? [] : parseStrings(sourceTable).entries.keys());
  const swiftFiles = readdirSync(NATIVE_DIR)
    .filter(name => name.endsWith('.swift'))
    .sort()
    .map(name => `${NATIVE_DIR}/${name}`);
  const swiftOffences = swiftFiles.flatMap(file =>
    findSwiftDisplayLiterals(readFileSync(file, 'utf8'), sourceKeys).map(hit => ({ site: `${file}:${hit.line}`, ...hit }))
  );

  const failures = [];
  for (const [key, sites] of [...referenced].sort(([a], [b]) => a.localeCompare(b))) {
    const missing = LOCALES.filter(locale => !defined[locale].has(key));
    if (missing.length > 0) {
      failures.push({ key, missing, sites: [...sites].sort() });
    }
  }

  console.log(
    `Checked ${referenced.size} literal keys ` +
      `(${dynamicCount} dynamic ${dynamicCount === 1 ? 'usage' : 'usages'} skipped) ` +
      `against ${LOCALES.map(l => `${l}:${defined[l].size}`).join(' ')}`
  );
  console.log(
    `Checked ${templatesScanned} templates for visible English text nodes ` +
      `(${PROPER_NOUNS.length} proper nouns allowed by name).`
  );
  console.log(`Checked ${templatesScanned} templates for a translated fragment joined to a value by a comma.`);
  console.log(
    `Checked ${fallbackFiles.length} files for an English "Unknown", "Other" or "User" fallback ` +
      `(${fallbackRows.length} rows allow ${allowedHits(fallbackRows)} hits: ` +
      `${MODEL_FACING_FALLBACKS.length} model-facing for ${allowedHits(MODEL_FACING_FALLBACKS)}, ` +
      `${STORED_FALLBACKS.length} stored for ${allowedHits(STORED_FALLBACKS)}).`
  );
  console.log(
    `Checked the widget's string tables (${Object.entries(NATIVE_TABLES)
      .map(([language, locale]) => `${language} for ${locale}`)
      .join(', ')}) against the catalogs and their wiring in ${PBXPROJ}, ` +
      `and ${swiftFiles.length} widget Swift files for display literals.`
  );

  let failed = false;
  if (failures.length > 0) {
    failed = true;
    console.error(`\n${failures.length} key(s) do not resolve in every locale:\n`);
    for (const { key, missing, sites } of failures) {
      console.error(`  ${key} — missing from ${missing.join(', ')}`);
      for (const site of sites) console.error(`      ${site}`);
    }
    console.error('\nAdd the key to every locale under src/assets/i18n/ (see docs/i18n.md), or stop referencing it.');
  }
  if (ariaOffences.length > 0) {
    failed = true;
    console.error(`\n${ariaOffences.length} hard-coded aria-label(s) — screen readers hear English on every locale:\n`);
    for (const { site, value } of ariaOffences.sort((a, b) => a.site.localeCompare(b.site))) {
      console.error(`  ${site} aria-label="${value}"`);
    }
    console.error('\nBind it instead: [attr.aria-label]="\'some.key\' | translate" (see docs/i18n.md).');
  }
  if (altOffences.length > 0) {
    failed = true;
    console.error(`\n${altOffences.length} hard-coded alt text(s) — screen readers hear English on every locale:\n`);
    for (const { site, value } of altOffences.sort((a, b) => a.site.localeCompare(b.site))) {
      console.error(`  ${site} alt="${value}"`);
    }
    console.error('\nBind it instead: [alt]="\'some.key\' | translate" (see docs/i18n.md).');
  }
  if (englishOffences.length > 0) {
    failed = true;
    console.error(`\n${englishOffences.length} template text node(s) hard-coding English — every locale reads them:\n`);
    for (const { site, value } of englishOffences.sort((a, b) => a.site.localeCompare(b.site))) {
      console.error(`  ${site}  ${value.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
    console.error(
      '\nWrite it as a key: {{ \'some.key\' | translate }}, in all three catalogs under\n' +
        'src/assets/i18n/ (see docs/i18n.md). A product or format name that is spelled the\n' +
        "same in every locale goes in this script's PROPER_NOUNS table instead, with a reason."
    );
  }
  if (commaOffences.length > 0) {
    failed = true;
    console.error(
      `\n${commaOffences.length} translated fragment(s) joined to a value by a comma — ` +
        'ja and tc place the name and the comma themselves:\n'
    );
    for (const { site, value } of commaOffences.sort((a, b) => a.site.localeCompare(b.site))) {
      console.error(`  ${site}  ${value}`);
    }
    console.error(
      "\nWrite the whole sentence as one key with a placeholder, e.g. 'Welcome back, {{name}}' read\n" +
        "through welcomeGreeting (core/utils/person-name.utils.ts), so each locale orders and\n" +
        'punctuates it itself (see docs/i18n.md). A label and its value may be joined by a colon.'
    );
  }
  if (staleAllowances.length > 0) {
    failed = true;
    console.error(`\n${staleAllowances.length} PROPER_NOUNS row(s) match nothing any more:\n`);
    for (const { file, text } of staleAllowances) {
      console.error(`  ${file}  ${text}`);
    }
    console.error(
      '\nAn allowance nobody uses is an allowance nobody reviews — drop the row from\n' +
        'scripts/check-i18n.mjs in the same commit that removed the text.'
    );
  }
  if (fallbacks.offences.length > 0) {
    failed = true;
    console.error(`\n${fallbacks.offences.length} English fallback(s) a reader would see on every locale:\n`);
    const site = hit => `${hit.file}:${hit.line}`;
    for (const hit of fallbacks.offences.sort((a, b) => site(a).localeCompare(site(b)))) {
      console.error(`  ${site(hit)}  ${hit.text.slice(0, 120)}`);
    }
    console.error(
      "\nFall back to a catalog key instead: common.unknownCategory for a missing category\n" +
        '(core/utils/category-display.utils.ts), common.unnamedAccount for an account that names\n' +
        'nobody (core/utils/person-name.utils.ts), or a key of its own (see docs/i18n.md). A word only\n' +
        'a model reads, or one stored on the row, goes in MODEL_FACING_FALLBACKS or STORED_FALLBACKS\n' +
        "in this script instead, with a reason."
    );
  }
  if (fallbacks.drift.length > 0) {
    failed = true;
    console.error(`\n${fallbacks.drift.length} fallback row(s) no longer match the code:\n`);
    for (const { file, text, count, hits } of fallbacks.drift) {
      console.error(`  ${file}  ${text}  (the row allows ${count} hits, the file holds ${hits})`);
    }
    console.error(
      '\nEdit the row\'s count to match, or drop the row from scripts/check-i18n.mjs in the\n' +
        'same commit that removed the literal.'
    );
  }
  if (tableFindings.length > 0) {
    failed = true;
    console.error(
      `\n${tableFindings.length} widget string table finding(s) — the gallery and an empty widget ` +
        'read these words on a device:\n'
    );
    for (const { kind, where, message } of tableFindings) {
      console.error(`  ${NATIVE_DIR}  ${kind} ${where}: ${message}`);
    }
    console.error(
      `\nEach <language>.lproj/${NATIVE_TABLE} holds the en table's keys, every one a catalog key\n` +
        'whose value is copied from the catalog NATIVE_TABLES maps that language to; a new\n' +
        'catalog or a new table adds its NATIVE_TABLES row in the same commit (see docs/i18n.md).'
    );
  }
  if (wiringFindings.length > 0) {
    failed = true;
    console.error(
      `\n${wiringFindings.length} widget string table wiring finding(s) — the build would not ` +
        'copy the table, and the device would read the key itself:\n'
    );
    for (const { kind, where, message } of wiringFindings) {
      console.error(`  ${PBXPROJ}  ${kind} ${where}: ${message}`);
    }
    console.error(
      `\nList the table in the ${NATIVE_TABLE} variant group of the ${WIDGET_TARGET} group, copy the\n` +
        `group in the ${WIDGET_TARGET} target's Resources phase, and add the language to knownRegions\n` +
        '(see docs/i18n.md).'
    );
  }
  if (swiftOffences.length > 0) {
    failed = true;
    console.error(
      `\n${swiftOffences.length} widget display literal(s) a device shows as written, whatever its language:\n`
    );
    const bySite = (a, b) => a.site.localeCompare(b.site, 'en', { numeric: true });
    for (const { site, reason, text } of swiftOffences.sort(bySite)) {
      console.error(`  ${site}  ${text.slice(0, 120)}  (${reason})`);
    }
    console.error(
      `\nName a key of the widget's en table instead (a catalog key such as "app.title", typed as a\n` +
        'LocalizedStringKey), so iOS looks it up in the table for the device\'s language; never\n' +
        'Text(verbatim:) and never an interpolated key (see docs/i18n.md).'
    );
  }
  if (failed) process.exit(1);

  console.log(
    'Every literal translation key resolves in every locale, no template hard-codes an aria-label, ' +
      'alt text or English sentence or joins a translated fragment to a value by a comma, ' +
      'no code falls back to an English word a reader would see, and the widget names its words ' +
      'from wired string tables equal to the catalogs.'
  );
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }
  const calledKeys = text => extractTCallKeys(text).keys.map(k => k.key);

  check('reads a same-line t() key', calledKeys("this.translationService.t('common.save')"), ['common.save']);
  check(
    'reads both keys of a split call with a ternary first argument',
    calledKeys("this.translationService.t(\n  filters.type === 'expense' ? 'common.expense' : 'common.income');"),
    ['common.expense', 'common.income']
  );
  check(
    'does not take the comparison literal in the condition for a key',
    calledKeys("t(kind === 'expense' ? 'a.b' : 'c.d')"),
    ['a.b', 'c.d']
  );
  check('stops at the first top-level comma', calledKeys("t('import.verifyAmount', { percent })"), ['import.verifyAmount']);
  check('reads a key through nested parens in the argument', calledKeys("t((flag ? 'a.b' : 'c.d'))"), ['a.b', 'c.d']);
  check('counts an identifier argument as dynamic', extractTCallKeys('this.t(chip.labelKey)').dynamicCount, 1);
  check('counts a template-literal argument as dynamic', extractTCallKeys('t(`insights.stale_${reason}`)').dynamicCount, 1);
  check('keeps format( and friends out', calledKeys("format('a.b')"), []);
  check('ignores a call left unbalanced at end-of-file', calledKeys("t('a.b'"), []);
  check('a quoted paren does not end the argument', calledKeys("t(cond ? 'a.b' : ')' + x)"), ['a.b']);

  check('flattens a plural object as one leaf', [...flatten({ a: { one: 'x', other: 'y' } })], ['a']);
  check('recurses into an ordinary namespace', [...flatten({ a: { b: 'x' } })], ['a.b']);
  check('a CLDR-named member holding an object is a namespace, not a plural', [...flatten({ a: { one: { b: 'x' } } })], ['a.one.b']);
  check('a namespace with one stray key is not a plural leaf', [...flatten({ a: { one: 'x', extra: 'y' } })], ['a.one', 'a.extra']);

  check('flags a static aria-label', findStaticAriaLabels('<button aria-label="User menu">').map(o => o.value), ['User menu']);
  check('allows [attr.aria-label] bound through translate', findStaticAriaLabels(`<button [attr.aria-label]="'common.userMenu' | translate">`), []);
  check('allows a bound [aria-label]', findStaticAriaLabels('<div [aria-label]="label()">'), []);
  check('allows an interpolated aria-label', findStaticAriaLabels(`<div aria-label="{{ 'k.x' | translate }}">`), []);
  check('does not flag aria-labelledby', findStaticAriaLabels('<div aria-labelledby="title-id">'), []);

  check('flags a static alt', findStaticAltTexts('<img alt="Profile">').map(o => o.value), ['Profile']);
  check('allows [alt] bound through translate', findStaticAltTexts(`<img [alt]="'common.userMenu' | translate">`), []);
  check('allows a bound [alt]', findStaticAltTexts('<img [alt]="label()">'), []);
  check('allows an interpolated alt', findStaticAltTexts(`<img alt="{{ 'k.x' | translate }}">`), []);
  check('allows an empty decorative alt', findStaticAltTexts('<img alt="">'), []);
  check('does not flag a suffixed attribute name', findStaticAltTexts('<img data-alt="x">'), []);

  PIPE_KEY.lastIndex = 0;
  check('reads a pipe key', PIPE_KEY.exec(`{{ 'common.save' | translate }}`)?.[1], 'common.save');

  // --- the text-node scan -------------------------------------------------
  const english = source => findVisibleEnglish(source).map(node => node.text);

  // must hit
  check('a bare sentence in an element', english('<p>Save your changes</p>'), ['Save your changes']);
  check('two words are enough', english('<span>Add more</span>'), ['Add more']);
  check(
    'English between two interpolations',
    english('<p>{{ count() }} of {{ total() }} rows selected</p>').map(text =>
      text.replace(/\s+/g, ' ')
    ),
    ['of rows selected']
  );
  check(
    'a sentence inside a control-flow block',
    english('@if (empty()) {\n  <p>Nothing here yet</p>\n}'),
    ['Nothing here yet']
  );
  check('a sentence beside an icon', english('<span><mat-icon>add</mat-icon>Add a row</span>'), ['Add a row']);
  check(
    'a sentence in an inline template',
    english(inlineTemplatesOnly("@Component({ template: `<p>Save your changes</p>` })")),
    ['Save your changes']
  );

  // must not hit — the load-bearing half. Every shape below is correct code
  // that appears in this tree, and a rule that fired on any of them would be
  // turned off rather than obeyed.
  check('a translated node', english(`<p>{{ 'common.save' | translate }}</p>`), []);
  check('a Material ligature', english('<mat-icon>arrow_drop_down</mat-icon>'), []);
  check('a ligature with attributes on the tag', english('<mat-icon class="x" [inline]="true">error_outline</mat-icon>'), []);
  check('two ligatures in a row', english('<mat-icon>add</mat-icon><mat-icon>keyboard_arrow_up</mat-icon>'), []);
  check('an interpolation on its own', english('<p>{{ merchantName() }}</p>'), []);
  check('a control-flow header', english('@if (isLoading()) {\n}'), []);
  check('a for block header with a track expression', english('@for (row of rows(); track row.id) {\n}'), []);
  check('an empty block header', english('@empty {\n}'), []);
  check('two entities in a row', english('<p>&nbsp;&mdash;&nbsp;</p>'), []);
  check('a single word', english('<span>Beta</span>'), []);
  check('a unit beside a number', english('<span>10 MB</span>'), []);
  // An attribute value routinely holds a `>`; stopping the tag at the first
  // one spills the rest of the attribute into text position, which is how
  // half a dozen templates read as English on the first draft of this rule.
  check(
    'a comparison inside an attribute value',
    english('<span [class.up]="row.change >= 0" [title]="label()">{{ row.name }}</span>'),
    []
  );
  check(
    'a single-quoted comparison inside an attribute value',
    english(`<span [tone]="v >= 0 ? 'positive' : 'negative'">{{ v }}</span>`),
    []
  );
  check('a commented-out sentence', english('<!-- Save your changes -->\n<p>{{ x() }}</p>'), []);
  check('a commented-out sentence in an inline template', english(inlineTemplatesOnly('@Component({ template: `<!-- Save it -->` })')), []);
  check('code outside an inline template is not markup', english(inlineTemplatesOnly("const message = 'Save your changes';")), []);
  check('an href is not a line comment', english('<a href="https://x/y">{{ x() }}</a>'), []);

  // reporting
  check('a text node reports its own line', findVisibleEnglish('<div>\n  <p>{{ x() }}</p>\n  <p>Save your changes</p>\n</div>')[0].line, 3);
  check(
    'every proper-noun row names a file, a text and a reason',
    PROPER_NOUNS.every(row => row.file.startsWith('src/app/') && row.text.length > 0 && row.reason.length > 10),
    true
  );

  // --- the comma-join check -----------------------------------------------
  const joins = source => findCommaJoins(source).map(join => join.line);

  // must hit
  check('a translated fragment, a comma and a value', joins(`{{ 'x' | translate }}, {{ y }}`), [1]);
  check('the same with the ideographic comma', joins(`{{ 'x' | translate }}、{{ y }}`), [1]);
  check('no space after the comma', joins(`{{ 'x' | translate }},{{ y }}`), [1]);
  check('a translated fragment carrying parameters', joins(`{{ 'x' | translate: { n: 1 } }}, {{ y }}`), [1]);
  check(
    'a translated fragment, a comma and another translated fragment',
    joins(`{{ 'a.b' | translate }}, {{ 'c.d' | translate }}`),
    [1]
  );
  check('a join reports the line of its comma', joins(`<p>\n  {{ 'x' | translate }},\n  {{ y }}\n</p>`), [2]);
  check(
    'the dashboard subtitle as it stood',
    joins(
      `<div>\n  <app-page-header>\n    <p header-subtitle>\n      {{ 'common.welcome' | translate }}, {{ userName() }}\n    </p>\n  </app-page-header>\n</div>`
    ),
    [4]
  );
  check(
    'a join in an inline template',
    joins(inlineTemplatesOnly("@Component({ template: `<p>{{ 'x' | translate }}, {{ y }}</p>` })")),
    [1]
  );

  // must not hit — a colon is accepted by decision (ja and tc write `label: value`),
  // and each of the others is a shape this tree writes legitimately.
  check('a colon before a value', joins(`{{ 'x' | translate }}: {{ y }}`), []);
  check(
    'a comma inside the parameters of a translated fragment',
    joins(`{{ 'x' | translate: { a: 1, b: 2 } }} {{ y }}`),
    []
  );
  check('a comma after an interpolation that does not translate', joins(`{{ a }}, {{ b }}`), []);
  check('a value, a comma and a translated fragment', joins(`{{ y }}, {{ 'x' | translate }}`), []);
  check('a pipe whose name only starts with translate', joins(`{{ label | translateOrDash }}, {{ y }}`), []);
  check('a comma that ends the element', joins(`<b>{{ 'x' | translate }},</b> {{ y }}`), []);
  check('a commented-out join', joins(`<!-- {{ 'x' | translate }}, {{ y }} -->`), []);

  // --- the fallback scan --------------------------------------------------
  const fallbacks = (source, kind = 'ts') => findEnglishFallbacks(source, kind).map(hit => hit.word);

  // must hit
  check('a ternary that falls back to the word', fallbacks("return name ? t(name) : 'Unknown';"), ['Unknown']);
  check('an || fallback on a property', fallbacks("name: c?.name || 'Unknown',"), ['Unknown']);
  check('a double-quoted ?? fallback', fallbacks('?? "Other"'), ['Other']);
  check('a template literal holding the word alone', fallbacks('`Unknown`'), ['Unknown']);
  check(
    "a string inside a template literal's substitution",
    fallbacks("const s = `${name ?? 'Unknown'}`;"),
    ['Unknown']
  );
  check(
    'an inline template that falls back to the word',
    fallbacks("@Component({ template: `<p>{{ n || 'Unknown' }}</p>` })"),
    ['Unknown']
  );
  check('a division beside a hit is not a regex', fallbacks("const r = total / count; const s = 'Unknown';"), ['Unknown']);
  check('a template that falls back to the word', fallbacks("{{ n || 'Unknown' }}", 'html'), ['Unknown']);
  // `User` is the third word: the name a missing display name fell back to (#500).
  check('a ?? fallback on a sign-in name', fallbacks("displayName: firebaseUser.displayName ?? 'User',"), ['User']);
  check('an || fallback on a first name', fallbacks("return user?.displayName?.split(' ')[0] || 'User';"), ['User']);
  check(
    'an || fallback on a computed name',
    fallbacks("userName = computed(() => this.authService.currentUser()?.displayName || 'User');"),
    ['User']
  );
  check('a template that falls back to the name', fallbacks("{{ displayName() || 'User' }}", 'html'), ['User']);

  // must not hit
  check('a sentence that starts with the word', fallbacks("message: 'Unknown error',"), []);
  check('a key that ends in the word', fallbacks("t('settings.platformUnknown')"), []);
  check('another key that ends in the word', fallbacks("t('import.matchUnknown')"), []);
  check('the word in a line comment', fallbacks('// never "Unknown"'), []);
  check('the word in a block comment', fallbacks('/** a deliberate "Other" */'), []);
  check('the word inside an identifier', fallbacks('if (isUnknownKind()) return;'), []);
  check('the catalog key itself', fallbacks("t('common.unknownCategory')"), []);
  // The apostrophe matters: a lexer that missed the regex would open a string
  // at its quote, close it there, and read the comment's "Other" as code.
  check('a quote-bearing regex before a commented word', fallbacks(`const quote = /['"]/; // the model's "Other"`), []);
  check(
    'prompt prose inside a template literal',
    fallbacks('const prompt = `use defaults: merchant="Unknown", currency=""`;'),
    []
  );
  check(
    'an inline template that translates the key',
    fallbacks("@Component({ template: `<p>{{ 'common.unknownCategory' | translate }}</p>` })"),
    []
  );
  check('the word in a template comment', fallbacks("<!-- {{ n || 'Unknown' }} -->", 'html'), []);
  // The name word is case-sensitive: a chat message's role is not a name.
  check('a chat role, lowercase', fallbacks("messages: [{ role: 'user', content }],"), []);
  check('a sentence that starts with the name word', fallbacks("message: 'User cancelled the sign-in',"), []);
  check('a key that ends in the name word', fallbacks("t('settings.signedInUser')"), []);
  check('the Firebase type of that name', fallbacks("import { User } from '@angular/fire/auth';\nlet current: User | null = null;"), []);
  check('the name word in a doc comment', fallbacks('/** A stored "User" is a name, as any other. */'), []);
  check('a quoted lowercase word in a template', fallbacks(`<span [attr.data-role]="'user'"></span>`, 'html'), []);

  // reporting
  check(
    'a hit reports its line and the trimmed text of that line',
    findEnglishFallbacks("const a = 1;\n    label = name || 'Other';\n", 'ts'),
    [{ line: 2, word: 'Other', text: "label = name || 'Other';" }]
  );

  // the tables
  const LINE = "label = name || 'Unknown';";
  const fixtureRow = (text, count, file = 'src/app/x.ts') => ({
    file,
    text,
    count,
    reason: 'a fixture row for the self-test',
  });
  const findings = (source, rows) => {
    const { offences, drift } = fallbackFindings([{ file: 'src/app/x.ts', source }], rows);
    return { offences: offences.map(o => `${o.file}:${o.line}`), drift: drift.map(d => d.hits) };
  };
  check('a hit its row allows', findings(LINE, [fixtureRow(LINE, 1)]), { offences: [], drift: [] });
  check('an indented hit still matches its row', findings(`    ${LINE}`, [fixtureRow(LINE, 1)]), { offences: [], drift: [] });
  check('a row that matches nothing is stale', findings('label = name;', [fixtureRow(LINE, 1)]), { offences: [], drift: [0] });
  check('a hit with no row is an offence', findings(LINE, []), { offences: ['src/app/x.ts:1'], drift: [] });
  check(
    "a row for another file allows nothing in this one",
    findings(LINE, [fixtureRow(LINE, 1, 'src/app/y.ts')]),
    { offences: ['src/app/x.ts:1'], drift: [0] }
  );
  check(
    'two identical lines against a count-2 row',
    findings(`${LINE}\n${LINE}`, [fixtureRow(LINE, 2)]),
    { offences: [], drift: [] }
  );
  check('one of the two left is reported', findings(LINE, [fixtureRow(LINE, 2)]), { offences: [], drift: [1] });
  check('a third copy is reported', findings(`${LINE}\n${LINE}\n${LINE}`, [fixtureRow(LINE, 2)]), { offences: [], drift: [3] });

  const liveRows = [...MODEL_FACING_FALLBACKS, ...STORED_FALLBACKS];
  check(
    'every fallback row names a src/app file, a text, a count and a reason',
    liveRows.every(
      row =>
        typeof row.file === 'string' &&
        row.file.startsWith('src/app/') &&
        typeof row.text === 'string' &&
        row.text.trim().length > 0 &&
        Number.isInteger(row.count) &&
        row.count >= 1 &&
        typeof row.reason === 'string' &&
        row.reason.length > 10
    ),
    true
  );
  const pairs = liveRows.map(row => `${row.file}\n${row.text.trim()}`);
  check('no two fallback rows share a file and a text', new Set(pairs).size, pairs.length);

  // scan 6: the .strings parser
  const strings = source => {
    const { entries, error } = parseStrings(source);
    return error ? { error: error.line } : Object.fromEntries(entries);
  };
  check(
    'reads one entry under a comment naming its catalog',
    strings('/* Mirrors src/assets/i18n/en.json. */\n"app.title" = "Home Account";\n'),
    { 'app.title': 'Home Account' }
  );
  check('reads a value in another script', strings('"app.title" = "家計簿";'), { 'app.title': '家計簿' });
  check(
    'reads several entries around a line comment',
    strings('// first\n"a.b" = "x";\n\n"c.d"="y" ;'),
    { 'a.b': 'x', 'c.d': 'y' }
  );
  check(
    'unescapes a quote, a backslash and a newline',
    strings(String.raw`"a.b" = "say \"hi\" \\ \n";`),
    { 'a.b': 'say "hi" \\ \n' }
  );
  check('a missing semicolon fails where the next entry starts', strings('"a.b" = "x"\n"c.d" = "y";'), { error: 2 });
  check('an unquoted value fails', strings('"a.b" = x;'), { error: 1 });
  check('a key written twice fails on its second line', strings('"a.b" = "x";\n"a.b" = "y";'), { error: 2 });
  check(
    'a string or a comment that never closes fails',
    [strings('"a.b" = "x;\n'), strings('/* note\n"a.b" = "x";')],
    [{ error: 1 }, { error: 1 }]
  );
  check('an escape the parser does not read fails', strings(String.raw`"a.b" = "\q";`), { error: 1 });

  // scan 6: the tables set against the catalogs
  const CATALOGS = {
    en: { app: { title: 'Home Account', loading: 'Loading...' }, n: { one: '{{n}} row', other: '{{n}} rows' } },
    ja: { app: { title: '家計簿', loading: '読み込み中...' }, n: '{{n}} 件' },
    tc: { app: { title: '家庭記帳', loading: '載入中...' }, n: '{{n}} 筆' },
  };
  const TABLES = {
    en: '"app.title" = "Home Account";',
    ja: '"app.title" = "家計簿";',
    'zh-Hant': '"app.title" = "家庭記帳";',
  };
  const native = (tables, map = NATIVE_TABLES) =>
    nativeTableFindings(tables, CATALOGS, map, LOCALES).map(f => `${f.kind} ${f.where}`);
  check('three tables equal to their catalogs', native(TABLES), []);
  check(
    'a mapped table that is not there',
    [native({ en: TABLES.en, 'zh-Hant': TABLES['zh-Hant'] }), native({ ...TABLES, ja: null })],
    [['missing ja'], ['missing ja']]
  );
  check(
    'a table for a language the map does not name',
    native({ ...TABLES, 'zh-Hans': '"app.title" = "家庭记账";' }),
    ['unmapped zh-Hans']
  );
  check(
    'a table lacking a key the en table holds',
    native({
      en: `${TABLES.en}\n"app.loading" = "Loading...";`,
      ja: TABLES.ja,
      'zh-Hant': `${TABLES['zh-Hant']}\n"app.loading" = "載入中...";`,
    }),
    ['key set ja app.loading']
  );
  check(
    'a table holding a key the en table lacks',
    native({ ...TABLES, ja: `${TABLES.ja}\n"app.loading" = "読み込み中...";` }),
    ['key set ja app.loading']
  );
  check(
    'a key no catalog holds',
    native({ en: '"app.titel" = "Home Account";', ja: '"app.titel" = "家計簿";', 'zh-Hant': '"app.titel" = "家庭記帳";' }),
    ['unknown en app.titel', 'unknown ja app.titel', 'unknown zh-Hant app.titel']
  );
  check(
    'a key that is a plural in its catalog',
    native({
      en: `${TABLES.en}\n"n" = "{{n}} rows";`,
      ja: `${TABLES.ja}\n"n" = "{{n}} 件";`,
      'zh-Hant': `${TABLES['zh-Hant']}\n"n" = "{{n}} 筆";`,
    }),
    ['not a string en n']
  );
  check('a value that differs from its catalog', native({ ...TABLES, ja: '"app.title" = "家計";' }), ['mismatch ja app.title']);
  check('a table that does not parse', native({ ...TABLES, ja: '"app.title" = "家計簿"' }), ['parse ja:1']);
  check(
    'a catalog no table mirrors, and a table that mirrors no catalog',
    [
      native({ en: TABLES.en, ja: TABLES.ja }, { en: 'en', ja: 'ja' }),
      native({ ...TABLES, 'zh-Hans': '"app.title" = "家庭记账";' }, { ...NATIVE_TABLES, 'zh-Hans': 'sc' }),
    ],
    [['coverage tc'], ['coverage zh-Hans']]
  );
  check('the live map mirrors every catalog once', Object.values(NATIVE_TABLES).sort(), [...LOCALES].sort());

  // scan 6: the tables wired into the widget target
  const pbxproj = ({ regions = 'en, Base, ja, "zh-Hant",', phase = 'F1,', children = 'E1, E2, E3,' } = {}) => `// !$*UTF8*$!
{
	objects = {
		P1 /* Project object */ = {isa = PBXProject; knownRegions = (${regions}); targets = (T1, T2, ); };
		T1 /* HomeAccountWidget */ = {isa = PBXNativeTarget; name = HomeAccountWidget; buildPhases = (S1, R1, ); };
		T2 /* App */ = {isa = PBXNativeTarget; name = App; buildPhases = (R2, ); };
		S1 /* Sources */ = {isa = PBXSourcesBuildPhase; files = (); };
		R1 /* Resources */ = {isa = PBXResourcesBuildPhase; files = (${phase}); };
		R2 /* Resources */ = {isa = PBXResourcesBuildPhase; files = (F1, ); };
		F1 /* Localizable.strings in Resources */ = {isa = PBXBuildFile; fileRef = V1 /* Localizable.strings */; };
		V1 /* Localizable.strings */ = {isa = PBXVariantGroup; children = (${children}); name = Localizable.strings; sourceTree = "<group>"; };
		E1 /* en */ = {isa = PBXFileReference; name = en; path = en.lproj/Localizable.strings; sourceTree = "<group>"; };
		E2 /* ja */ = {isa = PBXFileReference; name = ja; path = ja.lproj/Localizable.strings; sourceTree = "<group>"; };
		E3 /* zh-Hant */ = {isa = PBXFileReference; name = "zh-Hant"; path = "zh-Hant.lproj/Localizable.strings"; sourceTree = "<group>"; };
	};
	rootObject = P1 /* Project object */;
}
`;
  const wiring = text =>
    pbxprojWiringFindings(text, Object.keys(NATIVE_TABLES)).map(f => `${f.kind} ${f.where}`);
  check('a variant group in the widget\'s Resources phase with every table and region', wiring(pbxproj()), []);
  check('tables only another target copies', wiring(pbxproj({ phase: '' })), ['phase HomeAccountWidget']);
  check('a language the variant group lacks', wiring(pbxproj({ children: 'E1, E3,' })), ['table ja']);
  check('a region the project does not know', wiring(pbxproj({ regions: 'en, Base, ja,' })), ['region zh-Hant']);

  // scan 6: display literals in the widget's Swift
  const swift = (source, keys = ['app.title']) =>
    findSwiftDisplayLiterals(source, new Set(keys)).map(hit => `${hit.line} ${hit.reason}`);
  check('a gallery name written in English', swift('.configurationDisplayName("Home Account")'), ['1 not a key']);
  check('a verbatim name', swift('Text(verbatim: "Home Account")'), ['1 verbatim']);
  check('a verbatim key is still verbatim', swift('Text(verbatim: "app.title")'), ['1 verbatim']);
  check('an interpolated key', swift(String.raw`Text("app.\(name)")`), ['1 interpolated']);
  check('a Label title', swift('Label("Saved", systemImage: "checkmark")'), ['1 not a key']);
  check('a gallery description', swift('.description("Shows this month")'), ['1 not a key']);
  check('an accessibility label', swift('.accessibilityLabel("Locked")'), ['1 not a key']);
  check('a computed key', swift('static var appName: LocalizedStringKey { "Home Account" }'), ['1 not a key']);
  check('a stored key', swift('let name: LocalizedStringKey = "Home Account"'), ['1 not a key']);
  check(
    'the three lookup calls',
    swift('LocalizedStringKey("Home")\nNSLocalizedString("Home", comment: "")\nString(localized: "Home")'),
    ['1 not a key', '2 not a key', '3 not a key']
  );
  check('a literal on the line after its head', swift('Text(\n    "Home Account"\n)'), ['2 not a key']);
  check('a module-qualified Text', swift('SwiftUI.Text("Saved")'), ['1 not a key']);
  check('a raw string', swift('Text(#"Saved"#)'), ['1 not a key']);
  check('a URL before a hit is not a comment', swift('let url = "home://widget"; Text("Saved")'), ['1 not a key']);
  check('a key of the en table', swift('Text("app.title")'), []);
  check('the computed key the widget names itself with', swift('static var appName: LocalizedStringKey { "app.title" }'), []);
  check('a string the snapshot carries', swift('Text(labels.title)'), []);
  check('a UIKit label is not a head', swift('let label = UILabel(frame: .zero)'), []);
  check('a view whose name ends in Text is not a head', swift('MyText("x")'), []);
  check('another view whose name ends in Text', swift('RichText("Saved")'), []);
  check('a head in a line comment', swift('// Text("Home Account")'), []);
  check('a head in a nested block comment', swift('/* outer /* Text("x") */ Text("y") */'), []);
  check('an image or symbol name', swift('Image("logo")\nImage(systemName: "lock.fill")'), []);

  const failed = cases.filter(c => !c.ok);
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
  console.log(`check-i18n self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
