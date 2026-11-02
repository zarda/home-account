#!/usr/bin/env node
/**
 * Fails a resting fade: text or a glyph drawn at part strength through
 * `opacity` while nothing is happening to it.
 *
 * A fade is the quick way to mark a line as secondary, and nothing else in
 * the repo measures one. contrast:check scores token pairs at full strength,
 * so a token faded to 70% passes there at a ratio it never paints;
 * colors:check sees a token and is satisfied; the axe pass in the smoke suite
 * meets a fade only on the routes and states its walkthrough renders. The
 * high-contrast theme cannot reach one either: it strengthens the `--text-*`
 * tokens, and an opacity dims whatever colour the text ends up with, so a
 * reader who turned high contrast on still reads the line at 70%. Eleven
 * fades on the goal cards, the forecast and the Goals tab rested that way
 * (#533); they rest in --text-muted now. A resting fade is readable from one
 * file, so it is a gate (ADR 0145).
 *
 * Decisions worth stating, because each has a cheaper alternative that is
 * worse:
 *
 *   - Only a state that ends is exempt. A stylesheet `opacity` between 0 and
 *     1 passes in a `@keyframes` frame no fill mode holds, where a pulse is
 *     motion and the reduced-motion switches end it; under `:disabled` or
 *     `[disabled]`, where a control owes no contrast (WCAG 1.4.3) and the
 *     fade is what tells it from a live one; and in CDK's moving drag
 *     states, `.cdk-drag-preview`, `-placeholder`, `-animating` and
 *     `-dragging`. `.cdk-drag-handle` and `.cdk-drag-disabled` are not among
 *     them: both sit on an item at rest. Everything else fails, `:hover` and
 *     `@media` included: a line that fades under the pointer, or on a phone,
 *     is still a line somebody has to read.
 *   - A keyframe an animation holds does not end. The `to` frame, or `from`
 *     in reverse, of an animation a rule runs with a `forwards` or `both`
 *     fill fails like a resting fade: the element rests on it, and the
 *     reduced-motion switches cut the run to 0.01ms and leave the fill mode,
 *     so the frame holds from the first paint. A rule's
 *     `animation-fill-mode` and `animation-direction` longhands join each
 *     animation the rule names, so `animation: dim 1s forwards` beside
 *     `animation-direction: reverse` holds `from`. A `from` frame that `both`
 *     holds only through a delay passes.
 *   - A state sits on the faded element or on one around it. A compound
 *     joined to the next by `+` or `~` is a sibling, so
 *     `.a:disabled + .hint` fades a hint the reader still reads, and fails as
 *     `.row:has(:disabled) .hint` and `peer-disabled:opacity-60` do;
 *     `button:disabled .label` and `button:disabled > .icon` pass. A label
 *     beside its control (`input:disabled + label`) fails like a hint, since
 *     the gate cannot tell the two apart; it takes `--text-disabled`, not a
 *     fade or a row.
 *   - Each declaration is read with every selector above it, the way
 *     check-colors.mjs's statements() reads a stylesheet, not line by line
 *     the way check-motion.mjs does. The exempt states are nearly always
 *     nested (`&:disabled`, `&.cdk-drag-placeholder`), and a line scan sees
 *     the `opacity` line, never the `&` above it. The levels resolve the way
 *     Sass resolves them, `&` standing for the level above and a selector
 *     with no `&` sitting under it, so `.a:disabled { & + .hint {…} }` is the
 *     sibling fade it reads as. A declaration is exempt only when every
 *     selector its levels resolve to is: `.a:disabled, .b` still fades `.b`.
 *     The arms of an `:is(…)` or `:where(…)` count the same way, so
 *     `.a:is(:disabled, :hover)` still fades `.a:hover`.
 *   - A state named inside `:not(…)` or `:has(…)` is not the subject's own.
 *     `&:hover:not(:disabled)` is the live control under the pointer, and
 *     `.row:has(:disabled)` is a row, not a disabled control.
 *   - `opacity: 0` and `opacity: 1` pass. Hidden and full strength are not
 *     fades; they are how a reveal starts and ends.
 *   - A Tailwind `opacity-NN` below 100, an `opacity-[…]` or the arbitrary
 *     property `[opacity:…]` is the same fade, in an `.html` template, an
 *     inline `template:` or a stylesheet's `@apply`. Only a `disabled:` or
 *     `group-disabled:` variant is exempt; `hover:opacity-80` fails for the
 *     reason `:hover` does. `text-opacity-50` and `bg-opacity-50` are alpha
 *     inside a colour, a different utility.
 *   - Every `template:` and `styles:` string, quoted or in backticks, in a
 *     file that declares a `@Component` is read as the template or
 *     stylesheet it is, a file's second component included.
 *   - A fade that cannot be fixed at once is frozen in ALLOWED with its
 *     reason, the way check-motion.mjs freezes its own: counts may only go
 *     down, and staleness fails in both directions, so a repair edits this
 *     file in the same commit.
 *
 * What it deliberately cannot see:
 *   - A static `style="opacity: …"` attribute in a template: the template
 *     reader reads class names, not declarations. Nor `[style.opacity]` and
 *     `[ngStyle]` bindings, or an opacity set from TypeScript:
 *     `element.style.opacity`, a class added through classList or a host
 *     binding, an Angular animation's `style({ opacity })`.
 *   - `filter: opacity()`, and alpha inside a colour: `rgb(… / 60%)`, a
 *     `color-mix()` with `transparent`, a utility's `/60`.
 *   - `opacity: var(--x)`, a Sass variable or a `calc()`: only a literal
 *     number or percentage is read, here, in `opacity-[…]` and in
 *     `[opacity:…]`.
 *   - `fill-opacity`, `stroke-opacity` and the other SVG paint opacities.
 *   - Whether the faded element holds any text. A faded divider or image
 *     fails like a faded line; that is a row in ALLOWED with its reason, not
 *     an exemption.
 *   - A keyframe declared in another file. Each stylesheet is read on its
 *     own, and Angular scopes a component's keyframes to it under the
 *     default emulated encapsulation, which every component here keeps. So a
 *     global `@keyframes` (in `src/styles.scss`, or in a component with
 *     `ViewEncapsulation.None`) run from another stylesheet is missed, and
 *     so is one a Sass partial or mixin brings in. `src/styles.scss` and the
 *     tree's partials declare none.
 *   - A fill mode or a direction set in a rule that does not itself name the
 *     animation (`.a.done { animation-fill-mode: forwards; }`, or
 *     `&.r { animation-direction: reverse; }` under it); a paused animation,
 *     which rests on its first frame; and an `alternate` or
 *     `alternate-reverse` run held after an even number of iterations, which
 *     ends on `from` or on `to`.
 *   - The order and comma position of a rule's animation declarations. Its
 *     longhands join every animation it names, and each declaration only
 *     adds a fill or a reverse, so a later `animation-direction: normal`, a
 *     shorthand written after a direction longhand, or a `normal, reverse`
 *     list beside two animations moves the held frame unseen.
 *   - A `template:` that is not a string literal: a constant, or the strings
 *     of a concatenation after its first.
 *   - A spec's host template: `.spec.ts` files are not read.
 *
 * Reference documentation lives in docs/accessibility.md.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const SOURCE_ROOT = 'src';
const DOC = 'docs/accessibility.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/**
 * Resting fades that cannot be fixed at once, each with its reason. Counts
 * may only go down: a new hit in any file fails, and a file listed here whose
 * count dropped or reached zero fails until this table is edited to match,
 * so a repair edits it in the same commit.
 */
const ALLOWED = {
  'src/app/features/auth/login/login.component.html': {
    hits: 1,
    reason:
      "the sign-in card's tagline, opacity-80 over the translucent glass card. Its colour is chosen for the fade " +
      '(--text-secondary, not --text-muted), and login.component.spec.ts measures it through the fade at every ' +
      'stop of the gradient behind the card, in both themes',
  },
};

/** A row in ALLOWED: a positive integer hit count and a non-empty reason. */
export function allowedRowValid(row) {
  return (
    Number.isInteger(row.hits) &&
    row.hits > 0 &&
    typeof row.reason === 'string' &&
    row.reason.length > 0
  );
}

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line, and a brace inside a
 * comment cannot open or close a block. (Copied from check-motion.mjs, which
 * copied it from check-direction.mjs — each gate script stays runnable on its
 * own.)
 */
export function maskComments(source) {
  const out = source.split('');
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && next === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
    } else if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
    } else if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
    } else if (state === 'single' && c === "'" && source[i - 1] !== '\\') state = 'code';
    else if (state === 'double' && c === '"' && source[i - 1] !== '\\') state = 'code';
    else if (state === 'template' && c === '`' && source[i - 1] !== '\\') state = 'code';
    i += 1;
  }
  return out.join('');
}

/** `<!-- -->` blanked the same way. (Copied from check-colors.mjs.) */
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
 * (Copied from check-colors.mjs.)
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
      if (source[i] === '$' && source[i + 1] === '{') { i += 2; readCode(true, false); continue; }
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

/** The 1-based line of each offset, from a table of line starts. (Copied from check-colors.mjs.) */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The index just past the `)` that closes the `(` at `open`, quotes respected. (Copied from check-colors.mjs.) */
function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end === -1) return text.length;
      i = end;
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/**
 * A stylesheet cut into statements: each prelude (ending in `{`) and each
 * declaration or at-statement (ending in `;` or `}`), with the block it sits
 * in. `#{…}` interpolation and parentheses do not cut. (Copied from
 * check-colors.mjs.)
 */
function statements(masked) {
  const out = [];
  const stack = [0];
  let nextBlock = 1;
  let start = 0;
  let paren = 0;
  const push = (end, terminator) => {
    const raw = masked.slice(start, end);
    const text = raw.trim();
    if (text) {
      out.push({ start: start + (raw.length - raw.trimStart().length), text, block: stack.at(-1), terminator, opens: terminator === '{' ? nextBlock : null });
    }
  };
  for (let i = 0; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '"' || c === "'") {
      const end = masked.indexOf(c, i + 1);
      i = end === -1 ? masked.length : end;
    } else if (c === '#' && masked[i + 1] === '{') {
      const end = masked.indexOf('}', i);
      i = end === -1 ? masked.length : end;
    } else if (c === '(') paren += 1;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (paren === 0 && c === '{') {
      push(i, '{');
      stack.push(nextBlock);
      nextBlock += 1;
      start = i + 1;
    } else if (paren === 0 && (c === ';' || c === '}')) {
      push(i, c);
      if (c === '}' && stack.length > 1) stack.pop();
      start = i + 1;
    }
  }
  push(masked.length, '');
  return out;
}

/**
 * The start of every string that is a component's `styles:` value, on its
 * own or in an array: `styles: \`…\`` or `styles: [\`…\`, '…']`. (Copied from
 * check-colors.mjs.)
 */
function styleStrings(masked, strings) {
  const starts = new Set();
  for (const match of masked.matchAll(/(?<![\w$.])styles\s*:\s*(\[\s*)?/g)) {
    let quoteAt = match.index + match[0].length;
    for (const [start, end] of strings) {
      if (start <= quoteAt) continue;
      if (start !== quoteAt + 1) break;
      starts.add(start);
      const next = match[1] === undefined ? null : /^\s*,\s*/.exec(masked.slice(end + 1));
      if (next === null) break;
      quoteAt = end + 1 + next[0].length;
    }
  }
  return starts;
}

/**
 * Every `template:` string in a component file's `.ts` source, in backticks
 * or quotes, wherever the key stands: each `@Component` the file declares,
 * or any other object in it. Each comes with the number of lines before it,
 * so a line found in the template plus `offset` is the line in the file. It
 * reads the strings the way inlineStylesOf does, through lexTs, so a
 * `template:` in a comment is not read. A `${…}` substitution is kept: the
 * template reader reads class names, and a class a substitution picks is
 * still one.
 */
export function inlineTemplatesOf(source) {
  if (!/\btemplate\s*:/.test(source)) return [];
  const { masked, strings } = lexTs(source);
  const opens = new Set();
  for (const match of masked.matchAll(/(?<![\w$.])template\s*:\s*/g)) opens.add(match.index + match[0].length + 1);
  const lineAt = lineIndex(source);
  return strings
    .filter(([start]) => opens.has(start))
    .map(([start, end]) => ({ source: source.slice(start, end), offset: lineAt(start) - 1 }));
}

/**
 * A component's inline `styles:` strings, each with the number of lines
 * before it, so a line found in the CSS plus `offset` is the line in the
 * file. A `${…}` substitution is code, not CSS, and is blanked.
 */
export function inlineStylesOf(source) {
  if (!/\bstyles\s*:/.test(source)) return [];
  const { masked, strings } = lexTs(source);
  const starts = styleStrings(masked, strings);
  const lineAt = lineIndex(source);
  return strings
    .filter(([start]) => starts.has(start))
    .map(([start, end]) => ({
      source: source.slice(start, end).replace(/\$\{[^}]*\}/g, (code) => ' '.repeat(code.length)),
      offset: lineAt(start) - 1,
    }));
}

/** An at-rule whose blocks are the frames of an animation. */
const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes\b/i;

/** `:disabled` or `[disabled]`: the control's own switched-off state. */
const DISABLED = /:disabled(?![\w-])|\[\s*disabled\s*(?:[~|^$*]?=[^\]]*)?\]/i;

/** CDK's moving drag states. `.cdk-drag-handle` and `.cdk-drag-disabled` sit on an item at rest. */
const DRAG_STATE = /\.cdk-drag-(?:preview|placeholder|animating|dragging)(?![\w-])/;

/**
 * A Tailwind opacity utility with its variants: `opacity-80`,
 * `hover:!opacity-[.5]`, or the arbitrary property `[opacity:.5]`.
 */
const OPACITY_UTILITY = /(?<![\w-])((?:[\w-]+:)*)!?(?:opacity-(\d+|\[[^\]\s]+\])|\[opacity:([^\]\s]+)\])(?![\w-])/g;

/** The variants under which a utility fade is a disabled control's. */
const DISABLED_VARIANTS = new Set(['disabled', 'group-disabled']);

/** A pseudo-class whose argument names other elements, or what the subject is not. */
const RELATIONAL = /:(?:not|has)\(/gi;

/** A pseudo-class whose argument is a list of alternatives, any one of which matches. */
const ALTERNATIVES = /:(?:is|where)\(/gi;

/**
 * The fraction a literal opacity paints at — `0.7`, `.7` and `70%` all read
 * 0.7, `!important` aside — or null when the value is not a literal.
 */
export function fadeOf(value) {
  const literal = /^\s*\+?(\d+(?:\.\d*)?|\.\d+)(%?)\s*(?:!\s*important\s*)?$/i.exec(value);
  if (literal === null) return null;
  const amount = Number(literal[1]);
  return literal[2] === '%' ? amount / 100 : amount;
}

const isFade = (fraction) => fraction !== null && fraction > 0 && fraction < 1;

/** `prelude` split at its top-level commas: `:is(.a, .b)` stays one selector. */
function selectorList(prelude) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const c = prelude[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      parts.push(prelude.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(prelude.slice(from));
  return parts;
}

/** A selector with every `:not(…)` and `:has(…)` argument cut out. */
function ownStates(selector) {
  let out = '';
  let from = 0;
  RELATIONAL.lastIndex = 0;
  let match;
  while ((match = RELATIONAL.exec(selector)) !== null) {
    out += selector.slice(from, match.index);
    from = closeParen(selector, match.index + match[0].length - 1);
    RELATIONAL.lastIndex = from;
  }
  return out + selector.slice(from);
}

/**
 * A complex selector cut at its top-level combinators: each compound with
 * the combinator that joins it to the next one, null on the subject's own.
 * Whitespace beside `>`, `+` or `~` belongs to it, and whitespace alone is a
 * descendant. Brackets and parentheses do not cut, so `:nth-child(2n + 1)`
 * and `[class~="a"]` are one compound each. A leading combinator, a nested
 * `+ .hint` read on its own, has no compound before it and adds none.
 */
export function compoundsOf(selector) {
  const out = [];
  let depth = 0;
  let text = '';
  let joint = '';
  for (const c of selector.trim()) {
    if (depth === 0 && /[\s>+~]/.test(c)) {
      if (!/\s/.test(c)) joint = c;
      else if (joint === '') joint = ' ';
      continue;
    }
    if (joint !== '') {
      if (text !== '') out.push({ text, joint });
      text = '';
      joint = '';
    }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    text += c;
  }
  // A subject cut down to nothing (`.a + :not(.b)` once its `:not()` is out)
  // still leaves its combinator on the compound before it.
  if (text !== '') out.push({ text, joint: joint === '' ? null : joint });
  return out;
}

/** The combinators that put the compound on their left beside the subject, not around it. */
const SIBLING = new Set(['+', '~']);

/**
 * Whether one compound is disabled or being dragged. An `:is(…)` or
 * `:where(…)` is a selector list of its own: it puts the compound in a state
 * that ends only when every one of its arms does, so `:is(:disabled, :hover)`
 * is the hover fade it also reads as.
 */
function compoundInEndingState(compound) {
  let outside = '';
  const groups = [];
  let from = 0;
  ALTERNATIVES.lastIndex = 0;
  let match;
  while ((match = ALTERNATIVES.exec(compound)) !== null) {
    outside += compound.slice(from, match.index);
    from = closeParen(compound, match.index + match[0].length - 1);
    groups.push(compound.slice(match.index + match[0].length, from - 1));
    ALTERNATIVES.lastIndex = from;
  }
  outside += compound.slice(from);
  if (DISABLED.test(outside) || DRAG_STATE.test(outside)) return true;
  return groups.some((group) => selectorList(group).every(inEndingState));
}

/**
 * Whether one complex selector matches only a disabled or dragged element:
 * the state sits on the subject's own compound or on one that contains it.
 * A compound joined to the next by `+` or `~` is a sibling of the line, not
 * a control it belongs to, so `.a:disabled + .hint` fades a hint the reader
 * still reads, as `.row:has(:disabled) .hint` does.
 */
function inEndingState(selector) {
  return compoundsOf(ownStates(selector))
    .filter(({ joint }) => !SIBLING.has(joint))
    .some(({ text }) => compoundInEndingState(text));
}

/**
 * The full selectors a chain of preludes, outermost first, stands for, the
 * way Sass and CSS nesting resolve them: each `&` is the parent selector, and
 * a selector with no `&` sits under its parent, as a descendant or after its
 * own leading `>`, `+` or `~`. At-rules (`@media`, `@supports`, `@include`)
 * add no selector.
 */
export function resolvedSelectors(preludes) {
  let resolved = [''];
  for (const prelude of preludes) {
    if (prelude.startsWith('@')) continue;
    resolved = resolved.flatMap((parent) =>
      selectorList(prelude).map((selector) => {
        const own = selector.trim();
        if (parent === '') return own;
        return own.includes('&') ? own.replaceAll('&', parent) : `${parent} ${own}`;
      })
    );
  }
  return resolved;
}

/**
 * Whether a declaration under these preludes, outermost first, applies only
 * in a state that ends: a keyframe, or a chain whose every resolved selector
 * is disabled or being dragged. Other at-rules pass through.
 */
export function inPassingState(preludes) {
  if (preludes.some((prelude) => KEYFRAMES.test(prelude))) return true;
  return resolvedSelectors(preludes).every(inEndingState);
}

/** Every opacity utility in `text` that fades, unless a variant says it is disabled. */
function utilityFades(text) {
  const fades = [];
  OPACITY_UTILITY.lastIndex = 0;
  let match;
  while ((match = OPACITY_UTILITY.exec(text)) !== null) {
    if (match[1].split(':').some((variant) => DISABLED_VARIANTS.has(variant))) continue;
    const value =
      match[3] !== undefined
        ? fadeOf(match[3])
        : match[2].startsWith('[')
          ? fadeOf(match[2].slice(1, -1))
          : Number(match[2]) / 100;
    if (isFade(value)) fades.push({ index: match.index, text: match[0] });
  }
  return fades;
}

/**
 * An unquoted `url(…)` on one line. Its `//` (`url(http://…)`, `url(//cdn…)`)
 * would open a line comment in maskComments, which blanks the `)` with it;
 * statements() would then wait for that paren to close and read the rest of
 * the file as one statement.
 */
const UNQUOTED_URL = /\burl\(([^)'"\n]*)\)/gi;

/** The name a `@keyframes` prelude declares. */
const KEYFRAMES_NAME = /^@(?:-[a-z]+-)?keyframes\s+(['"]?)([\w-]+)\1/i;

/** An `animation` shorthand or one of the longhands that decide its last frame. */
const ANIMATION = /^(?:-webkit-)?animation(-name|-fill-mode|-direction)?\s*:([\s\S]*)$/i;

/** The fill modes that keep an animation's last frame after it ends. */
const HOLDS = new Set(['forwards', 'both']);

/** The directions whose last frame is `from`, not `to`. */
const REVERSED = new Set(['reverse', 'alternate-reverse']);

/** A keyframe selector as a percentage: `from` is 0, `to` is 100. */
function framePercent(frame) {
  const text = frame.trim().toLowerCase();
  return text === 'from' ? 0 : text === 'to' ? 100 : Number.parseFloat(text);
}

/**
 * The frames a stylesheet's own keyframes rest on, by name: the last frame of
 * each animation a rule runs with a `forwards` or `both` fill, which is `to`
 * (100%), or `from` (0%) in reverse. Each animation in a shorthand's comma
 * list is read on its own, its name quoted or not. A rule's
 * `animation-fill-mode` and `animation-direction` longhands join every
 * animation the same rule names, whatever their order or place in a comma
 * list, so a fill from one and a direction from the other still meet. The
 * reduced-motion switches cut a run to 0.01ms and one iteration and leave
 * the fill mode, so a held frame rests from the first paint.
 */
export function heldFrames(list) {
  const names = new Set();
  for (const statement of list) {
    const name = statement.terminator === '{' ? KEYFRAMES_NAME.exec(statement.text)?.[2] : undefined;
    if (name !== undefined) names.add(name);
  }
  const held = new Map();
  const hold = (name, reversed) => {
    if (!held.has(name)) held.set(name, new Set());
    held.get(name).add(reversed ? 0 : 100);
  };
  // Per rule: what each animation's own shorthand says, and what the rule's longhands say for all of them.
  const rules = new Map();
  for (const statement of list) {
    const declaration = statement.terminator === '{' ? null : ANIMATION.exec(statement.text);
    if (declaration === null) continue;
    if (!rules.has(statement.block)) rules.set(statement.block, { runs: new Map(), holds: false, reversed: false });
    const rule = rules.get(statement.block);
    const longhand = declaration[1] !== undefined;
    for (const animation of selectorList(declaration[2])) {
      const tokens = animation
        .trim()
        .split(/\s+(?![^(]*\))/)
        .map((token) => token.replace(/!important$/i, '').replace(/^(['"])(.*)\1$/, '$2'));
      const holds = tokens.some((token) => HOLDS.has(token.toLowerCase()));
      const reversed = tokens.some((token) => REVERSED.has(token.toLowerCase()));
      for (const name of tokens.filter((token) => names.has(token))) {
        const run = rule.runs.get(name) ?? { holds: false, reversed: false };
        if (!longhand) {
          run.holds ||= holds;
          run.reversed ||= reversed;
        }
        rule.runs.set(name, run);
      }
      if (longhand) {
        rule.holds ||= holds;
        rule.reversed ||= reversed;
      }
    }
  }
  for (const rule of rules.values()) {
    for (const [name, run] of rule.runs) if (run.holds || rule.holds) hold(name, run.reversed || rule.reversed);
  }
  return held;
}

/** Whether a declaration under these preludes sits in a keyframe its animation rests on. */
export function inHeldFrame(preludes, held) {
  const at = preludes.findIndex((prelude) => KEYFRAMES.test(prelude));
  if (at === -1 || at + 1 >= preludes.length) return false;
  const ends = held.get(KEYFRAMES_NAME.exec(preludes[at])?.[2]);
  return ends !== undefined && selectorList(preludes[at + 1]).some((frame) => ends.has(framePercent(frame)));
}

/**
 * Every resting fade in a stylesheet: an `opacity` between 0 and 1, or an
 * `@apply` of an opacity utility, outside a state that ends. A keyframe ends
 * unless its animation holds it. Each hit names the selectors above it.
 */
export function scanStylesheet(source) {
  const masked = maskComments(
    source.replace(UNQUOTED_URL, (url, address) => `${url.slice(0, 4)}${' '.repeat(address.length)})`)
  );
  const lineAt = lineIndex(masked);
  const parent = new Map();
  const prelude = new Map();
  const hits = [];
  const list = statements(masked);
  const held = heldFrames(list);

  for (const statement of list) {
    if (statement.terminator === '{') {
      parent.set(statement.opens, statement.block);
      prelude.set(statement.opens, statement.text.replace(/\s+/g, ' '));
      continue;
    }
    const fades = [];
    if (statement.text.startsWith('@apply')) {
      fades.push(...utilityFades(statement.text).map((hit) => hit.text));
    } else {
      const declaration = /^opacity\s*:([\s\S]*)$/i.exec(statement.text);
      if (declaration !== null && isFade(fadeOf(declaration[1]))) fades.push(statement.text.replace(/\s+/g, ' '));
    }
    if (fades.length === 0) continue;

    const chain = [];
    for (let block = statement.block; block !== 0; block = parent.get(block)) chain.unshift(prelude.get(block));
    if (!inHeldFrame(chain, held) && inPassingState(chain)) continue;
    for (const text of fades) hits.push({ line: lineAt(statement.start), text, where: chain.join(' ') });
  }
  return hits;
}

/**
 * Every opacity utility that fades in a template, at its line plus `offset`
 * (the lines before an inline template in its `.ts` file).
 */
export function scanTemplate(source, offset = 0) {
  const masked = maskHtmlComments(source);
  const lineAt = lineIndex(masked);
  return utilityFades(masked).map((hit) => ({ line: lineAt(hit.index) + offset, text: hit.text }));
}

/**
 * The ratchet over ALLOWED: every hit in a file with no row, or with more
 * hits than its row, fails; a row whose file has fewer hits, none, or no
 * longer exists is stale and fails too.
 */
export function ratchet(byFile, allowed, exists = existsSync) {
  const findings = [];
  for (const [file, hits] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = allowed[file];
    if (row === undefined || hits.length > row.hits) {
      for (const hit of hits) findings.push({ kind: 'fade', file, ...hit });
    } else if (hits.length < row.hits) {
      findings.push({
        kind: 'stale',
        file,
        line: 1,
        text: `${hits.length} resting fade(s) left but ALLOWED still says ${row.hits}`,
      });
    }
  }
  for (const file of Object.keys(allowed).sort()) {
    if (byFile.has(file)) continue;
    findings.push({
      kind: 'stale',
      file,
      line: 1,
      text: `ALLOWED says ${allowed[file].hits} but the file is ${exists(file) ? 'clean' : 'gone'}`,
    });
  }
  return findings;
}

/** Whether a file is read: a stylesheet, a template, or a `.ts` that may hold inline ones. Specs are not. */
function readsFile(path) {
  return /\.(?:s?css|html)$/.test(path) || (path.endsWith('.ts') && !path.endsWith('.spec.ts'));
}

/**
 * One file's resting fades, at their lines in the file and in line order,
 * with the stylesheets and templates it held. A component's inline
 * `template:` and `styles:` are read here, offset to the file's own lines.
 */
export function scanFile(path, source) {
  const scanned = { stylesheets: 0, templates: 0, hits: [] };
  if (!readsFile(path)) return scanned;
  if (/\.s?css$/.test(path)) {
    scanned.stylesheets += 1;
    scanned.hits.push(...scanStylesheet(source));
  } else if (path.endsWith('.html')) {
    scanned.templates += 1;
    scanned.hits.push(...scanTemplate(source));
  } else if (source.includes('@Component')) {
    for (const inline of inlineTemplatesOf(source)) {
      scanned.templates += 1;
      scanned.hits.push(...scanTemplate(inline.source, inline.offset));
    }
    for (const styles of inlineStylesOf(source)) {
      scanned.stylesheets += 1;
      scanned.hits.push(...scanStylesheet(styles.source).map((hit) => ({ ...hit, line: hit.line + styles.offset })));
    }
  }
  scanned.hits.sort((a, b) => a.line - b.line);
  return scanned;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (readsFile(entry)) found.push(path);
  }
  return found;
}

function posix(path) {
  return path.split(sep).join('/');
}

const ADVICE = {
  fade:
    'rest it in a token at full strength (--text-muted for secondary text, --text-disabled beside a disabled ' +
    'control); a fade passes only in a @keyframes frame no fill mode holds, on or inside a :disabled or ' +
    '[disabled] element, or in a CDK drag state',
  stale: 'the ratchet is stale — lower or remove the entry in scripts/check-opacity.mjs',
};

function run() {
  const byFile = new Map();
  let stylesheets = 0;
  let templates = 0;

  for (const path of walk(SOURCE_ROOT)) {
    const scanned = scanFile(path, readFileSync(path, 'utf8'));
    stylesheets += scanned.stylesheets;
    templates += scanned.templates;
    if (scanned.hits.length > 0) byFile.set(posix(path), scanned.hits);
  }

  const findings = ratchet(byFile, ALLOWED);
  const allowedTotal = Object.values(ALLOWED).reduce((sum, row) => sum + row.hits, 0);
  console.log(
    `Checked ${stylesheets} stylesheets and ${templates} templates, inline ones included, for resting ` +
      `fades (${allowedTotal} recorded).`
  );

  if (findings.length > 0) {
    console.error(`\n${findings.length} resting fade problem(s):\n`);
    for (const finding of findings) {
      const where = finding.where ? `  in ${finding.where}` : '';
      console.error(`  ${finding.file}:${finding.line}  ${finding.text}${where}`);
      console.error(`      ${ADVICE[finding.kind]}`);
    }
    console.error(
      `\nA fade dims whatever colour the text ends up with, so no token pair measures it and\n` +
        `the high-contrast theme cannot strengthen it. Rest the line in a token at full\n` +
        `strength, or keep the fade to a state that ends. Reference: ${DOC}.\n`
    );
    process.exit(1);
  }

  console.log('No resting fade outside an unheld keyframe, a disabled control or a drag that is not recorded.');
}

function selfTest() {
  const results = [];
  const check = (name, actual, expected) => {
    results.push({
      name,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
      actual,
      expected,
    });
  };

  const css = (source) => scanStylesheet(source).map((hit) => hit.text);
  const html = (source) => scanTemplate(source).map((hit) => hit.text);
  const findings = (byFile, allowed, exists = () => true) =>
    ratchet(new Map(Object.entries(byFile)), allowed, exists).map((f) => `${f.kind} ${f.file}:${f.line} ${f.text}`);
  const fade = (line) => ({ line, text: 'opacity: 0.5' });
  const ROW = { hits: 1, reason: 'measured through its fade' };

  // --- a stylesheet fade must hit ------------------------------------------
  check('a resting fade', css('.a { opacity: 0.7; }'), ['opacity: 0.7']);
  check('a fade with a leading dot', css('.a { opacity: .7; }'), ['opacity: .7']);
  check('a fade as a percentage', css('.a { opacity: 70%; }'), ['opacity: 70%']);
  check('an important fade', css('.a { opacity: 0.7 !important; }'), ['opacity: 0.7 !important']);
  check('a fade as the block\'s last declaration, with no semicolon', css('.a { opacity: 0.7 }'), ['opacity: 0.7']);
  check('a fade wrapped across lines', css('.a {\n  opacity:\n    0.7;\n}'), ['opacity: 0.7']);
  check('a fade under :hover', css('.a:hover { opacity: 0.8; }'), ['opacity: 0.8']);
  check('a fade under a nested &:hover', css('.a {\n  &:hover {\n    opacity: 0.8;\n  }\n}'), ['opacity: 0.8']);
  check(
    'a fade inside @media',
    css('@media (max-width: 600px) {\n  .a { opacity: 0.6; }\n}'),
    ['opacity: 0.6']
  );
  check(
    'a fade under &:hover:not(:disabled), the live control',
    css('.a {\n  &:hover:not(:disabled) {\n    opacity: 0.8;\n  }\n}'),
    ['opacity: 0.8']
  );
  check('a fade under :not([disabled])', css('.a:not([disabled]) { opacity: 0.5; }'), ['opacity: 0.5']);
  check('a fade on a row that only holds a disabled control', css('.row:has(button:disabled) { opacity: 0.5; }'), [
    'opacity: 0.5',
  ]);
  check('a selector list with one live selector', css('.a:disabled, .b { opacity: 0.5; }'), ['opacity: 0.5']);
  check('an :is() with one live arm', css('.a:is(:disabled, :hover) { opacity: .5; }'), ['opacity: .5']);
  check('a :where() with one live arm', css('.a:where([disabled], :hover) { opacity: .5; }'), ['opacity: .5']);
  check(
    'an :is() nested in an :is(), with one live arm',
    css('.a:is(:is(:disabled, :hover), [disabled]) { opacity: .5; }'),
    ['opacity: .5']
  );
  check('a :not(:disabled) inside :is()', css('.a:is(:not(:disabled)) { opacity: .5; }'), ['opacity: .5']);
  check('a draggable item at rest', css('.item.cdk-drag { opacity: 0.5; }'), ['opacity: 0.5']);
  check('a drag handle at rest', css('.a {\n  .cdk-drag-handle { opacity: 0.5; }\n}'), ['opacity: 0.5']);
  check('an item whose drag is disabled', css('.a {\n  &.cdk-drag-disabled { opacity: 0.5; }\n}'), ['opacity: 0.5']);
  check('a fade in an @apply', css('.a { @apply text-sm opacity-60; }'), ['opacity-60']);
  check('a hover fade in an @apply', css('.a { @apply hover:opacity-60; }'), ['hover:opacity-60']);
  check('a hint after a disabled control', css('.toggle:disabled + .hint { opacity: 0.6; }'), ['opacity: 0.6']);
  check('a hint among a disabled control\'s later siblings', css('input:disabled ~ .help { opacity: 0.6; }'), [
    'opacity: 0.6',
  ]);
  check("a disabled checkbox's sibling label", css('input:disabled + label { opacity: 0.6; }'), ['opacity: 0.6']);
  check('a sibling of a drag preview', css('.cdk-drag-preview + .x { opacity: 0.5; }'), ['opacity: 0.5']);
  check(
    'a nested & + beside a disabled control',
    css('.toggle {\n  &:disabled + .hint { opacity: 0.6; }\n}'),
    ['opacity: 0.6']
  );
  check(
    'a sibling nested under a disabled control',
    css('.toggle:disabled {\n  & ~ .hint { opacity: 0.6; }\n}'),
    ['opacity: 0.6']
  );
  check(
    'a leading + nested under a disabled control',
    css('.toggle:disabled {\n  + .hint { opacity: 0.6; }\n}'),
    ['opacity: 0.6']
  );
  check('a sibling cut down to its :not()', css('.a:disabled + :not(.b) { opacity: 0.6; }'), ['opacity: 0.6']);
  check(
    'a last frame held forwards',
    css('.note { animation: settle 0.3s ease-out forwards; }\n@keyframes settle {\n  from { opacity: 0; }\n  to { opacity: 0.7; }\n}'),
    ['opacity: 0.7']
  );
  check(
    'a 100% frame held both ways',
    css('.hint { animation: dim 1s both; }\n@keyframes dim { 0% { opacity: 1; } 100% { opacity: .5; } }'),
    ['opacity: .5']
  );
  check(
    'a last frame held through the longhands',
    css('.a {\n  animation-name: dim;\n  animation-duration: 1s;\n  animation-fill-mode: forwards;\n}\n@keyframes dim { to { opacity: 0.5; } }'),
    ['opacity: 0.5']
  );
  check(
    'a reversed animation held on its from frame',
    css('.a { animation: dim 1s reverse forwards; }\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    ['opacity: 0.5']
  );
  check(
    'an alternate-reverse run held on its from frame',
    css('.a { animation: dim 1s infinite alternate-reverse both; }\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    ['opacity: 0.5']
  );
  check(
    'a reversed longhand held on its from frame',
    css('.a {\n  animation: dim 1s forwards;\n  animation-direction: reverse;\n}\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    ['opacity: 0.5']
  );
  check(
    'a reversed run held by its fill longhand',
    css('.a {\n  animation: dim 1s reverse;\n  animation-fill-mode: forwards;\n}\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    ['opacity: 0.5']
  );
  check(
    'an endless pulse held both ways, which reduced motion runs once',
    css('.a { animation: beat 1s infinite both; }\n@keyframes beat { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }'),
    ['opacity: 0.35']
  );
  check(
    'a held frame past a timing function with commas',
    css('.a { animation: dim 1s cubic-bezier(0.4, 0, 0.2, 1) forwards; }\n@keyframes dim { to { opacity: 0.5; } }'),
    ['opacity: 0.5']
  );
  check(
    'a quoted animation name held forwards',
    css('.a { animation: "dim" 1s forwards; }\n@keyframes dim { to { opacity: 0.6; } }'),
    ['opacity: 0.6']
  );
  check(
    'a quoted keyframes name held forwards',
    css('.a { animation: dim 1s forwards; }\n@keyframes "dim" { to { opacity: 0.6; } }'),
    ['opacity: 0.6']
  );
  check(
    'a prefixed animation held forwards',
    css('.a { -webkit-animation: dim 1s forwards; }\n@-webkit-keyframes dim { to { opacity: 0.5; } }'),
    ['opacity: 0.5']
  );
  check(
    'a fill mode in capitals',
    css('.a { animation: dim 1s FORWARDS; }\n@keyframes dim { to { opacity: 0.5; } }'),
    ['opacity: 0.5']
  );

  // --- a stylesheet fade must not hit ---------------------------------------
  // The load-bearing half: each shape below is a state that ends, or no fade
  // at all. A gate that fired on these would be turned off within a week.
  check(
    'a keyframe',
    css('@keyframes pulse {\n  0% { opacity: 0.8; }\n  100% { opacity: 0; }\n}'),
    []
  );
  check('a prefixed keyframe', css('@-webkit-keyframes pulse { 50% { opacity: 0.7; } }'), []);
  check('a keyframe selector list', css('@keyframes beat {\n  0%,\n  100% { opacity: 0.35; }\n}'), []);
  check(
    'an endless pulse with no fill mode',
    css('.a { animation: beat 1.4s ease-in-out infinite; }\n@keyframes beat { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.7; } }'),
    []
  );
  check(
    'a held animation\'s middle frame',
    css('.a { animation: dim 1s forwards; }\n@keyframes dim { 50% { opacity: 0.5; } to { opacity: 1; } }'),
    []
  );
  check(
    'a from frame held only through a delay',
    css('.a { animation: dim 1s 0.2s both; }\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    []
  );
  check(
    'an unheld animation beside a held one',
    css('.a { animation: rise 1s forwards, beat 1s infinite; }\n@keyframes beat { 0%, 100% { opacity: 0.35; } }'),
    []
  );
  check(
    'a reversed run does not rest on its to frame',
    css('.a {\n  animation: dim 1s reverse;\n  animation-fill-mode: forwards;\n}\n@keyframes dim { from { opacity: 1; } to { opacity: 0.5; } }'),
    []
  );
  check('a flat :disabled', css('.a:disabled { opacity: 0.5; }'), []);
  check('a nested &:disabled', css('.a {\n  &:disabled {\n    opacity: 0.5;\n  }\n}'), []);
  check('a nested &[disabled]', css('.a {\n  &[disabled] { opacity: 0.5; }\n}'), []);
  check('a disabled control\'s own label', css('button:disabled .label { opacity: 0.5; }'), []);
  check('a disabled control\'s own icon, as its child', css('button:disabled > .icon { opacity: 0.5; }'), []);
  check(
    'a label inside a disabled fieldset, past a sibling',
    css('fieldset:disabled .a + .label { opacity: 0.5; }'),
    []
  );
  check('a disabled control after a sibling', css('.a + button:disabled { opacity: 0.5; }'), []);
  check(
    'a disabled control\'s label past its own :nth-child(2n + 1)',
    css('button:disabled:nth-child(2n + 1) .label { opacity: 0.5; }'),
    []
  );
  check(
    'two levels under a disabled state',
    css('.a {\n  &:disabled {\n    .icon { opacity: 0.5; }\n  }\n}'),
    []
  );
  check('a nested &.cdk-drag-placeholder', css('.a {\n  &.cdk-drag-placeholder {\n    opacity: 0.3;\n  }\n}'), []);
  check('a nested &.cdk-drag-preview', css('.a {\n  &.cdk-drag-preview { opacity: 0.95; }\n}'), []);
  check('a flat .cdk-drag-animating', css('.cdk-drag-animating { opacity: 0.5; }'), []);
  check(
    'a selector list in which every selector is in a state that ends',
    css('.a:disabled, .a.cdk-drag-placeholder { opacity: 0.5; }'),
    []
  );
  check('an :is() in which every arm is disabled', css('.a:is(:disabled, [disabled]) { opacity: 0.5; }'), []);
  check(
    'a :where() of drag states',
    css('.a:where(.cdk-drag-preview, .cdk-drag-placeholder) { opacity: 0.5; }'),
    []
  );
  check('opacity 0', css('.a { opacity: 0; }'), []);
  check('opacity 1', css('.a { opacity: 1; }'), []);
  check('opacity 100%', css('.a { opacity: 100%; }'), []);
  check('a commented-out fade', css('// .a { opacity: 0.5; }'), []);
  check('a block-commented fade', css('/* .a { opacity: 0.5; } */'), []);
  check('an opacity transition', css('.a { transition: opacity 0.2s; will-change: opacity; }'), []);
  check('a custom property', css('.a { --fade-opacity: 0.5; }'), []);
  check('a disabled fade in an @apply', css('.a { @apply disabled:opacity-50; }'), []);
  check('an @apply under &:disabled', css('.a {\n  &:disabled { @apply opacity-50; }\n}'), []);
  // What it cannot see, pinned so a change to that is a decision.
  check('opacity: var() is not read', css('.a { opacity: var(--fade); }'), []);
  check('a Sass variable is not read', css('.a { opacity: $fade; }'), []);
  check('filter: opacity() is not read', css('.a { filter: opacity(0.5); }'), []);
  check('the SVG paint opacities are not read', css('.a { fill-opacity: 0.5; stroke-opacity: 0.5; }'), []);
  check(
    'a fill mode set in another rule is not read',
    css('.a { animation: dim 1s; }\n.a.done { animation-fill-mode: forwards; }\n@keyframes dim { to { opacity: 0.6; } }'),
    []
  );
  check(
    'a paused animation is not read',
    css('.a { animation: dim 1s paused; }\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    []
  );
  check(
    'a direction set in another rule is not read',
    css(
      '.a {\n  animation: dim 1s forwards;\n  &.r { animation-direction: reverse; }\n}\n@keyframes dim { from { opacity: 0.5; } }'
    ),
    []
  );
  check(
    'an alternate run held after an even count is not read',
    css('.a { animation: dim 1s 2 alternate forwards; }\n@keyframes dim { from { opacity: 0.5; } to { opacity: 1; } }'),
    []
  );
  check(
    'an alternate-reverse run held after an even count is not read',
    css(
      '.a { animation: dim 1s 2 alternate-reverse forwards; }\n@keyframes dim { from { opacity: 1; } to { opacity: 0.5; } }'
    ),
    []
  );
  check(
    'the order and comma position of the direction declarations are not read',
    [
      css(
        '.a { animation: dim 1s reverse forwards; animation-direction: normal; }\n@keyframes dim { to { opacity: 0.5; } }'
      ),
      css(
        '.a { animation-direction: reverse; animation: dim 1s forwards; }\n@keyframes dim { to { opacity: 0.5; } }'
      ),
      css(
        '.a { animation: dim 1s forwards, other 1s forwards; animation-direction: normal, reverse; }\n' +
          '@keyframes dim { to { opacity: 0.5; } }\n@keyframes other { to { opacity: 1; } }'
      ),
    ],
    [[], [], []]
  );

  // --- a template fade must hit ---------------------------------------------
  check('an opacity-80 class', html('<p class="text-sm opacity-80">x</p>'), ['opacity-80']);
  check('a hover:opacity-80 class', html('<p class="hover:opacity-80">x</p>'), ['hover:opacity-80']);
  check('a hint after a disabled peer', html('<p class="peer-disabled:opacity-60">x</p>'), ['peer-disabled:opacity-60']);
  check('an important utility', html('<p class="!opacity-50">x</p>'), ['!opacity-50']);
  check('a class binding', html('<p [class.opacity-60]="dim">x</p>'), ['opacity-60']);
  check('an ngClass key', html('<p [ngClass]="{ \'opacity-50\': dim }">x</p>'), ['opacity-50']);
  check('an arbitrary fraction', html('<p class="opacity-[.5]">x</p>'), ['opacity-[.5]']);
  check('an arbitrary percentage', html('<p class="opacity-[50%]">x</p>'), ['opacity-[50%]']);
  check('the faintest step', html('<p class="opacity-5">x</p>'), ['opacity-5']);
  check('an arbitrary property', html('<p class="[opacity:0.5]">x</p>'), ['[opacity:0.5]']);
  check('an arbitrary property under hover', html('<p class="hover:[opacity:.5]">x</p>'), ['hover:[opacity:.5]']);
  check('an arbitrary property in an @apply', css('.a { @apply [opacity:50%]; }'), ['[opacity:50%]']);

  // --- a template fade must not hit -----------------------------------------
  check('a disabled: variant', html('<button class="disabled:opacity-50">x</button>'), []);
  check('a group-disabled: variant', html('<span class="group-disabled:opacity-40">x</span>'), []);
  check('a disabled: variant behind a breakpoint', html('<button class="md:disabled:opacity-50">x</button>'), []);
  check('opacity-0 and opacity-100', html('<p class="opacity-0 group-hover:opacity-100">x</p>'), []);
  check('alpha inside a colour utility', html('<p class="text-opacity-50 bg-opacity-50">x</p>'), []);
  check('an opacity transition utility', html('<p class="transition-opacity">x</p>'), []);
  check('a commented-out class', html('<!-- <p class="opacity-50">x</p> -->'), []);
  check('an arbitrary var() is not read', html('<p class="opacity-[var(--fade)]">x</p>'), []);
  check('a disabled arbitrary property', html('<button class="disabled:[opacity:0.5]">x</button>'), []);
  check('an arbitrary property at full strength', html('<p class="[opacity:1]">x</p>'), []);

  // --- files, read the way run() reads them ---------------------------------
  // [stylesheets, templates, hits as "line text"]
  const file = (path, source) => {
    const scanned = scanFile(path, source);
    return [scanned.stylesheets, scanned.templates, scanned.hits.map((hit) => `${hit.line} ${hit.text}`)];
  };
  const templated =
    "@Component({\n  selector: 'app-x',\n  template: `\n    <p class=\"opacity-70\">x</p>\n  `,\n})\nclass X {}\n";
  check('an inline template fade, at its line in the file', file('x.component.ts', templated), [0, 1, ['4 opacity-70']]);
  const styled =
    "@Component({\n  selector: 'app-y',\n  styles: [`\n    .a { opacity: 0.6; }\n    .b:disabled { opacity: 0.5; }\n  `],\n})\nclass Y {}\n";
  check('an inline style fade, at its line in the file', file('y.component.ts', styled), [1, 0, ['4 opacity: 0.6']]);
  check(
    "a component's inline fades, in line order",
    file('z.component.ts', '@Component({\n  styles: `.a { opacity: 0.6; }`,\n  template: `<p class="opacity-70">x</p>`,\n})\n'),
    [1, 1, ['2 opacity: 0.6', '3 opacity-70']]
  );
  check(
    'a quoted inline template fade',
    file('q.component.ts', "@Component({\n  selector: 'app-q',\n  template: '<span class=\"opacity-60\">x</span>',\n})\nclass Q {}\n"),
    [0, 1, ['3 opacity-60']]
  );
  check(
    'a double-quoted inline template fade',
    file('d.component.ts', '@Component({\n  template: "<span class=\'opacity-60\'>x</span>",\n})\nclass D {}\n'),
    [0, 1, ['2 opacity-60']]
  );
  check(
    "a second component's inline template fade",
    file(
      'two.component.ts',
      '@Component({\n  template: `<p>a</p>`,\n})\nclass A {}\n\n@Component({\n  template: `<p class="opacity-60">b</p>`,\n})\nclass B {}\n'
    ),
    [0, 2, ['7 opacity-60']]
  );
  check(
    'a template: in a comment is not read',
    file('c.component.ts', '// template: `<p class="opacity-60">x</p>`\n@Component({ templateUrl: \'./c.html\' })\nclass C {}\n'),
    [0, 0, []]
  );
  check(
    'an inline template whose markup a string above repeats, at its own line',
    file(
      'e.component.ts',
      'const a = `\n<p class="opacity-60">x</p>`;\n@Component({\n  template: `\n<p class="opacity-60">x</p>`,\n})\nclass E {}\n'
    ),
    [0, 1, ['5 opacity-60']]
  );
  check(
    'a fade in a template substitution',
    file('s.component.ts', '@Component({\n  template: `<p class="${DIM ? \'opacity-60\' : \'\'}">x</p>`,\n})\nclass S {}\n'),
    [0, 1, ['2 opacity-60']]
  );
  check(
    'a key that ends in template is not read',
    file(
      'k.component.ts',
      "@Component({\n  template: `<p>a</p>`,\n})\nclass K {\n  readonly copy = { subtemplate: '<p class=\"opacity-60\">x</p>' };\n}\n"
    ),
    [0, 1, []]
  );
  check(
    'a keyframe held from another stylesheet is not read',
    file(
      'g.component.ts',
      '@Component({\n  styles: [`@keyframes dim { to { opacity: 0.5; } }`, `.a { animation: dim 1s forwards; }`],\n})\nclass G {}\n'
    ),
    [2, 0, []]
  );
  check(
    'a template: from a constant is not read',
    file('t.component.ts', "const T = '<p class=\"opacity-60\">x</p>';\n@Component({ template: T })\nclass T2 {}\n"),
    [0, 0, []]
  );
  check("a spec's inline template is not read", file('x.component.spec.ts', templated), [0, 0, []]);
  check(
    'a .ts file with no @Component is not read',
    file('x.fixture.ts', 'export const fixture = {\n  template: `<p class="opacity-70">x</p>`,\n};\n'),
    [0, 0, []]
  );
  check("a component's other strings are not read as styles", inlineStylesOf(styled).map((s) => s.offset), [2]);
  check(
    'a bare inline styles string is read too',
    inlineStylesOf("@Component({ styles: `.a { opacity: 0.6; }` })\nclass Z {}").length,
    1
  );
  check('a component with no inline styles has none', inlineStylesOf("@Component({ styleUrl: './x.scss' })"), []);

  // --- reporting ------------------------------------------------------------
  check('line numbers survive masking', scanStylesheet('/* a\n */\n.a {\n  opacity: 0.5;\n}').map((h) => h.line), [4]);
  check(
    "an unquoted url()'s // does not hide the rest of the file",
    scanStylesheet('.a { background: url(http://x.test/a.png); }\n.b { opacity: 0.5; }').map((h) => `${h.line} ${h.text}`),
    ['2 opacity: 0.5']
  );
  check(
    'nor does a protocol-relative one',
    scanStylesheet('@import url(//x.test/a.css);\n\n.b {\n  opacity: 0.5;\n}').map((h) => `${h.line} ${h.text}`),
    ['4 opacity: 0.5']
  );
  check(
    'an unclosed url( in a comment does not reach past its line',
    scanStylesheet('// a url( left open\n.b { opacity: 0.5; }\n.c { width: calc(1px); }').map((h) => `${h.line} ${h.text}`),
    ['2 opacity: 0.5']
  );
  check('a template hit reports its line', scanTemplate('<div>\n\n  <p class="opacity-60">x</p>\n</div>').map((h) => h.line), [3]);
  check(
    'a hit names the selectors above it',
    scanStylesheet('.card {\n  .note {\n    &:hover { opacity: 0.8; }\n  }\n}').map((h) => h.where),
    ['.card .note &:hover']
  );
  check('a fraction reads as itself', fadeOf('0.7'), 0.7);
  check('a leading dot reads', fadeOf('.7'), 0.7);
  check('a percentage reads as a fraction', fadeOf('70%'), 0.7);
  check('!important does not hide the value', fadeOf('0.7 !important'), 0.7);
  check('var() reads null', fadeOf('var(--fade)'), null);
  check('calc() reads null', fadeOf('calc(1 - 0.3)'), null);
  check('a keyframe is a passing state', inPassingState(['@keyframes a', '0%']), true);
  check('@media alone is not', inPassingState(['@media (max-width: 600px)', '.a']), false);

  // --- the ratchet ----------------------------------------------------------
  check('an unrecorded fade fails', findings({ 'a.scss': [fade(3)] }, {}), ['fade a.scss:3 opacity: 0.5']);
  check('a recorded fade at its count passes', findings({ 'a.html': [fade(3)] }, { 'a.html': ROW }), []);
  check(
    'a fade over its recorded count names every hit',
    findings({ 'a.html': [fade(3), fade(9)] }, { 'a.html': ROW }),
    ['fade a.html:3 opacity: 0.5', 'fade a.html:9 opacity: 0.5']
  );
  check(
    'a row whose count dropped is stale',
    findings({ 'a.html': [fade(3)] }, { 'a.html': { hits: 2, reason: 'x' } }),
    ['stale a.html:1 1 resting fade(s) left but ALLOWED still says 2']
  );
  check('a row whose file is clean is stale', findings({}, { 'a.html': ROW }), [
    'stale a.html:1 ALLOWED says 1 but the file is clean',
  ]);
  check('a row whose file is gone is stale', findings({}, { 'a.html': ROW }, () => false), [
    'stale a.html:1 ALLOWED says 1 but the file is gone',
  ]);
  check('a valid allowed row', allowedRowValid({ hits: 1, reason: 'measured through its fade' }), true);
  check('an allowed row with zero hits', allowedRowValid({ hits: 0, reason: 'measured through its fade' }), false);
  check('an allowed row with a fractional count', allowedRowValid({ hits: 1.5, reason: 'measured' }), false);
  check('an allowed row missing a reason', allowedRowValid({ hits: 1 }), false);
  check('an allowed row with an empty reason', allowedRowValid({ hits: 1, reason: '' }), false);
  check('every allowed row carries a reason', Object.values(ALLOWED).every(allowedRowValid), true);

  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`  ok  ${result.name}`);
    } else {
      failed += 1;
      console.error(`  FAIL ${result.name}`);
      console.error(`       expected ${JSON.stringify(result.expected)}`);
      console.error(`       actual   ${JSON.stringify(result.actual)}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} self-test failure(s) — the checker itself is broken.`);
    process.exit(1);
  }
  console.log(`check-opacity self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
