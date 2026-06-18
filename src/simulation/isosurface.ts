import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

import { index3D } from './fields';

const cubeEdgeTable = edgeTable as unknown as Int32Array;
const cubeTriTable = triTable as unknown as Int32Array;

export interface IsosurfaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  temperatures: Float32Array;
  triangleCount: number;
}

export interface IsosurfaceOptions {
  iso?: number;
  stride?: number;
  cellSize?: number;
  originX?: number;
  originY?: number;
  originZ?: number;
  mapIndex?: (x: number, y: number, z: number) => number;
  capBoundaries?: boolean;
  outsideValue?: number;
}

interface Sample {
  x: number;
  y: number;
  z: number;
  value: number;
  temperature: number;
  nx: number;
  ny: number;
  nz: number;
}

interface Vertex {
  x: number;
  y: number;
  z: number;
  temperature: number;
  nx: number;
  ny: number;
  nz: number;
}

const cubeCorners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1]
] as const;

const marchingCubeEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
] as const;

export function buildIsosurfaceMesh(
  phi: Float32Array,
  temperature: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  options: IsosurfaceOptions = {}
): IsosurfaceMesh {
  const iso = options.iso ?? 0.5;
  const stride = Math.max(1, Math.round(options.stride ?? 1));
  const cellSize = options.cellSize ?? 1;
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const originZ = options.originZ ?? 0;
  const mapIndex = options.mapIndex ?? ((x: number, y: number, z: number) => index3D(x, y, z, nx, ny));
  const outsideValue = options.outsideValue ?? 0;
  const capBoundaries = options.capBoundaries ?? false;
  const start = capBoundaries ? -stride : 0;
  const endX = capBoundaries ? nx - stride : nx - stride - 1;
  const endY = capBoundaries ? ny - stride : ny - stride - 1;
  const endZ = capBoundaries ? nz - stride : nz - stride - 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const temperatures: number[] = [];

  for (let z = start; z <= endZ; z += stride) {
    for (let y = start; y <= endY; y += stride) {
      for (let x = start; x <= endX; x += stride) {
        const samples = sampleCube(phi, temperature, x, y, z, stride, cellSize, originX, originY, originZ, nx, ny, nz, mapIndex, outsideValue);
        let cubeIndex = 0;
        for (let corner = 0; corner < samples.length; corner += 1) {
          if (samples[corner].value >= iso) cubeIndex |= 1 << corner;
        }
        const bits = cubeEdgeTable[cubeIndex];
        if (bits === 0) continue;

        const vertices: Array<Vertex | undefined> = new Array(12);
        for (let edge = 0; edge < marchingCubeEdges.length; edge += 1) {
          if ((bits & (1 << edge)) === 0) continue;
          const [a, b] = marchingCubeEdges[edge];
          vertices[edge] = interpolate(samples[a], samples[b], iso);
        }

        const outward = cubeOutwardNormal(samples);
        const tableOffset = cubeIndex << 4;
        for (let i = 0; cubeTriTable[tableOffset + i] !== -1; i += 3) {
          const a = vertices[cubeTriTable[tableOffset + i]];
          const b = vertices[cubeTriTable[tableOffset + i + 1]];
          const c = vertices[cubeTriTable[tableOffset + i + 2]];
          if (!a || !b || !c) continue;
          pushTriangle(a, b, c, outward, positions, normals, temperatures);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    temperatures: new Float32Array(temperatures),
    triangleCount: positions.length / 9
  };
}

function sampleCube(
  phi: Float32Array,
  temperature: Float32Array,
  x: number,
  y: number,
  z: number,
  stride: number,
  cellSize: number,
  originX: number,
  originY: number,
  originZ: number,
  nx: number,
  ny: number,
  nz: number,
  mapIndex: (x: number, y: number, z: number) => number,
  outsideValue: number
): Sample[] {
  return cubeCorners.map(([ox, oy, oz]) => {
    const gx = x + ox * stride;
    const gy = y + oy * stride;
    const gz = z + oz * stride;
    const outside = gx < 0 || gy < 0 || gz < 0 || gx >= nx || gy >= ny || gz >= nz;
    const index = outside ? -1 : mapIndex(gx, gy, gz);
    return {
      x: originX + gx * cellSize,
      y: originY + gy * cellSize,
      z: originZ + gz * cellSize,
      value: outside ? outsideValue : phi[index],
      temperature: outside ? 0 : (temperature[index] ?? 0),
      ...sampleOutwardNormal(phi, gx, gy, gz, nx, ny, nz, mapIndex)
    };
  });
}

function interpolate(a: Sample, b: Sample, iso: number): Vertex {
  const denominator = b.value - a.value;
  const t = Math.max(0, Math.min(1, Math.abs(denominator) < 1e-12 ? 0.5 : (iso - a.value) / denominator));
  const normal = normalize([
    a.nx + (b.nx - a.nx) * t,
    a.ny + (b.ny - a.ny) * t,
    a.nz + (b.nz - a.nz) * t
  ]);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    temperature: a.temperature + (b.temperature - a.temperature) * t,
    nx: normal[0],
    ny: normal[1],
    nz: normal[2]
  };
}

function pushTriangle(
  a: Vertex,
  b: Vertex,
  c: Vertex,
  outward: readonly [number, number, number],
  positions: number[],
  normals: number[],
  temperatures: number[]
): void {
  const normal = triangleNormal(a, b, c);
  const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];
  const vertices = dot < 0 ? [a, c, b] : [a, b, c];
  const orientedNormal: [number, number, number] = dot < 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
  const averageVertexNormal = normalize([
    a.nx + b.nx + c.nx,
    a.ny + b.ny + c.ny,
    a.nz + b.nz + c.nz
  ]);
  const normalSign =
    averageVertexNormal[0] * orientedNormal[0] +
      averageVertexNormal[1] * orientedNormal[1] +
      averageVertexNormal[2] * orientedNormal[2] <
    0
      ? -1
      : 1;

  for (const vertex of vertices) {
    positions.push(vertex.x, vertex.y, vertex.z);
    normals.push(vertex.nx * normalSign, vertex.ny * normalSign, vertex.nz * normalSign);
    temperatures.push(vertex.temperature);
  }
}

function triangleNormal(a: Vertex, b: Vertex, c: Vertex): [number, number, number] {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return normalize([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
}

function cubeOutwardNormal(samples: Sample[]): [number, number, number] {
  const gx =
    (samples[1].value + samples[2].value + samples[5].value + samples[6].value -
      samples[0].value -
      samples[3].value -
      samples[4].value -
      samples[7].value) /
    4;
  const gy =
    (samples[2].value + samples[3].value + samples[6].value + samples[7].value -
      samples[0].value -
      samples[1].value -
      samples[4].value -
      samples[5].value) /
    4;
  const gz =
    (samples[4].value + samples[5].value + samples[6].value + samples[7].value -
      samples[0].value -
      samples[1].value -
      samples[2].value -
      samples[3].value) /
    4;
  return normalize([-gx, -gy, -gz]);
}

function normalize(vector: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-12) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function sampleOutwardNormal(
  phi: Float32Array,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  mapIndex: (x: number, y: number, z: number) => number
): { nx: number; ny: number; nz: number } {
  const gx = valueAtClamped(phi, x + 1, y, z, nx, ny, nz, mapIndex) - valueAtClamped(phi, x - 1, y, z, nx, ny, nz, mapIndex);
  const gy = valueAtClamped(phi, x, y + 1, z, nx, ny, nz, mapIndex) - valueAtClamped(phi, x, y - 1, z, nx, ny, nz, mapIndex);
  const gz = valueAtClamped(phi, x, y, z + 1, nx, ny, nz, mapIndex) - valueAtClamped(phi, x, y, z - 1, nx, ny, nz, mapIndex);
  const normal = normalize([-gx, -gy, -gz]);
  return { nx: normal[0], ny: normal[1], nz: normal[2] };
}

function valueAtClamped(
  field: Float32Array,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  mapIndex: (x: number, y: number, z: number) => number
): number {
  const cx = clamp(Math.round(x), 0, nx - 1);
  const cy = clamp(Math.round(y), 0, ny - 1);
  const cz = clamp(Math.round(z), 0, nz - 1);
  return field[mapIndex(cx, cy, cz)] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
