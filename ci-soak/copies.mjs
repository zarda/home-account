// For one kept round: how many times each plan write was sent by the case,
// by the SDK and by Chrome, against how many times the emulator's rules
// evaluated it. More evaluations than sends is a copy the client never made.
// Usage: node copies.mjs <round-dir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TARGET = 'resolves a budget, a goal and a contribution each delivered twice';
const PLAN = /households\/[^/"\s]+\/(?:budgets|goals)\/[^/"\s]+(?:\/contributions\/[^/"\s]+)?/g;

const stripAnsi = text => text.replace(/(?:\x1b|\^\[)\[[0-9;]*[A-Za-z]/g, '');

/** The target case's trace entries from a zone's Karma log. */
export function traceOf(text) {
  const entries = [];
  const seen = new Set();
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const at = raw.indexOf('[soak-trace] ');
    if (at < 0) continue;
    let json = raw.slice(at + '[soak-trace] '.length).trim();
    if (json.endsWith("'")) json = json.slice(0, -1);
    json = json.replace(/\\'/g, "'");
    try {
      const entry = JSON.parse(json);
      const key = `${entry.t}|${entry.who}|${entry.what}|${JSON.stringify(entry.detail ?? null)}`;
      if (entry.spec === TARGET && !seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    } catch {
      // A line Karma cut or wrapped; skipped and counted below.
      entries.push({ unparsed: true });
    }
  }
  return entries;
}

/** Rules evaluations from the /requests recording, in [from, to]. */
export function evaluationsOf(text, from, to) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const time = Date.parse(event.time ?? event.rulesContext?.time ?? '') || event.received;
    if (!(time >= from && time <= to)) continue;
    const method = event.rulesContext?.method ?? event.method ?? '?';
    const paths = JSON.stringify(event.rulesContext ?? {}).match(PLAN) ?? [];
    // One request is evaluated in steps, each a separate event whose
    // granularAllowOutcomes grows by two entries; a request's first step has two.
    const steps = Array.isArray(event.granularAllowOutcomes) ? event.granularAllowOutcomes.length : 0;
    out.push({ time, method, outcome: event.outcome, steps, paths: [...new Set(paths)] });
  }
  return out;
}

/** Chrome's commit POSTs from a net log, each with its sends, restarts and errors. */
export function commitPostsOf(text) {
  let log;
  try {
    log = JSON.parse(text);
  } catch {
    // Chrome writes the file as it goes; one stopped mid-run lacks its tail.
    const cut = text.replace(/,\s*$/, '').replace(/,?\s*\{[^{}]*$/, '');
    try { log = JSON.parse(`${cut}]}`); } catch { return null; }
  }
  const types = Object.fromEntries(Object.entries(log.constants?.logEventTypes ?? {}).map(([name, id]) => [id, name]));
  const offset = Number(log.constants?.timeTickOffset ?? 0);
  const bySource = new Map();
  for (const event of log.events ?? []) {
    const id = event.source?.id;
    if (!bySource.has(id)) bySource.set(id, []);
    bySource.get(id).push({ ...event, name: types[event.type] ?? String(event.type), wall: Number(event.time) + offset });
  }
  const posts = [];
  for (const events of bySource.values()) {
    const start = events.find(event => event.name === 'URL_REQUEST_START_JOB' && String(event.params?.url ?? '').includes(':commit'));
    if (!start) continue;
    posts.push({
      start: start.wall,
      sends: events.filter(event => event.name === 'HTTP_TRANSACTION_SEND_REQUEST' && event.phase === 1).length,
      restarts: events.filter(event => event.name === 'HTTP_TRANSACTION_RESTART_AFTER_ERROR').length,
      errors: events.map(event => event.params?.net_error).filter(error => error !== undefined && error !== 0)
    });
  }
  return posts.sort((a, b) => a.start - b.start);
}

/** Per zone: the case's window, each plan write's sends against the server's requests, and Chrome's odd commit POSTs. */
export function analyse(dir) {
  const zones = [];
  for (const zone of ['ny', 'tokyo']) {
    const path = join(dir, `${zone}.log`);
    if (!existsSync(path)) continue;
    const trace = traceOf(readFileSync(path, 'utf8'));
    const parsed = trace.filter(entry => !entry.unparsed);
    const result = { zone, unparsed: trace.length - parsed.length, plans: [], posts: null, oddPosts: [], oddPostsAll: 0 };
    zones.push(result);
    if (!parsed.length) continue;
    result.from = Math.min(...parsed.map(entry => entry.t));
    result.to = Math.max(...parsed.map(entry => entry.t)) + 500;

    const counts = new Map();
    const row = plan => {
      if (!counts.has(plan)) counts.set(plan, { plan, deliveries: 0, sdkSends: 0, requests: [] });
      return counts.get(plan);
    };
    for (const entry of parsed) {
      if (/^commitOnline#\d+ start$/.test(entry.what) && Array.isArray(entry.detail)) {
        for (const op of entry.detail) for (const plan of String(op).match(PLAN) ?? []) row(plan).deliveries += 1;
      }
      if (entry.who === 'sdk' && /Sending RPC 'Commit'/.test(String(entry.detail))) {
        for (const plan of new Set(String(entry.detail).match(PLAN) ?? [])) row(plan).sdkSends += 1;
      }
    }
    const requestsPath = join(dir, 'requests.ndjson');
    const evaluations = existsSync(requestsPath) ? evaluationsOf(readFileSync(requestsPath, 'utf8'), result.from, result.to) : [];
    for (const evaluation of evaluations) {
      if (evaluation.method !== 'create' && evaluation.method !== 'update') continue;
      if (evaluation.steps > 2) continue;
      // A write's own path is the deepest plan path its context names.
      const own = [...evaluation.paths].sort((a, b) => b.length - a.length)[0];
      if (own) row(own).requests.push(evaluation.time);
    }
    result.plans = [...counts.values()].filter(plan => plan.deliveries > 0);

    const netPath = join(dir, `netlog-${zone}.json`);
    if (existsSync(netPath)) {
      const posts = commitPostsOf(readFileSync(netPath, 'utf8'));
      if (posts) {
        const odd = post => post.sends > 1 || post.restarts > 0 || post.errors.length > 0;
        const inCase = posts.filter(post => post.start >= result.from && post.start <= result.to);
        result.posts = inCase.length;
        result.oddPosts = inCase.filter(odd);
        result.oddPostsAll = posts.filter(odd).length;
      }
    }
  }
  return zones;
}

const extraOf = plan => Math.max(0, plan.requests.length - Math.max(plan.deliveries, plan.sdkSends));

function report(dir) {
  const lines = [];
  for (const zone of analyse(dir)) {
    if (zone.from === undefined) { lines.push(`## ${zone.zone}: no trace of the case`, ''); continue; }
    lines.push(`## ${zone.zone}: the case ran ${new Date(zone.from).toISOString()} – ${new Date(zone.to - 500).toISOString()} (${zone.unparsed} unparsed trace lines)`);
    lines.push('', '| Plan document | Case deliveries | SDK Commit sends | Server requests | Request start times |', '|---|---|---|---|---|');
    for (const plan of zone.plans) {
      const extra = extraOf(plan) ? ' **extra**' : '';
      const times = plan.requests.map(time => new Date(time).toISOString().slice(11, 23)).join(', ');
      lines.push(`| ${plan.plan.split('/').slice(2).join('/')} | ${plan.deliveries} | ${plan.sdkSends} | ${plan.requests.length}${extra} | ${times} |`);
    }
    if (zone.posts === null) lines.push('', 'Net log: none or unreadable.');
    else {
      lines.push('', `Net log: ${zone.posts} commit POSTs during the case; ${zone.oddPosts.length} sent more than once or with an error (${zone.oddPostsAll} in the whole run).`);
      for (const post of zone.oddPosts) lines.push(`- ${new Date(post.start).toISOString().slice(11, 23)}: sends ${post.sends}, restarts ${post.restarts}, net errors ${post.errors.join(' ') || 'none'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The counts the round table carries: extra server requests in the case, and re-sent commit POSTs. */
function counts(dir) {
  return Object.fromEntries(analyse(dir).map(zone => [zone.zone, {
    extra: zone.plans.reduce((sum, plan) => sum + extraOf(plan), 0),
    resent: zone.oddPosts.length,
    resentAll: zone.oddPostsAll
  }]));
}

const args = process.argv.slice(2);
if (args[0] === '--json' && args[1]) console.log(JSON.stringify(counts(args[1])));
else if (args[0]) console.log(report(args[0]));
