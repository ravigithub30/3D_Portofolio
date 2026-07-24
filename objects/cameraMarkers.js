// objects/cameraMarkers.js
import { GLTFLoader } from 'https://unpkg.com/three@latest/examples/jsm/loaders/GLTFLoader.js';

export function loadCameraMarkers(path) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
            path,
            (gltf) => {
                const markers = {};
                gltf.scene.traverse((child) => {
                    // Empties import as plain Object3D (no geometry) — meshes have .isMesh
                    if (!child.isMesh) {
                        markers[child.name] = child;
                    }
                });
                console.log('Loaded camera markers:', Object.keys(markers));
                resolve(markers);
            },
            undefined,
            reject
        );
    });
}