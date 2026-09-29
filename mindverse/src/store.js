// Persistence (localStorage, several maps) and snapshot undo/redo.
import { normalizeMap, sampleMap } from './model.js';

const INDEX_KEY = 'mindverse:index';
const MAP_KEY = (id) => `mindverse:map:${id}`;
const LAST_KEY = 'mindverse:last';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export function listMaps() {
  try {
    return JSON.parse(safeGet(INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveMap(map) {
  safeSet(MAP_KEY(map.id), JSON.stringify(map));
  const index = listMaps().filter((m) => m.id !== map.id);
  index.unshift({ id: map.id, title: map.title, updated: map.updated, count: Object.keys(map.nodes).length });
  safeSet(INDEX_KEY, JSON.stringify(index));
  safeSet(LAST_KEY, map.id);
}

export function loadMap(id) {
  try {
    const raw = safeGet(MAP_KEY(id));
    return raw ? normalizeMap(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function deleteMap(id) {
  safeRemove(MAP_KEY(id));
  safeSet(INDEX_KEY, JSON.stringify(listMaps().filter((m) => m.id !== id)));
}

export function loadInitial() {
  const last = safeGet(LAST_KEY);
  return (last && loadMap(last)) || null;
}

export { sampleMap };

export class History {
  constructor(limit = 150) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }
  /** Call before a mutation with the current state. */
  push(map) {
    this.undoStack.push(JSON.stringify(map));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(this.undoStack.pop());
  }
  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(this.redoStack.pop());
  }
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
}
