import { store } from '../store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny element factory: h('button.pill', {onclick}, 'text', child) */
export function h(tag, props = {}, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- haptics ----------
const PATTERNS = { light: 8, medium: 18, success: [12, 40, 18], warn: [30, 30, 30] };
export function haptic(kind = 'light') {
  if (!store.getState().settings.haptics) return;
  try { navigator.vibrate?.(PATTERNS[kind] ?? 8); } catch { /* unsupported */ }
}

// ---------- toast ----------
let toastTimer = null;
export function toast(message, action = null, ms = 3200) {
  const el = $('#toast');
  el.replaceChildren(h('span', {}, message));
  if (action) el.append(h('button', { onclick: () => { hideToast(); action.run(); } }, action.label));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() {
  $('#toast').hidden = true;
}

// ---------- prompt dialog ----------
export function prompt(label, value = '', { placeholder = '', ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    const bd = $('#dialog-backdrop'), form = $('#dialog'), input = $('#dialog-input');
    $('#dialog-label').textContent = label;
    $('#dialog-ok').textContent = ok;
    input.value = value;
    input.placeholder = placeholder;
    bd.hidden = false;
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const done = (v) => {
      bd.hidden = true;
      form.onsubmit = null;
      $('#dialog-cancel').onclick = null;
      bd.onclick = null;
      resolve(v);
    };
    form.onsubmit = (e) => { e.preventDefault(); done(input.value.trim()); };
    $('#dialog-cancel').onclick = () => done(null);
    bd.onclick = (e) => { if (e.target === bd) done(null); };
  });
}

export async function confirmDialog(label, ok = 'Delete') {
  const input = $('#dialog-input');
  input.hidden = true;
  const res = await prompt(label, '', { ok });
  input.hidden = false;
  return res !== null;
}

// ---------- files ----------
export async function download(filename, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  // prefer the share sheet on phones that support sharing files
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const slug = (s) => (String(s || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map').slice(0, 60);

// ---------- markdown (notes) ----------
/** Minimal, safe markdown: headings, bold/italic/code, links, lists, checklists. */
export function renderMarkdown(src) {
  const lines = escapeHtml(src || '').split('\n');
  const out = [];
  let list = null;
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  lines.forEach((line, i) => {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li class="check"><label><input type="checkbox" data-line="${i}" ${m[1] !== ' ' ? 'checked' : ''}/> ${inline(m[2])}</label></li>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  });
  closeList();
  return out.join('') || '<p class="muted">No note yet.</p>';
}

/** Toggle the checkbox on a given line of markdown source. */
export function toggleChecklist(src, lineNo) {
  const lines = src.split('\n');
  lines[lineNo] = lines[lineNo].replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

// ---------- fuzzy search ----------
/** Score how well `q` matches `text` (0 = no match). Substring beats subsequence. */
export function fuzzyScore(q, text) {
  if (!q || !text) return 0;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i >= 0) return 100 - Math.min(60, i) + (i === 0 || /\W/.test(t[i - 1]) ? 20 : 0);
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, ti);
    if (j < 0) return 0;
    streak = j === ti ? streak + 1 : 0;
    score += 1 + streak * 2 - Math.min(3, (j - ti) * 0.2);
    ti = j + 1;
  }
  return Math.max(1, score);
}

/** Horizontal swipe detection (pointer events with a touch fallback for text inputs). */
export function onSwipe(el, cb, min = 50) {
  let last = 0;
  const check = (dx, dy, e) => {
    if (Math.abs(dx) > min && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - last > 350) {
      last = performance.now();
      cb(dx > 0 ? 'right' : 'left', e);
    }
  };
  let sx = 0, sy = 0;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  el.addEventListener('pointerup', (e) => check(e.clientX - sx, e.clientY - sy, e));
  let tx = 0, ty = 0;
  el.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    check(t.clientX - tx, t.clientY - ty, e);
  }, { passive: true });
}
