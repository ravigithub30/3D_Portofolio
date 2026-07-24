// AccretionDisk.js
// -----------------------------------------------------------------------------
// The accretion disk as a real, self-contained Three.js object — a textured
// ring mesh, not something computed inline in the lensing shader. This is
// what actually fixes the moiré/aliasing you saw: a normal mesh goes through
// Three.js's ordinary render pipeline (mipmapping, anisotropic filtering,
// MSAA), none of which a raw texture2D() call inside a fullscreen shader
// gets. The GR ray-marcher in BlackHoleLens.js now only has to handle the
// small region right around the photon sphere, where the disk's light
// actually gets visibly bent — not the whole disk.
//
// Usage:
//   import { createAccretionDisk } from './AccretionDisk.js';
//   const disk = createAccretionDisk({ position: {x:0,y:0,z:0}, innerRadius: 12, outerRadius: 30 });
//   scene.add(disk.mesh);
//   // per frame:
//   disk.update(dt, camera);
//   // tweak any time:
//   disk.mesh.position.set(10, 0, 0);
//   disk.mesh.rotation.x = ...;
// -----------------------------------------------------------------------------

import * as THREE from 'three';

// Seeded value-noise with fractal Brownian motion — gives the disk genuine
// turbulent detail (like swirling plasma) instead of a couple of clean sine
// waves, while staying low-frequency enough not to alias. Sampled in
// (angle/2pi, r) space so it tiles seamlessly around the ring.
function makeAngularNoise(gridSize = 48) {
  const grid = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();

  function sample(x, y) {
    const gx = ((x * gridSize) % gridSize + gridSize) % gridSize;
    const gy = Math.max(0, Math.min(gridSize - 1.001, y * gridSize));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = (x0 + 1) % gridSize, y1 = Math.min(gridSize - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const v00 = grid[y0 * gridSize + x0];
    const v10 = grid[y0 * gridSize + x1];
    const v01 = grid[y1 * gridSize + x0];
    const v11 = grid[y1 * gridSize + x1];
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  }

  return function fbm(angleFrac, r, octaves = 4) {
    let sum = 0, amp = 0.5, freq = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += sample(angleFrac * freq, r * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2.15; // slightly irregular lacunarity avoids repeating patterns
    }
    return sum / total; // 0..1
  };
}

function lerpColor(hexA, hexB, t) {
  const a = new THREE.Color(hexA), b = new THREE.Color(hexB);
  return a.lerp(b, t);
}

function sampleGradient(stops, t) {
  if (t <= stops[0].stop) return new THREE.Color(stops[0].color);
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i], s1 = stops[i + 1];
    if (t >= s0.stop && t <= s1.stop) {
      const localT = (t - s0.stop) / Math.max(1e-6, s1.stop - s0.stop);
      return lerpColor(s0.color, s1.color, localT);
    }
  }
  return new THREE.Color(stops[stops.length - 1].color);
}

// default gradient — same blackbody-inspired look as before, now expressed
// as color stops so it's fully tweakable
const DEFAULT_COLOR_STOPS = [
  { stop: 0.0, color: '#ffffff' },
  { stop: 0.25, color: '#ffe9b0' },
  { stop: 0.55, color: '#ffab4d' },
  { stop: 0.8, color: '#ff6a2e' },
  { stop: 1.0, color: '#8a2a12' },
];

// ---------------------------------------------------------------------------
// Procedural disk texture — layered turbulent noise for real plasma-like
// detail, kept at a low enough base frequency to avoid moiré at grazing
// angles. Exported so BlackHoleLensPass can reuse the exact same texture for
// the lensed image right at the photon sphere, keeping the two visually
// consistent instead of looking like two different disks stitched together.
// ---------------------------------------------------------------------------
export function makeDiskTexture(options = {}) {
  const size = options.size ?? 1536;
  const colorStops = [...(options.colorStops ?? DEFAULT_COLOR_STOPS)].sort((a, b) => a.stop - b.stop);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  const innerCut = 0.30;

  const noise = makeAngularNoise(48);
  const fineNoise = makeAngularNoise(120);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const angle = Math.atan2(dy, dx);
      const angleFrac = angle / (2 * Math.PI) + 0.5; // 0..1
      const idx = (y * size + x) * 4;

      if (r > 1.0 || r < innerCut) { data[idx + 3] = 0; continue; }

      const t = (r - innerCut) / (1 - innerCut);

      // slow angular drift so the turbulence spirals outward like real
      // differential rotation, rather than sitting in fixed radial spokes
      const spiralAngle = angleFrac + r * 0.6;
      const turbulence = noise(spiralAngle, t, 4);
      const fineDetail = fineNoise(spiralAngle * 1.7, t, 3);
      const band = turbulence * 0.7 + fineDetail * 0.3;

      const col = sampleGradient(colorStops, t);
      const brightness = Math.pow(1 - t, 1.6) * (0.55 + 0.7 * band);
      const alpha = Math.min(1, brightness * 1.3) * (1 - Math.pow(t, 3));

      data[idx] = Math.floor(col.r * 255);
      data[idx + 1] = Math.floor(col.g * 255);
      data[idx + 2] = Math.floor(col.b * 255);
      data[idx + 3] = Math.floor(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16; // clamped to the GPU's real max automatically
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Doppler-beaming shader — same physics as before, but now applied to a
// normal mesh so it benefits from proper filtering. Per-pixel math like this
// doesn't alias the way a dense texture pattern does, so it's safe to keep.
// ---------------------------------------------------------------------------
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = `
  uniform sampler2D map;
  uniform vec3 cameraPos;
  uniform vec3 diskCenter;
  uniform vec3 diskNormal;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vec4 texColor = texture2D(map, vUv);
    if (texColor.a < 0.02) discard;

    vec3 radial = normalize(vWorldPos - diskCenter);
    vec3 tangent = normalize(cross(diskNormal, radial));
    vec3 toCam = normalize(cameraPos - vWorldPos);

    float approach = dot(tangent, toCam);
    float beaming = 1.0 + approach * 0.9;

    vec3 color = texColor.rgb * beaming;
    color.b *= 1.0 + max(approach, 0.0) * 0.35;
    color.r *= 1.0 + max(-approach, 0.0) * 0.20;

    gl_FragColor = vec4(max(color, 0.0), texColor.a);
  }
`;

export class AccretionDisk {
  constructor(options = {}) {
    this.params = {
      innerRadius: options.innerRadius ?? 12,
      outerRadius: options.outerRadius ?? 30,
      tiltDeg: options.tiltDeg ?? 72,
      spinSpeed: options.spinSpeed ?? 0.15,
    };

    this.texture = options.texture ?? makeDiskTexture({
      size: options.textureSize ?? 1536,
      colorStops: options.colorStops ?? DEFAULT_COLOR_STOPS,
    });

    const geo = new THREE.RingGeometry(this.params.innerRadius, this.params.outerRadius, 200, 1);
    const uvAttr = geo.attributes.uv;
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), y = posAttr.getY(i);
      const u = 0.5 + x / (this.params.outerRadius * 2);
      const v = 0.5 + y / (this.params.outerRadius * 2);
      uvAttr.setXY(i, u, v);
    }
    uvAttr.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        cameraPos: { value: new THREE.Vector3() },
        diskCenter: { value: new THREE.Vector3() },
        diskNormal: { value: new THREE.Vector3(0, 0, 1) },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(this.params.tiltDeg);

    if (options.position) {
      this.mesh.position.set(options.position.x ?? 0, options.position.y ?? 0, options.position.z ?? 0);
    }

    this._tmpQuat = new THREE.Quaternion();
    this._tmpNormal = new THREE.Vector3();
  }

  /** Call every frame. */
  update(dt, camera) {
    this.mesh.rotation.z += dt * this.params.spinSpeed;

    if (camera) {
      this.material.uniforms.cameraPos.value.copy(camera.position);
      this.mesh.getWorldPosition(this.material.uniforms.diskCenter.value);
      this.mesh.getWorldQuaternion(this._tmpQuat);
      this._tmpNormal.set(0, 0, 1).applyQuaternion(this._tmpQuat);
      this.material.uniforms.diskNormal.value.copy(this._tmpNormal);
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

export function createAccretionDisk(options) {
  return new AccretionDisk(options);
}