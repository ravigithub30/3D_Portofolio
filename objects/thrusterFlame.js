/**
 * ThrusterFlame.js
 * -------------------------------------------------------------
 * A rocket-engine "thruster" object for Three.js: a nozzle ring
 * + an animated, glowing exhaust flame (shader-based turbulence,
 * additive blending, blue-white plasma look) plus a bright glow
 * disc at the exit — similar to the reference render.
 *
 * The flame shoots out along the group's local -Z axis — position
 * or rotate it to point wherever you need (e.g. the back of a ship).
 *
 * ---- Option A: drop-in, matches `addSpaceXxx(scene)` modules ----
 * Adds itself to the scene and animates itself — nothing else to wire up.
 *
 *   import { createThruster } from './objects/thrusterFlame.js';
 *
 *   createThruster(scene, {
 *     position: { x: 0, y: 0, z: -3 },
 *     rotation: { x: 0, y: Math.PI, z: 0 },
 *     nozzleRadius: 0.5,
 *     flameLength: 4,
 *   }).catch((err) => console.error('createThruster did not load:', err));
 *
 * If you need to change throttle later, capture the returned handle:
 *
 *   const thruster = await createThruster(scene, { ... });
 *   thruster.setThrottle(0.3); // e.g. idle vs full burn
 *
 * ---- Option B: manual control ----
 * Build it yourself and drive the update loop (e.g. if you already
 * have a central animate() loop you want it synced to):
 *
 *   import { buildThruster } from './objects/thrusterFlame.js';
 *   const thruster = buildThruster({ nozzleRadius: 0.5, flameLength: 4 });
 *   scene.add(thruster.group);
 *   // in your render loop:
 *   thruster.update(elapsedTime, throttle); // throttle: 0..1
 * -------------------------------------------------------------
 */

import * as THREE from "three";

// ---------- Flame shaders ----------

const flameVertex = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  uniform float uTurbulence;

  varying vec2 vUv;
  varying float vNoise;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
  }

  void main() {
    vUv = uv;

    // v = 0 at the nozzle (wide base), v = 1 at the flame tip.
    float n = noise1(uv.x * 8.0 + uTime * 6.0) * noise1(uv.y * 5.0 - uTime * 4.0);
    vNoise = n;

    // radial jitter grows toward the tip so the flame whips/tapers unevenly
    float wobble = (n - 0.5) * uTurbulence * pow(uv.y, 1.6) * uThrottle;

    vec3 pos = position;
    vec2 radial = normalize(pos.xz + 1e-5);
    pos.xz += radial * wobble;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const flameFragment = /* glsl */ `
  uniform vec3  uCoreColor;
  uniform vec3  uOuterColor;
  uniform float uThrottle;

  varying vec2 vUv;
  varying float vNoise;

  void main() {
    // v: 0 at nozzle exit, 1 at flame tip
    float v = vUv.y;

    vec3 color = mix(uCoreColor, uOuterColor, smoothstep(0.0, 1.0, v));

    // brightest and most opaque near the nozzle, fading + flickering toward the tip
    float fade = 1.0 - smoothstep(0.55, 1.0, v);
    float flicker = mix(0.7, 1.0, vNoise);
    float alpha = fade * flicker * uThrottle;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ---------- Builder ----------

/**
 * @param {Object} opts
 * @param {number} [opts.nozzleRadius=0.5]   radius of the nozzle exit / flame base
 * @param {number} [opts.nozzleLength=0.9]   length of the nozzle body along Z
 * @param {number} [opts.flameLength=4]      length of the exhaust flame
 * @param {number} [opts.coreColor=0xdfefff] bright color at the nozzle
 * @param {number} [opts.outerColor=0x2b3dff]color toward the flame tip
 * @param {number} [opts.metalColor=0xaaaaaa]nozzle body color
 * @param {number} [opts.turbulence=0.18]    how much the flame wobbles
 */
export function buildThruster(opts = {}) {
  const {
    nozzleRadius = 0.5,
    nozzleLength = 0.9,
    flameLength = 4,
    coreColor = 0xdfefff,
    outerColor = 0x2b3dff,
    metalColor = 0xaaaaaa,
    turbulence = 0.18,
  } = opts;

  const group = new THREE.Group();

  // ---- Nozzle body (simple ribbed cylinder) ----
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: metalColor,
    metalness: 0.6,
    roughness: 0.4,
  });
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(nozzleRadius * 1.15, nozzleRadius, nozzleLength, 32, 1, true),
    nozzleMat
  );
  nozzle.rotation.x = Math.PI / 2; // align cylinder axis with Z
  nozzle.position.z = nozzleLength / 2;
  group.add(nozzle);

  // ---- Inner glow ring at the exit ----
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(nozzleRadius * 0.55, nozzleRadius * 0.95, 32),
    new THREE.MeshBasicMaterial({ color: coreColor, side: THREE.DoubleSide })
  );
  group.add(ring); // sits at z = 0, facing -Z by default rotation adjustment below
  ring.rotation.y = Math.PI; // face outward toward -Z

  // ---- Flame (shader cone) ----
  const flameGeo = new THREE.ConeGeometry(nozzleRadius, flameLength, 24, 32, true);
  // ConeGeometry: apex at +Y, base at -Y, uv.v = 0 at base -> 1 at apex.
  flameGeo.rotateX(-Math.PI / 2); // apex now points toward -Z, base at Z=0

  const flameMat = new THREE.ShaderMaterial({
    vertexShader: flameVertex,
    fragmentShader: flameFragment,
    uniforms: {
      uTime: { value: 0 },
      uThrottle: { value: 1 },
      uTurbulence: { value: turbulence },
      uCoreColor: { value: new THREE.Color(coreColor) },
      uOuterColor: { value: new THREE.Color(outerColor) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  group.add(flame);

  // ---- Bright glow sprite at the exit ----
  const glowTexture = makeRadialGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture,
    color: coreColor,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(nozzleRadius * 3.2);
  group.add(glow);

  /**
   * Call every frame.
   * @param {number} time elapsed seconds
   * @param {number} throttle 0..1, scales flame length/brightness
   */
  function update(time, throttle = 1) {
    const t = THREE.MathUtils.clamp(throttle, 0, 1);
    flameMat.uniforms.uTime.value = time;
    flameMat.uniforms.uThrottle.value = t;

    // subtle pulsing length + brightness with throttle
    const pulse = 1 + 0.04 * Math.sin(time * 20.0);
    flame.scale.set(1, 1, (0.4 + 0.6 * t) * pulse);

    glow.material.opacity = 0.6 + 0.4 * t * (0.85 + 0.15 * Math.sin(time * 30.0));
    glow.scale.setScalar(nozzleRadius * (2.6 + 1.2 * t));
  }

  return { group, update, flame, nozzle, glow, ring };
}

/**
 * Matches the `addSpaceXxx(scene)` convention used by the rest of the
 * project (called as `createThruster(scene).catch(...)`): builds the
 * thruster, adds it to the scene, and drives its own animation loop
 * internally so nothing else needs to call `.update()` by hand.
 *
 * @param {THREE.Scene} scene
 * @param {Object} [opts]              same options as buildThruster(), plus:
 * @param {THREE.Vector3|{x,y,z}} [opts.position]
 * @param {THREE.Euler|{x,y,z}}   [opts.rotation]   radians
 * @param {number} [opts.throttle=1]   0..1, held constant unless you use the
 *                                     returned handle to change it yourself
 * @returns {Promise<{group, update, flame, nozzle, glow, ring, setThrottle}>}
 */
export async function createThruster(scene, opts = {}) {
  const thruster = buildThruster(opts);

  if (opts.position) {
    thruster.group.position.set(opts.position.x ?? 0, opts.position.y ?? 0, opts.position.z ?? 0);
  }
  if (opts.rotation) {
    thruster.group.rotation.set(opts.rotation.x ?? 0, opts.rotation.y ?? 0, opts.rotation.z ?? 0);
  }

  scene.add(thruster.group);

  let throttle = opts.throttle ?? 1;
  thruster.setThrottle = (v) => { throttle = THREE.MathUtils.clamp(v, 0, 1); };

  const clock = new THREE.Clock();
  function loop() {
    requestAnimationFrame(loop);
    thruster.update(clock.getElapsedTime(), throttle);
  }
  loop();

  return thruster;
}

function makeRadialGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}