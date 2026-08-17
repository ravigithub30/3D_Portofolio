import { GLTFLoader } from 'https://unpkg.com/three@latest/examples/jsm/loaders/GLTFLoader.js';
import { makeThrusterMaterial } from '../materials/thrusterFlameMaterial.js';

const CONFIG = {
  path: './3d_model/SpaceThrusterFlame.glb',
  scale: 0.5,
  diskOptions: {}, // pass overrides here if you want to retune colors/speed
};

export function addSpaceThrusterFlame(scene, overrides = {}) {
  const cfg = { ...CONFIG, ...overrides };
  const material = makeThrusterMaterial({ perpScrollSpeed: -0.2 });
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      cfg.path,
      (gltf) => {
        const model = gltf.scene;
        const meshes = [];
        model.traverse((child) => { if (child.isMesh) meshes.push(child); });
        meshes.forEach((child) => { child.material = material; });

        model.scale.setScalar(cfg.scale);
        scene.add(model);

        // Caller ticks this each frame — it advances uTime, NOT model.rotation.
        model.userData.updateAccretionDisk = (elapsedTime) => {
          material.uniforms.uTime.value = elapsedTime;
        };

        resolve(model);
      },
      undefined,
      (error) => reject(error)
    );
  });
}