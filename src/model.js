// Core data model: maps, nodes, links, clusters, waypoints.
// Internally collections are id-keyed objects; exports use arrays (see io.js).

export const SCHEMA_VERSION = 1;
export const SHAPES = ['sphere', 'cube', 'octahedron', 'ring'];
export const SHAPE_MEANING = { sphere: 'Idea', cube: 'Task', octahedron: 'Decision', ring: 'Question' };
export const LAYOUTS = ['radial-sphere', 'cone-tree', 'force-galaxy', 'flat-2d'];
export const LAYOUT_NAMES = {
  'radial-sphere': 'Radial sphere',
  'cone-tree': 'Cone tree',
  'force-galaxy': 'Force galaxy',
  'flat-2d': 'Flat 2D',
};
export const LINK_STYLES = ['solid', 'dashed', 'flow'];

let counter = 0;
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export function createNode(fields = {}) {
  const now = Date.now();
  return {
    id: uid('n'),
    parentId: null,
    title: '',
    note: '',
    color: null, // null = inherit from branch / theme
    icon: '',
    shape: 'sphere',
    size: 1,
    tags: [],
    pos: null, // null = layout engine places it; [x,y,z] = pinned
    collapsed: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

export function createLink(fields = {}) {
  return { id: uid('l'), from: null, to: null, label: '', style: 'dashed', directed: true, ...fields };
}

export function createCluster(fields = {}) {
  return { id: uid('c'), name: 'Cluster', nodeIds: [], color: '#A78BFA', ...fields };
}

export function createWaypoint(fields = {}) {
  return { id: uid('w'), name: 'View', position: [0, 0, 10], target: [0, 0, 0], order: 0, ...fields };
}

export function createMap(title = 'Untitled map', rootTitle = '') {
  const now = Date.now();
  const root = createNode({ title: rootTitle, size: 1.6 });
  return {
    version: SCHEMA_VERSION,
    id: uid('map'),
    title,
    rootId: root.id,
    theme: 'void',
    layoutMode: 'radial-sphere',
    camera: null, // last view bookmark {mode, position, target}
    createdAt: now,
    updatedAt: now,
    nodes: { [root.id]: root },
    links: {},
    clusters: {},
    waypoints: {},
  };
}

// ---------- tree helpers ----------

const indexCache = new WeakMap();
const docRevs = new WeakMap();

/** Mark a doc as structurally changed so cached indexes are rebuilt. */
export function touchDoc(doc) {
  docRevs.set(doc, (docRevs.get(doc) || 0) + 1);
}

/** Build (and cache per doc revision) structural indexes. */
export function getIndex(doc) {
  const rev = docRevs.get(doc) || 0;
  const cached = indexCache.get(doc);
  if (cached && cached.rev === rev) return cached;
  const children = new Map();
  const roots = [];
  for (const n of Object.values(doc.nodes)) {
    const p = n.parentId && doc.nodes[n.parentId] ? n.parentId : null;
    if (p === null) {
      if (n.id !== doc.rootId) roots.push(n.id);
      continue;
    }
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n.id);
  }
  const byOrder = (a, b) => {
    const na = doc.nodes[a], nb = doc.nodes[b];
    return (na.order - nb.order) || (na.createdAt - nb.createdAt) || (a < b ? -1 : 1);
  };
  for (const list of children.values()) list.sort(byOrder);
  roots.sort(byOrder);
  if (doc.nodes[doc.rootId]) roots.unshift(doc.rootId);

  const depth = new Map();
  const descCount = new Map();
  const branch = new Map(); // top-level branch index (for color)
  const order = []; // DFS order, all nodes
  const visit = (id, d, b) => {
    depth.set(id, d);
    branch.set(id, b);
    order.push(id);
    let count = 0;
    const kids = children.get(id) || [];
    kids.forEach((k, i) => {
      visit(k, d + 1, d === 0 ? i : b);
      count += 1 + descCount.get(k);
    });
    descCount.set(id, count);
  };
  roots.forEach((r, i) => visit(r, 0, r === doc.rootId ? -1 : i));

  const index = {
    rev,
    children,
    roots,
    depth,
    descCount,
    branch,
    order,
    kids: (id) => children.get(id) || [],
  };
  indexCache.set(doc, index);
  return index;
}

export function ancestors(doc, id) {
  const out = [];
  let cur = doc.nodes[id];
  const seen = new Set();
  while (cur && cur.parentId && doc.nodes[cur.parentId] && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    out.push(cur.parentId);
    cur = doc.nodes[cur.parentId];
  }
  return out;
}

export function pathTo(doc, id) {
  return [...ancestors(doc, id).reverse(), id];
}

export function subtree(doc, id, index) {
  const idx = index || getIndex(doc);
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    for (const k of idx.kids(cur)) stack.push(k);
  }
  return out;
}

export function isDescendant(doc, id, maybeAncestor) {
  return ancestors(doc, id).includes(maybeAncestor);
}

/** A node is hidden when any ancestor is collapsed. */
export function isHiddenByCollapse(doc, id) {
  return ancestors(doc, id).some((a) => doc.nodes[a].collapsed);
}

export function nodeLabel(node) {
  return (node.icon ? node.icon + ' ' : '') + (node.title || '');
}

// ---------- migration ----------

/** Accept any exported JSON (array collections or id maps, any version) and return an internal doc. */
export function migrate(json) {
  if (!json || typeof json !== 'object') throw new Error('Not a map file');
  const toObj = (coll, factory) => {
    const out = {};
    const list = Array.isArray(coll) ? coll : Object.values(coll || {});
    for (const item of list) {
      if (!item || !item.id) continue;
      out[item.id] = factory(item);
    }
    return out;
  };
  let legacyOrder = 0;
  const nodes = toObj(json.nodes, (n) => {
    const node = createNode({ ...n });
    node.id = n.id;
    node.tags = Array.isArray(n.tags) ? n.tags.map(String) : [];
    node.pos = Array.isArray(n.pos) && n.pos.length === 3 && n.pos.every(Number.isFinite) ? n.pos.slice() : null;
    if (!SHAPES.includes(node.shape)) node.shape = 'sphere';
    node.size = Number.isFinite(n.size) && n.size > 0 ? n.size : 1;
    node.title = String(n.title ?? '');
    node.note = String(n.note ?? '');
    node.order = Number.isFinite(n.order) ? n.order : legacyOrder++; // legacy files: keep array order
    return node;
  });
  if (!Object.keys(nodes).length) {
    const root = createNode({ size: 1.6 });
    nodes[root.id] = root;
  }
  let rootId = json.rootId && nodes[json.rootId] ? json.rootId : null;
  if (!rootId) rootId = Object.values(nodes).find((n) => !n.parentId)?.id || Object.keys(nodes)[0];
  nodes[rootId].parentId = null;
  // break parent cycles & dangling parents
  for (const n of Object.values(nodes)) {
    if (n.parentId && !nodes[n.parentId]) n.parentId = null;
    const seen = new Set([n.id]);
    let p = n.parentId;
    while (p) {
      if (seen.has(p)) { n.parentId = null; break; }
      seen.add(p);
      p = nodes[p]?.parentId;
    }
  }

  const links = toObj(json.links, (l) => ({ ...createLink(), ...l }));
  for (const [id, l] of Object.entries(links)) if (!nodes[l.from] || !nodes[l.to]) delete links[id];
  const clusters = toObj(json.clusters, (c) => ({ ...createCluster(), ...c, nodeIds: (c.nodeIds || []).filter((x) => nodes[x]) }));
  const waypoints = toObj(json.waypoints, (w) => ({ ...createWaypoint(), ...w }));
  const now = Date.now();
  return {
    version: SCHEMA_VERSION,
    id: json.id || uid('map'),
    title: String(json.title || 'Imported map'),
    rootId,
    theme: json.theme || 'void',
    layoutMode: LAYOUTS.includes(json.layoutMode) ? json.layoutMode : 'radial-sphere',
    camera: json.camera || null,
    createdAt: json.createdAt || now,
    updatedAt: json.updatedAt || now,
    nodes,
    links,
    clusters,
    waypoints,
  };
}

/** Internal doc -> portable JSON (arrays, matches the spec schema). */
export function serialize(doc) {
  return {
    version: SCHEMA_VERSION,
    id: doc.id,
    title: doc.title,
    rootId: doc.rootId,
    theme: doc.theme,
    layoutMode: doc.layoutMode,
    camera: doc.camera,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    nodes: getIndex(doc).order.map((id) => doc.nodes[id]),
    links: Object.values(doc.links),
    clusters: Object.values(doc.clusters),
    waypoints: Object.values(doc.waypoints).sort((a, b) => a.order - b.order),
  };
}

// ---------- sample map (onboarding) ----------

export function createSampleMap() {
  const doc = createMap('Welcome to Constellate', 'Constellate');
  const root = doc.nodes[doc.rootId];
  root.icon = '✨';
  root.note = 'Your ideas as a **living constellation**.\n\n- [x] Open the app\n- [ ] Add your first idea with **+**';
  const add = (parentId, title, extra = {}) => {
    const kids = Object.values(doc.nodes).filter((n) => n.parentId === parentId).length;
    const n = createNode({ parentId, title, order: kids, ...extra });
    doc.nodes[n.id] = n;
    return n.id;
  };
  const cap = add(root.id, 'Capture', { icon: '✍️' });
  add(cap, 'Tap + to add an idea');
  add(cap, 'Outline mode for brain-dumps', { shape: 'cube' });
  add(cap, 'Paste a bulleted list');
  add(cap, 'Hold + to dictate');
  const nav = add(root.id, 'Navigate', { icon: '🧭' });
  add(nav, 'Orbit — turn the globe');
  add(nav, 'Fly — drone camera');
  add(nav, 'Walk — stroll inside');
  const arr = add(root.id, 'Arrange', { icon: '🪐' });
  add(arr, 'Radial sphere');
  add(arr, 'Cone tree');
  add(arr, 'Force galaxy');
  add(arr, 'Flat 2D');
  const share = add(root.id, 'Share', { icon: '📤' });
  add(share, 'Export JSON · Markdown · OPML');
  add(share, 'Walkaround HTML viewer');
  const q = add(root.id, 'What will you map first?', { shape: 'ring', tags: ['question'] });
  add(q, 'Launch plan', { shape: 'octahedron', tags: ['decision'] });
  const l = createLink({ from: cap, to: arr, label: 'feeds' });
  doc.links[l.id] = l;
  return doc;
}
