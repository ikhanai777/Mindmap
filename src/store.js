// App state (zustand vanilla store) + command-pattern history.
// Every document mutation is a transaction of ops {kind, id, before, after};
// undo replays `before` in reverse, redo replays `after`.
import { createStore } from 'zustand/vanilla';
import { touchDoc } from './model.js';

const reduceMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export const DEFAULT_SETTINGS = {
  bloom: 'auto', // auto | on | off
  reduceMotion: 'system', // system | on | off
  gyro: false,
  labelScale: 1,
  haptics: true,
};

export const store = createStore(() => ({
  doc: null,
  rev: 0, // any doc change
  structRev: 0, // changes that need a relayout
  selection: [], // selected node ids (primary = last)
  mode: 'orbit', // orbit | fly | walk
  focusId: null, // focus mode (isolated subtree)
  linkFrom: null, // link mode source
  multi: false, // multi-select mode
  moveTarget: false, // multi-select "move" awaiting target
  highlight: null, // Set of ids lit by search/filter
  sheet: 'hidden', // hidden | peek | full
  panel: null, // null | outline | search | menu | maps
  chromeHidden: false,
  touring: false,
  settings: { ...DEFAULT_SETTINGS },
}));

export const get = () => store.getState();
export const set = (patch) => store.setState(patch);
export const getDoc = () => store.getState().doc;
export const primary = () => {
  const s = store.getState().selection;
  return s.length ? s[s.length - 1] : null;
};

export function reduceMotion() {
  const pref = store.getState().settings.reduceMotion;
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return !!reduceMotionQuery?.matches;
}

const COLLECTIONS = { node: 'nodes', link: 'links', cluster: 'clusters', waypoint: 'waypoints' };
const clone = (v) => (v == null ? null : typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function applyOps(doc, ops, which) {
  const list = which === 'before' ? [...ops].reverse() : ops;
  for (const op of list) {
    const value = op[which];
    if (op.kind === 'map') {
      doc[op.id] = clone(value);
      continue;
    }
    const coll = doc[COLLECTIONS[op.kind]];
    if (value == null) delete coll[op.id];
    else coll[op.id] = clone(value);
  }
  touchDoc(doc);
}

/** Op builder: snapshot current value as `before`. `after` null deletes. */
export function op(doc, kind, id, after) {
  const before = kind === 'map' ? doc[id] : doc[COLLECTIONS[kind]][id];
  return { kind, id, before: clone(before ?? null), after: clone(after ?? null) };
}

// ---------- history ----------
const undoStack = [];
const redoStack = [];
let coalesceState = null;
const listeners = new Set();
export const onHistory = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

function bump(structural) {
  const s = store.getState();
  const doc = s.doc;
  doc.updatedAt = Date.now();
  const selection = s.selection.filter((id) => doc.nodes[id]);
  store.setState({
    rev: s.rev + 1,
    structRev: structural ? s.structRev + 1 : s.structRev,
    selection,
    focusId: s.focusId && doc.nodes[s.focusId] ? s.focusId : null,
    linkFrom: s.linkFrom && doc.nodes[s.linkFrom] ? s.linkFrom : null,
  });
}

/**
 * Apply and record a transaction.
 * @param ops list from op()
 * @param opts.label human label for undo toasts
 * @param opts.coalesce key: consecutive commits with same key within 1.5 s merge into one undo step
 * @param opts.structural whether layout must rerun (default true)
 */
export function commit(ops, { label = 'Edit', coalesce = null, structural = true } = {}) {
  ops = ops.filter(Boolean);
  if (!ops.length) return;
  const doc = getDoc();
  applyOps(doc, ops, 'after');
  const now = Date.now();
  const top = undoStack[undoStack.length - 1];
  if (coalesce && coalesceState && coalesceState.key === coalesce && now - coalesceState.t < 1500 && top === coalesceState.entry) {
    for (const o of ops) {
      const existing = top.ops.find((x) => x.kind === o.kind && x.id === o.id);
      if (existing) existing.after = o.after;
      else top.ops.push(o);
    }
    top.structural = top.structural || structural;
    coalesceState.t = now;
  } else {
    const entry = { ops, label, structural };
    undoStack.push(entry);
    if (undoStack.length > 5000) undoStack.shift(); // practically unlimited, bounded memory
    coalesceState = coalesce ? { key: coalesce, t: now, entry } : null;
  }
  redoStack.length = 0;
  bump(structural);
  listeners.forEach((fn) => fn());
}

export function undo() {
  const entry = undoStack.pop();
  if (!entry) return null;
  applyOps(getDoc(), entry.ops, 'before');
  redoStack.push(entry);
  coalesceState = null;
  bump(true);
  listeners.forEach((fn) => fn());
  return entry.label;
}

export function redo() {
  const entry = redoStack.pop();
  if (!entry) return null;
  applyOps(getDoc(), entry.ops, 'after');
  undoStack.push(entry);
  coalesceState = null;
  bump(true);
  listeners.forEach((fn) => fn());
  return entry.label;
}

/**
 * Silently roll back trailing history entries that only touch `id`
 * (e.g. an empty idea from quick add that was never named). Not redoable.
 */
export function discardNode(id) {
  let changed = false;
  while (undoStack.length) {
    const top = undoStack[undoStack.length - 1];
    if (!top.ops.every((o) => o.kind === 'node' && o.id === id)) break;
    applyOps(getDoc(), top.ops, 'before');
    undoStack.pop();
    changed = true;
  }
  coalesceState = null;
  if (getDoc().nodes[id]) return false; // still exists: caller falls back to a real delete
  if (changed) { bump(true); listeners.forEach((fn) => fn()); }
  return true;
}

/** Swap in a new document, resetting history & transient state. */
export function loadDoc(doc) {
  undoStack.length = 0;
  redoStack.length = 0;
  coalesceState = null;
  touchDoc(doc);
  const s = store.getState();
  store.setState({
    doc,
    rev: s.rev + 1,
    structRev: s.structRev + 1,
    selection: [],
    focusId: null,
    linkFrom: null,
    multi: false,
    moveTarget: false,
    highlight: null,
    sheet: 'hidden',
  });
  listeners.forEach((fn) => fn());
}
