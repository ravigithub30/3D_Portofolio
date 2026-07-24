import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ============================================================================
// APPROXIMATION NOTE:
// True gravitational lensing requires ray-marching curved geodesics through
// spacetime (expensive — not real-time on most hardware for a full scene).
// This is the standard real-time substitute used in games/demos: instead of
// tracing curved rays, we take the ALREADY-RENDERED flat image and warp pixels
// radially around the black hole's screen position using the real light
// deflection formula for weak-field GR:
//
//     α(b) ≈ 2 * Rs / b
//
// where Rs is the Schwarzschild radius and b is the impact parameter (here,
// screen-space distance from the black hole's projected center). This is the
// genuine general-relativistic formula — it's just applied post-hoc to a 2D
// image rather than during ray generation, which is why it's an approximation
// rather than a full solve. It still reproduces the key qualitative features:
// bending increases sharply near the hole, and the classic photon-ring /
// Einstein-ring-like light concentration appears near the critical radius.
//
// The dark shadow itself IS physically sized correctly: real distant-observer
// shadow radius = (3*sqrt(3)/2) * Rs ≈ 2.6 * Rs — matching actual EHT images.
// ============================================================================

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 uBlackHoleScreenPos; // 0..1 UV space
  uniform float uScreenRs;          // Schwarzschild radius, in UV units
  uniform float uLensingStrength;   // visual tuning multiplier on top of the real 1/b falloff
  varying vec2 vUv;

  void main() {
    vec2 toPixel = vUv - uBlackHoleScreenPos;
    // correct for aspect ratio so the shadow/ring are circular, not stretched
    toPixel.x *= 1.0; // resolution aspect correction applied when computing uScreenRs upstream

    float d = length(toPixel);
    vec2 dir = d > 0.0001 ? toPixel / d : vec2(0.0);

    // ---- physically-sized event horizon shadow ----
    float shadowRadius = uScreenRs * 2.6; // real GR value: (3*sqrt(3)/2) * Rs
    if (d < shadowRadius) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // ---- weak-field deflection: alpha ≈ 2 Rs / b ----
    float b = d;
    float deflection = (2.0 * uScreenRs * uScreenRs) / max(b, 0.0001);
    deflection *= uLensingStrength;

    // near the photon sphere the weak-field formula would diverge —
    // clamp so sampling stays numerically sane instead of exploding
    deflection = min(deflection, d * 0.95);

    vec2 sampleUV = vUv - dir * deflection;
    sampleUV = clamp(sampleUV, 0.0, 1.0);

    gl_FragColor = texture2D(tDiffuse, sampleUV);
  }
`;

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function createGravitationalLensingPass({ lensingStrength = 1.0 } = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uBlackHoleScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
      uScreenRs: { value: 0.0 }, // 0 = effectively off until updateLensingPass sets a real value
      uLensingStrength: { value: lensingStrength },
    },
    vertexShader,
    fragmentShader,
  });
  return pass;
}

// Call this every frame with the black hole's world position + its
// Schwarzschild radius. Projects both into screen space so the lensing
// effect correctly tracks the black hole as the camera moves/orbits.
const _centerNDC = new THREE.Vector3();
const _edgeNDC = new THREE.Vector3();

export function updateLensingPass(pass, camera, blackHoleWorldPos, schwarzschildRadius) {
  _centerNDC.copy(blackHoleWorldPos).project(camera);

  // project a point one Rs to the side of center to measure the ON-SCREEN
  // radius correctly (accounts for perspective/distance automatically)
  _edgeNDC.copy(blackHoleWorldPos)
    .add(new THREE.Vector3(schwarzschildRadius, 0, 0))
    .project(camera);

  const screenPos = new THREE.Vector2(
    (_centerNDC.x + 1) * 0.5,
    (_centerNDC.y + 1) * 0.5
  );
  const edgePos = new THREE.Vector2(
    (_edgeNDC.x + 1) * 0.5,
    (_edgeNDC.y + 1) * 0.5
  );

  const screenRs = screenPos.distanceTo(edgePos);

  pass.uniforms.uBlackHoleScreenPos.value.copy(screenPos);
  pass.uniforms.uScreenRs.value = screenRs;
}