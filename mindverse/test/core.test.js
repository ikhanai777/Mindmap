import { describe, expect, it } from 'vitest';
import {
  addChild, addSibling, colorOf, createMap, descendants, fromOutline, normalizeMap, removeNode,
  reparent, sampleMap, search, toOutline, visibleIds, PALETTE,
} from '../src/model.js';
import { computeLayout, radiusForDepth } from '../src/layout.js';
import { History } from '../src/store.js';

describe('model', () => {
  it('adds children and siblings in order', () => {
    const m = createMap('Root');
    const a = addChild(m, m.rootId, 'A');
    const c = addChild(m, m.rootId, 'C');
    const b = addSibling(m, a.id, 'B');
    expect(m.nodes[m.rootId].children).toEqual([a.id, b.id, c.id]);
    expect(b.parent).toBe(m.rootId);
  });

  it('removes a subtree but never the root', () => {
    const m = createMap('Root');
    const a = addChild(m, m.rootId, 'A');
    const a1 = addChild(m, a.id, 'A1');
    addChild(m, a1.id, 'A1x');
    expect(removeNode(m, m.rootId)).toBe(false);
    expect(removeNode(m, a.id)).toBe(true);
    expect(Object.keys(m.nodes)).toEqual([m.rootId]);
  });

  it('reparents and refuses cycles', () => {
    const m = createMap('Root');
    const a = addChild(m, m.rootId, 'A');
    const b = addChild(m, m.rootId, 'B');
    const a1 = addChild(m, a.id, 'A1');
    expect(reparent(m, a.id, a1.id)).toBe(false);
    expect(reparent(m, a.id, b.id)).toBe(true);
    expect(descendants(m, b.id).sort()).toEqual([a.id, a1.id].sort());
  });

  it('hides collapsed branches', () => {
    const m = createMap('Root');
    const a = addChild(m, m.rootId, 'A');
    addChild(m, a.id, 'A1');
    a.collapsed = true;
    expect(visibleIds(m)).toHaveLength(2);
  });

  it('colours nodes by top-level branch unless overridden', () => {
    const m = createMap('Root');
    const a = addChild(m, m.rootId, 'A');
    const b = addChild(m, m.rootId, 'B');
    const b1 = addChild(m, b.id, 'B1');
    expect(colorOf(m, a.id)).toBe(PALETTE[0]);
    expect(colorOf(m, b1.id)).toBe(PALETTE[1]);
    b.color = '#ffffff';
    expect(colorOf(m, b1.id)).toBe('#ffffff');
  });

  it('round-trips outlines', () => {
    const text = '# Root\n- A\n  - A1\n  - A2\n- B\n';
    const m = fromOutline(text);
    expect(m.title).toBe('Root');
    expect(toOutline(m)).toBe(text);
  });

  it('parses markdown headings with bullets beneath', () => {
    const m = fromOutline('# Plan\n## Goals\n- Ship\n- Learn\n## Risks\n- Time');
    const root = m.nodes[m.rootId];
    expect(root.children.map((id) => m.nodes[id].title)).toEqual(['Goals', 'Risks']);
    expect(m.nodes[root.children[0]].children).toHaveLength(2);
  });

  it('searches titles before notes', () => {
    const m = sampleMap();
    const hits = search(m, 'learn');
    expect(hits.length).toBeGreaterThan(2);
    expect(hits[0].title.toLowerCase()).toContain('learn');
  });

  it('rejects junk on import and keeps valid maps', () => {
    expect(() => normalizeMap({ foo: 1 })).toThrow();
    const m = sampleMap();
    const back = normalizeMap(JSON.parse(JSON.stringify(m)));
    expect(Object.keys(back.nodes)).toHaveLength(Object.keys(m.nodes).length);
  });
});

describe('layout', () => {
  it('places every visible node, root at the origin, without overlaps', () => {
    const m = sampleMap();
    const pos = computeLayout(m);
    expect(Object.keys(pos)).toHaveLength(visibleIds(m).length);
    expect(pos[m.rootId]).toEqual([0, 0, 0]);
    const depth = (id) => {
      let d = 0;
      for (let n = m.nodes[id]; n.parent; n = m.nodes[n.parent]) d++;
      return d;
    };
    const ids = Object.keys(pos);
    let overlaps = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [pos[ids[i]], pos[ids[j]]];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d < radiusForDepth(depth(ids[i])) + radiusForDepth(depth(ids[j]))) overlaps++;
      }
    expect(overlaps).toBe(0);
    for (const p of Object.values(pos)) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe('history', () => {
  it('undoes and redoes snapshots', () => {
    const h = new History();
    const m = createMap('Root');
    h.push(m);
    addChild(m, m.rootId, 'A');
    const undone = h.undo(m);
    expect(Object.keys(undone.nodes)).toHaveLength(1);
    const redone = h.redo(undone);
    expect(Object.keys(redone.nodes)).toHaveLength(2);
  });
});

describe('local layout', () => {
  it('keeps a newly added child clear of existing bubbles', async () => {
    const { layoutChildrenOf } = await import('../src/layout.js');
    const m = sampleMap();
    for (const [id, p] of Object.entries(computeLayout(m))) m.nodes[id].pos = p;
    const ai = m.nodes[m.rootId].children[0];
    const node = addChild(m, ai, 'Quantum AI');
    for (const [id, p] of Object.entries(layoutChildrenOf(m, ai))) m.nodes[id].pos = p;
    const me = m.nodes[node.id].pos;
    for (const other of Object.values(m.nodes)) {
      if (other.id === node.id) continue;
      const d = Math.hypot(...other.pos.map((v, i) => v - me[i]));
      expect(d).toBeGreaterThan(radiusForDepth(2) * 2);
    }
  });
});
