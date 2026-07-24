import * as THREE from 'three';
import { makeToonRimMaterial } from '../materials/toonRimMaterial.js';
import { addOutlineToMesh } from '../materials/outlineMaterial.js';

// ================================================================
// Compact 3D Simplex Noise (public-domain implementation, Stefan Gustavson style)
// Used to deform rocks smoothly/coherently instead of spiky random jitter.
// ================================================================
class SimplexNoise {
  constructor(seed = Math.random()) {
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.p[i] = i;

    let n = 256, t, r = seed * 65536 >>> 0;
    const rand = () => {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      return r / 0x7fffffff;
    };
    while (n > 1) {
      n--;
      const i = Math.floor(rand() * (n + 1));
      t = this.p[n]; this.p[n] = this.p[i]; this.p[i] = t;
    }

    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  static grad3 = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
  ]);

  noise3D(xin, yin, zin) {
    const grad3 = SimplexNoise.grad3;
    const perm = this.perm, permMod12 = this.permMod12;
    const F3 = 1 / 3, G3 = 1 / 6;

    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=1;k2=0; }
      else if (x0 >= z0) { i1=1;j1=0;k1=0; i2=1;j2=0;k2=1; }
      else { i1=0;j1=0;k1=1; i2=1;j2=0;k2=1; }
    } else {
      if (y0 < z0) { i1=0;j1=0;k1=1; i2=0;j2=1;k2=1; }
      else if (x0 < z0) { i1=0;j1=1;k1=0; i2=0;j2=1;k2=1; }
      else { i1=0;j1=1;k1=0; i2=1;j2=1;k2=0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
    const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;

    let n0=0,n1=0,n2=0,n3=0;

    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii+perm[jj+perm[kk]]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0]*x0 + grad3[gi0+1]*y0 + grad3[gi0+2]*z0);
    }

    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1]*x1 + grad3[gi1+1]*y1 + grad3[gi1+2]*z1);
    }

    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2]*x2 + grad3[gi2+1]*y2 + grad3[gi2+2]*z2);
    }

    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 >= 0) {
      const gi3 = permMod12[ii+1+perm[jj+1+perm[kk+1]]] * 3;
      t3 *= t3;
      n3 = t3 * t3 * (grad3[gi3]*x3 + grad3[gi3+1]*y3 + grad3[gi3+2]*z3);
    }

    return 32 * (n0 + n1 + n2 + n3); // roughly in [-1, 1]
  }
}

// ================================================================
// TWEAK EVERYTHING HERE
// ================================================================
const CONFIG = {
  count: 40,

  // ---- SIZE — the main knob you asked for. Adjust freely. ----
  sizeMin: 0.08,
  sizeMax: 1.4,

  // Base surface bumpiness/frequency shared by all shapes — each shape
  // preset below scales these slightly differently for variety.
  irregularity: 0.35,
  noiseFrequency: 1.6,
  geometryDetail: 3, // subdivision level for the smooth-shaded shapes

  // How much to round off the noise bumps after deformation.
  // More iterations / higher strength = smoother, more weathered rocks.
  // Doesn't affect the "angular" shape (kept sharp/faceted on purpose).
  smoothingIterations: 2,
  smoothingStrength: 0.5,

  // Relative chance of each shape type spawning. Doesn't need to sum to 1 —
  // they're normalized automatically. Raise a number to see more of that shape.
  shapeWeights: {
    chunky: 1,
    elongated: 1,
    flattened: 1,
    angular: 1,
  },

  ringCenter: { x: -8, y: 5, z: 0 },
  ringRadius: 3,
  ringSpread: 1.5,

  travelDirection: { x: 1, y: 0, z: 0 },
  travelDistance: 20,

  speedMin: 0.3,
  speedMax: 0.8,

  rotationSpeedMin: 0.05,
  rotationSpeedMax: 0.6,

  materialOptions: {
    baseColor: 0x363636,
    shadowColor: 0x1F1F1F,
    rimColor: 0xcfc3ad,
    rimStart: 0.35,
    rimEnd: 0.85,
  },
  outlineOptions: {
    color: 0x0a0a0a,
    thickness: 0.01,
  },
};
// ================================================================

const noiseGen = new SimplexNoise(1337);

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function pickWeighted(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

// Applies coherent simplex-noise bumps to every vertex, based on each
// vertex's direction from center — so shared corners (even after
// toNonIndexed) always agree and never crack apart.
function applyNoiseDeform(geo, irregularity, noiseFrequency) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  const seedX = Math.random() * 1000;
  const seedY = Math.random() * 1000;
  const seedZ = Math.random() * 1000;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();

    const n1 = noiseGen.noise3D(
      dir.x * noiseFrequency + seedX,
      dir.y * noiseFrequency + seedY,
      dir.z * noiseFrequency + seedZ
    );
    const n2 = noiseGen.noise3D(
      dir.x * noiseFrequency * 2.3 + seedX + 50,
      dir.y * noiseFrequency * 2.3 + seedY + 50,
      dir.z * noiseFrequency * 2.3 + seedZ + 50
    );

    const bump = n1 * 0.7 + n2 * 0.3;
    const offset = 1 + bump * irregularity;

    v.multiplyScalar(offset);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
}

// Averages each vertex toward its connected neighbors over a few passes —
// this is what actually softens the noise bumps into rounder, more organic
// shapes instead of a jagged/spiky surface. Only works on indexed geometry
// (shared vertices), so it's skipped for the flat-shaded "angular" shape,
// which uses non-indexed geometry on purpose to keep its sharp facets.
function laplacianSmooth(geo, iterations, strength) {
  if (!geo.index) return; // non-indexed (angular shape) — skip, keep facets sharp

  const index = geo.index.array;
  const pos = geo.attributes.position;
  const vertexCount = pos.count;

  const neighbors = Array.from({ length: vertexCount }, () => new Set());
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  let positions = pos.array.slice();

  for (let iter = 0; iter < iterations; iter++) {
    const next = positions.slice();
    for (let v = 0; v < vertexCount; v++) {
      const nbrs = neighbors[v];
      if (nbrs.size === 0) continue;

      let sx = 0, sy = 0, sz = 0;
      nbrs.forEach((n) => {
        sx += positions[n * 3];
        sy += positions[n * 3 + 1];
        sz += positions[n * 3 + 2];
      });
      const count = nbrs.size;
      const avgX = sx / count, avgY = sy / count, avgZ = sz / count;

      next[v * 3]     = positions[v * 3]     + (avgX - positions[v * 3]) * strength;
      next[v * 3 + 1] = positions[v * 3 + 1] + (avgY - positions[v * 3 + 1]) * strength;
      next[v * 3 + 2] = positions[v * 3 + 2] + (avgZ - positions[v * 3 + 2]) * strength;
    }
    positions = next;
  }

  pos.array.set(positions);
  pos.needsUpdate = true;
}

// Stretches/squashes a geometry along one randomly chosen axis — this is
// what actually breaks the "everything is a lumpy sphere" silhouette.
function applyAxisStretch(geo, axisIndex, stretchFactor, squashFactor) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const arr = [v.x, v.y, v.z];
    for (let a = 0; a < 3; a++) {
      arr[a] *= (a === axisIndex) ? stretchFactor : squashFactor;
    }
    pos.setXYZ(i, arr[0], arr[1], arr[2]);
  }
}

// ================================================================
// FOUR DISTINCT BASE SHAPES
// ================================================================
// Each returns a fresh geometry for the given radius. Silhouette differences
// come from base subdivision + axis stretching, not just surface noise —
// that's what makes them actually read as different rock types, not just
// differently-bumpy spheres.
const SHAPE_BUILDERS = {
  // Round-ish boulder, mild irregularity, gentle random axis variance
  chunky(radius, cfg) {
    const geo = new THREE.IcosahedronGeometry(radius, cfg.geometryDetail);
    applyNoiseDeform(geo, cfg.irregularity, cfg.noiseFrequency);
    laplacianSmooth(geo, cfg.smoothingIterations, cfg.smoothingStrength);
    const axis = Math.floor(Math.random() * 3);
    applyAxisStretch(geo, axis, randRange(1.0, 1.2), randRange(0.9, 1.0));
    geo.computeVertexNormals();
    return geo;
  },

  // Long shard/potato shape — stretched hard along one random axis
  elongated(radius, cfg) {
    const geo = new THREE.IcosahedronGeometry(radius, cfg.geometryDetail);
    applyNoiseDeform(geo, cfg.irregularity * 0.75, cfg.noiseFrequency);
    laplacianSmooth(geo, cfg.smoothingIterations, cfg.smoothingStrength);
    const axis = Math.floor(Math.random() * 3);
    applyAxisStretch(geo, axis, randRange(1.7, 2.4), randRange(0.6, 0.8));
    geo.computeVertexNormals();
    return geo;
  },

  // Flat slab/pancake shape — squashed hard along one random axis
  flattened(radius, cfg) {
    const geo = new THREE.IcosahedronGeometry(radius, cfg.geometryDetail);
    applyNoiseDeform(geo, cfg.irregularity * 0.8, cfg.noiseFrequency * 1.3);
    laplacianSmooth(geo, cfg.smoothingIterations, cfg.smoothingStrength);
    const axis = Math.floor(Math.random() * 3);
    applyAxisStretch(geo, axis, randRange(0.28, 0.48), randRange(1.05, 1.3));
    geo.computeVertexNormals();
    return geo;
  },

  // Low-poly crystalline/faceted chunk — flat-shaded, sharp planar faces.
  // Intentionally NOT smoothed — that's what keeps it looking crystalline
  // rather than turning into another round rock.
  angular(radius, cfg) {
    let geo = new THREE.IcosahedronGeometry(radius, 0).toNonIndexed();
    applyNoiseDeform(geo, cfg.irregularity * 0.5, cfg.noiseFrequency * 0.7);
    const axis = Math.floor(Math.random() * 3);
    applyAxisStretch(geo, axis, randRange(1.0, 1.4), randRange(0.85, 1.05));
    geo.computeVertexNormals(); // flat, since geometry is non-indexed
    return geo;
  },
};

// ================================================================

function getPerpendicularBasis(dir) {
  const d = dir.clone().normalize();
  let helper = Math.abs(d.y) < 0.99
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);

  const u = new THREE.Vector3().crossVectors(d, helper).normalize();
  const v = new THREE.Vector3().crossVectors(d, u).normalize();
  return { u, v };
}

export function addSpaceRockField(scene, overrides = {}) {
  const cfg = { ...CONFIG, ...overrides };

  const group = new THREE.Group();
  scene.add(group);

  const direction = new THREE.Vector3(
    cfg.travelDirection.x,
    cfg.travelDirection.y,
    cfg.travelDirection.z
  ).normalize();

  const ringCenter = new THREE.Vector3(
    cfg.ringCenter.x,
    cfg.ringCenter.y,
    cfg.ringCenter.z
  );

  const { u, v } = getPerpendicularBasis(direction);

  const material = makeToonRimMaterial(cfg.materialOptions);

  function randomRingPoint() {
    const angle = Math.random() * Math.PI * 2;
    const radius = cfg.ringRadius + (Math.random() - 0.5) * cfg.ringSpread;
    return ringCenter.clone()
      .addScaledVector(u, Math.cos(angle) * radius)
      .addScaledVector(v, Math.sin(angle) * radius);
  }

  function randomAxis() {
    return new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();
  }

  function spawnRock(rock) {
    const size = randRange(cfg.sizeMin, cfg.sizeMax);
    const shapeType = pickWeighted(cfg.shapeWeights);

    if (rock.outlineMesh) {
      rock.mesh.remove(rock.outlineMesh);
      rock.outlineMesh.geometry?.dispose();
      rock.outlineMesh = null;
    }

    if (rock.mesh.geometry) rock.mesh.geometry.dispose();
    rock.mesh.geometry = SHAPE_BUILDERS[shapeType](size, cfg);
    rock.shapeType = shapeType;

    const childrenBefore = new Set(rock.mesh.children);
    addOutlineToMesh(rock.mesh, cfg.outlineOptions);
    rock.outlineMesh = rock.mesh.children.find((c) => !childrenBefore.has(c)) || null;

    rock.mesh.position.copy(randomRingPoint());
    rock.mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    rock.axis = randomAxis();
    rock.rotationSpeed = randRange(cfg.rotationSpeedMin, cfg.rotationSpeedMax);
    rock.speed = randRange(cfg.speedMin, cfg.speedMax);
    rock.distanceTraveled = 0;
  }

  const rocks = [];
  for (let i = 0; i < cfg.count; i++) {
    const mesh = new THREE.Mesh(undefined, material);
    group.add(mesh);

    const rock = {
      mesh,
      outlineMesh: null,
      shapeType: null,
      axis: new THREE.Vector3(1, 0, 0),
      rotationSpeed: 0,
      speed: 0,
      distanceTraveled: 0,
    };
    spawnRock(rock);

    rock.distanceTraveled = Math.random() * cfg.travelDistance;
    rock.mesh.position.addScaledVector(direction, rock.distanceTraveled);

    rocks.push(rock);
  }

  console.log(`[spaceRockField] spawned ${cfg.count} rocks:`,
    rocks.reduce((counts, r) => {
      counts[r.shapeType] = (counts[r.shapeType] || 0) + 1;
      return counts;
    }, {})
  );

  return {
    group,
    update(deltaSeconds) {
      for (const rock of rocks) {
        rock.mesh.position.addScaledVector(direction, rock.speed * deltaSeconds);
        rock.mesh.rotateOnAxis(rock.axis, rock.rotationSpeed * deltaSeconds);

        rock.distanceTraveled += rock.speed * deltaSeconds;
        if (rock.distanceTraveled >= cfg.travelDistance) {
          spawnRock(rock);
        }
      }
    },
  };
}