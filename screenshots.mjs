// Take the three screenshots the bounty asks for, from the built dashboard in out/dashboard/:
//   1-board.png     the board (the first look: hero, comps chart, filters, table)
//   2-detail.png    a protocol's detail view (the dialog, open on the top pick)
//   3-filtered.png  a filtered view (FARM verdicts only)
//
// Usage: node screenshots.mjs [dashboardDir] [outDir]
// Defaults: out/dashboard and screenshots/. Uses the Chrome binary downloaded from
// Chrome for Testing (CHROME_PATH) or the copy in the workspace.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dashboardDir = resolve(process.argv[2] ?? 'out/dashboard');
const outDir = resolve(process.argv[3] ?? 'screenshots');
const chromePath = process.env.CHROME_PATH ?? resolve(process.cwd(), '..', 'chrome-linux64', 'chrome');

async function main() {
  if (!existsSync(join(dashboardDir, 'index.html'))) {
    console.error(`screenshots: no dashboard at ${dashboardDir} — run main.ts first`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console error:', m.text().slice(0, 200)); });

  // 1. The board.
  await page.goto(`file://${join(dashboardDir, 'index.html')}`, { waitUntil: 'load' });
  await page.waitForSelector('#board .shell', { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, '1-board.png') });

  // 2. The detail view: open the dialog on the top pick (rank 1).
  await page.evaluate(() => {
    const row = document.querySelector('tbody tr');
    if (row) row.click();
  });
  await page.waitForSelector('dialog[open]', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, '2-detail.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 3. A filtered view: FARM verdicts only.
  await page.evaluate(() => {
    const select = document.querySelector('#verdict');
    if (select) { select.value = 'FARM'; select.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, '3-filtered.png') });

  await browser.close();
  console.log(`screenshots: wrote 1-board.png, 2-detail.png, 3-filtered.png to ${outDir}`);
}

main().catch((e) => { console.error('screenshots:', e.message); process.exit(1); });
