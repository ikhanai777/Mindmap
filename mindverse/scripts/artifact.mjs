// Turn dist-artifact/ into one self-contained HTML page (JS + CSS inlined) so
// it can be published as a claude.ai artifact or opened straight from disk.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = new URL('../dist-artifact/', import.meta.url);
let html = readFileSync(new URL('index.html', dir), 'utf8');
const assets = new URL('assets/', dir);
for (const f of readdirSync(assets)) {
  const body = readFileSync(new URL(f, assets), 'utf8');
  if (f.endsWith('.css')) {
    html = html.replace(new RegExp(`<link rel="stylesheet"[^>]*${f}[^>]*>`), () => `<style>${body}</style>`);
  } else if (f.endsWith('.js')) {
    html = html.replace(
      new RegExp(`<script type="module"[^>]*${f}[^>]*></script>`),
      () => `<script type="module">${body.replace(/<\/script/g, '<\\/script')}</script>`,
    );
  }
}
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
// the artifact host supplies its own document skeleton: keep head + body contents only
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta (charset|name="viewport")[^>]*>\s*/g, '');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const fragment = head.trim() + '\n' + body.trim() + '\n';
writeFileSync(new URL('mindverse.artifact.html', dir), fragment);
writeFileSync(new URL('mindverse.html', dir), html);
console.log('dist-artifact/mindverse.html', (html.length / 1024).toFixed(0), 'KB');
