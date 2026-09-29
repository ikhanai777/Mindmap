// Self-contained HTML viewer: the map + a small Three.js orbit / walkaround viewer.
// (three.js is loaded from a CDN; everything else — data, code, styles — is inline.)
import { serialize } from './model.js';
import { themeOf } from './themes.js';

const THREE_VERSION = '0.186.1';

export function buildViewerHTML(doc, positions, colors) {
  const theme = themeOf(doc);
  const data = serialize(doc);
  const payload = {
    title: doc.title,
    rootId: doc.rootId,
    theme: { bg: theme.bg, fog: theme.fog, text: theme.text, outline: theme.textOutline, flat: theme.flat },
    nodes: data.nodes
      .filter((n) => positions[n.id])
      .map((n) => ({ id: n.id, p: n.parentId, t: n.title, i: n.icon, note: n.note, s: n.size, shape: n.shape, pos: positions[n.id], c: colors[n.id] })),
    links: data.links.map((l) => ({ a: l.from, b: l.to, label: l.label })),
    waypoints: data.waypoints.map((w) => ({ name: w.name, position: w.position, target: w.target })),
  };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>${esc(doc.title)} — Constellate</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:${theme.bg[1]};color:${theme.text};font:15px/1.4 system-ui,sans-serif}
canvas{display:block;touch-action:none}
#bar{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:6px;background:rgba(20,24,34,.8);backdrop-filter:blur(12px);border-radius:999px;padding:6px}
#bar button{border:0;border-radius:999px;min-height:44px;padding:0 16px;background:transparent;color:#e8f6ff;font:inherit}
#bar button.on{background:#e8f6ff;color:#0a0c12}
#title{position:fixed;top:calc(12px + env(safe-area-inset-top));left:16px;font-weight:600;text-shadow:0 1px 6px #000a}
#note{position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));max-width:520px;margin:0 auto;background:rgba(14,17,25,.92);color:#e8f6ff;border-radius:16px;padding:12px 16px;white-space:pre-wrap;display:none}
#stick{position:fixed;left:20px;bottom:calc(90px + env(safe-area-inset-bottom));width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.08);display:none;touch-action:none}
#stick i{position:absolute;left:32px;top:32px;width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.7)}
</style></head><body>
<div id="title">${esc(doc.title)}</div>
<div id="note"></div><div id="stick"><i></i></div>
<div id="bar"><button id="orbit" class="on">Orbit</button><button id="walk">Walk</button>${payload.waypoints.length ? '<button id="tour">Tour ▶</button>' : ''}</div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@${THREE_VERSION}/build/three.module.js","three/addons/":"https://unpkg.com/three@${THREE_VERSION}/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const D = ${json};
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const c = document.createElement('canvas'); c.width = 2; c.height = 256;
const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
gr.addColorStop(0, D.theme.bg[0]); gr.addColorStop(1, D.theme.bg[1]); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
scene.background = new THREE.CanvasTexture(c); scene.background.colorSpace = THREE.SRGBColorSpace;
scene.fog = new THREE.FogExp2(D.theme.fog, 0.012);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 8, 5); scene.add(sun);
const byId = new Map(); const meshes = [];
const geos = { sphere: new THREE.IcosahedronGeometry(0.5, 3), cube: new THREE.BoxGeometry(0.72, 0.72, 0.72), octahedron: new THREE.OctahedronGeometry(0.62), ring: new THREE.TorusGeometry(0.4, 0.11, 12, 32) };
function label(text, color) {
  const cv = document.createElement('canvas'); const x = cv.getContext('2d');
  x.font = '500 44px system-ui,sans-serif'; const w = Math.min(900, x.measureText(text).width + 30);
  cv.width = w; cv.height = 64; x.font = '500 44px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = D.theme.outline; x.strokeText(text, w / 2, 34); x.fillStyle = D.theme.text; x.fillText(text, w / 2, 34);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(w / 64 * 0.34, 0.34, 1); return s;
}
let minY = Infinity, sumY = 0;
for (const n of D.nodes) {
  const col = new THREE.Color(n.c || '#7CF7FF');
  const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: D.theme.flat > 0.5 ? 0.05 : 0.55, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 });
  const m = new THREE.Mesh(geos[n.shape] || geos.sphere, mat);
  m.position.fromArray(n.pos); m.scale.setScalar(n.s || 1); m.userData = n;
  scene.add(m); meshes.push(m); byId.set(n.id, m);
  const l = label((n.i ? n.i + ' ' : '') + (n.t || 'Untitled'));
  l.position.copy(m.position).add(new THREE.Vector3(0, 0.5 * (n.s || 1) + 0.25, 0)); scene.add(l);
  minY = Math.min(minY, n.pos[1]); sumY += n.pos[1];
}
function curve(a, b, color, dashed) {
  const mid = a.clone().add(b).multiplyScalar(0.5); const bow = mid.clone().normalize().multiplyScalar(a.distanceTo(b) * 0.15);
  const pts = new THREE.QuadraticBezierCurve3(a, mid.add(bow), b).getPoints(20);
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.8 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 });
  const line = new THREE.Line(geo, mat); if (dashed) line.computeLineDistances(); scene.add(line);
}
for (const n of D.nodes) if (n.p && byId.has(n.p)) curve(byId.get(n.p).position, byId.get(n.id).position, new THREE.Color(n.c || '#7CF7FF'), false);
for (const l of D.links) if (byId.has(l.a) && byId.has(l.b)) curve(byId.get(l.a).position, byId.get(l.b).position, new THREE.Color('#ffffff'), true);
const box = new THREE.Box3(); meshes.forEach((m) => box.expandByObject(m));
const sphere = box.getBoundingSphere(new THREE.Sphere());
const root = byId.get(D.rootId)?.position || new THREE.Vector3();
camera.position.copy(root).add(new THREE.Vector3(0.45, 0.35, 0.85).normalize().multiplyScalar(Math.max(10, sphere.radius * 2.1)));
controls.target.copy(root);
const floor = Math.min(sumY / Math.max(1, D.nodes.length) - 1.6, minY + 0.8);
const grid = new THREE.GridHelper(400, 200, 0x33405a, 0x33405a); grid.position.y = floor; grid.visible = false;
grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
let mode = 'orbit', yaw = 0, pitch = 0, tween = null; const keys = new Set(); const stick = { x: 0, y: 0 };
const noteEl = document.getElementById('note');
function setMode(m) {
  mode = m; document.getElementById('orbit').classList.toggle('on', m === 'orbit'); document.getElementById('walk').classList.toggle('on', m === 'walk');
  controls.enabled = m === 'orbit'; grid.visible = m === 'walk'; document.getElementById('stick').style.display = m === 'walk' ? 'block' : 'none';
  if (m === 'walk') { const d = camera.getWorldDirection(new THREE.Vector3()); d.y = 0; d.normalize(); const to = new THREE.Vector3(camera.position.x, floor + 1.6, camera.position.z); const far = to.distanceTo(sphere.center) - sphere.radius - 4; if (far > 0) to.add(sphere.center.clone().sub(to).setY(0).normalize().multiplyScalar(far)).setY(floor + 1.6); flyTo(to, to.clone().addScaledVector(d, 10)); }
  else { const d = camera.getWorldDirection(new THREE.Vector3()); controls.target.copy(camera.position).addScaledVector(d, 10); }
}
function flyTo(pos, look, ms = 900) { tween = { p0: camera.position.clone(), p1: pos, l0: camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5)), l1: look, t0: performance.now(), ms }; }
document.getElementById('orbit').onclick = () => setMode('orbit');
document.getElementById('walk').onclick = () => setMode('walk');
let tourI = -1, tourTimer = null;
const tourBtn = document.getElementById('tour');
if (tourBtn) tourBtn.onclick = () => { clearTimeout(tourTimer); if (tourI >= 0) { tourI = -1; tourBtn.textContent = 'Tour ▶'; return; } tourI = 0; tourBtn.textContent = 'Stop ■'; step(); };
function step() { if (tourI < 0) return; const w = D.waypoints[tourI % D.waypoints.length]; if (mode === 'orbit') setMode('walk'); flyTo(new THREE.Vector3(...w.position), new THREE.Vector3(...w.target), 1800); tourI++; tourTimer = setTimeout(step, 4500); }
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase())); addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; });
addEventListener('pointermove', (e) => { if (!drag || mode !== 'walk') return; yaw += (e.clientX - drag.x) * 0.004; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.004)); drag.x = e.clientX; drag.y = e.clientY; });
addEventListener('pointerup', (e) => {
  if (drag && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObjects(meshes)[0];
    if (hit) {
      const n = hit.object.userData; const p = hit.object.position;
      noteEl.style.display = 'block'; noteEl.textContent = (n.t || 'Untitled') + (n.note ? '\\n\\n' + n.note : '');
      if (mode === 'walk') { const dir = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z).normalize(); flyTo(new THREE.Vector3(p.x, Math.max(floor + 1.6, p.y - 0.2), p.z).addScaledVector(dir, 2.5), p.clone(), 1200); }
      else { controls.target.copy(p); }
    } else noteEl.style.display = 'none';
  }
  drag = null;
});
const st = document.getElementById('stick'), knob = st.querySelector('i');
st.addEventListener('pointerdown', (e) => { e.stopPropagation(); st.setPointerCapture(e.pointerId); });
st.addEventListener('pointermove', (e) => { if (!st.hasPointerCapture(e.pointerId)) return; const r = st.getBoundingClientRect(); let x = (e.clientX - r.left - 55) / 45, y = (e.clientY - r.top - 55) / 45; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } stick.x = x; stick.y = -y; knob.style.transform = 'translate(' + x * 32 + 'px,' + y * 32 + 'px)'; });
st.addEventListener('pointerup', () => { stick.x = stick.y = 0; knob.style.transform = ''; });
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (tween) {
    const t = Math.min(1, (now - tween.t0) / tween.ms), k = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    if (tween.l1) camera.lookAt(new THREE.Vector3().lerpVectors(tween.l0, tween.l1, k));
    if (t >= 1) { const d = camera.getWorldDirection(new THREE.Vector3()); yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(d.y); if (mode === 'orbit' && tween.l1) controls.target.copy(tween.l1); tween = null; }
  } else if (mode === 'walk') {
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const mx = stick.x + (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), my = stick.y + (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
    camera.position.addScaledVector(f, my * 3.2 * dt).addScaledVector(r, mx * 3.2 * dt);
    camera.position.y += (floor + 1.6 - camera.position.y) * Math.min(1, dt * 4);
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))));
  } else controls.update();
  renderer.render(scene, camera);
});
</script></body></html>
`;
}
