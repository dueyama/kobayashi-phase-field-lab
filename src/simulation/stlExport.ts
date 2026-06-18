import { buildIsosurfaceMesh } from './isosurface';
import { createXYMirrorGrid } from './mirrorGrid';
import type { PhaseFieldConfig, SimulationSnapshot } from './types';

interface StlExportOptions {
  iso?: number;
  stride?: number;
  mirrorXY?: boolean;
  smoothIterations?: number;
  smoothLambda?: number;
  smoothMu?: number;
  weldTolerance?: number;
}

interface IndexedMesh {
  positions: Float64Array;
  indices: Uint32Array;
  triangleCount: number;
  vertexCount: number;
}

export function createIsosurfaceStlBlob(snapshot: SimulationSnapshot, config: PhaseFieldConfig, options: StlExportOptions = {}): Blob {
  if (snapshot.dimension !== '3d') {
    throw new Error('STL export is only available for 3D snapshots.');
  }
  const iso = options.iso ?? 0.5;
  const stride = Math.max(1, Math.round(options.stride ?? 1));
  const mirrorXY = options.mirrorXY ?? false;
  const smoothIterations = Math.max(0, Math.round(options.smoothIterations ?? 4));
  const grid = createXYMirrorGrid(snapshot, config, mirrorXY);
  const mesh = buildIsosurfaceMesh(snapshot.phi, snapshot.temperature, grid.nx, grid.ny, grid.nz, {
    iso,
    stride,
    cellSize: config.dx,
    originX: mirrorXY ? -Math.floor(grid.nx / 2) * config.dx : 0,
    originY: mirrorXY ? -Math.floor(grid.ny / 2) * config.dx : 0,
    originZ: 0,
    mapIndex: grid.mapIndex,
    capBoundaries: true,
    outsideValue: 0
  });

  const bytes = new Uint8Array(84 + mesh.triangleCount * 50);
  const view = new DataView(bytes.buffer);
  writeHeader(bytes, view, mesh.triangleCount, iso, stride, mirrorXY, smoothIterations);
  if (smoothIterations > 0) {
    const indexedMesh = weldTriangleMesh(mesh.positions, options.weldTolerance ?? 1e-7);
    smoothIndexedMesh(indexedMesh, {
      iterations: smoothIterations,
      lambda: options.smoothLambda ?? 0.35,
      mu: options.smoothMu ?? -0.36
    });
    writeIndexedTriangles(view, indexedMesh);
  } else {
    writeTriangles(view, mesh.positions, mesh.normals);
  }
  return new Blob([bytes as unknown as BlobPart], { type: 'model/stl' });
}

function writeHeader(
  bytes: Uint8Array,
  view: DataView,
  triangleCount: number,
  iso: number,
  stride: number,
  mirrorXY: boolean,
  smoothIterations: number
): void {
  const smoothLabel = smoothIterations > 0 ? ` smooth=${smoothIterations}` : '';
  const text = `Kobayashi phase-field isosurface STL iso=${iso} stride=${stride} mirrorXY=${mirrorXY}${smoothLabel}`;
  const encoded = new TextEncoder().encode(text.slice(0, 80));
  bytes.set(encoded, 0);
  view.setUint32(80, triangleCount, true);
}

function writeTriangles(view: DataView, positions: Float32Array, normals: Float32Array): void {
  let offset = 84;
  for (let triangle = 0; triangle < positions.length / 9; triangle += 1) {
    const normalOffset = triangle * 9;
    writeVector(view, offset, normals[normalOffset], normals[normalOffset + 1], normals[normalOffset + 2]);
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const positionOffset = triangle * 9 + vertex * 3;
      writeVector(view, offset, positions[positionOffset], positions[positionOffset + 1], positions[positionOffset + 2]);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  if (offset !== view.byteLength) {
    throw new Error('STL writer byte count mismatch.');
  }
}

function weldTriangleMesh(positions: Float32Array, tolerance: number): IndexedMesh {
  const inverseTolerance = 1 / Math.max(tolerance, 1e-12);
  const vertexMap = new Map<string, number>();
  const weldedPositions: number[] = [];
  const indices = new Uint32Array(positions.length / 3);

  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const offset = vertex * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const key = `${Math.round(x * inverseTolerance)},${Math.round(y * inverseTolerance)},${Math.round(z * inverseTolerance)}`;
    let weldedIndex = vertexMap.get(key);
    if (weldedIndex === undefined) {
      weldedIndex = weldedPositions.length / 3;
      weldedPositions.push(x, y, z);
      vertexMap.set(key, weldedIndex);
    }
    indices[vertex] = weldedIndex;
  }

  return {
    positions: Float64Array.from(weldedPositions),
    indices,
    triangleCount: positions.length / 9,
    vertexCount: weldedPositions.length / 3
  };
}

function smoothIndexedMesh(mesh: IndexedMesh, options: { iterations: number; lambda: number; mu: number }): void {
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    laplacianPass(mesh, options.lambda);
    laplacianPass(mesh, options.mu);
  }
}

function laplacianPass(mesh: IndexedMesh, amount: number): void {
  if (amount === 0) return;
  const sums = new Float64Array(mesh.positions.length);
  const counts = new Uint32Array(mesh.vertexCount);

  const addNeighbor = (target: number, source: number) => {
    const targetOffset = target * 3;
    const sourceOffset = source * 3;
    sums[targetOffset] += mesh.positions[sourceOffset];
    sums[targetOffset + 1] += mesh.positions[sourceOffset + 1];
    sums[targetOffset + 2] += mesh.positions[sourceOffset + 2];
    counts[target] += 1;
  };

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i];
    const b = mesh.indices[i + 1];
    const c = mesh.indices[i + 2];
    addNeighbor(a, b);
    addNeighbor(a, c);
    addNeighbor(b, a);
    addNeighbor(b, c);
    addNeighbor(c, a);
    addNeighbor(c, b);
  }

  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const count = counts[vertex];
    if (count === 0) continue;
    const offset = vertex * 3;
    mesh.positions[offset] += amount * (sums[offset] / count - mesh.positions[offset]);
    mesh.positions[offset + 1] += amount * (sums[offset + 1] / count - mesh.positions[offset + 1]);
    mesh.positions[offset + 2] += amount * (sums[offset + 2] / count - mesh.positions[offset + 2]);
  }
}

function writeIndexedTriangles(view: DataView, mesh: IndexedMesh): void {
  let offset = 84;
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
    const indexOffset = triangle * 3;
    const aOffset = mesh.indices[indexOffset] * 3;
    const bOffset = mesh.indices[indexOffset + 1] * 3;
    const cOffset = mesh.indices[indexOffset + 2] * 3;
    const ax = mesh.positions[aOffset];
    const ay = mesh.positions[aOffset + 1];
    const az = mesh.positions[aOffset + 2];
    const bx = mesh.positions[bOffset];
    const by = mesh.positions[bOffset + 1];
    const bz = mesh.positions[bOffset + 2];
    const cx = mesh.positions[cOffset];
    const cy = mesh.positions[cOffset + 1];
    const cz = mesh.positions[cOffset + 2];
    const normal = triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);

    writeVector(view, offset, normal[0], normal[1], normal[2]);
    offset += 12;
    writeVector(view, offset, ax, ay, az);
    offset += 12;
    writeVector(view, offset, bx, by, bz);
    offset += 12;
    writeVector(view, offset, cx, cy, cz);
    offset += 12;
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  if (offset !== view.byteLength) {
    throw new Error('STL writer byte count mismatch.');
  }
}

function triangleNormal(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): [number, number, number] {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  return normalize(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

function writeVector(view: DataView, offset: number, x: number, y: number, z: number): void {
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, z, true);
}
