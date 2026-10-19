#!/usr/bin/env node
/**
 * Checks that every user-facing string reaches the translation catalog.
 *
 * TranslationService.t() returns the key itself when a lookup misses, and
 * loading a locale replaces the whole dictionary, so there is no fallback to
 * English: a missing key renders as raw text like `import.noTransactions` —
 * silent in tests, visible in the UI. Five scans:
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
 *      whole content is `Unknown` or `Other`, in non-spec src/app
 *      (core/services/testing/ skipped). A missing category read `Unknown`
 *      on every locale until #497; the fallback is common.unknownCategory.
 *      `.ts` files are lexed with a regex-aware lexer copied from
 *      check-colors.mjs, so a comment never counts, and their inline
 *      `template:` strings are read the way scan 4 reads them. A word only
 *      a model reads, or one stored on the row, sits in one of two tables
 *      passed into fallbackFindings (ADR 0151), matched on file and text and
 *      tallied per row: a count that moves either way fails.
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
 *   - The `'User'` name fallbacks (the dashboard greeting, settings). The
 *     scan knows two words, the ones a missing category produced.
 *   - A word built from a constant: `const UNKNOWN = 'Unknown'` fails where
 *     it is declared, but `'Unk' + 'nown'`, or a word read from data, does
 *     not stand whole in any literal.
 *   - `'Unknown Merchant'`, a two-word default of the same kind.
 *   - A single word in a template's text node (`@else { Unknown }`), which
 *     is not a literal and which scan 4 leaves to review.
 *   - A quoted word inside markup held in a TypeScript string that is not
 *     an inline `template:`: only inline templates take the quoted-word path.
 *
 * `--self-test` exercises the parser against known shapes and exits non-zero
 * if the checker itself is broken; npm's i18n:check chains it first, as
 * prompts:check does. Reference documentation lives in docs/i18n.md.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
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

/** A string literal's whole content, when that content is a fallback word. */
const FALLBACK_WORD = /^(?:Unknown|Other)$/;
/** The same, quoted, in markup: an interpolation or bound attribute's literal. */
const QUOTED_FALLBACK = /(['"`])(Unknown|Other)\1/g;

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
 * Every string literal in `source` whose whole content is `Unknown` or
 * `Other`, as `{ line, word, text }` with `text` the trimmed line. `kind` is
 * `'ts'` or `'html'`. A `.ts` file is lexed for its literals and also read
 * through the markup path for its inline `template:` strings (offsets kept,
 * so the line is real); a literal both paths see is one hit.
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
  const defined = {};
  for (const locale of LOCALES) {
    defined[locale] = flatten(JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')));
  }

  /** key -> Set of `file:line` that reference it */
  const referenced = new Map();
  let dynamicCount = 0;
  const ariaOffences = [];
  const altOffences = [];
  const englishOffences = [];
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
    }
  }

  const staleAllowances = PROPER_NOUNS.map((row, index) => ({ row, index }))
    .filter(({ index }) => !allowedSeen.has(index))
    .map(({ row }) => row);

  const fallbackRows = [...MODEL_FACING_FALLBACKS, ...STORED_FALLBACKS];
  const fallbacks = fallbackFindings(fallbackFiles, fallbackRows);
  const allowedHits = rows => rows.reduce((sum, row) => sum + row.count, 0);

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
  console.log(
    `Checked ${fallbackFiles.length} files for an English "Unknown" or "Other" fallback ` +
      `(${fallbackRows.length} rows allow ${allowedHits(fallbackRows)} hits: ` +
      `${MODEL_FACING_FALLBACKS.length} model-facing for ${allowedHits(MODEL_FACING_FALLBACKS)}, ` +
      `${STORED_FALLBACKS.length} stored for ${allowedHits(STORED_FALLBACKS)}).`
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
        '(core/utils/category-display.utils.ts), or a key of its own (see docs/i18n.md). A word only\n' +
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
  if (failed) process.exit(1);

  console.log(
    'Every literal translation key resolves in every locale, no template hard-codes an aria-label, ' +
      'alt text or English sentence, and no code falls back to an English word a reader would see.'
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
