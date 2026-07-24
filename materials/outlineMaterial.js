// outlineMaterial.js
import * as THREE from 'three';

export function makeOutlineMaterial({
  color = 0x000000,
  thickness = 0.02,
} = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uThickness: { value: thickness },
    },
    vertexShader: `
      uniform float uThickness;
      void main() {
        vec3 inflated = position + normal * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(inflated, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    side: THREE.BackSide,
  });

  material.userData.outlineUniforms = material.uniforms;
  return material;
}

export function addOutlineToMesh(mesh, options = {}) {
  const outlineMaterial = makeOutlineMaterial(options);
  const outlineMesh = new THREE.Mesh(mesh.geometry, outlineMaterial);
  outlineMesh.name = (mesh.name || 'mesh') + '_outline';
  outlineMesh.renderOrder = mesh.renderOrder - 1;
  mesh.add(outlineMesh);
  return outlineMesh;
}