#!/usr/bin/env node
/**
 * Does a semantic representation of merchant text actually beat the 0.7
 * string threshold?
 *
 * #296 asks for that measurement before anything is built, and allows the
 * issue to close as declined if the answer is no. This is the measurement.
 *
 * It imports the app's REAL matcher and normaliser out of src/ and bundles
 * them with esbuild, the same trick docs/model-probe uses and for the same
 * reason: a copy drifts, and then the probe passes while production breaks.
 *
 * It is deliberately manual and must not go into CI. The embedding half
 * spends real API quota and needs a key. There is deliberately no npm script
 * for it, because an npm script is how it ends up in a workflow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BUILD = path.join(HERE, '.build');
const FIXTURE = path.join(HERE, 'fixture.json');
const BASELINE = path.join(HERE, 'baseline.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const EMBED_MODEL = argOf('--model', 'gemini-embedding-001');
const SWEEP = [];
for (let t = 0.6; t <= 0.951; t += 0.05) SWEEP.push(Number(t.toFixed(2)));

/* ------------------------------------------------------------------ metrics */

/** Counts and rates for one decider over one set of labelled pairs. */
function score(pairs, decide) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of pairs) {
    const said = decide(p);
    if (said && p.same) tp += 1;
    else if (said && !p.same) fp += 1;
    else if (!said && p.same) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    tp, fp, fn, tn,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
  };
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Per-family correct/total, so "wins overall" and "wins on one family" are distinguishable. */
function byFamily(pairs, decide) {
  const out = {};
  for (const p of pairs) {
    const bucket = (out[p.family] ??= { correct: 0, total: 0 });
    bucket.total += 1;
    if (decide(p) === p.same) bucket.correct += 1;
  }
  return out;
}

/* -------------------------------------------------------------- self-test */

function selfTest() {
  const fake = (same, said) => ({ same, said });
  const decide = (p) => p.said;
  let failures = 0;
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) {
      failures += 1;
      console.log(`       expected ${JSON.stringify(expected)}`);
      console.log(`       actual   ${JSON.stringify(actual)}`);
    }
  };

  const perfect = score([fake(true, true), fake(false, false)], decide);
  check('a perfect decider scores 1', [perfect.precision, perfect.recall, perfect.f1], [1, 1, 1]);

  const allYes = score([fake(true, true), fake(false, true)], decide);
  check('saying yes to everything halves precision', [allYes.precision, allYes.recall], [0.5, 1]);

  const allNo = score([fake(true, false), fake(false, false)], decide);
  check('saying no to everything scores zero, not NaN', [allNo.precision, allNo.recall, allNo.f1], [0, 0, 0]);

  const empty = score([], decide);
  check('an empty set does not divide by zero', [empty.precision, empty.f1], [0, 0]);

  const counts = score([fake(true, true), fake(true, false), fake(false, true), fake(false, false)], decide);
  check('counts land in the right quadrants', [counts.tp, counts.fn, counts.fp, counts.tn], [1, 1, 1, 1]);

  const fam = byFamily(
    [{ same: true, said: true, family: 'x' }, { same: true, said: false, family: 'x' }],
    decide
  );
  check('a family reports correct over total', fam, { x: { correct: 1, total: 2 } });

  check('the sweep covers 0.60 to 0.95 in 0.05 steps', SWEEP,
    [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);

  console.log(`probe self-test: ${failures === 0 ? 'all passed' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (has('--self-test')) selfTest();

/* ------------------------------------------------------------ the app's code */

/**
 * Bundle the app's real normaliser and matcher.
 *
 * Not a copy: the number this probe reports has to be the number the shipped
 * ladder produces, or the decision rests on a fiction.
 */
function buildAppApi() {
  fs.mkdirSync(BUILD, { recursive: true });
  const entry = path.join(BUILD, 'entry.ts');
  fs.writeFileSync(entry, `
export { normalizeMerchant, DEFAULT_RECURRING_OPTIONS } from '${path.join(REPO, 'src/app/core/utils/recurring-pattern.utils')}';
export { merchantKeysMatch, bigramSimilarity, DEFAULT_MERCHANT_SIMILARITY } from '${path.join(REPO, 'src/app/core/utils/merchant-match.utils')}';
`);
  const out = path.join(BUILD, 'app-api.mjs');
  execFileSync(
    path.join(REPO, 'node_modules/.bin/esbuild'),
    [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  return out;
}

function loadKey() {
  const envFile = path.join(REPO, '.vscode/environment.ts');
  if (!fs.existsSync(envFile)) {
    console.error(`No ${envFile}. See docs/ui-audit/tools/README.md for the local environment file.`);
    process.exit(1);
  }
  const m = fs.readFileSync(envFile, 'utf8').match(/geminiApiKey:\s*'([^']+)'/);
  if (!m) {
    console.error('No geminiApiKey in .vscode/environment.ts — the embedding run needs a real key.');
    process.exit(1);
  }
  return m[1];
}

/* --------------------------------------------------------------- the corpus */

function loadPairs() {
  const pairs = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).pairs;
  const csvPath = argOf('--csv', null);
  if (!csvPath) return { pairs, fromCsv: 0 };

  // Pairs drawn from a real export: every distinct description against every
  // other, kept only where the string ladder and the label could differ. The
  // file is read from wherever it sits and nothing from it is written here.
  const rows = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  const extra = [];
  for (const line of rows) {
    const [a, b, same, family] = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
    if (a && b && (same === 'true' || same === 'false')) {
      extra.push({ a, b, same: same === 'true', family: family || 'from-csv', why: 'from a real export' });
    }
  }
  return { pairs: [...pairs, ...extra], fromCsv: extra.length };
}

/* ------------------------------------------------------------- embeddings */

async function embedAll(keys, key) {
  const vectors = new Map();
  let requests = 0;
  const BATCH = 100;
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: slice.map(text => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text }] },
          })),
        }),
      }
    );
    requests += 1;
    if (!res.ok) {
      console.error(`embed failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
      process.exit(1);
    }
    const body = await res.json();
    body.embeddings.forEach((e, n) => vectors.set(slice[n], e.values));
    process.stdout.write(`  embedded ${Math.min(i + BATCH, keys.length)}/${keys.length}\r`);
  }
  process.stdout.write('\n');
  return { vectors, requests };
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* -------------------------------------------------------------------- run */

const app = await import(buildAppApi());
const { pairs, fromCsv } = loadPairs();
const threshold = app.DEFAULT_MERCHANT_SIMILARITY;

const normalized = pairs.map(p => ({
  ...p,
  na: app.normalizeMerchant(p.a),
  nb: app.normalizeMerchant(p.b),
}));

const stringDecide = (p) => app.merchantKeysMatch(p.na, p.nb, threshold);
const stringScore = score(normalized, stringDecide);
const stringFamilies = byFamily(normalized, stringDecide);

const report = {
  model: null,
  threshold,
  pairs: normalized.length,
  fromCsv,
  string: { ...stringScore, families: stringFamilies },
  embedding: null,
};

if (has('--embeddings')) {
  const key = loadKey();
  const keys = [...new Set(normalized.flatMap(p => [p.na, p.nb]))].filter(Boolean);
  console.log(`embedding ${keys.length} distinct merchant keys with ${EMBED_MODEL}...`);
  const started = Date.now();
  const { vectors, requests } = await embedAll(keys, key);
  const elapsedMs = Date.now() - started;

  const sims = normalized.map(p => ({
    ...p,
    cos: vectors.has(p.na) && vectors.has(p.nb)
      ? cosine(vectors.get(p.na), vectors.get(p.nb))
      : -1,
  }));

  const sweep = SWEEP.map(t => {
    const decide = (p) => p.cos >= t;
    return { threshold: t, ...score(sims, decide) };
  });
  const best = sweep.reduce((a, b) => (b.f1 > a.f1 ? b : a));
  const bestDecide = (p) => p.cos >= best.threshold;

  report.model = EMBED_MODEL;
  report.embedding = {
    best,
    sweep,
    families: byFamily(sims, bestDecide),
    requests,
    elapsedMs,
    // Pairs the string ladder misses that the best embedding threshold gets,
    // and vice versa. The reason to adopt or decline is in these two lists,
    // not in the F1 delta alone.
    wonByEmbedding: sims.filter(p => p.same && !stringDecide(p) && bestDecide(p)).map(p => [p.a, p.b]),
    lostByEmbedding: sims.filter(p => !p.same && !stringDecide(p) && bestDecide(p)).map(p => [p.a, p.b]),
  };
}

/* ----------------------------------------------------------------- output */

const pct = (n) => `${(n * 100).toFixed(1)}%`;
console.log(`\n${report.pairs} pairs (${fromCsv} from --csv), string threshold ${threshold}\n`);
console.log('decider    TP  FP  FN  TN   precision  recall     F1');
const line = (name, s) =>
  console.log(`${name.padEnd(10)} ${String(s.tp).padStart(2)}  ${String(s.fp).padStart(2)}  ${String(s.fn).padStart(2)}  ${String(s.tn).padStart(2)}   ${pct(s.precision).padStart(8)}  ${pct(s.recall).padStart(6)}  ${pct(s.f1).padStart(6)}`);
line('string', stringScore);
if (report.embedding) line(`emb@${report.embedding.best.threshold}`, report.embedding.best);

console.log('\nper family (correct/total)');
const families = Object.keys(stringFamilies).sort();
for (const f of families) {
  const s = stringFamilies[f];
  const e = report.embedding?.families[f];
  console.log(`  ${f.padEnd(18)} string ${s.correct}/${s.total}${e ? `   embedding ${e.correct}/${e.total}` : ''}`);
}

if (report.embedding) {
  const { best, sweep, requests, elapsedMs, wonByEmbedding, lostByEmbedding } = report.embedding;
  console.log('\nthreshold sweep (F1)');
  console.log('  ' + sweep.map(s => `${s.threshold}:${s.f1.toFixed(2)}`).join('  '));
  console.log(`\ncost: ${requests} request(s), ${(elapsedMs / 1000).toFixed(1)}s`);

  console.log(`\nwon by embedding (${wonByEmbedding.length}) — same merchant the string ladder misses`);
  wonByEmbedding.forEach(([a, b]) => console.log(`  + ${a}  ==  ${b}`));
  console.log(`\nlost by embedding (${lostByEmbedding.length}) — different merchants it merges`);
  lostByEmbedding.forEach(([a, b]) => console.log(`  - ${a}  !=  ${b}`));

  const delta = best.f1 - stringScore.f1;
  const regressed = families.filter(f => {
    const e = report.embedding.families[f];
    return e && (stringFamilies[f].correct - e.correct) > 1;
  });
  console.log('\n--- the pre-registered bar ---');
  console.log(`  F1 delta ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} (needs >= +0.050): ${delta >= 0.05 ? 'PASS' : 'FAIL'}`);
  console.log(`  families regressing by more than one pair: ${regressed.length ? regressed.join(', ') : 'none'} — ${regressed.length ? 'FAIL' : 'PASS'}`);
  console.log(`  VERDICT: embeddings ${delta >= 0.05 && regressed.length === 0 ? 'WIN' : 'LOSE'}`);
}

if (has('--update')) {
  if (fromCsv > 0) {
    console.error('\n--update refused: --csv pairs are not in the repo, so a baseline recorded from them is not reproducible by anyone else.');
    process.exit(1);
  }
  fs.writeFileSync(BASELINE, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(REPO, BASELINE)}`);
} else if (fromCsv > 0) {
  console.log('\n(--csv pairs included; these numbers are printed, not recorded)');
}
