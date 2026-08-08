import * as THREE from 'three';

// ================== CONFIG ==================
// Adjust position, size, and the look of the rim ring here.
const CONFIG = {
    position: { x: -40, y: -50, z: -500 },   // <-- move the whole object here
    sphereRadius: 130,

    baseColor: 0x000000,      // sphere body color (the "eclipse" disc)
    glowColor: 0xff8a1a,      // ring color (orange/gold like the reference)

    fresnelPower: 1.5,        // higher = curve stays flatter near center, sharper near the true edge

    // The ring is now a BAND, not a one-sided threshold: it turns on at
    // ringCenter and fades back off on both sides, so there's a visible
    // dark gap between the ring and the true silhouette edge — same as
    // the Blender reference, instead of a filled bright region reaching
    // all the way out.
    ringCenter: 0.2,         // fresnel value (0-1) where the ring sits — closer to 1 = closer to the true edge
    ringWidth: 0.005,          // half-width of the fully-bright band
    ringSoftness: 0.04,       // extra fade distance on each side of the band

    glowStrength: 2.2,        // emissive intensity multiplier (drives bloom if you have UnrealBloomPass)
};

const vertexShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-worldPos.xyz);
        gl_Position = projectionMatrix * worldPos;
    }
`;

const fragmentShader = /* glsl */ `
    uniform vec3 baseColor;
    uniform vec3 glowColor;
    uniform float fresnelPower;
    uniform float ringCenter;
    uniform float ringWidth;
    uniform float ringSoftness;
    uniform float glowStrength;

    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
        float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), fresnelPower);

        // Distance from the ring's center line in fresnel-space. A pixel
        // exactly at ringCenter gets dist = 0 (full brightness); pixels
        // further away in EITHER direction fade out — that's what makes
        // this a thin band instead of a filled region.
        float dist = abs(fresnel - ringCenter);
        float ring = 1.0 - smoothstep(ringWidth, ringWidth + ringSoftness, dist);

        vec3 color = mix(baseColor, glowColor * glowStrength, ring);
        gl_FragColor = vec4(color, 1.0);
    }
`;

/**
 * Adds a sphere with a thin fresnel-based glowing rim ring (eclipse look).
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, mesh: THREE.Mesh, material: THREE.ShaderMaterial, setPosition: (x:number,y:number,z:number) => void }}
 */
export function addSpaceEclipseSphere(scene) {
    const group = new THREE.Group();
    group.position.set(CONFIG.position.x, CONFIG.position.y, CONFIG.position.z);

    const geometry = new THREE.SphereGeometry(CONFIG.sphereRadius, 64, 64);
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            baseColor: { value: new THREE.Color(CONFIG.baseColor) },
            glowColor: { value: new THREE.Color(CONFIG.glowColor) },
            fresnelPower: { value: CONFIG.fresnelPower },
            ringCenter: { value: CONFIG.ringCenter },
            ringWidth: { value: CONFIG.ringWidth },
            ringSoftness: { value: CONFIG.ringSoftness },
            glowStrength: { value: CONFIG.glowStrength },
        },
    });

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    scene.add(group);

    function setPosition(x, y, z) {
        group.position.set(x, y, z);
    }

    return { group, mesh, material, setPosition };
}