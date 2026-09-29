// Search: fuzzy match on titles, notes and tags; matching nodes light up in 3D.
// Filters by tag, color, or date edited.
import { store, get, set } from '../store.js';
import { $, h, escapeHtml, fuzzyScore } from './util.js';

const DAY = 86400000;
const DATES = [['today', 'Today', DAY], ['week', '7 days', 7 * DAY], ['month', '30 days', 30 * DAY]];

export function initSearch(app) {
  const panel = $('#search');
  const input = $('#search-input');
  const filtersEl = $('#search-filters');
  const results = $('#search-results');
  const filters = { tag: null, color: null, date: null };

  function run() {
    const doc = get().doc;
    const q = input.value.trim().toLowerCase();
    const now = Date.now();
    const scored = [];
    for (const n of Object.values(doc.nodes)) {
      if (filters.tag && !n.tags.includes(filters.tag)) continue;
      if (filters.color && (app.scene.colorOf(n.id)?.getHexString() !== filters.color)) continue;
      if (filters.date && now - n.updatedAt > DATES.find((d) => d[0] === filters.date)[2]) continue;
      let score = 1;
      if (q) {
        score = fuzzyScore(q, n.title) * 3 + Math.max(0, ...n.tags.map((t) => fuzzyScore(q, t))) * 2 + fuzzyScore(q, n.note);
        if (!score) continue;
      }
      scored.push([n, score]);
    }
    const active = q || filters.tag || filters.color || filters.date;
    scored.sort((a, b) => b[1] - a[1] || b[0].updatedAt - a[0].updatedAt);
    set({ highlight: active ? new Set(scored.map(([n]) => n.id)) : null });
    renderResults(active ? scored.slice(0, 40) : [], q);
    renderFilters();
  }

  function mark(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return safe;
    return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
  }

  function renderResults(list, q) {
    if (!list.length) {
      results.replaceChildren(input.value || filters.tag || filters.color || filters.date ? h('li.muted', 'No matches') : h('li.muted.small', 'Type to search, or pick a filter.'));
      return;
    }
    results.replaceChildren(...list.map(([n]) => {
      let snippet = '';
      if (q && n.note) {
        const i = n.note.toLowerCase().indexOf(q);
        snippet = i >= 0 ? n.note.slice(Math.max(0, i - 30), i + 90) : '';
      }
      const li = h('li', { role: 'option', tabindex: '0', onclick: () => pick(n.id), onkeydown: (e) => { if (e.key === 'Enter') pick(n.id); } },
        h('span.dot', { style: { background: app.scene.colorOf(n.id)?.getStyle() } }),
        h('div', {},
          h('div', { html: (n.icon ? escapeHtml(n.icon) + ' ' : '') + mark(n.title || 'Untitled', q) + (n.tags.length ? ` <span class="muted small">${n.tags.map((t) => '#' + escapeHtml(t)).join(' ')}</span>` : '') }),
          snippet ? h('div.snippet', { html: mark(snippet.replace(/\n/g, ' '), q) }) : null));
      return li;
    }));
  }

  function renderFilters() {
    const doc = get().doc;
    const tags = [...new Set(Object.values(doc.nodes).flatMap((n) => n.tags))].sort();
    const colors = [...new Set(Object.keys(doc.nodes).map((id) => app.scene.colorOf(id)?.getHexString()).filter(Boolean))];
    const toggle = (k, v) => () => { filters[k] = filters[k] === v ? null : v; run(); };
    filtersEl.replaceChildren(
      ...DATES.map(([k, label]) => h('button.pill', { 'aria-pressed': String(filters.date === k), onclick: toggle('date', k) }, '🕑 ' + label)),
      ...tags.map((t) => h('button.pill', { 'aria-pressed': String(filters.tag === t), onclick: toggle('tag', t) }, '#' + t)),
      ...colors.slice(0, 12).map((c) => h('button.swatch', { style: { background: '#' + c }, 'aria-label': 'Filter color #' + c, 'aria-pressed': String(filters.color === c), onclick: toggle('color', c) })),
    );
  }

  function pick(id) {
    close();
    app.select(id, { fly: true, sheet: true });
  }

  function open() {
    panel.hidden = false;
    set({ panel: 'search' });
    app.sheet.close();
    run();
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    panel.hidden = true;
    input.blur();
    if (get().panel === 'search') set({ panel: null, highlight: null });
    else set({ highlight: null });
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { const first = results.querySelector('li[role=option]'); first?.click(); }
  });
  panel.querySelector('[data-close]').addEventListener('click', close);
  store.subscribe((s, prev) => { if (!panel.hidden && s.rev !== prev.rev) run(); });

  return { open, close, get isOpen() { return !panel.hidden; } };
}
