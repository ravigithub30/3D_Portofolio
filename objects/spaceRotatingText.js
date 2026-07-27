import { GLTFLoader } from 'https://unpkg.com/three@latest/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'https://unpkg.com/three@latest/build/three.module.js';
import { makeToonRimMaterial } from '../materials/toonRimMaterial.js';
import { addOutlineToMesh } from '../materials/outlineMaterial.js';

const CONFIG = {
  path: './3d_model/SpaceRotatingText.glb',
  scale: 0.5,
  materialOptions: {
    baseColor: 0x002AFF,
    shadowColor: 0x002AFF,
    rimColor: 0xE5E7FF,
    rimStart: 0.8,
    rimEnd: 1.2,
  },
  emissive: {
    color: 0x002AFF,
    intensity: 2,
  },
  outlineOptions: {
    color: 0x0a0a0a,
    thickness: 0.015,
  },
  rotation: {
    axis: new THREE.Vector3(0, 1, 0), // spin around Y by default
    speed: 0.2,                        // radians/sec
  },
};

export function addSpaceRotatingText(scene, overrides = {}) {// change for evry new object
  const cfg = { ...CONFIG, ...overrides };
  const material = makeToonRimMaterial(cfg.materialOptions);

  // MeshToonMaterial (what makeToonRimMaterial builds internally) supports
  // emissive/emissiveIntensity natively, same as MeshStandardMaterial.
  // This makes the text glow visually (especially with your UnrealBloomPass
  // picking it up) but note: it does NOT act as a real light source — it
  // won't illuminate nearby geometry or cast a colored glow onto the
  // station. If you want it to actually light up its surroundings, that
  // needs a real THREE.PointLight placed at the text's position separately.
  material.emissive = new THREE.Color(cfg.emissive.color);
  material.emissiveIntensity = cfg.emissive.intensity;

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      cfg.path,
      (gltf) => {
        const model = gltf.scene;

        // Pass 1: collect the real meshes only.
        const meshes = [];
        model.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });

        // Pass 2: modify the fixed list.
        meshes.forEach((child) => {
          child.material = material;
          addOutlineToMesh(child, cfg.outlineOptions);
        });

        console.log(`[spaceEngine] loaded "${cfg.path}", applied toon shader + black outline to ${meshes.length} mesh(es)`);
        if (meshes.length === 0) {
          console.warn(`[spaceEngine] "${cfg.path}" loaded but contained NO meshes — check the file itself.`);
        }

        model.scale.setScalar(cfg.scale);

        // Re-center pivot: compute the model's bounding-box center in its own
        // local space, then shift the model so that point sits at (0,0,0)
        // inside a wrapper group. Rotating the group (not the model) then
        // spins it around its true visual center regardless of where the
        // GLB's original pivot was authored.
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);

        const pivot = new THREE.Group();
        pivot.add(model);
        scene.add(pivot);

        const axis = cfg.rotation.axis.clone().normalize();
        const speed = cfg.rotation.speed;

        // Called from the main animation loop each frame.
        function update(delta) {
          pivot.rotateOnAxis(axis, speed * delta);
        }

        resolve({ model, pivot, update });
      },
      undefined,
      (error) => {
        console.error(`[spaceEngine] FAILED to load "${cfg.path}":`, error);
        reject(error);
      }
    );
  });
}