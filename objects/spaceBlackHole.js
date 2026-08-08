// ============================================================================
// REAL RAY-MARCHED GRAVITATIONAL LENSING BLACK HOLE
//
// This replaces the earlier "fake/static-look v6" module, which rendered a
// plain black sphere + a spinning textured disk mesh and shipped a dummy,
// disabled lensPass (setDepthTexture/setBackgroundTexture/render were all
// no-ops). Nothing about that version bent light — index.html was wiring up
// depth occlusion and a raw HDRI background for lensing, but the Pass it
// was handed silently did nothing with either.
//
// This version has NO visible mesh in the scene at all. The black hole
// (event horizon + accretion disk + lensed background) is entirely a
// post-processing effect: a full-screen Pass that, for every pixel,
// reconstructs a camera ray from depth, marches it through world space,
// bends it toward the hole using a Newtonian 1/r^2 deflection approximation,
// and either:
//   - hits real scene geometry first  -> shows the normal rendered pixel
//   - falls inside the event horizon  -> black
//   - crosses the accretion disk band -> emissive turbulent color
//   - escapes to infinity             -> samples the equirect HDRI along
//                                        the now-bent direction (this is
//                                        what actually produces the
//                                        "lensed starfield" look)
//
// Interface is unchanged from before: addSpaceBlackHole(scene, camera, cfg)
// returns { update(delta, camera), lensPass, group }. group is an empty
// THREE.Group kept only so callers can still position/inspect "where" the
// hole conceptually is; nothing is parented to it for rendering.
// ============================================================================

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'https://unpkg.com/three@latest/examples/jsm/postprocessing/Pass.js';

const DEFAULTS = {
    position: { x: -40, y: -50, z: -500 },

    radius: 55, // event horizon radius (world units)

    // Accretion disk band, measured as multiples of `radius` unless you
    // pass explicit world-unit numbers here.
    innerRadius: null, // default: radius * 1.6
    outerRadius: null, // default: radius * 5.5
    diskThickness: 3,  // soft vertical fade of the disk band, world units

    // Tilt of the disk plane relative to world XZ, in degrees.
    diskTiltDeg: { x: 12, y: 0, z: 4 },

    spinSpeed: 0.15,

    colors: {
        inner: '#ffdf9e',
        mid: '#ff8c1a',
        outer: '#7a1200',
    },

    turbulence: {
        layers: [
            { freq: 3, amp: 0.40, radialFreq: 5.0, phase: 0.0 },
            { freq: 7, amp: 0.25, radialFreq: 9.0, phase: 1.3 },
            { freq: 13, amp: 0.15, radialFreq: 17.0, phase: 2.1 },
        ],
        floor: 0.35,
    },

    // Ray-marching / lensing quality knobs.
    lensing: {
        strength: 2.6,      // deflection multiplier — higher = more visible bending
        steps: 96,          // march steps (perf vs. accuracy)
        maxDistance: 4000,  // world units before we give up and call it "escaped"
        minStep: 1.5,       // smallest step size, used very close to the hole
        maxStep: 14,        // largest step size, used far from the hole
        falloffStart: 3.0,  // step shrinks inside falloffStart * radius
    },
};

function deepMerge(base, override) {
    const out = { ...base };
    for (const key in override) {
        if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
            out[key] = deepMerge(base[key] || {}, override[key]);
        } else {
            out[key] = override[key];
        }
    }
    return out;
}

function buildTurbulenceGLSL(layers) {
    return layers
        .map(
            (l) =>
                `n += sin(angle * ${l.freq.toFixed(2)} + radiusT * ${l.radialFreq.toFixed(2)} + ${l.phase.toFixed(2)}) * ${l.amp.toFixed(3)};`
        )
        .join('\n        ');
}

class BlackHoleLensPass extends Pass {
    constructor(config) {
        super();

        this.config = config;
        this._quad = null; // built lazily once we know the fragment shader
        this._depthTexture = null;
        this._backgroundTexture = null;

        const innerColor = new THREE.Color(config.colors.inner);
        const midColor = new THREE.Color(config.colors.mid);
        const outerColor = new THREE.Color(config.colors.outer);
        const turbulenceGLSL = buildTurbulenceGLSL(config.turbulence.layers);

        const tiltEuler = new THREE.Euler(
            THREE.MathUtils.degToRad(config.diskTiltDeg.x),
            THREE.MathUtils.degToRad(config.diskTiltDeg.y),
            THREE.MathUtils.degToRad(config.diskTiltDeg.z)
        );
        const diskNormal = new THREE.Vector3(0, 1, 0).applyEuler(tiltEuler).normalize();

        const bhPos = new THREE.Vector3(config.position.x, config.position.y, config.position.z);
        const innerR = config.innerRadius ?? config.radius * 1.6;
        const outerR = config.outerRadius ?? config.radius * 5.5;

        this.uniforms = {
            tDiffuse: { value: null },
            uDepth: { value: null },
            uBackground: { value: null },
            uHasBackground: { value: 0 },

            uResolution: { value: new THREE.Vector2(1, 1) },
            uCameraPos: { value: new THREE.Vector3() },
            uProjectionInverse: { value: new THREE.Matrix4() },
            uViewInverse: { value: new THREE.Matrix4() },

            uBHPos: { value: bhPos },
            uHorizonRadius: { value: config.radius },
            uInnerRadius: { value: innerR },
            uOuterRadius: { value: outerR },
            uDiskThickness: { value: config.diskThickness },
            uDiskNormal: { value: diskNormal },

            uTime: { value: 0 },
            uSpinSpeed: { value: config.spinSpeed },

            uInnerColor: { value: innerColor },
            uMidColor: { value: midColor },
            uOuterColor: { value: outerColor },
            uFloor: { value: config.turbulence.floor },

            uLensStrength: { value: config.lensing.strength },
            uSteps: { value: config.lensing.steps },
            uMaxDistance: { value: config.lensing.maxDistance },
            uMinStep: { value: config.lensing.minStep },
            uMaxStep: { value: config.lensing.maxStep },
            uFalloffStart: { value: config.lensing.falloffStart },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;

                varying vec2 vUv;

                uniform sampler2D tDiffuse;
                uniform sampler2D uDepth;
                uniform sampler2D uBackground;
                uniform float uHasBackground;

                uniform vec2 uResolution;
                uniform vec3 uCameraPos;
                uniform mat4 uProjectionInverse;
                uniform mat4 uViewInverse;

                uniform vec3 uBHPos;
                uniform float uHorizonRadius;
                uniform float uInnerRadius;
                uniform float uOuterRadius;
                uniform float uDiskThickness;
                uniform vec3 uDiskNormal;

                uniform float uTime;
                uniform float uSpinSpeed;

                uniform vec3 uInnerColor;
                uniform vec3 uMidColor;
                uniform vec3 uOuterColor;
                uniform float uFloor;

                uniform float uLensStrength;
                uniform float uSteps;
                uniform float uMaxDistance;
                uniform float uMinStep;
                uniform float uMaxStep;
                uniform float uFalloffStart;

                const float PI = 3.14159265359;

                // World-space position at a given NDC depth (0..1), reconstructed
                // the same way the ray direction below is reconstructed, so the
                // resulting distance-along-ray is exact for THIS pixel's ray.
                vec3 worldPosFromDepth(float depth) {
                    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    vec4 viewPos = uProjectionInverse * ndc;
                    viewPos /= viewPos.w;
                    vec4 worldPos = uViewInverse * viewPos;
                    return worldPos.xyz;
                }

                vec3 rayDirection() {
                    vec4 clip = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
                    vec4 viewSpace = uProjectionInverse * clip;
                    viewSpace = vec4(viewSpace.xy, -1.0, 0.0);
                    return normalize((uViewInverse * viewSpace).xyz);
                }

                vec2 dirToEquirect(vec3 d) {
                    float phi = atan(d.z, d.x);
                    float theta = acos(clamp(d.y, -1.0, 1.0));
                    return vec2(phi / (2.0 * PI) + 0.5, theta / PI);
                }

                // Turbulent disk shading at a given (angle, radiusT in [0,1]).
                vec3 diskColor(float angle, float radiusT) {
                    float n = 0.0;
                    ${turbulenceGLSL}
                    float mult = clamp(uFloor + (n * 0.5 + 0.5) * (1.0 - uFloor), 0.0, 1.3);

                    vec3 color = radiusT < 0.5
                        ? mix(uInnerColor, uMidColor, radiusT * 2.0)
                        : mix(uMidColor, uOuterColor, (radiusT - 0.5) * 2.0);

                    float edgeFade = smoothstep(0.0, 0.06, radiusT) * (1.0 - smoothstep(0.9, 1.0, radiusT));
                    return color * mult * edgeFade;
                }

                void main() {
                    vec3 baseColor = texture2D(tDiffuse, vUv).rgb;
                    float sceneDepth = texture2D(uDepth, vUv).r;

                    float sceneDist = 1.0e9;
                    if (sceneDepth < 1.0) {
                        sceneDist = length(worldPosFromDepth(sceneDepth) - uCameraPos);
                    }

                    vec3 origin = uCameraPos;
                    vec3 dir = rayDirection();

                    float t = 0.0;
                    vec3 accumDisk = vec3(0.0);
                    float diskAlpha = 0.0;
                    bool hitHorizon = false;
                    bool blockedByScene = false;

                    int steps = int(uSteps);
                    for (int i = 0; i < 256; i++) {
                        if (i >= steps) break;

                        vec3 pos = origin + dir * t;
                        vec3 toBH = uBHPos - pos;
                        float r = length(toBH);

                        if (r < uHorizonRadius) {
                            hitHorizon = true;
                            break;
                        }

                        if (t > sceneDist) {
                            blockedByScene = true;
                            break;
                        }

                        // Disk crossing test: signed distance to the tilted disk plane.
                        float planeDist = dot(pos - uBHPos, uDiskNormal);
                        if (abs(planeDist) < uDiskThickness && diskAlpha < 1.0) {
                            // project onto disk plane to get in-plane radius/angle
                            vec3 inPlane = (pos - uBHPos) - uDiskNormal * planeDist;
                            float diskR = length(inPlane);
                            if (diskR > uInnerRadius && diskR < uOuterRadius) {
                                vec3 tangent = normalize(cross(uDiskNormal, vec3(1.0, 0.0, 0.0) + vec3(0.0001)));
                                vec3 bitangent = cross(uDiskNormal, tangent);
                                float px = dot(inPlane, tangent);
                                float py = dot(inPlane, bitangent);
                                float angle = atan(py, px) + uTime * uSpinSpeed;
                                float radiusT = clamp((diskR - uInnerRadius) / max(uOuterRadius - uInnerRadius, 0.0001), 0.0, 1.0);
                                float thicknessFade = 1.0 - smoothstep(0.0, uDiskThickness, abs(planeDist));
                                vec3 c = diskColor(angle, radiusT) * thicknessFade;
                                accumDisk += c * (1.0 - diskAlpha);
                                diskAlpha = min(diskAlpha + thicknessFade * 0.6, 1.0);
                            }
                        }

                        // Newtonian-style deflection toward the hole; stronger close in.
                        float bend = uLensStrength * (uHorizonRadius * uHorizonRadius) / max(r * r, 1.0);
                        float step = mix(uMinStep, uMaxStep, clamp((r - uHorizonRadius) / (uFalloffStart * uHorizonRadius), 0.0, 1.0));

                        dir = normalize(dir + normalize(toBH) * bend * (step / max(r, 1.0)));
                        t += step;

                        if (t > uMaxDistance) break;
                    }

                    vec3 result;
                    if (hitHorizon) {
                        result = mix(vec3(0.0), accumDisk, diskAlpha);
                    } else if (blockedByScene) {
                        result = mix(baseColor, accumDisk, diskAlpha);
                    } else {
                        vec3 bg = vec3(0.0);
                        if (uHasBackground > 0.5) {
                            bg = texture2D(uBackground, dirToEquirect(dir)).rgb;
                        } else {
                            bg = baseColor;
                        }
                        result = mix(bg, accumDisk, diskAlpha);
                    }

                    gl_FragColor = vec4(result, 1.0);
                }
            `,
        });

        this._quad = new FullScreenQuad(material);
        this.material = material;
    }

    setDepthTexture(depthTexture) {
        this._depthTexture = depthTexture;
        this.uniforms.uDepth.value = depthTexture;
    }

    setBackgroundTexture(texture) {
        this._backgroundTexture = texture;
        this.uniforms.uBackground.value = texture;
        this.uniforms.uHasBackground.value = 1;
    }

    updateCamera(camera) {
        this.uniforms.uCameraPos.value.copy(camera.position);
        this.uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
        this.uniforms.uViewInverse.value.copy(camera.matrixWorld);
    }

    setSize(width, height) {
        this.uniforms.uResolution.value.set(width, height);
    }

    render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
        this.uniforms.tDiffuse.value = readBuffer.texture;

        if (this.renderToScreen) {
            renderer.setRenderTarget(null);
        } else {
            renderer.setRenderTarget(writeBuffer);
            if (this.clear) renderer.clear();
        }

        this._quad.render(renderer);
    }
}

export function addSpaceBlackHole(scene, camera, userConfig = {}) {
    const config = deepMerge(DEFAULTS, userConfig);

    // Kept only as a positional reference for callers — nothing is
    // rendered from scene geometry. The hole is purely a post-process.
    const group = new THREE.Group();
    group.position.set(config.position.x, config.position.y, config.position.z);
    scene.add(group);

    const lensPass = new BlackHoleLensPass(config);
    lensPass.updateCamera(camera);

    let elapsed = 0;
    function update(delta, cam) {
        elapsed += delta;
        lensPass.uniforms.uTime.value = elapsed;
        lensPass.updateCamera(cam || camera);
    }

    return {
        group,
        update,
        lensPass,
    };
}