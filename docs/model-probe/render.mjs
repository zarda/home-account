// Render receipts.html into one PNG per receipt.
//
// The HTML is the source of truth and is committed; the PNGs are derived and
// gitignored, the same split docs/ui-audit/tools uses for its shots. Rendering
// through a real browser rather than shipping images keeps the fixtures
// readable and diffable — a reviewer can see what a case tests without opening
// a picture.
//
// Chromium comes from the ui-audit harness's install so this folder needs no
// dependencies of its own. Usage: node render.mjs
import { chromium } from '../ui-audit/tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'receipts');
export const CASE_IDS = ['jp', 'kr', 'none', 'long', 'cropped'];

/** Playwright's bundled Chromium, or an override for a machine whose cache differs. */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = path.join(
    process.env.HOME ?? '',
    'Library/Caches/ms-playwright'
  );
  if (!fs.existsSync(base)) return undefined;
  const build = fs.readdirSync(base).filter(d => d.startsWith('chromium-')).sort().pop();
  if (!build) return undefined;
  const app = path.join(base, build, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents/MacOS/Google Chrome for Testing');
  return fs.existsSync(app) ? app : undefined;
}

export async function render({ quiet = false } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const executablePath = chromiumPath();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    // deviceScaleFactor 2: a phone photograph of a receipt is not 1x, and the
    // extra detail is what the model actually gets in production.
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.goto(`file://${path.join(HERE, 'receipts.html')}`);
    await page.waitForTimeout(600);
    for (const id of CASE_IDS) {
      const el = page.locator(`#${id}`);
      const box = await el.boundingBox();
      if (!box) throw new Error(`fixture #${id} did not render — receipts.html may have drifted`);
      await el.screenshot({ path: path.join(OUT, `${id}.png`) });
      if (!quiet) console.log(`  ${id}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  } finally {
    await browser.close();
  }
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('rendering fixtures...');
  const out = await render();
  console.log('->', out);
}
