// Parent→child links drawn as bundles of luminous fibres. The curve is
// evaluated in the vertex shader (quadratic bezier from uniforms), so moving
// nodes never rebuilds geometry. Light pulses travel from parent to child.
import * as THREE from 'three';

const SEG = 56;
const SIDES = 7;
const STRANDS = 5;

const geometry = (() => {
  const g = new THREE.InstancedBufferGeometry();
  const t = [];
  const ang = [];
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    for (let j = 0; j <= SIDES; j++) {
      t.push(i / SEG);
      ang.push((j / SIDES) * Math.PI * 2);
    }
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j;
      const b = a + SIDES + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(t.length * 3).fill(0), 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aAng', new THREE.Float32BufferAttribute(ang, 1));
  // per strand: offset angle, offset amount, radius scale, pulse phase
  const strand = [];
  for (let s = 0; s < STRANDS; s++) {
    strand.push(
      (s / STRANDS) * Math.PI * 2 + Math.random() * 0.6,
      s === 0 ? 0 : 0.25 + Math.random() * 0.45,
      s === 0 ? 1 : 0.28 + Math.random() * 0.25,
      Math.random(),
    );
  }
  g.setAttribute('aStrand', new THREE.InstancedBufferAttribute(new Float32Array(strand), 4));
  g.instanceCount = STRANDS;
  return g;
})();

const vertexShader = /* glsl */ `
  attribute float aT; attribute float aAng; attribute vec4 aStrand;
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
  uniform float uR0; uniform float uR1; uniform float uSpread; uniform float uTime;
  varying float vT; varying float vFacing; varying float vPhase; varying float vMain;
  void main() {
    float t = aT;
    vec3 p = mix(mix(uA, uC, t), mix(uC, uB, t), t);
    vec3 tan = normalize(2.0 * (1.0 - t) * (uC - uA) + 2.0 * t * (uB - uC) + 1e-5);
    vec3 ref = abs(tan.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 n = normalize(cross(tan, ref));
    vec3 b = cross(tan, n);
    // fibres fan out mid-span and gather at both nodes, with a slow twist
    float bulge = sin(3.14159 * t);
    float twist = aStrand.x + t * 2.5 + sin(uTime * 0.4 + aStrand.w * 6.0) * 0.3;
    p += (n * cos(twist) + b * sin(twist)) * aStrand.y * uSpread * bulge;
    float r = mix(uR0, uR1, t) * aStrand.z;
    vec3 off = n * cos(aAng) + b * sin(aAng);
    vec4 mv = modelViewMatrix * vec4(p + off * r, 1.0);
    vFacing = abs(dot(normalize(mat3(modelViewMatrix) * off), normalize(-mv.xyz)));
    vT = t; vPhase = aStrand.w; vMain = step(aStrand.y, 0.001);
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColA; uniform vec3 uColB; uniform float uTime; uniform float uGlow;
  varying float vT; varying float vFacing; varying float vPhase; varying float vMain;
  void main() {
    vec3 col = mix(uColA, uColB, smoothstep(0.1, 0.9, vT));
    float core = pow(clamp(vFacing, 0.0, 1.0), 1.4);
    // travelling sparks, parent -> child
    float p = fract(vT * 1.6 - uTime * (0.35 + vPhase * 0.25) + vPhase);
    float spark = smoothstep(0.8, 1.0, p) * 1.6;
    float p2 = fract(vT * 3.0 - uTime * 0.6 + vPhase * 3.0);
    spark += smoothstep(0.9, 1.0, p2) * 0.8;
    float ends = smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.94, vT);
    float base = mix(0.28, 0.5, vMain);
    vec3 c = col * (base + spark) * core * uGlow + vec3(1.0) * spark * core * 0.25 * uGlow;
    gl_FragColor = vec4(clamp(c * ends, 0.0, 4.0), clamp(core * ends, 0.0, 1.0));
  }`;

export class EdgeView {
  constructor(parentId, childId) {
    this.parentId = parentId;
    this.childId = childId;
    this.uniforms = {
      uA: { value: new THREE.Vector3() },
      uB: { value: new THREE.Vector3() },
      uC: { value: new THREE.Vector3() },
      uR0: { value: 0.1 },
      uR1: { value: 0.06 },
      uSpread: { value: 0.4 },
      uTime: { value: 0 },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
      uGlow: { value: 1 },
    };
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.targetGlow = 1;
  }

  /**
   * a/b: node centres; ra/rb: their radii; bend: parent's outward direction
   * (unit vector or null) so links leave a node flowing with its branch.
   */
  setEnds(a, b, ra, rb, bend, depth) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length() || 1;
    d.divideScalar(len);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const c = mid.clone();
    if (bend) c.lerp(a.clone().addScaledVector(bend, len * 0.55), 0.55);
    // start/end on the bubble surfaces, aimed along the curve
    const startDir = new THREE.Vector3().subVectors(c, a).normalize();
    const endDir = new THREE.Vector3().subVectors(c, b).normalize();
    this.uniforms.uA.value.copy(a).addScaledVector(startDir, ra * 0.92);
    this.uniforms.uB.value.copy(b).addScaledVector(endDir, rb * 0.92);
    this.uniforms.uC.value.copy(c);
    const w = Math.max(0.05, 0.16 - depth * 0.03);
    this.uniforms.uR0.value = w;
    this.uniforms.uR1.value = w * 0.6;
    this.uniforms.uSpread.value = Math.min(len * 0.05, 0.9) * (1.2 - depth * 0.15);
  }

  setColors(a, b) {
    this.uniforms.uColA.value.set(a);
    this.uniforms.uColB.value.set(b);
  }

  update(t, dt) {
    this.uniforms.uTime.value = t;
    this.uniforms.uGlow.value += (this.targetGlow - this.uniforms.uGlow.value) * (1 - Math.exp(-dt * 8));
  }

  dispose() {
    this.mesh.material.dispose();
  }
}
