// Sweep every dialog in the app on a deliberately short phone viewport and
// report whether its actions row is inside the visible viewport.
//
// Why 390x500: iOS resolves `vh` against the *largest* viewport — the one
// with Safari's toolbars collapsed — so a vh-sized dialog is taller than
// what the user can see whenever the toolbars are showing, and the part
// that falls off the bottom is the pinned actions row with the submit
// button in it. A short window reproduces the same arithmetic in any
// browser. Usage: node capture-dialogs.mjs <label>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const LABEL = process.argv[2] ?? 'shot';
const APP = 'http://127.0.0.1:4200';
const AUTH = 'http://127.0.0.1:9099';
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

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 500 },
  deviceScaleFactor: 2,
  isMobile: true,
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
      tx.objectStore('firebaseLocalStorage').put({ fbase_key: `firebase:authUser:demo-api-key:[DEFAULT]`, value: rec });
    } catch { /* ignore */ }
  };
}, authRecord);

const page = await ctx.newPage();

// Heights to test, tallest first. 844 is an ordinary portrait phone and is
// here as the regression guard — a dialog that stops fitting there is a
// worse bug than the one being fixed. 500 is portrait with iOS toolbars
// showing; 390 and 330 are landscape on an iPhone-class device, where the
// visible height collapses and the chrome+content arithmetic bites hardest.
const HEIGHTS = [844, 500, 390, 330];

/** Measure the open dialog: is its last actions row inside the viewport? */
async function measureAt() {
  return page.evaluate(() => {
    const surface = document.querySelector('.mat-mdc-dialog-surface');
    if (!surface) return { error: 'no dialog open' };
    const viewportH = window.innerHeight;
    const actions = surface.querySelector('.mat-mdc-dialog-actions, mat-dialog-actions');
    if (!actions) {
      const s = surface.getBoundingClientRect();
      return { viewportH, surfaceBottom: Math.round(s.bottom), noActions: true, ok: s.bottom <= viewportH + 1 };
    }
    const a = actions.getBoundingClientRect();
    // The lowest button in the row is what the user actually has to reach.
    const lowest = [...actions.querySelectorAll('button')]
      .reduce((acc, b) => Math.max(acc, b.getBoundingClientRect().bottom), 0);
    return {
      viewportH,
      actionsTop: Math.round(a.top),
      lowestButtonBottom: Math.round(lowest),
      ok: lowest <= viewportH + 1 && a.top >= -1,
    };
  });
}

async function closeAny() {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  // disableClose dialogs ignore Escape; use their own close-X.
  const x = page.locator('.mat-mdc-dialog-surface .dialog-header-close');
  if (await x.count()) { await x.first().click({ force: true }).catch(() => {}); await page.waitForTimeout(500); }
  const cancel = page.locator('.mat-mdc-dialog-surface button:has-text("Cancel")');
  if (await cancel.count()) { await cancel.first().click({ force: true }).catch(() => {}); await page.waitForTimeout(500); }
}

const results = [];

/** Navigate, run `open`, then measure the dialog at every height. */
async function check(name, route, open) {
  try {
    await page.setViewportSize({ width: 390, height: HEIGHTS[0] });
    await page.goto(`${APP}${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(4500);
    await open();
    await page.waitForTimeout(1600);

    const perHeight = {};
    for (const h of HEIGHTS) {
      await page.setViewportSize({ width: 390, height: h });
      await page.waitForTimeout(600);
      const m = await measureAt();
      perHeight[h] = m;
      // Tallest and shortest are the two worth looking at by eye.
      if (h === HEIGHTS[0] || h === HEIGHTS[HEIGHTS.length - 1]) {
        await page.screenshot({ path: `${OUT}dlg-${name}-h${h}-${LABEL}.png` });
      }
    }
    const failures = HEIGHTS.filter(h => !perHeight[h].ok);
    const detail = HEIGHTS
      .map(h => `${h}:${perHeight[h].ok ? 'ok' : `btn@${perHeight[h].lowestButtonBottom}`}`)
      .join(' ');
    console.log(`${failures.length ? 'FAIL' : 'PASS'}  ${name.padEnd(20)} ${detail}`);
    results.push({ name, perHeight, ok: failures.length === 0, failures });
    await closeAny();
  } catch (e) {
    console.log(`ERROR ${name.padEnd(20)} ${e.message.split('\n')[0]}`);
    results.push({ name, error: e.message.split('\n')[0] });
  }
}

await check('transaction-edit', '/transactions?showAll=true', async () => {
  await page.locator('app-transaction-row').first().click();
});

await check('transaction-add', '/transactions?showAll=true&action=add', async () => {
  await page.waitForTimeout(800);
});

await check('confirm-delete', '/transactions?showAll=true', async () => {
  await page.locator('app-transaction-row .mobile-menu-btn').first().click();
  await page.waitForTimeout(700);
  await page.locator('.mat-mdc-menu-panel button').nth(1).click();
});

await check('budget-form', '/budgets', async () => {
  await page.locator('app-budgets button.mat-mdc-unelevated-button').first().click();
});

// Recurring lives in the second tab of the budgets page, not its own route.
await check('recurring-form', '/budgets', async () => {
  await page.locator('.mat-mdc-tab').nth(1).click();
  await page.waitForTimeout(1200);
  await page.locator('app-recurring-transactions .add-btn').first().click();
});

// The category manager sits inside a collapsed expansion panel on settings.
await check('category-form', '/settings', async () => {
  const header = page.locator('mat-expansion-panel-header', { hasText: 'Categories' }).first();
  await header.scrollIntoViewIfNeeded();
  await header.click();
  await page.waitForTimeout(1200);
  const add = page.locator('app-category-manager button:has-text("Add Category")').first();
  await add.scrollIntoViewIfNeeded();
  await add.click();
});

await check('export-dialog', '/reports', async () => {
  await page.locator('.export-btn').first().click();
});

await check('ai-search', '/transactions?showAll=true', async () => {
  await page.locator('app-header button[aria-label]:not(.menu-button)').first().click();
});

await check('camera-capture', '/transactions?showAll=true', async () => {
  await page.locator('app-bottom-nav .action-button').first().click();
  await page.waitForTimeout(700);
  await page.locator('.mat-mdc-menu-panel button').nth(1).click();
});

console.log(`\n[${LABEL}] SUMMARY  (viewport heights: ${HEIGHTS.join(', ')})`);
for (const r of results) {
  const note = r.error ? r.error : r.ok ? 'fits at every height' : `clipped at ${r.failures.join(', ')}`;
  console.log(`  ${r.error ? 'ERROR' : r.ok ? 'PASS ' : 'FAIL '} ${r.name.padEnd(20)} ${note}`);
}

await browser.close();
