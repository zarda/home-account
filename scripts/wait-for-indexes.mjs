#!/usr/bin/env node
/**
 * Holds deploy-web's green light until the Firestore composite indexes the
 * deploy just pushed have finished building (#352).
 *
 * `firebase deploy` returns as soon as Firestore accepts an index
 * definition; the build itself is asynchronous and takes anywhere from
 * seconds to minutes. Nothing in CI saw that gap: a merge could go green
 * while the index its new query needs was still building, and that query
 * would keep failing with failed-precondition until the build finished.
 * Watching Firestore → Indexes until every entry reads Enabled was the
 * manual half of every release — ADR 0077 records it as a known gap, and
 * docs/emulator-blind-spots.md is the reason it matters here more than most
 * places: the emulator never enforces composite indexes at all.
 *
 * This runs immediately after the Deploy step, so the release has already
 * happened by the time it reports. Red here means shipped but unverified —
 * never "nothing was released", and never a reason to roll back.
 *
 * It authenticates with the same service-account key
 * google-github-actions/auth exports for firebase-tools
 * (GOOGLE_APPLICATION_CREDENTIALS), minting one OAuth2 access token through
 * the service-account JWT flow — retried inside the same ten-minute budget
 * if the mint itself is only briefly unavailable, then reused for the whole
 * poll because the token lives an hour — and then polls the Firestore Admin
 * API every 15 seconds until no index is left in a non-READY state. Zero
 * dependencies on purpose: node:crypto signs the assertion and Node's global
 * fetch does the rest, so the deploy job installs nothing extra.
 *
 * Outcomes: every index READY → exit 0. A 401/403 (at either the mint or the
 * poll) or a NEEDS_REPAIR index → exit 1 immediately, because no amount of
 * waiting changes either; a 400 or 404 at the poll fails the same way, since
 * a wrong path or a rejected wildcard is a request the API will never accept
 * no matter how long this waits. 5xx, 429 and network errors → logged and
 * retried inside the budget; each request is itself bounded so one hung
 * socket cannot stretch that budget. The budget expiring → exit 1, naming
 * whichever is true — what is still building, that the index list was never
 * read, or that a token was never obtained — and where to watch it.
 *
 * INDEX_WAIT_TIMEOUT_MS, INDEX_WAIT_INTERVAL_MS and INDEX_WAIT_BASE_URL
 * override the bound, the interval and the API origin. `--self-test`
 * exercises the pure classification and deadline math, signs and verifies a
 * throwaway assertion, and then drives the real main() as a child process
 * against a node:http stub bound to 127.0.0.1 — the whole token-and-poll
 * loop, offline, with real exit codes. The ci job runs that self-test; the
 * live proof is the next merge that deploys.
 */

import { spawn } from 'node:child_process';
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// SELF is the repo-root-relative form used in human-facing messages; the
// self-test's spawned child needs SCRIPT_PATH, an absolute path that still
// resolves wherever the child runs.
const SELF = 'scripts/wait-for-indexes.mjs';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKFLOW = '.github/workflows/ci.yml';
const DEPLOY_DOC = 'docs/deploy.md';
const PROJECT = 'home-accounter';
const DEFAULT_BASE_URL = 'https://firestore.googleapis.com';
const INDEXES_PATH = `/v1/projects/${PROJECT}/databases/(default)/collectionGroups/-/indexes`;
const CONSOLE_URL = `https://console.firebase.google.com/project/${PROJECT}/firestore/indexes`;
// Both scopes: datastore is what the Firestore Admin API checks, and
// cloud-platform is what the CLI's own credential path requests.
const SCOPES = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;
// A server that keeps handing back a nextPageToken (a loop, not real
// pagination) must not be allowed to page forever inside one poll attempt.
const MAX_INDEX_PAGES = 50;

// ---------------------------------------------------------------------------
// Pure: everything the self-test can judge without a network or a clock.
// ---------------------------------------------------------------------------

/** Flattens the paginated list responses; a page with no `indexes` key holds none. */
function indexesOf(pages) {
  return pages.flatMap(page => (Array.isArray(page?.indexes) ? page.indexes : []));
}

/**
 * Names an index the way a human reading the console index list can match it:
 * its collection group and its fields. `__name__` is dropped — Firestore adds
 * it to every composite index and it identifies nothing.
 */
function indexLabel(index) {
  const name = typeof index?.name === 'string' ? index.name : '';
  const match = /collectionGroups\/([^/]+)\/indexes\/(.+)$/.exec(name);
  const group = match ? match[1] : '(unknown collection)';
  const fields = (Array.isArray(index?.fields) ? index.fields : [])
    .filter(field => field?.fieldPath && field.fieldPath !== '__name__')
    .map(field => `${field.fieldPath} ${field.order ?? field.arrayConfig ?? ''}`.trim())
    .join(', ');
  if (fields) return `${group} (${fields})`;
  return match ? `${group}/${match[2]}` : name || '(unnamed index)';
}

/**
 * Splits the list into what is worth waiting for and what never resolves.
 * READY is done and NEEDS_REPAIR is fatal; everything else — CREATING,
 * STATE_UNSPECIFIED, a state this file has never heard of — counts as still
 * building, so an unfamiliar state can only ever cost time, never let an
 * unbuilt index pass as verified.
 */
function classifyIndexes(pages) {
  const building = [];
  const needsRepair = [];
  for (const index of indexesOf(pages)) {
    if (index?.state === 'READY') continue;
    if (index?.state === 'NEEDS_REPAIR') needsRepair.push(indexLabel(index));
    else building.push(indexLabel(index));
  }
  return { building, needsRepair };
}

/**
 * How long to sleep before the next poll, or null when the budget is spent.
 * The last wait is clamped to what is left so the loop reports its timeout at
 * the bound rather than one whole interval past it.
 */
function nextPollDelay(now, deadline, interval) {
  const remaining = deadline - now;
  if (remaining <= 0) return null;
  return Math.min(interval, remaining);
}

/**
 * Whether the pagination loop has accumulated enough pages that fetching
 * another one — because the last page still carried a nextPageToken — would
 * exceed the cap. A server looping the same token back forever must cost
 * this loop at most `cap` requests, never all of them.
 */
function exceedsPageCap(pageCount, cap) {
  return pageCount >= cap;
}

/**
 * The per-request abort bound for both fetch call sites: generous enough
 * not to fire on an ordinary response, short enough that one hung socket
 * cannot by itself stretch the whole wait budget.
 */
function fetchTimeoutFor(intervalMs) {
  return Math.max(5000, Math.min(intervalMs * 2, 30_000));
}

/** An override is opt-in; a typo in one is a mistake worth failing on, not defaulting past. */
function parseMillis(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name}=${JSON.stringify(raw)} is not a number of milliseconds.`);
  }
  return value;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

/**
 * The service-account JWT the token endpoint trades for an access token.
 * `iat` is backdated 30 seconds so a runner clock running slightly fast
 * cannot have Google reject an assertion issued in its own future.
 */
function signJwt({ clientEmail, privateKey, tokenUri, now }) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iss: clientEmail, scope: SCOPES, aud: tokenUri, iat: now - 30, exp: now + 3600 })
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

// ---------------------------------------------------------------------------
// The messages every failure path prints.
// ---------------------------------------------------------------------------

const SHIPPED_BUT_UNVERIFIED =
  `The deploy itself already ran — hosting, the rules and the index definitions\n` +
  `are live. Only the index builds are unconfirmed, so this is shipped but\n` +
  `unverified, not a failed release.`;

function authFailureMessage(status, phase, detail) {
  return (
    `Refused with HTTP ${status} while ${phase}.\n\n` +
    `${SHIPPED_BUT_UNVERIFIED}\n\n` +
    `${status} is an IAM answer rather than a transient one, so this fails now\n` +
    `instead of retrying until the budget runs out. Reading index state needs\n` +
    `roles/datastore.indexAdmin, which the deploy service account already holds\n` +
    `for the deploy itself. Follow the grant procedure in ${DEPLOY_DOC} ("The\n` +
    `service account"): read the error below, grant or enable exactly what it\n` +
    `names, then re-run this job.\n\n` +
    `${detail}\n`
  );
}

/**
 * The poll's 400/404 answer: a request the Firestore Admin API rejects
 * outright — a wrong path, a malformed collection-group wildcard — rather
 * than a permissions problem authFailureMessage covers. Waiting cannot fix a
 * request the server will never accept, so this fails now instead of
 * reading like a build timeout after burning the whole budget.
 */
function badRequestMessage(status, path, detail) {
  return (
    `Refused with HTTP ${status} requesting ${path}.\n\n` +
    `${SHIPPED_BUT_UNVERIFIED}\n\n` +
    `${status} means the Firestore Admin API rejected the request itself — a\n` +
    `wrong path or a query it would never accept, such as a malformed\n` +
    `collection-group wildcard — not a permissions problem and not something\n` +
    `more waiting fixes, so this fails now instead of burning the full budget\n` +
    `and then reading like a build timeout.\n\n` +
    `${detail}\n`
  );
}

function needsRepairMessage(names) {
  return (
    `Firestore reports composite indexes in NEEDS_REPAIR:\n` +
    `${names.map(name => `  - ${name}`).join('\n')}\n\n` +
    `NEEDS_REPAIR never becomes READY on its own, so waiting cannot help. Such\n` +
    `an index has to be deleted and rebuilt, which is a deliberate local act\n` +
    `with --force (${DEPLOY_DOC}, "Index deletions never happen from CI").\n\n` +
    `${SHIPPED_BUT_UNVERIFIED}\n`
  );
}

/**
 * `building` is null when no poll ever came back successfully — every
 * attempt was a transient failure and the deadline still ran out. That is a
 * different situation from watching real indexes sit in CREATING, so the
 * headline says which one happened instead of defaulting to "still
 * building" when the index list itself was never read.
 */
function timeoutMessage(building, timeoutMs) {
  const neverRead = building === null;
  const headline = neverRead
    ? `Timed out after ${formatDuration(timeoutMs)}: the Firestore composite index list was never read successfully.`
    : `Timed out after ${formatDuration(timeoutMs)} waiting for Firestore composite indexes to finish building.`;
  const list = neverRead
    ? `  (the index list was never read successfully — see the errors above)`
    : building.map(name => `  - ${name}`).join('\n');
  return (
    `${headline}\n\n` +
    `Still building:\n${list}\n\n` +
    `${SHIPPED_BUT_UNVERIFIED}\n\n` +
    `A query that needs one of the entries above can still fail with\n` +
    `failed-precondition until its build completes.\n\n` +
    `Watch them at:\n  ${CONSOLE_URL}\n\n` +
    `Re-run this job once every entry reads Enabled — re-deploying identical content is safe.\n`
  );
}

/**
 * The mint's own timeout: the budget ran out before any token was ever
 * obtained, so no index state was ever read. Deliberately not
 * timeoutMessage's headline — "still building" would claim knowledge this
 * path never had.
 */
function tokenTimeoutMessage(timeoutMs, lastAttempt) {
  const last =
    lastAttempt && lastAttempt.status === 0
      ? `could not be reached (${lastAttempt.detail})`
      : lastAttempt
        ? `answered HTTP ${lastAttempt.status}`
        : 'never answered';
  return (
    `Timed out after ${formatDuration(timeoutMs)}: the token was never obtained, so no index\n` +
    `state was ever read.\n\n` +
    `${SHIPPED_BUT_UNVERIFIED}\n\n` +
    `The token endpoint last ${last}. 5xx and network errors there are retried\n` +
    `inside this same budget, the same as a poll failure — this is that budget\n` +
    `running out before the mint ever succeeded, not an index build problem.\n\n` +
    `Re-run this job once the token endpoint is reachable again.\n`
  );
}

/**
 * MAX_INDEX_PAGES tripped: the Admin API kept answering with a
 * nextPageToken past the cap. A server looping the same token is far more
 * likely than a project with this many composite indexes, so this fails
 * outright rather than paging forever inside one poll attempt.
 */
function pageCapMessage(pageCount, cap) {
  return (
    `Gave up listing composite indexes after ${pageCount} pages (cap: ${cap}).\n\n` +
    `${SHIPPED_BUT_UNVERIFIED}\n\n` +
    `The Firestore Admin API kept handing back a nextPageToken past the cap.\n` +
    `A server looping the same token is far more likely than a project with\n` +
    `this many composite indexes, so this fails now instead of paging forever\n` +
    `inside a single poll attempt.\n\n` +
    `Watch the index list directly at:\n  ${CONSOLE_URL}\n`
  );
}

// ---------------------------------------------------------------------------
// Effectful shell.
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(message);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Best-effort error body for a failure message; never the reason a failure goes unreported. */
async function readDetail(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '(no response body)';
  }
}

/**
 * Reads the service-account key google-github-actions/auth wrote. Only the
 * three fields the token flow needs are touched, and none of them is ever
 * printed — a failure names the field, never its value.
 */
function readCredentials() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    fail(
      `GOOGLE_APPLICATION_CREDENTIALS is not set.\n\n` +
        `${SELF} runs inside deploy-web, after the "Authenticate to Google Cloud"\n` +
        `step exports it (${WORKFLOW}). It has no other way to reach the Firestore\n` +
        `Admin API, and it is deliberately not something to point at production\n` +
        `from a laptop.\n`
    );
  }

  // V8's JSON.parse SyntaxError embeds a fragment of the input it choked on
  // ("Unexpected token 'x', "...fragment..." is not valid JSON") — and this
  // file can hold a private key. Swallow the parse error itself, unread and
  // unlogged, so that property holds unconditionally, not just when the
  // file happens to be well-formed.
  let credentials;
  try {
    credentials = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(
      `The credentials file at ${path} is not valid JSON.\n\n` +
        `google-github-actions/auth should have written well-formed JSON to\n` +
        `GOOGLE_APPLICATION_CREDENTIALS. Re-check the FIREBASE_SERVICE_ACCOUNT\n` +
        `secret against ${DEPLOY_DOC}.\n`
    );
  }
  const missing = ['client_email', 'private_key', 'token_uri'].filter(
    field => typeof credentials[field] !== 'string' || credentials[field] === ''
  );
  if (missing.length > 0) {
    fail(
      `The credentials file at GOOGLE_APPLICATION_CREDENTIALS is missing: ${missing.join(', ')}.\n\n` +
        `A service-account key JSON carries all three. Re-check the\n` +
        `FIREBASE_SERVICE_ACCOUNT secret against ${DEPLOY_DOC}.\n`
    );
  }
  return credentials;
}

/**
 * One attempt at the token that carries the whole wait: it is valid for an
 * hour and the bound is ten minutes, so once minted it cannot expire
 * underneath the poll loop. Returns {ok:true, token} on success or
 * {ok:false, status, detail} for a 5xx or a network failure — status 0 for
 * the latter — so the caller can retry inside the shared budget exactly as
 * it does for a poll attempt. A 401/403 and any other non-ok status are
 * fatal immediately: neither is something retrying fixes.
 */
async function attemptMintToken(credentials, fetchTimeoutMs) {
  const assertion = signJwt({
    clientEmail: credentials.client_email,
    privateKey: credentials.private_key,
    tokenUri: credentials.token_uri,
    now: Math.floor(Date.now() / 1000),
  });

  let response;
  try {
    response = await fetch(credentials.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }),
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 0, detail: err?.message ?? String(err) };
  }

  if (!response.ok) {
    const detail = await readDetail(response);
    if (response.status === 401 || response.status === 403) {
      fail(authFailureMessage(response.status, 'minting an access token', detail));
    }
    if (response.status >= 500 && response.status < 600) {
      return { ok: false, status: response.status, detail };
    }
    fail(`The token endpoint answered HTTP ${response.status}.\n\n${SHIPPED_BUT_UNVERIFIED}\n\n${detail}\n`);
  }

  const payload = await response.json();
  if (typeof payload?.access_token !== 'string' || payload.access_token === '') {
    fail(`The token endpoint answered 200 with no access_token.\n\n${SHIPPED_BUT_UNVERIFIED}\n`);
  }
  return { ok: true, token: payload.access_token };
}

/**
 * One full listing: follows nextPageToken to the end, because a partial page
 * would classify the indexes it never saw as READY by omission — capped at
 * MAX_INDEX_PAGES so a server looping the same token back cannot page
 * forever inside this one call. A failure carries `path` (the pathname and
 * query actually requested) so a 400/404 message can name it.
 */
async function fetchIndexPages(baseUrl, token, fetchTimeoutMs) {
  const pages = [];
  let pageToken = null;
  do {
    const url = new URL(`${baseUrl}${INDEXES_PATH}`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const path = `${url.pathname}${url.search}`;

    let page;
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (!response.ok) {
        return { ok: false, status: response.status, detail: await readDetail(response), path };
      }
      page = await response.json();
    } catch (err) {
      return { ok: false, status: 0, detail: err?.message ?? String(err), path };
    }

    pages.push(page);
    pageToken = typeof page?.nextPageToken === 'string' && page.nextPageToken !== '' ? page.nextPageToken : null;
    if (pageToken && exceedsPageCap(pages.length, MAX_INDEX_PAGES)) {
      return { ok: false, pageCapExceeded: true, pageCount: pages.length };
    }
  } while (pageToken);
  return { ok: true, pages };
}

async function main() {
  const timeoutMs = parseMillis(process.env.INDEX_WAIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'INDEX_WAIT_TIMEOUT_MS');
  const intervalMs = parseMillis(process.env.INDEX_WAIT_INTERVAL_MS, DEFAULT_INTERVAL_MS, 'INDEX_WAIT_INTERVAL_MS');
  const baseUrl = (process.env.INDEX_WAIT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchTimeoutMs = fetchTimeoutFor(intervalMs);
  const credentials = readCredentials();

  // The budget starts here, above the mint, so a token that only comes back
  // after a couple of transient retries still leaves the poll loop the rest
  // of the same ten minutes rather than a fresh one bolted on afterward.
  const started = Date.now();
  const deadline = started + timeoutMs;

  let token;
  for (;;) {
    const attempt = await attemptMintToken(credentials, fetchTimeoutMs);
    if (attempt.ok) {
      token = attempt.token;
      break;
    }
    const what = attempt.status === 0 ? `could not be reached (${attempt.detail})` : `answered HTTP ${attempt.status}`;
    console.log(`  the token endpoint ${what} after ${formatDuration(Date.now() - started)} — retrying.`);

    const mintDelay = nextPollDelay(Date.now(), deadline, intervalMs);
    if (mintDelay === null) fail(tokenTimeoutMessage(timeoutMs, attempt));
    await sleep(mintDelay);
  }

  let lastBuilding = null;

  console.log(
    `Waiting for Firestore composite indexes on ${PROJECT}: polling every ${formatDuration(intervalMs)}, ` +
      `up to ${formatDuration(timeoutMs)}.`
  );

  for (;;) {
    const result = await fetchIndexPages(baseUrl, token, fetchTimeoutMs);
    const elapsed = Date.now() - started;

    if (result.ok) {
      const { building, needsRepair } = classifyIndexes(result.pages);
      if (needsRepair.length > 0) fail(needsRepairMessage(needsRepair));

      if (building.length === 0) {
        const total = indexesOf(result.pages).length;
        console.log(
          total === 0
            ? `No composite indexes exist on ${PROJECT} — nothing to wait for.`
            : `All ${total} Firestore composite indexes are READY (waited ${formatDuration(elapsed)}).`
        );
        return;
      }

      lastBuilding = building;
      console.log(`  still building after ${formatDuration(elapsed)} (${building.length}): ${building.join('; ')}`);
    } else if (result.pageCapExceeded) {
      fail(pageCapMessage(result.pageCount, MAX_INDEX_PAGES));
    } else if (result.status === 401 || result.status === 403) {
      fail(authFailureMessage(result.status, 'listing composite indexes', result.detail));
    } else if (result.status === 400 || result.status === 404) {
      fail(badRequestMessage(result.status, result.path, result.detail));
    } else {
      // Transient by assumption: a 5xx, a 429 or a dropped connection says
      // nothing about the builds, so it costs one interval rather than the
      // job.
      const what = result.status === 0 ? `could not be reached (${result.detail})` : `answered HTTP ${result.status}`;
      console.log(`  the Firestore Admin API ${what} after ${formatDuration(elapsed)} — retrying.`);
    }

    const delay = nextPollDelay(Date.now(), deadline, intervalMs);
    if (delay === null) fail(timeoutMessage(lastBuilding, timeoutMs));
    await sleep(delay);
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const STUB_ACCESS_TOKEN = 'stub-access-token-4f21';
const FIXTURE_INDEX_NAME = `projects/${PROJECT}/databases/(default)/collectionGroups/transactions/indexes/CICAgJi0mYEK`;
const FIXTURE_INDEX_LABEL = 'transactions (userId ASCENDING, date DESCENDING)';

function fixtureIndex(state, name = FIXTURE_INDEX_NAME) {
  return {
    name,
    queryScope: 'COLLECTION',
    state,
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'date', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  };
}

/**
 * A node:http stand-in for both Google endpoints, bound to 127.0.0.1 on an
 * ephemeral port. It records every request so the caller can assert on what
 * the script actually sent, and it is the only host the self-test ever talks
 * to — nothing here reaches a real Google endpoint.
 */
async function withStubServer(behavior, body) {
  const requests = { token: [], indexes: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let payload = '';
    req.on('data', chunk => {
      payload += chunk;
    });
    req.on('end', () => {
      if (url.pathname === '/token') {
        requests.token.push({ contentType: req.headers['content-type'] ?? '', body: payload });
        const status =
          (typeof behavior.tokenStatus === 'function' ? behavior.tokenStatus(requests.token.length) : behavior.tokenStatus) ??
          200;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            status === 200
              ? { access_token: STUB_ACCESS_TOKEN, expires_in: 3600, token_type: 'Bearer' }
              : status >= 500
                ? { error: 'unavailable', error_description: 'stub is briefly unavailable' }
                : { error: 'unauthorized_client', error_description: 'stub refuses this grant' }
          )
        );
        return;
      }
      if (url.pathname.endsWith('/indexes')) {
        const pageToken = url.searchParams.get('pageToken');
        requests.indexes.push({ authorization: req.headers.authorization ?? '', pageToken });
        const status = behavior.indexStatus?.(requests.indexes.length) ?? 200;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          status === 200
            ? JSON.stringify(behavior.indexes(requests.indexes.length, pageToken))
            : JSON.stringify({ error: { code: status, message: 'stub is briefly unavailable' } })
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await body(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

/**
 * Runs this file as a real child process — never this process's own
 * functions — so argv dispatch, the exit code and the printed text are the
 * real ones. stdio is piped so the deliberately-failing legs cannot bleed
 * their child's stderr into this self-test's own output. The three env seams
 * are cleared before the leg's own values go in, so a value left in the
 * developer's shell cannot change what a leg proves.
 */
function runScript(overrides) {
  const env = { ...process.env };
  for (const key of ['INDEX_WAIT_TIMEOUT_MS', 'INDEX_WAIT_INTERVAL_MS', 'INDEX_WAIT_BASE_URL']) {
    delete env[key];
  }
  Object.assign(env, overrides);
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('close', code => resolve({ code, stdout, stderr, output: `${stdout}${stderr}` }));
  });
}

/**
 * Boots the stub, points the script at it through the same env seams CI uses,
 * and drives the whole thing end to end: a real signed assertion, a real
 * token exchange, a real paginated poll loop, real exit codes — and never a
 * packet off 127.0.0.1. The key is generated here and lives in a tmpdir that
 * is removed on the way out.
 */
async function selfTestStubServerVectors(check) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const root = mkdtempSync(join(tmpdir(), 'wait-for-indexes-'));

  try {
    const credentialsPath = join(root, 'service-account.json');
    const writeCredentials = stubUrl =>
      writeFileSync(
        credentialsPath,
        JSON.stringify({
          type: 'service_account',
          project_id: PROJECT,
          client_email: 'stub-deploy@home-accounter.iam.gserviceaccount.com',
          private_key: privateKey,
          token_uri: `${stubUrl}/token`,
        })
      );

    // Leg 1 — CREATING on the first poll, READY across two pages on the second.
    const finishes = {
      indexes: (call, pageToken) => {
        if (call === 1) return { indexes: [fixtureIndex('CREATING')] };
        if (pageToken === 'page-2') return { indexes: [fixtureIndex('READY', `${FIXTURE_INDEX_NAME}2`)] };
        return { indexes: [fixtureIndex('READY')], nextPageToken: 'page-2' };
      },
    };
    await withStubServer(finishes, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
      });
      check('a build that finishes exits 0 over the real spawn path', result.code, 0);
      check(
        'the success line reports how many indexes were confirmed',
        /All 2 Firestore composite indexes are READY/.test(result.stdout),
        true
      );
      check('the token endpoint was called exactly once', requests.token.length, 1);
      const form = new URLSearchParams(requests.token[0]?.body ?? '');
      check(
        'the token request is a form-encoded JWT bearer grant',
        requests.token[0]?.contentType.includes('application/x-www-form-urlencoded') &&
          form.get('grant_type') === JWT_BEARER_GRANT,
        true
      );
      const [header, claims, signature] = (form.get('assertion') ?? '').split('.');
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${header}.${claims}`);
      check(
        'the assertion the script sent verifies against the fixture key',
        verifier.verify(publicKey, Buffer.from(signature ?? '', 'base64url')),
        true
      );
      const sentClaims = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8') || '{}');
      check('the assertion asks for both scopes', sentClaims.scope, SCOPES);
      check('the assertion is addressed to the credentials file token_uri', sentClaims.aud, `${stubUrl}/token`);
      check(
        'every poll carried the token the stub issued',
        requests.indexes.length > 0 &&
          requests.indexes.every(request => request.authorization === `Bearer ${STUB_ACCESS_TOKEN}`),
        true
      );
      check('it followed nextPageToken instead of stopping at page one', requests.indexes.length, 3);
      check('the second poll asked for the second page', requests.indexes[2]?.pageToken, 'page-2');
    });

    // Leg 2 — never finishes; the bound must fire and name what is stuck.
    const neverFinishes = { indexes: () => ({ indexes: [fixtureIndex('CREATING')] }) };
    await withStubServer(neverFinishes, async stubUrl => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
        INDEX_WAIT_TIMEOUT_MS: '50',
      });
      check('an index that never finishes fails the job', result.code, 1);
      check('the timeout names the index still building', result.output.includes(FIXTURE_INDEX_LABEL), true);
      check('the timeout points at the console index list', result.output.includes(CONSOLE_URL), true);
      check(
        'the timeout says a re-run is safe',
        result.output.includes('once every entry reads Enabled — re-deploying identical content is safe'),
        true
      );
    });

    // Leg 3 — a 5xx is worth one interval, not the job; a NEEDS_REPAIR index
    // is worth neither. The pair in one leg also pins the dangerous misread:
    // an unreadable poll treated as an empty index list would report every
    // index READY and pass.
    const flakesThenRepairs = {
      indexStatus: call => (call === 1 ? 503 : 200),
      indexes: () => ({ indexes: [fixtureIndex('NEEDS_REPAIR')] }),
    };
    await withStubServer(flakesThenRepairs, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
        INDEX_WAIT_TIMEOUT_MS: '2000',
      });
      check('a 5xx costs one interval, not the job', requests.indexes.length, 2);
      check('an unreadable poll is never mistaken for an empty index list', /are READY/.test(result.stdout), false);
      check('a NEEDS_REPAIR index fails the job', result.code, 1);
      check('the NEEDS_REPAIR failure names the index', result.output.includes(FIXTURE_INDEX_LABEL), true);
      check('the NEEDS_REPAIR failure says waiting cannot help', result.output.includes('NEEDS_REPAIR'), true);
    });

    // Leg 4 — a refused grant must fail now, not after burning the budget.
    const refusesTheGrant = { tokenStatus: 403, indexes: () => ({}) };
    await withStubServer(refusesTheGrant, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
      });
      check('a refused grant fails the job', result.code, 1);
      check('the refusal names the status', result.output.includes('403'), true);
      check('the refusal points at the grant procedure', result.output.includes(DEPLOY_DOC), true);
      check('a refused grant never starts polling', requests.indexes.length, 0);
    });

    // Leg 5 — the token endpoint answers 5xx once, then succeeds; the mint
    // must retry inside the shared budget instead of failing outright.
    const mintFlakesThenSucceeds = {
      tokenStatus: call => (call === 1 ? 503 : 200),
      indexes: () => ({ indexes: [fixtureIndex('READY')] }),
    };
    await withStubServer(mintFlakesThenSucceeds, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
      });
      check('a token mint that flakes once still succeeds inside the budget', result.code, 0);
      check('the token endpoint was retried after its 5xx', requests.token.length, 2);
      check('polling only began once a token was actually minted', requests.indexes.length, 1);
    });

    // Leg 6 — the token endpoint never recovers; the shared budget must
    // expire during minting, with a headline distinct from "still building"
    // and without ever starting to poll.
    const mintNeverRecovers = { tokenStatus: 503, indexes: () => ({ indexes: [fixtureIndex('READY')] }) };
    await withStubServer(mintNeverRecovers, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
        INDEX_WAIT_TIMEOUT_MS: '50',
      });
      check('a token mint that never recovers fails the job', result.code, 1);
      check(
        'the mint timeout says the token was never obtained',
        result.output.includes('the token was never obtained'),
        true
      );
      check(
        'the mint timeout is not the indexes-still-building headline',
        result.output.includes('waiting for Firestore composite indexes to finish building'),
        false
      );
      check('a token that never mints never starts polling', requests.indexes.length, 0);
    });

    // Leg 7 — a 404 at the poll (wrong path, rejected wildcard) must fail
    // now instead of being mistaken for transient, burning the whole budget
    // and then reading like a build timeout.
    const pollRejectsThePath = { indexStatus: () => 404, indexes: () => ({}) };
    await withStubServer(pollRejectsThePath, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
        INDEX_WAIT_TIMEOUT_MS: '5000',
      });
      check('a 404 at the poll fails the job immediately', result.code, 1);
      check('the 404 failure names the status', result.output.includes('HTTP 404'), true);
      check('the 404 failure names the URL path', result.output.includes(INDEXES_PATH), true);
      check('a 404 is never treated as an IAM problem', result.output.includes('roles/datastore.indexAdmin'), false);
      check('a 404 at the poll costs exactly one attempt, not the budget', requests.indexes.length, 1);
    });

    // Leg 8 — the poll never once succeeds (a persistent 5xx); lastBuilding
    // stays null the whole run, so the timeout headline must say the index
    // list was never read rather than defaulting to "still building".
    const pollNeverSucceeds = { indexStatus: () => 503, indexes: () => ({ indexes: [fixtureIndex('READY')] }) };
    await withStubServer(pollNeverSucceeds, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
        INDEX_WAIT_TIMEOUT_MS: '50',
      });
      check('a poll that never once succeeds fails the job', result.code, 1);
      check(
        'the timeout headline says the index list was never read, not "still building"',
        result.output.includes('the Firestore composite index list was never read successfully'),
        true
      );
      check(
        'the never-read timeout does not use the still-building headline',
        result.output.includes('waiting for Firestore composite indexes to finish building'),
        false
      );
      check(
        'the never-read timeout still carries the see-errors-above body line',
        result.output.includes('see the errors above'),
        true
      );
    });

    // Leg 9 — a server that always hands back a nextPageToken must not spin
    // forever inside one poll; the cap aborts the listing as its own
    // failure rather than paging indefinitely.
    const loopsForever = { indexes: () => ({ indexes: [fixtureIndex('CREATING')], nextPageToken: 'again' }) };
    await withStubServer(loopsForever, async (stubUrl, requests) => {
      writeCredentials(stubUrl);
      const result = await runScript({
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
        INDEX_WAIT_BASE_URL: stubUrl,
        INDEX_WAIT_INTERVAL_MS: '10',
        INDEX_WAIT_TIMEOUT_MS: '60000',
      });
      check('a looping nextPageToken fails the job rather than spinning', result.code, 1);
      check('the page-cap failure names the cap', result.output.includes('cap: 50'), true);
      check('the pagination stopped exactly at the cap', requests.indexes.length, 50);
    });

    // Leg 10 — invalid JSON in the credentials file must fail cleanly,
    // naming the path, and must never let V8's SyntaxError text (which can
    // embed a fragment of the file — and this file can hold a private key)
    // reach the log.
    const badJsonPath = join(root, 'bad-credentials.json');
    const secretLeakMarker = 'SECRETLEAKMARKER_9f3c';
    writeFileSync(badJsonPath, secretLeakMarker);
    const badJsonResult = await runScript({
      GOOGLE_APPLICATION_CREDENTIALS: badJsonPath,
      INDEX_WAIT_BASE_URL: 'http://127.0.0.1:1',
      INDEX_WAIT_TIMEOUT_MS: '1000',
    });
    check('invalid JSON in the credentials file fails the job', badJsonResult.code, 1);
    check('the invalid-JSON failure names the path', badJsonResult.output.includes(badJsonPath), true);
    check('the invalid-JSON failure says so in plain words', badJsonResult.output.includes('is not valid JSON'), true);
    check(
      "the invalid-JSON failure never echoes V8's SyntaxError text",
      badJsonResult.output.includes('Unexpected token'),
      false
    );
    check(
      'the invalid-JSON failure never leaks a fragment of the file content',
      badJsonResult.output.includes(secretLeakMarker.slice(0, 10)),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }

  // Classification.
  const allReady = classifyIndexes([{ indexes: [fixtureIndex('READY'), fixtureIndex('READY')] }]);
  check('all-READY pages leave nothing building', allReady, { building: [], needsRepair: [] });

  const creating = classifyIndexes([{ indexes: [fixtureIndex('READY'), fixtureIndex('CREATING')] }]);
  check('a CREATING index counts as building', creating.building.length, 1);
  check('a building index is named by collection group and fields', creating.building[0], FIXTURE_INDEX_LABEL);

  const unknown = classifyIndexes([{ indexes: [fixtureIndex('STATE_UNSPECIFIED'), fixtureIndex('SOMETHING_NEW')] }]);
  check('an unknown state counts as building, never as done', unknown.building.length, 2);

  const repair = classifyIndexes([{ indexes: [fixtureIndex('NEEDS_REPAIR')] }]);
  check('NEEDS_REPAIR is fatal, not building', repair.needsRepair.length, 1);
  check('NEEDS_REPAIR is kept out of the building list', repair.building.length, 0);

  const multiPage = classifyIndexes([
    { indexes: [fixtureIndex('CREATING')], nextPageToken: 'page-2' },
    { indexes: [fixtureIndex('CREATING'), fixtureIndex('READY')] },
  ]);
  check('pages merge into one verdict', multiPage.building.length, 2);

  check('an empty {} response means no composite indexes', classifyIndexes([{}]), { building: [], needsRepair: [] });
  check('an empty {} response counts zero indexes', indexesOf([{}]).length, 0);
  check('a nameless index still gets a label', indexLabel({ state: 'CREATING' }).length > 0, true);

  // Deadline math.
  check('a full interval fits while the budget is ample', nextPollDelay(1000, 100000, 15000), 15000);
  check('the last wait is clamped to the remaining budget', nextPollDelay(1000, 6000, 15000), 5000);
  check('a spent budget yields no further poll', nextPollDelay(6000, 6000, 15000), null);
  check('an overrun budget yields no further poll', nextPollDelay(9000, 6000, 15000), null);

  // The pagination page cap.
  check('below the cap, another page is still allowed', exceedsPageCap(49, 50), false);
  check('at the cap, another page is refused', exceedsPageCap(50, 50), true);
  check('past the cap, another page is refused', exceedsPageCap(51, 50), true);
  check('a cap of zero refuses immediately', exceedsPageCap(0, 0), true);

  // The per-request fetch bound.
  check('a short interval is floored at 5s so a fast poll keeps headroom', fetchTimeoutFor(10), 5000);
  check('a mid interval scales to twice itself', fetchTimeoutFor(15000), 30000);
  check('a long interval is capped at 30s so one socket cannot eat the budget', fetchTimeoutFor(60000), 30000);

  // Env seams.
  check('an unset override keeps the default', parseMillis(undefined, DEFAULT_TIMEOUT_MS, 'X'), DEFAULT_TIMEOUT_MS);
  check('an empty override keeps the default', parseMillis('', DEFAULT_INTERVAL_MS, 'X'), DEFAULT_INTERVAL_MS);
  check('a numeric override wins', parseMillis('50', DEFAULT_TIMEOUT_MS, 'X'), 50);
  let rejected = false;
  try {
    parseMillis('soon', DEFAULT_TIMEOUT_MS, 'INDEX_WAIT_TIMEOUT_MS');
  } catch {
    rejected = true;
  }
  check('a typo in an override fails loudly instead of silently defaulting', rejected, true);

  check('sub-second durations keep their milliseconds', formatDuration(50), '50ms');
  check('durations under a minute read in seconds', formatDuration(45000), '45s');
  check('longer durations read in minutes and seconds', formatDuration(DEFAULT_TIMEOUT_MS), '10m 0s');

  // The signed assertion.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const now = 1_700_000_000;
  const jwt = signJwt({
    clientEmail: 'stub-deploy@home-accounter.iam.gserviceaccount.com',
    privateKey,
    tokenUri: 'https://oauth2.googleapis.com/token',
    now,
  });
  check('the assertion is three base64url segments', /^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt), true);

  const [header, claims, signature] = jwt.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${claims}`);
  check(
    'the assertion verifies against its own public key',
    verifier.verify(publicKey, Buffer.from(signature, 'base64url')),
    true
  );
  check('the header declares RS256', JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).alg, 'RS256');

  const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
  check('the issuer is the service account', decoded.iss, 'stub-deploy@home-accounter.iam.gserviceaccount.com');
  check('the audience is the credentials file token_uri', decoded.aud, 'https://oauth2.googleapis.com/token');
  check('both scopes are requested', decoded.scope, SCOPES);
  check('iat is backdated 30 seconds against clock skew', decoded.iat, now - 30);
  check('exp is an hour out', decoded.exp, now + 3600);

  const tamperedClaims = base64url(JSON.stringify({ ...decoded, iss: 'someone-else' }));
  const tamperVerifier = createVerify('RSA-SHA256');
  tamperVerifier.update(`${header}.${tamperedClaims}`);
  check(
    'a tampered payload does not verify',
    tamperVerifier.verify(publicKey, Buffer.from(signature, 'base64url')),
    false
  );

  await selfTestStubServerVectors(check);

  const failed = cases.filter(c => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!c.ok) {
      console.error(`       expected ${JSON.stringify(c.expected)}`);
      console.error(`       actual   ${JSON.stringify(c.actual)}`);
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} self-test failure(s) — the index wait itself is broken.`);
    process.exit(1);
  }
  console.log(`wait-for-indexes self-test: ${cases.length} passed`);
}

try {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    await main();
  }
} catch (err) {
  console.error(`${SELF}: ${err?.stack ?? err}`);
  process.exit(1);
}
