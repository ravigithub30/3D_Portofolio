// toonRimMaterial.js
import * as THREE from 'three';

// Builds a smooth 1D gradient texture that reproduces the feel of the old
// shadowEdge/shadowSoftness smoothstep, but evaluated through Three's real
// N·L (in world space) instead of our own hand-rolled dot product. Higher
// resolution + LinearFilter = soft edge, like before. For a harder, more
// classic toon "step" look instead, drop resolution to ~3-4 and switch to
// NearestFilter.
function createGradientMap({ edge, softness, resolution = 64 }) {
  const data = new Uint8Array(resolution);
  for (let i = 0; i < resolution; i++) {
    const ndl = (i / (resolution - 1)) * 2.0 - 1.0; // maps to N·L's [-1, 1] range
    const lo = edge - softness;
    const hi = edge + softness;
    const s = THREE.MathUtils.clamp((ndl - lo) / Math.max(hi - lo, 1e-5), 0, 1);
    data[i] = Math.round(s * s * (3 - 2 * s) * 255); // smoothstep curve baked in
  }
  const texture = new THREE.DataTexture(data, resolution, 1, THREE.RedFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

// Same call signature as before: makeToonRimMaterial({ baseColor, shadowColor, ... })
// Every call still returns an independent material instance (independent
// uniforms), so tweaking one object's color never affects another.
//
// CHANGED: rebuilt on THREE.MeshToonMaterial instead of a raw ShaderMaterial.
// This fixes two things at once:
//   1. Real shadows — MeshToonMaterial has Three's built-in shadow-map
//      sampling baked in, so castShadow/receiveShadow now actually work,
//      and objects correctly cast shadows onto each other.
//   2. The "shadow band rotates with the camera" bug is gone — that was
//      caused by comparing a VIEW-SPACE normal against a WORLD-SPACE light
//      direction in the old hand-written shader. MeshToonMaterial does its
//      lighting through Three's real light system, entirely in world
//      space, so that mismatch can't happen.
//
// NOTE: `lightDir` is no longer used — MeshToonMaterial reacts to the
// actual lights in your scene (your `dirLight`) automatically, the same
// way MeshStandardMaterial does. If you're still passing `lightDir` from
// old call sites that's harmless (it's just ignored), no need to remove it.
export function makeToonRimMaterial({
  baseColor = 0x5b8fef,
  shadowColor = 0x2e2158,
  rimColor = 0x0a0a0a,
  shadowEdge = 0.15,
  shadowSoftness = 0.04,
  rimStart = 0.55,
  rimEnd = 0.8,
} = {}) {
  const material = new THREE.MeshToonMaterial({
    color: baseColor,
    gradientMap: createGradientMap({
      edge: shadowEdge,
      softness: Math.max(shadowSoftness, 0.02),
    }),
  });

  // Patches Three's own compiled toon shader after the fact — we keep all
  // of its built-in shadow-map code, and only add two extras on top:
  //   1. tint the darkest band toward `shadowColor` (gradientMap alone
  //      only controls brightness, not hue, so without this the shadow
  //      side is just a dimmer version of baseColor)
  //   2. the fresnel rim light from the original shader
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowColor = { value: new THREE.Color(shadowColor) };
    shader.uniforms.uRimColor = { value: new THREE.Color(rimColor) };
    shader.uniforms.uRimStart = { value: rimStart };
    shader.uniforms.uRimEnd = { value: rimEnd };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uShadowColor;
         uniform vec3 uRimColor;
         uniform float uRimStart;
         uniform float uRimEnd;`
      )
      .replace(
        '#include <output_fragment>',
        `
         float bandDarkness = 1.0 - clamp(
           dot(reflectedLight.directDiffuse, vec3(0.333)) /
           max(dot(diffuseColor.rgb, vec3(0.333)), 0.0001),
           0.0, 1.0
         );
         outgoingLight = mix(outgoingLight, uShadowColor, bandDarkness * 0.6);

         vec3 viewDir = normalize(vViewPosition);
         float fresnel = 1.0 - max(dot(normalize(normal), viewDir), 0.0);
         float rimMix = smoothstep(uRimStart, uRimEnd, fresnel);
         outgoingLight = mix(outgoingLight, uRimColor, rimMix);

         #include <output_fragment>
        `
      );

    // kept around in case you want to tweak values at runtime later,
    // e.g. material.userData.toonUniforms.uRimStart.value = 0.4;
    material.userData.toonUniforms = {
      uShadowColor: shader.uniforms.uShadowColor,
      uRimColor: shader.uniforms.uRimColor,
      uRimStart: shader.uniforms.uRimStart,
      uRimEnd: shader.uniforms.uRimEnd,
    };
  };

  return material;
}