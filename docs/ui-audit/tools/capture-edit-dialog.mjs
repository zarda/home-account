// Focused capture: the Edit Transaction dialog on a phone-sized viewport.
//
// Repro for "Save Changes is not visible on iPhone": the dialog's fixed
// chrome (header + stacked mobile actions ≈ 196px) plus Material's 65vh
// content cap exceeds the *visible* viewport whenever that viewport is
// short — on iOS because vh resolves against the toolbar-collapsed larger
// viewport (and the keyboard shrinks the visible area further), reproduced
// here with a 390×500 window where the same arithmetic overflows in any
// browser. Usage: node capture-edit-dialog.mjs <label>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const LABEL = process.argv[2] ?? 'shot';
const APP = 'http://127.0.0.1:4200';
const AUTH = 'http://127.0.0.1:9099';
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

// 2. Seed Firestore (idempotent enough for repeat runs)
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
  viewport: { width: 390, height: 844 },
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
// showAll: the seeded demo data is July 2026, so the default this-month
// filter would render an empty list.
await page.goto(`${APP}/transactions?showAll=true`, { waitUntil: 'load' });
await page.waitForTimeout(4000);

// Open the edit dialog by tapping the first transaction card (mobile view)
await page.locator('app-transaction-row').first().click();
await page.waitForTimeout(1500);

const saveBtn = page.locator('.dialog-actions .submit-button');

async function report(tag) {
  const info = await page.evaluate(() => {
    const btn = document.querySelector('.dialog-actions .submit-button');
    const container = document.querySelector('.dialog-container');
    if (!btn || !container) return null;
    const b = btn.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return {
      viewportH: window.innerHeight,
      containerBottom: Math.round(c.bottom),
      btnTop: Math.round(b.top),
      btnBottom: Math.round(b.bottom),
      btnFullyVisible: b.top >= 0 && b.bottom <= window.innerHeight,
    };
  });
  console.log(`[${LABEL}] ${tag}:`, JSON.stringify(info));
  return info;
}

// Tall phone viewport: must render fine in both versions
await report('390x844');
await page.screenshot({ path: `${OUT}edit-dialog-390x844-${LABEL}.png` });

// Short visible viewport (iOS toolbars/keyboard analogue): the defect case
await page.setViewportSize({ width: 390, height: 500 });
await page.waitForTimeout(800);
await report('390x500');
await page.screenshot({ path: `${OUT}edit-dialog-390x500-${LABEL}.png` });

// Even after scrolling the form to its end, is Save reachable?
await page.evaluate(() => {
  const content = document.querySelector('.dialog-content');
  if (content) content.scrollTop = content.scrollHeight;
});
await page.waitForTimeout(500);
const final = await report('390x500-scrolled');
await page.screenshot({ path: `${OUT}edit-dialog-390x500-scrolled-${LABEL}.png` });

const clickable = await saveBtn.isVisible().catch(() => false);
console.log(`[${LABEL}] save button playwright-visible:`, clickable);
console.log(`[${LABEL}] VERDICT: Save Changes ${final?.btnFullyVisible ? 'FULLY VISIBLE' : 'CLIPPED / OFF-SCREEN'}`);

await browser.close();
