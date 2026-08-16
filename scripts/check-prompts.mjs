#!/usr/bin/env node
/**
 * Keeps the three provider services honest about the prompt registry.
 *
 * Five things have to agree:
 *   1. the ids in src/app/core/prompts/prompt-registry.ts,
 *   2. the renderPrompt() call sites in the shared provider base and the three
 *      provider services,
 *   3. the table in docs/prompts.md,
 *   4. the rendering assertions in prompt-registry.spec.ts,
 *   5. every provider either reading the declared sampling settings or naming
 *      an exemption for why its models cannot take them.
 *
 * Most operations are now rendered once, in cloud-llm-provider.base.ts, and
 * only the transport differs per provider. A call site there reaches all three
 * providers, so it counts as all three — and the two ways that can go wrong are
 * checked for: a prompt rendered both in the base and in a provider file (one
 * of the two is drift), and a single-provider exemption claimed by a file that
 * every provider shares.
 *
 * It also refuses a hand-written currency or recognition-language list in the
 * prompts and the OCR surfaces. That is a different kind of check — nothing is
 * out of sync, the code simply decided on the app's behalf what the model is
 * allowed to read. It recurs because writing the shortlist is always the
 * shorter diff, and every language added by hand is one someone has to add
 * again for the next country.
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
 *   - Whether the sampling parameters an adapter mentions actually reach the
 *     wire. The check below proves a provider file either reads
 *     `rendered.temperature` or carries a named exemption; only the parity spec
 *     proves the value arrives, and on which models.
 *   - A prompt assembled by concatenating short fragments to slip under the
 *     long-literal heuristic. This is a tripwire, not a proof.
 *   - Prompt text reaching a model from outside the three provider files. The
 *     no-restricted-imports rule in eslint.config.js covers that, by keeping
 *     the SDKs importable only from the services that own them.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';

const REGISTRY = 'src/app/core/prompts/prompt-registry.ts';
const REGISTRY_SPEC = 'src/app/core/prompts/prompt-registry.spec.ts';
const DOC = 'docs/prompts.md';
const PROVIDERS = {
  gemini: 'src/app/core/services/gemini.service.ts',
  openai: 'src/app/core/services/openai.service.ts',
  claude: 'src/app/core/services/claude.service.ts',
};

/** The base every provider extends. What it renders, all three send. */
const SHARED_KEY = 'shared';
const SHARED = 'src/app/core/services/cloud-llm-provider.base.ts';

/** Every file a prompt may legitimately be rendered from, by key. */
const SOURCE_FILES = { ...PROVIDERS, [SHARED_KEY]: SHARED };

const ALL_PROVIDERS = Object.keys(PROVIDERS).sort();

/**
 * Prompts that legitimately reach only some providers, and why.
 *
 * Every entry here is a capability gap rather than a design choice, so the
 * reason names the issue that closes it. An empty table is the goal.
 */
const SINGLE_PROVIDER = {
  receiptSummary: {
    providers: ['gemini'],
    reason: 'Gemini reduces one photo to a summary row; the others go straight to statement extraction',
  },
  receiptItems: {
    providers: ['gemini'],
    reason: 'position-aware single-image itemization has no OpenAI/Claude counterpart yet',
  },
};

/**
 * Providers whose models cannot take the declared sampling settings, and why.
 *
 * Same convention as SINGLE_PROVIDER above: an entry names the reason, so
 * closing a gap means deleting a line rather than widening one. The registry
 * makes `temperature` a required property of every prompt, and Gemini has
 * honoured it since ADR 0005 — but a seam can only carry what the transport
 * accepts, and two vendors have since withdrawn the parameter.
 *
 * An exempted provider must still be *reachable*: `acceptsSampling` in
 * config/ai-models.ts is per model, so a provider is listed here only when no
 * model in its catalog takes one. Claude is deliberately absent — it gates per
 * model and reads the declared value, which is what this check requires.
 */
const SAMPLING_EXEMPT = {
  openai: 'the Responses API rejects an explicit temperature for the GPT-5 family, and every id in OPENAI_MODELS is GPT-5',
};

/** What a provider file must mention to count as honouring the declared value. */
const SAMPLING_READ = /rendered\.temperature/;

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

/**
 * Where a hand-written language or currency list does real damage.
 *
 * The prompts, because three different currency shortlists lived in them, none
 * agreeing with each other or with the app's catalog — so a receipt in a
 * currency nobody had typed out was steered towards one that had been. And the
 * OCR surfaces, because the recognition language list silently decided which
 * scripts the app could read at all, and was duplicated in TypeScript and Swift
 * where the two could drift apart.
 *
 * Deliberately NOT the currency catalog in models/: that list is the picker's,
 * and a curated picker is a design choice rather than a ceiling on extraction.
 */
const PROMPT_DIR = 'src/app/core/prompts';
const OCR_SURFACES = [
  'src/app/core/config/ai-models.ts',
  'src/app/core/plugins/vision-ocr.plugin.ts',
  'src/app/core/services/vision-ocr.service.ts',
  'src/app/core/services/native-receipt.service.ts',
];

/** The runtime's own ISO 4217 table, so this check keeps no list either. */
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const failures = [];

/**
 * What to do about a failure, printed once at the end however many failures
 * share it. The two checks in here fail for unrelated reasons and the fix for
 * one is no help with the other.
 */
const HINTS = {
  parity: () => `Update ${DOC} and ${REGISTRY} in the same commit as the prompt change.`,
  vocabulary: () =>
    'Derive the set instead: ask the engine what it supports, or validate the answer ' +
    'against the runtime tables. A list written here is a ceiling on what can be read.',
  sampling: () =>
    'Either read rendered.temperature in the adapter — gated on acceptsSampling() when ' +
    'only some of its models take one — or add a SAMPLING_EXEMPT entry naming why none can.',
};

const fail = (message, sites = [], hint = 'parity') => failures.push({ message, sites, hint });

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

/**
 * Runs of hand-written currency codes or recognition language tags.
 *
 * Three codes is the threshold because two can be a genuine contrast — "USD
 * unless the receipt says EUR" is a comparison, not a catalog — while three is
 * someone starting a list. Comments are blanked first, so a note recording why
 * a list was removed does not re-trip the check that removed it.
 */
export function findHardcodedVocabulary(text) {
  const source = blankComments(text);
  const found = [];

  const currencyRun = /\b[A-Z]{3}\b(?:\s*(?:,|\/|\||\bor\b)\s*\b[A-Z]{3}\b){2,}/g;
  for (const match of source.matchAll(currencyRun)) {
    const codes = match[0].match(/\b[A-Z]{3}\b/g);
    if (codes.every(code => ISO_CURRENCIES.has(code))) {
      found.push({ kind: 'currency', sample: match[0], line: lineOf(text, match.index) });
    }
  }

  const languageRun = /(['"])[a-z]{2}-[A-Za-z]{2,4}\1(?:\s*,\s*(['"])[a-z]{2}-[A-Za-z]{2,4}\2)+/g;
  for (const match of source.matchAll(languageRun)) {
    found.push({ kind: 'language', sample: match[0], line: lineOf(text, match.index) });
  }

  return found;
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

/** `renderPrompt('id'` sites, as id -> source key -> [line]. */
export function findCallSites(files) {
  const sites = new Map();
  for (const [key, source] of Object.entries(files)) {
    const text = blankComments(source);
    const call = /renderPrompt\(\s*'([a-zA-Z][A-Za-z0-9]*)'/g;
    let match;
    while ((match = call.exec(text)) !== null) {
      const found = sites.get(match[1]) ?? new Map();
      const lines = found.get(key) ?? [];
      lines.push(lineOf(text, match.index));
      found.set(key, lines);
      sites.set(match[1], found);
    }
  }
  return sites;
}

/**
 * Providers that neither read the declared sampling settings nor claim an
 * exemption, and exemptions no longer earning their place.
 *
 * Comments are blanked first, so the prose above `samplingParams` explaining
 * why a value is withheld does not count as reading it — the check has to see
 * the code, not the apology for its absence.
 *
 * Reported both ways round, like the prompt parity check: a silent omission is
 * how #263 shipped, and a stale exemption is how the next one would.
 */
export function findSamplingGaps(files, exemptions) {
  const gaps = [];
  for (const [key, source] of Object.entries(files)) {
    if (key === SHARED_KEY) {
      continue;
    }
    const reads = SAMPLING_READ.test(blankComments(source));
    const exempt = Object.prototype.hasOwnProperty.call(exemptions, key);

    if (!reads && !exempt) {
      gaps.push({ provider: key, kind: 'dropped' });
    }
    if (reads && exempt) {
      gaps.push({ provider: key, kind: 'staleExemption' });
    }
  }
  return gaps.sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * Which providers a prompt reaches, given the files it is rendered from, and
 * what is wrong with where those files are.
 *
 * A call site in the shared base reaches every provider by construction — that
 * is the whole point of the base — so it stands in for all three rather than
 * being a fourth sender. Two things make that unsound, and both are reported
 * rather than resolved:
 *
 *   - the same prompt rendered in the base *and* in a provider file. One of
 *     the two is dead or divergent, and the checker cannot tell which.
 *   - a SINGLE_PROVIDER exemption on a prompt rendered from the base. An
 *     exemption says "only Gemini can do this"; a file all three inherit from
 *     is the one place that cannot be true of.
 */
export function classifySites(files, { exempted = false } = {}) {
  const inShared = files.includes(SHARED_KEY);
  const concrete = files.filter(key => key !== SHARED_KEY).sort();
  return {
    senders: inShared ? [...ALL_PROVIDERS] : concrete,
    renderedTwice: inShared ? concrete : [],
    exemptedInShared: inShared && exempted,
  };
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
  for (const path of [REGISTRY, REGISTRY_SPEC, DOC, ...Object.values(SOURCE_FILES)]) {
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
    Object.entries(SOURCE_FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')])
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

  const vocabularySurfaces = [
    ...(existsSync(PROMPT_DIR)
      ? readdirSync(PROMPT_DIR)
        .filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
        .map(name => `${PROMPT_DIR}/${name}`)
      : []),
    ...OCR_SURFACES,
    ...Object.values(SOURCE_FILES),
  ].filter(existsSync);

  for (const path of vocabularySurfaces) {
    for (const { kind, sample, line } of findHardcodedVocabulary(readFileSync(path, 'utf8'))) {
      fail(
        `hand-written ${kind} list "${sample.trim()}" — the app is deciding what the model may read`,
        [`${path}:${line}`],
        'vocabulary'
      );
    }
  }

  // Per file rather than per prompt: every prompt declares a temperature, so
  // what varies is which adapter carries it.
  for (const { provider, kind } of findSamplingGaps(sources, SAMPLING_EXEMPT)) {
    if (kind === 'dropped') {
      fail(
        `${provider} never reads rendered.temperature — the declared sampling is dropped on the wire`,
        [PROVIDERS[provider]],
        'sampling'
      );
    } else {
      fail(
        `${provider} reads rendered.temperature but is still listed in SAMPLING_EXEMPT — delete the entry`,
        [PROVIDERS[provider]],
        'sampling'
      );
    }
  }

  for (const key of Object.keys(SAMPLING_EXEMPT)) {
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, key)) {
      fail(`SAMPLING_EXEMPT names "${key}", which is not a provider`, [], 'sampling');
    }
  }

  for (const [id, meta] of prompts) {
    const found = sites.get(id);
    const exemption = SINGLE_PROVIDER[id];
    const { senders, renderedTwice, exemptedInShared } = classifySites(
      found ? [...found.keys()] : [],
      { exempted: !!exemption }
    );

    if (senders.length === 0) {
      fail(`${id} — registered but never rendered from any provider`, [REGISTRY]);
      continue;
    }

    if (renderedTwice.length > 0) {
      fail(
        `${id} — rendered in the shared base and in ${renderedTwice.join(', ')}; ` +
          `one of them is drift.\n` +
          `      A prompt the base renders already reaches all three providers.`,
        [SHARED, ...renderedTwice.map(p => PROVIDERS[p])]
      );
    }
    if (exemptedInShared) {
      fail(
        `${id} — exempted as single-provider but rendered from the shared base, ` +
          `which every provider inherits.\n` +
          `      Exemptions name concrete provider files; move the call site or ` +
          `drop the exemption.`,
        [SHARED]
      );
    }

    // Parity: every prompt reaches every provider unless exempted.
    const expected = exemption ? [...exemption.providers].sort() : ALL_PROVIDERS;
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
  for (const [key, source] of Object.entries(sources)) {
    for (const literal of findInlineLiterals(source)) {
      literalCount++;
      fail(
        `${key} — inline prompt literal (${literal.length} chars), not registered in PROMPTS`,
        [`${SOURCE_FILES[key]}:${literal.line}`]
      );
    }
  }

  const exempted = Object.keys(SINGLE_PROVIDER).length;
  console.log(
    `Checked ${prompts.size} prompts (${exempted} single-provider by exemption) ` +
      `against ${rows.size} registry rows, the shared provider base and ` +
      `${Object.keys(PROVIDERS).length} provider services` +
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
    for (const hint of [...new Set(failures.map(f => f.hint))]) {
      console.error(`\n${HINTS[hint]()}`);
    }
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
    [SHARED_KEY]: `renderPrompt('beta')`,
  });
  check('finds call sites across providers', [...sites.get('alpha').keys()].sort(), [
    'gemini',
    'openai',
  ]);
  check('ignores a call site inside a comment', sites.has('ghost'), false);
  check('finds a call site in the shared base', [...sites.get('beta').keys()], [SHARED_KEY]);

  check(
    'counts one shared call site as every provider',
    classifySites([SHARED_KEY]).senders,
    ['claude', 'gemini', 'openai']
  );
  check(
    'flags a prompt rendered in the base and in a provider as drift',
    classifySites([SHARED_KEY, 'gemini']).renderedTwice,
    ['gemini']
  );
  check(
    'flags a single-provider exemption rendered from the base',
    classifySites([SHARED_KEY], { exempted: true }).exemptedInShared,
    true
  );
  check(
    'leaves a concrete-file exemption alone',
    classifySites(['gemini'], { exempted: true }),
    { senders: ['gemini'], renderedTwice: [], exemptedInShared: false }
  );

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

  const carries = 'return { temperature: rendered.temperature };';
  const gated = 'return accepts(this.model) ? { temperature: rendered.temperature } : {};';
  const silent = 'return { max_tokens: rendered.maxOutputTokens };';

  check(
    'accepts a provider that reads the declared temperature',
    findSamplingGaps({ gemini: carries }, {}),
    []
  );
  check(
    'accepts a model-gated read',
    findSamplingGaps({ claude: gated }, {}),
    []
  );
  check(
    'flags a provider that silently drops it',
    findSamplingGaps({ claude: silent }, {}),
    [{ provider: 'claude', kind: 'dropped' }]
  );
  check(
    'accepts a silent provider that names an exemption',
    findSamplingGaps({ openai: silent }, { openai: 'reason' }),
    []
  );
  check(
    'flags an exemption the code has outgrown',
    findSamplingGaps({ openai: carries }, { openai: 'reason' }),
    [{ provider: 'openai', kind: 'staleExemption' }]
  );
  check(
    'does not accept a comment as a read',
    findSamplingGaps({ claude: `// we would send rendered.temperature but cannot\n${silent}` }, {}),
    [{ provider: 'claude', kind: 'dropped' }]
  );
  check(
    'ignores the shared base, which owns no transport',
    findSamplingGaps({ [SHARED_KEY]: silent }, {}),
    []
  );

  check(
    'flags a hand-written currency shortlist',
    findHardcodedVocabulary(`const c = 'USD, EUR, JPY, CNY';`).map(f => f.kind),
    ['currency']
  );
  check(
    'flags a currency shortlist written with slashes',
    findHardcodedVocabulary(`const c = 'TWD/CNY/JPY';`).map(f => f.kind),
    ['currency']
  );
  check(
    'flags a hand-written recognition language list',
    findHardcodedVocabulary(`const L = ['en-US', 'ja-JP', 'zh-Hant'];`).map(f => f.kind),
    ['language']
  );
  check(
    'ignores two currencies in a genuine contrast',
    findHardcodedVocabulary(`if (code === 'USD' || code === 'EUR') {}`).length,
    0
  );
  check(
    'ignores a comment recording why a list was removed',
    findHardcodedVocabulary('// used to steer at USD, EUR, JPY, CNY\nconst x = 1;').length,
    0
  );
  check(
    'ignores three uppercase words that are not currencies',
    findHardcodedVocabulary(`const s = 'ONE, TWO, SIX';`).length,
    0
  );
  check(
    'ignores a single language tag',
    findHardcodedVocabulary(`const l = 'zh-Hant';`).length,
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
