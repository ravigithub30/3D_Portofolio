// ui/interactiveButtons.js
import * as THREE from 'three';

// ============ BUTTON CONFIG ============
// Tweak position/size here until each invisible plane lines up over its word.
// Turn on DEBUG_VISIBLE to see the planes while you position them.
const DEBUG_VISIBLE = true; // set to false once buttons are aligned

export const BUTTON_DEFS = [
    {
        id: 'profile',
        position: { x: -2.9, y: 9.20, z: 0.4 },
        size: { w: 1.9, h: 0.50 },
        rotation: { x: 0, y: 0, z: 0 }, // match the board's rotation if it's angled
    },
    {
        id: 'project',
        position: { x: -2.9, y: 8.20, z: 0.4 },
        size: { w: 1.9, h: 0.50 },
        rotation: { x: 0, y: 0, z: 0 },
    },
    {
        id: 'contact',
        position: { x: -2.9, y: 7.30, z: 0.4 },
        size: { w: 1.9, h: 0.50 },
        rotation: { x: 0, y: 0, z: 0 },
    },
];

export function setupInteractiveButtons(scene, camera, renderer, onButtonClick) {
    const clickableMeshes = [];

    BUTTON_DEFS.forEach((def) => {
        const geometry = new THREE.PlaneGeometry(def.size.w, def.size.h);
        const material = new THREE.MeshBasicMaterial({
            color: DEBUG_VISIBLE ? 0x00ff00 : 0xffffff,
            transparent: true,
            opacity: DEBUG_VISIBLE ? 0.001 : 0.0,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(def.position.x, def.position.y, def.position.z);
        mesh.rotation.set(
            THREE.MathUtils.degToRad(def.rotation.x),
            THREE.MathUtils.degToRad(def.rotation.y),
            THREE.MathUtils.degToRad(def.rotation.z)
        );
        mesh.userData.buttonId = def.id;
        mesh.renderOrder = 999; // draw on top so raycasts/visuals aren't blocked by nearby geometry

        scene.add(mesh);
        clickableMeshes.push(mesh);
    });

    // ---- Raycasting setup ----
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function getPointerNDC(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    // Click handling
    renderer.domElement.addEventListener('click', (event) => {
        getPointerNDC(event);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(clickableMeshes, false);

        if (hits.length > 0) {
            const id = hits[0].object.userData.buttonId;
            onButtonClick(id, hits[0].object);
        }
    });

    // Hover -> pointer cursor
    renderer.domElement.addEventListener('mousemove', (event) => {
        getPointerNDC(event);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(clickableMeshes, false);
        renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
    });

    return clickableMeshes;
}