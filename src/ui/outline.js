// Outline mode: a flat list view of the same map. Typing an indented list builds
// the 3D tree live. Doubles as the screen-reader view (every node reachable without 3D).
import { store, get, set } from '../store.js';
import * as A from '../actions.js';
import { getIndex } from '../model.js';
import { $, h, onSwipe } from './util.js';

export function initOutline(app) {
  const panel = $('#outline');
  const list = $('#outline-list');
  const rows = new Map(); // id -> row element
  let pendingFocus = null; // {id, caret}

  function visibleOrder(doc) {
    const idx = getIndex(doc);
    const out = [];
    const walk = (id) => {
      out.push(id);
      if (!doc.nodes[id].collapsed) idx.kids(id).forEach(walk);
    };
    idx.roots.forEach(walk);
    return out;
  }

  function focusRow(id, caret = 'end') {
    const row = rows.get(id);
    const input = row?.querySelector('input');
    if (!input) return;
    input.focus({ preventScroll: false });
    const pos = caret === 'start' ? 0 : input.value.length;
    try { input.setSelectionRange(pos, pos); } catch { /* not supported */ }
    row.scrollIntoView({ block: 'nearest' });
  }

  function makeRow(id) {
    const input = h('input', {
      enterkeyhint: 'next',
      autocomplete: 'off',
      'aria-label': 'Idea title',
    });
    const bullet = h('button.o-bullet', { 'aria-label': 'Show in 3D' }, h('i'));
    const count = h('span.o-count');
    const row = h('div.o-row', { role: 'treeitem' }, bullet, input, count);
    row.dataset.id = id;
    bullet.addEventListener('click', () => {
      const doc = get().doc;
      const n = doc.nodes[row.dataset.id];
      if (!n) return;
      if (getIndex(doc).kids(n.id).length && (n.collapsed || get().selection.includes(n.id))) A.toggleCollapse(n.id);
      app.select(n.id, { fly: true, sheet: false });
    });
    input.addEventListener('focus', () => app.select(row.dataset.id, { fly: false, sheet: false }));
    input.addEventListener('input', () => A.setTitle(row.dataset.id, input.value));
    input.addEventListener('keydown', (e) => onKey(e, row.dataset.id, input));
    onSwipe(row, (dir) => {
      const id2 = row.dataset.id;
      const ok = dir === 'right' ? A.indent(id2) : A.outdent(id2);
      if (ok) { pendingFocus = { id: id2 }; render(); app.haptic('light'); }
    });
    return row;
  }

  function onKey(e, id, input) {
    handleKey(e, id, input);
    if (pendingFocus) render(); // move focus now, before the next keystroke arrives
  }

  function handleKey(e, id, input) {
    const doc = get().doc;
    const order = visibleOrder(doc);
    const i = order.indexOf(id);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.isComposing) return;
      const caretAtStart = input.selectionStart === 0 && input.value.length > 0;
      if (caretAtStart && id !== doc.rootId) {
        // insert a sibling above
        const n = doc.nodes[id];
        const newId = n.parentId ? A.addChild(n.parentId) : A.addSibling(id);
        const kids = getIndex(get().doc).kids(n.parentId);
        // move new node right before `id`
        const prev = kids[kids.indexOf(id) - 1];
        const order2 = prev ? (get().doc.nodes[prev].order + n.order) / 2 : n.order - 1;
        A.updateNode(newId, { order: order2 }, { structural: true, coalesce: 'insert:' + newId });
        pendingFocus = { id, caret: 'start' };
      } else {
        const newId = id === doc.rootId ? A.addChild(id) : A.addSibling(id);
        pendingFocus = { id: newId };
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ok = e.shiftKey ? A.outdent(id) : A.indent(id);
      if (ok) pendingFocus = { id };
    } else if (e.key === 'Backspace' && !input.value && id !== doc.rootId) {
      if (getIndex(doc).kids(id).length) return;
      e.preventDefault();
      const prev = order[i - 1];
      A.deleteNodes([id]);
      if (prev) pendingFocus = { id: prev };
    } else if (e.key === 'ArrowUp' && order[i - 1]) {
      e.preventDefault();
      if (e.altKey) return;
      focusRow(order[i - 1]);
    } else if (e.key === 'ArrowDown' && order[i + 1]) {
      e.preventDefault();
      focusRow(order[i + 1]);
    } else if (e.key === 'Escape') {
      close();
    } else if ((e.key === '.' || e.key === ' ') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      A.toggleCollapse(id);
    }
  }

  function render() {
    if (panel.hidden) return;
    const s = get();
    const doc = s.doc;
    const idx = getIndex(doc);
    const order = visibleOrder(doc);
    const keep = new Set(order);
    for (const [id, row] of rows) if (!keep.has(id)) { row.remove(); rows.delete(id); }
    let prevEl = null;
    for (const id of order) {
      const n = doc.nodes[id];
      let row = rows.get(id);
      if (!row) { row = makeRow(id); rows.set(id, row); }
      const depth = idx.depth.get(id) || 0;
      row.style.paddingLeft = 4 + depth * 20 + 'px';
      row.setAttribute('aria-level', String(depth + 1));
      const kids = idx.kids(id).length;
      if (kids) row.setAttribute('aria-expanded', String(!n.collapsed));
      else row.removeAttribute('aria-expanded');
      row.classList.toggle('selected', s.selection.includes(id));
      const input = row.querySelector('input');
      if (document.activeElement !== input && input.value !== n.title) input.value = n.title;
      input.placeholder = id === doc.rootId ? 'Tap to name your idea' : 'Untitled';
      const color = app.scene.colorOf(id)?.getStyle() || 'currentColor';
      const bullet = row.querySelector('.o-bullet');
      bullet.style.color = color;
      bullet.classList.toggle('collapsed', !!n.collapsed);
      bullet.setAttribute('aria-label', `${n.title || 'Untitled'}: show in 3D${kids ? (n.collapsed ? ', expand' : '') : ''}`);
      row.querySelector('.o-count').textContent = n.collapsed ? `+${idx.descCount.get(id)}` : '';
      // keep DOM order in sync without re-creating focused inputs
      const expected = prevEl ? prevEl.nextSibling : list.firstChild;
      if (expected !== row) list.insertBefore(row, expected);
      prevEl = row;
    }
    if (pendingFocus) {
      const f = pendingFocus;
      pendingFocus = null;
      focusRow(f.id, f.caret);
    }
  }

  function open() {
    panel.hidden = false;
    set({ panel: 'outline' });
    $('#btn-outline').setAttribute('aria-pressed', 'true');
    app.sheet.close();
    render();
    const target = get().selection.at(-1) || get().doc.rootId;
    requestAnimationFrame(() => rows.get(target)?.scrollIntoView({ block: 'center' }));
  }

  function close() {
    panel.hidden = true;
    if (get().panel === 'outline') set({ panel: null });
    $('#btn-outline').setAttribute('aria-pressed', 'false');
    if (panel.contains(document.activeElement)) document.activeElement.blur();
  }

  panel.querySelector('[data-close]').addEventListener('click', close);
  store.subscribe((s, prev) => {
    if (s.rev !== prev.rev || s.selection !== prev.selection) render();
    if (s.doc !== prev.doc) { rows.forEach((r) => r.remove()); rows.clear(); render(); }
  });

  return { open, close, toggle: () => (panel.hidden ? open() : close()), get isOpen() { return !panel.hidden; } };
}
