# Changelog

All notable user-facing changes to Phase-Field Dendrite Lab are recorded here.

## 2026-07-24

### Added

- Experimental WebGPU backends for 2D and 3D phase-field stepping.
- Runtime backend status and solver throughput readouts in Lab.
- Responsive runtime profiles for desktop and mobile devices.
- Background workers for CPU 3D stepping and isosurface generation.
- Surface-update guarantee mode for fast 3D runs.
- Numerical regression tests for anisotropic fluxes, implicit diffusion
  solvers, WebGPU shader conventions, runtime profiles, and volume rendering.

### Changed

- WebGPU is now the default backend when the browser supports it, with automatic
  CPU fallback when initialization fails.
- WebGPU presets use an explicit-temperature stability estimate, a smaller time
  step, and larger `steps/frame` batches for interactive throughput.
- Interface-noise amplitude is normalized as
  `a_effective = a * sqrt(dt_reference / dt)` when WebGPU uses a different
  time step, preserving its variance scale per unit model time.
- The 3D camera and controls now fit narrow screens more reliably and retain
  orbit interaction while simulation is paused.
- Volume and isosurface presentation, mobile Lab controls, and backend labels
  have been refined.
- K1993 WebGPU reproduction thumbnails were regenerated with the current solver
  and time-step noise normalization.

### Reproduction Notes

- CPU implicit-temperature outputs remain the qualitative reproduction
  reference.
- Fig.10 retains the same qualitative noise-series morphology across the CPU
  reference and the current WebGPU backend.
- In the current Fig.9 low-noise cases, explicit-temperature WebGPU stepping
  suppresses side branching relative to the CPU implicit-temperature result.
  Reducing the CPU time step to the WebGPU value does not reproduce this
  suppression, so WebGPU output is presented as an experimental comparison
  rather than a replacement reference.
