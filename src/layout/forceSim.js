// Force-directed "galaxy" layout (d3-force-3d). Pure function so it runs in a
// Web Worker in the app and directly in tests.
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d';

export function runForce({ nodes, links, clusters }, ticks = 300) {
  const byId = new Map();
  const simNodes = nodes.map((n, i) => {
    const s = { id: n.id, desc: n.desc };
    if (Number.isFinite(n.x)) Object.assign(s, { x: n.x, y: n.y, z: n.z });
    else {
      // deterministic spiral seed
      const a = i * 2.399963, r = 3 * Math.sqrt(i + 1);
      Object.assign(s, { x: Math.cos(a) * r, y: (i % 7) - 3, z: Math.sin(a) * r });
    }
    if (n.pinned) Object.assign(s, { fx: n.pinned[0], fy: n.pinned[1], fz: n.pinned[2] });
    if (n.root && !n.pinned) Object.assign(s, { fx: 0, fy: 0, fz: 0 });
    byId.set(n.id, s);
    return s;
  });
  const simLinks = links.filter((l) => byId.has(l.source) && byId.has(l.target)).map((l) => ({ ...l }));

  // clusters pull their members toward their shared centroid
  const clusterForce = (alpha) => {
    for (const ids of clusters) {
      const members = ids.map((id) => byId.get(id)).filter(Boolean);
      if (members.length < 2) continue;
      let cx = 0, cy = 0, cz = 0;
      for (const m of members) { cx += m.x; cy += m.y; cz += m.z; }
      cx /= members.length; cy /= members.length; cz /= members.length;
      for (const m of members) {
        m.vx += (cx - m.x) * 0.08 * alpha;
        m.vy += (cy - m.y) * 0.08 * alpha;
        m.vz += (cz - m.z) * 0.08 * alpha;
      }
    }
  };

  const sim = forceSimulation(simNodes, 3)
    .force('link', forceLink(simLinks).id((d) => d.id)
      .distance((l) => (l.cross ? 5 : 3.2 + Math.sqrt(l.target.desc || 0) * 0.6))
      .strength((l) => (l.cross ? 0.5 : 0.9)))
    .force('charge', forceManyBody().strength((d) => -28 - Math.min(40, (d.desc || 0) * 2)).distanceMax(60))
    .force('center', forceCenter(0, 0, 0).strength(0.05))
    .force('cluster', clusterForce)
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
  return simNodes.map((n) => [n.id, [n.x, n.y, n.z]]);
}
