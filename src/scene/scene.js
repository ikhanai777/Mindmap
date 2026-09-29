// The 3D constellation: nodes (instanced glass orbs), filament links, labels,
// nebula clusters, starfield, fog, bloom and adaptive quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Text } from 'troika-three-text';
import fontUrl from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import { store, reduceMotion } from '../store.js';
import { getIndex, subtree, isHiddenByCollapse, SHAPES } from '../model.js';
import { themeOf, resolveColors } from '../themes.js';
import { computeLayout } from '../layout/index.js';
import { createNodeMaterial, radialTexture, emojiTexture } from './nodeMaterial.js';
import { FatLines } from './fatlines.js';

const LAYOUT_MS = 800;
const SPAWN_MS = 250;
const LOD_POINT_DIST = 60;
const LABEL_DIST = 45;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _ca = new THREE.Color();
const _cb = new THREE.Color();
const _e = new THREE.Euler();

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const spring = (t) => (t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(9 * t)); // 250 ms pop with slight overshoot

const GEOMETRIES = {
  sphere: () => new THREE.IcosahedronGeometry(0.5, 4),
  cube: () => new THREE.BoxGeometry(0.72, 0.72, 0.72),
  octahedron: () => new THREE.OctahedronGeometry(0.62, 0),
  ring: () => new THREE.TorusGeometry(0.4, 0.11, 14, 40),
};

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR at 2
    this.renderer.setPixelRatio(this.dpr);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    this.camera.position.set(0, 4, 22);
    this.states = new Map(); // id -> per-node render state
    this.targets = new Map();
    this.layoutJob = 0;
    this.drag = null; // {id, pos: Vector3}
    this.dropTarget = null;
    this.floorY = -1.6;
    this.time = 0;
    this.lastRev = -1;
    this.lastStructRev = -1;
    this.linksDirty = true;
    this.labelTick = 0;
    this.quality = 0; // 0 full, 1 no bloom, 2 no particles, 3 fewer labels
    this.fps = { frames: 0, t0: performance.now(), low: 0, high: 0, value: 60 };
    this.lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    if (this.lowEnd) this.quality = 1;

    this.#buildWorld();
    this.#buildPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- setup ----------
  #buildWorld() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x07080d, 0.011);

    // nodes: one InstancedMesh per shape
    this.nodeMaterial = createNodeMaterial();
    this.pools = {};
    for (const shape of SHAPES) this.pools[shape] = this.#makePool(shape, 64);

    // far LOD points
    this.pointTex = radialTexture(64, 0, 0.6);
    this.far = this.#makePoints(256, { size: 7, map: this.pointTex, sizeAttenuation: false });
    scene.add(this.far.points);

    // links
    this.treeLines = [new FatLines({ width: 3.2 }), new FatLines({ width: 2.2 }), new FatLines({ width: 1.4 })];
    this.crossLines = {
      solid: new FatLines({ width: 1.6 }),
      dashed: new FatLines({ width: 1.6, dashed: true }),
      flow: new FatLines({ width: 1.8, dashed: true, dashSize: 0.22, gapSize: 0.3 }),
    };
    for (const l of [...this.treeLines, ...Object.values(this.crossLines)]) scene.add(l.object);
    this.particles = this.#makePoints(128, { size: 0.22, map: this.pointTex, sizeAttenuation: true, blending: THREE.AdditiveBlending });
    scene.add(this.particles.points);
    this.linkLabels = new Map();

    // selection halos, drop target ring
    this.haloGeo = new THREE.RingGeometry(0.62, 0.7, 64);
    this.halos = [];
    this.dropRing = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.8, 64), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, depthWrite: false, fog: false }));
    this.dropRing.visible = false;
    this.dropRing.renderOrder = 5;
    scene.add(this.dropRing);

    // labels & icons
    this.labels = new Map();
    this.icons = new Map();
    this.notes = new Map();
    this.labelSet = new Set();
    this.labelScene = new THREE.Scene(); // drawn after post-processing: crisp, never bloomed

    // nebulae
    this.nebulaTex = radialTexture(256, 0, 1.6);
    this.nebulae = new Map();

    // starfield with parallax
    const starCount = 1600;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 280 + Math.random() * 220;
      const s = Math.sqrt(1 - u * u);
      sp.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xcfe8ff, transparent: true, opacity: 0.8, fog: false, depthWrite: false, map: this.pointTex }));
    this.stars.renderOrder = -1;
    scene.add(this.stars);

    // walk-mode floor grid
    this.grid = new THREE.GridHelper(400, 200, 0x2a3140, 0x2a3140);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.grid.material.depthWrite = false;
    this.grid.visible = false;
    scene.add(this.grid);
  }

  #makePool(shape, capacity) {
    const geo = GEOMETRIES[shape]();
    const mesh = new THREE.InstancedMesh(geo, this.nodeMaterial, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const state = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    state.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', state);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    return { mesh, capacity, state, geo };
  }

  #growPool(shape, need) {
    const old = this.pools[shape];
    if (need <= old.capacity) return old;
    let cap = old.capacity;
    while (cap < need) cap *= 2;
    this.scene.remove(old.mesh);
    old.mesh.dispose();
    old.geo.dispose();
    this.pools[shape] = this.#makePool(shape, cap);
    return this.pools[shape];
  }

  #makePoints(capacity, { size, map, sizeAttenuation, blending = THREE.NormalBlending }) {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('color', col);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({ size, map, sizeAttenuation, vertexColors: true, transparent: true, depthWrite: false, blending });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 3;
    return { points, capacity, pos, col };
  }

  #ensurePoints(p, n) {
    if (n <= p.capacity) return p;
    let cap = p.capacity;
    while (cap < n) cap *= 2;
    const geo = p.points.geometry;
    p.pos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    p.col = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', p.pos);
    geo.setAttribute('color', p.col);
    p.capacity = cap;
    return p;
  }

  #buildPost() {
    // multisampled target: without it the post-processing path loses antialiasing and looks soft
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.2, 0.82); // only the brightest cores glow
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const l of [...this.treeLines, ...Object.values(this.crossLines)]) l.setResolution(w, h, this.dpr);
  }

  // ---------- theme ----------
  applyTheme() {
    const t = themeOf(store.getState().doc);
    if (this.themeRef === t) return;
    this.themeRef = t;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, t.bg[0]);
    grd.addColorStop(1, t.bg[1]);
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background?.dispose?.();
    this.scene.background = tex;
    this.scene.fog.color.set(t.fog);
    this.scene.fog.density = t.fogDensity;
    this.stars.visible = t.stars > 0;
    this.stars.material.opacity = t.stars;
    this.grid.material.color.set(t.grid);
    this.nodeMaterial.uniforms.uFlat.value = t.flat;
    this.bgColor = new THREE.Color(t.fog);
    const blend = t.flat >= 1 ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.particles.points.material.blending = blend;
    this.far.points.material.blending = t.flat >= 1 ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const neb of this.nebulae.values()) neb.material.blending = blend;
    for (const lbl of this.labels.values()) this.#styleLabel(lbl);
    for (const txt of this.notes.values()) this.#styleLabel(txt, true);
    for (const txt of this.linkLabels.values()) this.#styleLabel(txt, true);
    this.linksDirty = true;
    this.colorsDirty = true;
  }

  // ---------- document sync ----------
  /** Called whenever the store changes. Cheap diff of node set, colors, emphasis. */
  sync() {
    const s = store.getState();
    const doc = s.doc;
    if (!doc) return;
    this.applyTheme();
    const docChanged = s.rev !== this.lastRev;
    if (docChanged || this.colorsDirty) {
      this.lastRev = s.rev;
      this.colorsDirty = false;
      this.#syncNodes(doc);
    }
    if (s.structRev !== this.lastStructRev) {
      this.lastStructRev = s.structRev;
      this.relayout();
    }
    this.#computeEmphasis();
    this.grid.visible = s.mode === 'walk';
  }

  #syncNodes(doc) {
    const idx = getIndex(doc);
    const theme = this.themeRef;
    const colors = resolveColors(doc, idx, theme);
    const now = performance.now();
    const wall = Date.now();
    const seen = new Set();
    for (const id of idx.order) {
      const n = doc.nodes[id];
      seen.add(id);
      let st = this.states.get(id);
      if (!st) {
        // spawn from parent (or pinned spot) and pop in
        const parent = n.parentId && this.states.get(n.parentId);
        const start = n.pos ? new THREE.Vector3(...n.pos) : parent ? parent.cur.clone() : new THREE.Vector3();
        st = {
          id,
          cur: start.clone(),
          from: start.clone(),
          to: start.clone(),
          t0: -1e9,
          spawnT: this.initialized ? now : now + (idx.depth.get(id) || 0) * 70,
          opacity: 1,
          targetOpacity: 1,
          color: new THREE.Color(),
          phase: Math.random() * Math.PI * 2,
        };
        this.states.set(id, st);
      }
      st.node = n;
      st.color.set(colors.get(id) || theme.accent);
      st.depth = idx.depth.get(id) || 0;
      st.desc = idx.descCount.get(id) || 0;
      st.hidden = isHiddenByCollapse(doc, id);
      const ageDays = (wall - (n.updatedAt || n.createdAt || wall)) / 86400000;
      st.brightness = 0.35 + 0.65 * Math.exp(-Math.max(0, ageDays) / 4); // edited today = brightest
      st.scale = (n.size || 1) * (1 + 0.13 * Math.log2(1 + st.desc));
      st.radius = 0.5 * st.scale;
      st.hiddenKids = n.collapsed ? st.desc : 0;
    }
    for (const id of [...this.states.keys()]) {
      if (!seen.has(id)) {
        this.states.delete(id);
        this.#dropLabel(id);
      }
    }
    this.initialized = true;
    this.labelsDirty = true;
    this.linksDirty = true;
    this.#syncLinks(doc);
    this.#syncNebulae(doc);
  }

  #syncLinks(doc) {
    this.linkList = Object.values(doc.links).filter((l) => this.states.has(l.from) && this.states.has(l.to));
    const keep = new Set();
    for (const l of this.linkList) {
      if (!l.label) continue;
      keep.add(l.id);
      let t = this.linkLabels.get(l.id);
      if (!t) {
        t = new Text();
        t.font = fontUrl;
        t.anchorX = 'center';
        t.anchorY = 'middle';
        t.renderOrder = 9;
        t.material = this.#labelMaterial();
        this.#styleLabel(t, true);
        this.labelScene.add(t);
        this.linkLabels.set(l.id, t);
      }
      if (t.text !== l.label) { t.text = l.label; t.sync(); }
    }
    for (const [id, t] of this.linkLabels) {
      if (!keep.has(id)) { this.labelScene.remove(t); t.dispose(); this.linkLabels.delete(id); }
    }
  }

  #syncNebulae(doc) {
    const keep = new Set();
    const t = this.themeRef;
    for (const c of Object.values(doc.clusters)) {
      keep.add(c.id);
      let neb = this.nebulae.get(c.id);
      if (!neb) {
        neb = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nebulaTex, transparent: true, depthWrite: false, blending: t.flat >= 1 ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false }));
        neb.renderOrder = 0;
        this.scene.add(neb);
        this.nebulae.set(c.id, neb);
      }
      neb.userData.cluster = c;
      neb.material.color.set(c.color);
    }
    for (const [id, neb] of this.nebulae) {
      if (!keep.has(id)) { this.scene.remove(neb); neb.material.dispose(); this.nebulae.delete(id); }
    }
  }

  #computeEmphasis() {
    const s = store.getState();
    const doc = s.doc;
    const key = [s.rev, s.selection.join(','), s.focusId, s.highlight ? s.highlight.size + ':' + [...s.highlight].slice(0, 50).join(',') : '', s.multi, s.linkFrom].join('|');
    if (key === this.emphasisKey) return;
    this.emphasisKey = key;
    const focusSet = s.focusId && doc.nodes[s.focusId] ? new Set(subtree(doc, s.focusId)) : null;
    let lit = null;
    if (s.selection.length && !s.multi) {
      lit = new Set(s.selection);
      const idx = getIndex(doc);
      for (const id of s.selection) {
        const n = doc.nodes[id];
        if (!n) continue;
        if (n.parentId) lit.add(n.parentId);
        for (const k of idx.kids(id)) lit.add(k);
      }
      for (const l of Object.values(doc.links)) {
        if (lit.has(l.from) && s.selection.includes(l.from)) lit.add(l.to);
        if (lit.has(l.to) && s.selection.includes(l.to)) lit.add(l.from);
      }
    }
    this.litSet = lit;
    for (const [id, st] of this.states) {
      let t = 1;
      if (st.hidden) t = 0;
      else if (focusSet && !focusSet.has(id)) t = 0;
      else if (s.highlight) t = s.highlight.has(id) ? 1 : 0.14;
      else if (lit) t = lit.has(id) ? 1 : 0.25;
      st.targetOpacity = t;
    }
    this.focusSet = focusSet;
    this.labelsDirty = true;
    this.linksDirty = true;
  }

  // ---------- layout ----------
  async relayout() {
    const doc = store.getState().doc;
    if (!doc) return;
    const job = ++this.layoutJob;
    const seed = new Map();
    for (const [id, st] of this.states) seed.set(id, [st.cur.x, st.cur.y, st.cur.z]);
    let positions;
    try {
      positions = await computeLayout(doc, seed);
    } catch (err) {
      console.error('layout failed', err);
      return;
    }
    if (job !== this.layoutJob || doc !== store.getState().doc) return;
    const now = performance.now();
    const first = !this.hasLayout;
    for (const [id, st] of this.states) {
      let p = positions.get(id);
      if (!p) {
        // hidden by collapse: gather into nearest visible ancestor
        let a = st.node.parentId;
        while (a && !positions.has(a)) a = doc.nodes[a]?.parentId;
        p = a ? positions.get(a) : [0, 0, 0];
      }
      st.from.copy(st.cur);
      st.to.set(p[0], p[1], p[2]);
      if (first) { st.cur.copy(st.to); st.from.copy(st.to); st.t0 = -1e9; }
      else st.t0 = now;
    }
    this.hasLayout = true;
    this.linksDirty = true;
    this.#updateFloor();
    this.onLayout?.(first);
  }

  #updateFloor() {
    // walk floor sits below the middle of the map so nodes float at varied heights like lanterns
    let sum = 0, n = 0, minY = Infinity;
    for (const st of this.states.values()) {
      if (st.hidden) continue;
      sum += st.to.y; n++; minY = Math.min(minY, st.to.y);
    }
    const mid = n ? sum / n : 0;
    this.floorY = Math.min(mid - 1.6, (Number.isFinite(minY) ? minY : 0) + 0.8);
    this.grid.position.y = this.floorY;
  }

  // ---------- queries ----------
  getPos(id) {
    const st = this.states.get(id);
    return st ? (this.drag?.id === id ? this.drag.pos : st.cur) : null;
  }

  getTarget(id) {
    return this.states.get(id)?.to || null;
  }

  radius(id) {
    return this.states.get(id)?.radius || 0.5;
  }

  isVisible(id) {
    const st = this.states.get(id);
    return !!st && st.targetOpacity > 0.05;
  }

  /** Bounding sphere of visible nodes (targets). */
  bounds(ids = null) {
    const box = new THREE.Box3();
    let any = false;
    for (const [id, st] of this.states) {
      if (ids ? !ids.has(id) : st.targetOpacity < 0.05) continue;
      box.expandByPoint(st.to);
      any = true;
    }
    if (!any) return { center: new THREE.Vector3(), radius: 6 };
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { center: sphere.center, radius: Math.max(4, sphere.radius) };
  }

  /** Screen-space picking; hit areas expand to ≥ 44 px when nodes are small. */
  pick(x, y, { exclude = null } = {}) {
    const cam = this.camera;
    const w = this.width, h = this.height;
    const focal = h / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    let best = null, bestScore = Infinity;
    cam.updateMatrixWorld();
    for (const [id, st] of this.states) {
      if (st.opacity < 0.1 || st.targetOpacity < 0.1 || (exclude && exclude.has(id))) continue;
      const p = this.getPos(id);
      _v.copy(p).applyMatrix4(cam.matrixWorldInverse);
      const depth = -_v.z;
      if (depth < cam.near) continue;
      _v.copy(p).project(cam);
      const sx = (_v.x + 1) / 2 * w, sy = (1 - _v.y) / 2 * h;
      const screenR = st.radius * focal / depth;
      const hitR = Math.max(screenR, 22);
      const d = Math.hypot(sx - x, sy - y);
      if (d > hitR) continue;
      // exact hits win; among them the nearest to the camera
      const score = (d <= screenR ? 0 : 1e6) + depth * 10 + d;
      if (score < bestScore) { bestScore = score; best = id; }
    }
    return best;
  }

  toScreen(p) {
    _v.copy(p).project(this.camera);
    return { x: (_v.x + 1) / 2 * this.width, y: (1 - _v.y) / 2 * this.height, behind: _v.z > 1 };
  }

  /** Ray through a screen point hitting the plane through `point` facing the camera. */
  screenToPlane(x, y, point) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.camera);
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /** World point at a given distance along the ray through a screen point. */
  screenToWorld(x, y, dist) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.camera);
    return ray.ray.at(dist, new THREE.Vector3());
  }

  positionsSnapshot() {
    const out = {};
    for (const [id, st] of this.states) if (!st.hidden) out[id] = [+st.to.x.toFixed(3), +st.to.y.toFixed(3), +st.to.z.toFixed(3)];
    return out;
  }

  colorOf(id) {
    return this.states.get(id)?.color;
  }

  // ---------- labels ----------
  #labelMaterial() {
    // no fog (it washed labels out) and no depth test so orbs never cover text
    return new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  }

  #styleLabel(t, small = false) {
    const theme = this.themeRef || themeOf(null);
    const hc = theme === themeOf({ theme: 'contrast' });
    t.color = theme.text;
    t.outlineColor = theme.textOutline;
    t.outlineWidth = hc ? '18%' : '14%';
    t.outlineBlur = '4%';
    t.outlineOpacity = 1;
    t.sdfGlyphSize = 128;
    if (!small) t.fontWeight = 'normal';
  }

  #labelFor(id) {
    let t = this.labels.get(id);
    if (!t) {
      t = new Text();
      t.font = fontUrl;
      t.anchorX = 'center';
      t.anchorY = 'bottom';
      t.textAlign = 'center';
      t.maxWidth = 6;
      t.renderOrder = 10;
      t.material = this.#labelMaterial();
      t.visible = false;
      this.#styleLabel(t);
      this.labelScene.add(t);
      this.labels.set(id, t);
    }
    return t;
  }

  #dropLabel(id) {
    for (const map of [this.labels, this.notes]) {
      const t = map.get(id);
      if (t) { this.labelScene.remove(t); t.dispose(); map.delete(id); }
    }
    const icon = this.icons.get(id);
    if (icon) { this.scene.remove(icon); icon.material.dispose(); this.icons.delete(id); }
  }

  #labelText(st) {
    const n = st.node;
    const doc = store.getState().doc;
    let text = n.title || (n.id === doc.rootId ? 'Tap to name your idea' : 'Untitled');
    if (st.hiddenKids) text += `  +${st.hiddenKids}`;
    return text;
  }

  #selectLabels() {
    const s = store.getState();
    const cam = this.camera.position;
    const walk = s.mode === 'walk';
    const budget = this.quality >= 3 ? 40 : this.lowEnd ? 80 : 140;
    const must = new Set([...s.selection, s.focusId, s.linkFrom].filter(Boolean));
    if (this.litSet) for (const id of this.litSet) must.add(id);
    const cands = [];
    for (const [id, st] of this.states) {
      if (st.targetOpacity < 0.1) continue;
      const d = st.cur.distanceTo(cam);
      const limit = walk && st.depth >= 2 ? 5 : LABEL_DIST;
      if (d > limit && !must.has(id)) continue;
      if (s.highlight && !s.highlight.has(id) && !must.has(id)) continue;
      cands.push([id, must.has(id) ? -1 : d + Math.min(st.depth, 4) * 8]); // branches outrank leaves
    }
    cands.sort((a, b) => a[1] - b[1]);
    this.labelSet = new Set(cands.slice(0, budget).map((c) => c[0]));
  }

  #updateLabels() {
    const s = store.getState();
    const cam = this.camera;
    const camUp = _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const scale = s.settings.labelScale * (this.themeRef?.flat > 0.5 && this.themeRef?.name === 'High Contrast' ? 1.2 : 1);
    const walk = s.mode === 'walk';
    const focal = this.height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const placed = []; // screen rects of labels already shown (priority order)
    for (const [id, t] of this.labels) if (!this.labelSet.has(id)) t.visible = false;
    for (const [id, t] of this.notes) if (!this.labelSet.has(id) || !walk) t.visible = false;
    for (const id of this.labelSet) {
      const st = this.states.get(id);
      if (!st) continue;
      const t = this.#labelFor(id);
      const text = this.#labelText(st);
      const fs = 0.34 * scale * Math.pow(st.scale, 0.3);
      if (t.text !== text || t.fontSize !== fs) {
        t.text = text;
        t.fontSize = fs;
        t.fontStyle = st.node.title ? 'normal' : 'italic';
        t.sync();
      }
      const p = this.getPos(id);
      const d = p.distanceTo(cam.position);
      // keep text a readable size on screen as it recedes (up to 1.8x)
      t.scale.setScalar(Math.min(1.8, Math.max(1, d / 16)));
      const limit = walk && st.depth >= 2 ? 5 : LABEL_DIST;
      const fade = d < limit * 0.75 ? 1 : Math.max(0, 1 - (d - limit * 0.75) / (limit * 0.25));
      const must = s.selection.includes(id) || (this.litSet && this.litSet.has(id));
      const op = (must ? 1 : fade) * Math.min(1, st.opacity * 1.2);
      t.visible = op > 0.02;
      t.fillOpacity = op;
      t.outlineOpacity = op;
      t.position.copy(p).addScaledVector(camUp, st.radius * (st.node.shape === 'ring' ? 1.1 : 1) + 0.12 * t.scale.x);
      t.quaternion.copy(cam.quaternion);

      // declutter: skip a label whose box would overlap one already shown
      if (t.visible) {
        _v.copy(t.position).applyMatrix4(cam.matrixWorldInverse);
        const depth = -_v.z;
        if (depth > cam.near) {
          const ppu = focal / depth;
          const bounds = t.textRenderInfo?.blockBounds;
          const w = (bounds ? bounds[2] - bounds[0] : text.length * fs * 0.55) * t.scale.x * ppu;
          const hgt = (bounds ? bounds[3] - bounds[1] : fs * 1.2) * t.scale.x * ppu;
          const sp = this.toScreen(t.position);
          const r = { x0: sp.x - w / 2 - 4, x1: sp.x + w / 2 + 4, y0: sp.y - hgt - 2, y1: sp.y + 2 };
          const hit = placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
          if (hit && !s.selection.includes(id)) t.visible = false;
          else placed.push(r);
        }
      }

      // proximity note reveal while walking
      if (walk && st.node.note && d < 5) {
        let nt = this.notes.get(id);
        if (!nt) {
          nt = new Text();
          nt.font = fontUrl;
          nt.anchorX = 'center';
          nt.anchorY = 'top';
          nt.maxWidth = 3.2;
          nt.renderOrder = 10;
          nt.material = this.#labelMaterial();
          this.#styleLabel(nt, true);
          this.labelScene.add(nt);
          this.notes.set(id, nt);
        }
        const snippet = st.node.note.replace(/[#*_>`]|\[[ xX]\]/g, '').trim().slice(0, 160);
        if (nt.text !== snippet) { nt.text = snippet; nt.fontSize = 0.13 * scale; nt.sync(); }
        const nop = Math.max(0, Math.min(1, (5 - d) / 1.5)) * st.opacity;
        nt.visible = nop > 0.02;
        nt.fillOpacity = nop * 0.9;
        nt.outlineOpacity = nop * 0.7;
        nt.position.copy(p).addScaledVector(camUp, -(st.radius + 0.12));
        nt.quaternion.copy(cam.quaternion);
      } else if (this.notes.has(id)) this.notes.get(id).visible = false;
    }

    // emoji icons inside orbs
    const toCam = _v;
    for (const [id, st] of this.states) {
      const icon = st.node.icon;
      let spr = this.icons.get(id);
      const show = icon && st.opacity > 0.05 && st.cur.distanceTo(cam.position) < 40;
      if (!show) { if (spr) spr.visible = false; continue; }
      if (!spr || spr.userData.icon !== icon) {
        if (spr) { this.scene.remove(spr); spr.material.dispose(); }
        spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(icon), transparent: true, depthWrite: false, depthTest: true }));
        spr.userData.icon = icon;
        spr.renderOrder = 4;
        this.scene.add(spr);
        this.icons.set(id, spr);
      }
      const p = this.getPos(id);
      toCam.copy(cam.position).sub(p).normalize();
      spr.position.copy(p).addScaledVector(toCam, st.radius * 0.55);
      const sc = st.radius * 1.15 * (st.spawnScale ?? 1);
      spr.scale.set(sc, sc, 1);
      spr.material.opacity = st.opacity;
      spr.visible = true;
    }
  }

  // ---------- links ----------
  #bezier(a, b, rootPos, flat, out, segs) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    let c1x, c1y, c1z, c2x, c2y, c2z;
    if (flat) {
      // classic horizontal S-curve
      c1x = a.x + dx * 0.5; c1y = a.y; c1z = a.z;
      c2x = b.x - dx * 0.5; c2y = b.y; c2z = b.z;
    } else {
      // gentle bow away from the root
      let mx = (a.x + b.x) / 2 - rootPos.x, my = (a.y + b.y) / 2 - rootPos.y, mz = (a.z + b.z) / 2 - rootPos.z;
      const ml = Math.hypot(mx, my, mz);
      const bow = ml > 0.01 ? (len * 0.16) / ml : 0;
      mx *= bow; my *= bow; mz *= bow;
      c1x = a.x + dx / 3 + mx; c1y = a.y + dy / 3 + my; c1z = a.z + dz / 3 + mz;
      c2x = a.x + dx * 2 / 3 + mx; c2y = a.y + dy * 2 / 3 + my; c2z = a.z + dz * 2 / 3 + mz;
    }
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, u = 1 - t;
      const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      out[i * 3] = w0 * a.x + w1 * c1x + w2 * c2x + w3 * b.x;
      out[i * 3 + 1] = w0 * a.y + w1 * c1y + w2 * c2y + w3 * b.y;
      out[i * 3 + 2] = w0 * a.z + w1 * c1z + w2 * c2z + w3 * b.z;
    }
    return out;
  }

  #fade(color, alpha, out) {
    // lines are opaque-ish; fade by blending toward the background
    return out.copy(this.bgColor).lerp(color, alpha);
  }

  #updateLinks() {
    const s = store.getState();
    const doc = s.doc;
    const theme = this.themeRef;
    const flat = doc.layoutMode === 'flat-2d';
    const rootPos = this.getPos(doc.rootId) || new THREE.Vector3();
    const camPos = this.camera.position;
    const pts = this.curveBuf || (this.curveBuf = new Float32Array(17 * 3));
    for (const l of this.treeLines) l.begin();
    for (const [id, st] of this.states) {
      const pid = st.node.parentId;
      if (!pid) continue;
      const ps = this.states.get(pid);
      if (!ps) continue;
      const alpha = Math.min(st.opacity, ps.opacity);
      if (alpha < 0.02) continue;
      const a = this.getPos(pid), b = this.getPos(id);
      const far = Math.min(a.distanceTo(camPos), b.distanceTo(camPos));
      const segs = far > LOD_POINT_DIST ? 2 : far > 30 ? 6 : 16;
      this.#bezier(a, b, rootPos, flat, pts, segs);
      const bucket = this.treeLines[Math.min(2, st.depth - 1)] || this.treeLines[2];
      const taper = [1, 0.85, 0.7, 0.58][Math.min(3, st.depth - 1)] ?? 0.55;
      const la = alpha * theme.linkAlpha * taper;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const ca = this.#fade(_c.copy(ps.color).lerp(st.color, t0), la, _ca);
        const cb = this.#fade(_c.copy(ps.color).lerp(st.color, t1), la, _cb);
        bucket.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5], ca, cb);
      }
    }
    for (const l of this.treeLines) l.end();

    for (const l of Object.values(this.crossLines)) l.begin();
    const lit = this.litSet;
    for (const link of this.linkList || []) {
      const A = this.states.get(link.from), B = this.states.get(link.to);
      if (!A || !B) continue;
      const alpha = Math.min(A.opacity, B.opacity);
      if (alpha < 0.02) continue;
      const a = this.getPos(link.from), b = this.getPos(link.to);
      this.#bezier(a, b, rootPos, false, pts, 16);
      const bucket = this.crossLines[link.style] || this.crossLines.dashed;
      const boost = lit && (lit.has(link.from) && lit.has(link.to)) ? 1 : 0.8;
      for (let i = 0; i < 16; i++) {
        const t0 = i / 16, t1 = (i + 1) / 16;
        const ca = this.#fade(_c.copy(A.color).lerp(B.color, t0), alpha * boost, _ca);
        const cb = this.#fade(_c.copy(A.color).lerp(B.color, t1), alpha * boost, _cb);
        bucket.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5], ca, cb);
      }
      const label = this.linkLabels.get(link.id);
      if (label) {
        label.position.set(pts[8 * 3], pts[8 * 3 + 1] + 0.15, pts[8 * 3 + 2]);
        const near = label.position.distanceTo(camPos) < 20 || (lit && (lit.has(link.from) || lit.has(link.to)));
        label.visible = !!near && alpha > 0.2;
        label.fontSize = 0.2 * s.settings.labelScale;
        label.fillOpacity = alpha;
      }
    }
    for (const l of Object.values(this.crossLines)) l.end();
  }

  #updateParticles(now) {
    const s = store.getState();
    const on = this.quality < 2 && !reduceMotion();
    if (!on || !this.linkList?.length) { this.particles.points.geometry.setDrawRange(0, 0); return; }
    const doc = s.doc;
    const rootPos = this.getPos(doc.rootId) || new THREE.Vector3();
    const directed = this.linkList.filter((l) => l.directed !== false);
    const per = 3;
    this.#ensurePoints(this.particles, directed.length * per);
    const pts = this.particleBuf || (this.particleBuf = new Float32Array(17 * 3));
    let n = 0;
    for (const link of directed) {
      const A = this.states.get(link.from), B = this.states.get(link.to);
      const alpha = Math.min(A.opacity, B.opacity);
      if (alpha < 0.2) continue;
      this.#bezier(this.getPos(link.from), this.getPos(link.to), rootPos, false, pts, 16);
      const speed = link.style === 'flow' ? 0.5 : 0.28;
      for (let k = 0; k < per; k++) {
        const t = ((now / 1000) * speed + k / per) % 1;
        const f = t * 16, i = Math.floor(f), r = f - i;
        const j = Math.min(15, i);
        this.particles.pos.setXYZ(n,
          pts[j * 3] + (pts[j * 3 + 3] - pts[j * 3]) * r,
          pts[j * 3 + 1] + (pts[j * 3 + 4] - pts[j * 3 + 1]) * r,
          pts[j * 3 + 2] + (pts[j * 3 + 5] - pts[j * 3 + 2]) * r);
        _c.copy(A.color).lerp(B.color, t).multiplyScalar(alpha);
        this.particles.col.setXYZ(n, _c.r, _c.g, _c.b);
        n++;
      }
    }
    this.particles.pos.needsUpdate = true;
    this.particles.col.needsUpdate = true;
    this.particles.points.geometry.setDrawRange(0, n);
  }

  // ---------- per-frame ----------
  update(now, dt) {
    const s = store.getState();
    if (!s.doc) return;
    this.time = now;
    const rm = reduceMotion();
    const cam = this.camera;
    const camPos = cam.position;
    let moving = false;
    let fading = false;

    const counts = {};
    for (const shape of SHAPES) counts[shape] = 0;
    let farCount = 0;
    const need = {};
    for (const shape of SHAPES) need[shape] = 0;
    for (const st of this.states.values()) need[st.node.shape] = (need[st.node.shape] || 0) + 1;
    for (const shape of SHAPES) this.#growPool(shape, need[shape] || 0);
    this.#ensurePoints(this.far, this.states.size);

    const k = Math.min(1, dt * 9);
    for (const [id, st] of this.states) {
      // position animation (800 ms layout ease)
      const e = (now - st.t0) / LAYOUT_MS;
      if (e < 1) {
        st.cur.lerpVectors(st.from, st.to, easeInOut(Math.max(0, e)));
        moving = true;
      } else if (!st.cur.equals(st.to)) {
        st.cur.copy(st.to);
        moving = true;
      }
      // opacity
      if (Math.abs(st.opacity - st.targetOpacity) > 0.004) {
        st.opacity += (st.targetOpacity - st.opacity) * k;
        fading = true;
      } else st.opacity = st.targetOpacity;
      if (st.opacity < 0.01) continue;

      const p = this.getPos(id);
      const dist = p.distanceTo(camPos);
      const sp = (now - st.spawnT) / SPAWN_MS;
      st.spawnScale = sp < 0 ? 0 : spring(Math.min(1, sp / 1.6));
      if (sp < 1.6) moving = true;
      if (dist > LOD_POINT_DIST) {
        // LOD: far nodes render as points
        this.far.pos.setXYZ(farCount, p.x, p.y, p.z);
        _c.copy(st.color).multiplyScalar(st.opacity * (0.5 + 0.5 * st.brightness));
        this.far.col.setXYZ(farCount, _c.r, _c.g, _c.b);
        farCount++;
        continue;
      }
      let scale = st.scale * st.spawnScale;
      if (!rm) {
        scale *= 1 + 0.02 * Math.sin(now * 0.0012 + st.phase); // breathing drift ±2%
        if (id === s.doc.rootId) scale *= 1 + 0.035 * Math.sin(now * 0.0021); // slow root pulse
      }
      const shape = st.node.shape;
      if (shape === 'ring') _q.copy(cam.quaternion);
      else if (shape === 'sphere') _q.identity();
      else _q.setFromEuler(_e.set(0.35, rm ? st.phase : now * 0.0003 + st.phase, 0));
      _s.setScalar(Math.max(0.0001, scale));
      _m.compose(p, _q, _s);
      const pool = this.pools[shape];
      const i = counts[shape]++;
      pool.mesh.setMatrixAt(i, _m);
      pool.mesh.setColorAt(i, st.color);
      pool.state.setXY(i, st.brightness, st.opacity);
    }
    for (const shape of SHAPES) {
      const pool = this.pools[shape];
      pool.mesh.count = counts[shape];
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.mesh.instanceColor.needsUpdate = true;
      pool.state.needsUpdate = true;
    }
    this.far.pos.needsUpdate = true;
    this.far.col.needsUpdate = true;
    this.far.points.geometry.setDrawRange(0, farCount);

    if (moving || fading || this.linksDirty || this.drag || this.camMovedForLinks(camPos)) {
      this.#updateLinks();
      this.linksDirty = false;
    }
    this.#updateParticles(now);
    if (this.crossLines.flow.count && !rm) this.crossLines.flow.material.dashOffset = -now * 0.0012;

    // labels: reselect every few frames, reposition every frame
    if (this.labelsDirty || ++this.labelTick % 8 === 0 || moving) {
      this.#selectLabels();
      this.labelsDirty = false;
    }
    this.#updateLabels();
    this.#updateHalos(now, rm);
    this.#updateNebulae(now);

    // starfield parallax
    this.stars.position.copy(camPos).multiplyScalar(0.92);
    if (!rm) this.stars.rotation.y = now * 0.000004;
    this.moving = moving;
  }

  camMovedForLinks(camPos) {
    // link LOD depends on camera distance; refresh occasionally while the camera moves
    if (!this.lastLinkCam) this.lastLinkCam = camPos.clone();
    if (this.lastLinkCam.distanceToSquared(camPos) > 25) {
      this.lastLinkCam.copy(camPos);
      return true;
    }
    return false;
  }

  #updateHalos(now, rm) {
    const s = store.getState();
    const ids = [...s.selection];
    if (s.linkFrom && !ids.includes(s.linkFrom)) ids.push(s.linkFrom);
    while (this.halos.length < ids.length) {
      const m = new THREE.Mesh(this.haloGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.renderOrder = 6;
      this.scene.add(m);
      this.halos.push(m);
    }
    this.halos.forEach((h, i) => {
      const id = ids[i];
      const st = id && this.states.get(id);
      if (!st || st.opacity < 0.05) { h.visible = false; return; }
      h.visible = true;
      h.position.copy(this.getPos(id));
      h.quaternion.copy(this.camera.quaternion);
      const pulse = rm ? 1 : 1 + 0.05 * Math.sin(now * 0.004);
      h.scale.setScalar(st.scale * 1.25 * pulse);
      h.material.color.copy(id === s.linkFrom ? new THREE.Color(0xffd166) : st.color).lerp(new THREE.Color(1, 1, 1), 0.45);
      h.material.opacity = 0.95 * st.opacity;
    });
    const dt = this.dropTarget && this.states.get(this.dropTarget);
    this.dropRing.visible = !!dt;
    if (dt) {
      this.dropRing.position.copy(dt.cur);
      this.dropRing.quaternion.copy(this.camera.quaternion);
      this.dropRing.scale.setScalar(dt.scale * 1.35 * (rm ? 1 : 1 + 0.08 * Math.sin(now * 0.012)));
    }
  }

  #updateNebulae(now) {
    const strength = this.themeRef.nebula;
    for (const neb of this.nebulae.values()) {
      const c = neb.userData.cluster;
      const pts = c.nodeIds.map((id) => this.states.get(id)).filter((st) => st && st.opacity > 0.05);
      if (!pts.length) { neb.visible = false; continue; }
      const center = _v.set(0, 0, 0);
      let op = 0;
      for (const st of pts) { center.add(st.cur); op += st.opacity; }
      center.divideScalar(pts.length);
      let r = 0;
      for (const st of pts) r = Math.max(r, st.cur.distanceTo(center) + st.radius);
      neb.visible = true;
      neb.position.copy(center);
      const size = (r + 2.5) * 2.6 * (1 + 0.03 * Math.sin(now * 0.0008));
      neb.scale.set(size, size, 1);
      neb.material.opacity = strength * (op / pts.length);
    }
  }

  // ---------- render & quality ----------
  bloomEnabled() {
    const pref = store.getState().settings.bloom;
    if (pref === 'off' || !this.themeRef?.bloom) return false;
    if (pref === 'on') return true;
    return this.quality < 1;
  }

  render() {
    if (this.bloomEnabled()) {
      this.bloomPass.strength = this.themeRef.bloom;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
    // labels on top, after bloom, so text stays sharp
    const r = this.renderer;
    r.autoClear = false;
    r.render(this.labelScene, this.camera);
    r.autoClear = true;
    this.#trackFps();
  }

  #trackFps() {
    const f = this.fps;
    f.frames++;
    const now = performance.now();
    if (now - f.t0 < 1000) return;
    f.value = (f.frames * 1000) / (now - f.t0);
    f.frames = 0;
    f.t0 = now;
    if (document.hidden) return;
    // adaptive quality: drop bloom, then particles, then label count if fps < 40 for 2 s
    if (f.value < 40) { f.low++; f.high = 0; } else if (f.value > 57) { f.high++; f.low = 0; } else { f.low = 0; f.high = 0; }
    if (f.low >= 2 && this.quality < 3) { this.quality++; f.low = 0; }
    if (f.high >= 12 && this.quality > (this.lowEnd ? 1 : 0)) { this.quality--; f.high = 0; }
  }

  snapshotPNG() {
    this.render();
    return this.canvas.toDataURL('image/png');
  }
}
