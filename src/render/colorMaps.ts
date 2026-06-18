import { clamp } from '../simulation/fields';

export function temperatureToColor(value: number): [number, number, number] {
  const t = clamp((value + 1.2) / 2.4, 0, 1);
  const r = Math.round(24 + 235 * smoothstep(0.35, 1, t));
  const g = Math.round(80 + 126 * (1 - Math.abs(t - 0.58) * 1.55));
  const b = Math.round(130 + 110 * (1 - smoothstep(0.3, 1, t)));
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

export function phaseToColor(phi: number): [number, number, number] {
  const p = clamp(phi, 0, 1);
  const r = Math.round(10 + 216 * p);
  const g = Math.round(28 + 222 * p);
  const b = Math.round(48 + 207 * p);
  return [r, g, b];
}

export function combinedColor(phi: number, temperature: number): [number, number, number] {
  const phase = phaseToColor(phi);
  const heat = temperatureToColor(temperature);
  const a = clamp((temperature + 0.8) / 2.2, 0, 0.45);
  return [
    Math.round(phase[0] * (1 - a) + heat[0] * a),
    Math.round(phase[1] * (1 - a) + heat[1] * a),
    Math.round(phase[2] * (1 - a) + heat[2] * a)
  ];
}

export function volumeColor(phi: number, temperature: number): [number, number, number, number] {
  const [r, g, b] = combinedColor(phi, temperature);
  const interfaceAlpha = Math.max(0, 1 - Math.abs(phi - 0.5) * 5.2);
  const solidAlpha = clamp((phi - 0.2) / 0.8, 0, 1) * 0.34;
  const heatAlpha = clamp((temperature + 0.75) / 2.2, 0, 0.18);
  const a = clamp(Math.max(interfaceAlpha * 0.7, solidAlpha, heatAlpha), 0, 0.82);
  return [r, g, b, Math.round(a * 255)];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
