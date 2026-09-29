// Mind map data model. A map is a tree of nodes keyed by id; every mutation
// here works in place and the caller snapshots for undo (see history.js).

export const PALETTE = [
  '#3ea8ff', // electric blue
  '#39e36b', // neon green
  '#c45cff', // violet
  '#ffc53d', // gold
  '#29e0d8', // cyan
  '#ff5ca8', // magenta
  '#ff8a3d', // amber
  '#8f8cff', // periwinkle
];

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

export function createNode(title = 'New idea', parent = null) {
  return { id: uid(), title, note: '', color: null, parent, children: [], collapsed: false, pos: [0, 0, 0] };
}

export function createMap(title = 'Untitled map') {
  const root = createNode(title);
  return { id: uid(), title, rootId: root.id, nodes: { [root.id]: root }, updated: Date.now(), version: 1 };
}

export function addChild(map, parentId, title = 'New idea') {
  const parent = map.nodes[parentId];
  if (!parent) throw new Error(`no node ${parentId}`);
  const node = createNode(title, parentId);
  map.nodes[node.id] = node;
  parent.children.push(node.id);
  parent.collapsed = false;
  touch(map);
  return node;
}

export function addSibling(map, nodeId, title = 'New idea') {
  const node = map.nodes[nodeId];
  if (!node?.parent) return addChild(map, nodeId, title);
  const parent = map.nodes[node.parent];
  const sib = createNode(title, parent.id);
  map.nodes[sib.id] = sib;
  parent.children.splice(parent.children.indexOf(nodeId) + 1, 0, sib.id);
  touch(map);
  return sib;
}

export function removeNode(map, nodeId) {
  const node = map.nodes[nodeId];
  if (!node || nodeId === map.rootId) return false;
  for (const id of descendants(map, nodeId)) delete map.nodes[id];
  delete map.nodes[nodeId];
  const parent = map.nodes[node.parent];
  parent.children = parent.children.filter((c) => c !== nodeId);
  touch(map);
  return true;
}

export function renameNode(map, nodeId, title) {
  const node = map.nodes[nodeId];
  if (!node) return;
  node.title = title;
  if (nodeId === map.rootId) map.title = title;
  touch(map);
}

/** Move a node (with its subtree) under a new parent. Refuses cycles. */
export function reparent(map, nodeId, newParentId) {
  const node = map.nodes[nodeId];
  const target = map.nodes[newParentId];
  if (!node || !target || nodeId === map.rootId || node.parent === newParentId) return false;
  if (nodeId === newParentId || descendants(map, nodeId).includes(newParentId)) return false;
  const old = map.nodes[node.parent];
  old.children = old.children.filter((c) => c !== nodeId);
  target.children.push(nodeId);
  target.collapsed = false;
  node.parent = newParentId;
  touch(map);
  return true;
}

export function descendants(map, nodeId) {
  const out = [];
  const stack = [...(map.nodes[nodeId]?.children ?? [])];
  while (stack.length) {
    const id = stack.pop();
    const n = map.nodes[id];
    if (!n) continue;
    out.push(id);
    stack.push(...n.children);
  }
  return out;
}

export function depthOf(map, nodeId) {
  let d = 0;
  let n = map.nodes[nodeId];
  while (n?.parent) {
    d++;
    n = map.nodes[n.parent];
  }
  return d;
}

export function pathToRoot(map, nodeId) {
  const out = [];
  let n = map.nodes[nodeId];
  while (n) {
    out.push(n.id);
    n = n.parent ? map.nodes[n.parent] : null;
  }
  return out;
}

/** Ids of nodes that are shown (not hidden inside a collapsed ancestor). */
export function visibleIds(map) {
  const out = [];
  const stack = [map.rootId];
  while (stack.length) {
    const id = stack.pop();
    const n = map.nodes[id];
    if (!n) continue;
    out.push(id);
    if (!n.collapsed) stack.push(...n.children);
  }
  return out;
}

/** Top-level branch a node belongs to (the root's direct child), or the root. */
export function branchOf(map, nodeId) {
  const path = pathToRoot(map, nodeId);
  return path.length >= 2 ? path[path.length - 2] : path[0];
}

/** Resolved display color: own color, else inherited, else by branch index. */
export function colorOf(map, nodeId) {
  let n = map.nodes[nodeId];
  while (n) {
    if (n.color) return n.color;
    if (n.parent === map.rootId) {
      const i = map.nodes[map.rootId].children.indexOf(n.id);
      return PALETTE[i % PALETTE.length];
    }
    n = n.parent ? map.nodes[n.parent] : null;
  }
  return '#9fd8ff'; // root
}

export function search(map, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return Object.values(map.nodes)
    .map((n) => {
      const t = n.title.toLowerCase();
      const i = t.indexOf(q);
      const score = i === 0 ? 3 : i > 0 ? 2 : n.note.toLowerCase().includes(q) ? 1 : 0;
      return { n, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.n.title.localeCompare(b.n.title))
    .map((r) => r.n);
}

function touch(map) {
  map.updated = Date.now();
}

// ---------- outline import / export ----------

/** Parse an indented / bulleted / markdown-heading outline into a map. */
export function fromOutline(text) {
  const lines = text
    .split(/\r?\n/)
    .map((raw) => {
      const expanded = raw.replace(/\t/g, '  ');
      const heading = expanded.match(/^\s*(#{1,6})\s+(.*)$/);
      if (heading) return { level: (heading[1].length - 1) * 2, title: heading[2].trim(), heading: true };
      const m = expanded.match(/^(\s*)(?:[-*+•]|\d+[.)])?\s*(.*)$/);
      return { level: m[1].length, title: m[2].trim() };
    })
    .filter((l) => l.title);
  if (!lines.length) return null;
  // headings sit above bullets: shift bullets under the last heading
  let headingDepth = -1;
  for (const l of lines) {
    if (l.heading) headingDepth = l.level;
    else if (headingDepth >= 0) l.level += headingDepth + 2;
  }
  const map = createMap(lines[0].title);
  const stack = [{ level: lines[0].level, id: map.rootId }];
  for (const l of lines.slice(1)) {
    while (stack.length > 1 && stack[stack.length - 1].level >= l.level) stack.pop();
    const node = addChild(map, stack[stack.length - 1].id, l.title);
    stack.push({ level: l.level, id: node.id });
  }
  return map;
}

export function toOutline(map) {
  const out = [];
  const walk = (id, depth) => {
    const n = map.nodes[id];
    out.push(depth === 0 ? `# ${n.title}` : `${'  '.repeat(depth - 1)}- ${n.title}`);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(map.rootId, 0);
  return out.join('\n') + '\n';
}

/** Validate and normalise an imported JSON map. Throws on garbage. */
export function normalizeMap(data) {
  if (!data || typeof data !== 'object' || !data.nodes || !data.rootId || !data.nodes[data.rootId]) {
    throw new Error('Not a Mindverse map');
  }
  const nodes = {};
  for (const [id, n] of Object.entries(data.nodes)) {
    nodes[id] = {
      id,
      title: String(n.title ?? ''),
      note: String(n.note ?? ''),
      color: typeof n.color === 'string' ? n.color : null,
      parent: n.parent ?? null,
      children: Array.isArray(n.children) ? n.children.filter((c) => data.nodes[c]) : [],
      collapsed: !!n.collapsed,
      pos: Array.isArray(n.pos) && n.pos.length === 3 ? n.pos.map(Number) : [0, 0, 0],
    };
  }
  return {
    id: data.id || uid(),
    title: String(data.title ?? nodes[data.rootId].title),
    rootId: data.rootId,
    nodes,
    updated: Date.now(),
    version: 1,
  };
}

// ---------- sample ----------

export function sampleMap() {
  return fromOutline(`Innovation Hub: Future Tech
- Artificial Intelligence
  - Machine Learning
    - Deep Learning
    - Reinforcement Learning
  - Neural Networks
  - NLP
  - Ethics
  - Robotics
- Virtual Reality
  - Immersive Content
  - Hardware
    - Headsets
    - Haptics
  - Simulation
  - Social Spaces
- Genetics
  - Diagnostics
  - Health
  - Startups
  - Gene Editing
  - Bioinformatics
- Smart Cities
  - IoT
  - Mobility
    - Autonomous Transit
    - Micromobility
  - Energy
    - New Energy
    - Smart Grid
- Machine Learning
  - Deep Learning
  - NLP
  - Computer Vision
  - Federated Learning
`);
}
