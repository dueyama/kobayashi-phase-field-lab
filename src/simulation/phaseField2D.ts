import { anisotropySigma2D, anisotropySigmaPrime2D } from './anisotropy';
import {
  clamp,
  computeRange,
  fillSmoothCircle,
  fillSmoothCircleAt,
  fillSmoothLeftWall,
  fillSmoothWalls,
  index2D,
  sample2D
} from './fields';
import { deterministicNoise } from './rng';
import {
  applyFixedBoundary2D,
  applyLeftFixedBoundary2D,
  createImplicitTemperature2DWorkspace,
  type ImplicitTemperature2DWorkspace,
  laplacian2D,
  localizedNoise,
  reactionTerm,
  solveImplicitTemperature2D
} from './numerics';
import type { PhaseFieldConfig, SimulationSnapshot, StepStats } from './types';

export class PhaseField2D {
  readonly config: PhaseFieldConfig;
  readonly phi: Float32Array;
  readonly temperature: Float32Array;
  private nextPhi: Float32Array;
  private nextTemperature: Float32Array;
  private temperatureRhs: Float32Array;
  private temperatureWorkspace: ImplicitTemperature2DWorkspace;
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
    this.config = { ...config, dimension: '2d', nz: 1 };
    const cells = config.nx * config.ny;
    this.phi = new Float32Array(cells);
    this.temperature = new Float32Array(cells);
    this.nextPhi = new Float32Array(cells);
    this.nextTemperature = new Float32Array(cells);
    this.temperatureRhs = new Float32Array(cells);
    this.temperatureWorkspace = createImplicitTemperature2DWorkspace(cells);
    this.dPhi = new Float32Array(cells);
    this.reset();
  }

  reset(): void {
    const interfaceWidth = Math.max(1.5, Math.min(4, this.config.nucleusRadius * 0.2));
    if (this.config.nucleusPlacement === 'bottom-edge') {
      fillSmoothCircleAt(
        this.phi,
        this.config.nx,
        this.config.ny,
        this.config.nucleusRadius,
        (this.config.nx - 1) * 0.5,
        this.config.ny - 1,
        interfaceWidth,
        1,
        0
      );
    } else if (this.config.nucleusPlacement === 'bottom-corner') {
      fillSmoothCircleAt(
        this.phi,
        this.config.nx,
        this.config.ny,
        this.config.nucleusRadius,
        0,
        this.config.ny - 1,
        interfaceWidth,
        1,
        0
      );
    } else if (this.config.nucleusPlacement === 'left-wall') {
      fillSmoothLeftWall(
        this.phi,
        this.config.nx,
        this.config.ny,
        this.config.nucleusRadius,
        interfaceWidth,
        this.config.frontPerturbationAmplitude,
        this.config.frontPerturbationModeCount,
        this.config.frontPerturbationPhase,
        1,
        0
      );
    } else if (this.config.nucleusPlacement === 'walls') {
      fillSmoothWalls(this.phi, this.config.nx, this.config.ny, this.config.nucleusRadius, interfaceWidth, 1, 0);
    } else {
      fillSmoothCircle(this.phi, this.config.nx, this.config.ny, this.config.nucleusRadius, interfaceWidth, 1, 0);
    }
    this.temperature.fill(this.config.initialTemperature);
    if (this.config.boundaryCondition === 'fixed-temperature') {
      applyFixedBoundary2D(this.temperature, this.config.nx, this.config.ny, this.config.boundaryTemperature);
    } else if (this.config.boundaryCondition === 'left-fixed-temperature') {
      applyLeftFixedBoundary2D(this.temperature, this.config.nx, this.config.ny, this.config.boundaryTemperature);
    }
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

  step(count = 1): StepStats {
    for (let i = 0; i < count; i += 1) {
      this.singleStep();
      this.currentStats = this.calculateStats();
      if (this.currentStats.unstable) break;
    }
    return this.currentStats;
  }

  snapshot(): SimulationSnapshot {
    return {
      dimension: '2d',
      nx: this.config.nx,
      ny: this.config.ny,
      nz: 1,
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
    const { nx, ny, dx, dt, tau } = this.config;
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = index2D(x, y, nx);
        const phi = this.phi[i];
        const temperature = this.temperature[i];
        const diffusion = anisotropicDiffusion2D(this.phi, x, y, this.config);
        const reaction = reactionTerm(phi, temperature, this.config.undercooling, this.config.driveAlpha, this.config.driveGamma);
        const noise = localizedNoise(phi, this.config.noiseAmplitude, deterministicNoise(this.config.seed, i, this.stepIndex));
        const dPhi = (diffusion + reaction + noise) / tau;
        const nextPhi = clamp(phi + dt * dPhi, -0.05, 1.05);
        this.nextPhi[i] = nextPhi;
        this.dPhi[i] = (nextPhi - phi) / dt;
        this.temperatureRhs[i] = temperature + this.config.latentHeat * (nextPhi - phi);
      }
    }

    solveImplicitTemperature2D(
      this.temperatureRhs,
      this.nextTemperature,
      nx,
      ny,
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
      applyFixedBoundary2D(this.nextTemperature, nx, ny, this.config.boundaryTemperature);
    } else if (this.config.boundaryCondition === 'left-fixed-temperature') {
      applyLeftFixedBoundary2D(this.nextTemperature, nx, ny, this.config.boundaryTemperature);
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

function anisotropicDiffusion2D(field: Float32Array, x: number, y: number, config: PhaseFieldConfig): number {
  const { nx, ny, dx, diffusivity } = config;
  if (config.anisotropyMode === 'isotropic' || config.anisotropyStrength === 0) {
    return diffusivity * laplacian2D(field, x, y, nx, ny, dx);
  }

  const pEast = anisotropicFluxX2D(field, x, y, config);
  const pWest = anisotropicFluxX2D(field, x - 1, y, config);
  const qNorth = anisotropicFluxY2D(field, x, y, config);
  const qSouth = anisotropicFluxY2D(field, x, y - 1, config);

  return (pEast - pWest + qNorth - qSouth) / dx;
}

function anisotropicFluxX2D(field: Float32Array, x: number, y: number, config: PhaseFieldConfig): number {
  const { nx, ny, dx, diffusivity } = config;
  if (x < 0 || x >= nx - 1) return 0;
  const gx = (sample2D(field, x + 1, y, nx, ny) - sample2D(field, x, y, nx, ny)) / dx;
  const gy =
    (sample2D(field, x, y + 1, nx, ny) +
      sample2D(field, x + 1, y + 1, nx, ny) -
      sample2D(field, x, y - 1, nx, ny) -
      sample2D(field, x + 1, y - 1, nx, ny)) /
    (4 * dx);
  const { sigma, sigmaPrime } = anisotropyAtGradient2D(gx, gy, config);
  return diffusivity * sigma * (sigma * gx - sigmaPrime * gy);
}

function anisotropicFluxY2D(field: Float32Array, x: number, y: number, config: PhaseFieldConfig): number {
  const { nx, ny, dx, diffusivity } = config;
  if (y < 0 || y >= ny - 1) return 0;
  const gx =
    (sample2D(field, x + 1, y, nx, ny) +
      sample2D(field, x + 1, y + 1, nx, ny) -
      sample2D(field, x - 1, y, nx, ny) -
      sample2D(field, x - 1, y + 1, nx, ny)) /
    (4 * dx);
  const gy = (sample2D(field, x, y + 1, nx, ny) - sample2D(field, x, y, nx, ny)) / dx;
  const { sigma, sigmaPrime } = anisotropyAtGradient2D(gx, gy, config);
  return diffusivity * sigma * (sigma * gy + sigmaPrime * gx);
}

function anisotropyAtGradient2D(
  gx: number,
  gy: number,
  config: PhaseFieldConfig
): { sigma: number; sigmaPrime: number } {
  return {
    sigma: Math.max(
      0.35,
      anisotropySigma2D(gx, gy, config.anisotropyMode, config.anisotropyStrength, config.anisotropyFold, config.anisotropyAngle)
    ),
    sigmaPrime: anisotropySigmaPrime2D(gx, gy, config.anisotropyMode, config.anisotropyStrength, config.anisotropyFold, config.anisotropyAngle)
  };
}

export function paperSchemeFluxForTest2D(
  field: Float32Array,
  x: number,
  y: number,
  config: PhaseFieldConfig
): { x: number; y: number } {
  return {
    x: anisotropicFluxX2D(field, x, y, config),
    y: anisotropicFluxY2D(field, x, y, config)
  };
}
