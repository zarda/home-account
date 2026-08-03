// Sweep the app for content that is clipped, covered, or pushed out of reach,
// and report PASS/FAIL per page per viewport.
//
// The failure this hunts is not "looks cramped" — it is "the user cannot get
// to it". Three geometries say that, and each is checked separately:
//
//   1. An element sticks out of a clipping ancestor that does NOT scroll on
//      that axis. Sticking out of a scroller is fine; the user scrolls. Being
//      cut off by `overflow: hidden` is not — the pixels are simply gone.
//   2. A clipper's scrollWidth exceeds its clientWidth while overflow-x is
//      hidden. Same thing seen from the container's side, and it catches the
//      case where the overflowing child is not one of the watched selectors.
//   3. An element's own scrollHeight exceeds its clientHeight — text that
//      wrapped onto a line the box then cut off.
//
// Two passes that a normal screenshot run cannot do:
//   - `ja`, because a longer translation is what turns a comfortable row into
//     a clipped one, and it is the case nobody looks at by hand.
//   - Faked safe-area insets. The shell reads var(--safe-*) and never env(),
//     so overriding those four variables reproduces iPhone-landscape geometry
//     in headless Chromium. env() cannot be faked, which is why the tokens
//     exist in that form at all.
//
// Needs `npm start` on :4200 and the Firebase emulators running, same as the
// other scripts here. Usage: node capture-overflow.mjs <label>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const LABEL = process.argv[2] ?? 'shot';
// localhost, not 127.0.0.1: `ng serve` binds to ::1 only on some setups, and
// localhost resolves to whichever family is actually listening.
const APP = 'http://localhost:4200';
const AUTH = 'http://127.0.0.1:9099';
const FSTORE = 'http://127.0.0.1:8080/v1/projects/demo-home-account/databases/(default)/documents';
const OUT = new URL('./shots/', import.meta.url).pathname;
const NM = new URL('./node_modules/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const idpRes = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: 'demo-alex', email: 'alex.chen@example.com', email_verified: true, name: 'Alex Chen' }))}&providerId=google.com`,
    requestUri: 'http://127.0.0.1',
    returnIdpCredential: true,
    returnSecureToken: true,
  }),
});
const idp = await idpRes.json();
if (!idp.localId) { console.error('auth precreate failed', idp); process.exit(1); }
const uid = idp.localId;
execFileSync(process.execPath, [new URL('./seed.mjs', import.meta.url).pathname, uid], { stdio: 'inherit' });

// ---- Hostile content -------------------------------------------------------
// seed.mjs is deliberately realistic, which is exactly what does NOT provoke
// this bug. These four rows are the shapes that do: a description with no
// break opportunity, a category name longer than the column that holds it, a
// nine-figure foreign amount whose converted line doubles its width, and the
// full complement of tags plus a location on one line.
const HOSTILE = [
  {
    id: 'ovf-001', type: 'expense', cat: 'food_groceries',
    desc: 'Weekly grocery run at the farmers market on Ferry Building Embarcadero plus household supplies and a refill of the pantry staples',
    amount: 123456789, currency: 'JPY', base: 846296.5, rate: 0.006855,
    date: '2026-07-03T10:00:00Z',
    tags: ['weekly-grocery-run', 'organic-produce', 'household-supplies', 'reimbursable', 'shared-expense'],
    location: 'Ferry Building Marketplace, One Ferry Building, San Francisco',
    note: 'Split with flatmates',
  },
  {
    id: 'ovf-002', type: 'expense', cat: 'subscriptions',
    desc: 'https://example.com/billing/invoices/2026-07-03/subscription-renewal-annual-plan-reference-A1B2C3D4E5F6',
    amount: 1499.99, currency: 'USD', date: '2026-07-03T09:30:00Z',
  },
  {
    id: 'ovf-003', type: 'income', cat: 'self_employment',
    desc: 'Q3 retainer', amount: 987654321, currency: 'JPY', base: 6770418.5, rate: 0.006855,
    date: '2026-07-03T09:00:00Z', tags: ['invoice', 'retainer', 'q3', 'net-30'],
  },
  {
    id: 'ovf-004', type: 'expense', cat: 'transport_taxiAndRideShare',
    desc: 'Airport transfer', amount: 68.4, currency: 'USD', date: '2026-07-03T08:00:00Z',
    location: 'San Francisco International Airport, International Terminal Departures Level',
    tags: ['travel', 'reimbursable', 'business-trip', 'q3'],
  },
];

const ts = (iso) => ({ timestampValue: iso });
const str = (s) => ({ stringValue: s });
const num = (n) => (Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n });
const bool = (b) => ({ booleanValue: b });

for (const t of HOSTILE) {
  const fields = {
    userId: str(uid), type: str(t.type), amount: num(t.amount),
    currency: str(t.currency), amountInBaseCurrency: num(t.base ?? t.amount),
    exchangeRate: num(t.rate ?? 1), categoryId: str(t.cat), description: str(t.desc),
    date: ts(t.date), createdAt: ts(t.date), updatedAt: ts(t.date), isRecurring: bool(false),
  };
  if (t.tags) fields.tags = { arrayValue: { values: t.tags.map((x) => ({ stringValue: x })) } };
  if (t.note) fields.note = str(t.note);
  if (t.location) fields.location = { mapValue: { fields: { name: str(t.location) } } };
  const res = await fetch(`${FSTORE}/users/${uid}/transactions/${t.id}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) { console.error('hostile seed failed', t.id, await res.text()); process.exit(1); }
}
console.log(`Seeded ${HOSTILE.length} hostile transactions for ${uid}`);

async function setPref(fieldPath, stringVal) {
  const inner = fieldPath.split('.')[1];
  const res = await fetch(`${FSTORE}/users/${uid}?updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { preferences: { mapValue: { fields: { [inner]: { stringValue: stringVal } } } } } }),
  });
  if (!res.ok) console.error('setPref failed', await res.text());
}

const authRecord = {
  uid,
  email: 'alex.chen@example.com',
  emailVerified: true,
  displayName: 'Alex Chen',
  isAnonymous: false,
  photoURL: null,
  providerData: [{
    providerId: 'google.com', uid: 'demo-alex', displayName: 'Alex Chen',
    email: 'alex.chen@example.com', phoneNumber: null, photoURL: null,
  }],
  stsTokenManager: {
    refreshToken: idp.refreshToken,
    accessToken: idp.idToken,
    expirationTime: Date.now() + 55 * 60 * 1000,
  },
  createdAt: String(Date.now()),
  lastLoginAt: String(Date.now()),
  apiKey: 'demo-api-key',
  appName: '[DEFAULT]',
};

const FONT_CSS_ICONS = `
@font-face { font-family: 'Material Icons'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/local/material-icons.woff2) format('woff2'); }
@font-face { font-family: 'Material Icons Outlined'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/local/material-icons-outlined.woff2) format('woff2'); }
.material-icons { font-family: 'Material Icons'; font-weight: normal; font-style: normal; font-size: 24px; line-height: 1; letter-spacing: normal; text-transform: none; display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr; -webkit-font-feature-settings: 'liga'; -webkit-font-smoothing: antialiased; }
`;
const FONT_CSS_PTSANS = `
@font-face { font-family: 'PT Sans'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/local/pt-sans-latin-400-normal.woff2) format('woff2'); }
@font-face { font-family: 'PT Sans'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/local/pt-sans-latin-700-normal.woff2) format('woff2'); }
`;
const FONT_FILES = {
  'material-icons.woff2': `${NM}material-icons/iconfont/material-icons.woff2`,
  'material-icons-outlined.woff2': `${NM}material-icons/iconfont/material-icons-outlined.woff2`,
  'pt-sans-latin-400-normal.woff2': `${NM}@fontsource/pt-sans/files/pt-sans-latin-400-normal.woff2`,
  'pt-sans-latin-700-normal.woff2': `${NM}@fontsource/pt-sans/files/pt-sans-latin-700-normal.woff2`,
};

// ---- What is watched -------------------------------------------------------
// Every entry is something the user needs to be able to see or press. Absence
// is reported, never failed: `.col-actions` does not exist below 768px and
// `.nav-label` does not exist above it, and a run that failed on that would
// cry wolf at half its cells.
const WATCH = [
  { sel: '.row-actions button, .mobile-menu-btn', what: 'row overflow menu' },
  { sel: '.row-amount', what: 'row amount column' },
  { sel: '.amount', what: 'amount value' },
  { sel: '.tag-overflow', what: '+N tag indicator' },
  { sel: '.col-actions button', what: 'table row menu' },
  { sel: '.col-amount', what: 'table amount cell' },
  { sel: '.app-title', what: 'header wordmark' },
  { sel: '.nav-label', what: 'bottom-nav label' },
  { sel: '.stat-value', what: 'stat card value' },
];

// 320 is the narrowest phone still in use and the width at which the two
// min-width:300px dialog bodies overflow. 768 is where the desktop table
// switches on and has the least room it will ever have. The rest bracket them.
const WIDTHS = [320, 375, 390, 600, 768, 1024, 1440];
const ROUTES = [
  { route: '/transactions?showAll=true', name: 'transactions' },
  { route: '/dashboard', name: 'dashboard' },
  { route: '/budgets', name: 'budgets' },
  { route: '/reports', name: 'reports' },
  { route: '/settings', name: 'settings' },
];

const SAFE_AREA_CSS = ':root{--safe-top:44px;--safe-bottom:34px;--safe-left:44px;--safe-right:44px}';

/** Measure every watched element on the current page. Runs in the page. */
async function measure(page, watch) {
  return page.evaluate((watchList) => {
    const scrolls = (v) => v === 'auto' || v === 'scroll';
    const clips = (v) => v === 'hidden' || v === 'clip';

    // The nearest ancestor that does not let content paint outside it. This is
    // what decides whether "outside the box" means "scroll to it" or "gone".
    function clipper(el) {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return { el: p, cs };
      }
      return null;
    }

    const findings = [];
    const seen = {};

    for (const { sel, what } of watchList) {
      const els = [...document.querySelectorAll(sel)];
      let visible = 0;
      for (const el of els.slice(0, 12)) {
        // Not rendered at all is not the same as clipped. The bottom nav is
        // display: none above the mobile breakpoint, so its labels are in the
        // DOM with a 0x0 rect on every desktop width — reporting those as
        // collapsed buries the real findings under a few hundred of them.
        const shown = typeof el.checkVisibility === 'function'
          ? el.checkVisibility()
          : !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        if (!shown) continue;
        visible++;

        const r = el.getBoundingClientRect();
        const label = `${what} "${(el.textContent ?? '').trim().slice(0, 24)}"`;

        // A box collapsed to nothing is hidden just as surely as a clipped one.
        if (r.width < 1 || r.height < 1) {
          findings.push({ what, label, kind: 'collapsed', detail: `${Math.round(r.width)}x${Math.round(r.height)}` });
          continue;
        }

        const c = clipper(el);
        if (c) {
          const cr = c.el.getBoundingClientRect();
          // Out of the box on an axis that cannot be scrolled = unreachable.
          if (clips(c.cs.overflowX) && (r.right > cr.right + 1 || r.left < cr.left - 1)) {
            findings.push({
              what, label, kind: 'clipped-x',
              detail: `${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(cr.left)}..${Math.round(cr.right)} of ${c.el.className || c.el.tagName}`,
            });
          }
          if (clips(c.cs.overflowY) && (r.bottom > cr.bottom + 1 || r.top < cr.top - 1)) {
            findings.push({
              what, label, kind: 'clipped-y',
              detail: `${Math.round(r.top)}..${Math.round(r.bottom)} outside ${Math.round(cr.top)}..${Math.round(cr.bottom)} of ${c.el.className || c.el.tagName}`,
            });
          }
          // The container's own view of the same problem — catches an
          // overflowing child that is not itself on the watch list.
          if (clips(c.cs.overflowX) && c.el.scrollWidth > c.el.clientWidth + 1) {
            findings.push({
              what, label, kind: 'unscrollable-overflow',
              detail: `${c.el.className || c.el.tagName} scrollWidth ${c.el.scrollWidth} > clientWidth ${c.el.clientWidth}`,
            });
          }
          if (scrolls(c.cs.overflowX) && (c.cs.scrollbarWidth === 'none')) {
            findings.push({ what, label, kind: 'hidden-scrollbar', detail: c.el.className || c.el.tagName });
          }
        }

        // Text that wrapped onto a line its own box then cut off.
        if (el.scrollHeight > el.clientHeight + 1 && clips(getComputedStyle(el).overflowY)) {
          findings.push({ what, label, kind: 'clipped-wrap', detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
        }
        // Any element pushed past the right edge of the window is off-screen
        // regardless of what its ancestors allow.
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          findings.push({ what, label, kind: 'off-viewport', detail: `${Math.round(r.left)}..${Math.round(r.right)} vs 0..${window.innerWidth}` });
        }
      }
      seen[what] = visible;
    }

    // The page itself must never scroll sideways.
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      findings.push({ what: 'document', label: 'page', kind: 'page-scrolls-x', detail: `${doc.scrollWidth} > ${doc.clientWidth}` });
    }

    return { findings, seen };
  }, watch);
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});

const results = [];

/** One full matrix pass: every route at every width. */
async function sweep(passName, { lang = 'en', safeArea = false } = {}) {
  await setPref('preferences.language', lang);

  const ctx = await browser.newContext({
    viewport: { width: WIDTHS[0], height: 844 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
  });
  await ctx.route('**fonts.googleapis.com/icon*', (r) => r.fulfill({ contentType: 'text/css', body: FONT_CSS_ICONS }));
  await ctx.route('**fonts.googleapis.com/css2*', (r) => r.fulfill({ contentType: 'text/css', body: FONT_CSS_PTSANS }));
  await ctx.route('**fonts.gstatic.com/local/*', (r) => {
    const name = r.request().url().split('/').pop();
    const file = FONT_FILES[name];
    if (file) r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(file) });
    else r.abort();
  });
  await ctx.addInitScript((rec) => {
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => {
      try { open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); } catch { /* exists */ }
    };
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
        tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'firebase:authUser:demo-api-key:[DEFAULT]', value: rec });
      } catch { /* ignore */ }
    };
  }, authRecord);

  const page = await ctx.newPage();

  for (const { route, name } of ROUTES) {
    for (const w of WIDTHS) {
      const cell = `${passName}/${name}@${w}`;
      try {
        await page.setViewportSize({ width: w, height: 844 });
        await page.goto(`${APP}${route}`, { waitUntil: 'load' });
        await page.waitForTimeout(3800);
        if (safeArea) await page.addStyleTag({ content: SAFE_AREA_CSS });
        await page.waitForTimeout(safeArea ? 600 : 200);

        const { findings, seen } = await measure(page, WATCH);
        const present = Object.entries(seen).filter(([, n]) => n > 0).map(([k]) => k);
        console.log(
          `${findings.length ? 'FAIL' : 'PASS'}  ${cell.padEnd(34)} ` +
          `${findings.length} finding(s), watched ${present.length}/${WATCH.length} kinds`
        );
        for (const f of findings.slice(0, 6)) {
          console.log(`        ${f.kind.padEnd(22)} ${f.label} — ${f.detail}`);
        }
        results.push({ cell, findings, ok: findings.length === 0 });

        // Shoot the two ends of the range; those are the ones worth an eye.
        if (findings.length && (w === WIDTHS[0] || w === 768)) {
          await page.screenshot({ path: `${OUT}ovf-${passName}-${name}-w${w}-${LABEL}.png`, fullPage: false });
        }
      } catch (e) {
        console.log(`ERROR ${cell.padEnd(34)} ${e.message.split('\n')[0]}`);
        results.push({ cell, error: e.message.split('\n')[0] });
      }
    }
  }

  await ctx.close();
}

await sweep('en');
await sweep('ja', { lang: 'ja' });
await sweep('safe-area', { lang: 'en', safeArea: true });
await setPref('preferences.language', 'en');

// ---- Summary ---------------------------------------------------------------
const failed = results.filter((r) => !r.ok && !r.error);
const errored = results.filter((r) => r.error);
const byKind = {};
for (const r of failed) for (const f of r.findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

console.log(`\n[${LABEL}] SUMMARY  (widths: ${WIDTHS.join(', ')} × en, ja, safe-area)`);
console.log(`  ${results.length - failed.length - errored.length}/${results.length} cells clean`);
if (errored.length) console.log(`  ${errored.length} cell(s) errored`);
for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${kind}`);
}
if (failed.length) {
  console.log('\n  Worst cells:');
  for (const r of failed.sort((a, b) => b.findings.length - a.findings.length).slice(0, 10)) {
    console.log(`    ${String(r.findings.length).padStart(3)}  ${r.cell}`);
  }
}

await browser.close();
process.exit(failed.length || errored.length ? 1 : 0);
