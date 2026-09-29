// 3D radial-tree layout. Top-level branches fan out around the root in a
// roughly screen-facing disc (with depth variation, like a galaxy); deeper
// levels spread in cones that continue the direction of their parent.

export const NODE_RADIUS = [3.1, 2.1, 1.5, 1.2, 1.05];
export const radiusForDepth = (d) => NODE_RADIUS[Math.min(d, NODE_RADIUS.length - 1)];

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

function subtreeSize(map, id) {
  const n = map.nodes[id];
  if (!n || n.collapsed) return 1;
  return 1 + n.children.reduce((s, c) => s + subtreeSize(map, c), 0);
}

// u lies in the screen (XY) plane, v points mostly into depth
function basis(dir) {
  const up = Math.abs(dir[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = norm(cross(dir, up));
  const v = norm(cross(dir, u));
  return [u, v];
}

/** Place children of `parentId` (recursively) given the parent's outward direction. */
function placeChildren(map, parentId, dir, depth, out) {
  const parent = map.nodes[parentId];
  const kids = parent.collapsed ? [] : parent.children;
  const n = kids.length;
  if (!n) return;
  const [u, v] = basis(dir);
  const cone = n === 1 ? 0 : Math.min(1.2, 0.45 + n * 0.13);
  const base = out[parentId];
  // rotate the fan so it favours the screen plane (u roughly in-plane)
  const phase = depth * 0.9;
  kids.forEach((cid, i) => {
    const size = subtreeSize(map, cid);
    // spread across the in-plane arc, with a little depth wobble
    const phi = n === 1 ? 0 : -Math.PI / 2 + (Math.PI * i) / (n - 1) + Math.sin(phase + i) * 0.15;
    // squash the cone along v so branches stay readable from the front
    const d = norm(
      add(add(dir, u, Math.sin(cone) * Math.sin(phi) * 1.5), v, Math.sin(cone) * Math.cos(phi + i) * 0.35),
    );
    const len = 3.6 * Math.pow(0.85, depth) + radiusForDepth(depth) + radiusForDepth(depth + 1) * 1.6 + Math.sqrt(size) * 1.1;
    out[cid] = add(base, d, len);
    placeChildren(map, cid, d, depth + 1, out);
  });
}

/** Compute positions for every visible node. Returns { id: [x,y,z] }. */
export function computeLayout(map) {
  const out = {};
  const root = map.nodes[map.rootId];
  out[root.id] = [0, 0, 0];
  const kids = root.collapsed ? [] : root.children;
  const n = kids.length;
  const weights = kids.map((c) => Math.sqrt(subtreeSize(map, c)));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  kids.forEach((cid, i) => {
    // angular share proportional to subtree weight; start at top-left like a clock
    const a = Math.PI * 0.75 + ((acc + weights[i] / 2) / total) * Math.PI * 2;
    acc += weights[i];
    const tilt = n > 1 ? Math.sin(i * 2.399) * 0.45 : 0; // golden-angle depth wobble
    const dir = norm([Math.cos(a), Math.sin(a) * 0.9, tilt]);
    const len = 9.5 + Math.sqrt(subtreeSize(map, cid)) * 1.1;
    out[cid] = add(out[root.id], dir, len);
    placeChildren(map, cid, dir, 1, out);
  });
  relax(map, out);
  return out;
}

/**
 * Push apart overlapping nodes a few times; the root stays fixed.
 * With `movable`, only those ids move and everything else acts as a wall.
 */
export function relax(map, pos, iterations = 40, movable = null) {
  const ids = Object.keys(pos);
  const r = Object.fromEntries(ids.map((id) => [id, radiusForDepth(depth(map, id))]));
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]];
        const b = pos[ids[j]];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const dist = Math.hypot(dx, dy, dz) || 0.001;
        const min = r[ids[i]] + r[ids[j]] + 0.8;
        if (dist >= min) continue;
        moved = true;
        const push = (min - dist) / 2 / dist;
        const aFixed = ids[i] === map.rootId || (movable && !movable.has(ids[i]));
        const bFixed = ids[j] === map.rootId || (movable && !movable.has(ids[j]));
        if (aFixed && bFixed) continue;
        const sa = bFixed ? 2 : aFixed ? 0 : 1;
        const sb = aFixed ? 2 : bFixed ? 0 : 1;
        a[0] -= dx * push * sa; a[1] -= dy * push * sa; a[2] -= dz * push * sa;
        b[0] += dx * push * sb; b[1] += dy * push * sb; b[2] += dz * push * sb;
      }
    }
    if (!moved) break;
  }
  return pos;
}

function depth(map, id) {
  let d = 0;
  let n = map.nodes[id];
  while (n?.parent) {
    d++;
    n = map.nodes[n.parent];
  }
  return d;
}

/**
 * Place the children of one node without disturbing the rest of the map
 * (used when adding a node so the user's manual arrangement survives).
 */
export function layoutChildrenOf(map, parentId) {
  const parent = map.nodes[parentId];
  const out = { [parentId]: [...parent.pos] };
  let dir;
  if (parent.parent) {
    const gp = map.nodes[parent.parent].pos;
    dir = norm([parent.pos[0] - gp[0], parent.pos[1] - gp[1], parent.pos[2] - gp[2]]);
    placeChildren(map, parentId, dir, depth(map, parentId), out);
  } else {
    return computeLayout(map); // root's children: full layout keeps the disc balanced
  }
  // settle the new arrangement against the rest of the (visible) map
  const movable = new Set(Object.keys(out).filter((id) => id !== parentId));
  const all = { ...out };
  const stack = [map.rootId];
  while (stack.length) {
    const n = map.nodes[stack.pop()];
    if (!(n.id in all)) all[n.id] = [...n.pos];
    if (!n.collapsed) stack.push(...n.children);
  }
  relax(map, all, 60, movable);
  for (const id of movable) out[id] = all[id];
  return out;
}
