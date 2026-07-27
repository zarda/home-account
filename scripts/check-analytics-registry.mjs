#!/usr/bin/env node
/**
 * Keeps docs/analytics.md honest about what the app actually reports to GA4.
 *
 * Three sets have to agree:
 *   1. the taxonomy in src/app/core/config/analytics-events.json,
 *   2. the AnalyticsService call sites under src/app,
 *   3. the registry table in docs/analytics.md.
 * A fourth pair is checked the same way — the routed paths in app.routes.ts
 * against the automatic screen_view table — because the iOS transport builds
 * screen names by hand and the table is the only place the two platforms are
 * stated to match.
 *
 * Without this, "where does this event come from" and "is this screen tagged"
 * are answerable only by grepping, and a renamed route or a deleted call site
 * leaves a row that documents something the app no longer does.
 *
 * What it deliberately cannot see:
 *   - Which parameters a call site actually passes. The payload is an object
 *     literal spanning lines, carrying conditionals and values computed from
 *     signals; a regex over it would fail more often than it would catch. The
 *     compiler enforces it (AnalyticsEventParams is derived from the taxonomy)
 *     and AnalyticsService drops anything outside the allowlist at runtime.
 *   - A tracking call whose method name is computed rather than written out.
 *     There are none today; the typed API makes them awkward to write.
 *   - Direct SDK use that bypasses AnalyticsService — the no-restricted-imports
 *     rule in eslint.config.js covers that.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const TAXONOMY = 'src/app/core/config/analytics-events.json';
const ROUTES = 'src/app/app.routes.ts';
const DOC = 'docs/analytics.md';
const SOURCE_DIR = 'src/app';

/**
 * Files that name events without being call sites: the service declares the
 * typed wrappers, and the taxonomy is the taxonomy. Counting them would make
 * every event look used and kill the dead-event check.
 */
const SKIP_PREFIXES = [
  'src/app/core/services/analytics.service.ts',
  'src/app/core/services/analytics-transport.ts',
  'src/app/core/services/analytics-screen-view.ts',
  'src/app/core/config/analytics-events.ts',
];

/** `analytics.trackReportView(` — the wrapper name is what identifies the event. */
const CALL_SITE = /\.(track[A-Z][A-Za-z0-9]*)\s*\(/g;

/** A registry row: | `event` | trigger | params | source | since | */
const TABLE_ROW =
  /^\|\s*`([a-z][a-z0-9_]*)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*([^|\s]+)\s*\|/;

/** `path: 'dashboard'` in the routes file. Redirects are filtered by the caller. */
const ROUTE_PATH = /path:\s*'([^']*)'/g;

const failures = [];

function fail(message, sites = []) {
  failures.push({ message, sites });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (/\.ts$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
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

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** trackReportView -> report_view */
function eventNameOf(method) {
  return method
    .replace(/^track/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function sliceBetween(text, marker) {
  const start = text.indexOf(`<!-- ${marker}:start -->`);
  const end = text.indexOf(`<!-- ${marker}:end -->`);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return { body: text.slice(start, end), offset: start };
}

// ---------------------------------------------------------------- taxonomy

const taxonomy = JSON.parse(readFileSync(TAXONOMY, 'utf8'));
const taxonomyEvents = Object.keys(taxonomy);

if (taxonomyEvents.length === 0) {
  console.error(`${TAXONOMY} declares no events. That is never a real state — check the file.`);
  process.exit(1);
}

for (const prefix of SKIP_PREFIXES) {
  if (!existsSync(prefix)) {
    console.error(
      `Skip path ${prefix} does not exist. A stale entry silently turns its ` +
        `internal event names into call sites — fix the list.`
    );
    process.exit(1);
  }
}

// -------------------------------------------------------------- call sites

/** event -> Set of `file:line` */
const callSites = new Map();
let unknownMethods = 0;

for (const file of walk(SOURCE_DIR)) {
  const normalized = relative('.', file);
  if (SKIP_PREFIXES.some(prefix => normalized === prefix)) {
    continue;
  }

  const text = blankComments(readFileSync(file, 'utf8'));
  CALL_SITE.lastIndex = 0;
  let match;
  while ((match = CALL_SITE.exec(text)) !== null) {
    const event = eventNameOf(match[1]);
    if (!taxonomyEvents.includes(event)) {
      // Some other track*() method on some other object. Counted so the
      // summary cannot quietly hide a renamed wrapper.
      unknownMethods++;
      continue;
    }
    const where = `${normalized}:${lineOf(text, match.index)}`;
    const seen = callSites.get(event) ?? new Set();
    seen.add(where);
    callSites.set(event, seen);
  }
}

// ------------------------------------------------------------------ tables

const doc = readFileSync(DOC, 'utf8');

const registry = sliceBetween(doc, 'analytics-registry');
if (!registry) {
  console.error(`${DOC} is missing the <!-- analytics-registry:start/end --> markers.`);
  process.exit(1);
}

/** event -> { params, source, since, line } */
const rows = new Map();
for (const line of registry.body.split('\n')) {
  const match = TABLE_ROW.exec(line);
  if (!match) continue;
  const [, event, , params, source, since] = match;
  rows.set(event, {
    params: params
      .split(',')
      .map(cell => cell.trim().replace(/`/g, ''))
      .filter(Boolean)
      .filter(cell => cell !== '—'),
    source: source
      .split(',')
      .map(cell => cell.trim().replace(/`/g, ''))
      .filter(Boolean),
    since: since.trim(),
    line: lineOf(doc, registry.offset + registry.body.indexOf(line)),
  });
}

if (rows.size === 0) {
  console.error(`${DOC} has the registry markers but no rows between them.`);
  process.exit(1);
}

// -------------------------------------------------------------- event checks

for (const event of taxonomyEvents) {
  const sites = callSites.get(event);
  const row = rows.get(event);

  if (!row) {
    fail(`${event} — in the taxonomy but not listed in ${DOC}`, [...(sites ?? [])]);
    continue;
  }

  if (!sites || sites.size === 0) {
    fail(`${event} — listed in ${DOC} but never sent from ${SOURCE_DIR}`, [`${DOC}:${row.line}`]);
    continue;
  }

  const declared = Object.keys(taxonomy[event].params);
  if (row.params.join(',') !== declared.join(',')) {
    fail(
      `${event} — Params column disagrees with the taxonomy\n` +
        `      ${DOC}:${row.line}   ${row.params.join(', ') || '—'}\n` +
        `      taxonomy            ${declared.join(', ') || '—'}`
    );
  }

  if (row.since !== taxonomy[event].since) {
    fail(
      `${event} — Since column says ${row.since}, taxonomy says ${taxonomy[event].since}`,
      [`${DOC}:${row.line}`]
    );
  }

  // Both directions: every listed file must contain a call site, and every
  // file containing one must be listed. One-directional checking lets a row
  // keep pointing at a file the tagging moved out of.
  const actual = new Set([...sites].map(site => site.split(':')[0]));
  const listed = new Set(row.source);
  const missing = [...actual].filter(file => !listed.has(file));
  const stale = [...listed].filter(file => !actual.has(file));

  if (missing.length > 0) {
    fail(`${event} — sent from files the Source column does not list`, missing);
  }
  if (stale.length > 0) {
    fail(`${event} — Source column lists files with no call site`, stale);
  }
}

for (const event of rows.keys()) {
  if (!taxonomyEvents.includes(event)) {
    fail(`${event} — listed in ${DOC} but absent from the taxonomy`, [
      `${DOC}:${rows.get(event).line}`,
    ]);
  }
}

// ------------------------------------------------------------- screen table

const screens = sliceBetween(doc, 'analytics-screens');
if (!screens) {
  console.error(`${DOC} is missing the <!-- analytics-screens:start/end --> markers.`);
  process.exit(1);
}

const routesText = readFileSync(ROUTES, 'utf8');
const routedPaths = new Set();
for (const line of routesText.split('\n')) {
  if (line.includes('redirectTo')) continue;
  ROUTE_PATH.lastIndex = 0;
  let match;
  while ((match = ROUTE_PATH.exec(line)) !== null) {
    // The layout route's empty path drops out of the screen name join, and the
    // wildcard only ever redirects, so neither is a reportable screen.
    if (match[1] === '' || match[1] === '**') continue;
    routedPaths.add(match[1]);
  }
}

const documentedScreens = new Set();
for (const line of screens.body.split('\n')) {
  const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
  if (match) documentedScreens.add(match[1]);
}

for (const path of routedPaths) {
  if (!documentedScreens.has(path)) {
    fail(`${path} — routed in ${ROUTES} but missing from the screen table`, [ROUTES]);
  }
}
for (const path of documentedScreens) {
  if (!routedPaths.has(path)) {
    fail(`${path} — in the screen table but not routed in ${ROUTES}`, [DOC]);
  }
}

// ------------------------------------------------------------------- report

console.log(
  `Checked ${taxonomyEvents.length} events ` +
    `(${unknownMethods} unrelated track*() call${unknownMethods === 1 ? '' : 's'} skipped) ` +
    `against ${rows.size} registry rows, ` +
    `and ${routedPaths.size} routed paths against ${documentedScreens.size} documented screens`
);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n`);
  for (const { message, sites } of failures) {
    console.error(`  ${message}`);
    for (const site of sites.sort()) {
      console.error(`      ${site}`);
    }
  }
  console.error(`\nUpdate ${DOC} and ${TAXONOMY} in the same commit as the tagging change.`);
  process.exit(1);
}

console.log(`Every analytics call site is registered in ${DOC}.`);
