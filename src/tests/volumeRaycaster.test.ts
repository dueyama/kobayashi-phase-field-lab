import { describe, expect, it } from 'vitest';

import { writeVolumeTextureData, type VolumeFieldInput } from '../render/volumeRaycaster';

describe('volume texture updates', () => {
  it('converts a field directly without mirroring', () => {
    const input: VolumeFieldInput = {
      phi: new Float32Array([0, 0.25, 0.5, 1]),
      sourceNx: 2,
      sourceNy: 2,
      sourceNz: 1,
      displayNx: 2,
      displayNy: 2,
      mirrorXY: false,
      halfCellMirror: false
    };
    const data = new Uint8Array(4);

    writeVolumeTextureData(data, input);

    expect([...data]).toEqual([0, 64, 128, 255]);
  });

  it('mirrors a quarter field across half-cell x and y boundaries', () => {
    const input: VolumeFieldInput = {
      phi: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      sourceNx: 2,
      sourceNy: 2,
      sourceNz: 1,
      displayNx: 4,
      displayNy: 4,
      mirrorXY: true,
      halfCellMirror: true
    };
    const data = new Uint8Array(16);

    writeVolumeTextureData(data, input);

    expect([...data]).toEqual([
      102, 77, 77, 102,
      51, 26, 26, 51,
      51, 26, 26, 51,
      102, 77, 77, 102
    ]);
  });
});
