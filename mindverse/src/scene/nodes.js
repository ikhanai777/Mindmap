// A node is a glowing glass bubble: fresnel shell, faint inner veins,
// twinkling sparkles on its surface, and a crisp camera-facing label.
import * as THREE from 'three';

const shellGeo = new THREE.SphereGeometry(1, 48, 32);
const ringGeo = new THREE.TorusGeometry(1.28, 0.035, 8, 96);

const SPARKS = 46;
const sparkGeo = (() => {
  const pos = new Float32Array(SPARKS * 3);
  const seed = new Float32Array(SPARKS);
  for (let i = 0; i < SPARKS; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos.set([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return g;
})();

const shellVertex = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vP = position;
    gl_Position = projectionMatrix * mv;
  }`;

const shellFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uTime; uniform float uGlow; uniform float uSeed; uniform float uBack;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    // clamp: rounding can push this a hair below 0, and pow() of a negative is
    // NaN on some GPUs; bloom then smears the NaN into flickering black blocks
    float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float rim = pow(f, 2.6);
    float thin = smoothstep(0.82, 0.97, f) ; // bright edge line
    // wispy veins drifting over the glass
    float veins = sin(vP.x * 7.0 + uTime * 0.6 + uSeed * 10.0) * sin(vP.y * 6.0 - uTime * 0.4) * sin(vP.z * 8.0 + uSeed * 5.0);
    veins = smoothstep(0.55, 1.0, abs(veins)) * 0.35;
    float core = 0.05 + veins * (0.4 + f);
    vec3 col = uColor * (rim * 1.25 + thin * 0.9 + core) * uGlow;
    col += vec3(1.0) * thin * 0.25 * uGlow;
    float a = clamp(rim + core + thin, 0.0, 1.0);
    gl_FragColor = vec4(clamp(col * (uBack > 0.5 ? 0.45 : 1.0), 0.0, 4.0), a);
  }`;

const sparkMaterial = (uniforms) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
      void main() {
        vec3 p = position * (1.0 + 0.04 * sin(uTime * 2.0 + aSeed * 20.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // brighter on the silhouette, like light caught on the glass rim
        vec3 n = normalize(normalMatrix * position);
        float edge = 1.0 - abs(dot(n, normalize(-mv.xyz)));
        // slow, soft shimmer (fast twinkling reads as flicker)
        vA = (0.35 + 0.35 * sin(uTime * (0.5 + aSeed) + aSeed * 60.0)) * (0.25 + clamp(edge, 0.0, 1.0));
        float size = uScale * (0.6 + aSeed) * 40.0 / -mv.z;
        // sub-pixel points pop in and out between frames: keep a minimum size and fade instead
        vA *= clamp(size / 3.0, 0.0, 1.0);
        gl_PointSize = max(size, 2.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float s = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(clamp(mix(uColor, vec3(1.0), 0.6) * vA * s * 1.3, 0.0, 2.0), clamp(s * vA, 0.0, 1.0));
      }`,
  });

// ---------- labels ----------

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Labels are laid out in a 512 x LABEL_H logical box and rasterised at
// `res` x that, so big bubbles get sharp text without every label costing
// a large texture.
export const LABEL_ASPECT = 0.62;
export function drawLabel(canvas, text, color, { root = false, badge = '', res = 1 } = {}) {
  const W = 512;
  const H = Math.round(W * LABEL_ASPECT);
  canvas.width = Math.round(W * res);
  canvas.height = Math.round(H * res);
  const ctx = canvas.getContext('2d');
  ctx.scale(res, res);
  ctx.clearRect(0, 0, W, H);
  const content = (root ? text.toUpperCase() : text) || ' ';
  const maxW = W * 0.8;
  let size = root ? 70 : 82;
  let lines;
  // shrink until it fits inside the bubble (max 3 lines)
  for (;;) {
    ctx.font = `${root ? 700 : 600} ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
    lines = wrap(ctx, content, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if ((lines.length <= 3 && widest <= maxW && lines.length * size * 1.12 + (badge ? 70 : 0) <= H * 0.92) || size <= 26) break;
    size -= 4;
  }
  const lh = size * 1.12;
  const top = H / 2 - ((lines.length - 1) * lh) / 2 - (badge ? 32 : 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#f2f8ff';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lh));
  ctx.shadowBlur = 0;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.07);
  ctx.strokeStyle = 'rgba(2, 8, 20, 0.75)';
  lines.forEach((l, i) => ctx.strokeText(l, W / 2, top + i * lh));
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lh));
  if (badge) {
    ctx.font = `700 46px Inter, system-ui, sans-serif`;
    const bw = ctx.measureText(badge).width + 34;
    const bx = W / 2 - bw / 2;
    const by = top + (lines.length - 1) * lh + size * 0.75;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 58, 29);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#04101f';
    ctx.fillText(badge, W / 2, by + 31);
  }
}

// ---------- node view ----------

export class NodeView {
  constructor(id) {
    this.id = id;
    this.group = new THREE.Group();
    this.uniforms = {
      uColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uSeed: { value: Math.random() },
      uBack: { value: 0 },
      uScale: { value: 1 },
    };
    const mat = (side, back) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uBack: { value: back } },
        vertexShader: shellVertex,
        fragmentShader: shellFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side,
      });
    this.back = new THREE.Mesh(shellGeo, mat(THREE.BackSide, 1));
    this.shell = new THREE.Mesh(shellGeo, mat(THREE.FrontSide, 0));
    this.shell.userData.nodeId = id;
    this.sparks = new THREE.Points(sparkGeo, sparkMaterial(this.uniforms));
    this.body = new THREE.Group();
    this.body.add(this.back, this.shell, this.sparks);

    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false }),
    );
    this.label.renderOrder = 10;

    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.visible = false;

    this.group.add(this.body, this.ring); // label lives in world.labelScene
    this.radius = 1;
    this.scale = 0.001; // pops in
    this.targetScale = 1;
    this.current = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.labelKey = '';
    this.hover = false;
    this.selected = false;
    this.dim = false;
    this.dropTarget = false;
  }

  setLabel(text, color, opts) {
    // bigger bubbles are seen larger on screen, so rasterise their text finer
    const res = opts.depth === 0 ? 2.5 : opts.depth === 1 ? 2 : 1.5;
    const key = `${text}|${color}|${opts.root}|${opts.badge}|${res}`;
    if (key === this.labelKey) return;
    this.labelKey = key;
    const w = this.canvas.width;
    const h = this.canvas.height;
    drawLabel(this.canvas, text, color, { ...opts, res });
    if (w !== this.canvas.width || h !== this.canvas.height) {
      // size changed: a texture can't be resized in place
      this.texture.dispose();
    }
    this.texture.needsUpdate = true;
  }

  setColor(hex) {
    this.uniforms.uColor.value.set(hex);
    this.ring.material.color.set(hex).lerp(new THREE.Color('#ffffff'), 0.35);
  }

  update(t, dt, camera) {
    this.uniforms.uTime.value = t;
    const k = 1 - Math.exp(-dt * 7);
    this.current.lerp(this.target, k);
    this.group.position.copy(this.current);
    const hoverBoost = this.hover || this.dropTarget ? 1.12 : 1;
    this.scale += (this.targetScale * hoverBoost - this.scale) * (1 - Math.exp(-dt * 10));
    const breathe = 1 + Math.sin(t * 1.3 + this.uniforms.uSeed.value * 20) * 0.015;
    const s = this.radius * this.scale * breathe;
    this.body.scale.setScalar(s);
    this.uniforms.uScale.value = s;
    this.label.position.copy(this.current);
    this.label.scale.set(s * 1.9, s * 1.9 * LABEL_ASPECT, 1);
    const glow = this.selected ? 1.9 : this.hover || this.dropTarget ? 1.5 : 1;
    this.uniforms.uGlow.value += ((this.dim ? 0.3 : glow) - this.uniforms.uGlow.value) * k;
    this.label.material.opacity = this.dim ? 0.35 : 1;
    this.ring.visible = this.selected || this.dropTarget;
    if (this.ring.visible) {
      this.ring.scale.setScalar(s * (1 + Math.sin(t * 3) * 0.03));
      this.ring.quaternion.copy(camera.quaternion);
      this.ring.rotateZ(t * 0.8);
    }
  }

  dispose() {
    this.back.material.dispose();
    this.shell.material.dispose();
    this.sparks.material.dispose();
    this.label.material.dispose();
    this.texture.dispose();
    this.ring.material.dispose();
  }
}
