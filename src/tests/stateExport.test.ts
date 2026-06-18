import { describe, expect, it } from 'vitest';

import { createStateExportBlob, parseStateExportArrayBuffer } from '../simulation/stateExport';
import type { SimulationSnapshot } from '../simulation/types';
import { clonePreset } from '../simulation/presets';

describe('state export', () => {
  it('writes a compact header followed by phi and temperature float32 payloads', async () => {
    const config = clonePreset('2d-fourfold');
    config.nx = 2;
    config.ny = 2;
    config.nz = 1;
    const phi = new Float32Array([0, 0.25, 0.5, 1]);
    const temperature = new Float32Array([1, 2, 3, 4]);
    const snapshot: SimulationSnapshot = {
      dimension: '2d',
      nx: 2,
      ny: 2,
      nz: 1,
      phi,
      temperature,
      step: 12,
      time: 0.024,
      minPhi: 0,
      maxPhi: 1,
      minTemperature: 1,
      maxTemperature: 4
    };

    const blob = createStateExportBlob(snapshot, config, new Date('2026-06-18T00:00:00.000Z'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    const headerStart = 4;
    const headerEnd = headerStart + headerLength;
    const payloadStart = headerEnd + ((4 - (headerEnd % 4)) % 4);
    const header = JSON.parse(new TextDecoder().decode(bytes.slice(headerStart, headerEnd)));
    const payload = new Float32Array(bytes.buffer, bytes.byteOffset + payloadStart, phi.length + temperature.length);

    expect(blob.type).toBe('application/octet-stream');
    expect(blob.size).toBe(payloadStart + phi.byteLength + temperature.byteLength);
    expect(header.format).toBe('kobayashi-phasefield-state');
    expect(header.version).toBe(1);
    expect(header.createdAt).toBe('2026-06-18T00:00:00.000Z');
    expect(header.snapshot).toMatchObject({ dimension: '2d', nx: 2, ny: 2, nz: 1, step: 12, time: 0.024 });
    expect(header.payload.fields).toEqual([
      { name: 'phi', dtype: 'float32', length: 4, byteLength: 16 },
      { name: 'temperature', dtype: 'float32', length: 4, byteLength: 16 }
    ]);
    expect(Array.from(payload)).toEqual([0, 0.25, 0.5, 1, 1, 2, 3, 4]);

    const parsed = parseStateExportArrayBuffer(await blob.arrayBuffer());
    expect(parsed.header.snapshot.step).toBe(12);
    expect(parsed.config.nx).toBe(2);
    expect(parsed.snapshot).toMatchObject({ dimension: '2d', nx: 2, ny: 2, nz: 1, step: 12, time: 0.024 });
    expect(Array.from(parsed.snapshot.phi)).toEqual([0, 0.25, 0.5, 1]);
    expect(Array.from(parsed.snapshot.temperature)).toEqual([1, 2, 3, 4]);
  });
});
