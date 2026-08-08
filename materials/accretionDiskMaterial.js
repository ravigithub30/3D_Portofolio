import * as THREE from 'three';

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uScrollSpeed;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uBrightness;
  uniform float uInnerFadeEnd;
  uniform float uEdgeFadeStart;
  uniform float uNoiseScale;
  uniform float uVerticalStretch;
  uniform float uEdgeRaggedness;
  uniform float uMinAlpha;

  varying vec2 vUv;

  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0,i1.y,1.0)) + i.x + vec3(0.0,i1.x,1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return value;
  }
void main() {
    float t = vUv.x;
    float scrolledV = fract(vUv.y + uTime * uScrollSpeed);

    vec2 noiseCoord = vec2(t * uNoiseScale, scrolledV * uNoiseScale * uVerticalStretch);
    float n  = fbm(noiseCoord) * 0.5 + 0.5;
    float n2 = fbm(noiseCoord * 2.1 + 50.0) * 0.5 + 0.5;
    float turbulence = mix(n, n2, 0.5);

    vec3 color = mix(uColorA, uColorB, smoothstep(0.0, 0.5, t));
    color = mix(color, uColorC, smoothstep(0.35, 1.0, t));
    color *= mix(0.55, 1.35, turbulence);

    // Inner hole: clean fade, no noise — the raggedness is an OUTER-only effect.
    float innerAlpha = smoothstep(0.0, uInnerFadeEnd, t);

    // Outer edge: raggedness GROWS with distance past uEdgeFadeStart, so the
    // boundary is nearly clean right where the fade begins and gets more
    // torn/uneven the further out toward t = 1.0 you go — not a uniform
    // amount of noise applied everywhere.
    float outwardProgress = smoothstep(uEdgeFadeStart, 1.0, t);
    float edgeNoise = fbm(noiseCoord * 1.4 + 200.0) * uEdgeRaggedness * outwardProgress;
    float outerAlpha = 1.0 - smoothstep(uEdgeFadeStart - edgeNoise, 1.0 - edgeNoise * 0.5, t);

    float noiseAlpha = mix(uMinAlpha, 1.0, turbulence);
    float alpha = innerAlpha * outerAlpha * noiseAlpha;

    vec3 finalColor = color * uBrightness * alpha;
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export function makeAccretionDiskMaterial(overrides = {}) {
  const cfg = {
    scrollSpeed: -0.02,
    
    colorA: 0xf5b642,
    colorB: 0xe0651f,
    colorC: 0xc0281a,
    

    brightness: 1.2,
    innerFadeEnd: 0.02,
    edgeFadeStart: 0.2,       // pulled in from the mesh edge so the ragged
                              // noise has room to fray it before t=1.0
    noiseScale: 12.0,
    verticalStretch: 0.5,     // lower = more stretched/elongated streaks
    edgeRaggedness: 0.4,   // how far the noise can shift the fade boundary
    minAlpha: 1.4,           // raise toward 1.0 for a denser, less transparent disk
    ...overrides,
  };
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScrollSpeed: { value: cfg.scrollSpeed },
      uColorA: { value: new THREE.Color(cfg.colorA) },
      uColorB: { value: new THREE.Color(cfg.colorB) },
      uColorC: { value: new THREE.Color(cfg.colorC) },
      uBrightness: { value: cfg.brightness },
      uInnerFadeEnd: { value: cfg.innerFadeEnd },
      uEdgeFadeStart: { value: cfg.edgeFadeStart },
      uNoiseScale: { value: cfg.noiseScale },
      uVerticalStretch: { value: cfg.verticalStretch },
      uEdgeRaggedness: { value: cfg.edgeRaggedness },
      uMinAlpha: { value: cfg.minAlpha },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}