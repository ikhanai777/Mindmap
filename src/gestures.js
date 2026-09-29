// One gesture language across modes (see spec gesture map):
//            empty space                      node
// tap        deselect, hide chrome            select + sheet peek
// double-tap recenter                         focus camera on node
// long-press add floating node here           radial menu
// drag       rotate (orbit) / look            move or reparent
// pinch      zoom                             resize node
// 2-finger tap: undo
import { get, set } from './store.js';
import * as A from './actions.js';
import { subtree } from './model.js';

const TAP_SLOP = 9;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 320;

export function initGestures(app) {
  const canvas = app.scene.canvas;
  const s3 = app.scene;
  const rig = app.rig;
  const pointers = new Map();
  let g = null;
  let longTimer = null;
  let lastTap = { t: 0, x: 0, y: 0, hit: null };

  const pts = () => [...pointers.values()];
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    app.activity();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (pointers.size === 1) {
      const hit = s3.pick(e.clientX, e.clientY);
      g = { type: 'pending', hit, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), button: e.button, shift: e.shiftKey };
      clearTimeout(longTimer);
      if (e.button === 0) longTimer = setTimeout(onLongPress, LONG_PRESS_MS);
      rig.cancelTween();
      rig.vel.theta = rig.vel.phi = 0;
    } else if (pointers.size === 2) {
      clearTimeout(longTimer);
      if (g?.type === 'node-drag') cancelNodeDrag();
      const [a, b] = pts();
      const onNode = g && g.type === 'pending' && g.hit && !get().multi ? g.hit : null;
      const n = onNode && get().doc.nodes[onNode];
      g = { type: onNode ? 'pinch-node' : 'pinch', id: onNode, size0: n?.size || 1, d0: dist2(a, b), d: dist2(a, b), m: mid(a, b), m0: mid(a, b), t0: performance.now(), moved: false };
      rig.dragging = false;
    } else {
      g = { type: 'done' };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') hover(e);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (!g) return;
    if (pointers.size === 1) {
      if (g.type === 'pending' && Math.hypot(p.x - g.x0, p.y - g.y0) > TAP_SLOP) {
        clearTimeout(longTimer);
        if (g.hit && g.button === 0 && !g.shift && !get().multi && !get().linkFrom) startNodeDrag(g.hit);
        else if (g.button === 2 || g.button === 1 || g.shift) g.type = 'pan';
        else { g.type = 'rotate'; rig.dragging = true; }
      }
      const dx = p.x - g.lx, dy = p.y - g.ly;
      g.lx = p.x; g.ly = p.y;
      if (g.type === 'rotate') rig.rotate(dx, dy);
      else if (g.type === 'pan') rig.pan(dx, dy);
      else if (g.type === 'node-drag') moveNodeDrag(p.x, p.y);
    } else if (pointers.size === 2 && (g.type === 'pinch' || g.type === 'pinch-node')) {
      const [a, b] = pts();
      const d = dist2(a, b), m = mid(a, b);
      if (Math.abs(d - g.d0) > 10 || dist2(m, g.m0) > 10) g.moved = true;
      if (g.type === 'pinch') {
        if (g.d > 0) rig.zoom(d / g.d);
        if (rig.mode === 'orbit') rig.pan(m.x - g.m.x, m.y - g.m.y);
        else rig.look(m.x - g.m.x, m.y - g.m.y);
      } else if (g.moved) {
        const size = Math.min(4, Math.max(0.3, g.size0 * (d / g.d0)));
        A.updateNode(g.id, { size: Math.round(size * 100) / 100 }, { coalesce: 'pinch:' + g.id, label: 'Resize' });
      }
      g.d = d;
      g.m = m;
    }
  });

  const up = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (!g) return;
    const cancelled = e.type === 'pointercancel';
    if (g.type === 'pinch' || g.type === 'pinch-node') {
      if (!g.moved && !g.undone && performance.now() - g.t0 < 300 && !cancelled) {
        g.undone = true; // two-finger tap
        app.undo();
      }
      if (!pointers.size) g = null;
      else g.type = 'done';
      return;
    }
    clearTimeout(longTimer);
    if (g.type === 'pending' && !cancelled) onTap(e.clientX, e.clientY, g.hit, e);
    else if (g.type === 'node-drag') cancelled ? cancelNodeDrag() : endNodeDrag();
    else if (g.type === 'rotate') {
      rig.dragging = false;
      // swipe to skip during a tour
      const dt = performance.now() - g.t0, dx = e.clientX - g.x0;
      if (get().touring && dt < 450 && Math.abs(dx) > 70) (dx < 0 ? app.tour.next() : app.tour.prev());
    }
    if (!pointers.size) g = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    app.activity();
    if (e.ctrlKey) rig.zoom(Math.exp(-e.deltaY * 0.01)); // trackpad pinch
    else rig.zoom(Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // ---------- taps ----------
  function onTap(x, y, hit, e) {
    const s = get();
    const now = performance.now();
    const isDouble = now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 30 && lastTap.hit === hit;
    lastTap = { t: isDouble ? 0 : now, x, y, hit };

    if (e.button === 2) { if (hit) app.radial.open(hit, x, y); return; }

    if (s.linkFrom) {
      if (hit && hit !== s.linkFrom) app.finishLink(hit);
      else app.cancelModes();
      return;
    }
    if (s.moveTarget) {
      if (hit) app.finishBulkMove(hit);
      return;
    }
    if (s.multi) {
      if (hit) {
        const sel = s.selection.includes(hit) ? s.selection.filter((x) => x !== hit) : [...s.selection, hit];
        set({ selection: sel });
        app.haptic('light');
      }
      return;
    }
    if (isDouble) {
      if (hit) { app.select(hit, { sheet: false }); rig.focusNode(hit); }
      else app.recenter();
      app.haptic('light');
      return;
    }
    if (hit) {
      const doc = s.doc;
      if (s.mode === 'walk') rig.walkTo(hit);
      if (hit === doc.rootId && !doc.nodes[hit].title) {
        app.select(hit, { sheet: false });
        app.startRename(hit);
        return;
      }
      app.select(hit, { sheet: 'peek' });
      app.haptic('light');
    } else {
      if (s.selection.length || s.sheet !== 'hidden') {
        app.deselect();
        app.setChromeHidden(true);
      } else app.setChromeHidden(!s.chromeHidden);
    }
  }

  function onLongPress() {
    if (!g || g.type !== 'pending') return;
    g.type = 'done';
    const { x0: x, y0: y, hit } = g;
    if (get().multi || get().linkFrom) return;
    if (hit) app.radial.open(hit, x, y);
    else {
      const d = rig.mode === 'orbit' ? Math.min(rig.radius, 40) : 6;
      const pos = s3.screenToWorld(x, y, d);
      const id = A.addFloating(pos.toArray().map((v) => Math.round(v * 100) / 100));
      app.select(id, { sheet: false });
      app.startRename(id);
      app.haptic('medium');
    }
  }

  // ---------- node drag (move / reparent) ----------
  function startNodeDrag(id) {
    const start = s3.getPos(id).clone();
    const doc = get().doc;
    g.type = 'node-drag';
    g.id = id;
    g.start = start;
    g.exclude = new Set(subtree(doc, id));
    s3.drag = { id, pos: start.clone() };
    app.select(id, { sheet: false });
    app.haptic('light');
  }

  function moveNodeDrag(x, y) {
    const p = s3.screenToPlane(x, y, s3.drag.pos);
    if (p) s3.drag.pos.copy(p);
    const target = s3.pick(x, y, { exclude: g.exclude });
    const ok = target && A.canReparent(g.id, target) && get().doc.nodes[g.id].parentId !== target;
    const next = ok ? target : null;
    if (next !== s3.dropTarget) {
      s3.dropTarget = next;
      if (next) app.haptic('light');
    }
  }

  function endNodeDrag() {
    const id = g.id;
    const target = s3.dropTarget;
    const pos = s3.drag.pos.clone();
    s3.dropTarget = null;
    // keep the node where it was dropped until the new layout animates it
    const st = s3.states.get(id);
    if (st) { st.cur.copy(pos); st.from.copy(pos); }
    s3.drag = null;
    if (target) {
      A.reparent(id, target);
      app.haptic('medium');
      app.toast(`Moved under “${get().doc.nodes[target].title || 'Untitled'}”`, { label: 'Undo', run: () => app.undo() });
    } else if (pos.distanceTo(g.start) > 0.05) {
      A.pinNode(id, pos.toArray());
      app.haptic('medium');
    }
  }

  function cancelNodeDrag() {
    s3.drag = null;
    s3.dropTarget = null;
  }

  function hover(e) {
    const hit = s3.pick(e.clientX, e.clientY);
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  }

  // ---------- keyboard ----------
  const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']);
  window.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, [contenteditable]');
    const k = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && k === 'z') {
      if (typing && !e.target.closest('#quick-add')) return; // native text undo inside fields
      e.preventDefault();
      e.shiftKey ? app.redo() : app.undo();
      return;
    }
    if (mod && k === 'y') { e.preventDefault(); app.redo(); return; }
    if (mod && k === 'f') { e.preventDefault(); app.search.open(); return; }
    if (typing) { if (k === 'escape') e.target.blur(); return; }
    if (mod) return;
    app.activity();
    const s = get();
    const sel = s.selection.at(-1);
    if (MOVE_KEYS.has(k) && !(k === ' ' && rig.mode === 'orbit')) {
      rig.keys.add(k);
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
      return;
    }
    switch (k) {
      case 'escape': app.escape(); break;
      case 'enter': e.preventDefault(); if (sel) app.startQuickAdd(sel, 'sibling'); else app.startQuickAdd(null); break;
      case 'tab': e.preventDefault(); app.startQuickAdd(sel || null); break;
      case 'n': e.preventDefault(); app.startQuickAdd(sel || null); break;
      case 'delete': case 'backspace': if (s.selection.length) app.deleteWithUndo(s.selection); break;
      case '/': e.preventDefault(); app.search.open(); break;
      case 'o': app.outline.toggle(); break;
      case '1': app.setMode('orbit'); break;
      case '2': app.setMode('fly'); break;
      case '3': app.setMode('walk'); break;
      case 'f': if (sel) rig.focusNode(sel); break;
      case 'h': case 'home': app.recenter(); break;
      case 'l': if (sel) app.startLink(sel); break;
      case 'c': if (sel && get().doc.nodes[sel]) A.toggleCollapse(sel); break;
      case 'm': app.menu.open(); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => rig.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => rig.keys.clear());

  // ---------- paste import ----------
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text?.trim()) {
      e.preventDefault();
      app.pasteOutline(text);
    }
  });

  // ---------- shake to undo ----------
  let lastShake = 0, spikes = [];
  window.addEventListener('devicemotion', (e) => {
    const a = e.acceleration;
    if (!a || a.x == null) return;
    const mag = Math.hypot(a.x, a.y, a.z);
    const now = performance.now();
    if (mag > 17) {
      spikes = spikes.filter((t) => now - t < 700);
      spikes.push(now);
      if (spikes.length >= 3 && now - lastShake > 1500) {
        lastShake = now;
        spikes = [];
        if (app.undo()) app.haptic('warn');
      }
    }
  });

  return { get active() { return !!g; } };
}

