// objects/spaceBlackHole.js
// -----------------------------------------------------------------------------
// The REAL gravitational-lensing black hole (same physics/shader as
// blackhole.html — BlackHoleLens.js's RK4 Schwarzschild geodesic integrator)
// wrapped to match your addSpaceX(scene, options) module pattern.
//
// One structural note, since this differs from your other object modules:
// the lensing effect is a full-screen POST-PROCESS PASS, not a mesh, so it
// can't just be "added to the scene" the way a mesh can. This factory adds
// the accretion disk mesh to your scene directly (like your other modules),
// but also returns a `lensPass` that YOU must add to your EffectComposer:
//
//   const blackHole = addSpaceBlackHole(scene, camera, { position: {x:0,y:0,z:-50}, radius: 20 });
//   composer.addPass(blackHole.lensPass);   // after RenderPass, before bloom
//   // inside animate():
//   blackHole.update(delta, camera);
//
// Depth occlusion (so solid objects correctly hide the hole) is automatic
// as long as your EffectComposer's render target has a depthTexture — see
// the usage example at the top of BlackHoleLens.js.
//
// Every parameter below is tweakable — either edit CONFIG directly, or pass
// an options object into addSpaceBlackHole(), or mutate the returned
// blackHole.disk.params / blackHole.lensPass.params live at any time.
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { createAccretionDisk } from './AccretionDisk.js';
import { BlackHoleLensPass } from './BlackHoleLens.js';

// ================== CONFIG — every tweakable value lives here ==================
const CONFIG = {
  position: { x: 0, y: 0, z: -50 },
  radius: 20, // Schwarzschild radius (rs) — the "size / mass" knob

  disk: {
    innerRadius: 26,   // ~1.3x radius; real ISCO is 3x radius if you want it physically strict
    outerRadius: 70,
    tiltDeg: 72,
    spinSpeed: 0.15,
    textureSize: 1536,
    // Any number of stops, in any order — sorted automatically by `stop`.
    colorStops: [
      { stop: 0.0, color: '#ffffff' },
      { stop: 0.25, color: '#ffe9b0' },
      { stop: 0.55, color: '#ffab4d' },
      { stop: 0.8, color: '#ff6a2e' },
      { stop: 1.0, color: '#8a2a12' },
    ],
  },

  lens: {
    lensRadius: null,     // ray-march extent; defaults to radius * 15 if left null
    steps: 180,            // integration quality (higher = smoother, slower)
    aaSamples: 2,          // 1-4, antialiasing on the horizon/photon-ring edges
    escapeRadius: 4000,
  },
};

export function addSpaceBlackHole(scene, camera, options = {}) {
  const cfg = {
    ...CONFIG,
    ...options,
    disk: { ...CONFIG.disk, ...(options.disk ?? {}) },
    lens: { ...CONFIG.lens, ...(options.lens ?? {}) },
  };

  // --- accretion disk: real mesh, added straight to the scene ---
  const disk = createAccretionDisk({
    position: cfg.position,
    innerRadius: cfg.disk.innerRadius,
    outerRadius: cfg.disk.outerRadius,
    tiltDeg: cfg.disk.tiltDeg,
    spinSpeed: cfg.disk.spinSpeed,
    textureSize: cfg.disk.textureSize,
    colorStops: cfg.disk.colorStops,
  });
  scene.add(disk.mesh);

  // --- lensing pass: shares the disk's own texture so the wrapped image
  //     right at the photon sphere matches the disk mesh seamlessly ---
  const lensPass = new BlackHoleLensPass(camera, {
    position: cfg.position,
    radius: cfg.radius,
    diskInner: cfg.disk.innerRadius,
    diskOuter: cfg.disk.outerRadius,
    diskTiltDeg: cfg.disk.tiltDeg,
    diskSpin: cfg.disk.spinSpeed,
    diskTexture: disk.texture,
    lensRadius: cfg.lens.lensRadius ?? cfg.radius * 15,
    steps: cfg.lens.steps,
    aaSamples: cfg.lens.aaSamples,
    escapeRadius: cfg.lens.escapeRadius,
  });

  // Remember the "real" lensing extent so it can be restored once the hole
  // comes back into view — lensPass.params.lensRadius gets zeroed while
  // off-screen (see the visibility check in update() below).
  const fullLensRadius = lensPass.params.lensRadius;

  // Two SEPARATE cull spheres, sized to what they actually gate:
  //   - lensCullSphere: just the ray-march zone (fullLensRadius). This is
  //     the one that matters for the "black spot" bug — it needs to be
  //     small enough that the camera can genuinely be outside it.
  //   - diskCullSphere: the disk mesh's real visible extent (outerRadius),
  //     which is normally much bigger (the disk is meant to be visible from
  //     far away) and should NOT share a sphere with the tight lens zone —
  //     doing that made the sphere so large the camera sat inside it
  //     permanently, which is exactly why culling never triggered before.
  const _frustum = new THREE.Frustum();
  const _viewProjMatrix = new THREE.Matrix4();
  const _lensCullSphere = new THREE.Sphere(new THREE.Vector3(), fullLensRadius);
  const _diskCullSphere = new THREE.Sphere(new THREE.Vector3(), cfg.disk.outerRadius);

  return {
    disk,       // disk.mesh, disk.texture. disk.params.tiltDeg / .spinSpeed are live (this
                // wrapper's update() keeps the lensing pass in sync with them automatically).
                // Move the hole with disk.mesh.position.set(...) — also auto-synced.
                // innerRadius/outerRadius/colorStops are baked into geometry/texture at
                // creation — pass new values via options and recreate to resize.
    lensPass,   // lensPass.params.radius/diskInner/diskOuter/lensRadius/steps/aaSamples are
                // ALL live — mutate any of them any time, e.g. blackHole.lensPass.params.radius = 30;
                // NOTE: lensRadius is overwritten every frame by the off-screen culling in
                // update() below (0 when off-screen, restored to its configured value when
                // back on screen) — to change the "on-screen" extent permanently, set
                // options.lens.lensRadius at creation time rather than poking .params later.

    /** Call every frame: blackHole.update(delta, camera) — delta, not totalTime */
    update(delta, camera) {
      // Keep the disk mesh and the lensing pass in sync every frame, so
      // tweaking disk.params live (tilt, spin) or moving disk.mesh doesn't
      // silently desync the visual disk from the physics that bends light
      // around it.
      disk.mesh.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(disk.params.tiltDeg);
      lensPass.params.diskTiltDeg = disk.params.tiltDeg;
      lensPass.params.diskSpin = disk.params.spinSpeed;
      lensPass.params.position.copy(disk.mesh.position);

      // Off-screen culling: the shader's own impact-parameter check only
      // measures perpendicular distance from the camera's infinite view
      // line to the hole — it has no idea whether the hole is actually in
      // front of the camera or behind it. A hole directly behind you can
      // still land within that check and pay full ray-march cost on every
      // pixel. A real frustum test catches that (and simple off-to-the-side
      // cases) directly: when the ray-march zone doesn't intersect what the
      // camera can actually see, drop lensRadius to 0 so the shader's cheap
      // early-out fires everywhere. The disk mesh gets its own, separately
      // sized test, since it's normally visible from much farther away than
      // the tight lens zone is.
      camera.updateMatrixWorld();
      _viewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_viewProjMatrix);

      _lensCullSphere.center.copy(disk.mesh.position);
      const lensOnScreen = _frustum.intersectsSphere(_lensCullSphere);
      lensPass.params.lensRadius = lensOnScreen ? fullLensRadius : 0;

      _diskCullSphere.center.copy(disk.mesh.position);
      disk.mesh.visible = _frustum.intersectsSphere(_diskCullSphere);

      disk.update(delta, camera);
      lensPass.update(delta);
    },

    dispose() {
      disk.dispose();
      lensPass.dispose();
    },
  };
}