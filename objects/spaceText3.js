import { GLTFLoader } from 'https://unpkg.com/three@latest/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'https://unpkg.com/three@latest/build/three.module.js';
import { makeToonRimMaterial } from '../materials/toonRimMaterial.js';

const CONFIG = {
  path: './3d_model/SpaceText3.glb',
  scale: 0.5,
  materialOptions: {
    baseColor: 0xFF0000,
    shadowColor: 0xFF0000,
    rimColor: 0xFF0000,
    rimStart: 0.8,  // fresnel can never reach this high — effectively disables the rim
    rimEnd: 1.2, // black outline look, baked into the shader — no separate outline mesh needed
  },
  emissive: {
    color: 0xFF0000,
    intensity: 1,
  },

};

export function addSpaceText3(scene, overrides = {}) {
  const cfg = { ...CONFIG, ...overrides };
  const material = makeToonRimMaterial(cfg.materialOptions);

  // MeshToonMaterial (what makeToonRimMaterial builds internally) supports
  // emissive/emissiveIntensity natively. Makes the text glow visually
  // (bloom pass will pick it up) — does NOT act as a real light source;
  // it won't illuminate nearby geometry. That needs a separate
  // THREE.PointLight placed at this object's position if you want it.
  material.emissive = new THREE.Color(cfg.emissive.color);
  material.emissiveIntensity = cfg.emissive.intensity;

  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      cfg.path,
      (gltf) => {
        const model = gltf.scene;
        let meshCount = 0;
        model.traverse((child) => {
          if (child.isMesh) {
            child.material = material;
            meshCount++;
          }
        });
        console.log(`[spaceStation] loaded "${cfg.path}", applied toon+outline shader to ${meshCount} mesh(es)`);
        if (meshCount === 0) {
          console.warn(`[spaceStation] "${cfg.path}" loaded but contained NO meshes — check the file itself.`);
        }
        model.scale.setScalar(cfg.scale);
        scene.add(model);
        resolve(model);
      },
      undefined,
      (error) => {
        console.error(`[spaceStation] FAILED to load "${cfg.path}":`, error);
        reject(error);
      }
    );
  });
}