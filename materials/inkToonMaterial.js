// materials/inkToonMaterial.js
import * as THREE from 'three';

export function makeInkToonMaterial(options = {}) {
  const {
    baseColor = 0x2d8a6f,      // lit color
    shadowColor = 0x14392e,    // shadow band color
    bandCount = 2,             // number of hard lighting steps
    specularColor = 0xffffff,
    specularSize = 0.92,       // higher = smaller, tighter highlight
    rimColor = 0x8fd9c4,       // cool rim on the shadow edge
    rimStrength = 0.4,
  } = options;

  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uShadowColor: { value: new THREE.Color(shadowColor) },
      uSpecularColor: { value: new THREE.Color(specularColor) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uBandCount: { value: bandCount },
      uSpecularSize: { value: specularSize },
      uRimStrength: { value: rimStrength },
      uLightDir: { value: new THREE.Vector3(0.6, 0.7, 0.5).normalize() },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uBaseColor;
      uniform vec3 uShadowColor;
      uniform vec3 uSpecularColor;
      uniform vec3 uRimColor;
      uniform float uBandCount;
      uniform float uSpecularSize;
      uniform float uRimStrength;
      uniform vec3 uLightDir;

      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);

        float NdotL = dot(N, uLightDir);

        // ---- Hard-stepped lighting bands (the "ink illustration" look) ----
        float bands = floor(clamp(NdotL, 0.0, 1.0) * uBandCount) / uBandCount;
        vec3 color = mix(uShadowColor, uBaseColor, step(0.5, bands) + bands * 0.5);

        // ---- Tight specular highlight, painted-on rather than physically smooth ----
        vec3 halfDir = normalize(uLightDir + V);
        float spec = pow(max(dot(N, halfDir), 0.0), 60.0);
        spec = smoothstep(uSpecularSize, 1.0, spec);
        color = mix(color, uSpecularColor, spec);

        // ---- Cool rim light on the shadow edge, common in this style ----
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float rimMask = fresnel * (1.0 - clamp(NdotL, 0.0, 1.0));
        color = mix(color, uRimColor, rimMask * uRimStrength);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}