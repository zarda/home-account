#!/usr/bin/env node
/**
 * Fails deploy-web when PROD_ENVIRONMENT_TS (the GitHub secret written to
 * the gitignored src/environments/environment.prod-local.ts) has drifted
 * from what this repo last recorded a digest for (#349).
 *
 * Nothing else can make that drift visible: the secret lives only inside
 * GitHub, the file it produces is gitignored on purpose (it holds
 * production Firebase keys), and the ci job's own stand-in for the same
 * path (its "Create local environment stubs" step, ci.yml) never touches
 * the real secret. Two failure modes this closes:
 *   - the local file is edited and `gh secret set` is forgotten — the next
 *     deploy would go on shipping whatever the secret still held.
 *   - `gh secret set` runs but `--write` and the digest commit do not — the
 *     guard itself goes stale and starts failing red on every deploy, which
 *     is loud, not silent (the accepted race and the residual gap are
 *     recorded in ADR 0084).
 *
 * normalize() strips a trailing run of CR/LF before hashing so three ways
 * of putting the same content on disk hash identically: deploy-web's
 * `printf '%s' "$PROD_ENVIRONMENT_TS" > …ts` (no trailing newline), a
 * locally-saved file (editors add one), and `gh secret set … < …ts` (reads
 * the file verbatim, newline and all — the value GitHub actually stores).
 * Only the trailing run is stripped; a blank line in the middle of the file
 * still changes the digest.
 *
 * Default mode compares sha256(normalize(FILE)) against the committed
 * environment.prod-local.sha256 and exits 1 on any mismatch or missing
 * digest file, printing both digests — never file content, which holds
 * production secrets — plus the two-command ritual to re-sync. `--write`
 * recomputes and overwrites the committed digest from the real local file;
 * it is a human step run after `gh secret set`, never invoked by CI.
 *
 * The ci job's stub step writes a placeholder to this same path, so the
 * compare would fail there by construction; the ci job runs `--self-test`
 * only, grouped with the firebase-tools major check. deploy-web runs the
 * full `--self-test && ` compare ahead of the production build, so a
 * drifted secret fails in seconds instead of after a full Angular build.
 *
 * `--self-test` exercises normalize/digestOf/evaluateDigests directly and
 * also spawns this file as a real child process (node:child_process
 * execFileSync) against fixture files in a node:os tmpdir, so the CLI
 * wiring — argv dispatch, --write, exit codes, and the printed failure text
 * — is proven and not just the pure functions. npm's prod-env:check chains
 * it first, as i18n:check and firebase-tools:check do.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// SELF is the repo-root-relative form used in human-facing messages; the
// self-test's spawned child needs SCRIPT_PATH instead — an absolute path
// that still resolves after the child's cwd is redirected into a tmpdir.
const SELF = 'scripts/check-prod-env.mjs';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ENV_FILE = 'src/environments/environment.prod-local.ts';
const DIGEST_FILE = 'src/environments/environment.prod-local.sha256';

function ritual() {
  return (
    `  1. Edit the local file.\n` +
    `  2. gh secret set PROD_ENVIRONMENT_TS < ${ENV_FILE}\n` +
    `  3. node ${SELF} --write\n` +
    `  4. Commit the updated ${DIGEST_FILE}.`
  );
}

/**
 * Strips a trailing run of CR/LF so printf's no-newline write, an
 * editor-saved file, and `gh secret set`'s verbatim read of the same
 * content all hash identically. Anchored at the end only — an interior
 * blank line still changes the digest.
 */
function normalize(text) {
  return text.replace(/[\r\n]+$/, '');
}

function digestOf(text) {
  return createHash('sha256').update(normalize(text), 'utf8').digest('hex');
}

function missingDigestMessage() {
  return (
    `${DIGEST_FILE} does not exist.\n\n` +
    `Nothing has ever recorded what PROD_ENVIRONMENT_TS should hash to. Run:\n\n` +
    `${ritual()}\n`
  );
}

function mismatchMessage(fileDigest, committedDigest) {
  return (
    `${ENV_FILE} does not match the committed digest.\n\n` +
    `  file digest:      ${fileDigest}\n` +
    `  committed digest: ${committedDigest}\n\n` +
    `PROD_ENVIRONMENT_TS drifted from ${DIGEST_FILE} — either the secret was\n` +
    `updated without finishing the ritual, or the local file changed without\n` +
    `it. Finish it:\n\n${ritual()}\n`
  );
}

/**
 * Pure: decides the check outcome from two digests alone — it never sees
 * file content, so the failure path cannot leak a secret by construction.
 */
function evaluateDigests(fileDigest, committedDigest) {
  if (committedDigest === null) {
    return { ok: false, kind: 'missing', message: missingDigestMessage() };
  }
  if (fileDigest !== committedDigest) {
    return { ok: false, kind: 'mismatch', message: mismatchMessage(fileDigest, committedDigest) };
  }
  return { ok: true, kind: 'match', fileDigest };
}

function run() {
  const fileDigest = digestOf(readFileSync(ENV_FILE, 'utf8'));
  const committedDigest = existsSync(DIGEST_FILE) ? readFileSync(DIGEST_FILE, 'utf8').trim() : null;
  const result = evaluateDigests(fileDigest, committedDigest);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(`${ENV_FILE} matches the committed digest (${result.fileDigest}).`);
}

function write() {
  const digest = digestOf(readFileSync(ENV_FILE, 'utf8'));
  writeFileSync(DIGEST_FILE, `${digest}\n`);
  console.log(`Wrote ${DIGEST_FILE} (${digest}).`);
}

/**
 * Spawns this file as a real child process (never this process's own
 * functions) against fixture files under a tmpdir, isolated from the real
 * repo, so --write's file I/O and the CLI's argv dispatch, exit codes, and
 * printed failure text are proven — not just the pure functions above.
 */
function selfTestSpawnVectors(check) {
  const root = mkdtempSync(join(tmpdir(), 'check-prod-env-'));
  try {
    const envDir = join(root, 'src', 'environments');
    mkdirSync(envDir, { recursive: true });
    const envFile = join(envDir, 'environment.prod-local.ts');
    const digestFile = join(envDir, 'environment.prod-local.sha256');
    const marker = 'fixture-secret-9f3c';
    writeFileSync(envFile, `export const environment = { token: '${marker}' };\n`);

    // stdio is piped explicitly (never the execFileSync default) so the
    // deliberately-failing red-path call below cannot bleed its child's
    // stderr live into this process's own — this self-test's own output
    // must stay pristine, including when it runs inside CI.
    const spawnOptions = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

    execFileSync(process.execPath, [SCRIPT_PATH, '--write'], spawnOptions);
    const written = existsSync(digestFile) ? readFileSync(digestFile, 'utf8') : '';
    check('--write produces a 64-character hex digest plus one newline', /^[0-9a-f]{64}\n$/.test(written), true);

    const roundtrip = execFileSync(process.execPath, [SCRIPT_PATH], spawnOptions);
    check('the freshly written digest checks clean over the real spawn path', /matches/.test(roundtrip), true);

    writeFileSync(envFile, `export const environment = { token: '${marker}-mutated' };\n`);
    let failed = false;
    let output = '';
    try {
      execFileSync(process.execPath, [SCRIPT_PATH], spawnOptions);
    } catch (err) {
      failed = true;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    check('a drifted file fails over the real spawn path', failed, true);

    const fileDigestNow = digestOf(readFileSync(envFile, 'utf8'));
    const committedDigestNow = written.trim();
    check('the failure output names the file digest', output.includes(fileDigestNow), true);
    check('the failure output names the committed digest', output.includes(committedDigestNow), true);
    check('the failure output never contains the fixture content', !output.includes(marker), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }

  check('a trailing newline does not change the digest', digestOf('hello\n'), digestOf('hello'));
  check('a trailing CRLF does not change the digest', digestOf('hello\r\n'), digestOf('hello'));
  check('several trailing newlines collapse like one', digestOf('hello\n\n\n'), digestOf('hello'));
  check(
    'only the trailing run is stripped, not an interior blank line',
    digestOf('hello\n\nworld\n'),
    digestOf('hello\n\nworld')
  );
  check('an interior newline still changes the digest', digestOf('a\nb') === digestOf('ab'), false);

  const same = digestOf('same content');
  const other = digestOf('other content');
  check('matching digests evaluate ok', evaluateDigests(same, same).ok, true);

  const mismatch = evaluateDigests(same, other);
  check('a mismatch evaluates not-ok', mismatch.ok, false);
  check('a mismatch is tagged kind "mismatch"', mismatch.kind, 'mismatch');
  check('a mismatch message names the file digest', mismatch.message.includes(same), true);
  check('a mismatch message names the committed digest', mismatch.message.includes(other), true);

  const missing = evaluateDigests(same, null);
  check('a missing committed digest is tagged kind "missing", not "mismatch"', missing.kind, 'missing');
  check('a missing-digest message points at --write', missing.message.includes('--write'), true);

  selfTestSpawnVectors(check);

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
  console.log(`check-prod-env self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--write')) {
  write();
} else {
  run();
}
