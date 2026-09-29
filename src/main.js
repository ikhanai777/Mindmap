// Constellate — app bootstrap: wires the store, 3D scene, camera rig, gestures and UI.
import { store, get, set, loadDoc, undo as undoStore, redo as undoRedo, discardNode, DEFAULT_SETTINGS } from './store.js';
import * as A from './actions.js';
import { createMap, createSampleMap, pathTo, subtree } from './model.js';
import { parseOutline } from './io.js';
import { THEMES } from './themes.js';
import * as db from './db.js';
import { Scene3D } from './scene/scene.js';
import { CameraRig } from './camera.js';
import { initGestures } from './gestures.js';
import { initSheet } from './ui/sheet.js';
import { initRadial } from './ui/radial.js';
import { initOutline } from './ui/outline.js';
import { initSearch } from './ui/search.js';
import { initMenu } from './ui/menu.js';
import { initMinimap } from './ui/minimap.js';
import { initSticks } from './ui/sticks.js';
import { initTour } from './ui/tour.js';
import { initOnboarding } from './ui/onboarding.js';
import { $, $$, h, toast, prompt, haptic, onSwipe } from './ui/util.js';

const app = {};
window.constellate = app; // handy for debugging & automated checks

function checkWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

async function boot() {
  if (!checkWebGL()) {
    document.body.replaceChildren(h('p', { style: { padding: '24px' } }, 'Constellate needs WebGL. Please try a recent browser.'));
    return;
  }
  const settings = { ...DEFAULT_SETTINGS, ...(await db.getMeta('settings', {})) };
  set({ settings });
  document.body.classList.toggle('reduce-motion', settings.reduceMotion === 'on');

  const scene = new Scene3D($('#scene'));
  const rig = new CameraRig(scene);
  Object.assign(app, { scene, rig, haptic, toast, prompt });
  app.sheet = initSheet(app);
  app.radial = initRadial(app);
  app.outline = initOutline(app);
  app.search = initSearch(app);
  app.menu = initMenu(app);
  app.minimap = initMinimap(app);
  app.tour = initTour(app);
  app.onboarding = initOnboarding(app);
  initSticks(app);
  initGestures(app);
  initDock();
  initQuickAdd();
  initChrome();

  store.subscribe(() => scene.sync());
  store.subscribe(onStoreChange);

  scene.onLayout = (first) => {
    if (first && !app.restoredView) app.recenter(false);
    if (app.pendingRecenter) { app.pendingRecenter = false; app.recenter(); }
  };

  // open the last map, or the sample map on first run
  let doc = null;
  const lastId = await db.getMeta('lastMap');
  if (lastId) doc = await db.loadMap(lastId).catch(() => null);
  if (!doc) {
    const maps = await db.listMaps().catch(() => []);
    if (maps.length) doc = await db.loadMap(maps[0].id);
  }
  let firstRun = false;
  if (!doc) {
    doc = createSampleMap();
    firstRun = true;
    await db.saveMap(doc).catch(() => {});
  }
  app.loadDocument(doc);

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    rig.update(dt);
    scene.update(now, dt);
    scene.render();
    app.minimap.draw();
    if (rig.changed) { rig.changed = false; scheduleViewSave(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (firstRun) setTimeout(() => app.onboarding.start(), 900);
  if (settings.gyro) rig.enableGyro(true);

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  document.body.classList.add('ready');
}

// ---------- persistence ----------
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const doc = get().doc;
    if (doc) db.saveMap(doc).catch((err) => console.warn('save failed', err));
  }, 350);
}
let viewTimer = null;
function scheduleViewSave() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    const doc = get().doc;
    if (!doc || app.tour.playing) return;
    doc.camera = app.rig.saveView(); // the app always remembers the last view per map
    scheduleSave();
  }, 1200);
}
window.addEventListener('pagehide', () => { const doc = get().doc; if (doc) db.saveMap(doc); });

function onStoreChange(s, prev) {
  if (s.rev !== prev.rev && s.doc === prev.doc) scheduleSave();
  if (s.doc?.theme !== prev.doc?.theme || s.doc !== prev.doc || s.rev !== prev.rev) applyThemeChrome();
  if (s.selection !== prev.selection || s.rev !== prev.rev || s.doc !== prev.doc) renderCrumbs();
  if (s.focusId !== prev.focusId || s.rev !== prev.rev) renderFocusChip();
  if (s.linkFrom !== prev.linkFrom || s.moveTarget !== prev.moveTarget) renderBanner();
  if (s.multi !== prev.multi || s.selection !== prev.selection) renderMultiBar();
  if (s.chromeHidden !== prev.chromeHidden) document.body.classList.toggle('chrome-hidden', s.chromeHidden);
}

function applyThemeChrome() {
  const theme = get().doc?.theme || 'void';
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  $('meta[name=theme-color]').setAttribute('content', THEMES[theme]?.bg[1] || '#07080d');
}

// ---------- documents ----------
app.loadDocument = (doc) => {
  app.tour?.stop();
  app.quickAdd?.close(true);
  loadDoc(doc);
  app.scene.hasLayout = false;
  app.scene.initialized = false;
  app.restoredView = false;
  if (doc.camera && app.rig.restoreView(doc.camera)) {
    app.restoredView = true;
    set({ mode: app.rig.mode });
    document.body.dataset.mode = app.rig.mode;
    syncModeButtons();
  } else {
    app.rig.mode = 'orbit';
    set({ mode: 'orbit' });
    document.body.dataset.mode = 'orbit';
    syncModeButtons();
  }
  db.setMeta('lastMap', doc.id);
  app.sheet.close();
};

app.openMap = async (id) => {
  const doc = await db.loadMap(id);
  if (doc) app.loadDocument(doc);
};

app.openLatestOrNew = async () => {
  const maps = await db.listMaps();
  if (maps.length) return app.openMap(maps[0].id);
  return app.newMap();
};

app.newMap = async () => {
  const doc = createMap('Untitled map');
  doc.theme = get().doc?.theme || 'void';
  await db.saveMap(doc);
  app.loadDocument(doc);
  app.menu.close();
  toast('New map — tap the glowing node to name your idea');
};

// ---------- selection & camera ----------
app.select = (id, { fly = false, sheet = 'peek' } = {}) => {
  const doc = get().doc;
  if (!doc.nodes[id]) return;
  set({ selection: [id], chromeHidden: false });
  if (sheet && !app.outline.isOpen) app.sheet.open(id, sheet === true ? 'peek' : sheet);
  if (fly) {
    if (app.rig.mode === 'walk') app.rig.walkTo(id);
    else app.rig.focusNode(id);
  }
};

app.selectAndFly = (id) => app.select(id, { fly: true, sheet: 'peek' });

app.deselect = () => {
  set({ selection: [] });
  app.sheet.close();
};

app.recenter = (withHaptic = true) => {
  app.rig.recenter(get().doc.rootId);
  if (withHaptic) haptic('light');
};

app.flyToIds = (ids) => {
  const b = app.scene.bounds(new Set(ids));
  const rig = app.rig;
  if (rig.mode === 'orbit') {
    const dir = rig.camera.position.clone().sub(rig.target).normalize();
    rig.flyTo(b.center.clone().addScaledVector(dir, Math.max(8, b.radius * 2.4)), b.center);
  } else {
    const dir = rig.camera.position.clone().sub(b.center).normalize();
    rig.flyTo(b.center.clone().addScaledVector(dir, Math.max(6, b.radius * 2.2)), b.center);
  }
};

function syncModeButtons() {
  const mode = get().mode;
  $$('#dock .segmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
}

app.setMode = (mode, animate = true) => {
  app.rig.setMode(mode, animate);
  set({ mode });
  document.body.dataset.mode = mode;
  syncModeButtons();
  haptic('light');
};

app.setLayout = (mode) => {
  A.setMapField('layoutMode', mode, true);
  app.pendingRecenter = true;
};

app.toggleFocus = (id) => {
  const on = get().focusId !== id;
  set({ focusId: on ? id : null });
  if (on) app.flyToIds(subtree(get().doc, id));
  else app.recenter();
};

// ---------- editing ----------
app.undo = () => {
  const label = undoStore();
  if (label) toast(`Undid: ${label}`, { label: 'Redo', run: () => app.redo() });
  else toast('Nothing to undo');
  haptic('light');
  return !!label;
};

app.redo = () => {
  const label = undoRedo();
  if (label) toast(`Redid: ${label}`, { label: 'Undo', run: () => app.undo() });
  return !!label;
};

app.deleteWithUndo = (ids) => {
  const doc = get().doc;
  const n = ids.length === 1 ? doc.nodes[ids[0]] : null;
  A.deleteNodes(ids);
  app.sheet.close();
  haptic('medium');
  toast(n ? `Deleted “${n.title || 'Untitled'}”` : `Deleted ${ids.length} ideas`, { label: 'Undo', run: () => app.undo() });
};

app.pasteOutline = (text) => {
  const items = parseOutline(text);
  if (!items.length) return;
  const doc = get().doc;
  const parent = get().selection.at(-1) || doc.rootId;
  const ids = A.importBranch(parent, items);
  const count = (list) => list.reduce((s, i) => s + 1 + count(i.children), 0);
  toast(`Pasted ${count(items)} ideas`, { label: 'Undo', run: () => app.undo() });
  haptic('success');
  if (ids[0]) set({ selection: [ids[0]] });
};

app.addWaypointHere = async () => {
  const n = Object.keys(get().doc.waypoints).length + 1;
  const name = await prompt('Name this view', `View ${n}`);
  if (name === null) return;
  const v = app.rig.saveView();
  A.addWaypoint(name || `View ${n}`, v.position, v.target);
  toast('Waypoint saved — play it from Menu → Tour');
  haptic('success');
};

// ---------- link mode ----------
app.startLink = (id) => {
  set({ linkFrom: id, multi: false, moveTarget: false, selection: [id] });
  app.sheet.close();
  haptic('light');
};

app.finishLink = async (to) => {
  const from = get().linkFrom;
  const lid = A.addLink(from, to);
  set({ linkFrom: null, selection: [to] });
  if (!lid) return;
  haptic('success');
  toast('Linked', { label: 'Add label', run: async () => {
    const label = await prompt('Link label (optional)', '', { placeholder: 'depends on' });
    if (label) A.updateLink(lid, { label });
  } }, 4200);
};

// ---------- multi-select ----------
app.startMulti = (id) => {
  set({ multi: true, selection: [id], linkFrom: null });
  app.sheet.close();
  haptic('medium');
};

app.exitMulti = () => {
  set({ multi: false, moveTarget: false });
};

app.finishBulkMove = (target) => {
  const ids = get().selection.filter((x) => x !== target);
  const ok = A.reparent(ids, target);
  set({ multi: false, moveTarget: false, selection: [target] });
  if (ok) { haptic('medium'); toast('Moved', { label: 'Undo', run: () => app.undo() }); }
  else toast('Can’t move an idea inside itself');
};

app.cancelModes = () => set({ linkFrom: null, moveTarget: false });

app.escape = () => {
  if (app.radial.isOpen) return app.radial.close();
  if (app.quickAdd.isOpen) return app.quickAdd.close();
  const s = get();
  if (s.linkFrom || s.moveTarget) return app.cancelModes();
  if (s.multi) return app.exitMulti();
  if (app.search.isOpen) return app.search.close();
  if (app.menu.isOpen) return app.menu.close();
  if (app.outline.isOpen) return app.outline.close();
  if (s.sheet !== 'hidden') return app.sheet.close();
  if (s.focusId) return set({ focusId: null });
  if (s.touring) return app.tour.stop();
  if (s.selection.length) return set({ selection: [] });
};

// ---------- settings ----------
app.setSetting = (key, value) => {
  const settings = { ...get().settings, [key]: value };
  set({ settings });
  db.setMeta('settings', settings);
  document.body.classList.toggle('reduce-motion', settings.reduceMotion === 'on');
};

app.toggleGyro = async () => {
  const on = !get().settings.gyro;
  if (on && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try { await DeviceMotionEvent.requestPermission(); } catch { /* shake-to-undo stays off */ }
  }
  const ok = await app.rig.enableGyro(on);
  if (on && !ok) { toast('Gyroscope not available on this device'); return; }
  app.setSetting('gyro', on);
  if (on) toast('Gyroscope look on — in Fly or Walk, hold the phone up and turn');
};

// ---------- chrome ----------
let idleTimer = null;
app.activity = () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const s = get();
    const busy = s.sheet !== 'hidden' || s.panel || s.multi || s.linkFrom || app.quickAdd?.isOpen || document.activeElement?.matches('input,textarea');
    if (!busy) document.body.classList.add('idle'); // chrome fades after 3 s of inactivity
  }, 3000);
};

app.setChromeHidden = (hidden) => set({ chromeHidden: hidden });

function initChrome() {
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, app.activity, { passive: true }));
  app.activity();
  $('#btn-recenter').addEventListener('click', () => app.recenter());
  $('#btn-search').addEventListener('click', () => app.search.open());
  $('#btn-menu').addEventListener('click', () => app.menu.open());
  $('#sr-outline-link').addEventListener('click', (e) => { e.preventDefault(); app.outline.open(); });

  $('#multi-bar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const sel = get().selection;
    const kind = b.dataset.bulk;
    if (kind === 'done') return app.exitMulti();
    if (!sel.length) return toast('Tap ideas to select them');
    if (kind === 'color') {
      const r = b.getBoundingClientRect();
      app.radial.colorPopover(sel, r.left + r.width / 2, r.top);
    } else if (kind === 'tag') {
      const tag = (await prompt(`Tag ${sel.length} ideas`, '', { placeholder: 'decision' }))?.replace(/^#/, '');
      if (tag) A.updateNodes(sel, (n) => ({ tags: n.tags.includes(tag) ? n.tags : [...n.tags, tag] }), { label: 'Tag' });
    } else if (kind === 'move') {
      set({ moveTarget: true });
    } else if (kind === 'cluster') {
      const name = await prompt('Cluster name', 'Cluster');
      if (name) {
        const color = '#' + (app.scene.colorOf(sel[0])?.getHexString() || 'a78bfa');
        A.addCluster(name, sel, color);
        app.exitMulti();
        toast(`Cluster “${name}” created`);
      }
    } else if (kind === 'delete') {
      app.deleteWithUndo(sel);
      app.exitMulti();
    }
  });

  // keep quick-add above the on-screen keyboard (iOS doesn't resize the layout viewport)
  const vv = window.visualViewport;
  if (vv) {
    const onVV = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb + 'px');
      document.body.classList.toggle('keyboard', kb > 120);
    };
    vv.addEventListener('resize', onVV);
    vv.addEventListener('scroll', onVV);
  }
}

function renderCrumbs() {
  const s = get();
  const doc = s.doc;
  const el = $('#crumbs');
  if (!doc) return;
  const id = s.selection.at(-1);
  const parts = [h('button.map-title', { onclick: () => app.menu.open(), 'aria-label': 'Map: ' + doc.title }, doc.title || 'Untitled map')];
  if (id && doc.nodes[id]) {
    for (const pid of pathTo(doc, id)) {
      const n = doc.nodes[pid];
      parts.push(h('span.sep', { 'aria-hidden': 'true' }, '›'));
      parts.push(h('button', { onclick: () => app.select(pid, { fly: true }) }, (n.icon ? n.icon + ' ' : '') + (n.title || 'Untitled')));
    }
  }
  el.replaceChildren(...parts);
  el.scrollLeft = el.scrollWidth;
}

function renderFocusChip() {
  const s = get();
  const chip = $('#focus-chip');
  const n = s.focusId && s.doc?.nodes[s.focusId];
  chip.hidden = !n;
  if (n) chip.replaceChildren(h('span', `◎ Focus: ${n.title || 'Untitled'}`), h('button', { onclick: () => app.toggleFocus(s.focusId) }, 'Exit'));
}

function renderBanner() {
  const s = get();
  const el = $('#mode-banner');
  let text = null;
  if (s.linkFrom) text = `Tap an idea to link from “${s.doc.nodes[s.linkFrom]?.title || 'Untitled'}”`;
  else if (s.moveTarget) text = 'Tap the new parent idea';
  el.hidden = !text;
  if (text) el.replaceChildren(h('span', text), h('button', { onclick: () => app.cancelModes() }, 'Cancel'));
}

function renderMultiBar() {
  const s = get();
  $('#multi-bar').hidden = !s.multi;
  document.body.classList.toggle('multi', s.multi);
  $('#multi-count').textContent = `${s.selection.length} selected`;
}

// ---------- dock ----------
function initDock() {
  $$('#dock .segmented button').forEach((b) => b.addEventListener('click', () => app.setMode(b.dataset.mode)));
  $('#btn-outline').addEventListener('click', () => app.outline.toggle());

  // + : tap = quick add, hold = voice note
  const add = $('#btn-add');
  let holdTimer = null, held = false;
  add.addEventListener('pointerdown', () => {
    held = false;
    holdTimer = setTimeout(() => { held = true; startVoice(); }, 500);
  });
  const clear = () => clearTimeout(holdTimer);
  add.addEventListener('pointerup', clear);
  add.addEventListener('pointerleave', clear);
  add.addEventListener('pointercancel', clear);
  add.addEventListener('contextmenu', (e) => e.preventDefault());
  add.addEventListener('click', () => {
    if (held) { held = false; return; }
    const s = get();
    const sel = s.selection.at(-1);
    const doc = s.doc;
    if (!sel && !doc.nodes[doc.rootId].title) { app.select(doc.rootId, { sheet: false }); app.startRename(doc.rootId); return; }
    app.startQuickAdd(sel || doc.rootId);
  });
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input isn’t supported in this browser'); return; }
  const doc = get().doc;
  const parent = get().selection.at(-1) || doc.rootId;
  const id = A.addChild(parent);
  app.select(id, { sheet: false });
  app.quickAdd.open(id, true, { voice: true });
  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const btn = $('#btn-add');
  btn.classList.add('listening');
  haptic('medium');
  let text = '';
  rec.onresult = (e) => {
    text = [...e.results].map((r) => r[0].transcript).join('').trim();
    const t = text.charAt(0).toUpperCase() + text.slice(1);
    app.quickAdd.setText(t);
    A.setTitle(id, t);
  };
  rec.onerror = (e) => toast('Voice: ' + (e.error || 'error'));
  rec.onend = () => {
    btn.classList.remove('listening');
    if (text) haptic('success');
    app.quickAdd.close();
  };
  try { rec.start(); } catch { btn.classList.remove('listening'); }
}

// ---------- quick add ----------
function initQuickAdd() {
  const el = $('#quick-add');
  const input = $('#qa-input');
  const pathEl = $('#qa-path');
  let id = null;
  let created = false;

  function renderPath() {
    const doc = get().doc;
    if (!id || !doc.nodes[id]) return;
    const path = pathTo(doc, id).slice(0, -1).map((p) => doc.nodes[p].title || 'Untitled');
    pathEl.textContent = path.length ? 'in ' + path.join(' › ') : id === doc.rootId ? 'Name your map’s central idea' : 'Floating idea';
  }

  function open(nodeId, isNew, { voice = false } = {}) {
    id = nodeId;
    created = isNew;
    const n = get().doc.nodes[id];
    input.value = n?.title || '';
    input.placeholder = voice ? 'Listening…' : 'Name this idea';
    el.hidden = false;
    app.sheet.close();
    renderPath();
    if (!voice) { input.focus(); input.select(); }
  }

  function close(silent = false) {
    if (el.hidden) return;
    const doc = get().doc;
    const n = id && doc?.nodes[id];
    el.hidden = true;
    if (document.activeElement === input) input.blur();
    if (!silent && n && created && !n.title.trim() && !discardNode(id)) A.deleteNodes([id]); // drop empty new ideas
    id = null;
  }

  app.startQuickAdd = (parentId, how = 'child') => {
    const doc = get().doc;
    const parent = parentId && doc.nodes[parentId] ? parentId : doc.rootId;
    if (app.quickAdd.isOpen && id && doc.nodes[id] && !doc.nodes[id].title.trim() && created && !discardNode(id)) A.deleteNodes([id]);
    const newId = how === 'sibling' ? A.addSibling(parent) : A.addChild(parent);
    app.select(newId, { sheet: false });
    open(newId, true);
    haptic('light');
  };

  app.startRename = (nodeId) => open(nodeId, false);

  input.addEventListener('input', () => { if (id) A.setTitle(id, input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!input.value.trim()) return close();
      const doc = get().doc;
      // Return adds a sibling (the root has none, so its Return adds a child)
      const next = id === doc.rootId ? A.addChild(id) : A.addSibling(id);
      app.select(next, { sheet: false });
      open(next, true);
      haptic('light');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey ? A.outdent(id) : A.indent(id)) { renderPath(); haptic('light'); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  onSwipe(el, (dir) => {
    if (!id) return;
    const ok = dir === 'right' ? A.indent(id) : A.outdent(id);
    if (ok) { renderPath(); haptic('light'); input.focus(); }
  });

  app.quickAdd = {
    open,
    close,
    setText: (t) => { input.value = t; },
    get isOpen() { return !el.hidden; },
  };
}

boot().catch((err) => {
  console.error(err);
  document.body.append(h('pre', { style: { position: 'fixed', top: '60px', left: '12px', right: '12px', whiteSpace: 'pre-wrap', color: '#ff8a8a' } }, 'Startup error: ' + (err?.stack || err)));
});
