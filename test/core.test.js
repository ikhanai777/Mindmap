// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createMap, createSampleMap, getIndex, migrate, serialize, pathTo } from '../src/model.js';
import { loadDoc, getDoc, undo, redo, canUndo } from '../src/store.js';
import * as A from '../src/actions.js';
import { parseOutline, exportMarkdown, importMarkdown, exportOPML, importOPML, exportJSON, importJSON } from '../src/io.js';
import { radialSphere, coneTree, flat2D, forceInput } from '../src/layout/solvers.js';
import { runForce } from '../src/layout/forceSim.js';

let root;
beforeEach(() => {
  loadDoc(createMap('Test', 'Launch'));
  root = getDoc().rootId;
});

describe('actions + history', () => {
  it('adds children and siblings in order', () => {
    const a = A.addChild(root, { title: 'A' });
    const b = A.addSibling(a, { title: 'B' });
    const c = A.addSibling(a, { title: 'C' }); // inserted between A and B
    expect(getIndex(getDoc()).kids(root).map((id) => getDoc().nodes[id].title)).toEqual(['A', 'C', 'B']);
    expect(b && c).toBeTruthy();
  });

  it('undoes and redoes unlimited steps', () => {
    for (let i = 0; i < 50; i++) A.addChild(root, { title: 'n' + i });
    expect(Object.keys(getDoc().nodes)).toHaveLength(51);
    while (canUndo()) undo();
    expect(Object.keys(getDoc().nodes)).toHaveLength(1);
    for (let i = 0; i < 50; i++) redo();
    expect(Object.keys(getDoc().nodes)).toHaveLength(51);
  });

  it('coalesces consecutive title edits into one undo step', () => {
    const a = A.addChild(root);
    A.addChild(root); // break the add-step coalescing
    A.setTitle(a, 'H');
    A.setTitle(a, 'He');
    A.setTitle(a, 'Hello');
    expect(getDoc().nodes[a].title).toBe('Hello');
    undo();
    expect(getDoc().nodes[a].title).toBe('');
  });

  it('deletes subtrees with incident links and never deletes root', () => {
    const a = A.addChild(root, { title: 'A' });
    const a1 = A.addChild(a, { title: 'A1' });
    const b = A.addChild(root, { title: 'B' });
    A.addLink(a1, b, { label: 'x' });
    A.deleteNodes([a, root]);
    const doc = getDoc();
    expect(doc.nodes[root]).toBeTruthy();
    expect(doc.nodes[a] || doc.nodes[a1] || doc.nodes[b]).toBeFalsy();
    expect(Object.keys(doc.links)).toHaveLength(0);
    undo();
    expect(Object.keys(getDoc().nodes)).toHaveLength(4);
    expect(Object.keys(getDoc().links)).toHaveLength(1);
  });

  it('prevents reparent cycles', () => {
    const a = A.addChild(root);
    const a1 = A.addChild(a);
    expect(A.reparent(a, a1)).toBe(false);
    const b = A.addChild(root);
    expect(A.reparent(a1, b)).toBe(true);
    expect(pathTo(getDoc(), a1)).toEqual([root, b, a1]);
  });

  it('indents and outdents', () => {
    const a = A.addChild(root, { title: 'A' });
    const b = A.addChild(root, { title: 'B' });
    expect(A.indent(b)).toBe(true);
    expect(getDoc().nodes[b].parentId).toBe(a);
    expect(A.outdent(b)).toBe(true);
    expect(getDoc().nodes[b].parentId).toBe(root);
    expect(getIndex(getDoc()).kids(root)).toEqual([a, b]);
  });

  it('imports a pasted branch in one undo step', () => {
    const items = parseOutline('- One\n  - One.a\n- Two');
    A.importBranch(root, items);
    expect(Object.keys(getDoc().nodes)).toHaveLength(4);
    undo();
    expect(Object.keys(getDoc().nodes)).toHaveLength(1);
  });
});

describe('parsing & formats', () => {
  it('parses bulleted, numbered, markdown heading and tab-indented lists', () => {
    const t = parseOutline('# Plan\n- a\n  - b\n\t- c\n1. d\n* [ ] e');
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe('Plan');
    expect(t[0].children.map((x) => x.title)).toEqual(['a', 'd', 'e']);
    expect(t[0].children[0].children.map((x) => x.title)).toEqual(['b', 'c']);
  });

  it('parses plain indented lines', () => {
    const t = parseOutline('Root\n  Child\n    Grandchild\n  Child 2');
    expect(t[0].children.map((x) => x.title)).toEqual(['Child', 'Child 2']);
    expect(t[0].children[0].children[0].title).toBe('Grandchild');
  });

  it('round-trips Markdown', () => {
    const doc = createSampleMap();
    const md = exportMarkdown(doc);
    const back = importMarkdown(md);
    expect(Object.keys(back.nodes)).toHaveLength(Object.keys(doc.nodes).length);
    expect(back.title).toBe(doc.title);
  });

  it('round-trips OPML with notes', () => {
    const doc = createSampleMap();
    const back = importOPML(exportOPML(doc));
    expect(Object.keys(back.nodes)).toHaveLength(Object.keys(doc.nodes).length);
    expect(back.nodes[back.rootId].note).toContain('living constellation');
  });

  it('round-trips JSON with full fidelity and a fresh id', () => {
    const doc = createSampleMap();
    const back = importJSON(exportJSON(doc));
    expect(back.id).not.toBe(doc.id);
    expect(serialize(back).nodes).toEqual(serialize(doc).nodes);
    expect(Object.values(back.links)).toEqual(Object.values(doc.links));
  });

  it('migrates the spec example schema', () => {
    const doc = migrate({
      id: 'map_01', title: 'Q4 launch', rootId: 'n1', layoutMode: 'radial-sphere',
      nodes: [
        { id: 'n1', parentId: null, title: 'Launch', color: '#7CF7FF', size: 1.6 },
        { id: 'n2', parentId: 'n1', title: 'Pricing', tags: ['decision'], pos: null },
        { id: 'n5', parentId: 'n1', title: 'Beta' },
      ],
      links: [{ id: 'l1', from: 'n2', to: 'n5', label: 'depends on', style: 'dashed' }, { id: 'l2', from: 'n2', to: 'zz' }],
      clusters: [], waypoints: [],
    });
    expect(doc.version).toBe(1);
    expect(doc.nodes.n2.tags).toEqual(['decision']);
    expect(Object.keys(doc.links)).toEqual(['l1']);
  });
});

describe('layouts', () => {
  const bigDoc = () => {
    const doc = createSampleMap();
    loadDoc(doc);
    const r = doc.rootId;
    for (let i = 0; i < 5; i++) {
      const b = A.addChild(r, { title: 'b' + i });
      for (let j = 0; j < 8; j++) A.addChild(b, { title: `b${i}.${j}` });
    }
    return getDoc();
  };

  for (const [name, fn] of [['radial', radialSphere], ['cone', coneTree], ['flat', flat2D]]) {
    it(`${name} places every visible node at a finite, distinct position`, () => {
      const doc = bigDoc();
      const out = fn(doc);
      expect(out.size).toBe(Object.keys(doc.nodes).length);
      const keys = new Set();
      for (const p of out.values()) {
        expect(p.every(Number.isFinite)).toBe(true);
        keys.add(p.map((v) => v.toFixed(2)).join(','));
      }
      expect(keys.size).toBe(out.size);
    });
  }

  it('respects pinned nodes and collapsed branches', () => {
    const doc = bigDoc();
    const b = getIndex(doc).kids(doc.rootId)[0];
    A.pinNode(b, [10, 20, 30]);
    const b2 = getIndex(getDoc()).kids(doc.rootId)[1];
    A.toggleCollapse(b2);
    const out = radialSphere(getDoc());
    expect(out.get(b)).toEqual([10, 20, 30]);
    for (const k of getIndex(getDoc()).kids(b2)) expect(out.has(k)).toBe(false);
  });

  it('force galaxy converges with pinned nodes fixed', () => {
    const doc = bigDoc();
    const b = getIndex(doc).kids(doc.rootId)[0];
    A.pinNode(b, [5, 5, 5]);
    const res = new Map(runForce(forceInput(getDoc()), 120));
    expect(res.get(b)).toEqual([5, 5, 5]);
    for (const p of res.values()) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe('quick-add history', () => {
  it('folds the first naming of a new idea into its add step', () => {
    const a = A.addChild(root);
    A.setTitle(a, 'Idea');
    undo();
    expect(getDoc().nodes[a]).toBeUndefined();
  });
});
