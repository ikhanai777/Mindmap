// Glass-orb node shader: inner glow + fresnel rim, per-instance brightness/opacity.
// `uFlat` blends toward flat shading for the Paper / High Contrast themes.
import * as THREE from 'three';

export function createNodeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uFlat: { value: 0 } },
    ]),
    vertexShader: /* glsl */ `
      attribute vec2 aState; // x = brightness (recency), y = opacity
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vColor;
      varying vec2 vState;
      #include <fog_pars_vertex>
      void main() {
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 mvPosition = viewMatrix * worldPos;
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vViewDir = normalize(-mvPosition.xyz);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        vState = aState;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFlat;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vColor;
      varying vec2 vState;
      #include <fog_pars_fragment>
      void main() {
        vec3 n = normalize(vNormal);
        float facing = max(dot(n, normalize(vViewDir)), 0.0);
        float rim = pow(1.0 - facing, 2.2);
        float core = pow(facing, 2.5);
        float b = vState.x;
        vec3 glass = vColor * (0.18 + 0.35 * b) + vColor * core * (0.35 + 0.65 * b) + mix(vColor, vec3(1.0), 0.35) * rim * 1.15;
        float glassAlpha = 0.78 + 0.22 * rim;
        float lambert = 0.62 + 0.38 * max(dot(n, normalize(vec3(0.35, 0.85, 0.5))), 0.0);
        vec3 flatCol = vColor * lambert * (0.8 + 0.2 * b);
        flatCol = mix(flatCol, vColor * 0.55, smoothstep(0.55, 0.9, rim) * 0.6); // ink-like edge
        vec3 col = mix(glass, flatCol, uFlat);
        float alpha = mix(glassAlpha, 1.0, uFlat) * vState.y;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }
    `,
    transparent: true,
    fog: true,
  });
}

/** Soft round sprite used for far points, particles and nebulae. */
export function radialTexture(size = 128, inner = 0.0, soft = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, size * inner / 2, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.min(0.99, 0.35 * soft + 0.15), 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const emojiCache = new Map();
export function emojiTexture(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.fillText(emoji, 48, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(emoji, tex);
  return tex;
}
