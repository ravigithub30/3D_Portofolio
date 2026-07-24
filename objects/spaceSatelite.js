import { GLTFLoader } from 'https://unpkg.com/three@latest/examples/jsm/loaders/GLTFLoader.js';
import { makeToonRimMaterial } from '../materials/toonRimMaterial.js';


const CONFIG = {
  path: './3d_model/SpaceSatelite.glb',
  scale: 0.5,
  materialOptions: {
    baseColor: 0x645C6B,
    shadowColor: 0x322F33,
    rimColor: 0xE5E7FF,
    rimStart: 0.8,  // fresnel can never reach this high — effectively disables the rim
    rimEnd: 1.2, // black outline look, baked into the shader — no separate outline mesh needed
  },
};

export function addSpaceSatelite(scene, overrides = {}) {
  const cfg = { ...CONFIG, ...overrides };
  const material = makeToonRimMaterial(cfg.materialOptions);
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
