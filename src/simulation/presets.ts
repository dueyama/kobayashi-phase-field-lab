import type { PhaseFieldConfig } from './types';

const base: Omit<PhaseFieldConfig, 'id' | 'name' | 'dimension' | 'nx' | 'ny' | 'nz' | 'anisotropyMode' | 'anisotropyStrength' | 'anisotropyFold' | 'anisotropyAngle' | 'noiseAmplitude' | 'seed' | 'nucleusRadius' | 'renderMode3D'> = {
  dx: 1,
  dt: 0.055,
  stepsPerFrame: 4,
  tau: 1,
  diffusivity: 1.05,
  temperatureDiffusivity: 0.23,
  latentHeat: 1.04,
  undercooling: 0.34,
  driveAlpha: 0.9,
  driveGamma: 10,
  boundaryCondition: 'neumann',
  boundaryTemperature: -0.56,
  nucleusPlacement: 'center',
  frontPerturbationAmplitude: 0,
  frontPerturbationModeCount: 1,
  frontPerturbationPhase: 0,
  initialTemperature: -0.56,
  viewMode: 'combined'
};

const kobayashiPaperDefaults = [
  'K1993 fixed simulation values: square domain 9.0 x 9.0, mesh 300 x 300, dx = 0.03, dt = 0.0002.',
  'epsilon_bar = 0.01, tau = 0.0003, alpha = 0.9, gamma = 10.0.',
  'The browser uses smooth tanh-profile nuclei; bottom-edge dendrite targets may override the seed radius after paper comparison.',
  'The 2D browser solver updates p explicitly, then solves temperature diffusion implicitly with latent heat on the RHS.'
];

type LocalComparisonKey =
  | 'fig3'
  | 'fig4'
  | 'fig5Full'
  | 'fig6'
  | 'fig7'
  | 'fig8'
  | 'fig9'
  | 'fig10'
  | 'fig5K080'
  | 'fig5K100'
  | 'fig5K120';
type LocalComparisonAsset = {
  image: string;
  caption: string;
};

const localComparisonAssets: Partial<Record<LocalComparisonKey, LocalComparisonAsset>> = import.meta.env.DEV
  ? {}
  : {};

function localComparison(key: LocalComparisonKey): LocalComparisonAsset | undefined {
  return localComparisonAssets[key];
}

function paperReference(label: string, details: string[], comparison?: LocalComparisonAsset) {
  return {
    label,
    details: [...details, ...kobayashiPaperDefaults],
    comparisonImage: comparison?.image,
    comparisonCaption: comparison?.caption
  };
}

const paperBase = {
  nx: 300,
  ny: 300,
  nz: 1,
  dx: 0.03,
  dt: 0.0002,
  stepsPerFrame: 24,
  tau: 0.0003,
  diffusivity: 0.0001,
  temperatureDiffusivity: 1,
  undercooling: 1.0,
  initialTemperature: 0,
  boundaryTemperature: 0,
  noiseAmplitude: 0.01,
  nucleusRadius: 21,
  renderMode3D: 'surface'
} satisfies Partial<PhaseFieldConfig>;

const rectangularPaperDefaults = [
  'K1993 rectangular directional solidification uses domain 12.0 x 3.0, mesh 400 x 100, dx = 0.03, dt = 0.0002.',
  'epsilon_bar = 0.01, tau = 0.0003, alpha = 0.9, gamma = 10.0, isotropic epsilon.',
  'The browser uses a smooth left-wall planar front; Fig.4 uses left-wall cooling, while Fig.5 uses adiabatic supercooled melt.'
];

function rectangularPaperReference(label: string, details: string[], comparison?: LocalComparisonAsset) {
  return {
    label,
    details: [...details, ...rectangularPaperDefaults],
    comparisonImage: comparison?.image,
    comparisonCaption: comparison?.caption
  };
}

const rectangularPaperBase = {
  nx: 400,
  ny: 100,
  nz: 1,
  dx: 0.03,
  dt: 0.0002,
  stepsPerFrame: 24,
  tau: 0.0003,
  diffusivity: 0.0001,
  temperatureDiffusivity: 1,
  undercooling: 1.0,
  initialTemperature: 0,
  boundaryTemperature: 0,
  noiseAmplitude: 0.01,
  nucleusRadius: 18,
  nucleusPlacement: 'left-wall',
  frontPerturbationAmplitude: 0,
  frontPerturbationModeCount: 1,
  frontPerturbationPhase: 0,
  renderMode3D: 'surface'
} satisfies Partial<PhaseFieldConfig>;

type Fig5PresetSpec = {
  id: string;
  name: string;
  figureIndex: number;
  latentHeat: number;
  seed: number;
  description: string;
  note: string;
};

function fig5Preset(spec: Fig5PresetSpec): PhaseFieldConfig {
  return {
    ...base,
    id: spec.id,
    name: spec.name,
    dimension: '2d',
    ...rectangularPaperBase,
    latentHeat: spec.latentHeat,
    boundaryCondition: 'neumann',
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: spec.seed,
    description: spec.description,
    paperReference: rectangularPaperReference(`K1993 Fig.5(${spec.figureIndex})`, [
      'Crystal grows from the left wall toward supercooled melt under adiabatic condition.',
      `K = ${spec.latentHeat.toFixed(1)}; ${spec.note}`
    ], localComparison('fig5Full'))
  };
}

function fig6Preset(spec: Fig5PresetSpec): PhaseFieldConfig {
  return {
    ...base,
    id: spec.id,
    name: spec.name,
    dimension: '2d',
    ...rectangularPaperBase,
    latentHeat: spec.latentHeat,
    boundaryCondition: 'neumann',
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.05,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: spec.seed,
    description: spec.description,
    paperReference: rectangularPaperReference(`K1993 Fig.6(${spec.figureIndex})`, [
      'Crystal grows from the left wall toward supercooled melt under adiabatic condition.',
      '4-mode anisotropy with delta = 0.050; horizontal and vertical directions are epsilon maxima.',
      `K = ${spec.latentHeat.toFixed(1)}; ${spec.note}`
    ], localComparison('fig6'))
  };
}

function fig8Preset(spec: Fig5PresetSpec): PhaseFieldConfig {
  return {
    ...base,
    id: spec.id,
    name: spec.name,
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: spec.latentHeat,
    anisotropyMode: 'sixFold',
    anisotropyStrength: 0.04,
    anisotropyFold: 6,
    anisotropyAngle: Math.PI / 2,
    seed: spec.seed,
    description: spec.description,
    paperReference: paperReference(`K1993 Fig.8(${spec.figureIndex})`, [
      `K = ${spec.latentHeat.toFixed(1)}, delta = 0.040, j = 6, theta0 = pi/2.`,
      spec.note
    ], localComparison('fig8'))
  };
}

function fig9Preset(noiseAmplitude: number, seed: number, label: string): PhaseFieldConfig {
  return {
    ...base,
    id: noiseAmplitude === 0 ? 'paper-fig9-no-noise' : `paper-fig9-noise${String(Math.round(noiseAmplitude * 1000)).padStart(3, '0')}`,
    name: `K1993 Fig.9 a=${noiseAmplitude.toFixed(3)} ${label}`,
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.02,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude,
    seed,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target non-oscillating dendrite side-branch noise comparison.',
    paperReference: paperReference('K1993 Fig.9', [
      'K = 2.0, delta = 0.020, j = 4, theta0 = 0.',
      `Noise amplitude a = ${noiseAmplitude.toFixed(3)}; the paper compares a = 0.010, 0.001, and 0.000 at time = 1.0.`,
      'The paper labels side-branch competition regions I and II; the simulator reproduces the crystal contour only.'
    ], localComparison('fig9'))
  };
}

export const presets: PhaseFieldConfig[] = [
  {
    ...base,
    id: '2d-isotropic',
    name: '2D isotropic nucleus',
    dimension: '2d',
    nx: 128,
    ny: 128,
    nz: 1,
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.004,
    seed: 1201,
    nucleusRadius: 9,
    renderMode3D: 'surface',
    description: 'Baseline radial growth without orientation preference.'
  },
  {
    ...base,
    id: '2d-fourfold',
    name: '2D four-fold dendrite',
    dimension: '2d',
    nx: 160,
    ny: 160,
    nz: 1,
    dt: 0.045,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.12,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.014,
    seed: 1993,
    nucleusRadius: 8,
    renderMode3D: 'surface',
    description: 'Browser-scaled four-fold dendrite for fast exploration.'
  },
  {
    ...base,
    id: '2d-sixfold',
    name: '2D six-fold snowflake-like',
    dimension: '2d',
    nx: 160,
    ny: 160,
    nz: 1,
    dt: 0.043,
    undercooling: 0.36,
    anisotropyMode: 'sixFold',
    anisotropyStrength: 0.1,
    anisotropyFold: 6,
    anisotropyAngle: Math.PI / 2,
    noiseAmplitude: 0.01,
    seed: 6006,
    nucleusRadius: 7,
    renderMode3D: 'surface',
    description: 'Six-fold orientation field for snowflake-like qualitative growth.'
  },
  {
    ...base,
    id: '2d-sidebranch',
    name: '2D noisy side branching',
    dimension: '2d',
    nx: 192,
    ny: 192,
    nz: 1,
    dt: 0.038,
    stepsPerFrame: 3,
    undercooling: 0.39,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.14,
    anisotropyFold: 4,
    anisotropyAngle: Math.PI / 12,
    noiseAmplitude: 0.028,
    seed: 410423,
    nucleusRadius: 8,
    renderMode3D: 'surface',
    description: 'Higher noise browser preset for side-branch sensitivity.'
  },
  {
    ...base,
    id: 'paper-fig3-inward-walls',
    name: 'K1993 Fig.3 inward wall growth K=1.0',
    dimension: '2d',
    ...paperBase,
    latentHeat: 1.0,
    initialTemperature: 1.0,
    boundaryTemperature: 0,
    boundaryCondition: 'fixed-temperature',
    nucleusPlacement: 'walls',
    nucleusRadius: 5,
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0,
    seed: 3100,
    description: 'Paper-target no-supercooling case where crystal grows inward from all cooled walls.',
    paperReference: paperReference('K1993 Fig.3', [
      'No-supercooling isotropic case, K = 1.0.',
      'The vessel is cooled by the surrounding walls, so solidification advances inward from all walls.',
      'The interface rounds as it moves inward and disappears at late time.'
    ], localComparison('fig3'))
  },
  {
    ...base,
    id: 'paper-fig4-planar-k100',
    name: 'K1993 Fig.4 planar left-cooling K=1.0',
    dimension: '2d',
    ...rectangularPaperBase,
    latentHeat: 1.0,
    initialTemperature: 1.0,
    boundaryTemperature: 0,
    boundaryCondition: 'left-fixed-temperature',
    frontPerturbationAmplitude: 10,
    frontPerturbationModeCount: 5,
    frontPerturbationPhase: Math.PI,
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0,
    seed: 4100,
    description: 'Paper-target planar-front stability check: crystal grows from the cooled left wall and the deformed front should flatten.',
    paperReference: rectangularPaperReference('K1993 Fig.4', [
      'No-supercooling isotropic case, K = 1.0.',
      'The vessel is cooled only by the left wall; no heat flux is allowed at other walls.',
      'The advancing interface becomes flat very quickly.'
    ], localComparison('fig4'))
  },
  fig5Preset({
    id: 'paper-fig5-k080-planar',
    name: 'K1993 Fig.5 K=0.8 stable planar',
    figureIndex: 1,
    latentHeat: 0.8,
    seed: 5080,
    description: 'Paper-target directional solidification case where the flat interface should remain stable.',
    note: 'The paper reports a stable flat interface.'
  }),
  fig5Preset({
    id: 'paper-fig5-k090-slight',
    name: 'K1993 Fig.5 K=0.9 slight destabilization',
    figureIndex: 2,
    latentHeat: 0.9,
    seed: 5090,
    description: 'Paper-target directional solidification case where the flat interface is slightly destabilized.',
    note: 'The paper reports the flat interface is a little bit destabilized.'
  }),
  fig5Preset({
    id: 'paper-fig5-k100-cellular',
    name: 'K1993 Fig.5 K=1.0 weak cellular',
    figureIndex: 3,
    latentHeat: 1.0,
    seed: 5100,
    description: 'Paper-target directional solidification case where weak cellular instability appears.',
    note: 'The paper reports weak cellular structure.'
  }),
  fig5Preset({
    id: 'paper-fig5-k110-cellular-slits',
    name: 'K1993 Fig.5 K=1.1 cellular slits',
    figureIndex: 4,
    latentHeat: 1.1,
    seed: 5110,
    description: 'Paper-target directional solidification case where cellular slits can remain behind the front.',
    note: 'The paper reports weak cellular structure with slits that can remain behind the front.'
  }),
  fig5Preset({
    id: 'paper-fig5-k120-splitting',
    name: 'K1993 Fig.5 K=1.2 tip splitting',
    figureIndex: 5,
    latentHeat: 1.2,
    seed: 5120,
    description: 'Paper-target directional solidification case where tip splitting should occur.',
    note: 'The paper reports tip splitting and branch competition in the channel.'
  }),
  fig5Preset({
    id: 'paper-fig5-k140-splitting',
    name: 'K1993 Fig.5 K=1.4 stronger splitting',
    figureIndex: 6,
    latentHeat: 1.4,
    seed: 5140,
    description: 'Paper-target directional solidification case with stronger splitting and branch competition.',
    note: 'The paper shows stronger tip splitting and branches spreading into the channel.'
  }),
  fig5Preset({
    id: 'paper-fig5-k160-competition',
    name: 'K1993 Fig.5 K=1.6 branch competition',
    figureIndex: 7,
    latentHeat: 1.6,
    seed: 5160,
    description: 'Paper-target directional solidification case where competing branches screen each other.',
    note: 'The paper reports branch competition and a decreased growth rate for K >= 1.6.'
  }),
  fig5Preset({
    id: 'paper-fig5-k180-spreading',
    name: 'K1993 Fig.5 K=1.8 spreading branches',
    figureIndex: 8,
    latentHeat: 1.8,
    seed: 5180,
    description: 'Paper-target directional solidification case with late spreading branches.',
    note: 'The paper shows slower growth with spreading branches at later times.'
  }),
  fig5Preset({
    id: 'paper-fig5-k200-slow',
    name: 'K1993 Fig.5 K=2.0 slow late branches',
    figureIndex: 9,
    latentHeat: 2.0,
    seed: 5200,
    description: 'Paper-target directional solidification case with slow late motion after partial solidification.',
    note: 'The paper shows late, slow interface motion for the largest K in Fig.5.'
  }),
  fig6Preset({
    id: 'paper-fig6-k080-anisotropic',
    name: 'K1993 Fig.6 K=0.8 anisotropic stable planar',
    figureIndex: 1,
    latentHeat: 0.8,
    seed: 6080,
    description: 'Paper-target four-fold anisotropic directional solidification case where the flat interface remains stable.',
    note: 'The paper shows a flat front in the anisotropic series.'
  }),
  fig6Preset({
    id: 'paper-fig6-k090-anisotropic',
    name: 'K1993 Fig.6 K=0.9 anisotropic weak cellular',
    figureIndex: 2,
    latentHeat: 0.9,
    seed: 6090,
    description: 'Paper-target four-fold anisotropic directional solidification case with weak cellular structure.',
    note: 'The paper shows weak cellular deformation.'
  }),
  fig6Preset({
    id: 'paper-fig6-k100-anisotropic',
    name: 'K1993 Fig.6 K=1.0 anisotropic weak cellular',
    figureIndex: 3,
    latentHeat: 1.0,
    seed: 6100,
    description: 'Paper-target four-fold anisotropic directional solidification case with weak cellular structure.',
    note: 'The paper shows weak cellular deformation.'
  }),
  fig6Preset({
    id: 'paper-fig6-k110-anisotropic',
    name: 'K1993 Fig.6 K=1.1 anisotropic slits',
    figureIndex: 4,
    latentHeat: 1.1,
    seed: 6110,
    description: 'Paper-target four-fold anisotropic directional solidification case where slits remain behind the front.',
    note: 'The paper reports slits for K = 1.1, 1.2, and 1.4.'
  }),
  fig6Preset({
    id: 'paper-fig6-k120-anisotropic',
    name: 'K1993 Fig.6 K=1.2 anisotropic slits',
    figureIndex: 5,
    latentHeat: 1.2,
    seed: 6120,
    description: 'Paper-target four-fold anisotropic directional solidification case with slit-like branch competition.',
    note: 'The paper shows long slits and branch competition.'
  }),
  fig6Preset({
    id: 'paper-fig6-k140-anisotropic',
    name: 'K1993 Fig.6 K=1.4 anisotropic long slits',
    figureIndex: 6,
    latentHeat: 1.4,
    seed: 6140,
    description: 'Paper-target four-fold anisotropic directional solidification case with long slit-like branches.',
    note: 'The paper shows long slits with limited lateral spreading.'
  }),
  fig6Preset({
    id: 'paper-fig6-k160-anisotropic',
    name: 'K1993 Fig.6 K=1.6 anisotropic branch competition',
    figureIndex: 7,
    latentHeat: 1.6,
    seed: 6160,
    description: 'Paper-target four-fold anisotropic directional solidification case where branches compete differently from the isotropic case.',
    note: 'The paper reports branch competition and faster growth than the isotropic case.'
  }),
  fig6Preset({
    id: 'paper-fig6-k180-anisotropic',
    name: 'K1993 Fig.6 K=1.8 anisotropic side branches',
    figureIndex: 8,
    latentHeat: 1.8,
    seed: 6180,
    description: 'Paper-target four-fold anisotropic directional solidification case with side branches on fast branches.',
    note: 'The paper shows fast branches suppressing adjacent slower ones.'
  }),
  fig6Preset({
    id: 'paper-fig6-k200-anisotropic',
    name: 'K1993 Fig.6 K=2.0 anisotropic long branches',
    figureIndex: 9,
    latentHeat: 2.0,
    seed: 6200,
    description: 'Paper-target four-fold anisotropic directional solidification case with long anisotropy-aligned branches.',
    note: 'The paper shows long branches aligned with the anisotropic directions.'
  }),
  {
    ...base,
    id: 'paper-fig7-delta000',
    name: 'K1993 Fig.7 δ=0.000 a=0.010 isotropic target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: 7000,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target isotropic bottom-edge nucleation corresponding to K1993 Fig.7(1).',
    paperReference: paperReference('K1993 Fig.7(1)', [
      'After nucleation at the center of the bottom edge, crystal grows into supercooled melt under adiabatic conditions.',
      'K = 2.0, four-mode family with delta = 0.000, effectively isotropic.',
      'Interface noise uses the paper default a = 0.010.'
    ], localComparison('fig7'))
  },
  {
    ...base,
    id: 'paper-fig7-delta005',
    name: 'K1993 Fig.7 δ=0.005 a=0.010 weak four-fold target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.005,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: 7005,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target very weak four-fold case mixing isotropic fingering and dendritic vertical growth.',
    paperReference: paperReference('K1993 Fig.7(2)', [
      'K = 2.0, delta = 0.005, j = 4, theta0 = 0.',
      'The paper reports both isotropic viscous-fingering-like branches and dendritic structure in the vertical branch.',
      'Interface noise uses the paper default a = 0.010.'
    ], localComparison('fig7'))
  },
  {
    ...base,
    id: 'paper-fig7-delta010',
    name: 'K1993 Fig.7 δ=0.010 a=0.010 four-fold target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.01,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: 7010,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target weak four-fold case; the paper describes typical dendritic side branches.',
    paperReference: paperReference('K1993 Fig.7(3)', [
      'K = 2.0, delta = 0.010, j = 4, theta0 = 0.',
      'The paper reports a typical dendritic structure with side branches shifted from the anisotropy direction.',
      'Interface noise uses the paper default a = 0.010.'
    ], localComparison('fig7'))
  },
  {
    ...base,
    id: 'paper-fig7-delta020',
    name: 'K1993 Fig.7 δ=0.020 a=0.010 four-fold target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.02,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: 7020,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target stronger four-fold case with branches closer to anisotropy directions.',
    paperReference: paperReference('K1993 Fig.7(4)', [
      'K = 2.0, delta = 0.020, j = 4, theta0 = 0.',
      'The paper reports side branches that almost coincide with the anisotropy direction.',
      'Interface noise uses the paper default a = 0.010.'
    ], localComparison('fig7'))
  },
  {
    ...base,
    id: 'paper-fig7-delta050',
    name: 'K1993 Fig.7 δ=0.050 a=0.010 strong four-fold target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.05,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    seed: 7050,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target strong four-fold anisotropy for branch competition and screening.',
    paperReference: paperReference('K1993 Fig.7(5)', [
      'K = 2.0, delta = 0.050, j = 4, theta0 = 0.',
      'The paper uses this case later in Fig.11 for the anisotropy/stiffness discussion.',
      'Interface noise uses the paper default a = 0.010.'
    ], localComparison('fig7'))
  },
  fig8Preset({
    id: 'paper-fig8-k080-sixfold',
    name: 'K1993 Fig.8 K=0.8 six-fold convex target',
    figureIndex: 1,
    latentHeat: 0.8,
    seed: 8080,
    description: 'Paper-target six-fold low-latent-heat case with a strictly convex hexagonal crystal.',
    note: 'The paper reports a strictly convex hexagon for K = 0.8.'
  }),
  fig8Preset({
    id: 'paper-fig8-k100-sixfold',
    name: 'K1993 Fig.8 K=1.0 six-fold dented target',
    figureIndex: 2,
    latentHeat: 1.0,
    seed: 8100,
    description: 'Paper-target six-fold case where dents appear at the crystal edge centers.',
    note: 'The paper reports dents at the centers of the crystal edges for K = 1.0.'
  }),
  fig8Preset({
    id: 'paper-fig8-k120-sixfold',
    name: 'K1993 Fig.8 K=1.2 six-fold target',
    figureIndex: 3,
    latentHeat: 1.2,
    seed: 8120,
    description: 'Paper-target six-fold case at intermediate latent heat.',
    note: 'The paper shows the transition from hexagonal dents to slits, tucks, and a thick branching pattern.'
  }),
  fig8Preset({
    id: 'paper-fig8-k160-sixfold',
    name: 'K1993 Fig.8 K=1.6 six-fold branching target',
    figureIndex: 4,
    latentHeat: 1.6,
    seed: 8160,
    description: 'Paper-target six-fold case with a clear branching pattern.',
    note: 'The paper reports a branching pattern for K = 1.6.'
  }),
  fig8Preset({
    id: 'paper-fig8-k200-sixfold',
    name: 'K1993 Fig.8 K=2.0 snowflake-like target',
    figureIndex: 5,
    latentHeat: 2.0,
    seed: 8200,
    description: 'Paper-target snowflake-like melt-growth case; not a vapor snowflake model.',
    note: 'The paper notes this is snowflake-like but corresponds to supercooled melt solidification, not vapor snow crystal growth.'
  }),
  fig9Preset(0.01, 90010, 'noisy target'),
  fig9Preset(0.001, 90001, 'weak-noise target'),
  fig9Preset(0, 90000, 'no-noise target'),
  {
    ...base,
    id: 'paper-fig9-3d-left-target',
    name: 'K2002 Fig.9 left reproduced 3D target',
    dimension: '3d',
    ...paperBase,
    nx: 160,
    ny: 160,
    nz: 100,
    stepsPerFrame: 1,
    nucleusRadius: 7,
    latentHeat: 2.5,
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.01,
    seed: 92002,
    nucleusPlacement: 'bottom-face-center-halfcell',
    temperatureSolver: 'iccg',
    temperatureSolverIterations: 8,
    temperatureSolverTolerance: 1e-5,
    renderMode3D: 'surface',
    surfaceStyle3D: 'gold',
    presentationView3D: 'upright',
    description:
      'K2002 Fig.9 left reproduced target: full-domain isotropic 3D run with a smooth r=7 nucleus centered on the bottom x-y face.',
    paperReference: paperReference('K2002 Fig.9 left reproduced 3D target', [
      'Adopted reproduction candidate selected by comparing K2002 Fig.9-left reference material against simulator output.',
      'Current reproduction: K = 2.5, delta = 0, a = 0.01, r = 7 cells, target snapshot t = 0.4.',
      'Full-domain mesh is 160 x 160 x 100 with dx = dy = dz = 0.03, so the physical domain is 4.8 x 4.8 x 3.0.',
      'The seed is a smooth sphere centered in x and y, half a grid cell outside the lower z Neumann face.',
      'The selected t = 0.4 state has p >= 0.5 bbox 138 x 139 x 68 cells in y/x/z order, leaving about 10-11 side cells and 32 top z cells of margin.'
    ])
  },
  {
    ...base,
    id: 'paper-fig9-3d-right-target',
    name: 'K2002 Fig.9 right estimated 3D target',
    dimension: '3d',
    ...paperBase,
    nx: 50,
    ny: 50,
    nz: 200,
    stepsPerFrame: 1,
    nucleusRadius: 7,
    latentHeat: 3.5,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.02,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.005,
    seed: 93005,
    nucleusPlacement: 'bottom-corner-halfcell',
    temperatureSolver: 'iccg',
    temperatureSolverIterations: 8,
    temperatureSolverTolerance: 1e-5,
    renderMode3D: 'surface',
    description:
      'K2002 Fig.9 right estimated target: x/y symmetry quarter-domain with a smooth r=7 half-cell corner nucleus, mirrored for full-domain interpretation.',
    paperReference: paperReference('K2002 Fig.9 right estimated 3D target', [
      'Estimated qualitative candidate selected by reference-figure comparison because the exact 3D numerical parameters were not available.',
      'Current estimate: K = 3.5, delta = 0.020, a = 0.005, r = 7 cells, target snapshot t ~= 0.9.',
      'Simulated quarter-domain mesh is 50 x 50 x 200 with dx = dy = dz = 0.03, so the quarter-domain size is 1.5 x 1.5 x 6.0.',
      'Mirrored display/STL domain is 100 x 100 x 200, corresponding to 3.0 x 3.0 x 6.0.',
      'The z direction is the added third dimension; the seed is a smooth corner nucleus centered half a grid cell outside the Neumann planes.',
      '3D anisotropy uses the K2002 component form; the rendered equation is documented in Model & Method.'
    ])
  },
  {
    ...base,
    id: 'paper-fig10-no-noise',
    name: 'K1993 Fig.10 a=0 no-noise target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.01,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0,
    seed: 10000,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target control case for comparing side-branch sensitivity without stochastic noise.',
    paperReference: paperReference('K1993 Fig.10', [
      'K = 2.0, delta = 0.010, noise amplitude a = 0.000.',
      'Fig.10 compares side branch structure against noise amplitudes a = 0.010, 0.001, and 0.000.'
    ], localComparison('fig10'))
  },
  {
    ...base,
    id: 'paper-fig10-noise001',
    name: 'K1993 Fig.10 a=0.001 weak-noise target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.01,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.001,
    seed: 10001,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target weak-noise comparison case for side-branch structure.',
    paperReference: paperReference('K1993 Fig.10', [
      'K = 2.0, delta = 0.010, noise amplitude a = 0.001.',
      'Fig.10 compares side branch structure against noise amplitudes a = 0.010, 0.001, and 0.000.'
    ], localComparison('fig10'))
  },
  {
    ...base,
    id: 'paper-fig10-noise010',
    name: 'K1993 Fig.10 a=0.010 noisy target',
    dimension: '2d',
    ...paperBase,
    nucleusRadius: 7,
    latentHeat: 2.0,
    anisotropyMode: 'fourFold',
    anisotropyStrength: 0.01,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.01,
    seed: 10010,
    nucleusPlacement: 'bottom-edge',
    description: 'Paper-target noisy comparison case for side-branch structure.',
    paperReference: paperReference('K1993 Fig.10', [
      'K = 2.0, delta = 0.010, noise amplitude a = 0.010.',
      'Noise is applied as p(1-p)X with X uniformly distributed on [-1/2, 1/2].'
    ], localComparison('fig10'))
  },
  {
    ...base,
    id: '3d-isotropic',
    name: '3D isotropic nucleus',
    dimension: '3d',
    nx: 36,
    ny: 36,
    nz: 36,
    dt: 0.035,
    stepsPerFrame: 2,
    anisotropyMode: 'isotropic',
    anisotropyStrength: 0,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.003,
    seed: 3030,
    nucleusRadius: 5,
    renderMode3D: 'volume'
  },
  {
    ...base,
    id: '3d-cubic',
    name: '3D cubic anisotropic dendrite',
    dimension: '3d',
    nx: 42,
    ny: 42,
    nz: 42,
    dt: 0.03,
    stepsPerFrame: 2,
    undercooling: 0.38,
    anisotropyMode: 'cubic',
    anisotropyStrength: 0.13,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.008,
    seed: 34063,
    nucleusRadius: 5,
    renderMode3D: 'surface'
  },
  {
    ...base,
    id: '3d-cubic-high',
    name: '3D cubic high grid 100^3',
    dimension: '3d',
    nx: 100,
    ny: 100,
    nz: 100,
    dt: 0.02,
    stepsPerFrame: 1,
    undercooling: 0.36,
    anisotropyMode: 'cubic',
    anisotropyStrength: 0.11,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.004,
    seed: 100300,
    nucleusRadius: 10,
    renderMode3D: 'volume'
  },
  {
    ...base,
    id: '3d-cubic-128',
    name: '3D cubic slow high grid 128^3',
    dimension: '3d',
    nx: 128,
    ny: 128,
    nz: 128,
    dt: 0.016,
    stepsPerFrame: 1,
    undercooling: 0.34,
    anisotropyMode: 'cubic',
    anisotropyStrength: 0.1,
    anisotropyFold: 4,
    anisotropyAngle: 0,
    noiseAmplitude: 0.003,
    seed: 128300,
    nucleusRadius: 12,
    renderMode3D: 'surface'
  }
];

export const labPresets = presets.filter((preset) => preset.id.startsWith('paper-'));

export function clonePreset(id: string): PhaseFieldConfig {
  const preset = presets.find((item) => item.id === id) ?? labPresets[0] ?? presets[0];
  return { ...preset };
}
