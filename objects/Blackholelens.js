// BlackHoleLens.js
// -----------------------------------------------------------------------------
// A real Schwarzschild gravitational-lensing black hole, rendered by
// integrating the actual null-geodesic equation per pixel in a fragment
// shader — not a faked ring sprite. No particle systems anywhere.
//
// PHYSICS (Schwarzschild, geometric units G = c = 1, rs = 2M):
//   - Photon trajectories are planar (angular momentum is conserved), so each
//     ray can be tracked with a single angle phi in its own orbital plane.
//   - Using u = 1/r, the null geodesic equation reduces to the clean 2nd-order
//     ODE:            d^2u/dphi^2 = -u + (3/2) * rs * u^2
//     The "-u" term alone is flat-space (straight line); the "(3/2) rs u^2"
//     term is exactly the general-relativistic correction that bends light.
//   - Event horizon:  r = rs        (photon absorbed)
//   - Photon sphere:  r = 1.5 * rs  (unstable circular photon orbit — this is
//     what makes the photon ring / disk's "double image" possible)
//   - ISCO (inner edge of a real accretion disk): r = 3 * rs
//
// We RK4-integrate that ODE per-pixel, walking the photon backwards from the
// camera. If it crosses the (tilted) disk plane within [diskInner, diskOuter],
// we sample a texture there (with gravitational redshift + Doppler beaming).
// If r drops below the analytic critical impact parameter, the pixel is
// black (absorbed). No starfield — background is plain space.
//
// DEPTH-AWARE OCCLUSION: this pass has no knowledge of real scene geometry
// (station hulls, ships, etc.) unless we give it one. It's given the scene's
// depth texture (tDepth) and, for every pixel, compares how far along that
// camera ray the nearest real surface sits against how far along that same
// ray the black hole itself sits. If the real surface is nearer, the pixel
// is left untouched — this is what lets solid objects correctly occlude the
// black hole instead of it "punching through" everything in front of it.
//
// Usage:
//   import { BlackHoleLensPass } from './BlackHoleLens.js';
//   const composer = new EffectComposer(renderer);
//   composer.addPass(new RenderPass(scene, camera));
//   const lens = new BlackHoleLensPass(camera, { position: {x:0,y:0,z:0}, radius: 4 });
//   composer.addPass(lens);
//   lens.setDepthTexture(depthRenderTarget.depthTexture); // REQUIRED for occlusion
//   // per frame:
//   lens.update(dt);
//   // tweak any time:
//   lens.params.radius = 6;
//   lens.params.position.set(10, 0, 0);
// -----------------------------------------------------------------------------

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeDiskTexture } from './AccretionDisk.js';

// ---------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tDisk;
  uniform sampler2D tDepth;

  uniform vec3 bhPosition;
  uniform float rs;             // Schwarzschild radius — this IS the black hole's "size"
  uniform float diskInner;
  uniform float diskOuter;
  uniform vec3 diskNormal;
  uniform vec3 diskTangentU;
  uniform vec3 diskTangentV;
  uniform float diskRotation;

  uniform vec3 cameraPos;
  uniform mat4 viewMatrixInverse;
  uniform mat4 projectionMatrixInverse;
  uniform float cameraNear;
  uniform float cameraFar;

  uniform int steps;
  uniform float escapeRadius;
  uniform vec2 resolution;
  uniform int aaSamples;
  uniform float lensRadius;     // extent of the ray-marched zone around the hole (independent of disk size)

  varying vec2 vUv;

  const float PI = 3.14159265359;

  // Converts a non-linear depth-buffer value (0..1) into a linear
  // eye-space distance along the camera's forward axis (in world units).
  float linearEyeDepth(float depth) {
    float z = depth * 2.0 - 1.0;
    return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
  }

  vec3 traceSample(vec2 uv) {
    // reconstruct this pixel's camera ray in world space
    vec4 ndc = vec4(uv * 2.0 - 1.0, -1.0, 1.0);
    vec4 viewP = projectionMatrixInverse * ndc;
    viewP = vec4(viewP.xy, -1.0, 0.0);
    vec3 rayDir = normalize((viewMatrixInverse * viewP).xyz);
    vec3 rayOrigin = cameraPos;

    vec3 rel = rayOrigin - bhPosition;
    float r0 = length(rel);

    vec3 Lvec = cross(rel, rayDir);
    float b = length(Lvec); // impact parameter (rayDir is unit length)

    float influenceRadius = lensRadius;

    // Rays that never pass near the hole at all: skip everything
    if (b > influenceRadius) {
      return texture2D(tDiffuse, uv).rgb;
    }

    // ---- depth-aware occlusion (ray-sphere entry point) ----
    // Find exactly where this ray enters the lensing sphere (radius =
    // lensRadius, centered on the hole). Only trust real scene geometry as
    // an occluder if it's nearer than that entry point — this is correct
    // for ANY ray direction, unlike a naive "closest approach" comparison,
    // which breaks down for rays that aren't pointing straight at the hole
    // (e.g. rays hitting nearby station geometry off to the side).
    float bDot = dot(rel, rayDir);
    float cTerm = dot(rel, rel) - influenceRadius * influenceRadius;
    float disc = bDot * bDot - cTerm;
    float tEnter = 0.0;
    if (disc > 0.0) {
      tEnter = max(-bDot - sqrt(disc), 0.0);
    }

    float rawDepth = texture2D(tDepth, uv).x;
    if (rawDepth < 0.9999) {
      vec3 camForward = normalize((viewMatrixInverse * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
      float cosAngle = max(dot(rayDir, camForward), 1e-4);
      float sceneDist = linearEyeDepth(rawDepth) / cosAngle;
      if (sceneDist < tEnter) {
        return texture2D(tDiffuse, uv).rgb;
      }
    }

    vec3 n = Lvec;
    float nlen = length(n);
    if (nlen < 1e-5) {
      return texture2D(tDiffuse, uv).rgb;
    }
    n /= nlen;
    vec3 e1 = rel / max(r0, 1e-5);
    vec3 e2 = normalize(cross(n, e1));

    float dirR = dot(rayDir, e1);
    float dirT = dot(rayDir, e2);

    float u = 1.0 / r0;
    float dudphi = (abs(dirT) > 1e-6) ? (-dirR / (r0 * dirT)) : 0.0;
    float phi = 0.0;
    const float baseDphi = 0.02;

    vec3 pos = bhPosition + r0 * (cos(phi) * e1 + sin(phi) * e2);
    vec3 prevPos = pos;
    float hPrev = dot(pos - bhPosition, diskNormal);

    vec3 accumColor = vec3(0.0);
    float accumAlpha = 0.0;

    for (int i = 0; i < 500; i++) {
      if (i >= steps) break;
      if (accumAlpha > 0.98) break;

      prevPos = pos;
      float r = 1.0 / max(u, 1e-6);
      float stepScale = clamp(r / (rs * 3.0), 0.15, 6.0);
      float h = baseDphi * stepScale;

      // RK4 integration of d^2u/dphi^2 = -u + 1.5 * rs * u^2
      float k1u = dudphi;
      float k1v = -u + 1.5 * rs * u * u;

      float u2 = u + 0.5 * h * k1u;
      float v2 = dudphi + 0.5 * h * k1v;
      float k2u = v2;
      float k2v = -u2 + 1.5 * rs * u2 * u2;

      float u3 = u + 0.5 * h * k2u;
      float v3 = dudphi + 0.5 * h * k2v;
      float k3u = v3;
      float k3v = -u3 + 1.5 * rs * u3 * u3;

      float u4 = u + h * k3u;
      float v4 = dudphi + h * k3v;
      float k4u = v4;
      float k4v = -u4 + 1.5 * rs * u4 * u4;

      u = u + (h / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
      dudphi = dudphi + (h / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
      phi += h;

      r = 1.0 / max(u, 1e-6);

      pos = bhPosition + r * (cos(phi) * e1 + sin(phi) * e2);

      if (u <= 0.0 || r > escapeRadius) {
        break; // escaped to open space — background is plain black now
      }

      if (r <= rs) {
        break; // absorbed
      }

      float hNow = dot(pos - bhPosition, diskNormal);

      if (sign(hNow) != sign(hPrev) && r >= diskInner && r <= diskOuter) {
        // interpolate the exact point where the ray crossed the disk plane
        // (rather than the coarse post-step position) — this is what removes
        // the streaky/speckled noise in the wrapped disk image, since the
        // sampled UV no longer jumps in step-sized increments.
        float denom = hPrev - hNow;
        float frac = (abs(denom) > 1e-6) ? clamp(hPrev / denom, 0.0, 1.0) : 0.0;
        vec3 crossPos = mix(prevPos, pos, frac);
        float rCross = length(crossPos - bhPosition);

        float lu = dot(crossPos - bhPosition, diskTangentU);
        float lv = dot(crossPos - bhPosition, diskTangentV);

        float ca = cos(diskRotation), sa = sin(diskRotation);
        float lu2 = lu * ca - lv * sa;
        float lv2 = lu * sa + lv * ca;

        vec2 duv = vec2(0.5 + lu2 / (diskOuter * 2.0), 0.5 + lv2 / (diskOuter * 2.0));
        vec4 diskSample = texture2D(tDisk, duv);

        if (diskSample.a > 0.01) {
          // gravitational redshift (static-emitter approximation)
          float redshift = sqrt(max(1.0 - rs / rCross, 0.02));

          // approximate Doppler beaming from orbital motion direction
          vec3 orbitDir = normalize(-sin(phi) * e1 + cos(phi) * e2);
          float approach = dot(orbitDir, -rayDir);
          float beaming = 1.0 + approach * 0.6;

          vec3 c = diskSample.rgb * redshift * beaming;
          accumColor += (1.0 - accumAlpha) * c * diskSample.a;
          accumAlpha += (1.0 - accumAlpha) * diskSample.a;
        }
      }
      hPrev = hNow;
    }

    // Background is plain space now — no starfield. Everything not on the
    // disk and not inside the analytic capture boundary is simply black,
    // same as the captured region; the disk is the only source of light.
    vec3 background = vec3(0.0);

    vec3 result = accumColor + (1.0 - accumAlpha) * background;

    // smooth seam between the GR-marched region and the normal scene render.
    // smoothstep requires edge0 < edge1 — passing them reversed is undefined
    // behavior in GLSL and was the direct cause of the shattered background.
    float tt = smoothstep(influenceRadius * 0.6, influenceRadius, b);
    float blend = 1.0 - tt; // 1 = full GR result near the hole, 0 = plain scene far away
    vec3 sceneColor = texture2D(tDiffuse, uv).rgb;
    return mix(sceneColor, result, blend);
  }

  void main() {
    // The hole's silhouette, photon ring, and disk edge are all computed
    // per-pixel in this shader rather than from real geometry, so hardware
    // MSAA (which only smooths rasterized triangle edges) can't help here.
    // A small rotated-grid supersample fixes the jaggies on those edges.
    vec2 texel = 1.0 / resolution;
    vec2 offsets[4];
    offsets[0] = vec2(0.25, 0.25);
    offsets[1] = vec2(-0.25, 0.25);
    offsets[2] = vec2(0.25, -0.25);
    offsets[3] = vec2(-0.25, -0.25);

    vec3 color = vec3(0.0);
    int n = clamp(aaSamples, 1, 4);
    for (int s = 0; s < 4; s++) {
      if (s >= n) break;
      color += traceSample(vUv + offsets[s] * texel);
    }
    color /= float(n);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// BlackHoleLensPass — the tweakable object
// ---------------------------------------------------------------------------

export class BlackHoleLensPass extends Pass {
  constructor(camera, options = {}) {
    super();
    this.camera = camera;

    // CONFIG — every tweakable value in one place.
    // `position` and `radius` control where the hole sits and how big it is.
    this.params = {
      position: new THREE.Vector3(
        options.position?.x ?? 0,
        options.position?.y ?? 0,
        options.position?.z ?? 0
      ),
      radius: options.radius ?? 4,           // Schwarzschild radius (rs) — the size knob
      diskInner: options.diskInner ?? 12,     // keep >= 3*radius for a physically-motivated ISCO
      diskOuter: options.diskOuter ?? 30,
      diskTiltDeg: options.diskTiltDeg ?? 72,
      diskSpin: options.diskSpin ?? 0.15,     // radians/sec, visual swirl speed
      steps: options.steps ?? 180,             // integration quality vs. performance
      escapeRadius: options.escapeRadius ?? 4000,
      lensRadius: options.lensRadius ?? (options.radius ?? 4) * 15, // how far out the ray-march zone reaches
      aaSamples: options.aaSamples ?? 2, // supersamples for the hard edges (1-4)
    };

    this._diskRotation = 0;

    // Reuse the accretion disk's own texture if one was passed in, so the
    // lensed image right at the photon sphere matches the directly-rendered
    // disk mesh instead of looking like a second, different disk.
    this.diskTexture = options.diskTexture ?? makeDiskTexture();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDisk: { value: this.diskTexture },
        tDepth: { value: null }, // set via setDepthTexture() before rendering
        bhPosition: { value: this.params.position.clone() },
        rs: { value: this.params.radius },
        diskInner: { value: this.params.diskInner },
        diskOuter: { value: this.params.diskOuter },
        diskNormal: { value: new THREE.Vector3(0, 1, 0) },
        diskTangentU: { value: new THREE.Vector3(1, 0, 0) },
        diskTangentV: { value: new THREE.Vector3(0, 0, 1) },
        diskRotation: { value: 0 },
        cameraPos: { value: new THREE.Vector3() },
        viewMatrixInverse: { value: new THREE.Matrix4() },
        projectionMatrixInverse: { value: new THREE.Matrix4() },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
        steps: { value: this.params.steps },
        escapeRadius: { value: this.params.escapeRadius },
        lensRadius: { value: this.params.lensRadius },
        resolution: { value: new THREE.Vector2(1, 1) },
        aaSamples: { value: this.params.aaSamples },
      },
      vertexShader,
      fragmentShader,
    });

    this.fsQuad = new FullScreenQuad(this.material);
    this._updateDiskBasis();
  }

  /**
   * Wire up the scene's depth texture so the lensing pass can tell when
   * real geometry (a station hull, a ship, etc.) is occluding the black
   * hole. Without calling this, tDepth stays null and every pixel will be
   * treated as "nothing is in front of the hole" — i.e. the old behavior
   * where the hole renders through solid objects.
   */
  setDepthTexture(depthTexture) {
    this.material.uniforms.tDepth.value = depthTexture;
  }

  _updateDiskBasis() {
    const tiltRad = THREE.MathUtils.degToRad(this.params.diskTiltDeg);
    const normal = new THREE.Vector3(0, Math.cos(tiltRad), Math.sin(tiltRad)).normalize();
    const tangentU = new THREE.Vector3(1, 0, 0);
    const tangentV = new THREE.Vector3().crossVectors(normal, tangentU).normalize();
    this.material.uniforms.diskNormal.value.copy(normal);
    this.material.uniforms.diskTangentU.value.copy(tangentU);
    this.material.uniforms.diskTangentV.value.copy(tangentV);
  }

  /** Call once per frame, before render(). */
  update(dt) {
    this._diskRotation += dt * this.params.diskSpin;
    this.material.uniforms.diskRotation.value = this._diskRotation;
    this._updateDiskBasis();
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.cameraPos.value.copy(this.camera.position);
    u.viewMatrixInverse.value.copy(this.camera.matrixWorld);
    u.projectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse);
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    u.bhPosition.value.copy(this.params.position);
    u.rs.value = this.params.radius;
    u.diskInner.value = this.params.diskInner;
    u.diskOuter.value = this.params.diskOuter;
    u.steps.value = this.params.steps;
    u.escapeRadius.value = this.params.escapeRadius;
    u.lensRadius.value = this.params.lensRadius;
    u.aaSamples.value = this.params.aaSamples;
    u.resolution.value.set(readBuffer.width, readBuffer.height);

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
    this.diskTexture.dispose();
  }
}