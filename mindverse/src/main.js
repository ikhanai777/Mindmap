import './styles.css';
import * as THREE from 'three';
import { createWorld } from './scene/world.js';
import { MindScene } from './scene/mindscene.js';
import { computeLayout, layoutChildrenOf } from './layout.js';
import {
  PALETTE, addChild, addSibling, colorOf, createMap, depthOf, descendants, fromOutline, normalizeMap,
  pathToRoot, removeNode, renameNode, reparent, sampleMap, search, toOutline,
} from './model.js';
import { History, deleteMap, listMaps, loadInitial, loadMap, saveMap } from './store.js';

const $ = (sel) => document.querySelector(sel);
const stage = $('#stage');
const world = createWorld(stage);
const mind = new MindScene(world);
const history = new History();

let map = null;
let selectedId = null;
let renaming = null; // { id, isNew }
const prefs = loadPrefs();

// ---------------------------------------------------------------- state

function applyLayout(positions) {
  for (const [id, p] of Object.entries(positions)) if (map.nodes[id]) map.nodes[id].pos = p;
}

function openMap(m, { fresh = false } = {}) {
  map = m;
  if (fresh) applyLayout(computeLayout(map));
  history.clear();
  select(null);
  mind.sync(map, { instant: true });
  saveMap(map);
  refreshChrome();
  mind.flyTo(null);
}

/** Snapshot for undo, mutate, re-render and autosave. */
function commit(mutate, { layout } = {}) {
  history.push(map);
  const result = mutate();
  if (layout === 'full') applyLayout(computeLayout(map));
  else if (layout) applyLayout(layoutChildrenOf(map, layout));
  afterChange();
  return result;
}

function afterChange() {
  if (selectedId && !map.nodes[selectedId]) selectedId = null;
  mind.sync(map);
  mind.setSelected(selectedId);
  saveMap(map);
  refreshChrome();
}

function restore(snapshot) {
  if (!snapshot) return;
  map = normalizeMap(snapshot);
  afterChange();
}

// ---------------------------------------------------------------- actions

const actions = {
  child(id = selectedId) {
    if (!id) return;
    const node = commit(() => addChild(map, id, 'New idea'), { layout: id });
    select(node.id);
    startRename(node.id, true);
  },
  sibling(id = selectedId) {
    if (!id) return;
    const n = map.nodes[id];
    if (!n.parent) return actions.child(id);
    const node = commit(() => addSibling(map, id, 'New idea'), { layout: n.parent });
    select(node.id);
    startRename(node.id, true);
  },
  delete(id = selectedId) {
    if (!id) return;
    if (id === map.rootId) return toast('The central idea can’t be deleted');
    const parent = map.nodes[id].parent;
    const count = descendants(map, id).length;
    commit(() => removeNode(map, id));
    select(parent);
    toast(count ? `Deleted with ${count} sub-idea${count > 1 ? 's' : ''} · Ctrl+Z to undo` : 'Deleted · Ctrl+Z to undo');
  },
  collapse(id = selectedId) {
    if (!id || !map.nodes[id].children.length) return;
    commit(() => {
      map.nodes[id].collapsed = !map.nodes[id].collapsed;
    });
  },
  rename(id = selectedId) {
    if (id) startRename(id, false);
  },
  focus(id = selectedId) {
    mind.flyTo(id);
  },
  'arrange-branch'(id = selectedId) {
    if (id) commit(() => {}, { layout: id === map.rootId ? 'full' : id });
  },
  arrange() {
    commit(() => {}, { layout: 'full' });
    mind.flyTo(null);
  },
  fit() {
    mind.flyTo(null);
  },
  undo() {
    restore(history.undo(map));
  },
  redo() {
    restore(history.redo(map));
  },
  rotate() {
    prefs.rotate = !prefs.rotate;
    savePrefs();
    refreshChrome();
  },
  scenery() {
    prefs.scenery = !prefs.scenery;
    savePrefs();
    refreshChrome();
  },
  maps: showMaps,
  import: showImport,
  export: toggleExportMenu,
  help: showHelp,
};

function select(id) {
  selectedId = id && map.nodes[id] ? id : null;
  mind.setSelected(selectedId);
  refreshInspector();
}

// ---------------------------------------------------------------- pointer interaction

const pointer = { down: null, drag: null };
const ndc = (e) => {
  const r = world.renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};

const canvas = world.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (renaming) finishRename(true);
  closePopovers();
  const id = e.button === 0 ? mind.pick(ndc(e)) : null;
  pointer.down = { x: e.clientX, y: e.clientY, id, button: e.button };
  if (id) {
    world.controls.enabled = false; // dragging a bubble, not the camera
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const down = pointer.down;
  if (down?.id) {
    if (!pointer.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 && down.id !== map.rootId) {
      beginDrag(down.id);
    }
    if (pointer.drag) return dragTo(e);
    return;
  }
  if (!down) {
    const id = mind.pick(ndc(e));
    mind.setHover(id);
    stage.classList.toggle('hovering', !!id);
  }
});

canvas.addEventListener('pointerup', (e) => {
  const down = pointer.down;
  pointer.down = null;
  world.controls.enabled = true;
  if (pointer.drag) return endDrag();
  if (!down || down.button !== 0) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < 5) select(down.id);
});

canvas.addEventListener('pointercancel', () => {
  pointer.down = null;
  world.controls.enabled = true;
  if (pointer.drag) endDrag(true);
});

canvas.addEventListener('pointerleave', () => {
  if (!pointer.down) mind.setHover(null);
});

canvas.addEventListener('dblclick', (e) => {
  const id = mind.pick(ndc(e));
  if (id) {
    select(id);
    startRename(id, false);
  } else if (selectedId) {
    actions.focus();
  }
});

function beginDrag(id) {
  history.push(map);
  const v = mind.nodes.get(id);
  const normal = world.camera.getWorldDirection(new THREE.Vector3());
  pointer.drag = {
    id,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, v.target),
    exclude: new Set([id, ...descendants(map, id)]),
    dropId: null,
    grab: null,
  };
  stage.classList.add('dragging');
  select(id);
}

function dragTo(e) {
  const d = pointer.drag;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc(e), world.camera);
  const hit = ray.ray.intersectPlane(d.plane, new THREE.Vector3());
  if (!hit) return;
  const n = map.nodes[d.id];
  const at = new THREE.Vector3().fromArray(n.pos);
  if (!d.grab) d.grab = new THREE.Vector3().subVectors(at, hit);
  const delta = hit.add(d.grab).sub(at);
  mind.translateSubtree(d.id, delta);
  // drop target: another bubble under the pointer (not in the dragged subtree)
  const target = mind.pick(ndc(e), d.exclude);
  if (target !== d.dropId) {
    if (d.dropId) mind.nodes.get(d.dropId).dropTarget = false;
    d.dropId = target;
    if (target) mind.nodes.get(target).dropTarget = true;
    $('#hint').textContent = target ? `Release to move under “${map.nodes[target].title}”` : 'Dragging — drop on a bubble to re-parent';
  }
}

function endDrag(cancelled = false) {
  const d = pointer.drag;
  pointer.drag = null;
  stage.classList.remove('dragging');
  if (d.dropId) mind.nodes.get(d.dropId).dropTarget = false;
  resetHint();
  if (!cancelled && d.dropId && reparent(map, d.id, d.dropId)) {
    applyLayout(layoutChildrenOf(map, d.dropId));
    toast(`Moved under “${map.nodes[d.dropId].title}”`);
  }
  afterChange();
}

// ---------------------------------------------------------------- rename

const renameInput = $('#rename');
function startRename(id, isNew) {
  renaming = { id, isNew, before: map.nodes[id].title };
  renameInput.value = map.nodes[id].title;
  renameInput.hidden = false;
  positionOverlays();
  renameInput.focus();
  renameInput.select();
}

function finishRename(save) {
  if (!renaming) return;
  const { id, isNew, before } = renaming;
  renaming = null;
  renameInput.hidden = true;
  if (!map.nodes[id]) return;
  const title = renameInput.value.trim();
  if (!save && isNew) {
    restore(history.undo(map)); // cancel a node that was just added
    history.redoStack.length = 0;
    return;
  }
  if (save && title && title !== before) {
    if (isNew) {
      renameNode(map, id, title); // same undo step as its creation
      afterChange();
    } else commit(() => renameNode(map, id, title));
  }
  canvas.focus?.();
}

renameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const { id, isNew } = renaming;
    finishRename(true);
    // Enter on a freshly added idea chains a new sibling, like typing a list
    if (isNew && e.shiftKey) actions.sibling(id);
  } else if (e.key === 'Escape') finishRename(false);
  else if (e.key === 'Tab') {
    e.preventDefault();
    const { id } = renaming;
    finishRename(true);
    actions.child(id);
  }
});
renameInput.addEventListener('blur', () => finishRename(true));

// ---------------------------------------------------------------- keyboard

const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing(document.activeElement)) {
    e.preventDefault();
    return e.shiftKey ? actions.redo() : actions.undo();
  }
  if (mod && e.key.toLowerCase() === 'y' && !typing(document.activeElement)) {
    e.preventDefault();
    return actions.redo();
  }
  if (e.key === 'Escape') {
    if (!$('#modal').hidden) return closeModal();
    closePopovers();
    if (document.activeElement === searchInput) return clearSearch(true);
    if (typing(document.activeElement)) return document.activeElement.blur();
    return select(null);
  }
  if (typing(document.activeElement) || mod || !$('#modal').hidden) return;
  const key = e.key;
  const n = selectedId && map.nodes[selectedId];
  const nav = (id) => {
    if (id) {
      e.preventDefault();
      select(id);
    }
  };
  switch (key) {
    case 'Tab': e.preventDefault(); actions.child(selectedId || map.rootId); break;
    case 'Enter': e.preventDefault(); n ? actions.sibling() : select(map.rootId); break;
    case 'Delete': case 'Backspace': e.preventDefault(); actions.delete(); break;
    case 'F2': e.preventDefault(); actions.rename(); break;
    case ' ': e.preventDefault(); actions.collapse(); break;
    case 'f': case 'F': selectedId ? actions.focus() : actions.fit(); break;
    case 'l': case 'L': actions.arrange(); break;
    case 'r': case 'R': actions.rotate(); break;
    case '/': e.preventDefault(); searchInput.focus(); break;
    case '?': showHelp(); break;
    case 'ArrowUp': nav(n ? n.parent : map.rootId); break;
    case 'ArrowDown': nav(n ? (!n.collapsed && n.children[0]) : map.rootId); break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!n?.parent) break;
      const sibs = map.nodes[n.parent].children;
      const i = sibs.indexOf(n.id) + (key === 'ArrowRight' ? 1 : -1);
      nav(sibs[(i + sibs.length) % sibs.length]);
      break;
    }
  }
});

// ---------------------------------------------------------------- toolbar & quick bar

document.querySelectorAll('[data-act]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    actions[b.dataset.act]?.(undefined, b);
  }),
);
document.querySelectorAll('[data-q]').forEach((b) =>
  b.addEventListener('click', () => actions[b.dataset.q]?.()),
);

const quick = $('#quick');
function positionOverlays() {
  const sp = selectedId && mind.screenPosition(selectedId);
  const show = sp && !sp.behind && !pointer.drag && !renaming;
  quick.hidden = !show;
  if (show) {
    quick.style.left = `${sp.x}px`;
    quick.style.top = `${Math.min(sp.y + sp.r + 10, window.innerHeight - 110)}px`;
  }
  if (renaming) {
    const rp = mind.screenPosition(renaming.id);
    if (rp) {
      renameInput.style.left = `${rp.x}px`;
      renameInput.style.top = `${rp.y}px`;
    }
  }
}

// ---------------------------------------------------------------- inspector

const insp = {
  el: $('#inspector'),
  title: $('#insp-title'),
  note: $('#insp-note'),
  colors: $('#insp-colors'),
  path: $('#insp-path'),
  dot: $('#insp-dot'),
  stats: $('#insp-stats'),
  collapse: $('#insp-collapse'),
};

insp.colors.innerHTML =
  `<button class="auto" data-color="" title="Inherit from branch">auto</button>` +
  PALETTE.map((c) => `<button data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('');
insp.colors.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !selectedId) return;
  commit(() => {
    map.nodes[selectedId].color = b.dataset.color || null;
  });
});

// typing edits live; one undo step per focus session
for (const [input, field] of [[insp.title, 'title'], [insp.note, 'note']]) {
  input.addEventListener('focus', () => history.push(map));
  input.addEventListener('input', () => {
    if (!selectedId) return;
    if (field === 'title') renameNode(map, selectedId, input.value);
    else map.nodes[selectedId].note = input.value;
    mind.sync(map);
    saveMap(map);
    refreshChrome(false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && field === 'title') input.blur();
  });
}
$('#insp-close').addEventListener('click', () => select(null));

function refreshInspector() {
  const n = selectedId && map.nodes[selectedId];
  insp.el.hidden = !n;
  if (!n) return;
  const color = colorOf(map, n.id);
  if (document.activeElement !== insp.title) insp.title.value = n.title;
  if (document.activeElement !== insp.note) insp.note.value = n.note;
  insp.dot.style.color = color;
  insp.path.textContent = pathToRoot(map, n.id).reverse().slice(0, -1).map((id) => map.nodes[id].title).join(' › ') || 'Central idea';
  insp.colors.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.color || null) === n.color));
  const total = descendants(map, n.id).length;
  insp.stats.innerHTML = `<span>Level <b>${depthOf(map, n.id)}</b></span><span>Children <b>${n.children.length}</b></span><span>Descendants <b>${total}</b></span>`;
  insp.collapse.textContent = n.collapsed ? 'Expand' : 'Collapse';
  insp.collapse.disabled = !n.children.length;
}

// ---------------------------------------------------------------- search

const searchInput = $('#search');
const results = $('#search-results');
let hits = [];
let active = 0;

searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('focus', runSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(hits.length, 1);
    renderResults();
  } else if (e.key === 'Enter' && hits[active]) {
    goTo(hits[active].id);
  }
});
results.addEventListener('pointerdown', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) {
    e.preventDefault();
    goTo(li.dataset.id);
  }
});
searchInput.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 120));

function runSearch() {
  const q = searchInput.value;
  hits = search(map, q).slice(0, 10);
  active = 0;
  results.hidden = !q.trim();
  renderResults();
  const lit = new Set();
  hits.forEach((h) => pathToRoot(map, h.id).forEach((id) => lit.add(id)));
  mind.setFocusSet(q.trim() ? [...lit] : null);
}

function renderResults() {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  results.innerHTML = hits.length
    ? hits
        .map((n, i) => {
          const trail = pathToRoot(map, n.id).slice(1, -1).reverse().map((id) => map.nodes[id].title).join(' › ');
          return `<li data-id="${n.id}" class="${i === active ? 'active' : ''}"><span class="dot" style="color:${colorOf(map, n.id)}"></span>${esc(n.title)}<small>${esc(trail)}</small></li>`;
        })
        .join('')
    : `<li class="empty">No ideas match</li>`;
}

function goTo(id) {
  // reveal it if it's hidden inside collapsed branches
  const hidden = pathToRoot(map, id).slice(1).filter((a) => map.nodes[a].collapsed);
  if (hidden.length) commit(() => hidden.forEach((a) => (map.nodes[a].collapsed = false)));
  clearSearch(true);
  select(id);
  mind.flyTo(id);
}

function clearSearch(blur) {
  searchInput.value = '';
  results.hidden = true;
  mind.setFocusSet(null);
  if (blur) searchInput.blur();
}

// ---------------------------------------------------------------- export / import

const exportMenu = $('#export-menu');
function toggleExportMenu(_, btn) {
  const open = exportMenu.hidden;
  closePopovers();
  if (!open) return;
  const r = (btn || document.querySelector('[data-act="export"]')).getBoundingClientRect();
  exportMenu.style.top = `${r.bottom + 8}px`;
  exportMenu.style.left = `${Math.min(r.left, window.innerWidth - 220)}px`;
  exportMenu.hidden = false;
}
function closePopovers() {
  exportMenu.hidden = true;
}
document.addEventListener('pointerdown', (e) => {
  if (!exportMenu.hidden && !e.target.closest('#export-menu, [data-act="export"]')) closePopovers();
});

const slug = () => (map.title || 'mindverse').replace(/[^\w\-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'mindverse';
function download(name, data, type) {
  const url = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  if (!url.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

exportMenu.addEventListener('click', async (e) => {
  const kind = e.target.closest('button')?.dataset.export;
  if (!kind) return;
  closePopovers();
  if (kind === 'png') {
    const wasSel = selectedId;
    mind.setSelected(null);
    world.render();
    download(`${slug()}.png`, world.renderer.domElement.toDataURL('image/png'), 'image/png');
    mind.setSelected(wasSel);
    toast('Snapshot saved');
  } else if (kind === 'json') {
    download(`${slug()}.mindverse.json`, JSON.stringify(map, null, 2), 'application/json');
  } else if (kind === 'md') {
    download(`${slug()}.md`, toOutline(map), 'text/markdown');
  } else if (kind === 'copy') {
    try {
      await navigator.clipboard.writeText(toOutline(map));
      toast('Outline copied');
    } catch {
      toast('Clipboard unavailable — use the .md export');
    }
  }
});

function importText(text) {
  const trimmed = text.trim();
  if (!trimmed) return toast('Nothing to import');
  let m;
  try {
    if (trimmed.startsWith('{')) {
      m = normalizeMap(JSON.parse(trimmed));
      m.id = createMap().id; // never overwrite an existing map
      openMap(m, { fresh: !Object.values(m.nodes).some((n) => n.pos.some((v) => v !== 0)) });
    } else {
      m = fromOutline(trimmed);
      if (!m) return toast('Couldn’t read that outline');
      openMap(m, { fresh: true });
    }
  } catch (err) {
    return toast(`Import failed: ${err.message}`);
  }
  closeModal();
  toast(`Imported “${m.title}” · ${Object.keys(m.nodes).length} ideas`);
}

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importText(await f.text());
});

// ---------------------------------------------------------------- modals

function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
});

function showImport() {
  openModal(`
    <h2>Import</h2>
    <p>Paste an indented or bulleted outline (the first line becomes the central idea), a Markdown document with headings, or a Mindverse <code>.json</code> file.</p>
    <textarea id="import-text" placeholder="My big idea\n- Branch one\n  - Detail\n  - Detail\n- Branch two"></textarea>
    <div class="row">
      <button class="btn" id="import-file">Choose file…</button>
      <span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="import-go">Build map</button>
    </div>`);
  $('#import-file').onclick = () => $('#file').click();
  $('#import-go').onclick = () => importText($('#import-text').value);
  setTimeout(() => $('#import-text').focus(), 30);
}

function showMaps() {
  const maps = listMaps();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  openModal(`
    <h2>My maps</h2>
    <p>Maps are saved automatically in this browser.</p>
    <div class="row">
      <button class="btn primary" id="new-blank">+ New blank map</button>
      <button class="btn" id="new-sample">+ Sample: Future Tech</button>
      <button class="btn" id="dup">Duplicate current</button>
    </div>
    <ul class="maps-list">
      ${maps
        .map(
          (m) => `<li data-id="${m.id}" class="${m.id === map.id ? 'current' : ''}">
            <span class="dot" style="color:${PALETTE[Math.abs(hash(m.id)) % PALETTE.length]}"></span>
            <div class="grow"><div class="title">${esc(m.title)}</div>
            <div class="meta">${m.count} ideas · ${new Date(m.updated).toLocaleString()}</div></div>
            <button class="icon-btn" data-del="${m.id}" title="Delete map">✕</button></li>`,
        )
        .join('')}
    </ul>`);
  $('#new-blank').onclick = () => {
    const m = createMap('Central idea');
    openMap(m);
    closeModal();
    select(m.rootId);
    startRename(m.rootId, false);
  };
  $('#new-sample').onclick = () => {
    openMap(sampleMap(), { fresh: true });
    closeModal();
  };
  $('#dup').onclick = () => {
    const m = normalizeMap(JSON.parse(JSON.stringify(map)));
    m.id = createMap().id;
    m.title = `${map.title} (copy)`;
    openMap(m);
    closeModal();
    toast('Duplicated');
  };
  document.querySelector('.maps-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      // two-step confirm inside the page (native dialogs are blocked in some embeds)
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = 'Delete?';
        del.title = 'Click again to delete this map for good';
        setTimeout(() => {
          del.classList.remove('armed');
          del.textContent = '✕';
        }, 3000);
        return;
      }
      deleteMap(id);
      if (id === map.id) {
        const next = listMaps()[0];
        openMap((next && loadMap(next.id)) || sampleMap(), { fresh: !next });
      }
      showMaps();
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (li && li.dataset.id !== map.id) {
      const m = loadMap(li.dataset.id);
      if (m) openMap(m);
      closeModal();
    }
  });
}

function showHelp() {
  const k = (keys, what) => `<kbd>${keys}</kbd><span>${what}</span>`;
  openModal(`
    <h2>Mindverse controls</h2>
    <p>Orbit your ideas in 3D. Click a bubble to select it; drag it to move its whole branch, or drop it onto another bubble to re-parent it.</p>
    <div class="keys">
      ${k('Drag / Right-drag / Scroll', 'Orbit · pan · zoom the camera')}
      ${k('Click', 'Select a bubble')}
      ${k('Double-click', 'Rename a bubble')}
      ${k('Tab', 'Add a child idea')}
      ${k('Enter', 'Add a sibling idea')}
      ${k('Tab / Shift+Enter while naming', 'Keep going: child / sibling')}
      ${k('F2', 'Rename selected')}
      ${k('Space', 'Collapse / expand branch')}
      ${k('Delete', 'Delete selected branch')}
      ${k('← → ↑ ↓', 'Walk siblings / parent / child')}
      ${k('F', 'Focus selection (or fit all)')}
      ${k('L', 'Auto-arrange the whole map')}
      ${k('R', 'Toggle auto-rotate')}
      ${k('/', 'Search')}
      ${k('Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo')}
      ${k('Esc', 'Deselect / close')}
    </div>`);
}

// ---------------------------------------------------------------- chrome

const titleInput = $('#map-title');
titleInput.addEventListener('focus', () => history.push(map));
titleInput.addEventListener('input', () => {
  renameNode(map, map.rootId, titleInput.value || 'Untitled');
  mind.sync(map);
  saveMap(map);
  refreshInspector();
});
titleInput.addEventListener('keydown', (e) => e.key === 'Enter' && titleInput.blur());

function refreshChrome(inspector = true) {
  if (document.activeElement !== titleInput) titleInput.value = map.title;
  document.title = `${map.title} · Mindverse`;
  const count = Object.keys(map.nodes).length;
  const branches = map.nodes[map.rootId].children.length;
  $('#stats').innerHTML = `<b>${count}</b> ideas · <b>${branches}</b> branches · saved`;
  $('[data-act="undo"]').disabled = !history.canUndo;
  $('[data-act="redo"]').disabled = !history.canRedo;
  $('[data-act="rotate"]').classList.toggle('on', prefs.rotate);
  $('[data-act="scenery"]').classList.toggle('on', prefs.scenery);
  world.controls.autoRotate = prefs.rotate;
  world.backdrop.setVisible(prefs.scenery);
  if (inspector) refreshInspector();
}

function resetHint() {
  $('#hint').textContent =
    'Drag to orbit · Scroll to zoom · Right-drag to pan · Double-click a bubble to rename · Drag a bubble to move it, drop it on another to re-parent';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function loadPrefs() {
  try {
    return { rotate: false, scenery: true, ...JSON.parse(localStorage.getItem('mindverse:prefs') || '{}') };
  } catch {
    return { rotate: false, scenery: true };
  }
}
function savePrefs() {
  try {
    localStorage.setItem('mindverse:prefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

// ---------------------------------------------------------------- boot

const initial = loadInitial();
openMap(initial || sampleMap(), { fresh: !initial });
document.fonts?.ready.then(() => mind.redrawLabels());

// debug / automation hook
window.mindverse = { get map() { return map; }, actions, select, mind, world };

function frame() {
  mind.update();
  positionOverlays();
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
