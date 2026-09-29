// Pixel-width line batches (one draw call each) with in-place buffer updates.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export class FatLines {
  constructor({ width = 2, dashed = false, dashSize = 0.35, gapSize = 0.25 } = {}) {
    this.capacity = 0;
    this.count = 0;
    this.baseWidth = width;
    this.dashed = dashed;
    this.material = new LineMaterial({
      linewidth: width,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      dashed,
      dashSize,
      gapSize,
      fog: true,
    });
    this.object = new LineSegments2(new LineSegmentsGeometry(), this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 1;
    this.ensure(64);
  }

  ensure(n) {
    if (n <= this.capacity) return;
    let cap = Math.max(64, this.capacity);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.pos = new Float32Array(cap * 6);
    this.col = new Float32Array(cap * 6);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(this.pos);
    geo.setColors(this.col);
    this.object.geometry.dispose();
    this.object.geometry = geo;
  }

  begin() {
    this.count = 0;
  }

  /** Append one segment a→b with colors ca, cb ({r,g,b}). */
  push(ax, ay, az, bx, by, bz, ca, cb) {
    if (this.count >= this.capacity) {
      const oldPos = this.pos, oldCol = this.col, n = this.count;
      this.ensure(this.count + 1);
      this.pos.set(oldPos.subarray(0, n * 6));
      this.col.set(oldCol.subarray(0, n * 6));
    }
    const i = this.count * 6;
    const p = this.pos, c = this.col;
    p[i] = ax; p[i + 1] = ay; p[i + 2] = az; p[i + 3] = bx; p[i + 4] = by; p[i + 5] = bz;
    c[i] = ca.r; c[i + 1] = ca.g; c[i + 2] = ca.b; c[i + 3] = cb.r; c[i + 4] = cb.g; c[i + 5] = cb.b;
    this.count++;
  }

  end() {
    const geo = this.object.geometry;
    geo.attributes.instanceStart.data.needsUpdate = true;
    geo.attributes.instanceColorStart.data.needsUpdate = true;
    geo.instanceCount = this.count;
    this.object.visible = this.count > 0;
    if (this.dashed && this.count) this.object.computeLineDistances();
  }

  setResolution(w, h, dpr) {
    this.material.resolution.set(w * dpr, h * dpr);
    this.material.linewidth = this.baseWidth * dpr;
  }
}

export const tmpColor = () => new THREE.Color();
