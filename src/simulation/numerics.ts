import { index2D, index3D, sample2D, sample3D } from './fields';
import type { BoundaryCondition, TemperatureSolver } from './types';

export interface ImplicitTemperature2DWorkspace {
  scratch: Float32Array;
  diagonal: Float32Array;
  residual: Float32Array;
  direction: Float32Array;
  operator: Float32Array;
  preconditioned: Float32Array;
  diagonalKey?: string;
}

export interface ImplicitTemperature2DOptions {
  method?: TemperatureSolver;
  iterations?: number;
  tolerance?: number;
  omega?: number;
}

export interface ImplicitTemperature2DResult {
  method: TemperatureSolver;
  iterations: number;
  residual: number;
}

export interface ImplicitTemperature3DWorkspace {
  scratch: Float32Array;
  diagonal: Float32Array;
  residual: Float32Array;
  direction: Float32Array;
  operator: Float32Array;
  preconditioned: Float32Array;
  diagonalKey?: string;
}

export interface ImplicitTemperature3DOptions {
  method?: TemperatureSolver;
  iterations?: number;
  tolerance?: number;
  omega?: number;
}

export interface ImplicitTemperature3DResult {
  method: TemperatureSolver;
  iterations: number;
  residual: number;
}

function sample2DBoundary(
  field: Float32Array,
  x: number,
  y: number,
  nx: number,
  ny: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number
): number {
  if (boundaryCondition === 'fixed-temperature' && (x < 0 || x >= nx || y < 0 || y >= ny)) return fixedValue;
  if (boundaryCondition === 'left-fixed-temperature' && x < 0) return fixedValue;
  return sample2D(field, x, y, nx, ny);
}

function sample3DBoundary(
  field: Float32Array,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number
): number {
  if (boundaryCondition === 'fixed-temperature' && (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz)) return fixedValue;
  if (boundaryCondition === 'left-fixed-temperature' && x < 0) return fixedValue;
  return sample3D(field, x, y, z, nx, ny, nz);
}

export function laplacian2D(
  field: Float32Array,
  x: number,
  y: number,
  nx: number,
  ny: number,
  dx: number,
  boundaryCondition: BoundaryCondition = 'neumann',
  fixedValue = 0
): number {
  const c = field[index2D(x, y, nx)];
  return (
    sample2DBoundary(field, x + 1, y, nx, ny, boundaryCondition, fixedValue) +
    sample2DBoundary(field, x - 1, y, nx, ny, boundaryCondition, fixedValue) +
    sample2DBoundary(field, x, y + 1, nx, ny, boundaryCondition, fixedValue) +
    sample2DBoundary(field, x, y - 1, nx, ny, boundaryCondition, fixedValue) -
    4 * c
  ) / (dx * dx);
}

export function laplacian3D(
  field: Float32Array,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  boundaryCondition: BoundaryCondition = 'neumann',
  fixedValue = 0
): number {
  const c = field[index3D(x, y, z, nx, ny)];
  return (
    sample3DBoundary(field, x + 1, y, z, nx, ny, nz, boundaryCondition, fixedValue) +
    sample3DBoundary(field, x - 1, y, z, nx, ny, nz, boundaryCondition, fixedValue) +
    sample3DBoundary(field, x, y + 1, z, nx, ny, nz, boundaryCondition, fixedValue) +
    sample3DBoundary(field, x, y - 1, z, nx, ny, nz, boundaryCondition, fixedValue) +
    sample3DBoundary(field, x, y, z + 1, nx, ny, nz, boundaryCondition, fixedValue) +
    sample3DBoundary(field, x, y, z - 1, nx, ny, nz, boundaryCondition, fixedValue) -
    6 * c
  ) / (dx * dx);
}

export function applyFixedBoundary2D(field: Float32Array, nx: number, ny: number, value: number): void {
  for (let x = 0; x < nx; x += 1) {
    field[index2D(x, 0, nx)] = value;
    field[index2D(x, ny - 1, nx)] = value;
  }
  for (let y = 0; y < ny; y += 1) {
    field[index2D(0, y, nx)] = value;
    field[index2D(nx - 1, y, nx)] = value;
  }
}

export function applyLeftFixedBoundary2D(field: Float32Array, nx: number, ny: number, value: number): void {
  for (let y = 0; y < ny; y += 1) {
    field[index2D(0, y, nx)] = value;
  }
}

export function applyFixedBoundary3D(field: Float32Array, nx: number, ny: number, nz: number, value: number): void {
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      field[index3D(0, y, z, nx, ny)] = value;
      field[index3D(nx - 1, y, z, nx, ny)] = value;
    }
    for (let x = 0; x < nx; x += 1) {
      field[index3D(x, 0, z, nx, ny)] = value;
      field[index3D(x, ny - 1, z, nx, ny)] = value;
    }
  }
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      field[index3D(x, y, 0, nx, ny)] = value;
      field[index3D(x, y, nz - 1, nx, ny)] = value;
    }
  }
}

export function applyLeftFixedBoundary3D(field: Float32Array, nx: number, ny: number, nz: number, value: number): void {
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      field[index3D(0, y, z, nx, ny)] = value;
    }
  }
}

export function solveImplicitTemperature2D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  dx: number,
  dt: number,
  diffusivity: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number,
  workspace?: ImplicitTemperature2DWorkspace,
  options: ImplicitTemperature2DOptions = {}
): ImplicitTemperature2DResult {
  const r = (dt * diffusivity) / (dx * dx);
  if (r === 0) {
    output.set(rhs);
    applyTemperatureBoundary2D(output, nx, ny, boundaryCondition, fixedValue);
    return { method: options.method ?? 'iccg', iterations: 0, residual: 0 };
  }

  const method = options.method ?? 'iccg';
  if (method === 'iccg' && boundaryCondition === 'neumann') {
    return solveImplicitTemperatureNeumannIccg2D(
      rhs,
      output,
      nx,
      ny,
      dx,
      dt * diffusivity,
      workspace,
      options.iterations ?? 40,
      options.tolerance ?? 1e-6
    );
  }

  solveImplicitTemperatureJacobi2D(
    rhs,
    output,
    nx,
    ny,
    dx,
    dt,
    diffusivity,
    boundaryCondition,
    fixedValue,
    workspace?.scratch,
    options.iterations ?? 12,
    options.omega ?? 1
  );
  return { method: 'jacobi', iterations: options.iterations ?? 12, residual: Number.NaN };
}

export function solveImplicitTemperature3D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dt: number,
  diffusivity: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number,
  workspace?: ImplicitTemperature3DWorkspace,
  options: ImplicitTemperature3DOptions = {}
): ImplicitTemperature3DResult {
  const r = (dt * diffusivity) / (dx * dx);
  if (r === 0) {
    output.set(rhs);
    applyTemperatureBoundary3D(output, nx, ny, nz, boundaryCondition, fixedValue);
    return { method: options.method ?? 'iccg', iterations: 0, residual: 0 };
  }

  const method = options.method ?? 'iccg';
  if (method === 'iccg' && boundaryCondition === 'neumann') {
    return solveImplicitTemperatureNeumannIccg3D(
      rhs,
      output,
      nx,
      ny,
      nz,
      dx,
      dt * diffusivity,
      workspace,
      options.iterations ?? 12,
      options.tolerance ?? 1e-6
    );
  }

  solveImplicitTemperatureJacobi3D(
    rhs,
    output,
    nx,
    ny,
    nz,
    dx,
    dt,
    diffusivity,
    boundaryCondition,
    fixedValue,
    workspace?.scratch,
    options.iterations ?? 16,
    options.omega ?? 1
  );
  return { method: 'jacobi', iterations: options.iterations ?? 16, residual: Number.NaN };
}

function solveImplicitTemperatureJacobi2D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  dx: number,
  dt: number,
  diffusivity: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number,
  scratch?: Float32Array,
  iterations = 12,
  omega = 1
): void {
  const r = (dt * diffusivity) / (dx * dx);
  output.set(rhs);
  applyTemperatureBoundary2D(output, nx, ny, boundaryCondition, fixedValue);

  let current = output;
  let next = scratch && scratch.length === output.length ? scratch : new Float32Array(output.length);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = index2D(x, y, nx);
        if (isFixedTemperatureCell2D(x, y, nx, ny, boundaryCondition)) {
          next[i] = fixedValue;
          continue;
        }

        let neighborSum = 0;
        let neighborCount = 0;

        if (x > 0) {
          neighborSum += current[index2D(x - 1, y, nx)];
          neighborCount += 1;
        }
        if (x < nx - 1) {
          neighborSum += current[index2D(x + 1, y, nx)];
          neighborCount += 1;
        }
        if (y > 0) {
          neighborSum += current[index2D(x, y - 1, nx)];
          neighborCount += 1;
        }
        if (y < ny - 1) {
          neighborSum += current[index2D(x, y + 1, nx)];
          neighborCount += 1;
        }

        const solved = (rhs[i] + r * neighborSum) / (1 + r * neighborCount);
        next[i] = current[i] + omega * (solved - current[i]);
      }
    }
    applyTemperatureBoundary2D(next, nx, ny, boundaryCondition, fixedValue);
    const previous = current;
    current = next;
    next = previous;
  }

  if (current !== output) output.set(current);
  applyTemperatureBoundary2D(output, nx, ny, boundaryCondition, fixedValue);
}

function solveImplicitTemperatureJacobi3D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dt: number,
  diffusivity: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number,
  scratch?: Float32Array,
  iterations = 16,
  omega = 1
): void {
  const r = (dt * diffusivity) / (dx * dx);
  output.set(rhs);
  applyTemperatureBoundary3D(output, nx, ny, nz, boundaryCondition, fixedValue);

  let current = output;
  let next = scratch && scratch.length === output.length ? scratch : new Float32Array(output.length);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const i = index3D(x, y, z, nx, ny);
          if (isFixedTemperatureCell3D(x, y, z, nx, ny, nz, boundaryCondition)) {
            next[i] = fixedValue;
            continue;
          }

          let neighborSum = 0;
          let neighborCount = 0;

          if (x > 0) {
            neighborSum += current[index3D(x - 1, y, z, nx, ny)];
            neighborCount += 1;
          }
          if (x < nx - 1) {
            neighborSum += current[index3D(x + 1, y, z, nx, ny)];
            neighborCount += 1;
          }
          if (y > 0) {
            neighborSum += current[index3D(x, y - 1, z, nx, ny)];
            neighborCount += 1;
          }
          if (y < ny - 1) {
            neighborSum += current[index3D(x, y + 1, z, nx, ny)];
            neighborCount += 1;
          }
          if (z > 0) {
            neighborSum += current[index3D(x, y, z - 1, nx, ny)];
            neighborCount += 1;
          }
          if (z < nz - 1) {
            neighborSum += current[index3D(x, y, z + 1, nx, ny)];
            neighborCount += 1;
          }

          const solved = (rhs[i] + r * neighborSum) / (1 + r * neighborCount);
          next[i] = current[i] + omega * (solved - current[i]);
        }
      }
    }
    applyTemperatureBoundary3D(next, nx, ny, nz, boundaryCondition, fixedValue);
    const previous = current;
    current = next;
    next = previous;
  }

  if (current !== output) output.set(current);
  applyTemperatureBoundary3D(output, nx, ny, nz, boundaryCondition, fixedValue);
}

function solveImplicitTemperatureNeumannIccg2D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  dx: number,
  diffusionStep: number,
  workspace: ImplicitTemperature2DWorkspace | undefined,
  maxIterations: number,
  tolerance: number
): ImplicitTemperature2DResult {
  const cells = nx * ny;
  const work = workspace ?? createImplicitTemperature2DWorkspace(cells);
  const { diagonal, residual, direction, operator, preconditioned } = work;
  const bNorm = dot(rhs, rhs);

  output.set(rhs);
  if (bNorm < 1e-30) {
    output.fill(0);
    return { method: 'iccg', iterations: 0, residual: 0 };
  }

  const diagonalKey = `${nx}:${ny}:${dx}:${diffusionStep}`;
  if (work.diagonalKey !== diagonalKey) {
    decomposeNeumannIccg2D(nx, ny, diagonal, 1, diffusionStep, dx, dx);
    work.diagonalKey = diagonalKey;
  }
  applyNeumannMatrix2D(nx, ny, output, operator, 1, diffusionStep, dx, dx);

  for (let i = 0; i < cells; i += 1) {
    residual[i] = rhs[i] - operator[i];
  }
  solveNeumannPreconditioner2D(nx, ny, diagonal, residual, direction, diffusionStep, dx, dx);

  let rDotZ = dot(residual, direction);
  if (Math.abs(rDotZ) < 1e-30) return { method: 'iccg', iterations: 0, residual: 0 };
  let relativeResidual = Math.sqrt(dot(residual, residual) / bNorm);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    applyNeumannMatrix2D(nx, ny, direction, operator, 1, diffusionStep, dx, dx);
    const denom = dot(direction, operator);
    if (Math.abs(denom) < 1e-30) return { method: 'iccg', iterations: iteration, residual: relativeResidual };

    const alpha = rDotZ / denom;
    for (let i = 0; i < cells; i += 1) {
      output[i] += alpha * direction[i];
      residual[i] -= alpha * operator[i];
    }

    const residualNorm = dot(residual, residual);
    relativeResidual = Math.sqrt(residualNorm / bNorm);
    if (relativeResidual <= tolerance) return { method: 'iccg', iterations: iteration + 1, residual: relativeResidual };

    solveNeumannPreconditioner2D(nx, ny, diagonal, residual, preconditioned, diffusionStep, dx, dx);
    const nextRDotZ = dot(residual, preconditioned);
    if (Math.abs(rDotZ) < 1e-30) return { method: 'iccg', iterations: iteration + 1, residual: relativeResidual };
    const beta = nextRDotZ / rDotZ;
    rDotZ = nextRDotZ;

    for (let i = 0; i < cells; i += 1) {
      direction[i] = preconditioned[i] + beta * direction[i];
    }
  }
  return { method: 'iccg', iterations: maxIterations, residual: relativeResidual };
}

function solveImplicitTemperatureNeumannIccg3D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  diffusionStep: number,
  workspace: ImplicitTemperature3DWorkspace | undefined,
  maxIterations: number,
  tolerance: number
): ImplicitTemperature3DResult {
  const cells = nx * ny * nz;
  const work = workspace ?? createImplicitTemperature3DWorkspace(cells);
  const { diagonal, residual, direction, operator, preconditioned } = work;
  const bNorm = dot(rhs, rhs);

  output.set(rhs);
  if (bNorm < 1e-30) {
    output.fill(0);
    return { method: 'iccg', iterations: 0, residual: 0 };
  }

  const diagonalKey = `${nx}:${ny}:${nz}:${dx}:${diffusionStep}`;
  if (work.diagonalKey !== diagonalKey) {
    decomposeNeumannIccg3D(nx, ny, nz, diagonal, 1, diffusionStep, dx, dx, dx);
    work.diagonalKey = diagonalKey;
  }
  applyNeumannMatrix3D(nx, ny, nz, output, operator, 1, diffusionStep, dx, dx, dx);

  for (let i = 0; i < cells; i += 1) {
    residual[i] = rhs[i] - operator[i];
  }
  solveNeumannPreconditioner3D(nx, ny, nz, diagonal, residual, direction, diffusionStep, dx, dx, dx);

  let rDotZ = dot(residual, direction);
  if (Math.abs(rDotZ) < 1e-30) return { method: 'iccg', iterations: 0, residual: 0 };
  let relativeResidual = Math.sqrt(dot(residual, residual) / bNorm);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    applyNeumannMatrix3D(nx, ny, nz, direction, operator, 1, diffusionStep, dx, dx, dx);
    const denom = dot(direction, operator);
    if (Math.abs(denom) < 1e-30) return { method: 'iccg', iterations: iteration, residual: relativeResidual };

    const alpha = rDotZ / denom;
    for (let i = 0; i < cells; i += 1) {
      output[i] += alpha * direction[i];
      residual[i] -= alpha * operator[i];
    }

    const residualNorm = dot(residual, residual);
    relativeResidual = Math.sqrt(residualNorm / bNorm);
    if (relativeResidual <= tolerance) return { method: 'iccg', iterations: iteration + 1, residual: relativeResidual };

    solveNeumannPreconditioner3D(nx, ny, nz, diagonal, residual, preconditioned, diffusionStep, dx, dx, dx);
    const nextRDotZ = dot(residual, preconditioned);
    if (Math.abs(rDotZ) < 1e-30) return { method: 'iccg', iterations: iteration + 1, residual: relativeResidual };
    const beta = nextRDotZ / rDotZ;
    rDotZ = nextRDotZ;

    for (let i = 0; i < cells; i += 1) {
      direction[i] = preconditioned[i] + beta * direction[i];
    }
  }
  return { method: 'iccg', iterations: maxIterations, residual: relativeResidual };
}

export function createImplicitTemperature2DWorkspace(cells: number): ImplicitTemperature2DWorkspace {
  return {
    scratch: new Float32Array(cells),
    diagonal: new Float32Array(cells),
    residual: new Float32Array(cells),
    direction: new Float32Array(cells),
    operator: new Float32Array(cells),
    preconditioned: new Float32Array(cells)
  };
}

export function createImplicitTemperature3DWorkspace(cells: number): ImplicitTemperature3DWorkspace {
  return {
    scratch: new Float32Array(cells),
    diagonal: new Float32Array(cells),
    residual: new Float32Array(cells),
    direction: new Float32Array(cells),
    operator: new Float32Array(cells),
    preconditioned: new Float32Array(cells)
  };
}

function applyNeumannMatrix2D(
  nx: number,
  ny: number,
  x: Float32Array,
  y: Float32Array,
  acc: number,
  diff: number,
  dx: number,
  dy: number
): void {
  const cx = -diff / (dx * dx);
  const cy = -diff / (dy * dy);
  const cxy = acc - 2 * (cx + cy);
  const cxyLeft = cxy + cx;
  const cxyRight = cxy + cx;
  const cxyBottom = cxy + cy;
  const cxyTop = cxy + cy;
  const cxyCorner = cxy + cx + cy;
  const lastX = nx - 1;
  const lastY = ny - 1;

  for (let row = 0; row < ny; row += 1) {
    for (let col = 0; col < nx; col += 1) {
      const i = index2D(col, row, nx);
      let center = cxy;
      if ((col === 0 || col === lastX) && (row === 0 || row === lastY)) {
        center = cxyCorner;
      } else if (col === 0) {
        center = cxyLeft;
      } else if (col === lastX) {
        center = cxyRight;
      } else if (row === 0) {
        center = cxyBottom;
      } else if (row === lastY) {
        center = cxyTop;
      }

      let value = center * x[i];
      if (col > 0) value += cx * x[index2D(col - 1, row, nx)];
      if (col < lastX) value += cx * x[index2D(col + 1, row, nx)];
      if (row > 0) value += cy * x[index2D(col, row - 1, nx)];
      if (row < lastY) value += cy * x[index2D(col, row + 1, nx)];
      y[i] = value;
    }
  }
}

function applyNeumannMatrix3D(
  nx: number,
  ny: number,
  nz: number,
  x: Float32Array,
  y: Float32Array,
  acc: number,
  diff: number,
  dx: number,
  dy: number,
  dz: number
): void {
  const cx = -diff / (dx * dx);
  const cy = -diff / (dy * dy);
  const cz = -diff / (dz * dz);
  const cxyz = acc - 2 * (cx + cy + cz);
  const lastX = nx - 1;
  const lastY = ny - 1;
  const lastZ = nz - 1;

  for (let z = 0; z < nz; z += 1) {
    for (let row = 0; row < ny; row += 1) {
      for (let col = 0; col < nx; col += 1) {
        const i = index3D(col, row, z, nx, ny);
        let center = cxyz;
        if (col === 0 || col === lastX) center += cx;
        if (row === 0 || row === lastY) center += cy;
        if (z === 0 || z === lastZ) center += cz;

        let value = center * x[i];
        if (col > 0) value += cx * x[index3D(col - 1, row, z, nx, ny)];
        if (col < lastX) value += cx * x[index3D(col + 1, row, z, nx, ny)];
        if (row > 0) value += cy * x[index3D(col, row - 1, z, nx, ny)];
        if (row < lastY) value += cy * x[index3D(col, row + 1, z, nx, ny)];
        if (z > 0) value += cz * x[index3D(col, row, z - 1, nx, ny)];
        if (z < lastZ) value += cz * x[index3D(col, row, z + 1, nx, ny)];
        y[i] = value;
      }
    }
  }
}

function decomposeNeumannIccg2D(
  nx: number,
  ny: number,
  diagonal: Float32Array,
  acc: number,
  diff: number,
  dx: number,
  dy: number
): void {
  const cx = -diff / (dx * dx);
  const cy = -diff / (dy * dy);
  const cxy = acc - 2 * (cx + cy);
  const cxyLeft = cxy + cx;
  const cxyRight = cxy + cx;
  const cxyBottom = cxy + cy;
  const cxyTop = cxy + cy;
  const cxyCorner = cxy + cx + cy;
  const x4 = cx * cx;
  const y4 = cy * cy;
  const n = nx * ny;

  let i = 0;
  diagonal[i] = 1 / cxyCorner;

  for (i = 1; i < nx - 1; i += 1) {
    diagonal[i] = 1 / (cxyBottom - diagonal[i - 1] * x4);
  }

  i = nx - 1;
  diagonal[i] = 1 / (cxyCorner - diagonal[i - 1] * x4);

  for (let row = 1; row < ny - 1; row += 1) {
    i = nx * row;
    diagonal[i] = 1 / (cxyLeft - diagonal[i - nx] * y4);

    for (i = nx * row + 1; i < nx * (row + 1) - 1; i += 1) {
      diagonal[i] = 1 / (cxy - diagonal[i - 1] * x4 - diagonal[i - nx] * y4);
    }

    i = nx * (row + 1) - 1;
    diagonal[i] = 1 / (cxyRight - diagonal[i - 1] * x4 - diagonal[i - nx] * y4);
  }

  i = n - nx;
  diagonal[i] = 1 / (cxyCorner - diagonal[i - nx] * y4);

  for (i = n - nx + 1; i < n - 1; i += 1) {
    diagonal[i] = 1 / (cxyTop - diagonal[i - 1] * x4 - diagonal[i - nx] * y4);
  }

  i = n - 1;
  diagonal[i] = 1 / (cxyCorner - diagonal[i - 1] * x4 - diagonal[i - nx] * y4);
}

function decomposeNeumannIccg3D(
  nx: number,
  ny: number,
  nz: number,
  diagonal: Float32Array,
  acc: number,
  diff: number,
  dx: number,
  dy: number,
  dz: number
): void {
  const cx = -diff / (dx * dx);
  const cy = -diff / (dy * dy);
  const cz = -diff / (dz * dz);
  const cxyz = acc - 2 * (cx + cy + cz);
  const x4 = cx * cx;
  const y4 = cy * cy;
  const z4 = cz * cz;
  const plane = nx * ny;
  const lastX = nx - 1;
  const lastY = ny - 1;
  const lastZ = nz - 1;

  for (let z = 0; z < nz; z += 1) {
    for (let row = 0; row < ny; row += 1) {
      for (let col = 0; col < nx; col += 1) {
        const i = index3D(col, row, z, nx, ny);
        let center = cxyz;
        if (col === 0 || col === lastX) center += cx;
        if (row === 0 || row === lastY) center += cy;
        if (z === 0 || z === lastZ) center += cz;

        let previousContribution = 0;
        if (col > 0) previousContribution += diagonal[i - 1] * x4;
        if (row > 0) previousContribution += diagonal[i - nx] * y4;
        if (z > 0) previousContribution += diagonal[i - plane] * z4;
        diagonal[i] = 1 / (center - previousContribution);
      }
    }
  }
}

function solveNeumannPreconditioner2D(
  nx: number,
  ny: number,
  diagonal: Float32Array,
  residual: Float32Array,
  output: Float32Array,
  diff: number,
  dx: number,
  dy: number
): void {
  const cx = -diff / (dx * dx);
  const cy = -diff / (dy * dy);
  const n = nx * ny;

  let i = 0;
  output[i] = diagonal[i] * residual[i];

  for (i = 1; i < nx; i += 1) {
    output[i] = diagonal[i] * (residual[i] - cx * output[i - 1]);
  }

  for (let row = 1; row < ny - 1; row += 1) {
    i = nx * row;
    output[i] = diagonal[i] * (residual[i] - cy * output[i - nx]);

    for (i = nx * row + 1; i < nx * (row + 1); i += 1) {
      output[i] = diagonal[i] * (residual[i] - cx * output[i - 1] - cy * output[i - nx]);
    }
  }

  i = n - nx;
  output[i] = diagonal[i] * (residual[i] - cy * output[i - nx]);

  for (i = n - nx + 1; i < n; i += 1) {
    output[i] = diagonal[i] * (residual[i] - cx * output[i - 1] - cy * output[i - nx]);
  }

  for (i = n - 2; i >= n - nx; i -= 1) {
    output[i] -= diagonal[i] * cx * output[i + 1];
  }

  for (let row = ny - 2; row >= 0; row -= 1) {
    i = nx * (row + 1) - 1;
    output[i] -= diagonal[i] * cy * output[i + nx];

    for (i = nx * (row + 1) - 2; i >= nx * row; i -= 1) {
      output[i] -= diagonal[i] * (cx * output[i + 1] + cy * output[i + nx]);
    }
  }
}

function solveNeumannPreconditioner3D(
  nx: number,
  ny: number,
  nz: number,
  diagonal: Float32Array,
  residual: Float32Array,
  output: Float32Array,
  diff: number,
  dx: number,
  dy: number,
  dz: number
): void {
  const cx = -diff / (dx * dx);
  const cy = -diff / (dy * dy);
  const cz = -diff / (dz * dz);
  const plane = nx * ny;

  for (let z = 0; z < nz; z += 1) {
    for (let row = 0; row < ny; row += 1) {
      for (let col = 0; col < nx; col += 1) {
        const i = index3D(col, row, z, nx, ny);
        let value = residual[i];
        if (col > 0) value -= cx * output[i - 1];
        if (row > 0) value -= cy * output[i - nx];
        if (z > 0) value -= cz * output[i - plane];
        output[i] = diagonal[i] * value;
      }
    }
  }

  for (let z = nz - 1; z >= 0; z -= 1) {
    for (let row = ny - 1; row >= 0; row -= 1) {
      for (let col = nx - 1; col >= 0; col -= 1) {
        const i = index3D(col, row, z, nx, ny);
        let correction = 0;
        if (col < nx - 1) correction += cx * output[i + 1];
        if (row < ny - 1) correction += cy * output[i + nx];
        if (z < nz - 1) correction += cz * output[i + plane];
        output[i] -= diagonal[i] * correction;
      }
    }
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

function isFixedTemperatureCell2D(
  x: number,
  y: number,
  nx: number,
  ny: number,
  boundaryCondition: BoundaryCondition
): boolean {
  if (boundaryCondition === 'fixed-temperature') return x === 0 || x === nx - 1 || y === 0 || y === ny - 1;
  if (boundaryCondition === 'left-fixed-temperature') return x === 0;
  return false;
}

function isFixedTemperatureCell3D(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  boundaryCondition: BoundaryCondition
): boolean {
  if (boundaryCondition === 'fixed-temperature') {
    return x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1;
  }
  if (boundaryCondition === 'left-fixed-temperature') return x === 0;
  return false;
}

function applyTemperatureBoundary2D(
  field: Float32Array,
  nx: number,
  ny: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number
): void {
  if (boundaryCondition === 'fixed-temperature') {
    applyFixedBoundary2D(field, nx, ny, fixedValue);
  } else if (boundaryCondition === 'left-fixed-temperature') {
    applyLeftFixedBoundary2D(field, nx, ny, fixedValue);
  }
}

function applyTemperatureBoundary3D(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  boundaryCondition: BoundaryCondition,
  fixedValue: number
): void {
  if (boundaryCondition === 'fixed-temperature') {
    applyFixedBoundary3D(field, nx, ny, nz, fixedValue);
  } else if (boundaryCondition === 'left-fixed-temperature') {
    applyLeftFixedBoundary3D(field, nx, ny, nz, fixedValue);
  }
}

export function gradient2D(
  field: Float32Array,
  x: number,
  y: number,
  nx: number,
  ny: number,
  dx: number
): { gx: number; gy: number } {
  return {
    gx: (sample2D(field, x + 1, y, nx, ny) - sample2D(field, x - 1, y, nx, ny)) / (2 * dx),
    gy: (sample2D(field, x, y + 1, nx, ny) - sample2D(field, x, y - 1, nx, ny)) / (2 * dx)
  };
}

export function gradient3D(
  field: Float32Array,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  dx: number
): { gx: number; gy: number; gz: number } {
  return {
    gx: (sample3D(field, x + 1, y, z, nx, ny, nz) - sample3D(field, x - 1, y, z, nx, ny, nz)) / (2 * dx),
    gy: (sample3D(field, x, y + 1, z, nx, ny, nz) - sample3D(field, x, y - 1, z, nx, ny, nz)) / (2 * dx),
    gz: (sample3D(field, x, y, z + 1, nx, ny, nz) - sample3D(field, x, y, z - 1, nx, ny, nz)) / (2 * dx)
  };
}

export function kobayashiDrive(
  temperature: number,
  equilibriumTemperature: number,
  alpha: number,
  gamma: number
): number {
  return (alpha / Math.PI) * Math.atan(gamma * (equilibriumTemperature - temperature));
}

export function reactionTerm(
  phi: number,
  temperature: number,
  equilibriumTemperature: number,
  alpha = 0.9,
  gamma = 10
): number {
  const drive = kobayashiDrive(temperature, equilibriumTemperature, alpha, gamma);
  return phi * (1 - phi) * (phi - 0.5 + drive);
}

export function localizedNoise(phi: number, amplitude: number, signedNoise: number): number {
  return amplitude * phi * (1 - phi) * signedNoise;
}
