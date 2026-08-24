// Send the app's REAL receipt prompt and a real image to a REAL model, run the
// app's REAL validators over the answer, and compare the result to a committed
// baseline.
//
// Why this exists: every other test in this repo feeds the extraction path a
// canned response. Nothing proves the shipped prompt actually gets a usable
// answer out of a live model, and nothing would notice if a model update
// changed that. This is the only check that would.
//
// It is deliberately manual, never in CI: it spends real API quota and its
// answers are not perfectly deterministic. Run it when a receipt prompt
// changes, when the default model changes, or when extraction looks wrong in
// the wild.
//
// Read-only with respect to your data: no app, no Firestore, no writes. The
// only side effect is a handful of model requests.
//
// Usage:
//   node probe.mjs                    compare against baseline.json
//   node probe.mjs --model <id>       probe a different model
//   node probe.mjs --update           rewrite baseline.json from this run
//   node probe.mjs --raw              also dump each full model response
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render, CASE_IDS } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BASELINE = path.join(HERE, 'baseline.json');
const BUILD = path.join(HERE, '.build');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : dflt; };

/**
 * What each fixture is for, and what a correct answer looks like.
 *
 * `total: null` means the receipt prints no total, so any number is invented —
 * see the cropped case, which is the one that matters most.
 */
const CASES = {
  jp:      { country: 'JP', currency: 'JPY', total: 538,   why: 'Japanese conbini: address, phone, tax registration number, yen' },
  kr:      { country: 'KR', currency: 'KRW', total: 10400, why: 'Korean cafe: address, phone, business number, won' },
  none:    { country: '',   currency: '',    total: 6.85,  why: 'No country cues anywhere — the honest answer is "" and NOT a guess' },
  long:    { country: 'JP', currency: 'JPY', total: 12723, why: '34 items; the printed total (12,723) differs from the item sum (12,281)' },
  cropped: { country: 'JP', currency: 'JPY', total: null,  why: 'Cut off mid-item: the header survives, no printed total does' },
};

/** The app's own threshold for "ask the user to check this figure". */
const VERIFY_FIELD_THRESHOLD = 0.7;

function loadKey() {
  const envFile = path.join(REPO, '.vscode/environment.ts');
  if (!fs.existsSync(envFile)) {
    console.error(`No ${envFile}. See docs/ui-audit/tools/README.md for the local environment file.`);
    process.exit(1);
  }
  const m = fs.readFileSync(envFile, 'utf8').match(/geminiApiKey:\s*'([^']+)'/);
  if (!m) {
    console.error('No geminiApiKey in .vscode/environment.ts — this probe needs a real key.');
    process.exit(1);
  }
  return m[1];
}

/**
 * Bundle the app's real prompt registry and validators.
 *
 * Importing the TypeScript directly is the whole point: a copy of the prompt
 * would drift from the shipped one and the probe would pass while production
 * broke. esbuild comes from the app's own devDependencies.
 */
function buildAppApi() {
  fs.mkdirSync(BUILD, { recursive: true });
  const entry = path.join(BUILD, 'entry.ts');
  fs.writeFileSync(entry, `
export { renderPrompt, JSON_ONLY_PREAMBLE } from '${path.join(REPO, 'src/app/core/prompts/prompt-registry')}';
export {
  readCountryCode, readCurrencyCode, readPrintedLocation, readReceiptTotal, readFieldConfidence,
} from '${path.join(REPO, 'src/app/core/utils/receipt-extraction.utils')}';
`);
  const out = path.join(BUILD, 'app-api.mjs');
  execFileSync(
    path.join(REPO, 'node_modules/.bin/esbuild'),
    [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  return out;
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  return a >= 0 && b > a ? body.slice(a, b + 1) : body;
}

const KEY = loadKey();
const MODEL = argOf('--model', 'gemini-3.5-flash-lite');

console.log('rendering fixtures...');
await render({ quiet: true });
const api = await import(buildAppApi());

const rendered = api.renderPrompt('receiptParse');
const prompt = [api.JSON_ONLY_PREAMBLE, rendered.system, rendered.user].filter(Boolean).join('\n\n');
const generationConfig = {
  temperature: rendered.temperature,
  maxOutputTokens: rendered.maxOutputTokens,
  ...(rendered.topP !== undefined ? { topP: rendered.topP } : {}),
  responseMimeType: 'application/json',
};

// A prompt that lost its schema still "works" — the model invents a shape and
// every field reads as absent, which looks exactly like a model failure. Fail
// loudly instead.
if (prompt.length < 500 || !prompt.includes('"country"')) {
  console.error(`Rendered prompt looks wrong (${prompt.length} chars, country field: ${prompt.includes('"country"')}).`);
  console.error('renderPrompt returns a structured RenderedPrompt, not a string — check the fields being joined.');
  process.exit(1);
}

console.log(`model:  ${MODEL}`);
console.log(`prompt: ${prompt.length} chars, asks for country: ${prompt.includes('"country"')}`);
console.log(`config: ${JSON.stringify(generationConfig)}\n`);

const results = {};
let failures = 0;

for (const id of CASE_IDS) {
  const expect = CASES[id];
  const b64 = fs.readFileSync(path.join(HERE, 'receipts', `${id}.png`)).toString('base64');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: b64 } }] }],
        generationConfig,
      }),
    }
  );

  if (!res.ok) {
    const body = (await res.text()).replaceAll(KEY, '<KEY>');
    console.log(`${id}: HTTP ${res.status}\n${body.slice(0, 300)}\n`);
    results[id] = { httpError: res.status };
    failures++;
    continue;
  }

  const text = (await res.json())?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
  if (has('--raw')) console.log(`--- ${id} raw:\n${text}\n`);

  let parsed;
  try { parsed = JSON.parse(extractJson(text)); }
  catch { parsed = {}; }

  // The app's own boundary, not a reimplementation of it.
  const country = api.readCountryCode(parsed.country);
  const currency = api.readCurrencyCode(parsed.currency);
  const total = api.readReceiptTotal(parsed.receiptTotal ?? parsed.amount);
  const conf = api.readFieldConfidence(parsed) ?? {};
  const location = api.readPrintedLocation(parsed.location, parsed.merchant);

  const countryOk = country === expect.country;
  const currencyOk = currency === expect.currency;
  // A receipt printing no total cannot be got "right" — what must hold is that
  // the invented figure is flagged for the user rather than trusted.
  const totalOk = expect.total === null
    ? conf.amount !== undefined && conf.amount < VERIFY_FIELD_THRESHOLD
    : total === expect.total;

  if (!countryOk || !currencyOk || !totalOk) failures++;

  results[id] = { country, currency, total, amountConfidence: conf.amount, location, merchant: parsed.merchant, countryOk, currencyOk, totalOk };

  const flag = (ok) => (ok ? 'ok  ' : 'FAIL');
  console.log(`${id.padEnd(8)} ${expect.why}`);
  console.log(`         ${flag(countryOk)} country  ${JSON.stringify(country)} (want ${JSON.stringify(expect.country)})`);
  console.log(`         ${flag(currencyOk)} currency ${JSON.stringify(currency)} (want ${JSON.stringify(expect.currency)})`);
  console.log(
    expect.total === null
      ? `         ${flag(totalOk)} total    ${total} invented; amount confidence ${conf.amount} must be < ${VERIFY_FIELD_THRESHOLD} so the review chip fires`
      : `         ${flag(totalOk)} total    ${total} (want ${expect.total})`
  );
  console.log();
}

if (has('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ model: MODEL, recorded: new Date().toISOString().slice(0, 10), results }, null, 2) + '\n');
  console.log(`baseline.json updated from this run (${MODEL}).`);
  process.exit(failures ? 1 : 0);
}

// Drift against the recorded baseline. Expectations catch "wrong"; the baseline
// catches "different", which is what a model update looks like.
if (fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const drift = [];
  for (const id of CASE_IDS) {
    const a = base.results?.[id] ?? {};
    const b = results[id] ?? {};
    for (const f of ['country', 'currency', 'total']) {
      if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) drift.push(`  ${id}.${f}: baseline ${JSON.stringify(a[f])} -> now ${JSON.stringify(b[f])}`);
    }
  }
  console.log(`--- drift vs baseline (${base.model}, recorded ${base.recorded})`);
  console.log(drift.length ? drift.join('\n') : '  none');
  if (base.model !== MODEL) console.log(`  (baseline is a different model: ${base.model})`);
}

console.log(`\n${failures ? `${failures} case(s) failed` : 'all cases passed'}`);
process.exit(failures ? 1 : 0);
