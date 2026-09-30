// Rasterise icon.svg into the launcher mipmaps (run once; output is committed).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const browser = await chromium.launch();
for (const [dpi, px] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width: px, height: px } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${px}px;height:${px}px;display:block}</style>${svg}`);
  const dir = new URL(`./res/mipmap-${dpi}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: new URL('ic_launcher.png', dir).pathname, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
