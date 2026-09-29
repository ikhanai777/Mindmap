// Package the artifact build (vite build --mode artifact) for claude.ai artifacts:
// the host wraps the page in its own <html>/<head>/<body>, so emit only the title,
// stylesheet, body markup and module script.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../dist-artifact/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]).join('\n');
const title = pick(/<title>[\s\S]*?<\/title>/g);
const styles = pick(/<link rel="stylesheet"[^>]*>/g);
const scripts = pick(/<script type="module"[^>]*><\/script>/g);
const preloads = pick(/<link rel="modulepreload"[^>]*>/g);
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module"[^>]*><\/script>/g, '')
  .replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
const out = [title, preloads, styles, body.trim(), scripts].filter(Boolean).join('\n');
writeFileSync(file, out + '\n');
console.log('artifact page:', out.length, 'bytes');
