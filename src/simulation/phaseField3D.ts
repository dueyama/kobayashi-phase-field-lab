import { anisotropy3D, anisotropySigma3DFourFold } from './anisotropy';
import { clamp, computeRange, fillSmoothSphereAt, fillSphere, index3D, sample3D } from './fields';
import { deterministicNoise } from './rng';
import {
  applyFixedBoundary3D,
  applyLeftFixedBoundary3D,
  createImplicitTemperature3DWorkspace,
  gradient3D,
  type ImplicitTemperature3DWorkspace,
  laplacian3D,
  localizedNoise,
  reactionTerm,
  solveImplicitTemperature3D
} from './numerics';
import type { PhaseFieldConfig, SimulationSnapshot, StepStats } from './types';

export class PhaseField3D {
  readonly config: PhaseFieldConfig;
  readonly phi: Float32Array;
  readonly temperature: Float32Array;
  private nextPhi: Float32Array;
  private nextTemperature: Float32Array;
  private temperatureRhs: Float32Array;
  private temperatureWorkspace: ImplicitTemperature3DWorkspace;
  private dPhi: Float32Array;
  private stepIndex = 0;
  private elapsed = 0;
  private currentStats: StepStats = {
    step: 0,
    time: 0,
    minPhi: 0,
    maxPhi: 1,
    minTemperature: 0,
    maxTemperature: 0,
    unstable: false
  };

  constructor(config: PhaseFieldConfig) {
    this.config = { ...config, dimension: '3d' };
    const cells = config.nx * config.ny * config.nz;
    this.phi = new Float32Array(cells);
    this.temperature = new Float32Array(cells);
    this.nextPhi = new Float32Array(cells);
    this.nextTemperature = new Float32Array(cells);
    this.temperatureRhs = new Float32Array(cells);
    this.temperatureWorkspace = createImplicitTemperature3DWorkspace(cells);
    this.dPhi = new Float32Array(cells);
    this.reset();
  }

  reset(): void {
    const interfaceWidth = Math.max(1.5, Math.min(4, this.config.nucleusRadius * 0.2));
    if (this.config.nucleusPlacement === 'bottom-corner' || this.config.nucleusPlacement === 'bottom-corner-halfcell') {
      const center = this.config.nucleusPlacement === 'bottom-corner-halfcell' ? -0.5 : 0;
      fillSmoothSphereAt(
        this.phi,
        this.config.nx,
        this.config.ny,
        this.config.nz,
        this.config.nucleusRadius,
        center,
        center,
        center,
        interfaceWidth,
        1,
        0
      );
    } else if (this.config.nucleusPlacement === 'bottom-face-center-halfcell') {
      fillSmoothSphereAt(
        this.phi,
        this.config.nx,
        this.config.ny,
        this.config.nz,
        this.config.nucleusRadius,
        (this.config.nx - 1) * 0.5,
        (this.config.ny - 1) * 0.5,
        -0.5,
        interfaceWidth,
        1,
        0
      );
    } else {
      fillSphere(this.phi, this.config.nx, this.config.ny, this.config.nz, this.config.nucleusRadius, 1, 0);
    }
    this.temperature.fill(this.config.initialTemperature);
    this.nextPhi.fill(0);
    this.nextTemperature.fill(0);
    this.temperatureRhs.fill(0);
    this.temperatureWorkspace.scratch.fill(0);
    this.temperatureWorkspace.diagonal.fill(0);
    this.temperatureWorkspace.residual.fill(0);
    this.temperatureWorkspace.direction.fill(0);
    this.temperatureWorkspace.operator.fill(0);
    this.temperatureWorkspace.preconditioned.fill(0);
    this.dPhi.fill(0);
    this.stepIndex = 0;
    this.elapsed = 0;
    this.currentStats = this.calculateStats();
  }

  step(count = 1, statsInterval = 1): StepStats {
    for (let i = 0; i < count; i += 1) {
      this.singleStep();
      if (statsInterval < 0) continue;
      const shouldCalculateStats = statsInterval <= 0 ? i === count - 1 : (i + 1) % statsInterval === 0 || i === count - 1;
      if (shouldCalculateStats) {
        this.currentStats = this.calculateStats();
        if (this.currentStats.unstable) break;
      }
    }
    return this.currentStats;
  }

  snapshot(): SimulationSnapshot {
    return {
      dimension: '3d',
      nx: this.config.nx,
      ny: this.config.ny,
      nz: this.config.nz,
      phi: this.phi,
      temperature: this.temperature,
      step: this.stepIndex,
      time: this.elapsed,
      minPhi: this.currentStats.minPhi,
      maxPhi: this.currentStats.maxPhi,
      minTemperature: this.currentStats.minTemperature,
      maxTemperature: this.currentStats.maxTemperature
    };
  }

  private singleStep(): void {
    const { nx, ny, nz, dx, dt, tau } = this.config;
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const i = index3D(x, y, z, nx, ny);
          const phi = this.phi[i];
          const temperature = this.temperature[i];
          const diffusion = anisotropicDiffusion3D(this.phi, x, y, z, this.config);
          const reaction = reactionTerm(phi, temperature, this.config.undercooling, this.config.driveAlpha, this.config.driveGamma);
          const noise = localizedNoise(phi, this.config.noiseAmplitude, deterministicNoise(this.config.seed, i, this.stepIndex));
          const dPhi = (diffusion + reaction + noise) / tau;
          const nextPhi = clamp(phi + dt * dPhi, -0.05, 1.05);
          this.nextPhi[i] = nextPhi;
          this.dPhi[i] = (nextPhi - phi) / dt;
          this.temperatureRhs[i] = temperature + this.config.latentHeat * (nextPhi - phi);
        }
      }
    }

    solveImplicitTemperature3D(
      this.temperatureRhs,
      this.nextTemperature,
      nx,
      ny,
      nz,
      dx,
      dt,
      this.config.temperatureDiffusivity,
      this.config.boundaryCondition,
      this.config.boundaryTemperature,
      this.temperatureWorkspace,
      {
        method: this.config.temperatureSolver,
        iterations: this.config.temperatureSolverIterations,
        tolerance: this.config.temperatureSolverTolerance
      }
    );

    for (let i = 0; i < this.nextTemperature.length; i += 1) {
      this.nextTemperature[i] = clamp(this.nextTemperature[i], -4, 4);
    }

    if (this.config.boundaryCondition === 'fixed-temperature') {
      applyFixedBoundary3D(this.nextTemperature, nx, ny, nz, this.config.boundaryTemperature);
    } else if (this.config.boundaryCondition === 'left-fixed-temperature') {
      applyLeftFixedBoundary3D(this.nextTemperature, nx, ny, nz, this.config.boundaryTemperature);
    }

    this.phi.set(this.nextPhi);
    this.temperature.set(this.nextTemperature);
    this.stepIndex += 1;
    this.elapsed += dt;
  }

  private calculateStats(): StepStats {
    const phiRange = computeRange(this.phi);
    const tempRange = computeRange(this.temperature);
    const unstable =
      !Number.isFinite(phiRange.min) ||
      !Number.isFinite(phiRange.max) ||
      !Number.isFinite(tempRange.min) ||
      !Number.isFinite(tempRange.max) ||
      phiRange.min < -0.5 ||
      phiRange.max > 1.5 ||
      Math.max(Math.abs(tempRange.min), Math.abs(tempRange.max)) > 10;
    return {
      step: this.stepIndex,
      time: this.elapsed,
      minPhi: phiRange.min,
      maxPhi: phiRange.max,
      minTemperature: tempRange.min,
      maxTemperature: tempRange.max,
      unstable
    };
  }
}

function anisotropicDiffusion3D(field: Float32Array, x: number, y: number, z: number, config: PhaseFieldConfig): number {
  const { nx, ny, nz, dx, diffusivity } = config;
  if (config.anisotropyMode === 'fourFold' && config.anisotropyStrength !== 0) {
    const fluxXP = anisotropicFluxX3D(field, x, y, z, config);
    const fluxXM = anisotropicFluxX3D(field, x - 1, y, z, config);
    const fluxYP = anisotropicFluxY3D(field, x, y, z, config);
    const fluxYM = anisotropicFluxY3D(field, x, y - 1, z, config);
    const fluxZP = anisotropicFluxZ3D(field, x, y, z, config);
    const fluxZM = anisotropicFluxZ3D(field, x, y, z - 1, config);
    return (fluxXP - fluxXM + fluxYP - fluxYM + fluxZP - fluxZM) / dx;
  }

  const lapPhi = laplacian3D(field, x, y, z, nx, ny, nz, dx);
  if (config.anisotropyMode === 'isotropic' || config.anisotropyStrength === 0) return diffusivity * lapPhi;

  const grad = gradient3D(field, x, y, z, nx, ny, nz, dx);
  const anisotropy = anisotropy3D(
    grad.gx,
    grad.gy,
    grad.gz,
    config.anisotropyMode,
    config.anisotropyStrength,
    config.anisotropyFold,
    config.anisotropyAngle
  );
  return diffusivity * anisotropy * anisotropy * lapPhi;
}

function anisotropicFluxX3D(field: Float32Array, x: number, y: number, z: number, config: PhaseFieldConfig): number {
  const { nx, ny, nz, dx, diffusivity } = config;
  if (x < 0 || x >= nx - 1) return 0;
  const gx = (sample3D(field, x + 1, y, z, nx, ny, nz) - sample3D(field, x, y, z, nx, ny, nz)) / dx;
  const gy =
    (sample3D(field, x, y + 1, z, nx, ny, nz) +
      sample3D(field, x + 1, y + 1, z, nx, ny, nz) -
      sample3D(field, x, y - 1, z, nx, ny, nz) -
      sample3D(field, x + 1, y - 1, z, nx, ny, nz)) /
    (4 * dx);
  const gz =
    (sample3D(field, x, y, z + 1, nx, ny, nz) +
      sample3D(field, x + 1, y, z + 1, nx, ny, nz) -
      sample3D(field, x, y, z - 1, nx, ny, nz) -
      sample3D(field, x + 1, y, z - 1, nx, ny, nz)) /
    (4 * dx);
  return diffusivity * anisotropicFluxFromGradient3D(gx, gy, gz, config).x;
}

function anisotropicFluxY3D(field: Float32Array, x: number, y: number, z: number, config: PhaseFieldConfig): number {
  const { nx, ny, nz, dx, diffusivity } = config;
  if (y < 0 || y >= ny - 1) return 0;
  const gx =
    (sample3D(field, x + 1, y, z, nx, ny, nz) +
      sample3D(field, x + 1, y + 1, z, nx, ny, nz) -
      sample3D(field, x - 1, y, z, nx, ny, nz) -
      sample3D(field, x - 1, y + 1, z, nx, ny, nz)) /
    (4 * dx);
  const gy = (sample3D(field, x, y + 1, z, nx, ny, nz) - sample3D(field, x, y, z, nx, ny, nz)) / dx;
  const gz =
    (sample3D(field, x, y, z + 1, nx, ny, nz) +
      sample3D(field, x, y + 1, z + 1, nx, ny, nz) -
      sample3D(field, x, y, z - 1, nx, ny, nz) -
      sample3D(field, x, y + 1, z - 1, nx, ny, nz)) /
    (4 * dx);
  return diffusivity * anisotropicFluxFromGradient3D(gx, gy, gz, config).y;
}

function anisotropicFluxZ3D(field: Float32Array, x: number, y: number, z: number, config: PhaseFieldConfig): number {
  const { nx, ny, nz, dx, diffusivity } = config;
  if (z < 0 || z >= nz - 1) return 0;
  const gx =
    (sample3D(field, x + 1, y, z, nx, ny, nz) +
      sample3D(field, x + 1, y, z + 1, nx, ny, nz) -
      sample3D(field, x - 1, y, z, nx, ny, nz) -
      sample3D(field, x - 1, y, z + 1, nx, ny, nz)) /
    (4 * dx);
  const gy =
    (sample3D(field, x, y + 1, z, nx, ny, nz) +
      sample3D(field, x, y + 1, z + 1, nx, ny, nz) -
      sample3D(field, x, y - 1, z, nx, ny, nz) -
      sample3D(field, x, y - 1, z + 1, nx, ny, nz)) /
    (4 * dx);
  const gz = (sample3D(field, x, y, z + 1, nx, ny, nz) - sample3D(field, x, y, z, nx, ny, nz)) / dx;
  return diffusivity * anisotropicFluxFromGradient3D(gx, gy, gz, config).z;
}

function anisotropicFluxFromGradient3D(
  gx: number,
  gy: number,
  gz: number,
  config: PhaseFieldConfig
): { x: number; y: number; z: number } {
  const { sigma, dSigmaDvX, dSigmaDvY, dSigmaDvZ } = anisotropySigma3DFourFold(gx, gy, gz, config.anisotropyStrength);
  const grad2 = gx * gx + gy * gy + gz * gz;
  const sigma2 = sigma * sigma;
  return {
    x: sigma2 * gx - grad2 * sigma * dSigmaDvX,
    y: sigma2 * gy - grad2 * sigma * dSigmaDvY,
    z: sigma2 * gz - grad2 * sigma * dSigmaDvZ
  };
}
