#!/usr/bin/env node
/**
 * Runs a command against the Firestore emulator while keeping the
 * emulator's lock waiters awake (#492).
 *
 * The emulator (cloud-firestore-emulator 1.22.0) closes a commit its rules
 * refuse without waking the commits queued on that commit's locks. They are
 * woken only by the next lock request from anyone, or by their own 2 s lock
 * wait running out, after which a rules lookup fails as `Service call
 * error` and the commit is refused. During a smoke run Chrome makes such
 * refused commits itself: it sends a commit again when the connection it went
 * out on closes, while the emulator still runs the first copy, and a copy of
 * a resend, refused, can hold a document the next commit reads. With nothing
 * else in flight the next commit then waits out the full 2 s.
 *
 * Every EMULATOR_TICK_MS (default 200; 0 turns it off) this writes one
 * document, `_emulatorTicker/tick`, as the emulator's owner. Owner writes skip
 * the rules but take locks like any commit, and any lock request makes the
 * emulator look through every waiting commit, so a stranded one waits one
 * interval at most. Nothing reads the document, and it is the only thing in
 * its collection, so it conflicts with nothing a test does. A tick that fails
 * is counted, never fatal: the run's own result is the command's.
 *
 * Usage: node scripts/emulator-ticker.mjs <command> [args...]
 * inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
 * The exit code is the command's. `--self-test` checks the ticker against a
 * fake emulator and exits non-zero if the ticker itself is broken.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const DEFAULT_TICK_MS = 200;
const DEFAULT_HOST = '127.0.0.1:8080';
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-home-account';
const TICK_PATH = '_emulatorTicker/tick';

/** The tick interval from the environment: a non-negative integer, 0 for off. */
export function tickInterval(value) {
  if (value === undefined || value === '') return DEFAULT_TICK_MS;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`EMULATOR_TICK_MS must be a whole number of milliseconds, not "${value}"`);
  return ms;
}

function tickUrl(host) {
  return `http://${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${TICK_PATH}`;
}

/** Writes the tick document every `ms`, one write in flight at a time, until stopped. */
function startTicking(host, ms) {
  const counts = { sent: 0, failed: 0 };
  if (ms === 0) return { counts, stop: async () => counts };
  let stopped = false;
  let timer;
  let inFlight = Promise.resolve();
  const tick = () => {
    if (stopped) return;
    counts.sent += 1;
    inFlight = fetch(tickUrl(host), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: { n: { integerValue: String(counts.sent) } } })
    })
      .then(response => { if (!response.ok) counts.failed += 1; })
      .catch(() => { counts.failed += 1; })
      .finally(() => { if (!stopped) timer = setTimeout(tick, ms); });
  };
  timer = setTimeout(tick, ms);
  return {
    counts,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
      return counts;
    }
  };
}

/** Runs the command with the ticker beside it; resolves with the command's exit code. */
export function run(argv, env = process.env, { quiet = false } = {}) {
  if (argv.length === 0) throw new Error('usage: emulator-ticker.mjs <command> [args...]');
  const ms = tickInterval(env.EMULATOR_TICK_MS);
  const host = env.FIRESTORE_EMULATOR_HOST || DEFAULT_HOST;
  const ticker = startTicking(host, ms);
  const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env });
  const forward = signal => () => child.kill(signal);
  const forwarded = ['SIGINT', 'SIGTERM'].map(signal => [signal, forward(signal)]);
  for (const [signal, handler] of forwarded) process.on(signal, handler);
  return new Promise(resolve => {
    child.on('error', async error => {
      await ticker.stop();
      console.error(`emulator ticker: could not start ${argv[0]}: ${error.message}`);
      resolve(127);
    });
    child.on('exit', async (code, signal) => {
      for (const [name, handler] of forwarded) process.off(name, handler);
      const counts = await ticker.stop();
      if (ms > 0 && !quiet) console.error(`emulator ticker: ${counts.sent} ticks every ${ms} ms, ${counts.failed} failed`);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function selfTest() {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };

  check(tickInterval(undefined) === DEFAULT_TICK_MS && tickInterval('') === DEFAULT_TICK_MS, 'an unset interval is the default');
  check(tickInterval('0') === 0 && tickInterval('50') === 50, 'a whole number of milliseconds is taken as given');
  for (const bad of ['-1', '1.5', 'often']) {
    let threw = false;
    try { tickInterval(bad); } catch { threw = true; }
    check(threw, `"${bad}" is refused`);
  }

  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, auth: request.headers.authorization });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${server.address().port}`;
  const child = code => [process.execPath, '-e', `setTimeout(() => process.exit(${code}), 450)`];
  try {
    const code = await run(child(3), { ...process.env, FIRESTORE_EMULATOR_HOST: host, EMULATOR_TICK_MS: '100' }, { quiet: true });
    check(code === 3, `the exit code is the command's (got ${code})`);
    check(requests.length >= 3, `it ticks while the command runs (got ${requests.length} ticks)`);
    check(requests.every(r => r.method === 'PATCH' && r.auth === 'Bearer owner' && r.url.endsWith(`/documents/${TICK_PATH}`)),
      'each tick is an owner write of the tick document');
    const before = requests.length;
    const off = await run(child(0), { ...process.env, FIRESTORE_EMULATOR_HOST: host, EMULATOR_TICK_MS: '0' }, { quiet: true });
    check(off === 0 && requests.length === before, 'an interval of 0 runs the command without ticking');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  // A tick that cannot reach the emulator is counted, not fatal.
  const unreachable = await run(child(0), { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:9', EMULATOR_TICK_MS: '100' }, { quiet: true });
  check(unreachable === 0, 'an unreachable emulator does not fail the command');

  if (failures.length) {
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(`\n${failures.length} self-test failure(s) — the ticker itself is broken.`);
    process.exit(1);
  }
  console.log('emulator-ticker self-test: passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') await selfTest();
  else process.exit(await run(argv));
}
