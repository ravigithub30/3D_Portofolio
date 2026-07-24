// TSL (node) version of the toon rim shader. Same math as the original
// GLSL — 2-tone lit/shadow split via a smoothed dot(N,L) threshold, plus a
// fresnel-based rim highlight — just expressed as a node graph so it can
// run through THREE.WebGPURenderer / NodeMaterial instead of raw
// THREE.ShaderMaterial.
//
// Kept in its own file for the same reason the original was: shader math
// stays easy to find/edit without digging through material-construction code.

import {
  normalize, dot, clamp, smoothstep, mix, pow, float,
  normalWorld, positionWorld, cameraPosition,
} from 'three/tsl';

// uniforms is the object of TSL `uniform(...)` nodes created in
// toonRimMaterial.js (uBaseColor, uShadowColor, uRimColor, uLightDir,
// uShadowEdge, uShadowSoftness, uRimStart, uRimEnd).
export function buildToonRimColorNode(uniforms) {
  const N = normalize(normalWorld);
  const V = normalize(cameraPosition.sub(positionWorld));
  const L = normalize(uniforms.uLightDir);

  // flat 2-tone toon split (hard crescent boundary, softened a touch)
  const ndl = dot(N, L);
  const lit = smoothstep(
    uniforms.uShadowEdge.sub(uniforms.uShadowSoftness),
    uniforms.uShadowEdge.add(uniforms.uShadowSoftness),
    ndl
  );
  const baseMix = mix(uniforms.uShadowColor, uniforms.uBaseColor, lit);

  // fresnel rim light — follows the silhouette on any shape
  const fresnel = pow(
    float(1.0).sub(clamp(dot(N, V), float(0.0), float(1.0))),
    float(2.0)
  );
  const rim = smoothstep(uniforms.uRimStart, uniforms.uRimEnd, fresnel);

  return mix(baseMix, uniforms.uRimColor, rim);
}