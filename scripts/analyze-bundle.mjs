#!/usr/bin/env node
/**
 * Attributes the initial bundle to the modules that fill it (#437).
 *
 * `ng build` prints its initial chunk table rounded to 0.01 kB and a total
 * rounded to 0.01 MB, one row per output file. The initial budget in
 * angular.json is a byte count and the headroom under it is a few kilobytes,
 * so neither the rounding nor the per-file view says what is worth cutting.
 * `npm run build:analyze` builds with --stats-json, which makes the
 * @angular/build:application builder write dist/home-account/stats.json (the
 * esbuild metafile), and this reads it: for every initial output, the ten
 * inputs that put the most bytes into it, and then the initial total in exact
 * bytes.
 *
 * "Initial" is the builder's own definition, mirrored from the "Find all
 * initial files" block of
 * node_modules/@angular/build/src/tools/esbuild/bundler-context.js:
 *   - An entry is an output that carries an entryPoint and whose basename,
 *     stripped of its -HASH.ext suffix, is main, polyfills or styles. The
 *     entryPoint alone does not decide: a lazy chunk carries one too.
 *   - The closure follows an entry's imports of kind import-statement and
 *     import-rule, transitively, and nothing else. A dynamic-import is lazy
 *     however large its target is, and an external import is no output at all.
 *   - The total sums each initial output's `bytes`, CSS included. That sum is
 *     what the initial budget is measured against.
 *
 * The metafile keys are opaque here. esbuild writes an output's key and every
 * import path that names it in the same form, so one lookup is enough and the
 * report prints the key as it finds it.
 *
 * `--self-test` runs the analysis over an inline metafile: the entries, a CSS
 * output, a static-import child, and a dynamic-import chunk that carries an
 * entryPoint and must stay out. The ci job runs it; the real run needs a
 * production build, so it is local only.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const SELF = 'scripts/analyze-bundle.mjs';
const STATS = 'dist/home-account/stats.json';
const ENTRY_NAMES = new Set(['main', 'polyfills', 'styles']);
const FOLLOWED_KINDS = new Set(['import-statement', 'import-rule']);
const TOP_INPUTS = 10;

/** The builder's own name rule: `main-NRY3XW3O.js` is `main`, `chunk-Ab12CdEf.js` stays whole. */
function entryNameOf(path) {
  return basename(path).replace(/(?:-[\dA-Z]{8})?\.[a-z]{2,3}$/, '');
}

/**
 * Shape guard: the day the metafile moves, this must fail loudly rather than
 * print a total over the wrong set of files.
 */
function shapeFailure(detail) {
  return {
    ok: false,
    message:
      `${STATS}: ${detail}\n` +
      `The extraction in ${SELF} no longer matches the metafile the builder writes.\n` +
      `Fix the extraction before trusting a figure.`,
  };
}

function byBytesThenName(a, b) {
  if (b.bytes !== a.bytes) return b.bytes - a.bytes;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Pure analysis over a parsed metafile, so selfTest() needs no disk I/O. */
function analyze(metafile) {
  const outputs = metafile?.outputs;
  if (!outputs || typeof outputs !== 'object') {
    return shapeFailure('no `outputs` object.');
  }

  const initial = new Set();
  for (const [path, output] of Object.entries(outputs)) {
    if (output?.entryPoint && ENTRY_NAMES.has(entryNameOf(path))) initial.add(path);
  }
  if (![...initial].some(path => entryNameOf(path) === 'main')) {
    return shapeFailure('no output is the `main` entry, so the builder\'s naming rule has moved.');
  }

  const pending = [...initial];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    for (const imported of outputs[path].imports ?? []) {
      if (imported.external || !FOLLOWED_KINDS.has(imported.kind) || initial.has(imported.path)) {
        continue;
      }
      if (!outputs[imported.path]) {
        return shapeFailure(`${path} imports ${imported.path}, which is not an output.`);
      }
      initial.add(imported.path);
      pending.push(imported.path);
    }
  }

  const rows = [];
  for (const path of initial) {
    const { bytes, inputs } = outputs[path];
    if (!Number.isFinite(bytes)) {
      return shapeFailure(`${path} has no numeric \`bytes\`.`);
    }
    const top = Object.entries(inputs ?? {})
      .map(([name, input]) => ({ name, bytes: input.bytesInOutput }))
      .sort(byBytesThenName)
      .slice(0, TOP_INPUTS);
    rows.push({ name: path, bytes, top });
  }
  rows.sort(byBytesThenName);

  const sum = list => list.reduce((total, row) => total + row.bytes, 0);
  const css = rows.filter(row => row.name.endsWith('.css'));
  return {
    ok: true,
    rows,
    totalBytes: sum(rows),
    cssBytes: sum(css),
    jsBytes: sum(rows) - sum(css),
  };
}

const bytesText = n => n.toLocaleString('en-US');

function report({ rows, totalBytes, jsBytes, cssBytes }) {
  const lines = [];
  for (const row of rows) {
    lines.push(`${row.name}  ${bytesText(row.bytes)} B`);
    row.top.forEach((input, i) => {
      lines.push(`  ${String(i + 1).padStart(2)}. ${bytesText(input.bytes).padStart(9)} B  ${input.name}`);
    });
    lines.push('');
  }
  lines.push(
    `Initial total: ${bytesText(totalBytes)} B in ${rows.length} files ` +
      `(JS ${bytesText(jsBytes)} + CSS ${bytesText(cssBytes)})`
  );
  return lines.join('\n');
}

function run() {
  let metafile;
  try {
    metafile = JSON.parse(readFileSync(STATS, 'utf8'));
  } catch (error) {
    console.error(
      `Cannot read ${STATS} (${error.message}).\n` +
        `Build with the stats file first: npm run build:analyze`
    );
    process.exit(1);
  }

  const result = analyze(metafile);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(report(result));
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }

  // Twelve inputs of 101..112 bytes: only the ten largest (112..103) may print.
  const twelve = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `node_modules/pkg/file-${String(i).padStart(2, '0')}.mjs`,
      { bytesInOutput: 101 + i },
    ])
  );

  const metafile = {
    inputs: {},
    outputs: {
      'main-ABCD1234.js': {
        bytes: 1000,
        entryPoint: 'src/main.ts',
        imports: [
          { path: 'chunk-Static1.js', kind: 'import-statement' },
          { path: 'chunk-Lazy1.js', kind: 'dynamic-import' },
          { path: 'https://example.test/lib.js', kind: 'import-statement', external: true },
        ],
        inputs: twelve,
      },
      'polyfills-ABCD1234.js': {
        bytes: 200,
        entryPoint: 'angular:polyfills:angular:polyfills',
        imports: [],
        inputs: { 'node_modules/zone.js/zone.js': { bytesInOutput: 150 } },
      },
      'styles-ABCD1234.css': {
        bytes: 300,
        entryPoint: 'angular:styles/global:styles',
        imports: [
          { path: 'theme-ABCD1234.css', kind: 'import-rule' },
          { path: 'font.woff2', kind: 'url-token', external: true },
        ],
        inputs: { 'src/styles.scss': { bytesInOutput: 280 } },
      },
      'theme-ABCD1234.css': { bytes: 50, imports: [], inputs: {} },
      // The static-import child, and its own child one hop further.
      'chunk-Static1.js': {
        bytes: 400,
        imports: [{ path: 'chunk-Static2.js', kind: 'import-statement' }],
        inputs: { 'src/app/shared.ts': { bytesInOutput: 390 } },
      },
      'chunk-Static2.js': { bytes: 30, imports: [], inputs: {} },
      // A dynamic-import target carries an entryPoint too, and must stay out
      // with everything only it reaches. Static1 is also reached from main.
      'chunk-Lazy1.js': {
        bytes: 700,
        entryPoint: 'src/app/lazy.ts',
        imports: [
          { path: 'chunk-OnlyLazy.js', kind: 'import-statement' },
          { path: 'chunk-Static1.js', kind: 'import-statement' },
        ],
        inputs: {},
      },
      'chunk-OnlyLazy.js': { bytes: 90, imports: [], inputs: {} },
      // An output named like an entry that carries no entryPoint is no entry.
      'styles-ZZZZ9999.css': { bytes: 7, imports: [], inputs: {} },
      // A lazy entry whose name merely starts with an entry name.
      'maintenance-ABCD1234.js': {
        bytes: 5000,
        entryPoint: 'src/app/maintenance.ts',
        imports: [],
        inputs: {},
      },
    },
  };

  const result = analyze(metafile);
  check('analyses the fixture', result.ok, true);
  check(
    'counts the entries, the CSS, and the static-import closure, and nothing lazy',
    result.rows.map(row => row.name).sort(),
    [
      'chunk-Static1.js',
      'chunk-Static2.js',
      'main-ABCD1234.js',
      'polyfills-ABCD1234.js',
      'styles-ABCD1234.css',
      'theme-ABCD1234.css',
    ]
  );
  check('sums the output bytes of every initial output', result.totalBytes, 1980);
  check('counts the CSS in the total and splits it out', [result.jsBytes, result.cssBytes], [1630, 350]);
  check(
    'lists the largest output first',
    result.rows.map(row => row.name)[0],
    'main-ABCD1234.js'
  );

  const main = result.rows.find(row => row.name === 'main-ABCD1234.js');
  check('keeps the ten largest inputs of an output', main.top.length, 10);
  check(
    'orders them by bytesInOutput, largest first',
    [main.top[0].bytes, main.top[9].bytes],
    [112, 103]
  );

  const tied = analyze({
    outputs: {
      'main-ABCD1234.js': {
        bytes: 10,
        entryPoint: 'src/main.ts',
        imports: [],
        inputs: { 'b.ts': { bytesInOutput: 5 }, 'a.ts': { bytesInOutput: 5 } },
      },
    },
  });
  check('breaks a tie between inputs by name', tied.rows[0].top.map(input => input.name), ['a.ts', 'b.ts']);

  const text = report(result);
  check(
    'prints the total in exact bytes, grouped',
    text.split('\n').at(-1),
    'Initial total: 1,980 B in 6 files (JS 1,630 + CSS 350)'
  );
  check('prints the biggest input of the main output', text.includes('112 B  node_modules/pkg/file-11.mjs'), true);
  check('leaves a lazy chunk out of the report', text.includes('chunk-Lazy1.js'), false);

  check('strips the builder hash from an entry name', entryNameOf('main-NRY3XW3O.js'), 'main');
  check('strips it from a stylesheet too', entryNameOf('styles-6KNVGJVH.css'), 'styles');
  check(
    'leaves a name whose hash is not upper-case whole, so it is never an entry',
    entryNameOf('chunk-Ab12CdEf.js'),
    'chunk-Ab12CdEf'
  );

  check('fails on a metafile with no outputs', analyze({}).ok, false);
  check(
    'fails when no output is the main entry',
    analyze({ outputs: { 'polyfills-ABCD1234.js': { bytes: 1, entryPoint: 'x.ts', imports: [] } } }).ok,
    false
  );
  const dangling = analyze({
    outputs: {
      'main-ABCD1234.js': {
        bytes: 1,
        entryPoint: 'src/main.ts',
        imports: [{ path: 'chunk-Gone.js', kind: 'import-statement' }],
      },
    },
  });
  check('fails on a static import that is no output', dangling.ok, false);
  check('names the missing import', dangling.message.includes('chunk-Gone.js'), true);
  const unsized = analyze({
    outputs: {
      'main-ABCD1234.js': { bytes: 'x', entryPoint: 'src/main.ts', imports: [] },
    },
  });
  check('fails on an initial output whose bytes is not a number', unsized.ok, false);
  check('names the output without numeric bytes', unsized.message?.includes('main-ABCD1234.js'), true);

  const failed = cases.filter(c => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!c.ok) {
      console.error(`       expected ${JSON.stringify(c.expected)}`);
      console.error(`       actual   ${JSON.stringify(c.actual)}`);
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} self-test failure(s) — the analyzer itself is broken.`);
    process.exit(1);
  }
  console.log(`analyze-bundle self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
