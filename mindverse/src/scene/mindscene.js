// Keeps the 3D views in sync with the map and handles picking, hover,
// selection highlighting, camera fly-to and node dragging.
import * as THREE from 'three';
import { NodeView } from './nodes.js';
import { EdgeView } from './edges.js';
import { radiusForDepth } from '../layout.js';
import { colorOf, depthOf, descendants, pathToRoot, visibleIds } from '../model.js';

export class MindScene {
  constructor(world) {
    this.world = world;
    this.root = new THREE.Group();
    world.scene.add(this.root);
    this.nodes = new Map();
    this.edges = new Map();
    this.map = null;
    this.selectedId = null;
    this.hoverId = null;
    this.focusSet = null; // ids highlighted by search/path
    this.raycaster = new THREE.Raycaster();
    this.fly = null;
    this.timer = new THREE.Timer();
  }

  sync(map, { instant = false } = {}) {
    this.map = map;
    const visible = new Set(visibleIds(map));
    for (const [id, view] of this.nodes) {
      if (!visible.has(id)) {
        this.root.remove(view.group);
        this.world.labelScene.remove(view.label);
        view.dispose();
        this.nodes.delete(id);
      }
    }
    for (const id of visible) {
      const n = map.nodes[id];
      let view = this.nodes.get(id);
      if (!view) {
        view = new NodeView(id);
        // new nodes grow out of their parent
        const from = n.parent && this.nodes.get(n.parent);
        view.current.fromArray(from && !instant ? from.current.toArray() : n.pos);
        if (instant) view.scale = 1;
        this.nodes.set(id, view);
        this.root.add(view.group);
        this.world.labelScene.add(view.label);
      }
      const depth = depthOf(map, id);
      const color = colorOf(map, id);
      view.depth = depth;
      view.radius = radiusForDepth(depth);
      view.target.fromArray(n.pos);
      if (instant) view.current.copy(view.target);
      view.setColor(color);
      const hidden = n.collapsed ? descendants(map, id).length : 0;
      view.setLabel(n.title, color, { root: id === map.rootId, badge: hidden ? `+${hidden}` : '' });
    }
    // edges
    const wanted = new Set();
    for (const id of visible) {
      const n = map.nodes[id];
      if (!n.parent) continue;
      const key = `${n.parent}>${id}`;
      wanted.add(key);
      let e = this.edges.get(key);
      if (!e) {
        e = new EdgeView(n.parent, id);
        this.edges.set(key, e);
        this.root.add(e.mesh);
      }
      e.setColors(colorOf(map, n.parent), colorOf(map, id));
    }
    for (const [key, e] of this.edges) {
      if (!wanted.has(key)) {
        this.root.remove(e.mesh);
        e.dispose();
        this.edges.delete(key);
      }
    }
    this.refreshHighlight();
  }

  setSelected(id) {
    this.selectedId = id;
    this.refreshHighlight();
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.refreshHighlight();
  }

  setFocusSet(ids) {
    this.focusSet = ids && ids.length ? new Set(ids) : null;
    this.refreshHighlight();
  }

  refreshHighlight() {
    const map = this.map;
    if (!map) return;
    // light the path from the hovered/selected node back to the root
    const lit = new Set();
    const anchor = this.hoverId || this.selectedId;
    if (anchor && map.nodes[anchor]) pathToRoot(map, anchor).forEach((id) => lit.add(id));
    for (const [id, v] of this.nodes) {
      v.selected = id === this.selectedId;
      v.hover = id === this.hoverId;
      v.dim = this.focusSet ? !this.focusSet.has(id) : false;
    }
    for (const e of this.edges.values()) {
      const onPath = lit.has(e.parentId) && lit.has(e.childId);
      const dimmed = this.focusSet && !(this.focusSet.has(e.parentId) && this.focusSet.has(e.childId));
      e.targetGlow = dimmed ? 0.25 : onPath ? 2.1 : 1;
    }
  }

  pick(ndc, exclude = null) {
    this.raycaster.setFromCamera(ndc, this.world.camera);
    let best = null;
    // spheres: use analytic ray test with a slightly generous radius
    for (const [id, v] of this.nodes) {
      if (exclude?.has(id)) continue;
      const r = v.radius * Math.max(v.scale, 0.5) * 1.05;
      const hit = this.raycaster.ray.intersectSphere(new THREE.Sphere(v.current, r), new THREE.Vector3());
      if (!hit) continue;
      const d = hit.distanceTo(this.raycaster.ray.origin);
      if (!best || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  }

  /** Smoothly move the camera to look at a node (or the whole map). */
  flyTo(id, { distance } = {}) {
    const cam = this.world.camera;
    const controls = this.world.controls;
    let target;
    let dist;
    if (id && this.nodes.get(id)) {
      const v = this.nodes.get(id);
      target = v.target.clone();
      const kids = this.map.nodes[id].children.map((c) => this.nodes.get(c)).filter(Boolean);
      const spread = kids.reduce((m, k) => Math.max(m, k.target.distanceTo(target)), 0);
      dist = distance ?? Math.max(14, v.radius * 7, spread * 2.4 + 6);
    } else {
      const box = new THREE.Box3();
      for (const v of this.nodes.values()) box.expandByPoint(v.target);
      target = box.getCenter(new THREE.Vector3());
      let radius = 0;
      for (const v of this.nodes.values()) radius = Math.max(radius, v.target.distanceTo(target) + v.radius);
      const fov = (cam.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(fov / 2) * cam.aspect);
      dist = distance ?? Math.max(20, (radius * 1.1) / Math.tan(Math.min(fov, hfov) / 2));
    }
    const dir = new THREE.Vector3().subVectors(cam.position, controls.target).normalize();
    this.fly = {
      t: 0,
      fromPos: cam.position.clone(),
      fromTarget: controls.target.clone(),
      toTarget: target,
      toPos: target.clone().addScaledVector(dir, dist),
    };
  }

  /** Move a node and its (visible) subtree by `delta`, keeping the model in sync. */
  translateSubtree(id, delta) {
    const ids = [id, ...descendants(this.map, id)];
    for (const nid of ids) {
      const n = this.map.nodes[nid];
      n.pos = [n.pos[0] + delta.x, n.pos[1] + delta.y, n.pos[2] + delta.z];
      const v = this.nodes.get(nid);
      if (v) {
        v.target.fromArray(n.pos);
        v.current.add(delta);
      }
    }
  }

  /** Screen position (CSS px) of a node's centre plus its on-screen radius. */
  screenPosition(id) {
    const v = this.nodes.get(id);
    if (!v) return null;
    const cam = this.world.camera;
    const p = v.current.clone().project(cam);
    const el = this.world.renderer.domElement;
    const dist = v.current.distanceTo(cam.position);
    const r = ((v.radius * v.scale) / (dist * Math.tan((cam.fov * Math.PI) / 360))) * (el.clientHeight / 2);
    return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight, r, behind: p.z > 1 };
  }

  /** Force labels to redraw (e.g. once web fonts have loaded). */
  redrawLabels() {
    for (const v of this.nodes.values()) v.labelKey = '';
    if (this.map) this.sync(this.map);
  }

  update() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    const cam = this.world.camera;
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / 1.1);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.world.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      cam.position.lerpVectors(f.fromPos, f.toPos, e);
      if (f.t >= 1) this.fly = null;
    }
    for (const v of this.nodes.values()) v.update(t, dt, cam);
    const out = new THREE.Vector3();
    for (const e of this.edges.values()) {
      const a = this.nodes.get(e.parentId);
      const b = this.nodes.get(e.childId);
      if (!a || !b) continue;
      const pn = this.map.nodes[e.parentId];
      const gp = pn.parent && this.nodes.get(pn.parent);
      const bend = gp ? out.subVectors(a.current, gp.current).normalize().clone() : null;
      e.setEnds(a.current, b.current, a.radius * a.scale, b.radius * b.scale, bend, b.depth - 1);
      e.update(t, dt);
    }
    this.world.backdrop.update(t);
    this.world.controls.update();
    return { t, dt };
  }
}
