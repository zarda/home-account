#!/usr/bin/env node
/**
 * Fails CI when firebase-tools' major version in package-lock.json moves
 * past the one this repo has verified.
 *
 * deploy-web runs `npx firebase deploy --only hosting,firestore,storage
 * --non-interactive` without --force (.github/workflows/ci.yml). That
 * combination is only safe because of one specific firebase-tools behavior:
 * when a deploy would delete Firestore indexes that aren't in
 * firestore.indexes.json, a non-interactive run without --force declines
 * the deletion and continues deploying everything else
 * (lib/firestore/api.js: `shouldDeleteIndexes = options.force`, then
 * `confirm({ default: false })` returns that default instead of prompting).
 * Additions still apply. That contract has been read and confirmed at
 * firebase-tools 15.28.2 (api.js:85-121 plus the prompt guard); it has not
 * been read at any other major.
 *
 * Dependabot bumps firebase-tools on its own schedule, and a major bump
 * could change or remove the decline-and-continue behavior without any
 * other CI check noticing — the emulator suite never touches
 * `firebase deploy`. This reads the version firebase-tools is actually
 * pinned to (`packages["node_modules/firebase-tools"].version` in
 * package-lock.json, lockfileVersion 3 — the version `npx firebase` will
 * actually run) and fails loudly when its major has moved, with a checklist
 * for what to re-verify before raising the pin (#351).
 *
 * `--self-test` exercises the evaluator against canned lockfile shapes and
 * exits non-zero if the checker itself is broken; npm's
 * firebase-tools:check chains it first, as i18n:check does.
 */

import { readFileSync } from 'node:fs';

const SELF = 'scripts/check-firebase-tools-major.mjs';
const LOCKFILE = 'package-lock.json';
const PACKAGE_KEY = 'node_modules/firebase-tools';
const FIRESTORE_API = 'node_modules/firebase-tools/lib/firestore/api.js';
const DEPLOY_DOC = 'docs/deploy.md';
const BLIND_SPOTS_DOC = 'docs/emulator-blind-spots.md';

// Overridable so the failure path can be proven in CI or locally without
// hand-editing the pin (#351); the value checked into this file is the
// real gate.
const PINNED_MAJOR = process.env.FIREBASE_TOOLS_EXPECTED_MAJOR
  ? Number(process.env.FIREBASE_TOOLS_EXPECTED_MAJOR)
  : 15;

function majorBumpedMessage(major, version, pinnedMajor) {
  return (
    `firebase-tools major bumped from ${pinnedMajor} to ${major} ` +
    `(${LOCKFILE} locks it at ${version}).\n\n` +
    `deploy-web's non-interactive deploy relies on firebase-tools declining\n` +
    `index deletions instead of deploying blind; that has only been verified\n` +
    `at major ${pinnedMajor}. Before raising PINNED_MAJOR in ${SELF}:\n\n` +
    `  1. Re-read firebase-tools' non-interactive deletion path:\n` +
    `       ${FIRESTORE_API}\n` +
    `     It must still decline and continue: shouldDeleteIndexes = options.force,\n` +
    `     then confirm({ default: false }) returns that default instead of\n` +
    `     prompting.\n` +
    `  2. Update ${DEPLOY_DOC} and ${BLIND_SPOTS_DOC} if the behavior changed.\n` +
    `  3. Raise PINNED_MAJOR in ${SELF} to ${major}.\n`
  );
}

/**
 * Shape guard: the day the lockfile format or the firebase-tools entry
 * moves, this must fail loudly rather than silently pass an unread version.
 */
function shapeFailure(detail) {
  return {
    ok: false,
    kind: 'shape',
    message:
      `${LOCKFILE}: ${detail}\n` +
      `The extraction in ${SELF} no longer matches the lockfile (lockfileVersion 3\n` +
      `shape assumed). Fix the extraction before trusting this check.`,
  };
}

/** Pure evaluator over a parsed lockfile object, so selfTest() needs no disk I/O. */
function evaluateLockfile(lockfile, pinnedMajor) {
  const entry = lockfile?.packages?.[PACKAGE_KEY];
  if (!entry || typeof entry !== 'object') {
    return shapeFailure(`no "${PACKAGE_KEY}" entry under packages.`);
  }

  const { version } = entry;
  const match = typeof version === 'string' ? /^(\d+)\./.exec(version) : null;
  if (!match) {
    return shapeFailure(
      `firebase-tools version ${JSON.stringify(version)} at packages["${PACKAGE_KEY}"].version ` +
        `does not start with a major version number.`
    );
  }

  const major = Number(match[1]);
  if (major !== pinnedMajor) {
    return { ok: false, kind: 'major', major, version, message: majorBumpedMessage(major, version, pinnedMajor) };
  }

  return { ok: true, kind: 'pinned', major, version };
}

function run() {
  const lockfile = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
  const result = evaluateLockfile(lockfile, PINNED_MAJOR);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(
    `firebase-tools is locked to major ${result.major} (${result.version}), matching the verified pin (${PINNED_MAJOR}).`
  );
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }

  const lockfileWith = version => ({ packages: { [PACKAGE_KEY]: { version } } });

  const pinned = evaluateLockfile(lockfileWith('15.28.2'), 15);
  check('accepts a version whose major matches the pin', pinned.ok, true);

  const bumped = evaluateLockfile(lockfileWith('16.0.0'), 15);
  check('rejects a major bump', bumped.ok, false);
  check(
    'a major-bump failure names the re-verification checklist',
    ['PINNED_MAJOR', FIRESTORE_API, DEPLOY_DOC, BLIND_SPOTS_DOC].every(needle => bumped.message.includes(needle)),
    true
  );

  const missingEntry = evaluateLockfile({ packages: {} }, 15);
  check('flags a missing lockfile entry as a shape failure', missingEntry.kind, 'shape');

  const noVersionField = evaluateLockfile({ packages: { [PACKAGE_KEY]: {} } }, 15);
  check('flags an entry with no version field as a shape failure', noVersionField.kind, 'shape');

  const unparseableVersion = evaluateLockfile(lockfileWith('latest'), 15);
  check('flags an unparseable version as a shape failure', unparseableVersion.kind, 'shape');

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
  console.log(`check-firebase-tools-major self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
