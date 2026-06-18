import type { PhaseFieldConfig, SimulationSnapshot } from './types';

export interface StateExportHeader {
  format: 'kobayashi-phasefield-state';
  version: 1;
  createdAt: string;
  config: PhaseFieldConfig;
  snapshot: {
    dimension: SimulationSnapshot['dimension'];
    nx: number;
    ny: number;
    nz: number;
    step: number;
    time: number;
    minPhi: number;
    maxPhi: number;
    minTemperature: number;
    maxTemperature: number;
  };
  payload: {
    byteOrder: 'little-endian';
    fields: Array<{
      name: 'phi' | 'temperature';
      dtype: 'float32';
      length: number;
      byteLength: number;
    }>;
  };
}

export function createStateExportBlob(snapshot: SimulationSnapshot, config: PhaseFieldConfig, createdAt = new Date()): Blob {
  const { headerBytes, headerLengthBytes, headerPaddingBytes } = createStateExportHeaderBytes(snapshot, config, createdAt);
  return new Blob(
    [headerLengthBytes, headerBytes, headerPaddingBytes, floatBytes(snapshot.phi), floatBytes(snapshot.temperature)].map(bytesAsBlobPart),
    {
      type: 'application/octet-stream'
    }
  );
}

export function createStateExportHeader(snapshot: SimulationSnapshot, config: PhaseFieldConfig, createdAt = new Date()): StateExportHeader {
  return {
    format: 'kobayashi-phasefield-state',
    version: 1,
    createdAt: createdAt.toISOString(),
    config,
    snapshot: {
      dimension: snapshot.dimension,
      nx: snapshot.nx,
      ny: snapshot.ny,
      nz: snapshot.nz,
      step: snapshot.step,
      time: snapshot.time,
      minPhi: snapshot.minPhi,
      maxPhi: snapshot.maxPhi,
      minTemperature: snapshot.minTemperature,
      maxTemperature: snapshot.maxTemperature
    },
    payload: {
      byteOrder: 'little-endian',
      fields: [
        { name: 'phi', dtype: 'float32', length: snapshot.phi.length, byteLength: snapshot.phi.byteLength },
        {
          name: 'temperature',
          dtype: 'float32',
          length: snapshot.temperature.length,
          byteLength: snapshot.temperature.byteLength
        }
      ]
    }
  };
}

export function parseStateExportArrayBuffer(arrayBuffer: ArrayBuffer): {
  header: StateExportHeader;
  config: PhaseFieldConfig;
  snapshot: SimulationSnapshot;
} {
  if (arrayBuffer.byteLength < 4) throw new Error('State file is too small.');
  const dataView = new DataView(arrayBuffer);
  const headerLength = dataView.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > arrayBuffer.byteLength) throw new Error('State file header is truncated.');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, headerStart, headerLength))) as StateExportHeader;
  if (header.format !== 'kobayashi-phasefield-state' || header.version !== 1) {
    throw new Error('Unsupported state file format.');
  }

  const payloadStart = headerEnd + ((4 - (headerEnd % 4)) % 4);
  const phiField = header.payload.fields.find((field) => field.name === 'phi');
  const temperatureField = header.payload.fields.find((field) => field.name === 'temperature');
  if (!phiField || !temperatureField) throw new Error('State file is missing required fields.');
  const expectedPayloadBytes = phiField.byteLength + temperatureField.byteLength;
  if (payloadStart + expectedPayloadBytes > arrayBuffer.byteLength) throw new Error('State file payload is truncated.');

  const phi = new Float32Array(arrayBuffer, payloadStart, phiField.length);
  const temperature = new Float32Array(arrayBuffer, payloadStart + phiField.byteLength, temperatureField.length);
  return {
    header,
    config: header.config,
    snapshot: {
      dimension: header.snapshot.dimension,
      nx: header.snapshot.nx,
      ny: header.snapshot.ny,
      nz: header.snapshot.nz,
      phi,
      temperature,
      step: header.snapshot.step,
      time: header.snapshot.time,
      minPhi: header.snapshot.minPhi,
      maxPhi: header.snapshot.maxPhi,
      minTemperature: header.snapshot.minTemperature,
      maxTemperature: header.snapshot.maxTemperature
    }
  };
}

function createStateExportHeaderBytes(
  snapshot: SimulationSnapshot,
  config: PhaseFieldConfig,
  createdAt: Date
): { headerBytes: Uint8Array; headerLengthBytes: Uint8Array; headerPaddingBytes: Uint8Array } {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(createStateExportHeader(snapshot, config, createdAt)));
  const headerLengthBytes = new Uint8Array(4);
  new DataView(headerLengthBytes.buffer).setUint32(0, headerBytes.byteLength, true);
  const headerPaddingBytes = new Uint8Array((4 - ((headerLengthBytes.byteLength + headerBytes.byteLength) % 4)) % 4);
  return { headerBytes, headerLengthBytes, headerPaddingBytes };
}

function floatBytes(values: Float32Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

function bytesAsBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart;
}
