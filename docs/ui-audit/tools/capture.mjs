// Capture screenshots of the running home-account app (against Firebase emulators).
// Auth: session injected into IndexedDB (headless-safe). Fonts: served locally via route interception.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = 'http://127.0.0.1:4200';
const AUTH = 'http://127.0.0.1:9099';
const FSTORE = `http://127.0.0.1:8080/v1/projects/demo-home-account/databases/(default)/documents`;
const OUT = new URL('./shots/', import.meta.url).pathname;
const NM = new URL('./node_modules/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// 1. Create/sign-in the Google-linked user in the auth emulator
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
console.log('uid:', uid);

// 2. Seed Firestore
execFileSync(process.execPath, [new URL('./seed.mjs', import.meta.url).pathname, uid], { stdio: 'inherit' });

async function setPref(fieldPath, stringVal) {
  const inner = fieldPath.split('.')[1];
  const res = await fetch(`${FSTORE}/users/${uid}?updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { preferences: { mapValue: { fields: { [inner]: { stringValue: stringVal } } } } } }),
  });
  if (!res.ok) console.error('setPref failed', await res.text());
}

// Auth session payload for IndexedDB injection
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
.material-icons-outlined { font-family: 'Material Icons Outlined'; font-weight: normal; font-style: normal; font-size: 24px; line-height: 1; letter-spacing: normal; text-transform: none; display: inline-block; white-space: nowrap; word-wrap: normal; direction: ltr; -webkit-font-feature-settings: 'liga'; -webkit-font-smoothing: antialiased; }
`;
const FONT_CSS_PTSANS = `
@font-face { font-family: 'PT Sans'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/local/pt-sans-latin-400-normal.woff2) format('woff2'); }
@font-face { font-family: 'PT Sans'; font-style: italic; font-weight: 400; src: url(https://fonts.gstatic.com/local/pt-sans-latin-400-italic.woff2) format('woff2'); }
@font-face { font-family: 'PT Sans'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/local/pt-sans-latin-700-normal.woff2) format('woff2'); }
@font-face { font-family: 'PT Sans'; font-style: italic; font-weight: 700; src: url(https://fonts.gstatic.com/local/pt-sans-latin-700-italic.woff2) format('woff2'); }
`;
const FONT_FILES = {
  'material-icons.woff2': `${NM}material-icons/iconfont/material-icons.woff2`,
  'material-icons-outlined.woff2': `${NM}material-icons/iconfont/material-icons-outlined.woff2`,
  'pt-sans-latin-400-normal.woff2': `${NM}@fontsource/pt-sans/files/pt-sans-latin-400-normal.woff2`,
  'pt-sans-latin-400-italic.woff2': `${NM}@fontsource/pt-sans/files/pt-sans-latin-400-italic.woff2`,
  'pt-sans-latin-700-normal.woff2': `${NM}@fontsource/pt-sans/files/pt-sans-latin-700-normal.woff2`,
  'pt-sans-latin-700-italic.woff2': `${NM}@fontsource/pt-sans/files/pt-sans-latin-700-italic.woff2`,
};

async function prepContext(ctx) {
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
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function shoot(page, route, name, { fullPage = true, settle = 2500, closeSidebar = false } = {}) {
  try {
    await page.goto(`${APP}${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(settle);
    if (closeSidebar) {
      // Click the overlay backdrop far from the drawer to close the auto-opened sidebar
      const backdrop = page.locator('.sidebar-backdrop');
      if (await backdrop.count() > 0) {
        await backdrop.click({ position: { x: 1300, y: 500 }, force: true }).catch(() => {});
        await page.waitForTimeout(700);
      }
    }
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
    console.log('shot', name, '->', page.url());
  } catch (e) {
    console.error('shot FAILED', name, e.message.split('\n')[0]);
  }
}

const PAGES = [
  ['/dashboard', 'dashboard'],
  ['/transactions', 'transactions'],
  ['/budgets', 'budgets'],
  ['/reports', 'reports'],
  ['/settings', 'settings'],
  ['/ai', 'ai-settings'],
  ['/import/file', 'import-wizard'],
  ['/import/history', 'import-history'],
  ['/about', 'about'],
];

// ---- Desktop light ----
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await prepContext(desktop);
const dp = await desktop.newPage();

// login page (unauthenticated look): capture from a separate clean context
{
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await anon.route('**fonts.googleapis.com/icon*', (r) => r.fulfill({ contentType: 'text/css', body: FONT_CSS_ICONS }));
  await anon.route('**fonts.googleapis.com/css2*', (r) => r.fulfill({ contentType: 'text/css', body: FONT_CSS_PTSANS }));
  await anon.route('**fonts.gstatic.com/local/*', (r) => {
    const name = r.request().url().split('/').pop();
    r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(FONT_FILES[name]) });
  });
  const ap = await anon.newPage();
  await ap.goto(`${APP}/login`, { waitUntil: 'load' });
  await ap.waitForTimeout(3000);
  await ap.screenshot({ path: `${OUT}login-desktop-light.png` });
  console.log('shot login-desktop-light');
  const am = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const amp = await am.newPage();
  await amp.goto(`${APP}/login`, { waitUntil: 'load' });
  await amp.waitForTimeout(3000);
  await amp.screenshot({ path: `${OUT}login-mobile-light.png` });
  console.log('shot login-mobile-light');
  await anon.close(); await am.close();
}

// Default state on desktop: sidebar auto-opens as modal overlay with scrim
await shoot(dp, '/dashboard', 'dashboard-desktop-light-DEFAULT-sidebar-open', { settle: 5000 });
await shoot(dp, '/dashboard', 'dashboard-desktop-light', { settle: 3500, closeSidebar: true });
for (const [route, name] of PAGES.slice(1)) await shoot(dp, route, `${name}-desktop-light`, { closeSidebar: true });

// Transaction form dialog via header FAB menu
try {
  await dp.goto(`${APP}/transactions`, { waitUntil: 'load' });
  await dp.waitForTimeout(2500);
  const bd = dp.locator('.sidebar-backdrop');
  if (await bd.count() > 0) { await bd.click({ position: { x: 1300, y: 500 }, force: true }); await dp.waitForTimeout(600); }
  await dp.locator('button[mat-fab], .mat-mdc-fab').first().click();
  await dp.waitForTimeout(700);
  await dp.screenshot({ path: `${OUT}transactions-addmenu-desktop-light.png` });
  await dp.locator('button[mat-menu-item]').first().click();
  await dp.waitForTimeout(1800);
  await dp.screenshot({ path: `${OUT}transaction-form-desktop-light.png` });
  console.log('shot transaction dialog');
} catch (e) { console.error('tx dialog shot failed', e.message.split('\n')[0]); }

// User menu
try {
  await dp.goto(`${APP}/dashboard`, { waitUntil: 'load' });
  await dp.waitForTimeout(2500);
  const bd2 = dp.locator('.sidebar-backdrop');
  if (await bd2.count() > 0) { await bd2.click({ position: { x: 1300, y: 500 }, force: true }); await dp.waitForTimeout(600); }
  await dp.locator('app-header button[aria-label="User menu"]').click();
  await dp.waitForTimeout(800);
  await dp.screenshot({ path: `${OUT}usermenu-open-desktop-light.png` });
  console.log('shot usermenu-open');
} catch (e) { console.error('usermenu shot failed', e.message.split('\n')[0]); }

// ---- Desktop dark ----
await setPref('preferences.theme', 'dark');
for (const [route, name] of [['/dashboard', 'dashboard'], ['/transactions', 'transactions'], ['/budgets', 'budgets'], ['/reports', 'reports'], ['/settings', 'settings']]) {
  await shoot(dp, route, `${name}-desktop-dark`, { closeSidebar: true });
}

// ---- Japanese locale spot-check ----
await setPref('preferences.language', 'ja');
await shoot(dp, '/dashboard', 'dashboard-desktop-dark-ja', { closeSidebar: true });
await shoot(dp, '/settings', 'settings-desktop-dark-ja', { closeSidebar: true });
await setPref('preferences.language', 'en');
await setPref('preferences.theme', 'light');
await desktop.close();

// ---- Mobile light + dark ----
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await prepContext(mobile);
const mp = await mobile.newPage();
await shoot(mp, '/dashboard', 'dashboard-mobile-light', { settle: 5000 });
for (const [route, name] of PAGES.slice(1)) await shoot(mp, route, `${name}-mobile-light`);
await setPref('preferences.theme', 'dark');
for (const [route, name] of [['/dashboard', 'dashboard'], ['/transactions', 'transactions'], ['/budgets', 'budgets'], ['/reports', 'reports']]) {
  await shoot(mp, route, `${name}-mobile-dark`);
}
await setPref('preferences.theme', 'light');
await mobile.close();

await browser.close();
console.log('DONE. Shots in', OUT);
