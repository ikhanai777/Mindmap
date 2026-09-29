// Camera rig: three modes sharing one gesture language.
//  orbit — turn the globe (target + spherical offset)
//  fly   — drone camera (free position, yaw/pitch)
//  walk  — first person on an invisible floor, eye height 1.6
import * as THREE from 'three';
import { store, reduceMotion } from './store.js';

const EYE = 1.6;
const TRANSITION_MS = 600;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();

export class CameraRig {
  constructor(scene3d) {
    this.s3 = scene3d;
    this.camera = scene3d.camera;
    this.mode = 'orbit';
    this.target = new THREE.Vector3();
    this.radius = 22;
    this.theta = 0.5;
    this.phi = 1.2;
    this.yaw = 0;
    this.pitch = 0;
    this.stick = { x: 0, y: 0 }; // left stick: move
    this.lookStick = { x: 0, y: 0 }; // right stick (landscape): look
    this.keys = new Set();
    this.vel = { theta: 0, phi: 0 };
    this.dragging = false;
    this.tween = null;
    this.gyro = null;
    this.changed = true;
    this.#applyOrbit();
  }

  // ---------- pose helpers ----------
  lookPoint(dist = null) {
    if (this.mode === 'orbit' && !this.tween) return this.target.clone();
    const d = dist ?? 10;
    return this.camera.position.clone().add(this.camera.getWorldDirection(_dir).multiplyScalar(d));
  }

  #dirFromYawPitch(out = _dir) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  #syncYawPitchFromCamera() {
    const d = this.camera.getWorldDirection(_dir);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  #syncOrbitFrom(pos, look) {
    this.target.copy(look);
    const off = _v.copy(pos).sub(look);
    this.radius = clamp(off.length(), 1.5, 600);
    this.phi = clamp(Math.acos(clamp(off.y / (this.radius || 1), -1, 1)), 0.05, Math.PI - 0.05);
    this.theta = Math.atan2(off.x, off.z);
  }

  #applyOrbit() {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }

  #applyYawPitch() {
    const look = _v.copy(this.camera.position).add(this.#dirFromYawPitch());
    this.camera.lookAt(look);
  }

  // ---------- mode ----------
  setMode(mode, animate = true) {
    if (mode === this.mode) return;
    const prev = this.mode;
    const pos = this.camera.position.clone();
    const look = this.lookPoint(prev === 'orbit' ? null : 10);
    this.mode = mode;
    this.tween = null;
    if (mode === 'orbit') {
      // orbit around what we were looking at
      const d = prev === 'orbit' ? this.radius : Math.max(6, Math.min(30, this.radius));
      const lookAt = pos.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(d));
      this.#syncOrbitFrom(pos, lookAt);
      this.#applyOrbit();
    } else if (mode === 'fly') {
      this.#syncYawPitchFromCamera();
    } else if (mode === 'walk') {
      this.#syncYawPitchFromCamera();
      const floor = this.s3.floorY;
      const to = pos.clone();
      to.y = floor + EYE;
      const flatDir = this.camera.getWorldDirection(new THREE.Vector3());
      flatDir.y = 0;
      if (flatDir.lengthSq() < 1e-4) flatDir.set(0, 0, -1);
      flatDir.normalize();
      // step toward the map so the walk starts near the constellation
      const b = this.s3.bounds();
      if (to.distanceTo(b.center) > b.radius + 6) {
        const toward = b.center.clone().sub(to); toward.y = 0;
        to.add(toward.normalize().multiplyScalar(to.distanceTo(b.center) - (b.radius + 4)));
        to.y = floor + EYE;
      }
      const lookAt = to.clone().add(flatDir.multiplyScalar(10));
      if (animate) this.flyTo(to, lookAt, TRANSITION_MS);
      else { this.camera.position.copy(to); this.camera.lookAt(lookAt); this.#syncYawPitchFromCamera(); }
    }
    this.changed = true;
  }

  // ---------- gestures ----------
  rotate(dx, dy) {
    if (this.mode !== 'orbit') return this.look(dx, dy);
    this.cancelTween();
    const a = -dx * 0.0065, b = -dy * 0.0065;
    this.theta += a;
    this.phi = clamp(this.phi + b, 0.05, Math.PI - 0.05);
    this.vel.theta = a;
    this.vel.phi = b;
    this.changed = true;
  }

  look(dx, dy) {
    this.cancelTween();
    this.yaw += dx * 0.0042;
    this.pitch = clamp(this.pitch + dy * 0.0042, -1.45, 1.45);
    this.changed = true;
  }

  zoom(factor) {
    this.cancelTween();
    if (this.mode === 'orbit') this.radius = clamp(this.radius / factor, 1.5, 600);
    else if (this.mode === 'fly') this.camera.position.y += (factor - 1) * 6; // pinch = altitude
    else {
      // walk: pinch steps forward/back along the view
      const d = this.#dirFromYawPitch(new THREE.Vector3());
      d.y = 0;
      d.normalize();
      this.camera.position.addScaledVector(d, (factor - 1) * 4);
    }
    this.changed = true;
  }

  pan(dx, dy) {
    this.cancelTween();
    if (this.mode !== 'orbit') return this.look(dx, dy);
    const scale = this.radius * 0.0016;
    _right.setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(_right, -dx * scale).addScaledVector(up, dy * scale);
    this.changed = true;
  }

  cancelTween() {
    if (this.tween) {
      this.lastTweenDist = this.tween.toPos.distanceTo(this.tween.toLook);
      this.tween = null;
      this.#afterTween();
    }
  }

  // ---------- transitions ----------
  /** Smoothly move the camera to `pos` looking at `look` (600 ms ease by default). */
  flyTo(pos, look, dur = TRANSITION_MS, onDone = null) {
    const fromLook = this.lookPoint(this.mode === 'orbit' ? null : pos.distanceTo(look) || 10);
    if (reduceMotion()) dur = Math.min(dur, 200);
    this.tween = {
      fromPos: this.camera.position.clone(),
      fromLook,
      toPos: pos.clone(),
      toLook: look.clone(),
      t0: performance.now(),
      dur,
      onDone,
    };
    this.vel.theta = this.vel.phi = 0;
    this.changed = true;
  }

  #afterTween() {
    if (this.mode === 'orbit') {
      const look = this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(this.lastTweenDist || 10));
      this.#syncOrbitFrom(this.camera.position, look);
    } else this.#syncYawPitchFromCamera();
  }

  /** Double-tap a node: bring it to the center of attention. */
  focusNode(id) {
    const p = this.s3.getTarget(id);
    if (!p) return;
    const r = this.s3.radius(id);
    if (this.mode === 'walk') return this.walkTo(id);
    if (this.mode === 'orbit') {
      const dist = Math.max(4, r * 10);
      const dir = this.camera.position.clone().sub(this.target).normalize();
      this.flyTo(p.clone().addScaledVector(dir, dist), p);
    } else {
      const dir = this.camera.position.clone().sub(p).normalize();
      this.flyTo(p.clone().addScaledVector(dir, Math.max(3.5, r * 7)), p);
    }
  }

  /** Walk mode: follow a smooth path to 2 units from the node, facing it. */
  walkTo(id, onDone) {
    const p = this.s3.getTarget(id);
    if (!p) return;
    const cam = this.camera.position;
    const flat = new THREE.Vector3(cam.x - p.x, 0, cam.z - p.z);
    if (flat.lengthSq() < 1e-4) flat.set(0, 0, 1);
    flat.normalize();
    const dest = new THREE.Vector3(p.x, 0, p.z).addScaledVector(flat, 2 + this.s3.radius(id));
    // keep eye height unless the node floats far above/below; then rise gently like a lift
    dest.y = clamp(p.y - 0.2, this.s3.floorY + EYE, this.s3.floorY + EYE + 12);
    const dist = cam.distanceTo(dest);
    this.flyTo(dest, p, clamp(dist * 140, TRANSITION_MS, 2600), onDone);
  }

  /** Fly back to the root (600 ms). */
  recenter(rootId, fit = true) {
    const root = this.s3.getTarget(rootId) || new THREE.Vector3();
    const b = this.s3.bounds();
    const dist = fit ? clamp(b.radius * 2.1, 8, 400) : 14;
    if (this.mode === 'orbit') {
      const flat = store.getState().doc?.layoutMode === 'flat-2d';
      const dir = flat ? new THREE.Vector3(0, 0.08, 1).normalize() : new THREE.Vector3(Math.sin(0.5) * 0.93, 0.36, Math.cos(0.5) * 0.93).normalize();
      const center = flat ? b.center : root;
      this.flyTo(center.clone().addScaledVector(dir, dist), center);
      this.lastTweenDist = dist;
    } else {
      const eye = this.mode === 'walk' ? this.s3.floorY + EYE : root.y + 2;
      const pos = new THREE.Vector3(root.x, eye, root.z + Math.min(dist, 14));
      this.flyTo(pos, root);
    }
  }

  // ---------- per-frame ----------
  update(dt) {
    const now = performance.now();
    const cam = this.camera;
    if (this.tween) {
      const t = this.tween;
      const e = clamp((now - t.t0) / t.dur, 0, 1);
      const k = easeInOut(e);
      cam.position.lerpVectors(t.fromPos, t.toPos, k);
      const look = _v.lerpVectors(t.fromLook, t.toLook, k);
      cam.lookAt(look);
      this.changed = true;
      if (e >= 1) {
        this.tween = null;
        this.lastTweenDist = t.toPos.distanceTo(t.toLook);
        this.#afterTween();
        t.onDone?.();
      }
      return;
    }
    const rm = reduceMotion();
    if (this.mode === 'orbit') {
      if (!this.dragging && !rm && (Math.abs(this.vel.theta) > 1e-5 || Math.abs(this.vel.phi) > 1e-5)) {
        this.theta += this.vel.theta;
        this.phi = clamp(this.phi + this.vel.phi, 0.05, Math.PI - 0.05);
        this.vel.theta *= 0.92;
        this.vel.phi *= 0.92;
        this.changed = true;
      } else if (this.dragging || rm) { if (!this.dragging) this.vel.theta = this.vel.phi = 0; }
      // keyboard orbit
      const kx = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      const ky = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
      if (kx || ky) { this.theta -= kx * dt * 1.4; this.radius = clamp(this.radius * (1 - ky * dt * 1.2), 1.5, 600); this.changed = true; }
      this.#applyOrbit();
      return;
    }
    // fly / walk
    let mx = this.stick.x, my = this.stick.y;
    mx += (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    my += (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    if (this.lookStick.x || this.lookStick.y) this.look(-this.lookStick.x * dt * 420, this.lookStick.y * dt * 300);
    if (this.gyro?.active) {
      this.yaw = this.gyro.yaw0 + this.gyro.dyaw;
      this.pitch = clamp(this.gyro.pitch, -1.45, 1.45);
    }
    const b = this.s3.bounds();
    const speed = this.mode === 'fly' ? 5 + b.radius * 0.18 : 3.2;
    const fwd = this.#dirFromYawPitch(new THREE.Vector3());
    if (this.mode === 'walk') { fwd.y = 0; fwd.normalize(); }
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    if (mx || my) {
      cam.position.addScaledVector(fwd, my * speed * dt).addScaledVector(right, mx * speed * dt);
      this.changed = true;
    }
    if (this.mode === 'fly') {
      const up = (this.keys.has('e') || this.keys.has(' ') ? 1 : 0) - (this.keys.has('q') || this.keys.has('shift') ? 1 : 0);
      if (up) { cam.position.y += up * speed * dt; this.changed = true; }
    } else {
      cam.position.y += (this.s3.floorY + EYE - cam.position.y) * Math.min(1, dt * 4);
    }
    this.#softCollide(dt);
    this.#applyYawPitch();
  }

  /** Collision-soft: gently slide around nodes instead of clipping through them. */
  #softCollide(dt) {
    const cam = this.camera.position;
    for (const [id, st] of this.s3.states) {
      if (st.opacity < 0.2) continue;
      const p = this.s3.getPos(id);
      const min = st.radius + 0.7;
      const dx = cam.x - p.x, dy = this.mode === 'walk' ? 0 : cam.y - p.y, dz = cam.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= min || d < 1e-5) continue;
      const push = (min - d) * Math.min(1, dt * 10);
      cam.x += (dx / d) * push;
      cam.y += (dy / d) * push;
      cam.z += (dz / d) * push;
    }
  }

  // ---------- gyroscope ("window" mode) ----------
  async enableGyro(on) {
    if (!on) {
      if (this.gyro) window.removeEventListener('deviceorientation', this.gyro.handler);
      this.gyro = null;
      return true;
    }
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
      } catch { return false; }
    }
    const g = { active: false, yaw0: this.yaw, alpha0: null, dyaw: 0, pitch: this.pitch };
    g.handler = (e) => {
      if (e.alpha == null || this.mode === 'orbit' || this.tween) { g.active = false; g.alpha0 = null; return; }
      if (g.alpha0 === null) { g.alpha0 = e.alpha; g.yaw0 = this.yaw; }
      g.dyaw = THREE.MathUtils.degToRad(e.alpha - g.alpha0);
      g.pitch = THREE.MathUtils.degToRad((e.beta ?? 90) - 90);
      g.active = true;
    };
    window.addEventListener('deviceorientation', g.handler);
    this.gyro = g;
    return true;
  }

  // ---------- bookmarks ----------
  saveView() {
    const look = this.mode === 'orbit' ? this.target : this.lookPoint(10);
    return {
      mode: this.mode,
      position: this.camera.position.toArray().map((v) => +v.toFixed(3)),
      target: look.toArray().map((v) => +v.toFixed(3)),
    };
  }

  restoreView(view) {
    if (!view?.position || !view?.target) return false;
    this.mode = view.mode || 'orbit';
    const pos = new THREE.Vector3(...view.position);
    const look = new THREE.Vector3(...view.target);
    this.tween = null;
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (this.mode === 'orbit') { this.#syncOrbitFrom(pos, look); this.#applyOrbit(); }
    else this.#syncYawPitchFromCamera();
    return true;
  }
}
