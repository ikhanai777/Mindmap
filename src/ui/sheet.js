// Bottom sheet: node details. Peeks at 30% height, drags to 90%.
import { store, get, set } from '../store.js';
import * as A from '../actions.js';
import { getIndex, SHAPES, SHAPE_MEANING, LINK_STYLES } from '../model.js';
import { themeOf } from '../themes.js';
import { $, h, icon, renderMarkdown, toggleChecklist, prompt, haptic } from './util.js';

const SHAPE_GLYPH = { sphere: '●', cube: '■', octahedron: '◆', ring: '○' };

export function initSheet(app) {
  const sheet = $('#sheet');
  const body = $('#sheet-body');
  const handle = $('#sheet-handle');
  let currentId = null;
  let noteTab = null;

  function setState(state) {
    sheet.dataset.state = state;
    document.body.dataset.sheet = state;
    if (get().sheet !== state) set({ sheet: state });
  }

  function open(id, state = 'peek') {
    if (currentId !== id) noteTab = null;
    currentId = id;
    render(true);
    setState(state);
  }

  function close() {
    setState('hidden');
    if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
  }

  function render(force = false) {
    const doc = get().doc;
    const n = currentId && doc?.nodes[currentId];
    if (!n) { if (sheet.dataset.state !== 'hidden') close(); return; }
    if (!force && sheet.contains(document.activeElement) && document.activeElement.matches('input,textarea')) return;
    const scroll = body.scrollTop;
    const theme = themeOf(doc);
    const idx = getIndex(doc);
    const kids = idx.kids(n.id);
    const color = app.scene.colorOf(n.id)?.getStyle() || theme.accent;

    const titleInput = h('input', {
      value: n.title,
      placeholder: n.id === doc.rootId ? 'Tap to name your idea' : 'Untitled idea',
      'aria-label': 'Title',
      enterkeyhint: 'done',
      oninput: (e) => A.setTitle(n.id, e.target.value),
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onblur: () => setTimeout(() => render(), 0),
    });

    const shapeRow = h('div.row', { role: 'group', 'aria-label': 'Shape' },
      SHAPES.map((s) => h('button.pill', {
        'aria-pressed': String(n.shape === s),
        title: SHAPE_MEANING[s],
        onclick: () => A.updateNode(n.id, { shape: s }, { label: 'Shape' }),
      }, h('span', { 'aria-hidden': 'true' }, SHAPE_GLYPH[s]), SHAPE_MEANING[s])));

    const colorRow = h('div.row', { role: 'group', 'aria-label': 'Color' },
      h('button.swatch.auto', { 'aria-label': 'Automatic color', 'aria-pressed': String(!n.color), onclick: () => A.updateNode(n.id, { color: null }, { label: 'Color' }) }),
      theme.palette.map((c) => h('button.swatch', {
        style: { background: c },
        'aria-label': 'Color ' + c,
        'aria-pressed': String(n.color?.toLowerCase() === c.toLowerCase()),
        onclick: () => A.updateNode(n.id, { color: c }, { label: 'Color' }),
      })));

    const s = get();
    const actions = h('div.row',
      h('button.pill', { onclick: () => app.startQuickAdd(n.id) }, '＋ Child'),
      h('button.pill', { onclick: () => app.startLink(n.id) }, '🔗 Link'),
      h('button.pill', { 'aria-pressed': String(s.focusId === n.id), onclick: () => app.toggleFocus(n.id) }, '◎ Focus mode'),
      kids.length ? h('button.pill', { onclick: () => A.toggleCollapse(n.id) }, n.collapsed ? `⊕ Expand (${idx.descCount.get(n.id)})` : '⊖ Collapse') : null,
      n.pos ? h('button.pill', { onclick: () => A.unpinNode(n.id) }, '📌 Unpin') : null,
      s.mode === 'walk' ? h('button.pill', { onclick: () => app.rig.walkTo(n.id) }, '🚶 Walk here') : null,
      h('button.pill', { onclick: () => app.addWaypointHere() }, '⚑ Waypoint'),
      n.id !== doc.rootId || kids.length ? h('button.pill.danger', { onclick: () => app.deleteWithUndo([n.id]) }, 'Delete') : null,
    );

    const sizeRow = h('div.row',
      h('label.small.muted', { for: 'size-range' }, 'Size'),
      h('input', {
        id: 'size-range', type: 'range', min: '0.4', max: '3', step: '0.05', value: String(n.size), style: { flex: '1' },
        oninput: (e) => A.updateNode(n.id, { size: +e.target.value }, { coalesce: 'size:' + n.id, label: 'Resize' }),
      }));

    const tagInput = h('input', {
      placeholder: n.tags.length ? 'Add tag' : 'Add tags (e.g. decision)',
      'aria-label': 'Add tag',
      enterkeyhint: 'done',
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = e.target.value.trim().replace(/^#/, '');
          if (v && !n.tags.includes(v)) A.updateNode(n.id, { tags: [...n.tags, v] }, { label: 'Tag' });
          e.target.value = '';
          requestAnimationFrame(() => { render(true); $('.tags input', body)?.focus(); });
        }
      },
    });
    const tags = h('div.tags', n.tags.map((t) => h('span.tag', '#' + t,
      h('button', { 'aria-label': 'Remove tag ' + t, onclick: () => A.updateNode(n.id, { tags: n.tags.filter((x) => x !== t) }, { label: 'Untag' }) }, '×'))), tagInput);

    if (noteTab === null) noteTab = n.note ? 'preview' : 'edit';
    const noteArea = noteTab === 'edit'
      ? h('textarea.note', {
        value: n.note,
        placeholder: 'Markdown note: text, - [ ] checklists, links…',
        'aria-label': 'Note (markdown)',
        oninput: (e) => A.updateNode(n.id, { note: e.target.value }, { coalesce: 'note:' + n.id, label: 'Edit note' }),
        onblur: () => setTimeout(() => render(), 0),
      })
      : h('div.note-preview', { onclick: (e) => {
        const cb = e.target.closest('input[type=checkbox]');
        if (cb) A.updateNode(n.id, { note: toggleChecklist(n.note, +cb.dataset.line) }, { label: 'Checklist' });
        else if (!e.target.closest('a')) { noteTab = 'edit'; render(true); setState('full'); $('textarea.note', body)?.focus(); }
      } });
    if (noteTab === 'preview') noteArea.innerHTML = renderMarkdown(n.note);

    const links = Object.values(doc.links).filter((l) => l.from === n.id || l.to === n.id);
    const linkList = links.map((l) => {
      const other = doc.nodes[l.from === n.id ? l.to : l.from];
      return h('div.link-row',
        h('span', { 'aria-hidden': 'true' }, l.from === n.id ? '→' : '←'),
        h('button.grow', { style: { border: 0, background: 'none', textAlign: 'left', minHeight: '40px' }, onclick: () => app.selectAndFly(other.id) }, other.title || 'Untitled'),
        h('input', { value: l.label, placeholder: 'label', 'aria-label': 'Link label', oninput: (e) => A.updateLink(l.id, { label: e.target.value }, 'label:' + l.id) }),
        h('select', { 'aria-label': 'Link style', onchange: (e) => A.updateLink(l.id, { style: e.target.value }) },
          LINK_STYLES.map((st) => h('option', { value: st, selected: l.style === st }, st))),
        h('button.icon-btn', { 'aria-label': l.directed === false ? 'Make directed' : 'Make undirected', title: 'Directed', onclick: () => A.updateLink(l.id, { directed: l.directed === false }) }, l.directed === false ? '—' : '⇢'),
        h('button.icon-btn', { 'aria-label': 'Delete link', onclick: () => A.deleteLink(l.id) }, '×'));
    });

    const fmt = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    body.replaceChildren(
      h('div.sheet-title',
        h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', background: color, flex: 'none', boxShadow: `0 0 10px ${color}` } }),
        h('button.emoji-btn', { 'aria-label': 'Set icon', onclick: async () => {
          const v = await prompt('Icon (emoji, empty to clear)', n.icon, { placeholder: '💡' });
          if (v !== null) A.updateNode(n.id, { icon: [...v].slice(0, 2).join('') }, { label: 'Icon' });
        } }, n.icon || '☺'),
        titleInput,
        h('button.icon-btn', { 'aria-label': 'Close details', html: icon('close'), onclick: () => close() }),
      ),
      shapeRow, colorRow, actions,
      h('div.section-label', 'Tags'), tags,
      h('div.section-label', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, 'Note',
        h('div.tabs', { role: 'tablist' },
          h('button', { role: 'tab', 'aria-selected': String(noteTab === 'edit'), onclick: () => { noteTab = 'edit'; render(true); setState('full'); } }, 'Edit'),
          h('button', { role: 'tab', 'aria-selected': String(noteTab === 'preview'), onclick: () => { noteTab = 'preview'; render(true); } }, 'Preview'))),
      noteArea,
      h('div.section-label', 'Appearance'), sizeRow,
      links.length ? h('div.section-label', 'Links') : null,
      ...linkList,
      h('p.small.muted', `Created ${fmt(n.createdAt)} · Edited ${fmt(n.updatedAt)}${n.pos ? ' · Pinned' : ''}`),
    );
    body.scrollTop = scroll;
  }

  // ---------- drag the handle ----------
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    const rect = sheet.getBoundingClientRect();
    drag = { y0: e.clientY, top0: rect.top, t0: performance.now(), moved: false };
    sheet.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    const H = sheet.offsetHeight;
    const baseTop = window.innerHeight - H;
    const y = Math.max(0, drag.top0 + dy - baseTop);
    sheet.style.transform = `translateY(${y}px)`;
  });
  const end = (e) => {
    if (!drag) return;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    const dy = e.clientY - drag.y0;
    const v = dy / Math.max(1, performance.now() - drag.t0);
    const state = sheet.dataset.state;
    if (!drag.moved) setState(state === 'full' ? 'peek' : 'full');
    else {
      const H = sheet.offsetHeight, top = drag.top0 + dy - (window.innerHeight - H);
      const peekY = H - window.innerHeight * 0.3;
      if (v > 0.8 || top > peekY + (H - peekY) / 2) close();
      else if (v < -0.6 || top < peekY / 2) setState('full');
      else setState('peek');
    }
    haptic('light');
    drag = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  store.subscribe((s, prev) => {
    if (s.rev !== prev.rev || s.mode !== prev.mode || s.focusId !== prev.focusId) render();
    if (s.sheet !== prev.sheet && sheet.dataset.state !== s.sheet) { sheet.dataset.state = s.sheet; document.body.dataset.sheet = s.sheet; }
  });

  return { open, close, render: () => render(true), get id() { return currentId; }, setState };
}
