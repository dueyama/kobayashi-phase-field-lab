import * as THREE from 'three';
import { buildIsosurfaceMesh } from '../simulation/isosurface';
import { temperatureToColor } from './colorMaps';

interface IsosurfaceGeometryOptions {
  mapIndex?: (x: number, y: number, z: number) => number;
}

export function buildIsosurfaceGeometry(
  phi: Float32Array,
  temperature: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  iso = 0.5,
  stride = 1,
  options: IsosurfaceGeometryOptions = {}
): THREE.BufferGeometry {
  const scale = 1 / Math.max(nx, ny, nz);
  const mesh = buildIsosurfaceMesh(phi, temperature, nx, ny, nz, {
    iso,
    stride,
    cellSize: scale,
    originX: -nx * scale * 0.5,
    originY: -ny * scale * 0.5,
    originZ: -nz * scale * 0.5,
    mapIndex: options.mapIndex
  });
  const colors = new Float32Array(mesh.temperatures.length * 3);
  for (let i = 0; i < mesh.temperatures.length; i += 1) {
    const [r, g, b] = temperatureToColor(mesh.temperatures[i]);
    colors[i * 3] = Math.max(r / 255, 0.66);
    colors[i * 3 + 1] = Math.max(g / 255, 0.78);
    colors[i * 3 + 2] = Math.max(b / 255, 0.9);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
