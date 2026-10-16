// The soak's arithmetic.
//   --header                              the round table's header row
//   --round <dir> <shard> <round> <arm>   one row per zone run the round reached
//   --summary <rounds.csv...>             a Markdown summary of every shard's table
//   --self-test                           checks the parsing and the arithmetic
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TARGET = 'resolves a budget, a goal and a contribution each delivered twice';
const COLUMNS = ['shard', 'round', 'arm', 'zone', 'result', 'executed', 'failed', 'target_failed', 'failing', 'gap_ms', 'trigger', 'extra_copies', 'resent_posts'];
const ZONES = [['ny', 'America/New_York'], ['tokyo', 'Asia/Tokyo']];

const stripAnsi = text => text.replace(/(?:\x1b|\^\[)\[[0-9;]*[A-Za-z]/g, '');

/** What one Karma run's log says: its totals, the cases that failed, and the gap before the target's refusal. */
export function readZoneLog(text) {
  const lines = stripAnsi(text).split(/\r?\n/);
  let total = null;
  const failing = [];
  const commits = [];
  let targetLine = -1;
  lines.forEach((line, index) => {
    const t = /TOTAL: (?:(\d+) FAILED, )?(\d+) SUCCESS/.exec(line);
    if (t) total = { failed: Number(t[1] ?? 0), succeeded: Number(t[2]) };
    const f = /^Chrome Headless [^)]*\) (.+) FAILED$/.exec(line.trim());
    if (f && !line.includes('Executed')) {
      const name = f[1];
      if (!failing.includes(name)) failing.push(name);
      if (name.endsWith(TARGET) && targetLine < 0) targetLine = index;
    }
    const c = /\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\][^\n]*RPC 'Commit' (0x[0-9a-f]+) failed with error/.exec(line);
    if (c && !commits.some(commit => commit.id === c[2])) commits.push({ index, id: c[2], t: Date.parse(c[1]) });
  });
  let gap = '';
  if (targetLine >= 0) {
    const before = commits.filter(commit => commit.index < targetLine);
    if (before.length >= 2) gap = String(before[before.length - 1].t - before[before.length - 2].t);
  }
  return { total, failing, targetFailed: targetLine >= 0, gap };
}

const csvCell = value => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
const csvRow = cells => cells.map(csvCell).join(',');

export function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cell); cell = ''; }
      else cell += ch;
    }
    cells.push(cell);
    rows.push(cells);
  }
  const [header, ...body] = rows;
  return body.filter(cells => cells.join(',') !== header.join(',')).map(cells => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

/** The rows for one round directory: New York always, Tokyo only once New York passed (the lane's &&). */
export function roundRows(dir, shard, round, arm) {
  const triggered = existsSync(join(dir, 'sidecar.ndjson')) && readFileSync(join(dir, 'sidecar.ndjson'), 'utf8').includes('"trigger"');
  // copies.json is written for traced rounds only (copies.mjs --json).
  const copies = existsSync(join(dir, 'copies.json')) ? JSON.parse(readFileSync(join(dir, 'copies.json'), 'utf8')) : {};
  const copyCells = zone => (copies[zone] ? [copies[zone].extra, copies[zone].resent] : ['', '']);
  const rows = [];
  for (const [zone] of ZONES) {
    const path = join(dir, `${zone}.log`);
    const zoneLog = existsSync(path) ? readZoneLog(readFileSync(path, 'utf8')) : null;
    if (!zoneLog || !zoneLog.total) {
      rows.push([shard, round, arm, zone, 'harness', '', '', '', '', '', triggered ? 'yes' : 'no', '', '']);
      break;
    }
    const { total, failing, targetFailed, gap } = zoneLog;
    const result = total.failed > 0 ? 'fail' : 'pass';
    rows.push([shard, round, arm, zone, result, total.failed + total.succeeded, total.failed, targetFailed ? 'yes' : 'no', failing.join(' | '), gap, triggered ? 'yes' : 'no', ...copyCells(zone)]);
    if (result !== 'pass') break;
  }
  return rows.map(csvRow).join('\n');
}

/** Wilson score interval for k of n at 95%. */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return { p: NaN, low: NaN, high: NaN };
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Rounds an unfixed tree failing at `rate` per round passes with at most 5% chance; never fewer than 50. */
export function roundsNeeded(rate, floor = 50) {
  if (!(rate > 0)) return Infinity;
  return Math.max(floor, Math.ceil(Math.log(0.05) / Math.log(1 - rate)));
}

const pct = value => (Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : 'n/a');

export function summarize(rows) {
  const arms = [...new Set(rows.map(row => row.arm))].sort();
  const out = ['# Lock soak', ''];
  out.push('| Arm | Rounds | Target failed (rounds) | Rate per round (95% Wilson) | New York exposures / target fails | Tokyo exposures / target fails | Other failures | Harness | Triggers | Zone runs with extra copies (of which target failed) | Re-sent commit POSTs |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const sizing = [];
  for (const arm of arms) {
    const armRows = rows.filter(row => row.arm === arm);
    const rounds = new Map();
    for (const row of armRows) {
      const key = `${row.shard}/${row.round}`;
      if (!rounds.has(key)) rounds.set(key, []);
      rounds.get(key).push(row);
    }
    const ran = [...rounds.values()].filter(group => group.some(row => row.zone === 'ny' && row.result !== 'harness'));
    const targetRounds = ran.filter(group => group.some(row => row.target_failed === 'yes')).length;
    const zone = name => {
      const reached = armRows.filter(row => row.zone === name && row.result !== 'harness');
      return `${reached.length} / ${reached.filter(row => row.target_failed === 'yes').length}`;
    };
    const other = armRows.filter(row => row.result === 'fail' && row.target_failed !== 'yes').length;
    const harness = armRows.filter(row => row.result === 'harness').length;
    const triggers = [...rounds.values()].filter(group => group.some(row => row.trigger === 'yes')).length;
    const w = wilson(targetRounds, ran.length);
    const traced = armRows.filter(row => row.extra_copies !== '' && row.extra_copies !== undefined);
    const withExtra = traced.filter(row => Number(row.extra_copies) > 0);
    const copyCell = traced.length ? `${withExtra.length} of ${traced.length} (${withExtra.filter(row => row.target_failed === 'yes').length})` : '–';
    const resent = traced.length ? String(traced.reduce((sum, row) => sum + Number(row.resent_posts || 0), 0)) : '–';
    out.push(`| ${arm} | ${ran.length} | ${targetRounds} | ${pct(w.p)} (${pct(w.low)}–${pct(w.high)}) | ${zone('ny')} | ${zone('tokyo')} | ${other} | ${harness} | ${triggers} | ${copyCell} | ${resent} |`);
    if (arm === 'plain' || arm === 'control') sizing.push({ arm, w });
  }
  out.push('');
  for (const { arm, w } of sizing) {
    const needed = roundsNeeded(w.low);
    out.push(`- **Proof size from \`${arm}\`:** the Wilson lower bound is ${pct(w.low)}, so N = ${Number.isFinite(needed) ? needed : 'not yet (no failures)'} rounds.`);
  }
  const failures = rows.filter(row => row.result === 'fail');
  if (failures.length) {
    out.push('', '| Arm | Shard | Round | Zone | Target | Gap (ms) | Failing cases |', '|---|---|---|---|---|---|---|');
    for (const row of failures) out.push(`| ${row.arm} | ${row.shard} | ${row.round} | ${row.zone} | ${row.target_failed} | ${row.gap_ms || '–'} | ${row.failing.replace(/\|/g, '/')} |`);
  }
  return out.join('\n');
}

function selfTest() {
  const assert = (condition, message) => { if (!condition) { console.error(`self-test failed: ${message}`); process.exit(1); } };
  const esc = '\x1b[1A\x1b[2K';
  const warn = (iso, id) => `WARN: '[${iso}]  @firebase/firestore:', 'Firestore (11.10.0): RestConnection', 'RPC 'Commit' ${id} failed with error: ', '{"code":"permission-denied"}'`;
  const pass = `Chrome Headless 154.0.0.0 (Linux 0.0.0): Executed 55 of 55 SUCCESS\nTOTAL: 55 SUCCESS\n`;
  const targetFail = [
    warn('2026-10-11T14:18:00.254Z', '0x84e12258'),
    warn('2026-10-11T14:18:00.254Z', '0x84e12258'),
    warn('2026-10-11T14:18:02.282Z', '0x84e1225c'),
    `${esc}Chrome Headless 154.0.0.0 (Linux 0.0.0) HouseholdPlansService (emulator smoke test) ${TARGET} FAILED`,
    'Chrome Headless 154.0.0.0 (Linux 0.0.0): Executed 29 of 55 (1 FAILED) (0 secs / 18.398 secs)',
    'TOTAL: 1 FAILED, 54 SUCCESS'
  ].join('\n');
  const otherFail = `${esc}Chrome Headless 154.0.0.0 (Linux 0.0.0) Recurring (emulator smoke test) posts once FAILED\nTOTAL: 1 FAILED, 54 SUCCESS\n`;

  const parsed = readZoneLog(targetFail);
  assert(parsed.total?.failed === 1 && parsed.total?.succeeded === 54, 'reads the failed total');
  assert(parsed.targetFailed, 'names the target case');
  assert(parsed.gap === '2028', `measures the gap before the refusal (got ${parsed.gap})`);
  assert(readZoneLog(pass).failing.length === 0 && readZoneLog(pass).total.succeeded === 55, 'reads a clean total');

  const root = mkdtempSync(join(tmpdir(), 'soak-self-test-'));
  try {
    const mk = (name, files) => {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
      return dir;
    };
    const both = parseCsv([csvRow(COLUMNS), roundRows(mk('both', { 'ny.log': pass, 'tokyo.log': pass }), 1, 1, 'plain')].join('\n'));
    assert(both.length === 2 && both.every(row => row.result === 'pass'), 'a clean round has two passing rows');
    const nyFail = parseCsv([csvRow(COLUMNS), roundRows(mk('nyfail', { 'ny.log': targetFail }), 1, 2, 'plain')].join('\n'));
    assert(nyFail.length === 1 && nyFail[0].target_failed === 'yes' && nyFail[0].gap_ms === '2028', 'a New York failure skips Tokyo and keeps its gap');
    const tokyoFail = parseCsv([csvRow(COLUMNS), roundRows(mk('tokyofail', { 'ny.log': pass, 'tokyo.log': otherFail }), 1, 3, 'plain')].join('\n'));
    assert(tokyoFail.length === 2 && tokyoFail[1].result === 'fail' && tokyoFail[1].target_failed === 'no', 'a Tokyo failure of another case is not the target');
    assert(tokyoFail[1].failing.includes('posts once'), 'the failing name survives the CSV round trip');
    const broken = parseCsv([csvRow(COLUMNS), roundRows(mk('broken', { 'ny.log': 'Building...\nerror TS2304' }), 1, 4, 'plain')].join('\n'));
    assert(broken.length === 1 && broken[0].result === 'harness', 'a run with no total is a harness error');

    const all = [...both, ...nyFail, ...tokyoFail, ...broken];
    const summary = summarize(all);
    assert(summary.includes('| plain | 3 | 1 |'), `counts rounds and target failures (got:\n${summary})`);
    const copied = parseCsv([csvRow(COLUMNS), roundRows(mk('copied', { 'ny.log': pass, 'tokyo.log': pass, 'copies.json': '{"ny":{"extra":2,"resent":1},"tokyo":{"extra":0,"resent":0}}' }), 2, 1, 'traced')].join('\n'));
    assert(copied[0].extra_copies === '2' && copied[0].resent_posts === '1' && copied[1].extra_copies === '0', 'carries the copy counts');
    assert(summarize(copied).includes('| 1 of 2 (0) | 1 |'), 'summarizes zone runs with extra copies');
    assert(summary.includes('| 3 / 1 | 2 / 0 |'), 'counts exposures by zone, Tokyo only when reached');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const w = wilson(2, 25);
  assert(Math.abs(w.low - 0.0222) < 0.002 && Math.abs(w.high - 0.2497) < 0.003, `Wilson 2/25 (got ${w.low}, ${w.high})`);
  assert(roundsNeeded(0.08) === 50 && roundsNeeded(0.04) === 74 && roundsNeeded(0.02) === 149, 'sizing at 8%, 4% and 2%');
  assert(roundsNeeded(0) === Infinity, 'no failures cannot size a proof');
  console.log('summarize self-test: ok');
}

const [mode, ...args] = process.argv.slice(2);
if (mode === '--header') console.log(csvRow(COLUMNS));
else if (mode === '--round') console.log(roundRows(args[0], args[1], args[2], args[3]));
else if (mode === '--summary') console.log(summarize(args.flatMap(file => parseCsv(readFileSync(file, 'utf8')))));
else if (mode === '--self-test') selfTest();
else if (mode !== undefined) { console.error(`unknown mode ${mode}`); process.exit(2); }
