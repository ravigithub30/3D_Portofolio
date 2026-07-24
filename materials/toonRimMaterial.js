// toonRimMaterial.js
import * as THREE from 'three';

// Same call signature as before: makeToonRimMaterial({ baseColor, shadowColor, ... })
// Every call still returns an independent material instance (independent
// uniforms), so tweaking one object's color never affects another.
export function makeToonRimMaterial({
  baseColor = 0x5b8fef,
  shadowColor = 0x2e2158,
  rimColor = 0x0a0a0a,
  lightDir = new THREE.Vector3(0.6, 0.5, 0.7),
  shadowEdge = 0.15,
  shadowSoftness = 0.04,
  rimStart = 0.55,
  rimEnd = 0.8,
} = {}) {
  const uniforms = {
    uBaseColor: { value: new THREE.Color(baseColor) },
    uShadowColor: { value: new THREE.Color(shadowColor) },
    uRimColor: { value: new THREE.Color(rimColor) },
    uLightDir: { value: lightDir.clone().normalize() },
    uShadowEdge: { value: shadowEdge },
    uShadowSoftness: { value: shadowSoftness },
    uRimStart: { value: rimStart },
    uRimEnd: { value: rimEnd },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-worldPos.xyz);
        gl_Position = projectionMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uBaseColor;
      uniform vec3 uShadowColor;
      uniform vec3 uRimColor;
      uniform vec3 uLightDir;
      uniform float uShadowEdge;
      uniform float uShadowSoftness;
      uniform float uRimStart;
      uniform float uRimEnd;

      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);

        // toon shadow band: light-facing vs shadow side, softened edge
        float ndl = dot(N, normalize(uLightDir));
        float shadowMix = smoothstep(uShadowEdge - uShadowSoftness, uShadowEdge + uShadowSoftness, ndl);
        vec3 color = mix(uShadowColor, uBaseColor, shadowMix);

        // fresnel-style rim light
        float fresnel = 1.0 - max(dot(N, V), 0.0);
        fresnel = pow(fresnel, 3.0); // sharpens falloff — only true grazing angles reach high values
        float rimMix = smoothstep(uRimStart, uRimEnd, fresnel);
        color = mix(color, uRimColor, rimMix);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  // kept around in case you want to tweak values at runtime later,
  // e.g. material.userData.toonUniforms.uRimStart.value = 0.4;
  material.userData.toonUniforms = uniforms;

  return material;
}