// Send the app's REAL prompts, with a real image for the receipt ones, to a
// REAL model, read the answer the way the app does, and for the receipt
// fixtures compare the result to a committed baseline.
//
// Why this exists: every other test in this repo feeds the extraction path a
// canned response. Nothing proves the shipped prompt actually gets a usable
// answer out of a live model, and nothing would notice if a model update
// changed that. This is the only check that would.
//
// It is deliberately manual, never in CI: it spends real API quota and its
// answers are not perfectly deterministic. Run it when a prompt changes, when
// a default model changes, or when extraction looks wrong in the wild.
//
// Read-only with respect to your data: no app, no Firestore, no writes. The
// only side effect is a handful of model requests.
//
// Usage (`--help` prints every flag):
//   node probe.mjs                            Gemini on the receipt fixtures, against baseline.json
//   node probe.mjs --provider openai|claude   the same fixtures through that vendor's SDK
//   node probe.mjs --prompts small            the five smallest-budget prompts instead
//   node probe.mjs --model <id>               probe a different model
//   node probe.mjs --update                   rewrite baseline.json from this Gemini run
//   node probe.mjs --sampling force           send OpenAI or Claude the declared temperature, flagged or not
//   node probe.mjs --raw                      also print each full answer
//   node probe.mjs --dry-run                  print every request envelope; read no key, send nothing
//   node probe.mjs --self-test                check the probe itself, offline
//
// The arguments are parsed before anything else runs. Nothing reads a key,
// renders a fixture or opens a connection until they have been, and an unknown
// flag exits 2 with the usage.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The key variables, the two no option overrides, and the child environment
// without them, shared with render.mjs.
import {
  KEY_VARIABLES, UNOVERRIDABLE_VARIABLES, isKeyVariable, isHiddenVariable, childEnv,
} from './key-variables.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BASELINE = path.join(HERE, 'baseline.json');
const BUILD = path.join(HERE, '.build');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const PROVIDERS = ['gemini', 'openai', 'claude'];
const PROMPT_SETS = ['receipt', 'small'];
const SAMPLING_MODES = ['auto', 'force'];
const VALUE_FLAGS = ['--provider', '--prompts', '--model', '--repeat', '--effort', '--sampling'];
const SWITCHES = ['--raw', '--update', '--dry-run', '--self-test', '--help'];
const MAX_REPEAT = 10;
/** A model id as the vendors write one. The Gemini sender puts it in a URL path. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const USAGE = `usage: node docs/model-probe/probe.mjs [flags]

  --provider gemini|openai|claude  the vendor to probe (default gemini)
  --prompts receipt|small          the receipt fixtures against baseline.json (default),
                                   or the five smallest-budget prompts
  --model <id>                     the model to probe (default: the app's default for the provider):
                                   letters, digits, dots, dashes and underscores
  --repeat <n>                     send each prompt n times, 1 to ${MAX_REPEAT} (default 1)
  --effort none                    OpenAI only: also send reasoning.effort "none"
  --sampling auto|force            auto (default): temperature only where acceptsSampling
                                   flags the id, as the app sends it. force: OpenAI and
                                   Claude get the prompt's declared temperature whatever
                                   the flag says, so a keyed run shows the id taking it
                                   (an answer) or refusing it (an HTTP 400). Gemini always
                                   gets one. Not with --update
  --raw                            also print each full answer
  --update                         Gemini receipts only: rewrite baseline.json from this run
  --dry-run                        print each request envelope; read no key, send nothing
  --self-test                      check the probe itself, offline; takes no other flag
  --help                           print this

Keys: gemini reads geminiApiKey from .vscode/environment.ts, openai reads
OPENAI_API_KEY and claude reads ANTHROPIC_API_KEY. --dry-run and --self-test
read none of them.`;

/** `{ opts }` for a run, or `{ error }`. Pure: reads nothing but `argv`. */
function parseArgs(argv) {
  const given = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (given.has(arg)) return { error: `${arg} is given twice` };
    if (SWITCHES.includes(arg)) {
      given.set(arg, true);
      continue;
    }
    if (VALUE_FLAGS.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      given.set(arg, value);
      i++;
      continue;
    }
    return { error: `unknown argument: ${arg}` };
  }
  if (given.has('--self-test') && given.size > 1) return { error: '--self-test takes no other flag' };

  const provider = given.get('--provider') ?? 'gemini';
  if (!PROVIDERS.includes(provider)) return { error: `--provider must be one of ${PROVIDERS.join(', ')}` };
  const prompts = given.get('--prompts') ?? 'receipt';
  if (!PROMPT_SETS.includes(prompts)) return { error: `--prompts must be one of ${PROMPT_SETS.join(', ')}` };
  const model = given.get('--model');
  if (model !== undefined && !MODEL_ID.test(model)) {
    return { error: '--model must be a model id: letters, digits, dots, dashes and underscores, starting with a letter or digit' };
  }
  const repeatText = given.get('--repeat') ?? '1';
  const repeat = /^[1-9]\d*$/.test(repeatText) ? Number(repeatText) : NaN;
  if (!(repeat <= MAX_REPEAT)) return { error: `--repeat must be a whole number from 1 to ${MAX_REPEAT}` };
  const effort = given.get('--effort');
  if (effort !== undefined && effort !== 'none') return { error: '--effort takes only none' };
  if (effort !== undefined && provider !== 'openai') return { error: '--effort is OpenAI only' };
  const sampling = given.get('--sampling') ?? 'auto';
  if (!SAMPLING_MODES.includes(sampling)) return { error: `--sampling must be one of ${SAMPLING_MODES.join(', ')}` };
  const update = given.has('--update');
  const dryRun = given.has('--dry-run');
  if (update && provider !== 'gemini') return { error: '--update rewrites the Gemini receipt baseline, so it needs --provider gemini' };
  if (update && prompts !== 'receipt') return { error: '--update rewrites the receipt baseline, so it needs --prompts receipt' };
  if (update && dryRun) return { error: '--update and --dry-run cannot be combined' };
  if (update && repeat > 1) return { error: '--update records one run, so it cannot be combined with --repeat' };
  if (update && sampling === 'force') return { error: '--update records what the app sends, so it cannot be combined with --sampling force' };

  return {
    opts: {
      provider,
      prompts,
      model,
      repeat,
      effort,
      sampling,
      raw: given.has('--raw'),
      update,
      dryRun,
      selfTest: given.has('--self-test'),
      help: given.has('--help'),
    },
  };
}

// ---------------------------------------------------------------------------
// Printing. Every line goes through the one redactor: the keys this run holds,
// an auth header whatever its value, a ?key= parameter, and anything shaped
// like a key.
// ---------------------------------------------------------------------------

const SECRETS = new Set();
const KEY_SHAPE = /AIza[0-9A-Za-z_-]{20,}|\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}/;
const KEY_SHAPE_ALL = new RegExp(KEY_SHAPE.source, 'g');
const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key'];
/** The headers a printed request shows as they are, beside the `x-stainless-*` ones. */
const SHOWN_HEADERS = ['accept', 'content-type', 'content-length', 'anthropic-version', 'user-agent'];
const AUTH_HEADER_LINE = new RegExp(`^(\\s*(?:${AUTH_HEADERS.join('|')}):).*$`, 'gim');
const KEY_PARAM = /([?&]key=)[^&\s"']+/g;

function holdSecret(secret) {
  if (typeof secret === 'string' && secret.length >= 8) SECRETS.add(secret);
}

function redact(text) {
  let out = String(text);
  for (const secret of SECRETS) out = out.split(secret).join('<KEY>');
  return out.replace(AUTH_HEADER_LINE, '$1 <KEY>').replace(KEY_PARAM, '$1<KEY>').replace(KEY_SHAPE_ALL, '<KEY>');
}

function say(text = '') {
  console.log(redact(text));
}

function complain(text) {
  console.error(redact(text));
}

/** An early, deliberate stop: the dispatch prints the message and exits with the code. */
class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.error) {
  complain(`${ARGS.error}\n\n${USAGE}`);
  process.exit(2);
}
if (ARGS.opts.help) {
  say(USAGE);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// What the probe sends, and what a correct answer looks like.
// ---------------------------------------------------------------------------

/**
 * What each receipt fixture is for, and what a correct answer looks like.
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

/**
 * A prompt that lost its schema still "works": the model invents a shape and
 * every field reads as absent, which looks exactly like a model failure. Each
 * prompt names one marker its render must carry, and the probe refuses to send
 * one that lacks it.
 */
const RECEIPT_GUARD = { marker: '"country"', minChars: 500 };

const FIXTURE_CATALOG = [
  'food: Food & Dining',
  'food_groceries: Food & Dining / Groceries',
  'food_coffee: Food & Dining / Coffee & Drinks',
  'food_restaurants: Food & Dining / Restaurants',
  'transport: Transport',
  'transport_transit: Transport / Public Transit',
  'shopping: Shopping',
  'bills: Bills & Utilities',
  'other_expense: Other',
].join('\n');
const FIXTURE_CATEGORY_IDS = FIXTURE_CATALOG.split('\n').map(line => line.slice(0, line.indexOf(':')));

/**
 * The five smallest-budget prompts in the registry, with fixed inputs.
 *
 * `budget` is what the registry declared when this list was written; the
 * self-test fails when a render disagrees, and it ranks every registry prompt
 * by the budget it renders, so the list cannot quietly stop being the smallest
 * five. `marker` comes from the fixture input, so a renamed input field fails
 * the guard as surely as a lost template does. `parses` is whether the answer
 * has the shape the app reads, and `sample` is a well-formed answer for the
 * self-test.
 */
const SMALL_PROMPTS = {
  categorySuggestion: {
    budget: 50,
    input: { description: 'BLUE BOTTLE COFFEE SHIBUYA', categoryCatalog: FIXTURE_CATALOG },
    marker: 'BLUE BOTTLE COFFEE SHIBUYA',
    parses: text => FIXTURE_CATEGORY_IDS.includes(text.trim().replace(/^["'`]+|["'`.]+$/g, '')),
    sample: 'food_coffee',
  },
  searchQuery: {
    budget: 400,
    input: {
      query: 'How much did I spend on groceries last month?',
      context: {
        today: '2026-10-12',
        baseCurrency: 'USD',
        categories: [
          { id: 'food_groceries', name: 'Groceries', type: 'expense' },
          { id: 'food_coffee', name: 'Coffee & Drinks', type: 'expense' },
          { id: 'transport', name: 'Transport', type: 'expense' },
        ],
        goals: [],
        budgets: [],
      },
    },
    marker: 'How much did I spend on groceries last month?',
    parses: text => {
      const value = parseJsonAnswer(text);
      return isObject(value) && (value.kind === 'filter' || value.kind === 'aggregate');
    },
    sample: '{"kind":"aggregate","operation":"sum","filters":{"type":"expense","categoryId":"food_groceries","startDate":"2026-09-01","endDate":"2026-09-30"}}',
  },
  csvMapping: {
    budget: 500,
    input: {
      headers: ['Transaction Date', 'Payee', 'Debit', 'Credit', 'Balance'],
      sampleRows: [
        ['09/28/2026', 'WHOLE FOODS MARKET', '84.12', '', '1915.88'],
        ['09/29/2026', 'PAYROLL ACME CORP', '', '3200.00', '5115.88'],
        ['09/30/2026', 'METRO TRANSIT', '2.75', '', '5113.13'],
      ],
    },
    marker: '"Transaction Date"',
    parses: text => {
      const value = parseJsonAnswer(text);
      return isObject(value) && 'dateColumn' in value;
    },
    sample: '{"dateColumn":"Transaction Date","descriptionColumn":"Payee","amountColumn":null,"debitColumn":"Debit","creditColumn":"Credit","typeColumn":null,"categoryColumn":null,"dateFormat":"MM/DD/YYYY","hasHeader":true}',
  },
  suggestTags: {
    budget: 600,
    input: {
      rows: [
        { index: 0, description: 'BLUE BOTTLE COFFEE' },
        { index: 1, description: 'AMAZON MKTPLACE', merchant: 'Amazon', details: 'USB-C cable' },
        { index: 2, description: 'CITY PARKING GARAGE' },
      ],
      vocabulary: '- coffee\n- work\n- electronics\n- weekend',
    },
    marker: '- electronics',
    parses: text => Array.isArray(parseJsonAnswer(text)),
    sample: '[{"index":0,"tags":["coffee"]},{"index":1,"tags":["electronics"]},{"index":2,"tags":[]}]',
  },
  categorizeTransactions: {
    budget: 800,
    input: {
      categoryCatalog: FIXTURE_CATALOG,
      rows: [
        { index: 0, description: 'WHOLE FOODS MARKET #10234', amount: 84.12 },
        { index: 1, description: 'METRO TRANSIT FARE', amount: 2.75 },
        { index: 2, description: 'BLUE BOTTLE COFFEE', amount: 6.5 },
      ],
    },
    marker: '0: "WHOLE FOODS MARKET #10234" (84.12)',
    parses: text => {
      const value = parseJsonAnswer(text);
      return Array.isArray(value) && value.length > 0
        && value.every(entry => isObject(entry) && typeof entry.index === 'number' && typeof entry.categoryId === 'string');
    },
    sample: '[{"index":0,"categoryId":"food_groceries","confidence":0.9},{"index":1,"categoryId":"transport_transit","confidence":0.8},{"index":2,"categoryId":"food_coffee","confidence":0.9}]',
  },
};

/**
 * The inputs the self-test ranks the other registry prompts with. None of
 * their budgets depends on the input, so an empty one serves, except the
 * multi-image budget, which grows with the photo count and is ranked at one
 * photo, the fewest a call sends.
 */
const RANKING_INPUTS = { multiImageReceipts: { imageCount: 1 } };

const HOSTS = {
  gemini: 'generativelanguage.googleapis.com',
  openai: 'api.openai.com',
  claude: 'api.anthropic.com',
};
// Given to each client rather than left to the SDK, which would read
// OPENAI_BASE_URL / ANTHROPIC_BASE_URL from the environment.
const BASE_URLS = {
  gemini: `https://${HOSTS.gemini}/v1beta`,
  openai: `https://${HOSTS.openai}/v1`,
  claude: `https://${HOSTS.claude}`,
};

/**
 * The keys of an offline run. Shaped like real ones on purpose, so the
 * self-test's leak check has something to catch if a printed request ever
 * escaped the redactor; assembled from parts so no key-shaped literal sits in
 * the source.
 */
const PLACEHOLDER_KEYS = {
  gemini: ['AIza', 'ProbePlaceholderNotAKey0000'].join(''),
  openai: ['sk', 'probe', 'placeholder', 'not', 'a', 'key'].join('-'),
  claude: ['sk', 'ant', 'probe', 'placeholder', 'not', 'a', 'key'].join('-'),
};

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

let liveKeyReads = 0;

function loadKey() {
  const envFile = path.join(REPO, '.vscode/environment.ts');
  if (!fs.existsSync(envFile)) {
    throw new Stop(1, `No ${envFile}. See docs/ui-audit/tools/README.md for the local environment file.`);
  }
  const m = fs.readFileSync(envFile, 'utf8').match(/geminiApiKey:\s*'([^']+)'/);
  if (!m) {
    throw new Stop(1, 'No geminiApiKey in .vscode/environment.ts — this probe needs a real key.');
  }
  return m[1];
}

function readKeyVariable(name) {
  const key = process.env[name]?.trim();
  if (!key) throw new Stop(1, `${name} is not set. This provider's key is read from that variable and nowhere else.`);
  return key;
}

/**
 * Why a live run on this provider must not start, or null. A live run cannot
 * hide a variable from its SDK the way an offline one does, so it stops while
 * one its SDK reads unconditionally is set. The message names the variable and
 * never its value.
 */
function liveEnvironmentRefusal(provider, env) {
  const set = Object.entries(UNOVERRIDABLE_VARIABLES)
    .filter(([name, variable]) => variable.provider === provider && env[name]?.trim())
    .map(([name, variable]) => `${name} is set, and ${variable.effect}. No client option overrides it.`);
  return set.length ? `${set.join('\n')}\nUnset it for a live run.` : null;
}

/** The only place a live run reads a key. The offline modes never reach it. */
function readLiveKey(provider) {
  liveKeyReads++;
  const key = provider === 'gemini'
    ? loadKey()
    : readKeyVariable(provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
  holdSecret(key);
  return key;
}

/**
 * Hide the key variables from everything in this process, and note who asks.
 *
 * Both SDKs fall back to reading their key from the environment whenever a
 * constructor option is left out, so an offline mode proves it read none by
 * running with them unreadable and checking the list stays empty. They are
 * left out of a listing too, so that listing the environment, as childEnv()
 * does for esbuild and Chromium, does not count as asking. Neither child
 * relies on the tripwire: childEnv() drops the key variables by name in every
 * mode, so a live run hands them none either.
 */
function installKeyTripwire() {
  const reads = [];
  // The unoverridable variables are hidden the same way, but a lookup of one is
  // not a key read: the Anthropic constructor looks its one up on every call.
  const noteKeyRead = name => {
    if (isKeyVariable(name)) reads.push(name);
  };
  process.env = new Proxy(process.env, {
    get(target, name) {
      noteKeyRead(name);
      return isHiddenVariable(name) ? undefined : Reflect.get(target, name);
    },
    has(target, name) {
      noteKeyRead(name);
      return isHiddenVariable(name) ? false : Reflect.has(target, name);
    },
    getOwnPropertyDescriptor(target, name) {
      noteKeyRead(name);
      return isHiddenVariable(name) ? undefined : Reflect.getOwnPropertyDescriptor(target, name);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(name => !isHiddenVariable(name));
    },
  });
  return reads;
}

// ---------------------------------------------------------------------------
// The app's own code
// ---------------------------------------------------------------------------

/**
 * Bundle the app's real prompt registry, validators and model catalog.
 *
 * Importing the TypeScript directly is the whole point: a copy of the prompt
 * would drift from the shipped one and the probe would pass while production
 * broke. The same goes for `acceptsSampling`, which decides whether an
 * envelope carries `temperature` exactly as the app's transports decide it.
 * esbuild comes from the app's own devDependencies.
 */
function buildAppApi() {
  fs.mkdirSync(BUILD, { recursive: true });
  const entry = path.join(BUILD, 'entry.ts');
  fs.writeFileSync(entry, `
export { renderPrompt, PROMPT_IDS, JSON_ONLY_PREAMBLE } from '${path.join(REPO, 'src/app/core/prompts/prompt-registry')}';
export {
  readCountryCode, readCurrencyCode, readPrintedLocation, readReceiptTotal, readFieldConfidence,
} from '${path.join(REPO, 'src/app/core/utils/receipt-extraction.utils')}';
export {
  acceptsSampling, OPENAI_MODELS, CLAUDE_MODELS,
  DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_CLAUDE_MODEL,
} from '${path.join(REPO, 'src/app/core/config/ai-models')}';
`);
  const out = path.join(BUILD, 'app-api.mjs');
  execFileSync(
    path.join(REPO, 'node_modules/.bin/esbuild'),
    [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`],
    { stdio: ['ignore', 'ignore', 'inherit'], env: childEnv() }
  );
  return out;
}

function loadAppApi() {
  return import(buildAppApi());
}

function defaultModel(api, provider, prompts) {
  if (provider === 'openai') return api.DEFAULT_OPENAI_MODEL;
  if (provider === 'claude') return api.DEFAULT_CLAUDE_MODEL;
  return prompts === 'receipt' ? api.DEFAULT_VISION_MODEL : api.DEFAULT_TEXT_MODEL;
}

// ---------------------------------------------------------------------------
// Rendering and envelopes
// ---------------------------------------------------------------------------

function renderedText(rendered) {
  return [rendered.system, rendered.user].filter(Boolean).join('\n\n');
}

/** The probe's original Gemini receipt text: the JSON preamble, then the prompt. */
function geminiReceiptText(api, rendered) {
  return [api.JSON_ONLY_PREAMBLE, rendered.system, rendered.user].filter(Boolean).join('\n\n');
}

function renderLooksRight(text, marker, minChars = 0) {
  return text.length >= minChars && text.includes(marker) && !text.includes('[object Object]');
}

function guardRendered(id, text, marker, minChars = 0) {
  if (renderLooksRight(text, marker, minChars)) return;
  throw new Stop(1, [
    `Rendered ${id} prompt looks wrong (${text.length} chars, carries ${JSON.stringify(marker)}: ${text.includes(marker)}).`,
    'renderPrompt returns a structured RenderedPrompt, not a string — check the fields being joined and the fixture input.',
  ].join('\n'));
}

/**
 * The request body for one prompt, shaped the way the app's transport for
 * that provider shapes it.
 *
 * `temperature` goes only to an id `acceptsSampling` flags, which is the rule
 * ClaudeService applies. The app sends OpenAI none at all, and no OpenAI id is
 * flagged, so the same rule sends OpenAI none today. Gemini always gets one,
 * as GeminiService always sends it. `effort` is the probe's own lever (OpenAI
 * only); the app sends no reasoning or thinking setting.
 *
 * `sampling: 'force'` is the probe's other lever. It sends OpenAI and Claude
 * the prompt's declared temperature whatever the flag says, which the app never
 * does, so a keyed run can show an unflagged id taking one or refusing it.
 */
function buildEnvelope(provider, { model, rendered, images = [], effort, api, receipt = false, sampling = 'auto' }) {
  const temperature = sampling === 'force' || api.acceptsSampling(model) ? { temperature: rendered.temperature } : {};

  if (provider === 'openai') {
    // OpenAI's Responses API has no system field, so the transport folds it in.
    const text = rendered.system ? `${rendered.system}\n\n${rendered.user}` : rendered.user;
    return {
      model,
      input: images.length
        ? [{
          role: 'user',
          content: [
            { type: 'input_text', text },
            ...images.map(png => ({ type: 'input_image', image_url: `data:image/png;base64,${png}`, detail: 'auto' })),
          ],
        }]
        : text,
      max_output_tokens: rendered.maxOutputTokens,
      store: false,
      ...temperature,
      ...(effort ? { reasoning: { effort } } : {}),
    };
  }

  if (provider === 'claude') {
    return {
      model,
      max_tokens: rendered.maxOutputTokens,
      ...(rendered.system ? { system: rendered.system } : {}),
      ...temperature,
      messages: [{
        role: 'user',
        content: images.length
          ? [
            ...images.map(png => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } })),
            { type: 'text', text: rendered.user },
          ]
          : rendered.user,
      }],
    };
  }

  if (receipt) {
    // The probe's original Gemini request, unchanged, so baseline.json stays comparable.
    return {
      contents: [{
        parts: [
          { text: geminiReceiptText(api, rendered) },
          ...images.map(png => ({ inline_data: { mime_type: 'image/png', data: png } })),
        ],
      }],
      generationConfig: {
        temperature: rendered.temperature,
        maxOutputTokens: rendered.maxOutputTokens,
        ...(rendered.topP !== undefined ? { topP: rendered.topP } : {}),
        responseMimeType: 'application/json',
      },
    };
  }

  // GeminiService's text request: the JSON preamble only for a JSON answer,
  // and double room for a Gemma prose answer.
  const preamble = rendered.expects === 'json' ? `${api.JSON_ONLY_PREAMBLE}\n\n` : '';
  const system = rendered.system ? `${rendered.system}\n\n` : '';
  const draftsVerbosely = model.includes('gemma') && rendered.expects !== 'json';
  return {
    contents: [{ role: 'user', parts: [{ text: `${preamble}${system}${rendered.user}` }] }],
    generationConfig: {
      maxOutputTokens: draftsVerbosely ? rendered.maxOutputTokens * 2 : rendered.maxOutputTokens,
      temperature: rendered.temperature,
      ...(rendered.topP !== undefined ? { topP: rendered.topP } : {}),
    },
  };
}

/** Whether `--sampling force` changes anything: Gemini always gets a temperature, so only OpenAI and Claude are forced. */
function forcesSampling(opts) {
  return opts.sampling === 'force' && opts.provider !== 'gemini';
}

/** The envelope without its prompt text and images, for the run header. */
function configOf(provider, body) {
  if (provider === 'gemini') return body.generationConfig;
  const { input, messages, system, ...config } = body;
  return config;
}

function samplingOf(provider, body) {
  return provider === 'gemini' ? body.generationConfig?.temperature : body.temperature;
}

// ---------------------------------------------------------------------------
// Senders. Every one takes its transport as an argument: a live run passes the
// platform fetch, an offline one a recorder, and no sender reaches for a global.
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * `send(model, body)` → one call's record. `transport` is the fetch every
 * request goes through, and is required: an SDK left without one picks its
 * own (OpenAI 4.104.0 falls back to node-fetch, not the platform fetch), so a
 * run that forgot it would not go where it was meant to. A live run passes
 * the platform fetch, an offline one the recorder.
 */
async function makeSender(provider, { key, transport }) {
  if (typeof transport !== 'function') {
    throw new Error(`the ${provider} sender needs a transport, and was handed none`);
  }
  holdSecret(key);

  // Every option an SDK would otherwise take from the environment is given. What
  // has no option is in UNOVERRIDABLE_VARIABLES.
  if (provider === 'openai') {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: key,
      baseURL: BASE_URLS.openai,
      organization: null,
      project: null,
      fetch: transport,
      maxRetries: 0,
    });
    return async (model, body) => readOpenAI(await client.responses.create(body));
  }

  if (provider === 'claude') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: key,
      authToken: null,
      webhookKey: null,
      baseURL: BASE_URLS.claude,
      // ANTHROPIC_LOG would otherwise set it, and the SDK logs straight to the console, past the redactor.
      logLevel: 'off',
      fetch: transport,
      maxRetries: 0,
    });
    return async (model, body) => readClaude(await client.messages.create(body));
  }

  return async (model, body) => {
    const res = await transport(`${BASE_URLS.gemini}/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return readGemini(await res.json());
  };
}

// What one call came back with: the served model, why it stopped, the output
// items or content blocks in order, the reasoning or thinking tokens, and the
// text the app would read.

function readOpenAI(response) {
  const reason = response.incomplete_details?.reason;
  return {
    model: response.model,
    stop: reason ? `${response.status}/${reason}` : response.status,
    items: (response.output ?? []).map(item => (item.type === 'message'
      ? `message(${(item.content ?? []).map(part => part.type).join(',')})`
      : item.type)),
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
    outputTokens: response.usage?.output_tokens,
    text: response.output_text ?? '',
  };
}

function readClaude(message) {
  // The app reads the first text block, past any thinking block.
  const textBlock = (message.content ?? []).find(block => block.type === 'text');
  return {
    model: message.model,
    stop: message.stop_reason,
    items: (message.content ?? []).map(block => block.type),
    reasoningTokens: message.usage?.output_tokens_details?.thinking_tokens,
    outputTokens: message.usage?.output_tokens,
    text: textBlock?.text ?? '',
  };
}

function readGemini(json) {
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return {
    model: json?.modelVersion,
    stop: candidate?.finishReason,
    items: parts.map(part => (part.thought ? 'thought' : part.text !== undefined ? 'text' : Object.keys(part)[0] ?? 'empty')),
    reasoningTokens: json?.usageMetadata?.thoughtsTokenCount,
    outputTokens: json?.usageMetadata?.candidatesTokenCount,
    text: parts.map(part => part.text).join(''),
  };
}

function describeCall(call) {
  const reasoning = call.reasoningTokens === undefined || call.reasoningTokens === null
    ? 'reasoning not reported'
    : `reasoning ${call.reasoningTokens} of ${call.outputTokens ?? '?'} output tokens`;
  return `served ${call.model ?? '?'}  stop ${call.stop ?? '?'}  items [${call.items.join(', ')}]  ${reasoning}`;
}

function reportCallError(label, error) {
  if (error?.status) {
    const body = error instanceof HttpError ? error.body : JSON.stringify(error.error ?? error.message);
    say(`${label}: HTTP ${error.status}\n${String(body).slice(0, 300)}\n`);
  } else {
    say(`${label}: ${error?.message ?? error}\n`);
  }
}

// ---------------------------------------------------------------------------
// The recorder: the transport of every offline run.
// ---------------------------------------------------------------------------

/**
 * A fetch that records each request, answers with a canned JSON body and the
 * given status, and throws on any host but the one it was made for. Nothing it
 * is handed leaves the process.
 */
function makeRecorder(expectedHost, respond, status = 200) {
  const requests = [];
  async function recorderFetch(input, init = {}) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.host !== expectedHost) {
      throw new Error(`the recorder expected ${expectedHost} and was asked for ${url.host}`);
    }
    const raw = init.body;
    const text = raw == null ? '' : typeof raw === 'string' ? raw : await new Response(raw).text();
    const request = {
      method: String(init.method ?? 'GET').toUpperCase(),
      url: url.href,
      headers: Object.fromEntries(new Headers(init.headers ?? {}).entries()),
      body: text ? JSON.parse(text) : null,
    };
    requests.push(request);
    return new Response(JSON.stringify(respond(request)), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  return { fetch: recorderFetch, requests };
}

const CANNED_REASONING_TOKENS = 32;

function geminiModelOf(url) {
  return decodeURIComponent(new URL(url).pathname.split('/models/')[1]?.split(':')[0] ?? '');
}

/**
 * A well-formed answer in each vendor's shape, with a reasoning or thinking
 * block ahead of the text where the vendor returns one, and a served model
 * that differs from the requested one, so a record that read the request
 * instead of the response would show it.
 */
function cannedAnswer(provider, answer) {
  return request => {
    if (provider === 'openai') {
      return {
        id: 'resp_probe',
        object: 'response',
        created_at: 0,
        status: 'completed',
        model: `${request.body?.model}-served`,
        output: [
          { type: 'reasoning', id: 'rs_probe', summary: [] },
          {
            type: 'message',
            id: 'msg_probe',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: answer, annotations: [] }],
          },
        ],
        incomplete_details: null,
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 40,
          output_tokens_details: { reasoning_tokens: CANNED_REASONING_TOKENS },
          total_tokens: 140,
        },
      };
    }
    if (provider === 'claude') {
      return {
        id: 'msg_probe',
        type: 'message',
        role: 'assistant',
        model: `${request.body?.model}-served`,
        content: [{ type: 'thinking', thinking: '', signature: 'probe' }, { type: 'text', text: answer }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40, output_tokens_details: { thinking_tokens: CANNED_REASONING_TOKENS } },
      };
    }
    return {
      candidates: [{ content: { role: 'model', parts: [{ text: answer }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 8,
        thoughtsTokenCount: CANNED_REASONING_TOKENS,
        totalTokenCount: 140,
      },
      modelVersion: `${geminiModelOf(request.url)}-served`,
    };
  };
}

/** Image payloads are elided from a printed envelope; the prompt text is kept whole. */
function elideImages(key, value) {
  return typeof value === 'string' && value.length > 256 && /^(?:data:image\/[a-z]+;base64,)?[A-Za-z0-9+/=]+$/.test(value)
    ? `<image, ${value.length} base64 chars>`
    : value;
}

/**
 * A printed header's value: as it is for a header the probe knows, the raw
 * value for an auth header, which the redactor masks whatever it holds, and
 * `<hidden>` for every other, whatever put it there.
 */
function shownHeaderValue(name, value) {
  return SHOWN_HEADERS.includes(name) || name.startsWith('x-stainless-') || AUTH_HEADERS.includes(name) ? value : '<hidden>';
}

function printRequest(label, request) {
  say(`--- ${label}: ${request.method} ${request.url}`);
  for (const [name, value] of Object.entries(request.headers).sort(([a], [b]) => a.localeCompare(b))) {
    say(`    ${name}: ${shownHeaderValue(name, value)}`);
  }
  say(`    body: ${JSON.stringify(request.body, elideImages, 2).replaceAll('\n', '\n    ')}`);
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  return a >= 0 && b > a ? body.slice(a, b + 1) : body;
}

/** The JSON object or array in an answer, fenced or not; undefined when there is none. */
function parseJsonAnswer(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : text).trim();
  const starts = [body.indexOf('{'), body.indexOf('[')].filter(i => i >= 0);
  if (!starts.length) return undefined;
  const start = Math.min(...starts);
  const end = body.lastIndexOf(body[start] === '[' ? ']' : '}');
  if (end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DRIFT_FIELDS = ['country', 'currency', 'total'];

/**
 * Each receipt run against the baseline's one record per case. `runs` holds
 * every run of a case in order, and a repeated case labels each `id#n`, so no
 * run hides another.
 */
function driftLines(baseResults, runs) {
  const lines = [];
  for (const [id, records] of Object.entries(runs)) {
    const a = baseResults?.[id] ?? {};
    records.forEach((b, i) => {
      const label = records.length > 1 ? `${id}#${i + 1}` : id;
      for (const f of DRIFT_FIELDS) {
        if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) lines.push(`  ${label}.${f}: baseline ${JSON.stringify(a[f])} -> now ${JSON.stringify(b[f])}`);
      }
    });
  }
  return lines;
}

/**
 * What `--update` writes: `{ baseline }` from each case's one record, or
 * `{ failed }`, the cases whose call failed. A failed call (an HTTP error or a
 * thrown one) holds no answer, and a baseline holding one would report drift
 * against nothing on every later run, so then nothing is written. Pure: the
 * caller writes the file.
 */
function baselineUpdate(model, recorded, runs) {
  const failed = Object.entries(runs)
    .filter(([, records]) => !records.length || records.some(record => 'httpError' in record || 'error' in record))
    .map(([id]) => id);
  if (failed.length) return { failed };
  // parseArgs refuses --update with --repeat, so each case holds exactly one run.
  return { baseline: { model, recorded, results: Object.fromEntries(Object.entries(runs).map(([id, records]) => [id, records[0]])) } };
}

// ---------------------------------------------------------------------------
// The runs
// ---------------------------------------------------------------------------

/**
 * The receipt fixtures: drawn by render.mjs, then read as base64. render()
 * loads Playwright when it launches Chromium, so only a run that sends a
 * receipt loads it. `runReceipts` takes this as a parameter so the self-test
 * can hand it ids and a stand-in image and drive the real loop without a
 * browser. `load` and `env` let the self-test check what Chromium's launch is
 * handed, without starting it.
 */
async function renderedFixtures({ load = () => import('./render.mjs'), env = process.env } = {}) {
  const { render, CASE_IDS } = await load();
  say('rendering fixtures...');
  // Chromium gets the child environment in every mode, a live run's included.
  await render({ quiet: true, env: childEnv(env) });
  return {
    ids: CASE_IDS,
    png: id => fs.readFileSync(path.join(HERE, 'receipts', `${id}.png`)).toString('base64'),
  };
}

async function runReceipts({ opts, api, model, send, recorder, fixtures = renderedFixtures }) {
  const { ids: CASE_IDS, png: readPng } = await fixtures();

  const rendered = api.renderPrompt('receiptParse');
  const prompt = opts.provider === 'gemini' ? geminiReceiptText(api, rendered) : renderedText(rendered);
  guardRendered('receiptParse', prompt, RECEIPT_GUARD.marker, RECEIPT_GUARD.minChars);

  const config = configOf(opts.provider, buildEnvelope(opts.provider, { model, rendered, effort: opts.effort, api, receipt: true, sampling: opts.sampling }));
  say(`provider: ${opts.provider}${opts.dryRun ? ' (dry run: nothing is sent)' : ''}`);
  say(`model:  ${model}`);
  if (forcesSampling(opts)) say('sampling: force (the declared temperature is sent whatever acceptsSampling says)');
  say(`prompt: ${prompt.length} chars, asks for country: ${prompt.includes('"country"')}`);
  say(`config: ${JSON.stringify(config)}\n`);

  // Every run of each case, in order: the drift block compares them all.
  const runs = Object.fromEntries(CASE_IDS.map(id => [id, []]));
  let failures = 0;
  let calls = 0;

  for (const id of CASE_IDS) {
    const expect = CASES[id];
    const png = readPng(id);
    const body = buildEnvelope(opts.provider, { model, rendered, images: [png], effort: opts.effort, api, receipt: true, sampling: opts.sampling });

    for (let run = 1; run <= opts.repeat; run++) {
      const label = opts.repeat > 1 ? `${id}#${run}` : id;

      if (opts.dryRun) {
        await send(model, body);
        printRequest(`${label} (dry run, not sent)`, recorder.requests.at(-1));
        continue;
      }

      let call;
      calls++;
      try {
        call = await send(model, body);
      } catch (error) {
        reportCallError(label, error);
        runs[id].push(error?.status ? { httpError: error.status } : { error: String(error?.message ?? error) });
        failures++;
        continue;
      }

      const text = call.text;
      if (opts.raw) say(`--- ${label} raw:\n${text}\n`);

      let parsed;
      try { parsed = JSON.parse(extractJson(text)); }
      catch { parsed = undefined; }
      const answerParsed = isObject(parsed);
      if (!answerParsed) parsed = {};

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

      runs[id].push({ country, currency, total, amountConfidence: conf.amount, location, merchant: parsed.merchant, countryOk, currencyOk, totalOk });

      const flag = (ok) => (ok ? 'ok  ' : 'FAIL');
      say(`${label.padEnd(8)} ${expect.why}`);
      say(`         ${flag(countryOk)} country  ${JSON.stringify(country)} (want ${JSON.stringify(expect.country)})`);
      say(`         ${flag(currencyOk)} currency ${JSON.stringify(currency)} (want ${JSON.stringify(expect.currency)})`);
      say(
        expect.total === null
          ? `         ${flag(totalOk)} total    ${total} invented; amount confidence ${conf.amount} must be < ${VERIFY_FIELD_THRESHOLD} so the review chip fires`
          : `         ${flag(totalOk)} total    ${total} (want ${expect.total})`
      );
      say(`         call     ${describeCall(call)}  parsed ${answerParsed ? 'yes' : 'NO'}`);
      say();
    }
  }

  if (opts.dryRun) return 0;

  if (opts.update) {
    const update = baselineUpdate(model, new Date().toISOString().slice(0, 10), runs);
    if (update.failed) {
      throw new Stop(1, `baseline.json was not updated: the call failed for ${update.failed.join(', ')}. Run --update again once every case answers.`);
    }
    fs.writeFileSync(BASELINE, JSON.stringify(update.baseline, null, 2) + '\n');
    say(`baseline.json updated from this run (${model}).`);
    return failures;
  }

  // Drift against the recorded baseline. Expectations catch "wrong"; the baseline
  // catches "different", which is what a model update looks like.
  if (fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const drift = driftLines(base.results, runs);
    say(`--- drift vs baseline (${base.model}, recorded ${base.recorded})`);
    say(drift.length ? drift.join('\n') : '  none');
    if (base.model !== model) say(`  (baseline is a different model: ${base.model})`);
  }

  say(`\n${failures ? `${failures} of ${calls} call(s) failed` : `all ${calls} call(s) passed`}`);
  return failures;
}

async function runSmall({ opts, api, model, send, recorder }) {
  say([
    `provider: ${opts.provider}`,
    `model: ${model}`,
    'prompts: small',
    `repeat: ${opts.repeat}`,
    ...(opts.effort ? [`effort: ${opts.effort}`] : []),
    ...(forcesSampling(opts) ? ['sampling: force'] : []),
    ...(opts.dryRun ? ['dry run: nothing is sent'] : []),
  ].join('   ') + '\n');

  let failures = 0;
  for (const [id, spec] of Object.entries(SMALL_PROMPTS)) {
    const rendered = api.renderPrompt(id, spec.input);
    guardRendered(id, renderedText(rendered), spec.marker);
    const body = buildEnvelope(opts.provider, { model, rendered, effort: opts.effort, api, sampling: opts.sampling });
    const sampling = samplingOf(opts.provider, body);
    say(`${id}: budget ${rendered.maxOutputTokens}, temperature ${sampling === undefined ? 'not sent' : sampling}`);

    for (let run = 1; run <= opts.repeat; run++) {
      if (opts.dryRun) {
        await send(model, body);
        printRequest(`${id} #${run} (dry run, not sent)`, recorder.requests.at(-1));
        continue;
      }

      let call;
      try {
        call = await send(model, body);
      } catch (error) {
        reportCallError(`  #${run}`, error);
        failures++;
        continue;
      }
      const parsed = spec.parses(call.text);
      if (!parsed) failures++;
      say(`  #${run}  ${describeCall(call)}  parsed ${parsed ? 'yes' : 'NO'}`);
      if (opts.raw) say(`  --- raw:\n${call.text}\n`);
    }
  }

  if (!opts.dryRun) say(`\n${failures ? `${failures} call(s) failed or did not parse` : 'every call parsed'}`);
  return failures;
}

/** The model a run probes: the one --model names, or the app's default for the provider. */
function runModel(api, opts) {
  return opts.model ?? defaultModel(api, opts.provider, opts.prompts);
}

/** The loop that sends a run's prompts. */
function runLoop(opts) {
  return opts.prompts === 'small' ? runSmall : runReceipts;
}

/**
 * The wiring of a run that sends nothing: the recorder as the transport, the
 * placeholder as the key, then the run's model and loop. probe()'s --dry-run
 * and the self-test's loop cases both run through here, so the self-test
 * drives the wiring a dry run uses. `fixtures` lets the self-test stand in for
 * the browser render. Returns the recorder, which holds every envelope.
 */
async function runOffline({ opts, api, fixtures }) {
  const recorder = makeRecorder(HOSTS[opts.provider], cannedAnswer(opts.provider, ''));
  const send = await makeSender(opts.provider, { key: PLACEHOLDER_KEYS[opts.provider], transport: recorder.fetch });
  await runLoop(opts)({ opts, api, model: runModel(api, opts), send, recorder, fixtures });
  return recorder;
}

async function probe(opts) {
  if (opts.dryRun) {
    // A dry run reads no key: it runs with the key variables unreadable, and
    // runOffline gives its client a placeholder and the recorder.
    const keyReads = installKeyTripwire();
    const api = await loadAppApi();
    const recorder = await runOffline({ opts, api });
    if (keyReads.length || liveKeyReads) {
      complain(`The dry run looked up a key (${[...keyReads, ...(liveKeyReads ? ['a live key'] : [])].join(', ')}). Nothing was sent, but it must read none.`);
      return 1;
    }
    say(`\ndry run: ${recorder.requests.length} envelope(s) printed, nothing sent, no key read`);
    return 0;
  }

  // A live run cannot hide what its SDK reads unconditionally, so it stops first.
  const refusal = liveEnvironmentRefusal(opts.provider, process.env);
  if (refusal) throw new Stop(1, refusal);
  const api = await loadAppApi();
  const send = await makeSender(opts.provider, { key: readLiveKey(opts.provider), transport: globalThis.fetch });
  const failures = await runLoop(opts)({ opts, api, model: runModel(api, opts), send, recorder: null });
  return failures ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The self-test: the probe's own unit, offline.
// ---------------------------------------------------------------------------

/** Everything this process writes, so the leak check covers what the SDKs print too. */
function captureOutput() {
  const chunks = [];
  const streams = [process.stdout, process.stderr];
  const originals = streams.map(stream => stream.write);
  streams.forEach((stream, i) => {
    stream.write = function (chunk, ...rest) {
      chunks.push(String(chunk));
      return originals[i].call(stream, chunk, ...rest);
    };
  });
  return {
    text: () => chunks.join(''),
    stop() {
      streams.forEach((stream, i) => { stream.write = originals[i]; });
    },
  };
}

const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** What the wire carried, in one shape for every provider. */
function wireView(provider, request) {
  const body = request.body ?? {};
  if (provider === 'openai') {
    return { model: body.model, budget: body.max_output_tokens, sampling: 'temperature' in body, reasoning: ['reasoning'].filter(k => k in body) };
  }
  if (provider === 'claude') {
    return { model: body.model, budget: body.max_tokens, sampling: 'temperature' in body, reasoning: ['thinking', 'output_config'].filter(k => k in body) };
  }
  const config = body.generationConfig ?? {};
  return { model: geminiModelOf(request.url), budget: config.maxOutputTokens, sampling: 'temperature' in config, reasoning: ['thinkingConfig'].filter(k => k in config) };
}

const BUDGET_KEYS = { openai: 'max_output_tokens', claude: 'max_tokens', gemini: 'generationConfig.maxOutputTokens' };
const REQUEST_PATHS = {
  openai: () => '/v1/responses',
  claude: () => '/v1/messages',
  gemini: model => `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
};
const EXPECTED_RECORDS = {
  openai: { stop: 'completed', items: ['reasoning', 'message(output_text)'] },
  claude: { stop: 'end_turn', items: ['thinking', 'text'] },
  gemini: { stop: 'STOP', items: ['text'] },
};
const MADE_UP_MODEL = 'claude-no-such-model';
/** What every canary the self-test sets carries, so one search of the output finds any of them. */
const CANARY = 'gw-canary';

async function selfTest() {
  // A sender handed the platform fetch would reach a vendor. For as long as the
  // self-test runs, that fetch refuses and is counted instead, before anything
  // else can call it.
  const platformFetch = globalThis.fetch;
  let platformFetches = 0;
  globalThis.fetch = async () => {
    platformFetches++;
    throw new Error('the self-test reached the platform fetch, which would have sent a request to a vendor');
  };
  const output = captureOutput();
  // The real environment, under the tripwire: a canary set here is what an SDK would find there.
  const underlyingEnv = process.env;
  const keyReads = installKeyTripwire();
  const results = [];
  const check = (ok, label) => {
    results.push(Boolean(ok));
    say(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  };

  say('self-test: offline. No key is read, and every request goes to a recorder.\n');

  // Arguments.
  const defaults = parseArgs([]).opts;
  check(defaults?.provider === 'gemini' && defaults.prompts === 'receipt' && defaults.repeat === 1 && !defaults.dryRun
    && defaults.sampling === 'auto',
  'no flag still means Gemini on the receipt fixtures, with temperature where the app sends it');
  // Each case breaks exactly one rule, and must be refused by that rule's message.
  for (const [argv, why, because] of [
    [['--bogus'], 'an unknown flag', 'unknown argument'],
    [['receipt'], 'a bare word', 'unknown argument'],
    [['--raw', '--raw'], 'a switch given twice', 'given twice'],
    [['--provider', 'openai', '--provider', 'claude'], 'a value flag given twice', 'given twice'],
    [['--provider', 'mistral'], 'an unknown provider', '--provider must be'],
    [['--provider'], 'a flag without its value', 'needs a value'],
    [['--effort', 'none'], '--effort on Gemini', 'OpenAI only'],
    [['--provider', 'claude', '--effort', 'none'], '--effort on Claude', 'OpenAI only'],
    [['--provider', 'openai', '--effort', 'low'], 'an effort other than none', 'takes only none'],
    [['--repeat', '0'], '--repeat 0', '--repeat must be'],
    [['--repeat', String(MAX_REPEAT + 1)], `--repeat ${MAX_REPEAT + 1}`, '--repeat must be'],
    // Each of these is a number Number() reads inside 1 to MAX_REPEAT, so only the pattern refuses it.
    [['--repeat', '01'], '--repeat 01', '--repeat must be'],
    [['--repeat', '2.5'], '--repeat 2.5', '--repeat must be'],
    [['--repeat', '1e1'], '--repeat 1e1', '--repeat must be'],
    [['--prompts', 'small', '--update'], '--update without the receipt baseline', 'needs --prompts receipt'],
    [['--update', '--dry-run'], '--update with --dry-run', '--update and --dry-run'],
    [['--update', '--repeat', '2'], '--update with --repeat 2', 'combined with --repeat'],
    [['--provider', 'openai', '--update'], '--update on OpenAI', 'needs --provider gemini'],
    [['--provider', 'claude', '--update'], '--update on Claude', 'needs --provider gemini'],
    [['--provider', 'openai', '--sampling', 'always'], 'a --sampling value other than auto or force', '--sampling must be'],
    [['--sampling', 'force', '--update'], '--update with --sampling force', 'cannot be combined with --sampling force'],
    [['--self-test', '--dry-run'], '--self-test with another flag', 'takes no other flag'],
    [['--model', ''], 'an empty --model', '--model must be'],
    [['--model', 'a#b'], 'a --model carrying a #', '--model must be'],
    [['--model', 'a?b'], 'a --model carrying a ?', '--model must be'],
    [['--model', 'models/a'], 'a --model carrying a /', '--model must be'],
  ]) {
    const { error } = parseArgs(argv);
    const verdict = !error ? ' (it was taken)' : error.includes(because) ? '' : ` (refused for another reason: ${error})`;
    check(error?.includes(because), `refuses ${why}${verdict}`);
  }
  check(parseArgs(['--provider', 'openai', '--effort', 'none']).opts?.effort === 'none', 'takes --effort none on OpenAI');
  check(parseArgs(['--update']).opts?.update === true, 'takes --update on the Gemini receipt run');
  check(parseArgs(['--provider', 'openai', '--sampling', 'force']).opts?.sampling === 'force'
    && parseArgs(['--provider', 'claude', '--sampling', 'force']).opts?.sampling === 'force',
  'takes --sampling force on OpenAI and on Claude');
  check(parseArgs(['--update', '--sampling', 'auto']).opts?.sampling === 'auto', 'takes --sampling auto, the default, with --update');
  check(MAX_REPEAT === 10, 'the --repeat bound is 10, as the README says');
  check(parseArgs(['--repeat', String(MAX_REPEAT)]).opts?.repeat === MAX_REPEAT, `takes --repeat ${MAX_REPEAT}, the bound itself`);
  check(parseArgs(['--repeat', '2']).opts?.repeat === 2, 'takes --repeat 2');

  // The redactor, one rule at a time.
  const looseOpenAI = ['sk', 'x'.repeat(24)].join('-');
  const looseClaude = ['sk', 'ant', 'y'.repeat(24)].join('-');
  const looseGemini = ['AIza', 'z'.repeat(35)].join('');
  check(!KEY_SHAPE.test(redact(`Bearer ${looseOpenAI}, then ${looseClaude}, then ${looseGemini}`)),
    'the redactor removes key-shaped strings it was never told about');
  check(redact('    x-api-key: anything at all') === '    x-api-key: <KEY>', 'the redactor masks an auth header whatever its value');
  check(redact('https://host.example/v1?key=abc123&alt=json') === 'https://host.example/v1?key=<KEY>&alt=json', 'the redactor masks a ?key= parameter');
  const held = ['held', 'secret', 'q'.repeat(12)].join('-');
  holdSecret(held);
  check(!redact(`answer: ${held}`).includes(held), 'the redactor removes a key this run holds even when it is not key-shaped');

  const api = await loadAppApi();

  // --model is held to an id's shape, and no id the app names falls outside it.
  const namedIds = [...api.OPENAI_MODELS, ...api.CLAUDE_MODELS].map(m => m.id)
    .concat(api.DEFAULT_TEXT_MODEL, api.DEFAULT_VISION_MODEL, MADE_UP_MODEL);
  const refusedIds = namedIds.filter(id => parseArgs(['--model', id]).opts?.model !== id);
  check(namedIds.length > 2 && refusedIds.length === 0,
    `takes as --model every id the app's catalogs and defaults name${refusedIds.length ? ` (not ${refusedIds.join(', ')})` : ''}`);

  // Renders and their guards.
  for (const [id, spec] of Object.entries(SMALL_PROMPTS)) {
    const rendered = api.renderPrompt(id, spec.input);
    check(rendered.maxOutputTokens === spec.budget, `${id}: renders with its ${spec.budget}-token budget (${rendered.maxOutputTokens})`);
    check(renderLooksRight(renderedText(rendered), spec.marker), `${id}: the render guard finds its marker`);
    check(spec.parses(spec.sample) && !spec.parses(''), `${id}: the parse check takes a well-formed answer and refuses an empty one`);
  }
  // The list is the registry's smallest five: every prompt is ranked by the budget it renders.
  const ranked = [];
  const unranked = [];
  for (const id of api.PROMPT_IDS) {
    try {
      const budget = api.renderPrompt(id, SMALL_PROMPTS[id]?.input ?? RANKING_INPUTS[id] ?? {}).maxOutputTokens;
      if (Number.isFinite(budget)) ranked.push({ id, budget });
      else unranked.push(id);
    } catch {
      unranked.push(id);
    }
  }
  check(unranked.length === 0, `every registry prompt renders a numeric budget${unranked.length ? ` (not ${unranked.join(', ')})` : ''}`);
  ranked.sort((a, b) => a.budget - b.budget);
  const listed = Object.keys(SMALL_PROMPTS);
  const listedBudgets = ranked.filter(r => listed.includes(r.id)).map(r => r.budget);
  const otherBudgets = ranked.filter(r => !listed.includes(r.id)).map(r => r.budget);
  check(listed.length === 5 && listedBudgets.length === listed.length && Math.max(...listedBudgets) <= Math.min(...otherBudgets),
    `the small prompts are the registry's five smallest budgets (${ranked.slice(0, 6).map(r => `${r.id} ${r.budget}`).join(', ')}, ...)`);

  const receipt = api.renderPrompt('receiptParse');
  check(renderLooksRight(renderedText(receipt), RECEIPT_GUARD.marker, RECEIPT_GUARD.minChars), 'receiptParse: the render guard finds "country" in 500+ characters');
  check(!renderLooksRight(String(receipt), RECEIPT_GUARD.marker, RECEIPT_GUARD.minChars), 'the render guard refuses a RenderedPrompt joined as a string');
  // Long enough and carrying its marker, so only the [object Object] clause can refuse it.
  const objectField = `${renderedText(receipt)}\nmerchant: [object Object]`;
  check(objectField.length >= RECEIPT_GUARD.minChars && objectField.includes(RECEIPT_GUARD.marker)
    && !renderLooksRight(objectField, RECEIPT_GUARD.marker, RECEIPT_GUARD.minChars),
  'the render guard refuses a field rendered as [object Object] in an otherwise sound prompt');

  // Envelopes: temperature only where the app sends one, reasoning only on --effort.
  const sample = api.renderPrompt('categorySuggestion', SMALL_PROMPTS.categorySuggestion.input);
  const flagged = list => list.find(m => m.acceptsSampling)?.id;
  const unflagged = list => list.find(m => !m.acceptsSampling)?.id;
  const envelopeCases = [
    { provider: 'openai', model: api.DEFAULT_OPENAI_MODEL },
    { provider: 'openai', model: api.DEFAULT_OPENAI_MODEL, effort: 'none' },
    { provider: 'openai', model: flagged(api.OPENAI_MODELS), absent: 'no OpenAI id is flagged' },
    { provider: 'openai', model: unflagged(api.OPENAI_MODELS), absent: 'every OpenAI id is flagged' },
    { provider: 'claude', model: flagged(api.CLAUDE_MODELS), absent: 'no Claude id is flagged' },
    { provider: 'claude', model: unflagged(api.CLAUDE_MODELS), absent: 'every Claude id is flagged' },
    { provider: 'claude', model: MADE_UP_MODEL },
    { provider: 'gemini', model: api.DEFAULT_TEXT_MODEL },
  ];
  const envelopesChecked = new Set();
  for (const c of envelopeCases) {
    if (!c.model) {
      say(`     (${c.absent} in the catalog, so that case is skipped)`);
      continue;
    }
    const caseKey = `${c.provider} ${c.model} ${c.effort ?? ''}`;
    if (envelopesChecked.has(caseKey)) continue;
    envelopesChecked.add(caseKey);
    const body = buildEnvelope(c.provider, { model: c.model, rendered: sample, effort: c.effort, api });
    const wire = wireView(c.provider, { url: `https://${HOSTS[c.provider]}${REQUEST_PATHS[c.provider](c.model)}`, body });
    const wantSampling = c.provider === 'gemini' || api.acceptsSampling(c.model);
    const tag = `${c.provider} ${c.model}${c.effort ? ` --effort ${c.effort}` : ''}`;
    check(wire.model === c.model && wire.budget === sample.maxOutputTokens, `${tag}: names the model and ${BUDGET_KEYS[c.provider]} ${sample.maxOutputTokens}`);
    check(wire.sampling === wantSampling && (!wantSampling || samplingOf(c.provider, body) === sample.temperature),
      `${tag}: temperature ${wantSampling ? `${sample.temperature}, as the app sends` : 'not sent, as the app sends none'}`);
    check(c.effort
      ? sameList(wire.reasoning, ['reasoning']) && body.reasoning?.effort === c.effort
      : wire.reasoning.length === 0,
    `${tag}: ${c.effort ? `reasoning.effort ${c.effort}` : 'no reasoning or thinking key'}`);
  }

  // --sampling force: an unflagged OpenAI or Claude id is sent the declared
  // temperature with it, and none without it.
  for (const [provider, list] of [['openai', api.OPENAI_MODELS], ['claude', api.CLAUDE_MODELS]]) {
    const model = unflagged(list);
    if (!model) {
      say(`     (every ${provider} id is flagged in the catalog, so its --sampling force case is skipped)`);
      continue;
    }
    const auto = buildEnvelope(provider, { model, rendered: sample, api });
    const forced = buildEnvelope(provider, { model, rendered: sample, api, sampling: 'force' });
    check(!('temperature' in auto) && 'temperature' in forced && forced.temperature === sample.temperature,
      `${provider} ${model}: --sampling force sends temperature ${sample.temperature}, and without it none is sent`);
  }

  // The run loops. The envelope cases above stay green when a loop stops passing an
  // option on to buildEnvelope, and a keyed `--sampling force` run would then send no
  // temperature and read as an id that accepts none. So these drive runSmall and
  // runReceipts through runOffline, the wiring a --dry-run runs: options parsed from
  // argv, a sender over the recorder, and fixture ids with a stand-in image in place
  // of the browser render. What the loop prints is kept apart, so its envelopes do
  // not bury the checks.
  const stubFixtures = async () => ({ ids: Object.keys(CASES), png: () => 'cG5n' });
  const loopLines = [];
  const driveLoop = async argv => {
    const { opts, error } = parseArgs([...argv, '--dry-run']);
    if (error) throw new Error(`the self-test handed a loop an argv parseArgs refused: ${error}`);
    const lines = [];
    const log = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    let recorder;
    try {
      recorder = await runOffline({ opts, api, fixtures: stubFixtures });
    } finally {
      console.log = log;
    }
    loopLines.push(...lines);
    return { requests: recorder.requests, lines };
  };
  const smallIds = Object.keys(SMALL_PROMPTS);
  const loopCases = [
    { provider: 'claude', prompts: 'small', sampling: 'force' },
    { provider: 'claude', prompts: 'small', sampling: 'auto' },
    { provider: 'openai', prompts: 'small', sampling: 'force', effort: 'none' },
    { provider: 'openai', prompts: 'small', sampling: 'auto' },
    { provider: 'claude', prompts: 'receipt', sampling: 'force' },
    { provider: 'claude', prompts: 'receipt', sampling: 'auto' },
    { provider: 'openai', prompts: 'receipt', sampling: 'force', effort: 'none' },
    { provider: 'openai', prompts: 'receipt', sampling: 'auto' },
  ];
  for (const c of loopCases) {
    // An id the catalog flags takes a temperature without the lever, so only an unflagged one tells them apart.
    const model = unflagged(c.provider === 'openai' ? api.OPENAI_MODELS : api.CLAUDE_MODELS);
    if (!model) {
      say(`     (every ${c.provider} id is flagged in the catalog, so its --prompts ${c.prompts} --sampling ${c.sampling} loop case is skipped)`);
      continue;
    }
    const tag = `${c.provider} --prompts ${c.prompts} --sampling ${c.sampling}${c.effort ? ` --effort ${c.effort}` : ''}`;
    const { requests, lines } = await driveLoop([
      '--provider', c.provider, '--prompts', c.prompts, '--sampling', c.sampling, '--model', model,
      ...(c.effort ? ['--effort', c.effort] : []),
    ]);
    const declared = c.prompts === 'small'
      ? smallIds.map(id => api.renderPrompt(id, SMALL_PROMPTS[id].input).temperature)
      : Object.keys(CASES).map(() => receipt.temperature);
    check(requests.length === declared.length, `${tag}: the loop sent ${declared.length} envelopes to the recorder (${requests.length})`);
    check(requests.length > 0 && requests.every((request, i) => (c.sampling === 'force'
      ? typeof declared[i] === 'number' && request.body?.temperature === declared[i]
      : !wireView(c.provider, request).sampling)),
    `${tag}: the loop's envelopes ${c.sampling === 'force' ? `carry the declared temperature on ${model}, which the catalog does not flag` : `carry no temperature on ${model}`}`);
    check(requests.length > 0 && requests.every(request => (c.effort
      ? sameList(wireView(c.provider, request).reasoning, ['reasoning']) && request.body?.reasoning?.effort === c.effort
      : wireView(c.provider, request).reasoning.length === 0)),
    `${tag}: the loop's envelopes ${c.effort ? `carry reasoning.effort ${c.effort}` : 'carry no reasoning or thinking key'}`);
    check(lines.some(line => line.includes('sampling: force')) === (c.sampling === 'force'),
      `${tag}: the run header ${c.sampling === 'force' ? 'says' : 'does not say'} sampling is forced`);
    // What the run prints about its temperature is built apart from the envelopes it sends, so it is read too.
    const small = c.prompts === 'small';
    const shown = lines.filter(line => (small ? /^[A-Za-z]+: budget \d+, temperature / : /^config: /).test(line));
    const printsTemperature = line => (small ? !line.endsWith('temperature not sent') : line.includes('"temperature"'));
    check(shown.length === (small ? smallIds.length : 1) && shown.every(line => printsTemperature(line) === (c.sampling === 'force')),
      `${tag}: what the run prints about temperature (${small ? 'per-prompt lines' : 'config line'}) ${c.sampling === 'force' ? 'says one is sent' : 'says none is sent'}, as the wire does`);
  }
  // Chromium draws the receipt fixtures in every mode, a live one included, where no tripwire hides
  // the key variables. So the environment it is handed is built from the one given, not the listing.
  const withKeys = {
    ...Object.fromEntries([...KEY_VARIABLES, ...Object.keys(UNOVERRIDABLE_VARIABLES)].map(name => [name, `${CANARY}-${name}`])),
    PATH: '/usr/bin',
    HOME: '/home/probe',
  };
  const keep = [['HOME', '/home/probe'], ['PATH', '/usr/bin']];
  const sortedEntries = env => Object.entries(env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  check(sameList(sortedEntries(childEnv(withKeys)), keep),
    'a child process environment keeps everything but the key variables and the ones an SDK reads unconditionally');
  // The real render, as far as Chromium's launch: the launcher stands in for Playwright's, records
  // what it is handed and throws, so no browser starts and nothing is drawn.
  const { render: realRender, renderStandalone } = await import('./render.mjs');
  const launchStopped = new Error('the self-test stops the render at its launch');
  let launchedWith = null;
  const launcher = {
    launch: async options => {
      launchedWith = options;
      throw launchStopped;
    },
  };
  const launchesWithChildEnv = async run => {
    launchedWith = null;
    let stopped = false;
    try {
      await run();
    } catch (error) {
      stopped = error === launchStopped;
    }
    const env = launchedWith?.env;
    return stopped && sameList(sortedEntries(env), keep) && !Object.keys(env ?? {}).some(isHiddenVariable);
  };
  check(await launchesWithChildEnv(() => renderedFixtures({
    env: withKeys,
    load: async () => ({ CASE_IDS: [], render: options => realRender({ ...options, launcher }) }),
  })), 'the fixture render launches Chromium with that environment, so a live receipt run does not pass it a key');
  check(await launchesWithChildEnv(() => renderStandalone({ env: withKeys, launcher })),
    'render.mjs run on its own launches Chromium with that environment too');

  // Gemini always gets a temperature, so the lever changes nothing there and the header must not claim it did.
  for (const prompts of ['small', 'receipt']) {
    const tag = `gemini --prompts ${prompts} --sampling force`;
    const { requests, lines } = await driveLoop(['--provider', 'gemini', '--prompts', prompts, '--sampling', 'force']);
    check(requests.length > 0 && requests.every(request => wireView('gemini', request).sampling),
      `${tag}: every envelope carries a temperature, as it does without the flag`);
    check(!lines.some(line => line.includes('sampling: force')), `${tag}: the run header does not claim sampling was forced`);
  }

  // --repeat: parseArgs takes the number, and only the loop turns it into requests. A loop that
  // stopped reading it would send each prompt once and still print a header saying otherwise.
  {
    const { requests, lines } = await driveLoop(['--provider', 'gemini', '--prompts', 'small', '--repeat', '2']);
    check(requests.length === 2 * smallIds.length,
      `gemini --prompts small --repeat 2: the loop sent ${2 * smallIds.length} envelopes to the recorder (${requests.length})`);
    check(smallIds.every(id => lines.some(line => line.startsWith(`--- ${id} #2 (dry run, not sent): `))),
      'gemini --prompts small --repeat 2: every prompt prints its second request as #2');
  }

  // The readers, on the two shapes a starved answer takes.
  const cut = readOpenAI({
    model: 'm', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'reasoning' }], usage: { output_tokens: 50, output_tokens_details: { reasoning_tokens: 50 } },
  });
  check(cut.stop === 'incomplete/max_output_tokens' && cut.text === '' && sameList(cut.items, ['reasoning']) && cut.reasoningTokens === 50,
    'an OpenAI answer cut short records incomplete/max_output_tokens, [reasoning] and no text');
  const starved = readClaude({
    model: 'm', stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }],
    usage: { output_tokens: 50, output_tokens_details: { thinking_tokens: 50 } },
  });
  check(starved.stop === 'max_tokens' && starved.text === '' && sameList(starved.items, ['thinking']) && starved.reasoningTokens === 50,
    'a Claude answer that only thought records max_tokens, [thinking] and no text');

  // A repeated receipt case: the run that drifted is reported though the last one did not.
  const drift = driftLines(
    { jp: { country: 'JP', currency: 'JPY', total: 538 } },
    { jp: [{ country: 'KR', currency: 'JPY', total: 538 }, { country: 'JP', currency: 'JPY', total: 538 }] },
  );
  check(sameList(drift, ['  jp#1.country: baseline "JP" -> now "KR"']),
    'the drift block compares every run of a repeated receipt case, each under its own label');
  // And the run that drifted is the last one: a compare of the first run alone reads this as no drift.
  const lastDrift = driftLines(
    { jp: { country: 'JP', currency: 'JPY', total: 538 } },
    { jp: [{ country: 'JP', currency: 'JPY', total: 538 }, { country: 'KR', currency: 'JPY', total: 538 }] },
  );
  check(sameList(lastDrift, ['  jp#2.country: baseline "JP" -> now "KR"']),
    'the drift block reports a drift on the last run of a repeated receipt case, as #2');

  // --update records answers. A failed call has none, and a baseline holding one would
  // report drift against nothing on every later run.
  const answered = { jp: [{ country: 'JP', currency: 'JPY', total: 538 }], kr: [{ country: 'KR', currency: 'KRW', total: 10400 }] };
  const update = baselineUpdate('gemini-probe', '2026-10-14', answered);
  check(!update.failed && sameList(update.baseline, {
    model: 'gemini-probe', recorded: '2026-10-14', results: { jp: answered.jp[0], kr: answered.kr[0] },
  }), '--update builds the baseline from each case\'s record when every call answered');
  const withFailures = baselineUpdate('gemini-probe', '2026-10-14', { ...answered, none: [{ httpError: 503 }], long: [{ error: 'fetch failed' }] });
  check(withFailures.baseline === undefined && sameList(withFailures.failed, ['none', 'long']),
    '--update writes no baseline when a call failed, and names the cases whose call failed');

  // One small prompt through each sender, onto a recorder.
  const answer = SMALL_PROMPTS.categorySuggestion.sample;
  // The forced cases show each SDK carries a temperature the catalog never flagged onto the wire.
  const sendCases = [
    { provider: 'openai', model: api.DEFAULT_OPENAI_MODEL },
    { provider: 'claude', model: flagged(api.CLAUDE_MODELS) ?? api.DEFAULT_CLAUDE_MODEL },
    { provider: 'gemini', model: api.DEFAULT_TEXT_MODEL },
    { provider: 'openai', model: unflagged(api.OPENAI_MODELS) ?? api.DEFAULT_OPENAI_MODEL, sampling: 'force' },
    { provider: 'claude', model: unflagged(api.CLAUDE_MODELS) ?? api.DEFAULT_CLAUDE_MODEL, sampling: 'force' },
  ];
  for (const c of sendCases) {
    const via = c.provider === 'gemini' ? 'the Gemini sender' : 'the SDK';
    const tag = `${c.provider}${c.sampling ? ` --sampling ${c.sampling}` : ''}`;
    const recorder = makeRecorder(HOSTS[c.provider], cannedAnswer(c.provider, answer));
    const body = buildEnvelope(c.provider, { model: c.model, rendered: sample, api, sampling: c.sampling });
    let call = null;
    let failure = null;
    try {
      const send = await makeSender(c.provider, { key: PLACEHOLDER_KEYS[c.provider], transport: recorder.fetch });
      call = await send(c.model, body);
    } catch (error) {
      failure = error;
    }
    check(!failure, `${tag}: categorySuggestion on ${c.model} came back through ${via}${failure ? ` (${failure.message})` : ''}`);
    check(recorder.requests.length === 1, `${tag}: the recorder saw exactly one request (${recorder.requests.length})`);
    const request = recorder.requests[0];
    if (!request) continue;
    printRequest(`${tag} categorySuggestion, as recorded`, request);

    const url = new URL(request.url);
    check(request.method === 'POST' && url.host === HOSTS[c.provider] && url.pathname === REQUEST_PATHS[c.provider](c.model),
      `${tag}: POST ${HOSTS[c.provider]}${REQUEST_PATHS[c.provider](c.model)}`);
    const wire = wireView(c.provider, request);
    const wantSampling = c.provider === 'gemini' || c.sampling === 'force' || api.acceptsSampling(c.model);
    check(wire.model === c.model && wire.budget === sample.maxOutputTokens,
      `${tag}: the wire names ${c.model} and ${BUDGET_KEYS[c.provider]} ${sample.maxOutputTokens}`);
    check(wire.sampling === wantSampling, `${tag}: the wire ${wantSampling ? 'carries' : 'carries no'} temperature`);
    check(wire.reasoning.length === 0, `${tag}: the wire carries no reasoning or thinking key`);
    check(JSON.stringify(request).includes(PLACEHOLDER_KEYS[c.provider]),
      `${tag}: the request held the placeholder key, so the leak check below has one to catch`);
    if (call) {
      const want = EXPECTED_RECORDS[c.provider];
      check(call.model === `${c.model}-served` && call.stop === want.stop && sameList(call.items, want.items)
        && call.reasoningTokens === CANNED_REASONING_TOKENS,
      `${tag}: the record reads the served model, ${want.stop}, [${want.items.join(', ')}] and ${CANNED_REASONING_TOKENS} reasoning tokens`);
      check(SMALL_PROMPTS.categorySuggestion.parses(call.text), `${tag}: the answer past any reasoning block parsed`);
    }
  }

  // Every variable either SDK package reads, set to a canary on the real environment, but the four
  // system ones the Anthropic credential chain finds its config folder with (HOME, XDG_CONFIG_HOME,
  // APPDATA, USERPROFILE): the base URL each would otherwise take, at a host the recorder refuses;
  // the keys, which the tripwire also hides; OpenAI's organization and project, which it sends as
  // headers; Anthropic's webhook key, which never reaches the wire; both SDKs' logging; the header
  // the Anthropic client adds to every request; the credential chain's, which an API key keeps the
  // client from reaching; and those of the clients the probe never builds (Azure's, the
  // environments worker's). OPENAI_LOG is a later SDK's and 4.104.0 does not read it. With all of
  // them set, a request still goes to the vendor's public host, carries nothing from the
  // environment, the SDK prints nothing of its own, and it looks up none of them but the two no
  // option overrides: a lookup is what a dropped option shows, even where its value would never
  // reach the wire.
  const canaries = {
    ...Object.fromEntries([
      'OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID',
      'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'OPENAI_API_VERSION',
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_WEBHOOK_SIGNING_KEY',
      'ANTHROPIC_PROFILE', 'ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_WORKSPACE_ID',
      'ANTHROPIC_IDENTITY_TOKEN', 'ANTHROPIC_IDENTITY_TOKEN_FILE', 'ANTHROPIC_FEDERATION_RULE_ID',
      'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_SCOPE',
      'ANTHROPIC_WORK_ID', 'ANTHROPIC_ENVIRONMENT_ID', 'ANTHROPIC_SESSION_ID', 'ANTHROPIC_ENVIRONMENT_KEY',
    ].map(name => [name, `${CANARY}-${name}`])),
    ANTHROPIC_CUSTOM_HEADERS: `x-gateway-token: ${CANARY}-123`,
    ANTHROPIC_LOG: 'debug',
    OPENAI_LOG: 'debug',
    DEBUG: 'true',
    ANTHROPIC_BASE_URL: `https://${CANARY}.example`,
    OPENAI_BASE_URL: `https://${CANARY}.example/v1`,
  };
  const optioned = Object.keys(canaries).filter(name => !Object.hasOwn(UNOVERRIDABLE_VARIABLES, name));
  const savedEnv = Object.fromEntries(Object.keys(canaries).map(name => [name, underlyingEnv[name]]));
  Object.assign(underlyingEnv, canaries);
  const trippedEnv = process.env;
  try {
    for (const provider of ['claude', 'openai']) {
      const model = provider === 'claude' ? api.DEFAULT_CLAUDE_MODEL : api.DEFAULT_OPENAI_MODEL;
      const recorder = makeRecorder(HOSTS[provider], cannedAnswer(provider, answer));
      const printedBefore = output.text().length;
      // Every lookup of a canary the client has an option for, from its construction to its answer.
      const lookedUp = new Set();
      const noteLookup = name => {
        if (optioned.includes(name)) lookedUp.add(name);
      };
      process.env = new Proxy(trippedEnv, {
        get(target, name) {
          noteLookup(name);
          return Reflect.get(target, name);
        },
        has(target, name) {
          noteLookup(name);
          return Reflect.has(target, name);
        },
        getOwnPropertyDescriptor(target, name) {
          noteLookup(name);
          return Reflect.getOwnPropertyDescriptor(target, name);
        },
      });
      let failure = null;
      try {
        const send = await makeSender(provider, { key: PLACEHOLDER_KEYS[provider], transport: recorder.fetch });
        await send(model, buildEnvelope(provider, { model, rendered: sample, api }));
      } catch (error) {
        failure = error;
      } finally {
        process.env = trippedEnv;
      }
      const printedDuring = output.text().slice(printedBefore);
      const request = recorder.requests[0];
      const tag = `${provider}, with its SDK's environment variables set`;
      check(!failure && recorder.requests.length === 1 && new URL(request.url).host === HOSTS[provider],
        `${tag}: the one request was recorded for ${HOSTS[provider]}, not for the base URL the environment names`);
      check(request && !JSON.stringify(request.headers).includes(CANARY), `${tag}: no header from the environment reached the wire`);
      check(printedDuring === '', `${tag}: the SDK printed nothing of its own`);
      check(lookedUp.size === 0,
        `${tag}: the client looked up none of them but the two no option overrides${lookedUp.size ? ` (${[...lookedUp].join(', ')})` : ''}`);
    }
  } finally {
    process.env = trippedEnv;
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete underlyingEnv[name];
      else underlyingEnv[name] = value;
    }
  }

  // A printed request shows the headers the probe knows, hands an auth header to the redactor, and
  // hides every other header's value, whatever put it there.
  const printedBefore = output.text().length;
  printRequest('a request carrying a header the probe does not know', {
    method: 'POST',
    url: `https://${HOSTS.claude}${REQUEST_PATHS.claude()}`,
    headers: {
      accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-stainless-os': 'MacOS',
      'x-api-key': PLACEHOLDER_KEYS.claude,
      'x-gateway-token': `${CANARY}-456`,
      cookie: `session=${CANARY}-789`,
    },
    body: {},
  });
  const printedHeaders = output.text().slice(printedBefore);
  check(['    accept: application/json', '    anthropic-version: 2023-06-01', '    x-stainless-os: MacOS', '    x-api-key: <KEY>',
    '    x-gateway-token: <hidden>', '    cookie: <hidden>'].every(line => printedHeaders.includes(line)) && !printedHeaders.includes(CANARY),
  'a printed request shows the headers the probe knows, masks the auth header, and prints every other as <hidden>');

  // A live run cannot hide a variable no option overrides, so it refuses to start, naming the variable and never its value.
  const gateway = { ANTHROPIC_CUSTOM_HEADERS: `x-gateway-token: ${CANARY}-123`, PATH: '/usr/bin' };
  const claudeRefusal = liveEnvironmentRefusal('claude', gateway);
  check(typeof claudeRefusal === 'string' && claudeRefusal.includes('ANTHROPIC_CUSTOM_HEADERS') && !claudeRefusal.includes(CANARY),
    'a live Claude run refuses to start while ANTHROPIC_CUSTOM_HEADERS is set, naming it and not its value');
  const openaiRefusal = liveEnvironmentRefusal('openai', { DEBUG: 'true', PATH: '/usr/bin' });
  check(typeof openaiRefusal === 'string' && openaiRefusal.includes('DEBUG'), 'a live OpenAI run refuses to start while DEBUG is set');
  check(liveEnvironmentRefusal('openai', gateway) === null && liveEnvironmentRefusal('gemini', { ...gateway, DEBUG: 'true' }) === null
    && liveEnvironmentRefusal('claude', { PATH: '/usr/bin', DEBUG: 'true' }) === null,
  'a live run is refused only for a variable its own SDK reads');

  // Both SDKs retry a 429 or a 5xx by default. In a live run that would hide the answer
  // behind silent retries and spend quota, so each client is given no retries: one failed
  // call is one request, and the send rejects with the status the vendor answered.
  for (const provider of ['openai', 'claude']) {
    for (const status of [500, 429]) {
      const model = provider === 'claude' ? api.DEFAULT_CLAUDE_MODEL : api.DEFAULT_OPENAI_MODEL;
      const recorder = makeRecorder(HOSTS[provider], () => ({ error: { type: 'probe_error', message: 'canned failure' } }), status);
      let failure = null;
      try {
        const send = await makeSender(provider, { key: PLACEHOLDER_KEYS[provider], transport: recorder.fetch });
        await send(model, buildEnvelope(provider, { model, rendered: sample, api }));
      } catch (error) {
        failure = error;
      }
      check(failure?.status === status, `${provider}: an HTTP ${status} answer rejects the send with that status`);
      check(recorder.requests.length === 1, `${provider}: an HTTP ${status} answer is not retried (${recorder.requests.length} request(s))`);
    }
  }

  // A sender handed no transport would leave the SDK to pick its own: OpenAI 4.104.0 falls back to
  // node-fetch, past the platform-fetch trap above. So makeSender refuses one before it builds a
  // client. These cases only construct: no send is ever called, whatever makeSender returns.
  for (const provider of PROVIDERS) {
    const fetchesBefore = platformFetches;
    let refusal = null;
    try {
      await makeSender(provider, { key: PLACEHOLDER_KEYS[provider], transport: undefined });
    } catch (error) {
      refusal = error;
    }
    check(/needs a transport/.test(refusal?.message ?? '') && platformFetches === fetchesBefore,
      `${provider}: a sender handed no transport is refused before a client is built`);
  }

  // The Gemini sender puts the model in its URL path, ahead of the key parameter. An id that
  // reached it unencoded could move the key into a fragment or another parameter.
  const oddId = 'a#b?c';
  const geminiRecorder = makeRecorder(HOSTS.gemini, cannedAnswer('gemini', answer));
  const geminiSend = await makeSender('gemini', { key: PLACEHOLDER_KEYS.gemini, transport: geminiRecorder.fetch });
  await geminiSend(oddId, buildEnvelope('gemini', { model: oddId, rendered: sample, api }));
  const geminiUrl = new URL(geminiRecorder.requests[0].url);
  check(geminiUrl.pathname === `/v1beta/models/${encodeURIComponent(oddId)}:generateContent` && geminiUrl.hash === ''
    && sameList([...geminiUrl.searchParams.keys()], ['key']),
  'the Gemini sender encodes the model into its path, so no id moves the key out of its parameter');

  const strict = makeRecorder(HOSTS.openai, () => ({}));
  let refused = false;
  try {
    await strict.fetch('https://example.com/v1/responses', { method: 'POST', body: '{}' });
  } catch {
    refused = true;
  }
  check(refused && strict.requests.length === 0, 'the recorder throws on a host it was not made for');

  // Key hygiene.
  check(keyReads.length === 0, `no key variable was read${keyReads.length ? ` (${[...new Set(keyReads)].join(', ')})` : ''}`);
  check(liveKeyReads === 0, 'the live key readers never ran');
  check(platformFetches === 0, `no request reached the platform fetch${platformFetches ? ` (${platformFetches})` : ''}`);
  globalThis.fetch = platformFetch;
  const printed = output.text();
  check(!KEY_SHAPE.test(printed), 'no printed line carries a key-shaped string');
  check(!printed.includes(CANARY), 'no printed line carries a canary from the environment');
  check(loopLines.length > 0 && !KEY_SHAPE.test(loopLines.join('\n')), 'no line the run loops printed carries a key-shaped string');
  check(printed.includes('<KEY>'), 'the printed requests had their keys replaced');
  output.stop();

  const failed = results.filter(ok => !ok).length;
  say(`\nself-test: ${results.length - failed} of ${results.length} checks passed`);
  return failed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Exit once stdout and stderr have drained: a pipe is asynchronous on macOS. */
function exitAfterFlush(code) {
  process.exitCode = code;
  return new Promise(() => {
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
  });
}

let exitCode;
try {
  exitCode = ARGS.opts.selfTest ? await selfTest() : await probe(ARGS.opts);
} catch (error) {
  if (error instanceof Stop) {
    complain(error.message);
    exitCode = error.code;
  } else {
    complain(error?.stack ?? String(error));
    exitCode = 1;
  }
}
await exitAfterFlush(exitCode);
