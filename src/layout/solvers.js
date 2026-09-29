// Deterministic layout solvers. Each returns Map<id, [x,y,z]> for visible nodes.
// Pinned nodes (node.pos) keep their position and the solver flows around them:
// their children are placed relative to the pinned position.
import { getIndex } from '../model.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function visibleKids(doc, idx, id) {
  return doc.nodes[id].collapsed ? [] : idx.kids(id);
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Rotate a local direction (around +Z) into the frame whose Z axis is `axis`. */
function toFrame(local, axis) {
  const z = norm(axis);
  const ref = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x = norm([ref[1] * z[2] - ref[2] * z[1], ref[2] * z[0] - ref[0] * z[2], ref[0] * z[1] - ref[1] * z[0]]);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [
    local[0] * x[0] + local[1] * y[0] + local[2] * z[0],
    local[0] * x[1] + local[1] * y[1] + local[2] * z[1],
    local[0] * x[2] + local[1] * y[2] + local[2] * z[2],
  ];
}

/** Fibonacci points over a spherical cap of half-angle `cap` (PI = full sphere). */
function capDirections(n, cap, twist = 0) {
  if (n === 1) return [[0, 0, 1]];
  const out = [];
  const cosMin = Math.cos(cap);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cz = 1 - (1 - cosMin) * t;
    const r = Math.sqrt(Math.max(0, 1 - cz * cz));
    const phi = i * GOLDEN + twist;
    out.push([Math.cos(phi) * r, Math.sin(phi) * r, cz]);
  }
  return out;
}

function placeFloatingRoots(doc, idx, out, place) {
  // extra trees (floating nodes) orbit the main tree on a ring unless pinned
  const floats = idx.roots.filter((r) => r !== doc.rootId);
  let extent = 8;
  for (const p of out.values()) extent = Math.max(extent, Math.hypot(p[0], p[1], p[2]));
  floats.forEach((id, i) => {
    const n = doc.nodes[id];
    const a = (i / Math.max(1, floats.length)) * Math.PI * 2 + 0.6;
    const pos = n.pos ? n.pos.slice() : [Math.cos(a) * (extent + 6), 0, Math.sin(a) * (extent + 6)];
    place(id, pos);
  });
}

export function radialSphere(doc) {
  const idx = getIndex(doc);
  const out = new Map();
  const place = (id, pos, dir, depth) => {
    const node = doc.nodes[id];
    if (node.pos) pos = node.pos.slice();
    out.set(id, pos);
    const kids = visibleKids(doc, idx, id);
    const n = kids.length;
    if (!n) return;
    let dirs;
    if (depth === 0) dirs = capDirections(n, Math.PI, 0.3).map((d) => [d[0], d[2] * 0.75, d[1]]); // flatten a bit vertically
    else {
      const cap = Math.min(Math.PI * 0.55, 0.35 + 0.16 * n);
      dirs = capDirections(n, cap, depth * 1.3).map((d) => toFrame(d, dir));
    }
    const base = depth === 0 ? 4.2 + Math.sqrt(n) * 1.1 : 2.4 + Math.sqrt(n) * 0.75;
    kids.forEach((k, i) => {
      const d = norm(dirs[i]);
      const r = base * (1 + 0.22 * Math.log2(1 + idx.descCount.get(k)));
      place(k, add(pos, d, r), d, depth + 1);
    });
  };
  place(doc.rootId, [0, 0, 0], [0, 1, 0], 0);
  placeFloatingRoots(doc, idx, out, (id, pos) => place(id, pos, [0, 1, 0], 1));
  return out;
}

export function coneTree(doc) {
  const idx = getIndex(doc);
  const out = new Map();
  const LEVEL = 4;
  const radius = new Map();
  const measure = (id) => {
    const kids = visibleKids(doc, idx, id);
    if (!kids.length) { radius.set(id, 0.9); return 0.9; }
    let sum = 0;
    for (const k of kids) sum += 2 * (measure(k) + 0.35);
    const r = Math.max(1.6, kids.length === 1 ? 0 : sum / (2 * Math.PI));
    radius.set(id, r);
    return Math.max(r, 0.9);
  };
  const place = (id, pos, depth) => {
    const node = doc.nodes[id];
    if (node.pos) pos = node.pos.slice();
    out.set(id, pos);
    const kids = visibleKids(doc, idx, id);
    if (!kids.length) return;
    const R = kids.length === 1 ? 0 : radius.get(id);
    const total = kids.reduce((s, k) => s + Math.max(radius.get(k), 0.9) + 0.35, 0);
    let acc = depth * 0.7;
    for (const k of kids) {
      const w = Math.max(radius.get(k), 0.9) + 0.35;
      const a = acc + (w / total) * Math.PI;
      acc += (w / total) * Math.PI * 2;
      place(k, [pos[0] + Math.cos(a) * R, pos[1] - LEVEL, pos[2] + Math.sin(a) * R], depth + 1);
    }
  };
  for (const r of idx.roots) measure(r);
  place(doc.rootId, [0, 0, 0], 0);
  // lift the tree so its middle sits at the origin
  let minY = 0;
  for (const p of out.values()) minY = Math.min(minY, p[1]);
  const shift = -minY / 2;
  for (const [id, p] of out) if (!doc.nodes[id].pos) p[1] += shift;
  placeFloatingRoots(doc, idx, out, (id, pos) => place(id, pos, 1));
  return out;
}

export function flat2D(doc) {
  const idx = getIndex(doc);
  const out = new Map();
  const DX = 6.5, DY = 1.9;
  let cursor = 0;
  const place = (id, depth, x0) => {
    const kids = visibleKids(doc, idx, id);
    const node = doc.nodes[id];
    let y;
    if (!kids.length) { y = cursor; cursor += DY; }
    else {
      const ys = kids.map((k) => place(k, depth + 1, x0));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    out.set(id, node.pos ? node.pos.slice() : [x0 + depth * DX, -y, 0]);
    return y;
  };
  for (const r of idx.roots) {
    place(r, 0, 0);
    cursor += DY * 1.5;
  }
  // center the unpinned tree on the origin
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [id, p] of out) {
    if (doc.nodes[id].pos) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
  const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
  for (const [id, p] of out) {
    if (doc.nodes[id].pos) continue;
    p[0] -= cx; p[1] -= cy;
  }
  return out;
}

/** Plain data for the force worker (structured-clone friendly). */
export function forceInput(doc, seed) {
  const idx = getIndex(doc);
  const visible = [];
  const walk = (id) => { visible.push(id); visibleKids(doc, idx, id).forEach(walk); };
  idx.roots.forEach(walk);
  const set = new Set(visible);
  const nodes = visible.map((id) => {
    const n = doc.nodes[id];
    const p = seed?.get(id);
    return { id, pinned: n.pos, x: p?.[0], y: p?.[1], z: p?.[2], desc: idx.descCount.get(id) || 0, root: id === doc.rootId };
  });
  const links = [];
  for (const id of visible) {
    const n = doc.nodes[id];
    if (n.parentId && set.has(n.parentId)) links.push({ source: n.parentId, target: id, cross: false });
  }
  for (const l of Object.values(doc.links)) if (set.has(l.from) && set.has(l.to)) links.push({ source: l.from, target: l.to, cross: true });
  const clusters = Object.values(doc.clusters).map((c) => c.nodeIds.filter((x) => set.has(x))).filter((c) => c.length > 1);
  return { nodes, links, clusters };
}
