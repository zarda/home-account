#!/usr/bin/env node
/**
 * Holds the household ledger to the places that state its contract twice.
 *
 * A shared row reaches a household only as a copy under
 * households/{hid}/ledger, written by the row's author and judged by the
 * rules against the row itself. Five facts of that contract live in two
 * files each, and nothing at run time compares any pair:
 *
 *   1. The copy's fields. LEDGER_COPY_FIELDS and LEDGER_REQUIRED_FIELDS
 *      (src/app/models/household-ledger.model.ts) name the same sets as the
 *      rules' copyShapeValid `d.keys().hasOnly([...])` and
 *      `d.keys().hasAll([...])` (firestore.rules). A field the model gains
 *      and the rules do not admit fails every share; a field the rules admit
 *      and the model does not is a place a private value could be written.
 *   2. The query shapes. Every LEDGER_QUERY_SHAPES entry has a composite in
 *      firestore.indexes.json on the same collection, scoped COLLECTION, with
 *      the same fields in the same order and direction. The emulator never
 *      enforces a composite (docs/emulator-blind-spots.md), so the smoke
 *      suite passes without one and the deployed page fails with
 *      failed-precondition. 'budgets' and 'goals' are also the collection
 *      ids of users/{uid}/budgets and users/{uid}/goals, and a
 *      COLLECTION-scoped composite applies to every collection of its id.
 *      That is harmless there: a personal budget or goal holds no `gen`, and
 *      a document missing an indexed field has no entry in the index.
 *   3. The writers of transactions. Every write whose path names a
 *      transactions collection is in a file on WRITERS below, with the
 *      reason it writes rows. A shared row's copies follow it only on the
 *      paths that carry its shares, so a new writer is listed here in the
 *      commit that adds it, which is where its review asks whether it does.
 *      A listed file that no longer writes fails too: an entry the tree has
 *      outgrown would let the next writer in that file pass unasked.
 *   4. The share-key cap. txOptionalsValid bounds `sharedWith` at
 *      MAX_HOUSEHOLDS_PER_ACCOUNT (src/app/models/household.model.ts), one
 *      key for each household an account can belong to.
 *   5. The category snapshot's bounds. copyShapeValid's
 *      `d.category.KEY.size() <= N` for each of the snapshot's strings is
 *      LEDGER_SNAPSHOT_MAX_LENGTH, which projectRow cuts the snapshot to. A
 *      rule tighter than the cut refuses every copy of a row whose category
 *      runs past it.
 *
 * What counts as a write, for (3): a call to FirestoreService's
 * addDocument/setDocument/updateDocument/deleteDocument (the path, its first
 * argument) or commitBatch (any op path), a raw SDK setDoc/updateDoc/addDoc/
 * deleteDoc (the reference), and a set/update/delete on a runTransaction
 * callback's handle or a writeBatch (the reference). A path names
 * transactions when it holds a string or template literal with a
 * `transactions` path segment, or an identifier the same file defines as
 * one: a getter, method or function that returns such a path, or a
 * variable or field given one (declared with it, assigned it later, or
 * starting on the line below its `=`), a `+` concatenation whose literals
 * joined hold the segment, a document reference built from any of those,
 * or a list of commitBatch ops or references filled with one by push,
 * unshift, concat or a spread. Spec files are not read.
 *
 * What it deliberately cannot see:
 *   - A path passed in as a parameter. A generic helper handed
 *     `users/${uid}/transactions` by its caller writes rows while naming
 *     none itself, so neither file shows here.
 *   - A path built in another file and imported, or a collection name
 *     joined at run time (`users/${uid}/${kind}`).
 *   - A path chosen by a conditional (`shared ? rowPath : goalPath`), and a
 *     reference taken back out of a list (a for-of variable, a callback's
 *     parameter) and written through.
 *   - Text inside a regular expression literal holding a quote, which the
 *     comment masker reads as the start of a string.
 *   - Whether the rules and indexes are deployed. The files are the deploy
 *     input; the release's index wait (scripts/wait-for-indexes.mjs) and the
 *     live journey are the proof.
 *
 * `--self-test` runs every parser and comparison over embedded fixtures, a
 * must-hit list and a must-not-hit list, and exits non-zero on a mismatch.
 * As with the other gate scripts there is no .spec.ts: the self-test is the
 * spec, and ledger:check chains it ahead of the live check.
 *
 * Reference documentation lives in docs/household.md.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const MODEL = 'src/app/models/household-ledger.model.ts';
const HOUSEHOLD_MODEL = 'src/app/models/household.model.ts';
const RULES = 'firestore.rules';
const INDEXES = 'firestore.indexes.json';
const SOURCE_DIR = 'src/app';
const DOC = 'docs/household.md';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', 'coverage']);

/**
 * The files that write transactions, each with why. A file joins this
 * list in the commit that makes it a writer.
 */
const WRITERS = {
  'src/app/core/services/transaction.service.ts':
    "the account's own rows: every add, edit, split, receipt change, delete and base-currency re-snapshot",
  'src/app/core/services/goal.service.ts':
    "a personal goal's delete clears its link off the rows that counted toward it",
  'src/app/core/services/recurring.service.ts':
    'a recurring rule posts its due occurrences as rows, in the claim transaction',
};

// ---------------------------------------------------------------------------
// Text utilities.
// ---------------------------------------------------------------------------

/**
 * Blanks comments while preserving every byte offset, so prose about a path
 * or a field list is never read as one and a line number taken from the
 * masked text still points at the real line. Copied from
 * check-direction.mjs, which needs the same thing for the same reason.
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

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

/** The index just past the string or template literal that opens at `i`. */
function skipLiteral(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === quote) return j + 1;
    if (quote !== '`' && text[j] === '\n') return j;
    j += 1;
  }
  return text.length;
}

/**
 * The first index from `start`, outside any literal and at bracket depth
 * zero, whose character `stop(c, i)` accepts; or the index of a closing
 * bracket with no opener after `start` (the end of the enclosing
 * expression); or text.length.
 */
function stopAt(text, start, stop) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipLiteral(text, i);
      continue;
    }
    if (depth === 0 && stop(c, i)) return i;
    if (OPENERS.has(c)) depth += 1;
    else if (CLOSERS.has(c)) {
      depth -= 1;
      if (depth < 0) return i;
    }
    i += 1;
  }
  return text.length;
}

/** The index just past the bracket that matches the one at `open`. */
function closeOf(text, open) {
  const close = stopAt(text, open + 1, () => false);
  return Math.min(close + 1, text.length);
}

/** The text inside the bracket that opens at `open`. */
function bracketBody(text, open) {
  return text.slice(open + 1, closeOf(text, open) - 1);
}

/** The top-level arguments of an argument list's inner text. */
function splitArguments(inner) {
  const parts = [];
  let from = 0;
  while (from < inner.length) {
    const comma = stopAt(inner, from, c => c === ',');
    parts.push(inner.slice(from, comma).trim());
    from = comma + 1;
  }
  return parts.filter(part => part !== '');
}

/**
 * An expression from `start` to the end of its statement or declarator. A
 * line break ends it only where a statement could end: not before its first
 * token, not after a line ending in an operator (`+ - ? : = & | < >`), and
 * not before a line that opens with one (`+ - ? : . & |`).
 */
function expressionFrom(text, start) {
  let from = start;
  while (from < text.length && /\s/.test(text[from])) from += 1;
  const end = stopAt(text, from, (c, i) => c === ';' || c === ',' || (c === '\n' && !joinsLines(text, from, i)));
  return text.slice(from, end).trim();
}

/** Whether the line break at `i` sits inside an expression that began at `from`. */
function joinsLines(text, from, i) {
  let before = i - 1;
  while (before >= from && /\s/.test(text[before])) before -= 1;
  let after = i + 1;
  while (after < text.length && /\s/.test(text[after])) after += 1;
  return (before >= from && /[+\-?:=&|<>]/.test(text[before])) || /[+\-?:.&|]/.test(text[after] ?? '');
}

/** The expressions a callable body returns. */
function returnedExpressions(body) {
  return [...body.matchAll(/\breturn\b/g)].map(r => expressionFrom(body, r.index + 'return'.length));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function quotedStrings(listText) {
  return [...listText.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]);
}

// ---------------------------------------------------------------------------
// (1) The copy's fields.
// ---------------------------------------------------------------------------

/** The strings of `export const NAME = [...]` in a TypeScript source, or null. */
export function exportedList(source, name) {
  const masked = maskComments(source);
  const match = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`).exec(masked);
  if (!match) return null;
  return quotedStrings(bracketBody(masked, match.index + match[0].length - 1));
}

/** The body of `function NAME(...) { ... }` in a rules file, or null. */
function rulesFunctionBody(rules, name) {
  const masked = maskComments(rules);
  const match = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(masked);
  if (!match) return null;
  return bracketBody(masked, match.index + match[0].length - 1);
}

/**
 * The lists copyShapeValid holds a copy's own keys to. Only
 * `d.keys().hasOnly/hasAll` counts: the category snapshot's
 * `d.category.keys().hasOnly(...)` is a map inside the copy, not the copy.
 */
export function rulesCopyLists(rules) {
  const body = rulesFunctionBody(rules, 'copyShapeValid');
  if (body === null) return null;
  const only = /\bd\.keys\(\)\.hasOnly\(\s*\[/.exec(body);
  const all = /\bd\.keys\(\)\.hasAll\(\s*\[/.exec(body);
  return {
    hasOnly: only ? quotedStrings(bracketBody(body, only.index + only[0].length - 1)) : null,
    hasAll: all ? quotedStrings(bracketBody(body, all.index + all[0].length - 1)) : null,
  };
}

/** Where a model list and its rules list differ, as sets; null when they agree. */
export function listDrift(name, model, rules) {
  const inModel = new Set(model);
  const inRules = new Set(rules);
  const onlyInModel = model.filter(field => !inRules.has(field)).sort();
  const onlyInRules = rules.filter(field => !inModel.has(field)).sort();
  if (onlyInModel.length === 0 && onlyInRules.length === 0) return null;
  return { name, onlyInModel, onlyInRules };
}

/** Every disagreement between the model's two lists and the rules' two, as messages. */
export function fieldProblems(modelSource, rules) {
  const copy = exportedList(modelSource, 'LEDGER_COPY_FIELDS');
  const required = exportedList(modelSource, 'LEDGER_REQUIRED_FIELDS');
  const lists = rulesCopyLists(rules);
  const problems = [];
  if (!copy || copy.length === 0) problems.push(`${MODEL}: no LEDGER_COPY_FIELDS list found`);
  if (!required || required.length === 0) problems.push(`${MODEL}: no LEDGER_REQUIRED_FIELDS list found`);
  if (!lists) problems.push(`${RULES}: no function copyShapeValid found`);
  else {
    if (!lists.hasOnly) problems.push(`${RULES}: copyShapeValid holds no d.keys().hasOnly([...]) list`);
    if (!lists.hasAll) problems.push(`${RULES}: copyShapeValid holds no d.keys().hasAll([...]) list`);
  }
  if (problems.length > 0) return problems;

  const drifts = [
    listDrift('LEDGER_COPY_FIELDS / hasOnly', copy, lists.hasOnly),
    listDrift('LEDGER_REQUIRED_FIELDS / hasAll', required, lists.hasAll),
  ].filter(Boolean);
  for (const drift of drifts) {
    problems.push(
      `${drift.name}: only the model names [${drift.onlyInModel.join(', ')}]; ` +
        `only the rules name [${drift.onlyInRules.join(', ')}]`
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// (2) The query shapes.
// ---------------------------------------------------------------------------

/**
 * The entries of `export const LEDGER_QUERY_SHAPES = { name: { collectionGroup,
 * fields: [[field, order], ...] }, ... }`, or null when the constant is
 * missing. Throws when an entry is written in a form this parser does not
 * read, rather than check fewer shapes than are declared.
 */
export function queryShapes(source) {
  const masked = maskComments(source);
  const match = /export\s+const\s+LEDGER_QUERY_SHAPES\s*=\s*\{/.exec(masked);
  if (!match) return null;
  const block = bracketBody(masked, match.index + match[0].length - 1);
  const entries = [
    ...block.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{\s*collectionGroup\s*:\s*'([^']+)'\s*,\s*fields\s*:\s*\[([\s\S]*?)\]\s*,?\s*\}/g),
  ].map(m => ({
    name: m[1],
    collectionGroup: m[2],
    fields: [...m[3].matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)].map(pair => [pair[1], pair[2]]),
  }));
  const declared = (block.match(/\bcollectionGroup\s*:/g) ?? []).length;
  if (declared !== entries.length || entries.some(entry => entry.fields.length === 0)) {
    throw new Error(
      `${MODEL}: LEDGER_QUERY_SHAPES declares ${declared} shape(s) but ${entries.length} parsed ` +
        'with fields; write each as name: { collectionGroup: \'...\', fields: [[\'field\', \'ASCENDING\'], ...] }'
    );
  }
  return entries;
}

function sameFields(entry, shape) {
  const fields = entry.fields ?? [];
  return fields.length === shape.fields.length
    && shape.fields.every(([field, order], i) => fields[i].fieldPath === field && fields[i].order === order);
}

/** The shapes firestore.indexes.json declares no exactly matching composite for. */
export function missingComposites(shapes, indexes) {
  const declared = indexes.indexes ?? [];
  return shapes.filter(shape => !declared.some(entry =>
    entry.collectionGroup === shape.collectionGroup
      && entry.queryScope === 'COLLECTION'
      && sameFields(entry, shape)));
}

function compositeFor(shape) {
  return {
    collectionGroup: shape.collectionGroup,
    queryScope: 'COLLECTION',
    fields: shape.fields.map(([fieldPath, order]) => ({ fieldPath, order })),
  };
}

// ---------------------------------------------------------------------------
// (3) The writers of transactions.
// ---------------------------------------------------------------------------

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'await', 'new', 'typeof',
  'constructor', 'super', 'this', 'else', 'do', 'try',
]);

/**
 * A literal whose text holds a `transactions` path segment, template
 * placeholders read as a segment of their own. `bare` also takes the lone
 * segment, `'transactions'`, which is a path only where a write is given
 * one, as in doc(db, 'users', uid, 'transactions', id).
 */
function literalNamesTransactions(literal, bare) {
  const body = literal.slice(1, -1).replace(/\$\{[^}]*\}/g, 'X');
  if (bare && body === 'transactions') return true;
  return body.includes('/') && /(^|\/)transactions(\/|$)/.test(body);
}

function mentionsIdentifier(text, names) {
  for (const match of text.matchAll(/(?<![\w$.])(?:this\.)?([A-Za-z_$][\w$]*)/g)) {
    if (names.has(match[1])) return true;
  }
  return false;
}

/** The placeholder expressions of every template literal in `text`. */
function placeholders(text) {
  const found = [];
  for (const literal of text.match(LITERAL) ?? []) {
    if (literal[0] !== '`') continue;
    for (const m of literal.matchAll(/\$\{([^}]*)\}/g)) found.push(m[1]);
  }
  return found;
}

/** An expression without its statement's `;`, a leading await or return, or wrapping parentheses. */
function unwrap(expression) {
  let e = expression.trim().replace(/;$/, '').trim();
  e = e.replace(/^(?:await|return)\s+/, '').trim();
  while (e.startsWith('(') && closeOf(e, 0) === e.length) e = e.slice(1, -1).trim();
  return e;
}

function isLiteral(e) {
  return /^['"`]/.test(e) && skipLiteral(e, 0) === e.length;
}

/** The terms of a top-level `+` chain; one term when the expression is not one. */
function concatenatedTerms(e) {
  const terms = [];
  let from = 0;
  for (;;) {
    const plus = stopAt(e, from, c => c === '+');
    terms.push(e.slice(from, plus).trim());
    if (plus >= e.length || e[plus] !== '+') return terms;
    from = plus + 1;
  }
}

/**
 * Whether a `+` chain builds a transactions path: a term is one already, or
 * the chain's literals joined, every other term read as a segment of its
 * own, hold a `transactions` segment.
 */
function joinedNamesTransactions(terms, tainted) {
  let joined = '';
  for (const term of terms.map(unwrap)) {
    if (pathValued(term, tainted)) return true;
    joined += isLiteral(term) ? term.slice(1, -1).replace(/\$\{[^}]*\}/g, 'X') : 'X';
  }
  return literalNamesTransactions(`'${joined}'`, false);
}

/**
 * Whether an expression's value is a transactions path or a reference to
 * one: such a literal, a template placing a known path, a known path by
 * name (a variable, a getter, a helper's call), a `+` chain building one,
 * or a document reference built from any of those.
 */
export function pathValued(expression, tainted) {
  const e = unwrap(expression);
  if (isLiteral(e)) {
    return literalNamesTransactions(e, false)
      || (e[0] === '`' && placeholders(e).some(p => mentionsIdentifier(p, tainted)));
  }
  const named = /^(?:this\.)?([A-Za-z_$][\w$]*)\s*(\([\s\S]*\))?$/.exec(e);
  if (named && tainted.has(named[1])) return true;
  const terms = concatenatedTerms(e);
  if (terms.length > 1) return joinedNamesTransactions(terms, tainted);
  const built = /(?:\bgetDocRef|\bdoc|\bcollection)\s*(?:<[^>]*>)?\s*\(/.exec(e);
  if (built) {
    const args = bracketBody(e, built.index + built[0].length - 1);
    return argumentNamesTransactions(args, tainted);
  }
  return false;
}

/** Whether the text a write is given as its path or reference names transactions. */
function argumentNamesTransactions(text, tainted) {
  for (const literal of text.match(LITERAL) ?? []) {
    if (literalNamesTransactions(literal, true)) return true;
  }
  return mentionsIdentifier(text, tainted);
}

/**
 * Whether a definition's value carries a transactions path: the value
 * itself, the `path` of a commitBatch op it builds, or a list it concats
 * or spreads that carries one.
 */
function valueCarriesPath(value, tainted) {
  if (pathValued(value, tainted)) return true;
  for (const m of value.matchAll(/(?<![\w$.])path\s*:/g)) {
    if (pathValued(expressionFrom(value, m.index + m[0].length).replace(/\}\s*$/, ''), tainted)) return true;
  }
  for (const m of value.matchAll(/\.concat\s*\(/g)) {
    const args = splitArguments(bracketBody(value, m.index + m[0].length - 1));
    if (args.some(arg => valueCarriesPath(arg.replace(/^\.\.\./, ''), tainted))) return true;
  }
  for (const m of value.matchAll(/\.\.\.\s*(?:this\.)?([A-Za-z_$][\w$]*)/g)) {
    if (tainted.has(m[1])) return true;
  }
  return false;
}

/**
 * Every name the file defines (getter, method, function, variable, field)
 * with the expressions that give it its value: what a callable returns, a
 * variable's or field's initialiser, a later assignment to it, or what a
 * push or unshift adds to it. An arrow function's value is what it returns.
 */
function definitions(masked) {
  const found = [];
  // A definition's parameter list is followed by an optional return type
  // and its body; a call's is followed by anything else.
  const callable = /(?:^|[^\w$.])(?:get\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
  for (const match of masked.matchAll(callable)) {
    const name = match[1];
    if (KEYWORDS.has(name)) continue;
    const close = closeOf(masked, match.index + match[0].length - 1);
    const body = /^\s*(?::\s*[^{;=]+?)?\s*\{/.exec(masked.slice(close));
    if (!body) continue;
    found.push({ name, values: returnedExpressions(bracketBody(masked, close + body[0].length - 1)) });
  }
  const initialised =
    /(?:\b(?:const|let|var)\s+|(?:^|[\s;{}])(?:(?:public|private|protected|static|readonly)\s+)+)([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=(?![=>])/g;
  const assigned = /(?<![\w$.])(?:this\.)?([A-Za-z_$][\w$]*)\s*\+?=(?![=>])/g;
  for (const match of [...masked.matchAll(initialised), ...masked.matchAll(assigned)]) {
    const value = expressionFrom(masked, match.index + match[0].length);
    const arrow = /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=>\s*/.exec(value);
    if (!arrow) {
      found.push({ name: match[1], values: [value] });
      continue;
    }
    const result = value.slice(arrow[0].length);
    found.push({
      name: match[1],
      values: result.startsWith('{') ? returnedExpressions(bracketBody(result, 0)) : [result],
    });
  }
  for (const match of masked.matchAll(/(?<![\w$.])(?:this\.)?([A-Za-z_$][\w$]*)\.(?:push|unshift)\s*\(/g)) {
    const args = splitArguments(bracketBody(masked, match.index + match[0].length - 1));
    found.push({ name: match[1], values: args.map(arg => arg.replace(/^\.\.\./, '')) });
  }
  return found;
}

/** The names a file defines as transactions paths or references, to a fixed point. */
export function taintedNames(masked) {
  const defs = definitions(masked);
  const tainted = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const def of defs) {
      if (tainted.has(def.name)) continue;
      if (def.values.some(value => valueCarriesPath(value, tainted))) {
        tainted.add(def.name);
        grew = true;
      }
    }
  }
  return tainted;
}

/** The names a file gives a runTransaction callback's handle or a writeBatch. */
function writeHandles(masked) {
  const handles = new Set(['tx', 'transaction', 'batch']);
  for (const m of masked.matchAll(/\brunTransaction\s*(?:<[^>]*>)?\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/g)) handles.add(m[1]);
  for (const m of masked.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*writeBatch\s*\(/g)) handles.add(m[1]);
  return handles;
}

const SEAM_PATH_FIRST = ['addDocument', 'setDocument', 'updateDocument', 'deleteDocument'];
const SDK_REF_FIRST = ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc'];

/** Every write in a TypeScript source whose path or reference names transactions. */
export function transactionsWrites(source) {
  const masked = maskComments(source);
  const tainted = taintedNames(masked);
  const handles = writeHandles(masked);
  const writes = [];
  const consider = (index, call, open, whole) => {
    const args = bracketBody(masked, open);
    const target = whole ? args : (splitArguments(args)[0] ?? '');
    if (argumentNamesTransactions(target, tainted)) writes.push({ line: lineOf(masked, index), call });
  };

  const seam = new RegExp(`\\.(${[...SEAM_PATH_FIRST, 'commitBatch'].join('|')})\\s*(?:<[^>]*>)?\\s*\\(`, 'g');
  for (const m of masked.matchAll(seam)) {
    consider(m.index, m[1], m.index + m[0].length - 1, m[1] === 'commitBatch');
  }
  const sdk = new RegExp(`(?<![\\w$.])(${SDK_REF_FIRST.join('|')})\\s*\\(`, 'g');
  for (const m of masked.matchAll(sdk)) {
    consider(m.index, m[1], m.index + m[0].length - 1, false);
  }
  const handled = /(?<![\w$.])([A-Za-z_$][\w$]*)\.(set|update|delete)\s*\(/g;
  for (const m of masked.matchAll(handled)) {
    if (!handles.has(m[1])) continue;
    consider(m.index, `${m[1]}.${m[2]}`, m.index + m[0].length - 1, false);
  }
  return writes.sort((a, b) => a.line - b.line);
}

/**
 * The files writing transactions off the list, and the listed files that no
 * longer write. `found` maps a file to its writes.
 */
export function writerProblems(found, writers) {
  const problems = [];
  for (const [file, writes] of [...found.entries()].sort()) {
    if (writers[file] !== undefined) continue;
    problems.push(
      `${file} writes transactions and is not on WRITERS:\n` +
        writes.map(write => `    ${file}:${write.line}  ${write.call}(...)`).join('\n')
    );
  }
  for (const file of Object.keys(writers).sort()) {
    if (!found.has(file)) {
      problems.push(`${file} is on WRITERS but no longer writes transactions; remove its entry.`);
    }
  }
  return problems;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) found.push(path);
  }
  return found;
}

function posix(path) {
  return path.split(sep).join('/');
}

// ---------------------------------------------------------------------------
// (4) The share-key cap.
// ---------------------------------------------------------------------------

/** The rules' bound on a row's sharedWith and the model's cap; a message when they differ. */
export function capProblems(rules, householdModel) {
  const body = rulesFunctionBody(rules, 'txOptionalsValid');
  const bound = body && /\bd\.sharedWith\.size\(\)\s*<=\s*(\d+)/.exec(body);
  const cap = /export\s+const\s+MAX_HOUSEHOLDS_PER_ACCOUNT\s*=\s*(\d+)\s*;/.exec(maskComments(householdModel));
  if (!bound) return [`${RULES}: txOptionalsValid holds no d.sharedWith.size() <= N bound`];
  if (!cap) return [`${HOUSEHOLD_MODEL}: no MAX_HOUSEHOLDS_PER_ACCOUNT found`];
  if (bound[1] !== cap[1]) {
    return [`${RULES} caps sharedWith at ${bound[1]}, ${HOUSEHOLD_MODEL} caps memberships at ${cap[1]}`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// (5) The category snapshot's bounds.
// ---------------------------------------------------------------------------

/** The numbers of `export const LEDGER_SNAPSHOT_MAX_LENGTH = { key: N, ... }`, by key, or null. */
export function snapshotLimits(source) {
  const masked = maskComments(source);
  const match = /export\s+const\s+LEDGER_SNAPSHOT_MAX_LENGTH\s*=\s*\{/.exec(masked);
  if (!match) return null;
  const block = bracketBody(masked, match.index + match[0].length - 1);
  return Object.fromEntries([...block.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
}

/** copyShapeValid's `d.category.KEY.size() <= N` bounds, by key, or null without a copyShapeValid. */
export function rulesSnapshotBounds(rules) {
  const body = rulesFunctionBody(rules, 'copyShapeValid');
  if (body === null) return null;
  return Object.fromEntries(
    [...body.matchAll(/\bd\.category\.([A-Za-z_$][\w$]*)\.size\(\)\s*<=\s*(\d+)/g)].map(m => [m[1], Number(m[2])])
  );
}

/** Where the rules' snapshot bounds and the projection's cut differ, as messages. */
export function snapshotProblems(modelSource, rules) {
  const limits = snapshotLimits(modelSource);
  const bounds = rulesSnapshotBounds(rules);
  if (!limits || Object.keys(limits).length === 0) return [`${MODEL}: no LEDGER_SNAPSHOT_MAX_LENGTH found`];
  if (!bounds) return [`${RULES}: no function copyShapeValid found`];
  const problems = [];
  for (const key of [...new Set([...Object.keys(limits), ...Object.keys(bounds)])].sort()) {
    if (limits[key] === undefined) {
      problems.push(`${RULES} bounds d.category.${key}, which LEDGER_SNAPSHOT_MAX_LENGTH does not name`);
    } else if (bounds[key] === undefined) {
      problems.push(`${RULES}: copyShapeValid holds no d.category.${key}.size() <= N bound`);
    } else if (bounds[key] !== limits[key]) {
      problems.push(`${RULES} bounds d.category.${key} at ${bounds[key]}, ${MODEL} cuts it at ${limits[key]}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The live check.
// ---------------------------------------------------------------------------

function run() {
  const model = readFileSync(MODEL, 'utf8');
  const rules = readFileSync(RULES, 'utf8');
  const problems = [];

  problems.push(...fieldProblems(model, rules));

  let shapes = [];
  try {
    shapes = queryShapes(model) ?? [];
    if (shapes.length === 0) problems.push(`${MODEL}: no LEDGER_QUERY_SHAPES found`);
  } catch (error) {
    problems.push(error.message);
  }
  const missing = missingComposites(shapes, JSON.parse(readFileSync(INDEXES, 'utf8')));
  for (const shape of missing) {
    problems.push(`${INDEXES} has no composite for ${shape.name}: ${JSON.stringify(compositeFor(shape))}`);
  }

  const files = walk(SOURCE_DIR);
  const found = new Map();
  for (const file of files) {
    const writes = transactionsWrites(readFileSync(file, 'utf8'));
    if (writes.length > 0) found.set(posix(file), writes);
  }
  problems.push(...writerProblems(found, WRITERS));

  problems.push(...capProblems(rules, readFileSync(HOUSEHOLD_MODEL, 'utf8')));

  problems.push(...snapshotProblems(model, rules));

  const writeCount = [...found.values()].reduce((sum, writes) => sum + writes.length, 0);
  console.log(
    `Checked the copy's field lists, ${shapes.length} query shape(s), ` +
      `${writeCount} transactions write(s) in ${found.size} of ${files.length} file(s), the share-key cap ` +
      "and the category snapshot's bounds."
  );
  console.log(
    "  'budgets' and 'goals' composites also cover users/{uid}/budgets and goals, whose documents hold no gen and take no entries."
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} ledger contract problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
    console.error(
      `The copy's fields are listed in ${MODEL} and in ${RULES}'s copyShapeValid, and the two\n` +
        `change together. Every LEDGER_QUERY_SHAPES entry needs its composite in ${INDEXES},\n` +
        `which the emulator never checks. A new writer of transactions goes on WRITERS in\n` +
        `scripts/check-ledger-contract.mjs, with the reason, in the commit that adds it,\n` +
        `once it carries a shared row's changes to the row's copies. The rules' bounds on a\n` +
        `copy's category snapshot are LEDGER_SNAPSHOT_MAX_LENGTH, which projectRow cuts to.\n` +
        `Reference: ${DOC}.\n`
    );
    process.exit(1);
  }

  console.log('The ledger contract holds: fields, composites, writers, the share-key cap and the snapshot bounds agree.');
}

// ---------------------------------------------------------------------------
// The self-test.
// ---------------------------------------------------------------------------

function selfTest() {
  const results = [];
  const check = (name, actual, expected) => {
    results.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  };

  // --- (1) fields ---------------------------------------------------------
  const model = [
    '/** Every field. LEDGER_COPY_FIELDS = [\'note\'] in prose is not the list. */',
    'export const LEDGER_COPY_FIELDS = [',
    "  'memberUid', 'sourceId',",
    "  'goalId', 'updatedAt',",
    '] as const satisfies readonly (keyof LedgerCopy)[];',
    'export const LEDGER_REQUIRED_FIELDS = [',
    "  'memberUid', 'sourceId', 'updatedAt',",
    '] as const;',
  ].join('\n');
  const rulesWith = (only, all) => [
    'function copyShapeValid(h) {',
    '  let d = request.resource.data;',
    "  // d.keys().hasOnly(['note']) in a comment is not the list",
    `  return d.keys().hasOnly([${only}])`,
    `    && d.keys().hasAll([${all}])`,
    "    && d.category.keys().hasOnly(['name', 'icon', 'color']);",
    '}',
  ].join('\n');
  const agreeing = rulesWith(
    "'memberUid', 'sourceId', 'goalId', 'updatedAt'",
    "'memberUid', 'sourceId', 'updatedAt'"
  );

  check('reads the model list', exportedList(model, 'LEDGER_COPY_FIELDS'), ['memberUid', 'sourceId', 'goalId', 'updatedAt']);
  check('reads the copy lists, not the category map\'s', rulesCopyLists(agreeing), {
    hasOnly: ['memberUid', 'sourceId', 'goalId', 'updatedAt'],
    hasAll: ['memberUid', 'sourceId', 'updatedAt'],
  });
  check('lists that agree', fieldProblems(model, agreeing), []);
  check(
    'lists that agree in another order',
    fieldProblems(model, rulesWith("'updatedAt', 'goalId', 'sourceId', 'memberUid'", "'updatedAt', 'memberUid', 'sourceId'")),
    []
  );
  check(
    'a field the rules admit and the model does not',
    fieldProblems(model, rulesWith("'memberUid', 'sourceId', 'goalId', 'updatedAt', 'note'", "'memberUid', 'sourceId', 'updatedAt'")),
    ['LEDGER_COPY_FIELDS / hasOnly: only the model names []; only the rules name [note]']
  );
  check(
    'a required field the rules do not require',
    fieldProblems(model, rulesWith("'memberUid', 'sourceId', 'goalId', 'updatedAt'", "'memberUid', 'updatedAt'")),
    ['LEDGER_REQUIRED_FIELDS / hasAll: only the model names [sourceId]; only the rules name []']
  );
  check('no copyShapeValid at all', fieldProblems(model, 'function other() { return true; }'), [
    `${RULES}: no function copyShapeValid found`,
  ]);
  check('a copyShapeValid without its hasAll', fieldProblems(model, rulesWith("'memberUid'", "'x'").replace(/d\.keys\(\)\.hasAll/, 'd.hasAll')), [
    `${RULES}: copyShapeValid holds no d.keys().hasAll([...]) list`,
  ]);

  // --- (2) shapes ---------------------------------------------------------
  const shapesSource = [
    'export const LEDGER_QUERY_SHAPES = {',
    "  // byDate: { collectionGroup: 'ghost', fields: [['x', 'ASCENDING']] },",
    "  byDate: { collectionGroup: 'ledger', fields: [['gen', 'ASCENDING'], ['date', 'DESCENDING']] },",
    '  active: {',
    "    collectionGroup: 'goals',",
    "    fields: [['gen', 'ASCENDING'], ['isActive', 'ASCENDING']],",
    '  },',
    '} as const satisfies Record<string, LedgerQueryShape>;',
  ].join('\n');
  const shapes = queryShapes(shapesSource);
  check('reads every shape, commented ones aside', shapes, [
    { name: 'byDate', collectionGroup: 'ledger', fields: [['gen', 'ASCENDING'], ['date', 'DESCENDING']] },
    { name: 'active', collectionGroup: 'goals', fields: [['gen', 'ASCENDING'], ['isActive', 'ASCENDING']] },
  ]);
  const composite = (collectionGroup, fields, queryScope = 'COLLECTION') => ({
    collectionGroup,
    queryScope,
    fields: fields.map(([fieldPath, order]) => ({ fieldPath, order })),
  });
  const both = [
    composite('ledger', [['gen', 'ASCENDING'], ['date', 'DESCENDING']]),
    composite('goals', [['gen', 'ASCENDING'], ['isActive', 'ASCENDING']]),
  ];
  const missingNames = indexes => missingComposites(shapes, { indexes }).map(shape => shape.name);
  check('every shape has its composite', missingNames(both), []);
  check('a composite missing', missingNames([both[1]]), ['byDate']);
  check('the other direction does not match', missingNames([composite('ledger', [['gen', 'ASCENDING'], ['date', 'ASCENDING']]), both[1]]), ['byDate']);
  check('another collection does not match', missingNames([composite('transactions', [['gen', 'ASCENDING'], ['date', 'DESCENDING']]), both[1]]), ['byDate']);
  check('a collection-group scope does not match', missingNames([composite('ledger', [['gen', 'ASCENDING'], ['date', 'DESCENDING']], 'COLLECTION_GROUP'), both[1]]), ['byDate']);
  check('fields in another order do not match', missingNames([composite('ledger', [['date', 'DESCENDING'], ['gen', 'ASCENDING']]), both[1]]), ['byDate']);
  check('an extra field does not match', missingNames([composite('ledger', [['gen', 'ASCENDING'], ['memberUid', 'ASCENDING'], ['date', 'DESCENDING']]), both[1]]), ['byDate']);
  check('no shapes constant', queryShapes('export const OTHER = {};'), null);
  let unreadable = null;
  try {
    queryShapes("export const LEDGER_QUERY_SHAPES = { a: { collectionGroup: 'ledger', fields: FIELDS } };");
  } catch (error) {
    unreadable = error.message.includes('declares 1 shape(s) but 0 parsed');
  }
  check('a shape the parser cannot read fails loudly', unreadable, true);

  // --- (3) writers --------------------------------------------------------
  const calls = source => transactionsWrites(source).map(write => write.call);
  const service = body => [
    'export class S {',
    '  private get userTransactionsPath(): string {',
    '    const userId = this.auth.userId();',
    "    if (!userId) throw new Error('signed out');",
    '    return `users/${userId}/transactions`;',
    '  }',
    '  private get userGoalsPath(): string { return `users/${this.uid}/goals`; }',
    '  private rowPath(id: string): string { return `${this.userTransactionsPath}/${id}`; }',
    body,
    '}',
  ].join('\n');

  // must hit
  check('an add to a literal path', calls('await this.fs.addDocument(`users/${uid}/transactions`, row);'), ['addDocument']);
  check('a set through a path getter', calls(service('async a() { await this.fs.setDocument(`${this.userTransactionsPath}/${id}`, row); }')), ['setDocument']);
  check('an add to the getter itself', calls(service('async a() { await this.fs.addDocument(this.userTransactionsPath, row); }')), ['addDocument']);
  check('an update through a path helper', calls(service('async a() { await this.fs.updateDocument(this.rowPath(id), { amount: 1 }); }')), ['updateDocument']);
  check(
    'a delete through a local path',
    calls(service('async a() { const path = `${this.userTransactionsPath}/${id}`; await this.fs.deleteDocument(path); }')),
    ['deleteDocument']
  );
  check(
    'a delete whose call spans lines',
    calls(service('async a() {\n  await this.fs.deleteDocument(\n    `${this.userTransactionsPath}/${id}`\n  );\n}')),
    ['deleteDocument']
  );
  check(
    'a batch naming a row',
    calls(service("async a() { await this.fs.commitBatch([{ op: 'delete', path: this.rowPath(id) }]); }")),
    ['commitBatch']
  );
  check(
    'a batch built ahead of the commit',
    calls(service("async a() { const ops = ids.map(id => ({ op: 'delete', path: `${this.userTransactionsPath}/${id}` })); await this.fs.commitBatch(ops); }")),
    ['commitBatch']
  );
  check(
    'a transaction set and delete through a reference',
    calls(service([
      'async a() {',
      '  const rowRef = this.fs.getDocRef(`${this.userTransactionsPath}/${id}`);',
      '  await this.fs.runTransaction(async tx => {',
      '    tx.set(rowRef, row);',
      '    tx.delete(rowRef);',
      '  });',
      '}',
    ].join('\n'))),
    ['tx.set', 'tx.delete']
  );
  check(
    'a transaction handle of another name, on a literal reference',
    calls('await fs.runTransaction(async (t) => { t.update(fs.getDocRef(`users/${u}/transactions/${id}`), d); });'),
    ['t.update']
  );
  check('a raw SDK write', calls("await setDoc(doc(this.db, 'users', uid, 'transactions', id), row);"), ['setDoc']);
  check('a raw SDK batch', calls("const b = writeBatch(db);\nb.delete(doc(db, `users/${uid}/transactions/${id}`));"), ['b.delete']);
  check(
    'a path helper defined as an arrow function',
    calls('const txPath = (uid: string) => `users/${uid}/transactions`;\nawait fs.addDocument(txPath(uid), row);'),
    ['addDocument']
  );
  check(
    'a path initialised on the line below its declaration',
    calls('const path =\n  `users/${uid}/transactions/${id}`;\nawait this.fs.deleteDocument(path);'),
    ['deleteDocument']
  );
  check(
    'a path assigned after its declaration',
    calls("let path = '';\npath = `users/${uid}/transactions/${id}`;\nawait this.fs.deleteDocument(path);"),
    ['deleteDocument']
  );
  check(
    "a path joined with '+'",
    calls("const path = 'users/' + uid + '/transactions/' + id;\nawait this.fs.deleteDocument(path);"),
    ['deleteDocument']
  );
  check(
    "a path joined with '+' from a lone segment",
    calls("const path = 'users/' + uid + '/' + 'transactions';\nawait this.fs.addDocument(path, row);"),
    ['addDocument']
  );
  check(
    "a path joined with '+' onto a path getter",
    calls(service("async a() { const path = this.userTransactionsPath + '/' + id; await this.fs.deleteDocument(path); }")),
    ['deleteDocument']
  );
  check(
    "a path joined with '+' across lines",
    calls("const path = `users/${uid}` +\n  '/transactions';\nawait this.fs.addDocument(path, row);"),
    ['addDocument']
  );
  check(
    'a batch filled by push',
    calls(service([
      'async a() {',
      '  const ops: BatchOp[] = [];',
      "  for (const id of ids) ops.push({ op: 'delete', path: this.rowPath(id) });",
      '  await this.fs.commitBatch(ops);',
      '}',
    ].join('\n'))),
    ['commitBatch']
  );
  check(
    'a batch filled by push with a spread',
    calls("const ops = [];\nops.push(...ids.map(id => ({ op: 'delete', path: `users/${uid}/transactions/${id}` })));\nawait this.fs.commitBatch(ops);"),
    ['commitBatch']
  );
  check(
    'a batch grown by concat of ops built elsewhere in the file',
    calls([
      "const rowOps = ids.map(id => ({ op: 'delete', path: `users/${uid}/transactions/${id}` }));",
      "let ops = [{ op: 'set', path: `users/${uid}/goals/${goalId}`, data }];",
      'ops = ops.concat(rowOps);',
      'await this.fs.commitBatch(ops);',
    ].join('\n')),
    ['commitBatch']
  );
  check(
    'a batch spread from ops built elsewhere in the file',
    calls([
      "const rowOps = ids.map(id => ({ op: 'delete', path: `users/${uid}/transactions/${id}` }));",
      'const all = [...goalOps, ...rowOps];',
      'await this.fs.commitBatch(all);',
    ].join('\n')),
    ['commitBatch']
  );

  // must not hit
  check('a read of a transactions path', calls(service('async a() { return this.fs.getCollection(this.userTransactionsPath); }')), []);
  check('a document read', calls('await this.fs.getDocument(`users/${uid}/transactions/${id}`);'), []);
  check('a write to another collection', calls(service('async a() { await this.fs.updateDocument(`${this.userGoalsPath}/${id}`, { linkedAmount: 0 }); }')), []);
  check('a router path', calls("this.router.navigate(['/transactions']); await this.fs.addDocument(`users/${uid}/goals`, g);"), []);
  check('a path in a comment', calls('// writes users/x/transactions\nawait this.fs.deleteDocument(`users/${uid}/goals/${id}`);'), []);
  check('a component import path', calls("const load = () => import('../transactions/row.component');\nawait this.fs.addDocument(`users/${uid}/goals`, g);"), []);
  check('a collection whose name only starts the same', calls('await this.fs.addDocument(`users/${uid}/transactionsArchive`, row);'), []);
  check('a signal named for transactions', calls('this.transactions.set([]); this.transactions.update(rows => rows);'), []);
  check(
    'rows read from transactions do not make a later write one',
    calls(service([
      'async a() {',
      '  const rows = await this.fs.getCollection(this.userTransactionsPath);',
      '  for (const row of rows) await this.fs.updateDocument(`${this.userGoalsPath}/${row.goalId}`, { linkedAmount: 0 });',
      '}',
    ].join('\n'))),
    []
  );
  check(
    'a goal reference in the same transaction',
    calls(service([
      'async a() {',
      '  const goalRef = this.fs.getDocRef(`${this.userGoalsPath}/${goalId}`);',
      '  await this.fs.runTransaction(async tx => { tx.update(goalRef, { linkedAmount: 1 }); });',
      '}',
    ].join('\n'))),
    []
  );
  check('a ledger copy write', calls('await this.fs.setDocument(`households/${hid}/ledger/${uid}_${id}`, copy);'), []);
  check('a map set', calls("this.cache.set('transactions', rows);"), []);
  check(
    "a goal path joined with '+'",
    calls("const path = 'users/' + uid + '/goals/' + id;\nawait this.fs.deleteDocument(path);"),
    []
  );
  check(
    "a route joined with '+', never written",
    calls("const url = '/transactions/' + id;\nthis.router.navigateByUrl(url);\nawait this.fs.addDocument(`users/${uid}/goals`, g);"),
    []
  );
  check(
    'a sum across lines',
    calls("const total = a +\n  b;\nawait this.fs.updateDocument(`users/${uid}/goals/${id}`, { total });"),
    []
  );
  check(
    'a batch of goal ops filled by push',
    calls("const ops = [];\nops.push({ op: 'delete', path: `users/${uid}/goals/${id}` });\nawait this.fs.commitBatch(ops);"),
    []
  );
  check(
    'a comparison with a transactions path is not an assignment',
    calls("let path = goalPath;\nif (path == `users/${uid}/transactions`) return;\nawait this.fs.deleteDocument(path);"),
    []
  );

  // the list
  const found = new Map([
    ['a.ts', [{ line: 3, call: 'addDocument' }]],
    ['b.ts', [{ line: 9, call: 'tx.set' }]],
  ]);
  check('every writer listed', writerProblems(found, { 'a.ts': 'rows', 'b.ts': 'claims' }), []);
  check('a writer not listed', writerProblems(found, { 'a.ts': 'rows' }), [
    'b.ts writes transactions and is not on WRITERS:\n    b.ts:9  tx.set(...)',
  ]);
  check('a listed file that no longer writes', writerProblems(found, { 'a.ts': 'rows', 'b.ts': 'claims', 'c.ts': 'gone' }), [
    'c.ts is on WRITERS but no longer writes transactions; remove its entry.',
  ]);

  // --- (4) cap ------------------------------------------------------------
  const txRules = bound => `function txOptionalsValid(d) {\n  return (!('sharedWith' in d) || (d.sharedWith is list && d.sharedWith.size() <= ${bound}));\n}`;
  const household = '/** MAX_HOUSEHOLDS_PER_ACCOUNT = 3 in prose */\nexport const MAX_HOUSEHOLDS_PER_ACCOUNT = 10;';
  check('a cap that agrees', capProblems(txRules(10), household), []);
  check('a cap that differs', capProblems(txRules(5), household), [
    `${RULES} caps sharedWith at 5, ${HOUSEHOLD_MODEL} caps memberships at 10`,
  ]);
  check('no bound in the rules', capProblems('function txOptionalsValid(d) { return true; }', household), [
    `${RULES}: txOptionalsValid holds no d.sharedWith.size() <= N bound`,
  ]);

  // --- (5) snapshot bounds -----------------------------------------------
  const snapshotModel = (name, icon, color) => [
    '/** LEDGER_SNAPSHOT_MAX_LENGTH = { name: 1 } in prose is not the constant. */',
    'export const LEDGER_SNAPSHOT_MAX_LENGTH = {',
    `  name: ${name},`,
    `  icon: ${icon},`,
    `  color: ${color},`,
    '} as const satisfies Record<keyof LedgerCategorySnapshot, number>;',
  ].join('\n');
  const snapshotRules = (name, icon, color) => [
    'function copyShapeValid(h) {',
    '  let d = request.resource.data;',
    '  // d.category.name.size() <= 7 in a comment is not the bound',
    `  return d.category.name is string && d.category.name.size() <= ${name}`,
    `    && d.category.icon is string && d.category.icon.size() <= ${icon}`,
    `    && d.category.color is string && d.category.color.size() <= ${color};`,
    '}',
  ].join('\n');
  check('reads the cut', snapshotLimits(snapshotModel(100, 64, 32)), { name: 100, icon: 64, color: 32 });
  check('reads the bounds', rulesSnapshotBounds(snapshotRules(100, 64, 32)), { name: 100, icon: 64, color: 32 });
  check('bounds that agree', snapshotProblems(snapshotModel(100, 64, 32), snapshotRules(100, 64, 32)), []);
  check('a bound tighter than the cut', snapshotProblems(snapshotModel(100, 64, 32), snapshotRules(50, 64, 32)), [
    `${RULES} bounds d.category.name at 50, ${MODEL} cuts it at 100`,
  ]);
  check(
    'a bound the rules dropped',
    snapshotProblems(snapshotModel(100, 64, 32), snapshotRules(100, 64, 32).replace(/ && d\.category\.icon\.size\(\) <= 64/, '')),
    [`${RULES}: copyShapeValid holds no d.category.icon.size() <= N bound`]
  );
  check('no cut in the model', snapshotProblems('export const OTHER = {};', snapshotRules(100, 64, 32)), [
    `${MODEL}: no LEDGER_SNAPSHOT_MAX_LENGTH found`,
  ]);

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
  console.log(`check-ledger-contract self-test: ${results.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
