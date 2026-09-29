// Renderer, camera, controls, bloom and the cyber-space backdrop
// (nebula sky, starfield, circuit floor, neon skyline, drifting dust).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03060f');
  scene.fog = new THREE.FogExp2('#050a1a', 0.0065);

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
  camera.position.set(0, 4, 46);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 4;
  controls.maxDistance = 220;
  controls.autoRotateSpeed = 0.35;
  controls.screenSpacePanning = true;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.95, 0.5, 0.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const backdrop = createBackdrop();
  scene.add(backdrop.group);

  // labels are drawn after bloom so text stays crisp
  const labelScene = new THREE.Scene();
  function render() {
    composer.render();
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(labelScene, camera);
    renderer.autoClear = true;
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, labelScene, camera, controls, composer, bloom, backdrop, resize, render };
}

function createBackdrop() {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  // --- nebula sky dome ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float n = fbm(d * 3.0 + vec3(0.0, 0.0, uTime * 0.01));
          float n2 = fbm(d * 6.0 - vec3(uTime * 0.008));
          vec3 base = mix(vec3(0.004, 0.01, 0.03), vec3(0.01, 0.02, 0.06), smoothstep(-0.4, 0.6, d.y));
          vec3 teal = vec3(0.0, 0.14, 0.24) * smoothstep(0.45, 0.85, n) * 0.4;
          vec3 violet = vec3(0.2, 0.03, 0.28) * smoothstep(0.5, 0.9, n2) * 0.3;
          // warm horizon glow like a city at night
          float horizon = exp(-abs(d.y + 0.08) * 9.0);
          vec3 city = vec3(0.3, 0.06, 0.25) * horizon * 0.16 + vec3(0.0, 0.15, 0.25) * horizon * 0.08;
          gl_FragColor = vec4(base + teal + violet + city, 1.0);
        }`,
    }),
  );
  group.add(sky);

  // --- starfield ---
  const starCount = 2600;
  const starPos = new Float32Array(starCount * 3);
  const starSeed = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const r = 300 + Math.random() * 450;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
    starSeed[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(starSeed, 1));
  const stars = new THREE.Points(
    starGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed; varying float vA; uniform float uTime;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 2.0) + aSeed * 40.0));
          gl_PointSize = (1.0 + aSeed * 2.4);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * vA, smoothstep(0.5, 0.0, d));
        }`,
    }),
  );
  group.add(stars);

  // --- circuit-board floor ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700, 1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW; uniform float uTime;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float line(float x, float w) { return smoothstep(w, 0.0, abs(x)); }
        void main() {
          vec2 p = vW.xz / 6.0;
          vec2 cell = floor(p); vec2 f = fract(p) - 0.5;
          float h = hash(cell);
          float g = 0.0;
          // circuit traces: random horizontal/vertical segments per cell
          if (h > 0.55) g += line(f.y, 0.03) * step(abs(f.x), 0.5);
          if (h < 0.35) g += line(f.x, 0.03) * step(abs(f.y), 0.5);
          if (hash(cell + 7.0) > 0.8) g += smoothstep(0.12, 0.06, length(f)) ; // pads
          vec2 gp = abs(fract(vW.xz / 24.0) - 0.5);
          g += line(min(gp.x, gp.y), 0.012) * 0.6;
          float dist = length(vW.xz);
          float fade = smoothstep(320.0, 40.0, dist);
          // pulses running outward along the traces
          float pulse = smoothstep(0.96, 1.0, fract(dist / 40.0 - uTime * 0.12 + h * 0.3));
          vec3 col = mix(vec3(0.05, 0.35, 0.6), vec3(0.4, 0.15, 0.7), smoothstep(-200.0, 200.0, vW.x));
          float a = g * fade * (0.12 + pulse * 0.6);
          gl_FragColor = vec4(col * (0.8 + pulse * 2.0), a);
        }`,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -48;
  group.add(floor);

  // --- neon skyline on the horizon ring ---
  const bCount = 260;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const skyline = new THREE.InstancedMesh(
    boxGeo,
    new THREE.ShaderMaterial({
      fog: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vLocal; varying vec3 vScale; varying float vSeed;
        void main() {
          vLocal = position;
          vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vLocal; varying vec3 vScale; varying float vSeed; uniform float uTime;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 uv = vec2((vLocal.x + vLocal.z + 1.0) * vScale.x, vLocal.y * vScale.y);
          vec2 cell = floor(uv / vec2(1.6, 2.2));
          vec2 f = fract(uv / vec2(1.6, 2.2));
          float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.7);
          float lit = step(0.72, hash(cell + vSeed * 91.0 + floor(uTime * 0.05 + vSeed * 9.0)));
          vec3 tint = mix(vec3(0.1, 0.8, 1.0), vec3(1.0, 0.25, 0.7), step(0.5, vSeed));
          float edge = smoothstep(0.985, 1.0, vLocal.y) ;
          vec3 col = vec3(0.008, 0.012, 0.03) + tint * win * lit * 0.22 + tint * edge * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
    bCount,
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < bCount; i++) {
    const a = (i / bCount) * Math.PI * 2 + Math.random() * 0.02;
    const r = 520 + Math.random() * 120;
    const w = 10 + Math.random() * 18;
    const h = 14 + Math.pow(Math.random(), 2.5) * 110;
    m.compose(
      new THREE.Vector3(Math.cos(a) * r, -48, Math.sin(a) * r),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
      new THREE.Vector3(w, h, w),
    );
    skyline.setMatrixAt(i, m);
  }
  group.add(skyline);

  // --- drifting dust motes near the map ---
  const dustCount = 700;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos.set([(Math.random() - 0.5) * 140, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 120], i * 3);
    dustSeed[i] = Math.random();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; varying float vA; varying vec3 vC;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 0.2 + aSeed * 30.0) * 2.0;
          p.x += cos(uTime * 0.15 + aSeed * 20.0) * 2.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = 0.25 + 0.5 * (0.5 + 0.5 * sin(uTime * 1.5 + aSeed * 50.0));
          vC = mix(vec3(0.3, 0.8, 1.0), vec3(0.9, 0.5, 1.0), aSeed);
          gl_PointSize = (18.0 + aSeed * 22.0) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec3 vC;
        void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * vA, smoothstep(0.5, 0.0, d) * vA); }`,
    }),
  );
  group.add(dust);

  return {
    group,
    update(t) {
      uniforms.uTime.value = t;
    },
    setVisible(v) {
      floor.visible = v;
      skyline.visible = v;
      dust.visible = v;
    },
  };
}
