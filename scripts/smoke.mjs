// End-to-end smoke test: loads the built app in a phone-sized headless Chromium,
// exercises core flows and saves screenshots. Usage: node scripts/smoke.mjs [url] [outDir]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'smoke-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const step = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { errors.push(`${name}: ${e.message}`); console.log('FAIL', name, e.message); }
};
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const app = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 20000 });
await page.waitForTimeout(2500);
await shot('01-sample-map');

await step('onboarding shows and can be skipped', async () => {
  await page.locator('#coach .card').waitFor({ timeout: 4000 });
  await shot('02-onboarding');
  await page.getByRole('button', { name: 'Skip' }).click();
});

const nodeCount = () => app(() => Object.keys(window.constellate.scene.states.size ? Object.fromEntries(window.constellate.scene.states) : {}).length);

await step('tap a node opens the sheet peek', async () => {
  const pos = await app(() => {
    const s3 = window.constellate.scene;
    const id = [...s3.states.keys()][1];
    const p = s3.toScreen(s3.getPos(id));
    return { id, x: p.x, y: p.y };
  });
  await page.touchscreen.tap(pos.x, pos.y);
  await page.waitForTimeout(500);
  const state = await page.locator('#sheet').getAttribute('data-state');
  if (state !== 'peek') throw new Error('sheet state ' + state);
  await shot('03-selected');
});

await step('quick add 5 ideas with Return', async () => {
  const before = await nodeCount();
  await page.locator('#btn-add').click();
  for (const t of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']) {
    await page.keyboard.type(t);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const after = await nodeCount();
  if (after - before !== 5) throw new Error(`expected +5 nodes, got ${after - before}`);
  await shot('04-added');
});

await step('undo via app removes last idea', async () => {
  const before = await nodeCount();
  await app(() => window.constellate.undo());
  await page.waitForTimeout(300);
  if ((await nodeCount()) !== before - 1) throw new Error('undo did not remove');
  await app(() => window.constellate.redo());
});

await step('outline mode builds tree live', async () => {
  await page.locator('#btn-outline').click();
  await page.waitForTimeout(400);
  const rows = await page.locator('.o-row').count();
  if (rows < 10) throw new Error('rows ' + rows);
  const last = page.locator('.o-row input').last();
  await last.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('From outline');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  const ok = await app(() => { const d = window.constellate.scene.states; return [...d.values()].some((s) => s.node.title === 'From outline'); });
  if (!ok) throw new Error('typed row not found as its own node');
  await shot('05-outline');
  await page.locator('#outline [data-close]').click();
});

await step('search lights matches', async () => {
  await page.locator('#btn-search').click();
  await page.waitForTimeout(200);
  await page.keyboard.type('walk');
  await page.waitForTimeout(400);
  const n = await page.locator('#search-results li[role=option]').count();
  if (!n) throw new Error('no results');
  await shot('06-search');
  await page.locator('#search-results li[role=option]').first().click();
  await page.waitForTimeout(900);
});

for (const layout of ['cone-tree', 'force-galaxy', 'flat-2d', 'radial-sphere']) {
  await step('layout ' + layout, async () => {
    await app((l) => window.constellate.setLayout(l), layout);
    await page.waitForTimeout(1600);
    await shot('07-layout-' + layout);
  });
}

for (const theme of ['aurora', 'paper', 'contrast', 'void']) {
  await step('theme ' + theme, async () => {
    await app(() => window.constellate.menu.open());
    await page.getByRole('button', { name: { aurora: 'Aurora', paper: 'Paper', contrast: 'High Contrast', void: 'Void' }[theme], exact: true }).click();
    await page.locator('#menu [data-close]').click();
    await page.waitForTimeout(700);
    await shot('08-theme-' + theme);
  });
}

await step('fly and walk modes', async () => {
  await page.getByRole('radio', { name: 'Fly' }).click();
  await page.waitForTimeout(900);
  await shot('09-fly');
  await page.getByRole('radio', { name: 'Walk' }).click();
  await page.waitForTimeout(1200);
  await shot('10-walk');
  await page.getByRole('radio', { name: 'Orbit' }).click();
  await page.waitForTimeout(800);
});

await step('long-press node opens radial menu', async () => {
  await app(() => window.constellate.recenter());
  await page.waitForTimeout(900);
  const p = await app(() => { const s3 = window.constellate.scene; return s3.toScreen(s3.getPos(window.constellate.scene.states.keys().next().value)); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  if (await page.locator('#radial').isHidden()) throw new Error('radial hidden');
  await shot('11-radial');
  await page.locator('#radial .r-item', { hasText: 'Link' }).click();
});

await step('persisted to IndexedDB (reload keeps nodes)', async () => {
  const before = await nodeCount();
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await page.waitForTimeout(1500);
  const after = await nodeCount();
  if (after !== before) throw new Error(`before ${before} after ${after}`);
});

await step('landscape layout', async () => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForTimeout(800);
  await shot('12-landscape');
});

const fps = await app(() => window.constellate.scene.fps.value);
console.log('fps (software GL, not representative):', fps.toFixed(1), 'quality level:', await app(() => window.constellate.scene.quality));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
