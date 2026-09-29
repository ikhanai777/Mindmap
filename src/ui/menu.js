// Map menu: maps, layout, theme, tour waypoints, clusters, export/import,
// snapshots, settings and help.
import { store, get, set, canUndo, canRedo } from '../store.js';
import * as A from '../actions.js';
import { LAYOUTS, LAYOUT_NAMES, createMap } from '../model.js';
import { THEMES } from '../themes.js';
import * as db from '../db.js';
import { exportJSON, exportMarkdown, exportOPML, importAny } from '../io.js';
import { buildViewerHTML } from '../exportHtml.js';
import { $, h, icon, toast, prompt, confirmDialog, download, slug } from './util.js';

export function initMenu(app) {
  const panel = $('#menu');
  const body = $('#menu-body');
  const fileInput = $('#file-input');
  let view = 'main';

  const section = (label) => h('div.section-label', label);
  const item = (label, onclick, extra = {}) => h('button.menu-item', { onclick, ...extra }, label);

  async function render() {
    if (panel.hidden) return;
    const s = get();
    const doc = s.doc;
    if (view === 'maps') return renderMaps();
    if (view === 'snapshots') return renderSnapshots();
    const waypoints = Object.values(doc.waypoints).sort((a, b) => a.order - b.order);
    const clusters = Object.values(doc.clusters);
    const settings = s.settings;
    const setSetting = (k, v) => app.setSetting(k, v);
    const choice = (label, current, options, onPick) => h('div', {},
      section(label),
      h('div.options', options.map(([v, name]) => h('button.pill', { 'aria-pressed': String(current === v), onclick: () => onPick(v) }, name))));

    body.replaceChildren(
      h('input.map-title-input', { value: doc.title, 'aria-label': 'Map title', oninput: (e) => A.setMapField('title', e.target.value) }),
      h('div.row',
        h('button.pill', { onclick: () => { view = 'maps'; render(); } }, '🗂 All maps'),
        h('button.pill', { onclick: () => app.newMap() }, '＋ New map'),
        h('button.pill', { disabled: !canUndo(), onclick: () => app.undo(), html: icon('undo') + ' Undo' }),
        h('button.pill', { disabled: !canRedo(), onclick: () => app.redo(), html: icon('redo') + ' Redo' })),

      choice('Layout', doc.layoutMode, LAYOUTS.map((l) => [l, LAYOUT_NAMES[l]]), (v) => app.setLayout(v)),
      choice('Theme', doc.theme, Object.entries(THEMES).map(([k, t]) => [k, t.name]), (v) => A.setMapField('theme', v)),

      section('Tour'),
      h('div.row',
        h('button.pill', { onclick: () => app.addWaypointHere() }, '⚑ Save current view'),
        waypoints.length ? h('button.pill', { onclick: () => { close(); app.tour.start(); }, html: icon('play') + ' Play tour' }) : null),
      ...waypoints.map((w, i) => h('div.link-row',
        h('span.muted.small', String(i + 1)),
        h('button.grow', { style: { border: 0, background: 'none', textAlign: 'left', minHeight: '40px' }, onclick: () => { close(); app.tour.goto(i); } }, w.name),
        h('button.icon-btn', { 'aria-label': 'Move up', onclick: () => A.moveWaypoint(w.id, -1) }, '↑'),
        h('button.icon-btn', { 'aria-label': 'Rename', onclick: async () => { const v = await prompt('Waypoint name', w.name); if (v) A.updateWaypoint(w.id, { name: v }); } }, '✎'),
        h('button.icon-btn', { 'aria-label': 'Delete waypoint', onclick: () => A.deleteWaypoint(w.id) }, '×'))),

      clusters.length ? section('Clusters') : null,
      ...clusters.map((c) => h('div.link-row',
        h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', background: c.color, flex: 'none' } }),
        h('button.grow', { style: { border: 0, background: 'none', textAlign: 'left', minHeight: '40px' }, onclick: () => { close(); app.flyToIds(c.nodeIds); } }, `${c.name} · ${c.nodeIds.length}`),
        h('button.icon-btn', { 'aria-label': 'Rename cluster', onclick: async () => { const v = await prompt('Cluster name', c.name); if (v) A.updateCluster(c.id, { name: v }); } }, '✎'),
        h('button.icon-btn', { 'aria-label': 'Delete cluster', onclick: () => A.deleteCluster(c.id) }, '×'))),

      section('Export'),
      h('div.options',
        h('button.pill', { onclick: () => exportAs('json') }, 'JSON'),
        h('button.pill', { onclick: () => exportAs('md') }, 'Markdown'),
        h('button.pill', { onclick: () => exportAs('opml') }, 'OPML'),
        h('button.pill', { onclick: () => exportAs('png') }, 'PNG snapshot'),
        h('button.pill', { onclick: () => exportAs('html'), style: { gridColumn: '1 / -1' } }, 'HTML viewer with walkaround')),

      section('Import'),
      h('div.options',
        h('button.pill', { onclick: () => fileInput.click() }, 'Open file…'),
        h('button.pill', { onclick: () => pasteBranch() }, 'Paste list as branch')),
      h('p.small.muted', 'JSON, Markdown or OPML (FreeMind, XMind, MindNode exports).'),

      section('History'),
      item('🕑 Daily snapshots', () => { view = 'snapshots'; render(); }),

      section('Settings'),
      h('div', {}, h('div.small.muted', 'Bloom'), h('div.options', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']].map(([v, n]) => h('button.pill', { 'aria-pressed': String(settings.bloom === v), onclick: () => setSetting('bloom', v) }, n)))),
      h('div', {}, h('div.small.muted', { style: { marginTop: '8px' } }, 'Reduce motion'), h('div.options', [['system', 'System'], ['on', 'On'], ['off', 'Off']].map(([v, n]) => h('button.pill', { 'aria-pressed': String(settings.reduceMotion === v), onclick: () => setSetting('reduceMotion', v) }, n)))),
      h('div', {}, h('div.small.muted', { style: { marginTop: '8px' } }, 'Label size'), h('div.options', [[0.8, 'Small'], [1, 'Medium'], [1.3, 'Large'], [1.7, 'Huge']].map(([v, n]) => h('button.pill', { 'aria-pressed': String(settings.labelScale === v), onclick: () => setSetting('labelScale', v) }, n)))),
      h('div.row',
        h('button.pill', { 'aria-pressed': String(settings.gyro), onclick: () => app.toggleGyro() }, '📱 Gyroscope look'),
        h('button.pill', { 'aria-pressed': String(settings.haptics), onclick: () => setSetting('haptics', !settings.haptics) }, '〰 Haptics')),

      section('Help'),
      item('▶ Replay the intro tour', () => { close(); app.onboarding.start(true); }),
      h('details', {},
        h('summary.menu-item', 'Gestures & shortcuts'),
        h('div.small.muted', { html: `
          <p><b>Tap</b> node: select · empty: deselect/hide chrome<br><b>Double-tap</b> node: focus · empty: recenter<br>
          <b>Long-press</b> node: radial menu · empty: add floating idea<br><b>Drag</b> node: move / drop on another to reparent<br>
          <b>Pinch</b> node: resize · empty: zoom<br><b>Two-finger tap</b> or <b>shake</b>: undo</p>
          <p><b>Keyboard</b>: N / Enter add · Tab add child · Del delete · ⌘Z / ⇧⌘Z undo/redo · / search · O outline · 1-3 modes · F focus · H recenter · WASD move</p>` })),
      h('p.small.muted', { style: { marginTop: '18px' } }, 'Constellate · maps live on this device and work offline.'),
    );
  }

  async function renderMaps() {
    const maps = await db.listMaps();
    const cur = get().doc.id;
    body.replaceChildren(
      h('button.menu-item', { onclick: () => { view = 'main'; render(); } }, '← Back'),
      section('Your maps'),
      h('button.menu-item', { onclick: () => app.newMap() }, '＋ New map'),
      ...maps.map((m) => h('div.link-row',
        h('button.grow.menu-item' + (m.id === cur ? '.current' : ''), { onclick: () => { app.openMap(m.id); close(); } },
          h('span.grow', m.title || 'Untitled'), h('span.small.muted', `${m.count} · ${new Date(m.updatedAt).toLocaleDateString()}`)),
        h('button.icon-btn', { 'aria-label': 'Duplicate', onclick: async () => {
          const src = await db.loadMap(m.id);
          const copy = importAny('x.json', exportJSON(src));
          copy.title = src.title + ' copy';
          await db.saveMap(copy);
          renderMaps();
        } }, '⧉'),
        h('button.icon-btn', { 'aria-label': 'Delete map', onclick: async () => {
          if (!(await confirmDialog(`Delete “${m.title}” from this device?`))) return;
          await db.deleteMap(m.id);
          if (m.id === cur) await app.openLatestOrNew();
          renderMaps();
        } }, '🗑'))),
    );
  }

  async function renderSnapshots() {
    const doc = get().doc;
    const snaps = await db.listSnapshots(doc.id);
    body.replaceChildren(
      h('button.menu-item', { onclick: () => { view = 'main'; render(); } }, '← Back'),
      section('Daily snapshots'),
      h('p.small.muted', 'One snapshot is kept per day you edit (last 30). Restoring opens it as a new map.'),
      ...(snaps.length ? snaps.map((sn) => h('button.menu-item', { onclick: async () => {
        const restored = await db.loadSnapshot(sn.key);
        restored.id = createMap().id;
        restored.title = `${restored.title} (${sn.date})`;
        await db.saveMap(restored);
        app.loadDocument(restored);
        close();
        toast('Snapshot opened as a new map');
      } }, h('span.grow', sn.date), h('span.small.muted', `${sn.count} ideas`))) : [h('p.muted', 'No snapshots yet.')]),
    );
  }

  async function exportAs(kind) {
    const doc = get().doc;
    const name = slug(doc.title);
    try {
      if (kind === 'json') await download(`${name}.json`, exportJSON(doc), 'application/json');
      else if (kind === 'md') await download(`${name}.md`, exportMarkdown(doc), 'text/markdown');
      else if (kind === 'opml') await download(`${name}.opml`, exportOPML(doc), 'text/x-opml');
      else if (kind === 'png') {
        close();
        await new Promise((r) => requestAnimationFrame(r));
        const url = app.scene.snapshotPNG();
        const blob = await (await fetch(url)).blob();
        await download(`${name}.png`, blob, 'image/png');
      } else if (kind === 'html') {
        const colors = {};
        for (const id of Object.keys(doc.nodes)) colors[id] = '#' + (app.scene.colorOf(id)?.getHexString() || '7cf7ff');
        await download(`${name}.html`, buildViewerHTML(doc, app.scene.positionsSnapshot(), colors), 'text/html');
      }
    } catch (err) {
      toast('Export failed: ' + (err?.message || err));
    }
  }

  async function pasteBranch() {
    const text = await prompt('Paste a bulleted or markdown list', '', { placeholder: '- idea\n  - sub-idea', multiline: true, ok: 'Add branch' });
    if (!text) return;
    close();
    app.pasteOutline(text);
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const doc = importAny(file.name, await file.text());
      await db.saveMap(doc);
      app.loadDocument(doc);
      close();
      toast(`Imported “${doc.title}” · ${Object.keys(doc.nodes).length} ideas`);
    } catch (err) {
      toast('Could not import: ' + (err?.message || err));
    }
  });

  function open() {
    view = 'main';
    panel.hidden = false;
    set({ panel: 'menu' });
    render();
  }

  function close() {
    panel.hidden = true;
    if (get().panel === 'menu') set({ panel: null });
  }

  panel.querySelector('[data-close]').addEventListener('click', close);
  store.subscribe((s, prev) => {
    if (panel.hidden) return;
    if (view === 'main' && (s.settings !== prev.settings || s.doc !== prev.doc || (s.rev !== prev.rev && !panel.contains(document.activeElement)))) render();
  });

  return { open, close, get isOpen() { return !panel.hidden; } };
}
