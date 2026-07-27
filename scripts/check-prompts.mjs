#!/usr/bin/env node
/**
 * Keeps the three provider services honest about the prompt registry.
 *
 * Four things have to agree:
 *   1. the ids in src/app/core/prompts/prompt-registry.ts,
 *   2. the renderPrompt() call sites in the three provider services,
 *   3. the table in docs/prompts.md,
 *   4. the rendering assertions in prompt-registry.spec.ts.
 *
 * Before the registry existed each provider carried its own copy of every
 * prompt, and they had already drifted in six places without anything failing:
 * only Gemini asked receipts for `receiptCount` (which the transaction form
 * reads to offer the multi-receipt review), only Gemini gave the pattern
 * narrative a language instruction, and the spending summary opened with a
 * different sentence depending on which provider happened to be configured.
 * The parity check below is the one that would have caught all of it.
 *
 * What it deliberately cannot see:
 *   - Whether a prompt's wording is any good, or whether a placeholder was
 *     filled with the right value. The compiler proves the declared inputs were
 *     passed; only a human knows the English says what it should.
 *   - Whether a provider adapter drops `system` or ignores `expects`. That is
 *     behavioural and belongs in provider-prompt-parity.spec.ts, which asserts
 *     the text each SDK actually receives.
 *   - A prompt assembled by concatenating short fragments to slip under the
 *     long-literal heuristic. This is a tripwire, not a proof.
 *   - Prompt text reaching a model from outside the three provider files. The
 *     no-restricted-imports rule in eslint.config.js covers that, by keeping
 *     the SDKs importable only from the services that own them.
 */

import { readFileSync, existsSync } from 'node:fs';

const REGISTRY = 'src/app/core/prompts/prompt-registry.ts';
const REGISTRY_SPEC = 'src/app/core/prompts/prompt-registry.spec.ts';
const DOC = 'docs/prompts.md';
const PROVIDERS = {
  gemini: 'src/app/core/services/gemini.service.ts',
  openai: 'src/app/core/services/openai.service.ts',
  claude: 'src/app/core/services/claude.service.ts',
};

/**
 * Prompts that legitimately reach only some providers, and why.
 *
 * Every entry here is a capability gap rather than a design choice, so the
 * reason names the issue that closes it. An empty table is the goal.
 */
const SINGLE_PROVIDER = {
  pdfStatement: {
    providers: ['gemini'],
    reason: 'PDF import is Gemini-only until the pages are rasterized client-side (#55)',
  },
  receiptSummary: {
    providers: ['gemini'],
    reason: 'Gemini reduces one photo to a summary row; the others go straight to statement extraction',
  },
  receiptItems: {
    providers: ['gemini'],
    reason: 'position-aware single-image itemization has no OpenAI/Claude counterpart yet',
  },
};

/** Literals in the provider files that are not prompts. */
const LITERAL_ALLOWLIST = [
  /^data:image\//,
  /^\$\{/,
];

/**
 * Log and error strings, which cannot reach a model.
 *
 * Matched by what precedes the backtick rather than by content: a diagnostic
 * that happens to be long is still a diagnostic, and content matching would
 * mean maintaining a list of phrases nobody would keep current.
 */
const NON_PROMPT_CALLERS = /(?:console\.\w+|new Error|throw new \w*Error)\s*\($/;

const MAX_LITERAL_LENGTH = 120;

const failures = [];
const fail = (message, sites = []) => failures.push({ message, sites });

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Blank comments rather than delete them, so a match's index still maps to the
 * right line. Line comments are only stripped when `//` opens the line, so a
 * `//` inside a string survives.
 */
function blankComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, line => ' '.repeat(line.length));
}

/** Ids and metadata declared in the registry. */
export function parseRegistry(source) {
  const prompts = new Map();
  const body = source.slice(source.indexOf('export const PROMPTS = {'));
  const entry =
    /^ {2}([a-zA-Z][A-Za-z0-9]*): \{\s*\n\s*since: '([^']+)',\s*\n\s*feature: '([^']+)',/gm;
  let match;
  while ((match = entry.exec(body)) !== null) {
    prompts.set(match[1], { since: match[2], feature: match[3] });
  }
  return prompts;
}

/** `renderPrompt('id'` sites, as id -> [`file:line`]. */
export function findCallSites(files) {
  const sites = new Map();
  for (const [provider, source] of Object.entries(files)) {
    const text = blankComments(source);
    const call = /renderPrompt\(\s*'([a-zA-Z][A-Za-z0-9]*)'/g;
    let match;
    while ((match = call.exec(text)) !== null) {
      const found = sites.get(match[1]) ?? new Map();
      const lines = found.get(provider) ?? [];
      lines.push(lineOf(text, match.index));
      found.set(provider, lines);
      sites.set(match[1], found);
    }
  }
  return sites;
}

/**
 * Backtick literals in a provider file that look like prompts: multi-line, or
 * long enough that no plumbing string would be.
 */
export function findInlineLiterals(source) {
  const text = blankComments(source);
  const found = [];
  const open = /`/g;
  let match;
  while ((match = open.exec(text)) !== null) {
    let i = match.index + 1;
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '$' && text[i + 1] === '{') {
        depth++;
        i += 2;
        continue;
      }
      if (c === '}' && depth > 0) {
        depth--;
        i++;
        continue;
      }
      if (c === '`' && depth === 0) break;
      i++;
    }
    const body = text.slice(match.index + 1, i);
    open.lastIndex = i + 1;

    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (NON_PROMPT_CALLERS.test(before)) continue;
    if (LITERAL_ALLOWLIST.some(pattern => pattern.test(body))) continue;
    if (body.includes('\n') || body.length > MAX_LITERAL_LENGTH) {
      found.push({ line: lineOf(text, match.index), length: body.length });
    }
  }
  return found;
}

function sliceBetween(text, marker) {
  const start = text.indexOf(`<!-- ${marker}:start -->`);
  const end = text.indexOf(`<!-- ${marker}:end -->`);
  if (start === -1 || end === -1 || end < start) return null;
  return { body: text.slice(start, end), offset: start };
}

/** A registry row: | `id` | feature | providers | since | purpose | */
const TABLE_ROW = /^\|\s*`([a-zA-Z][A-Za-z0-9]*)`\s*\|([^|]*)\|([^|]*)\|\s*([^|\s]+)\s*\|/;

export function parseDocRows(doc) {
  const table = sliceBetween(doc, 'prompt-registry');
  if (!table) return null;
  const rows = new Map();
  for (const line of table.body.split('\n')) {
    const match = TABLE_ROW.exec(line);
    if (!match) continue;
    const [, id, feature, providers, since] = match;
    rows.set(id, {
      feature: feature.trim().replace(/`/g, ''),
      providers: providers
        .split(',')
        .map(cell => cell.trim().replace(/`/g, ''))
        .filter(Boolean)
        .sort(),
      since: since.trim(),
      line: lineOf(doc, table.offset + table.body.indexOf(line)),
    });
  }
  return rows;
}

function run() {
  for (const path of [REGISTRY, REGISTRY_SPEC, DOC, ...Object.values(PROVIDERS)]) {
    if (!existsSync(path)) {
      console.error(`${path} does not exist. Fix the path list in this script.`);
      process.exit(1);
    }
  }

  const prompts = parseRegistry(readFileSync(REGISTRY, 'utf8'));
  if (prompts.size === 0) {
    console.error(`${REGISTRY} declares no prompts. That is never a real state — check the file.`);
    process.exit(1);
  }

  const sources = Object.fromEntries(
    Object.entries(PROVIDERS).map(([name, path]) => [name, readFileSync(path, 'utf8')])
  );
  const sites = findCallSites(sources);
  const spec = readFileSync(REGISTRY_SPEC, 'utf8');
  const rows = parseDocRows(readFileSync(DOC, 'utf8'));

  if (!rows) {
    console.error(`${DOC} is missing the <!-- prompt-registry:start/end --> markers.`);
    process.exit(1);
  }
  if (rows.size === 0) {
    console.error(`${DOC} has the registry markers but no rows between them.`);
    process.exit(1);
  }

  const allProviders = Object.keys(PROVIDERS).sort();

  for (const [id, meta] of prompts) {
    const found = sites.get(id);
    const senders = found ? [...found.keys()].sort() : [];

    if (senders.length === 0) {
      fail(`${id} — registered but never rendered from any provider`, [REGISTRY]);
      continue;
    }

    // Parity: every prompt reaches every provider unless exempted.
    const exemption = SINGLE_PROVIDER[id];
    const expected = exemption ? [...exemption.providers].sort() : allProviders;
    const missing = expected.filter(p => !senders.includes(p));
    const unexpected = senders.filter(p => !expected.includes(p));

    if (missing.length > 0) {
      fail(
        `${id} — not rendered by ${missing.join(', ')}` +
          (exemption ? `\n      exemption says: ${exemption.reason}` : ''),
        missing.map(p => PROVIDERS[p])
      );
    }
    if (unexpected.length > 0) {
      fail(
        `${id} — rendered by ${unexpected.join(', ')}, which the SINGLE_PROVIDER exemption does not list.\n` +
          `      If the gap is closed, delete the exemption instead of widening it.`,
        unexpected.map(p => PROVIDERS[p])
      );
    }

    if (!spec.includes(`'${id}'`)) {
      fail(`${id} — no rendering assertion in ${REGISTRY_SPEC}`, [REGISTRY_SPEC]);
    }

    const row = rows.get(id);
    if (!row) {
      fail(`${id} — in the registry but not listed in ${DOC}`, [REGISTRY]);
      continue;
    }
    if (row.since !== meta.since) {
      fail(`${id} — Since column says ${row.since}, the registry says ${meta.since}`, [
        `${DOC}:${row.line}`,
      ]);
    }
    if (row.feature !== meta.feature) {
      fail(`${id} — Feature column says ${row.feature}, the registry says ${meta.feature}`, [
        `${DOC}:${row.line}`,
      ]);
    }
    if (row.providers.join(',') !== senders.join(',')) {
      fail(
        `${id} — Providers column disagrees with the call sites\n` +
          `      ${DOC}:${row.line}   ${row.providers.join(', ') || '—'}\n` +
          `      call sites          ${senders.join(', ') || '—'}`
      );
    }
  }

  for (const id of rows.keys()) {
    if (!prompts.has(id)) {
      fail(`${id} — listed in ${DOC} but absent from the registry`, [`${DOC}:${rows.get(id).line}`]);
    }
  }

  for (const id of Object.keys(SINGLE_PROVIDER)) {
    if (!prompts.has(id)) {
      fail(`${id} — exempted in this script but no longer a registered prompt`, ['scripts/check-prompts.mjs']);
    }
  }

  // The tripwire: a prompt written inline instead of registered.
  let literalCount = 0;
  for (const [provider, source] of Object.entries(sources)) {
    for (const literal of findInlineLiterals(source)) {
      literalCount++;
      fail(
        `${provider} — inline prompt literal (${literal.length} chars), not registered in PROMPTS`,
        [`${PROVIDERS[provider]}:${literal.line}`]
      );
    }
  }

  const exempted = Object.keys(SINGLE_PROVIDER).length;
  console.log(
    `Checked ${prompts.size} prompts (${exempted} single-provider by exemption) ` +
      `against ${rows.size} registry rows and ${Object.keys(PROVIDERS).length} provider services` +
      (literalCount === 0 ? ', with no inline prompt literals' : '')
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s):\n`);
    for (const { message, sites: where } of failures) {
      console.error(`  ${message}`);
      for (const site of [...where].sort()) {
        console.error(`      ${site}`);
      }
    }
    console.error(`\nUpdate ${DOC} and ${REGISTRY} in the same commit as the prompt change.`);
    process.exit(1);
  }

  console.log(`Every registered prompt is sent, documented and asserted.`);
}

// ------------------------------------------------------------------ self-test

/**
 * Exercises the checker itself against fixtures, so a change that silently
 * stops it detecting anything fails the build rather than passing quietly.
 */
function selfTest() {
  const cases = [];
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, actual, expected });
  };

  const registry = `
export const PROMPTS = {
  alpha: {
    since: '1.17.92',
    feature: 'categorization',
    render: renderAlpha,
  },
  beta: {
    since: '2.0.0',
    feature: 'insights',
    render: renderBeta,
  },
} as const;
`;
  check('parses ids, since and feature', [...parseRegistry(registry).entries()], [
    ['alpha', { since: '1.17.92', feature: 'categorization' }],
    ['beta', { since: '2.0.0', feature: 'insights' }],
  ]);

  const sites = findCallSites({
    gemini: `const r = renderPrompt('alpha', {});\n// renderPrompt('ghost')`,
    openai: `renderPrompt(\n  'alpha'\n)`,
  });
  check('finds call sites across providers', [...sites.get('alpha').keys()].sort(), [
    'gemini',
    'openai',
  ]);
  check('ignores a call site inside a comment', sites.has('ghost'), false);

  check(
    'flags a multi-line literal',
    findInlineLiterals('const p = `line one\nline two`;').length,
    1
  );
  check(
    'flags an over-long single-line literal',
    findInlineLiterals(`const p = \`${'x'.repeat(MAX_LITERAL_LENGTH + 1)}\`;`).length,
    1
  );
  check('ignores a short plumbing literal', findInlineLiterals('const u = `a/${b}`;').length, 0);
  check(
    'ignores a long console.log diagnostic',
    findInlineLiterals(`console.log(\`${'x'.repeat(MAX_LITERAL_LENGTH + 1)}\`);`).length,
    0
  );
  check(
    'ignores a multi-line thrown Error message',
    findInlineLiterals('throw new Error(`line one\nline two`);').length,
    0
  );
  check(
    'ignores an allowlisted data URL literal',
    findInlineLiterals('const u = `data:image/jpeg;base64,${b}`;').length,
    0
  );

  const doc = `
<!-- prompt-registry:start -->
| Prompt | Feature | Providers | Since | Purpose |
|---|---|---|---|---|
| \`alpha\` | categorization | gemini, openai | 1.17.92 | does a thing |
<!-- prompt-registry:end -->
`;
  check('parses a doc row', [...parseDocRows(doc).get('alpha').providers], ['gemini', 'openai']);
  check('reports missing markers as null', parseDocRows('no markers here'), null);

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
  console.log(`check-prompts self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
