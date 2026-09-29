// High-level document mutations. Each one is a single undoable transaction.
import { commit, op, getDoc } from './store.js';
import {
  createNode, createLink, createCluster, createWaypoint, getIndex, subtree, isDescendant,
} from './model.js';

const now = () => Date.now();

function nextOrder(doc, parentId) {
  const idx = getIndex(doc);
  const kids = parentId ? idx.kids(parentId) : idx.roots;
  return kids.length ? doc.nodes[kids[kids.length - 1]].order + 1 : 0;
}

function orderAfter(doc, id) {
  const idx = getIndex(doc);
  const n = doc.nodes[id];
  const sibs = n.parentId ? idx.kids(n.parentId) : idx.roots;
  const i = sibs.indexOf(id);
  const next = sibs[i + 1];
  return next ? (n.order + doc.nodes[next].order) / 2 : n.order + 1;
}

export function addChild(parentId, fields = {}) {
  const doc = getDoc();
  const parent = doc.nodes[parentId];
  if (!parent) return null;
  const n = createNode({ parentId, order: nextOrder(doc, parentId), ...fields });
  const ops = [op(doc, 'node', n.id, n)];
  if (parent.collapsed) ops.push(op(doc, 'node', parentId, { ...parent, collapsed: false }));
  commit(ops, { label: 'Add idea', coalesce: 'title:' + n.id }); // naming it right away folds into this step
  return n.id;
}

/** Floating node (no parent) pinned at a world position. */
export function addFloating(pos, fields = {}) {
  const doc = getDoc();
  const n = createNode({ parentId: null, pos, order: nextOrder(doc, null), ...fields });
  commit([op(doc, 'node', n.id, n)], { label: 'Add idea', coalesce: 'title:' + n.id });
  return n.id;
}

export function addSibling(id, fields = {}) {
  const doc = getDoc();
  const n = doc.nodes[id];
  if (!n) return null;
  if (id === doc.rootId) return addChild(id, fields);
  if (!n.parentId) {
    const pos = n.pos ? [n.pos[0] + 2.5, n.pos[1], n.pos[2]] : null;
    const s = createNode({ parentId: null, pos, order: orderAfter(doc, id), ...fields });
    commit([op(doc, 'node', s.id, s)], { label: 'Add idea', coalesce: 'title:' + s.id });
    return s.id;
  }
  const s = createNode({ parentId: n.parentId, order: orderAfter(doc, id), ...fields });
  commit([op(doc, 'node', s.id, s)], { label: 'Add idea', coalesce: 'title:' + s.id });
  return s.id;
}

export function updateNode(id, patch, { coalesce = null, structural = false, label = 'Edit' } = {}) {
  const doc = getDoc();
  const n = doc.nodes[id];
  if (!n) return;
  commit([op(doc, 'node', id, { ...n, ...patch, updatedAt: now() })], { coalesce, structural, label });
}

export function updateNodes(ids, patchFn, { structural = false, label = 'Edit' } = {}) {
  const doc = getDoc();
  const ops = ids.filter((id) => doc.nodes[id]).map((id) => {
    const n = doc.nodes[id];
    const patch = typeof patchFn === 'function' ? patchFn(n) : patchFn;
    return op(doc, 'node', id, { ...n, ...patch, updatedAt: now() });
  });
  commit(ops, { structural, label });
}

export function setTitle(id, title) {
  updateNode(id, { title }, { coalesce: 'title:' + id, label: 'Rename' });
}

export function toggleCollapse(id) {
  const doc = getDoc();
  const n = doc.nodes[id];
  if (!n) return;
  updateNode(id, { collapsed: !n.collapsed }, { structural: true, label: n.collapsed ? 'Expand' : 'Collapse' });
}

/** Delete nodes with their subtrees, incident links and cluster memberships. Root is kept. */
export function deleteNodes(ids) {
  const doc = getDoc();
  const idx = getIndex(doc);
  const doomed = new Set();
  for (const id of ids) {
    if (!doc.nodes[id]) continue;
    if (id === doc.rootId) {
      idx.kids(id).forEach((k) => subtree(doc, k, idx).forEach((x) => doomed.add(x)));
    } else subtree(doc, id, idx).forEach((x) => doomed.add(x));
  }
  if (!doomed.size) return;
  const ops = [];
  for (const l of Object.values(doc.links)) if (doomed.has(l.from) || doomed.has(l.to)) ops.push(op(doc, 'link', l.id, null));
  for (const c of Object.values(doc.clusters)) {
    const keep = c.nodeIds.filter((x) => !doomed.has(x));
    if (keep.length !== c.nodeIds.length) ops.push(op(doc, 'cluster', c.id, keep.length ? { ...c, nodeIds: keep } : null));
  }
  for (const id of doomed) ops.push(op(doc, 'node', id, null));
  commit(ops, { label: doomed.size > 1 ? `Delete ${doomed.size} ideas` : 'Delete idea' });
}

export function canReparent(id, newParentId) {
  const doc = getDoc();
  if (!doc.nodes[id] || !doc.nodes[newParentId]) return false;
  if (id === newParentId || id === doc.rootId) return false;
  return !isDescendant(doc, newParentId, id);
}

export function reparent(ids, newParentId) {
  const doc = getDoc();
  const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => canReparent(id, newParentId));
  if (!list.length) return false;
  let order = nextOrder(doc, newParentId);
  const parent = doc.nodes[newParentId];
  const ops = list.map((id) => op(doc, 'node', id, { ...doc.nodes[id], parentId: newParentId, pos: null, order: order++, updatedAt: now() }));
  if (parent.collapsed) ops.push(op(doc, 'node', newParentId, { ...parent, collapsed: false }));
  commit(ops, { label: 'Move' });
  return true;
}

export function indent(id) {
  const doc = getDoc();
  const n = doc.nodes[id];
  if (!n || id === doc.rootId) return false;
  const idx = getIndex(doc);
  const sibs = n.parentId ? idx.kids(n.parentId) : idx.roots;
  const i = sibs.indexOf(id);
  const prev = sibs[i - 1];
  if (!prev) return false;
  commit([op(doc, 'node', id, { ...n, parentId: prev, pos: null, order: nextOrder(doc, prev), updatedAt: now() }),
    doc.nodes[prev].collapsed ? op(doc, 'node', prev, { ...doc.nodes[prev], collapsed: false }) : null], { label: 'Indent' });
  return true;
}

export function outdent(id) {
  const doc = getDoc();
  const n = doc.nodes[id];
  if (!n || !n.parentId) return false;
  const parent = doc.nodes[n.parentId];
  if (!parent.parentId) return false; // top-level branches stay attached to their root
  commit([op(doc, 'node', id, { ...n, parentId: parent.parentId, pos: null, order: orderAfter(doc, parent.id), updatedAt: now() })], { label: 'Outdent' });
  return true;
}

export function pinNode(id, pos) {
  updateNode(id, { pos: pos.map((v) => Math.round(v * 1000) / 1000) }, { structural: true, label: 'Move' });
}

export function unpinNode(id) {
  updateNode(id, { pos: null }, { structural: true, label: 'Unpin' });
}

// ---------- links ----------
export function addLink(from, to, fields = {}) {
  const doc = getDoc();
  if (!doc.nodes[from] || !doc.nodes[to] || from === to) return null;
  const l = createLink({ from, to, ...fields });
  commit([op(doc, 'link', l.id, l)], { label: 'Link', structural: doc.layoutMode === 'force-galaxy' });
  return l.id;
}

export function updateLink(id, patch, coalesce = null) {
  const doc = getDoc();
  const l = doc.links[id];
  if (!l) return;
  commit([op(doc, 'link', id, { ...l, ...patch })], { label: 'Edit link', structural: false, coalesce });
}

export function deleteLink(id) {
  const doc = getDoc();
  commit([op(doc, 'link', id, null)], { label: 'Delete link' });
}

// ---------- clusters & waypoints ----------
export function addCluster(name, nodeIds, color) {
  const doc = getDoc();
  const c = createCluster({ name, nodeIds: [...nodeIds], color: color || '#A78BFA' });
  commit([op(doc, 'cluster', c.id, c)], { label: 'Cluster', structural: doc.layoutMode === 'force-galaxy' });
  return c.id;
}

export function updateCluster(id, patch) {
  const doc = getDoc();
  if (!doc.clusters[id]) return;
  commit([op(doc, 'cluster', id, { ...doc.clusters[id], ...patch })], { label: 'Edit cluster', structural: false });
}

export function deleteCluster(id) {
  const doc = getDoc();
  commit([op(doc, 'cluster', id, null)], { label: 'Delete cluster', structural: false });
}

export function addWaypoint(name, position, target) {
  const doc = getDoc();
  const order = Object.values(doc.waypoints).reduce((m, w) => Math.max(m, w.order + 1), 0);
  const w = createWaypoint({ name, position, target, order });
  commit([op(doc, 'waypoint', w.id, w)], { label: 'Add waypoint', structural: false });
  return w.id;
}

export function updateWaypoint(id, patch) {
  const doc = getDoc();
  if (!doc.waypoints[id]) return;
  commit([op(doc, 'waypoint', id, { ...doc.waypoints[id], ...patch })], { label: 'Edit waypoint', structural: false });
}

export function moveWaypoint(id, dir) {
  const doc = getDoc();
  const list = Object.values(doc.waypoints).sort((a, b) => a.order - b.order);
  const i = list.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  commit([op(doc, 'waypoint', a.id, { ...a, order: b.order }), op(doc, 'waypoint', b.id, { ...b, order: a.order })], { label: 'Reorder', structural: false });
}

export function deleteWaypoint(id) {
  const doc = getDoc();
  commit([op(doc, 'waypoint', id, null)], { label: 'Delete waypoint', structural: false });
}

// ---------- map ----------
export function setMapField(field, value, structural = false) {
  const doc = getDoc();
  if (doc[field] === value) return;
  commit([op(doc, 'map', field, value)], { label: 'Map settings', structural, coalesce: field === 'title' ? 'maptitle' : null });
}

/**
 * Import a parsed outline (array of {title, note, children}) under parentId as one transaction.
 * Returns the ids of the new top-level nodes.
 */
export function importBranch(parentId, items) {
  const doc = getDoc();
  if (!doc.nodes[parentId] || !items.length) return [];
  const ops = [];
  const top = [];
  let order = nextOrder(doc, parentId);
  const walk = (list, pid, isTop) => {
    list.forEach((item, i) => {
      const n = createNode({ parentId: pid, title: item.title || '', note: item.note || '', order: isTop ? order++ : i });
      if (isTop) top.push(n.id);
      ops.push(op(doc, 'node', n.id, n));
      if (item.children?.length) walk(item.children, n.id, false);
    });
  };
  walk(items, parentId, true);
  if (doc.nodes[parentId].collapsed) ops.push(op(doc, 'node', parentId, { ...doc.nodes[parentId], collapsed: false }));
  commit(ops, { label: 'Paste list' });
  return top;
}
