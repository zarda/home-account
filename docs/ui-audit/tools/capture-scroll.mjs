// Capture below-the-fold content: the app scrolls inside .main-container (position: fixed),
// so fullPage screenshots are clipped. Scroll the container and take stepped viewport shots.
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://127.0.0.1:4200';
const AUTH = 'http://127.0.0.1:9099';
const OUT = new URL('./shots/', import.meta.url).pathname;
const NM = new URL('./node_modules/', import.meta.url).pathname;

const idp = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: 'demo-alex', email: 'alex.chen@example.com', email_verified: true, name: 'Alex Chen' }))}&providerId=google.com`,
    requestUri: 'http://127.0.0.1', returnIdpCredential: true, returnSecureToken: true,
  }),
})).json();

const authRecord = {
  uid: idp.localId, email: 'alex.chen@example.com', emailVerified: true, displayName: 'Alex Chen',
  isAnonymous: false, photoURL: null,
  providerData: [{ providerId: 'google.com', uid: 'demo-alex', displayName: 'Alex Chen', email: 'alex.chen@example.com', phoneNumber: null, photoURL: null }],
  stsTokenManager: { refreshToken: idp.refreshToken, accessToken: idp.idToken, expirationTime: Date.now() + 55 * 60 * 1000 },
  createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: 'demo-api-key', appName: '[DEFAULT]',
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

async function prep(ctx) {
  await ctx.route('**fonts.googleapis.com/icon*', (r) => r.fulfill({ contentType: 'text/css', body: FONT_CSS_ICONS }));
  await ctx.route('**fonts.googleapis.com/css2*', (r) => r.fulfill({ contentType: 'text/css', body: FONT_CSS_PTSANS }));
  await ctx.route('**fonts.gstatic.com/local/*', (r) => {
    const f = FONT_FILES[r.request().url().split('/').pop()];
    f ? r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(f) }) : r.abort();
  });
  await ctx.addInitScript((rec) => {
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => { try { open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); } catch { /**/ } };
    open.onsuccess = () => { try { open.result.transaction('firebaseLocalStorage', 'readwrite').objectStore('firebaseLocalStorage').put({ fbase_key: 'firebase:authUser:demo-api-key:[DEFAULT]', value: rec }); } catch { /**/ } };
  }, authRecord);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function scrollShots(ctx, route, base, isDesktop) {
  const page = await ctx.newPage();
  await page.goto(`${APP}${route}`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  if (isDesktop) {
    const bd = page.locator('.sidebar-backdrop');
    if (await bd.count() > 0) { await bd.click({ position: { x: 1300, y: 500 }, force: true }).catch(() => {}); await page.waitForTimeout(600); }
  }
  const info = await page.evaluate(() => {
    const c = document.querySelector('.main-container');
    return c ? { scrollH: c.scrollHeight, clientH: c.clientHeight } : null;
  });
  if (!info) { console.log('no container for', route); await page.close(); return; }
  const steps = Math.min(3, Math.ceil(info.scrollH / info.clientH) - 1);
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((frac) => {
      const c = document.querySelector('.main-container');
      c.scrollTop = (c.scrollHeight - c.clientHeight) * frac;
    }, i / steps);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}${base}-scroll${i}.png` });
    console.log('shot', `${base}-scroll${i}`);
  }
  await page.close();
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await prep(desktop);
for (const [route, base] of [['/reports', 'reports-desktop-light'], ['/settings', 'settings-desktop-light'], ['/about', 'about-desktop-light'], ['/ai', 'ai-settings-desktop-light']]) {
  await scrollShots(desktop, route, base, true);
}
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await prep(mobile);
for (const [route, base] of [['/dashboard', 'dashboard-mobile-light'], ['/reports', 'reports-mobile-light'], ['/budgets', 'budgets-mobile-light']]) {
  await scrollShots(mobile, route, base, false);
}
await mobile.close();

await browser.close();
console.log('SCROLL SHOTS DONE');
