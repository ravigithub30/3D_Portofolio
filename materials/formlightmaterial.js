// formLightMaterial.js
import * as THREE from 'three';

// Recreates the classic "form shading" breakdown used in traditional
// rendering references: Center Light / Highlight, Halftone, Terminator,
// Core Shadow, and Reflected Light are all painted procedurally based on
// N·L (surface normal vs light direction) and a fresnel term for the
// reflected-light kick on the shadow side.
//
// Occlusion Shadow (the darkening where the object meets the ground) and
// Cast Shadow (the shadow thrown onto the floor) are NOT things a single
// object's own material can produce by itself — those depend on the floor
// and the scene's real shadow map. See the demo scene for how those two
// are wired up separately.
//
// Same call pattern as makeToonRimMaterial: every call returns an
// independent material instance with its own uniforms.
export function makeFormLightMaterial({
  baseColor = 0xb9b9b9,
  highlightColor = 0xffffff,
  coreShadowColor = 0x14101c,
  reflectedColor = 0x6a5a72,
  lightDir = new THREE.Vector3(0.6, 0.7, 0.5),

  // where the light/dark halftone boundary sits along N·L
  terminatorPos = 0.05,
  terminatorSoftness = 0.12,

  // how wide/dark the core-shadow band is, just past the terminator
  coreShadowStart = -0.05,
  coreShadowPeakAt = -0.35,
  coreShadowEnd = -0.75,

  // reflected light: a fresnel-based kick, but only on the shadow side
  reflectedStrength = 0.35,
  reflectedFalloff = 2.0,

  // specular highlight (the "Center Light" hotspot)
  specularPower = 48.0,
  specularStrength = 1.0,
} = {}) {
  const uniforms = {
    uBaseColor: { value: new THREE.Color(baseColor) },
    uHighlightColor: { value: new THREE.Color(highlightColor) },
    uCoreShadowColor: { value: new THREE.Color(coreShadowColor) },
    uReflectedColor: { value: new THREE.Color(reflectedColor) },
    uLightDir: { value: lightDir.clone().normalize() },

    uTerminatorPos: { value: terminatorPos },
    uTerminatorSoftness: { value: terminatorSoftness },

    uCoreShadowStart: { value: coreShadowStart },
    uCoreShadowPeakAt: { value: coreShadowPeakAt },
    uCoreShadowEnd: { value: coreShadowEnd },

    uReflectedStrength: { value: reflectedStrength },
    uReflectedFalloff: { value: reflectedFalloff },

    uSpecularPower: { value: specularPower },
    uSpecularStrength: { value: specularStrength },
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
      uniform vec3 uHighlightColor;
      uniform vec3 uCoreShadowColor;
      uniform vec3 uReflectedColor;
      uniform vec3 uLightDir;

      uniform float uTerminatorPos;
      uniform float uTerminatorSoftness;

      uniform float uCoreShadowStart;
      uniform float uCoreShadowPeakAt;
      uniform float uCoreShadowEnd;

      uniform float uReflectedStrength;
      uniform float uReflectedFalloff;

      uniform float uSpecularPower;
      uniform float uSpecularStrength;

      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uLightDir);

        float ndl = dot(N, L);

        // --- Halftone + Terminator ---
        // one smoothstep centered on uTerminatorPos gives us the soft
        // light-to-dark boundary (the terminator line) and the gradient
        // on either side of it (the halftone) in a single pass.
        float lightAmount = smoothstep(
          uTerminatorPos - uTerminatorSoftness,
          uTerminatorPos + uTerminatorSoftness,
          ndl
        );
        vec3 color = mix(uCoreShadowColor, uBaseColor, lightAmount);

        // --- Core of Shadow ---
        // darkest band, positioned just past the terminator on the
        // shadow side, fading back out on both sides.
        float coreRise = smoothstep(uCoreShadowStart, uCoreShadowPeakAt, ndl);
        float coreFall = 1.0 - smoothstep(uCoreShadowPeakAt, uCoreShadowEnd, ndl);
        float coreShadow = min(coreRise, coreFall) * step(ndl, uCoreShadowStart);
        // (step() ensures the core band only appears in the shadow hemisphere)
        color = mix(color, uCoreShadowColor, coreShadow);

        // --- Reflected Light ---
        // fresnel-style rim, but gated to the shadow side only (ndl < 0) —
        // this mimics bounced ambient light grazing the shadowed edge.
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), uReflectedFalloff);
        float shadowSide = smoothstep(0.05, -0.3, ndl);
        color = mix(color, uReflectedColor, fresnel * shadowSide * uReflectedStrength);

        // --- Highlight / Center Light ---
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), uSpecularPower);
        color += uHighlightColor * spec * uSpecularStrength;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  material.userData.formUniforms = uniforms;

  return material;
}