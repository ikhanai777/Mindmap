// Minimap: tiny 2D radar (top-down, heading-up) showing position and heading; tap a point to fly there.
import * as THREE from 'three';
import { get } from '../store.js';
import { $ } from './util.js';

export function initMinimap(app) {
  const canvas = $('#minimap');
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  let frame = 0;
  let range = 30;

  function heading() {
    const d = app.scene.camera.getWorldDirection(new THREE.Vector3());
    return Math.atan2(d.x, -d.z); // 0 = looking toward -Z
  }

  function draw() {
    if (++frame % 3) return;
    const s3 = app.scene;
    const cam = s3.camera.position;
    const b = s3.bounds();
    range = Math.max(12, b.radius * 1.3 + b.center.distanceTo(cam) * 0.25);
    const hd = heading();
    const cos = Math.cos(-hd), sin = Math.sin(-hd);
    const styles = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    // range rings
    ctx.strokeStyle = styles.getPropertyValue('--line') || 'rgba(255,255,255,.15)';
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66]) { ctx.beginPath(); ctx.arc(S / 2, S / 2, (S / 2) * r, 0, Math.PI * 2); ctx.stroke(); }
    // view wedge
    ctx.fillStyle = 'rgba(124,247,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.arc(S / 2, S / 2, S / 2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.fill();
    // nodes
    const sel = new Set(get().selection);
    for (const [id, st] of s3.states) {
      if (st.opacity < 0.1) continue;
      const dx = st.cur.x - cam.x, dz = st.cur.z - cam.z;
      const rx = dx * cos - dz * sin, rz = dx * sin + dz * cos;
      const px = S / 2 + (rx / range) * (S / 2), py = S / 2 + (rz / range) * (S / 2);
      if (px < -4 || py < -4 || px > S + 4 || py > S + 4) continue;
      ctx.globalAlpha = Math.max(0.25, st.opacity);
      ctx.fillStyle = st.color.getStyle();
      const r = sel.has(id) ? 5 : id === get().doc.rootId ? 4 : 2.4;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // me
    ctx.fillStyle = styles.getPropertyValue('--fg') || '#fff';
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2 - 9);
    ctx.lineTo(S / 2 + 6, S / 2 + 6);
    ctx.lineTo(S / 2, S / 2 + 2);
    ctx.lineTo(S / 2 - 6, S / 2 + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  canvas.addEventListener('pointerdown', (e) => e.stopPropagation());
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const py = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const hd = heading();
    const cos = Math.cos(hd), sin = Math.sin(hd);
    const rx = px * range, rz = py * range;
    const cam = app.scene.camera.position;
    const wx = cam.x + rx * cos - rz * sin, wz = cam.z + rx * sin + rz * cos;
    // snap to the nearest node near the tap
    let best = null, bd = range * 0.18;
    for (const [id, st] of app.scene.states) {
      if (st.opacity < 0.1) continue;
      const d = Math.hypot(st.cur.x - wx, st.cur.z - wz);
      if (d < bd) { bd = d; best = id; }
    }
    if (best) { app.select(best, { fly: true, sheet: false }); return; }
    const rig = app.rig;
    if (rig.mode === 'orbit') {
      const target = new THREE.Vector3(wx, rig.target.y, wz);
      const offset = cam.clone().sub(rig.target);
      rig.flyTo(target.clone().add(offset), target);
    } else {
      const dest = new THREE.Vector3(wx, cam.y, wz);
      const look = dest.clone().add(app.scene.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
      rig.flyTo(dest, look);
    }
    app.haptic('light');
  });

  return { draw };
}
