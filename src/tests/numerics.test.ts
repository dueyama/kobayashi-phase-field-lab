import { describe, expect, it } from 'vitest';
import { anisotropy2D, anisotropy3D, anisotropySigma2D, anisotropySigma3DFourFold } from '../simulation/anisotropy';
import { fillSmoothLeftWall, fillSmoothWalls, index2D, index3D } from '../simulation/fields';
import { deterministicNoise } from '../simulation/rng';
import {
  applyFixedBoundary2D,
  applyFixedBoundary3D,
  applyLeftFixedBoundary2D,
  applyLeftFixedBoundary3D,
  kobayashiDrive,
  laplacian2D,
  laplacian3D,
  localizedNoise,
  reactionTerm,
  solveImplicitTemperature2D,
  solveImplicitTemperature3D
} from '../simulation/numerics';

describe('field indexing', () => {
  it('maps 2D coordinates to row-major indices', () => {
    expect(index2D(0, 0, 8)).toBe(0);
    expect(index2D(3, 2, 8)).toBe(19);
  });

  it('maps 3D coordinates to row-major indices', () => {
    expect(index3D(0, 0, 0, 4, 5)).toBe(0);
    expect(index3D(2, 3, 1, 4, 5)).toBe(34);
  });
});

describe('initial condition helpers', () => {
  it('fits left-wall perturbation modes exactly across the full height', () => {
    const nx = 64;
    const ny = 41;
    const field = new Float32Array(nx * ny);
    fillSmoothLeftWall(field, nx, ny, 8, 0.5, 10, 5, Math.PI, 1, 0);

    const interfaceXs = Array.from({ length: ny }, (_, y) => interfaceX(field, nx, y));
    expect(interfaceXs[0]).toBeCloseTo(interfaceXs[ny - 1], 6);

    expect(interfaceXs[0]).toBeGreaterThan(interfaceXs[Math.floor(ny / 10)]);
    const troughs = interfaceXs.filter((x, y) => y > 0 && y < ny - 1 && x < interfaceXs[y - 1] && x < interfaceXs[y + 1]);
    expect(troughs).toHaveLength(5);
  });

  it('places smooth solid layers on all walls for inward Fig.3 growth', () => {
    const nx = 40;
    const ny = 40;
    const field = new Float32Array(nx * ny);
    fillSmoothWalls(field, nx, ny, 4, 1, 1, 0);

    expect(field[index2D(0, 20, nx)]).toBeGreaterThan(0.99);
    expect(field[index2D(20, 0, nx)]).toBeGreaterThan(0.99);
    expect(field[index2D(nx - 1, 20, nx)]).toBeGreaterThan(0.99);
    expect(field[index2D(20, ny - 1, nx)]).toBeGreaterThan(0.99);
    expect(field[index2D(20, 20, nx)]).toBeLessThan(1e-5);
  });
});

describe('laplacian helpers', () => {
  it('returns zero for a constant 2D field', () => {
    const field = new Float32Array(25).fill(7);
    expect(laplacian2D(field, 2, 2, 5, 5, 1)).toBeCloseTo(0);
  });

  it('returns expected value for a simple 2D quadratic', () => {
    const nx = 7;
    const ny = 7;
    const field = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        field[index2D(x, y, nx)] = x * x + y * y;
      }
    }
    expect(laplacian2D(field, 3, 3, nx, ny, 1)).toBeCloseTo(4);
  });

  it('returns zero for a constant 3D field', () => {
    const field = new Float32Array(4 * 4 * 4).fill(3);
    expect(laplacian3D(field, 2, 2, 2, 4, 4, 4, 1)).toBeCloseTo(0);
  });

  it('returns expected value for a simple 3D quadratic', () => {
    const nx = 7;
    const ny = 7;
    const nz = 7;
    const field = new Float32Array(nx * ny * nz);
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          field[index3D(x, y, z, nx, ny)] = x * x + y * y + z * z;
        }
      }
    }
    expect(laplacian3D(field, 3, 3, 3, nx, ny, nz, 1)).toBeCloseTo(6);
  });

  it('distinguishes Neumann and fixed-temperature ghost cells at 2D boundaries', () => {
    const field = new Float32Array(3 * 3).fill(10);
    expect(laplacian2D(field, 0, 1, 3, 3, 1, 'neumann')).toBeCloseTo(0);
    expect(laplacian2D(field, 0, 1, 3, 3, 1, 'fixed-temperature', 0)).toBeCloseTo(-10);
    expect(laplacian2D(field, 0, 1, 3, 3, 1, 'left-fixed-temperature', 0)).toBeCloseTo(-10);
    expect(laplacian2D(field, 1, 0, 3, 3, 1, 'left-fixed-temperature', 0)).toBeCloseTo(0);
  });

  it('distinguishes Neumann and fixed-temperature ghost cells at 3D boundaries', () => {
    const field = new Float32Array(3 * 3 * 3).fill(10);
    expect(laplacian3D(field, 0, 1, 1, 3, 3, 3, 1, 'neumann')).toBeCloseTo(0);
    expect(laplacian3D(field, 0, 1, 1, 3, 3, 3, 1, 'fixed-temperature', 0)).toBeCloseTo(-10);
    expect(laplacian3D(field, 0, 1, 1, 3, 3, 3, 1, 'left-fixed-temperature', 0)).toBeCloseTo(-10);
    expect(laplacian3D(field, 1, 0, 1, 3, 3, 3, 1, 'left-fixed-temperature', 0)).toBeCloseTo(0);
  });

  it('pins fixed-temperature boundary cells after an update', () => {
    const field2D = new Float32Array(4 * 4).fill(3);
    field2D[index2D(1, 1, 4)] = 9;
    applyFixedBoundary2D(field2D, 4, 4, -2);
    expect(field2D[index2D(0, 1, 4)]).toBe(-2);
    expect(field2D[index2D(1, 1, 4)]).toBe(9);
    applyLeftFixedBoundary2D(field2D, 4, 4, -4);
    expect(field2D[index2D(0, 2, 4)]).toBe(-4);
    expect(field2D[index2D(2, 0, 4)]).toBe(-2);

    const field3D = new Float32Array(4 * 4 * 4).fill(3);
    field3D[index3D(1, 1, 1, 4, 4)] = 9;
    applyFixedBoundary3D(field3D, 4, 4, 4, -2);
    expect(field3D[index3D(0, 1, 1, 4, 4)]).toBe(-2);
    expect(field3D[index3D(1, 1, 1, 4, 4)]).toBe(9);
    applyLeftFixedBoundary3D(field3D, 4, 4, 4, -4);
    expect(field3D[index3D(0, 2, 2, 4, 4)]).toBe(-4);
    expect(field3D[index3D(2, 0, 2, 4, 4)]).toBe(-2);
  });

  it('solves implicit 2D temperature diffusion without changing constant Neumann fields', () => {
    const nx = 8;
    const ny = 8;
    const rhs = new Float32Array(nx * ny).fill(1.25);
    const output = new Float32Array(nx * ny);

    solveImplicitTemperature2D(rhs, output, nx, ny, 0.03, 0.0002, 1, 'neumann', 0);

    for (const value of output) {
      expect(value).toBeCloseTo(1.25, 5);
    }
  });

  it('pins fixed cells in the implicit 2D temperature solve', () => {
    const nx = 8;
    const ny = 8;
    const rhs = new Float32Array(nx * ny).fill(1);
    const output = new Float32Array(nx * ny);

    solveImplicitTemperature2D(rhs, output, nx, ny, 0.03, 0.0002, 1, 'left-fixed-temperature', -2);

    for (let y = 0; y < ny; y += 1) {
      expect(output[index2D(0, y, nx)]).toBe(-2);
    }
    expect(output[index2D(4, 4, nx)]).toBeGreaterThan(-2);
    expect(output[index2D(4, 4, nx)]).toBeLessThan(1);
  });

  it('matches Jacobi and ICCG implicit 2D Neumann solves on a small source problem', () => {
    const nx = 12;
    const ny = 10;
    const rhs = new Float32Array(nx * ny).fill(0);
    rhs[index2D(5, 4, nx)] = 1;
    rhs[index2D(6, 4, nx)] = 0.5;
    const jacobi = new Float32Array(nx * ny);
    const iccg = new Float32Array(nx * ny);

    solveImplicitTemperature2D(rhs, jacobi, nx, ny, 0.03, 0.0002, 1, 'neumann', 0, undefined, {
      method: 'jacobi',
      iterations: 240
    });
    solveImplicitTemperature2D(rhs, iccg, nx, ny, 0.03, 0.0002, 1, 'neumann', 0, undefined, {
      method: 'iccg',
      iterations: 80,
      tolerance: 1e-9
    });

    expect(maxAbsDiff(jacobi, iccg)).toBeLessThan(1e-4);
  });

  it('solves implicit 3D temperature diffusion without changing constant Neumann fields', () => {
    const nx = 6;
    const ny = 5;
    const nz = 4;
    const rhs = new Float32Array(nx * ny * nz).fill(1.25);
    const output = new Float32Array(nx * ny * nz);
    const result = solveImplicitTemperature3D(rhs, output, nx, ny, nz, 0.03, 0.0002, 1, 'neumann', 0, undefined, {
      method: 'iccg',
      iterations: 80,
      tolerance: 1e-9
    });

    expect(result.method).toBe('iccg');
    expect(result.residual).toBeLessThan(1e-8);
    for (const value of output) {
      expect(value).toBeCloseTo(1.25, 5);
    }
  });

  it('solves a simple 3D Neumann diffusion point-source problem', () => {
    const nx = 7;
    const ny = 7;
    const nz = 7;
    const dx = 0.03;
    const dt = 0.0002;
    const diffusivity = 1;
    const rhs = new Float32Array(nx * ny * nz).fill(0);
    const center = index3D(3, 3, 3, nx, ny);
    rhs[center] = 1;
    const output = new Float32Array(nx * ny * nz);
    const result = solveImplicitTemperature3D(rhs, output, nx, ny, nz, dx, dt, diffusivity, 'neumann', 0, undefined, {
      method: 'iccg',
      iterations: 120,
      tolerance: 1e-9
    });

    expect(result.method).toBe('iccg');
    expect(result.residual).toBeLessThan(1e-7);
    expect(maxImplicitDiffusionResidual3D(rhs, output, nx, ny, nz, dx, dt, diffusivity)).toBeLessThan(2e-5);
    expect(sum(output)).toBeCloseTo(1, 5);
    expect(output[center]).toBeGreaterThan(output[index3D(4, 3, 3, nx, ny)]);
    expect(output[index3D(4, 3, 3, nx, ny)]).toBeCloseTo(output[index3D(2, 3, 3, nx, ny)], 5);
    expect(output[index3D(3, 4, 3, nx, ny)]).toBeCloseTo(output[index3D(3, 2, 3, nx, ny)], 5);
    expect(output[index3D(3, 3, 4, nx, ny)]).toBeCloseTo(output[index3D(3, 3, 2, nx, ny)], 5);
    expect(output[index3D(6, 6, 6, nx, ny)]).toBeGreaterThanOrEqual(0);
    expect(output[index3D(6, 6, 6, nx, ny)]).toBeLessThan(output[index3D(4, 3, 3, nx, ny)]);
  });
});

describe('noise and reaction', () => {
  it('is deterministic for the same seed, index, and step', () => {
    expect(deterministicNoise(42, 17, 3)).toBe(deterministicNoise(42, 17, 3));
    expect(deterministicNoise(42, 17, 3)).not.toBe(deterministicNoise(42, 18, 3));
  });

  it('vanishes away from the interface', () => {
    expect(localizedNoise(0, 1, 0.4)).toBe(0);
    expect(localizedNoise(1, 1, 0.4)).toBe(0);
    expect(localizedNoise(0.5, 1, 0.4)).toBeGreaterThan(0);
  });

  it('drives interface growth under positive undercooling', () => {
    expect(reactionTerm(0.5, 0, 0.25, 0.9, 10)).toBeGreaterThan(0);
    expect(reactionTerm(0.5, 0, -0.25)).toBeLessThan(0);
  });

  it('bounds Kobayashi arctangent drive by alpha over two', () => {
    expect(kobayashiDrive(-100, 1, 0.9, 10)).toBeLessThan(0.46);
    expect(kobayashiDrive(100, 1, 0.9, 10)).toBeGreaterThan(-0.46);
  });
});

describe('anisotropy helpers', () => {
  it('keeps isotropic mode neutral', () => {
    expect(anisotropy2D(1, 0, 'isotropic', 0.2, 4, 0)).toBeCloseTo(1);
    expect(anisotropy3D(1, 0, 0, 'isotropic', 0.2)).toBeCloseTo(1);
  });

  it('varies four-fold and cubic modes', () => {
    expect(anisotropy2D(1, 0, 'fourFold', 0.12, 4, 0)).not.toBeCloseTo(
      anisotropy2D(1, 1, 'fourFold', 0.12, 4, 0)
    );
    expect(anisotropy3D(1, 0, 0, 'cubic', 0.1)).not.toBeCloseTo(
      anisotropy3D(1, 1, 1, 'cubic', 0.1)
    );
  });

  it('reduces the natural 3D four-fold anisotropy to the 2D theta form on coordinate planes', () => {
    const strength = 0.03;
    const cases = [
      [1.4, 0.7, 0],
      [-0.4, 1.2, 0],
      [0, 1.1, -0.9],
      [1.7, 0, -0.3]
    ];

    for (const [gx, gy, gz] of cases) {
      if (gz === 0) {
        expect(anisotropySigma3DFourFold(gx, gy, gz, strength).sigma).toBeCloseTo(
          anisotropySigma2D(gx, gy, 'fourFold', strength, 4, 0),
          12
        );
      }
      if (gx === 0) {
        expect(anisotropySigma3DFourFold(gx, gy, gz, strength).sigma).toBeCloseTo(
          anisotropySigma2D(gy, gz, 'fourFold', strength, 4, 0),
          12
        );
      }
      if (gy === 0) {
        expect(anisotropySigma3DFourFold(gx, gy, gz, strength).sigma).toBeCloseTo(
          anisotropySigma2D(gx, gz, 'fourFold', strength, 4, 0),
          12
        );
      }
    }
  });

  it('computes the natural 3D four-fold vector derivative consistently', () => {
    const strength = 0.02;
    const gx = 0.83;
    const gy = -1.17;
    const gz = 0.41;
    const sigma = anisotropySigma3DFourFold(gx, gy, gz, strength);
    const vx = -gx;
    const vy = -gy;
    const vz = -gz;
    const h = 1e-5;
    const sigmaAtV = (x: number, y: number, z: number) => anisotropySigma3DFourFold(-x, -y, -z, strength).sigma;

    expect(vx * sigma.dSigmaDvX + vy * sigma.dSigmaDvY + vz * sigma.dSigmaDvZ).toBeCloseTo(0, 10);
    expect(sigma.dSigmaDvX).toBeCloseTo((sigmaAtV(vx + h, vy, vz) - sigmaAtV(vx - h, vy, vz)) / (2 * h), 7);
    expect(sigma.dSigmaDvY).toBeCloseTo((sigmaAtV(vx, vy + h, vz) - sigmaAtV(vx, vy - h, vz)) / (2 * h), 7);
    expect(sigma.dSigmaDvZ).toBeCloseTo((sigmaAtV(vx, vy, vz + h) - sigmaAtV(vx, vy, vz - h)) / (2 * h), 7);
  });
});

function interfaceX(field: Float32Array, nx: number, y: number): number {
  for (let x = 0; x < nx - 1; x += 1) {
    const a = field[index2D(x, y, nx)];
    const b = field[index2D(x + 1, y, nx)];
    if ((a >= 0.5 && b <= 0.5) || (a <= 0.5 && b >= 0.5)) {
      const denom = b - a;
      if (Math.abs(denom) < 1e-8) return x + 0.5;
      return x + (0.5 - a) / denom;
    }
  }
  return Number.NaN;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

function sum(values: Float32Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function maxImplicitDiffusionResidual3D(
  rhs: Float32Array,
  output: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  dt: number,
  diffusivity: number
): number {
  const r = (dt * diffusivity) / (dx * dx);
  let maxResidual = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = index3D(x, y, z, nx, ny);
        let neighborSum = 0;
        let neighborCount = 0;
        if (x > 0) {
          neighborSum += output[index3D(x - 1, y, z, nx, ny)];
          neighborCount += 1;
        }
        if (x < nx - 1) {
          neighborSum += output[index3D(x + 1, y, z, nx, ny)];
          neighborCount += 1;
        }
        if (y > 0) {
          neighborSum += output[index3D(x, y - 1, z, nx, ny)];
          neighborCount += 1;
        }
        if (y < ny - 1) {
          neighborSum += output[index3D(x, y + 1, z, nx, ny)];
          neighborCount += 1;
        }
        if (z > 0) {
          neighborSum += output[index3D(x, y, z - 1, nx, ny)];
          neighborCount += 1;
        }
        if (z < nz - 1) {
          neighborSum += output[index3D(x, y, z + 1, nx, ny)];
          neighborCount += 1;
        }
        const lhs = (1 + r * neighborCount) * output[i] - r * neighborSum;
        maxResidual = Math.max(maxResidual, Math.abs(lhs - rhs[i]));
      }
    }
  }
  return maxResidual;
}
