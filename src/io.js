// Import / export: JSON (full fidelity), Markdown outline, OPML, pasted lists.
import { createMap, createNode, getIndex, migrate, serialize, uid } from './model.js';

// ---------- JSON ----------
export function exportJSON(doc) {
  return JSON.stringify(serialize(doc), null, 2);
}

export function importJSON(text) {
  const doc = migrate(JSON.parse(text));
  doc.id = uid('map'); // imports never overwrite an existing map
  return doc;
}

// ---------- outline text (paste, markdown) ----------
const BULLET = /^(\s*)(?:[-*+•▪◦]|\d+[.)]|\[[ xX]\])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Parse a bulleted / numbered / markdown / indented list into a tree.
 * Headings become levels above bullets. Non-bullet lines directly under an
 * item become part of its note.
 * @returns {{title:string, note:string, children:Array}[]}
 */
export function parseOutline(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const roots = [];
  // stack of {level, item}
  const stack = [];
  let headingBase = 0; // indent offset for bullets under the current heading
  const push = (level, title) => {
    const item = { title: title.trim(), note: '', children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].item.children.push(item);
    else roots.push(item);
    stack.push({ level, item });
    return item;
  };
  // indentation unit: a tab, or the smallest space indent used (usually 2 or 4)
  let unit = Infinity;
  for (const raw of lines) {
    const ws = raw.match(/^( *)\S/);
    if (ws && ws[1].length) unit = Math.min(unit, ws[1].length);
  }
  if (!Number.isFinite(unit)) unit = 2;
  const indentOf = (ws) => (ws.match(/\t/g) || []).length + ws.replace(/\t/g, '').length / unit;
  let last = null;
  let minIndent = Infinity;
  for (const raw of lines) {
    const m = raw.match(BULLET);
    if (m && m[2].trim()) minIndent = Math.min(minIndent, indentOf(m[1]));
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;
  const hasBullets = lines.some((l) => BULLET.test(l));
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const h = raw.match(HEADING);
    if (h) {
      const level = h[1].length - 1;
      last = push(level, h[2]);
      headingBase = h[1].length * 100;
      continue;
    }
    const m = raw.match(BULLET);
    if (m) {
      if (!m[2].trim()) continue;
      const level = headingBase + 1 + (indentOf(m[1]) - minIndent);
      last = push(level, stripInline(m[2]));
      continue;
    }
    if (!hasBullets) {
      // plain indented lines: treat each as an item
      const ws = raw.match(/^(\s*)/)[1];
      last = push(headingBase + 1 + indentOf(ws), stripInline(raw.trim()));
      continue;
    }
    if (last) last.note = (last.note ? last.note + '\n' : '') + raw.trim().replace(/^>\s?/, '');
    else last = push(headingBase + 1, stripInline(raw.trim()));
  }
  return roots;
}

function stripInline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`(.+?)`/g, '$1').trim();
}

/** Build a new map from a tree of items. A single top-level item becomes the root. */
export function mapFromTree(items, fallbackTitle = 'Imported map') {
  let rootItem;
  if (items.length === 1) rootItem = items[0];
  else rootItem = { title: fallbackTitle, note: '', children: items };
  const doc = createMap(rootItem.title || fallbackTitle, rootItem.title || fallbackTitle);
  const root = doc.nodes[doc.rootId];
  root.note = rootItem.note || '';
  const add = (list, parentId) => list.forEach((item, i) => {
    const n = createNode({ parentId, title: item.title, note: item.note || '', order: i });
    doc.nodes[n.id] = n;
    if (item.children?.length) add(item.children, n.id);
  });
  add(rootItem.children || [], root.id);
  return doc;
}

// ---------- Markdown ----------
export function exportMarkdown(doc) {
  const idx = getIndex(doc);
  const out = [`# ${doc.title || doc.nodes[doc.rootId].title || 'Mind map'}`, ''];
  const emit = (id, depth) => {
    const n = doc.nodes[id];
    const pad = '  '.repeat(depth);
    const tags = n.tags.length ? ' ' + n.tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' ') : '';
    out.push(`${pad}- ${n.icon ? n.icon + ' ' : ''}${n.title || 'Untitled'}${tags}`);
    if (n.note) for (const line of n.note.split('\n')) out.push(`${pad}  > ${line}`);
    idx.kids(id).forEach((k) => emit(k, depth + 1));
  };
  idx.roots.forEach((r) => emit(r, 0));
  const links = Object.values(doc.links);
  if (links.length) {
    out.push('', '## Links', '');
    for (const l of links) {
      out.push(`- ${doc.nodes[l.from]?.title || '?'} → ${doc.nodes[l.to]?.title || '?'}${l.label ? ` (${l.label})` : ''}`);
    }
  }
  return out.join('\n') + '\n';
}

export function importMarkdown(text) {
  const lines = String(text).split(/\r?\n/);
  let title = null;
  // A leading single H1 is the map title; stop at a trailing "## Links" section we generated.
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  const h1Count = lines.filter((l) => /^#\s+/.test(l)).length;
  let body = lines;
  if (h1 >= 0 && h1Count === 1) {
    title = lines[h1].replace(/^#\s+/, '').trim();
    body = lines.slice(h1 + 1);
  }
  const linksAt = body.findIndex((l) => /^##\s+Links\s*$/.test(l));
  if (linksAt >= 0) body = body.slice(0, linksAt);
  const items = parseOutline(body.join('\n'));
  let doc;
  if (items.length === 1) doc = mapFromTree(items, title || undefined);
  else if (title) doc = mapFromTree([{ title, note: '', children: items }], title);
  else doc = mapFromTree(items);
  if (title) doc.title = title;
  return doc;
}

// ---------- OPML ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

export function exportOPML(doc) {
  const idx = getIndex(doc);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${esc(doc.title)}</title><dateModified>${new Date(doc.updatedAt).toUTCString()}</dateModified></head>`,
    '  <body>',
  ];
  const emit = (id, depth) => {
    const n = doc.nodes[id];
    const pad = '  '.repeat(depth + 2);
    const attrs = `text="${esc(n.title || 'Untitled')}"${n.note ? ` _note="${esc(n.note)}"` : ''}`;
    const kids = idx.kids(id);
    if (!kids.length) out.push(`${pad}<outline ${attrs}/>`);
    else {
      out.push(`${pad}<outline ${attrs}>`);
      kids.forEach((k) => emit(k, depth + 1));
      out.push(`${pad}</outline>`);
    }
  };
  idx.roots.forEach((r) => emit(r, 0));
  out.push('  </body>', '</opml>');
  return out.join('\n') + '\n';
}

export function importOPML(text) {
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error('Invalid OPML file');
  const title = xml.querySelector('head > title')?.textContent?.trim() || 'Imported map';
  const body = xml.querySelector('body');
  if (!body) throw new Error('OPML has no body');
  const walk = (el) => [...el.children].filter((c) => c.tagName.toLowerCase() === 'outline').map((o) => ({
    title: o.getAttribute('text') || o.getAttribute('title') || '',
    note: o.getAttribute('_note') || '',
    children: walk(o),
  }));
  const items = walk(body);
  const doc = mapFromTree(items, title);
  doc.title = title;
  return doc;
}

/** Detect format from file name / content and return a new doc. */
export function importAny(name, text) {
  const lower = (name || '').toLowerCase();
  const trimmed = text.trimStart();
  if (lower.endsWith('.json') || trimmed.startsWith('{')) return importJSON(text);
  if (lower.endsWith('.opml') || lower.endsWith('.xml') || trimmed.startsWith('<')) return importOPML(text);
  return importMarkdown(text);
}
