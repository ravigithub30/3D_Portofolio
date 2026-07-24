import { GLTFLoader } from 'https://unpkg.com/three@latest/examples/jsm/loaders/GLTFLoader.js';
import { makeToonRimMaterial } from '../materials/toonRimMaterial.js';
import { addOutlineToMesh } from '../materials/outlineMaterial.js';

const CONFIG = {
  path: './3d_model/SpaceManpant.glb',
  scale: 0.5,
  materialOptions: {
    baseColor: 0x1E1E21,
    shadowColor: 0x111112,
    // rim pushed out of reach — the black outline mesh below handles the
    // edge look instead, so we don't want fresnel double-outlining on top of it
    rimColor: 0xE5E7FF,
    rimStart: 0.8,  // fresnel can never reach this high — effectively disables the rim
    rimEnd: 1.2,
  },
  outlineOptions: {
    color: 0x0a0a0a,
    thickness: 0.015, // world units — tune once you see the actual model scale
  },
};

export function addSpaceManpant(scene, overrides = {}) {// change for evry new object
  const cfg = { ...CONFIG, ...overrides };
  const material = makeToonRimMaterial(cfg.materialOptions);
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      cfg.path,
      (gltf) => {
        const model = gltf.scene;

        // Pass 1: collect the real meshes only. Nothing is modified yet,
        // so this traversal can't accidentally pick up anything added later.
        const meshes = [];
        model.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });

        // Pass 2: modify the fixed list. Adding the outline duplicate here
        // is safe because we're iterating our own array, not the live scene graph.
        meshes.forEach((child) => {
          child.material = material;
          addOutlineToMesh(child, cfg.outlineOptions); // black duplicate, BackSide, normal-offset
        });

        console.log(`[spaceEngine] loaded "${cfg.path}", applied toon shader + black outline to ${meshes.length} mesh(es)`);
        if (meshes.length === 0) {
          console.warn(`[spaceEngine] "${cfg.path}" loaded but contained NO meshes — check the file itself.`);
        }
        model.scale.setScalar(cfg.scale);
        scene.add(model);
        resolve(model);
      },
      undefined,
      (error) => {
        console.error(`[spaceEngine] FAILED to load "${cfg.path}":`, error);
        reject(error);
      }
    );
  });
}
