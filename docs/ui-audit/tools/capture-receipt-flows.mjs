// Focused capture: receipt multi-snap entry points and dialog states.
// Desktop (1440×900), mobile (390×844 with an iPhone user agent — the
// transactions header menu and form gates are UA-based, so a viewport
// alone would render the desktop experience), and a ja-locale spot shot.
// Never clicks "Process": no AI provider exists in this environment.
//
// Prereqs (see README.md): emulators + ng serve running, .vscode/environment
// pointed at the demo project with useEmulators, deps installed here.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = 'http://127.0.0.1:4200';
const AUTH = 'http://127.0.0.1:9099';
const FSTORE = `http://127.0.0.1:8080/v1/projects/demo-home-account/databases/(default)/documents`;
const OUT = new URL('./shots-receipt-flows/', import.meta.url).pathname;
const NM = new URL('./node_modules/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// Tiny valid JPEG (1×1) used as a receipt stand-in for input plumbing shots.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64'
);

// 1. Auth user + seed (same bootstrap as capture.mjs)
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

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('shot', name);
}

// ---- Desktop 1440×900 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await prepContext(ctx);
  const page = await ctx.newPage();

  await page.goto(`${APP}/transactions`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  const backdrop = page.locator('.sidebar-backdrop');
  if (await backdrop.count() > 0) {
    await backdrop.click({ position: { x: 1300, y: 500 }, force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }

  await page.locator('app-page-header button[mat-fab]').click();
  await page.waitForTimeout(600);
  await shot(page, 'desktop-add-menu');

  await page.locator('button[mat-menu-item]', { hasText: 'Import from Camera' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'desktop-camera-dialog-empty');

  // Two photos through the library input: thumbnails, reorder, process-all
  await page.locator('input[type="file"][multiple]').first().setInputFiles([
    { name: 'receipt-top.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
    { name: 'receipt-bottom.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
  ]);
  await page.waitForTimeout(1200);
  await shot(page, 'desktop-camera-dialog-two-photos');

  await ctx.close();
}

// ---- Mobile 390×844 (iPhone UA) ----
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  });
  await prepContext(ctx);
  const page = await ctx.newPage();

  await page.goto(`${APP}/dashboard`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  await page.locator('app-bottom-nav button.action-button').click();
  await page.waitForTimeout(600);
  await shot(page, 'mobile-fab-menu');

  await page.locator('button[mat-menu-item]', { hasText: 'Add manually' }).click();
  await page.waitForTimeout(1200);
  await shot(page, 'mobile-add-form-with-scan-buttons');

  await page.locator('button.long-receipt-btn').click();
  await page.waitForTimeout(1200);
  await shot(page, 'mobile-long-receipt-handoff-camera-dialog');

  await ctx.close();
}

// ---- ja locale spot: FAB menu ----
{
  await setPref('preferences.language', 'ja');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  });
  await prepContext(ctx);
  const page = await ctx.newPage();
  await page.goto(`${APP}/dashboard`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  await page.locator('app-bottom-nav button.action-button').click();
  await page.waitForTimeout(600);
  await shot(page, 'mobile-fab-menu-ja');
  await ctx.close();
  await setPref('preferences.language', 'en');
}

await browser.close();
console.log('DONE. Shots in', OUT);
