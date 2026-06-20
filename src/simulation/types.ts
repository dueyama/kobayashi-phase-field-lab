export type Dimension = '2d' | '3d';
export type BoundaryCondition = 'neumann' | 'fixed-temperature' | 'left-fixed-temperature';
export type AnisotropyMode = 'isotropic' | 'fourFold' | 'sixFold' | 'cubic';
export type NucleusPlacement =
  | 'center'
  | 'bottom-edge'
  | 'bottom-corner'
  | 'bottom-corner-halfcell'
  | 'bottom-face-center-halfcell'
  | 'left-wall'
  | 'walls';
export type ViewMode = 'phase' | 'temperature' | 'combined';
export type RenderMode3D = 'surface' | 'slices' | 'volume';
export type TemperatureSolver = 'jacobi' | 'iccg';
export type SolverBackend = 'cpu' | 'webgpu-experimental';
export type SurfaceStyle3D = 'field' | 'gold';
export type PresentationView3D = 'upright' | 'z-right';

export interface PresetPaperReference {
  label: string;
  details: string[];
  comparisonImage?: string;
  comparisonCaption?: string;
}

export interface PhaseFieldConfig {
  id: string;
  name: string;
  dimension: Dimension;
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  dt: number;
  stepsPerFrame: number;
  tau: number;
  diffusivity: number;
  temperatureDiffusivity: number;
  latentHeat: number;
  undercooling: number;
  driveAlpha: number;
  driveGamma: number;
  anisotropyMode: AnisotropyMode;
  anisotropyStrength: number;
  anisotropyFold: number;
  anisotropyAngle: number;
  noiseAmplitude: number;
  noiseReferenceDt?: number;
  seed: number;
  boundaryCondition: BoundaryCondition;
  boundaryTemperature: number;
  nucleusRadius: number;
  nucleusPlacement: NucleusPlacement;
  frontPerturbationAmplitude: number;
  frontPerturbationModeCount: number;
  frontPerturbationPhase: number;
  initialTemperature: number;
  viewMode: ViewMode;
  renderMode3D: RenderMode3D;
  surfaceStyle3D?: SurfaceStyle3D;
  presentationView3D?: PresentationView3D;
  interactiveView3D?: boolean;
  surfaceFrameGuarantee3D?: boolean;
  temperatureSolver?: TemperatureSolver;
  temperatureSolverIterations?: number;
  temperatureSolverTolerance?: number;
  solverBackend?: SolverBackend;
  description?: string;
  paperReference?: PresetPaperReference;
}

export interface SimulationSnapshot {
  dimension: Dimension;
  nx: number;
  ny: number;
  nz: number;
  phi: Float32Array;
  temperature: Float32Array;
  step: number;
  time: number;
  maxPhi: number;
  minPhi: number;
  maxTemperature: number;
  minTemperature: number;
}

export interface StepStats {
  step: number;
  time: number;
  maxPhi: number;
  minPhi: number;
  maxTemperature: number;
  minTemperature: number;
  unstable: boolean;
}
