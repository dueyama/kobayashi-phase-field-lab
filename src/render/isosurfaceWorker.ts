import { index3D } from '../simulation/fields';
import { buildIsosurfaceMesh } from '../simulation/isosurface';
import { temperatureToColor } from './colorMaps';

export interface IsosurfaceBuildRequest {
  id: number;
  type: 'build';
  phi: Float32Array;
  temperature: Float32Array;
  sourceNx: number;
  sourceNy: number;
  sourceNz: number;
  displayNx: number;
  displayNy: number;
  displayNz: number;
  mirrorXY: boolean;
  halfCellMirror: boolean;
  iso: number;
  stride: number;
}

export interface IsosurfaceBuildResponse {
  id: number;
  type: 'built';
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  triangleCount: number;
}

export interface IsosurfaceErrorResponse {
  id: number;
  type: 'error';
  message: string;
}

export type IsosurfaceWorkerResponse = IsosurfaceBuildResponse | IsosurfaceErrorResponse;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<IsosurfaceBuildRequest>) => void) | null;
  postMessage: (message: IsosurfaceWorkerResponse, transfer?: Transferable[]) => void;
};

function sourceFromMirrorIndex(index: number, sourceSize: number, mirrorXY: boolean, halfCellMirror: boolean): number {
  if (!mirrorXY) return index;
  if (halfCellMirror) return index < sourceSize ? sourceSize - 1 - index : index - sourceSize;
  return index < sourceSize - 1 ? sourceSize - 1 - index : index - sourceSize + 1;
}

workerScope.onmessage = (event: MessageEvent<IsosurfaceBuildRequest>) => {
  const request = event.data;
  if (request.type !== 'build') return;

  try {
    const scale = 1 / Math.max(request.displayNx, request.displayNy, request.displayNz);
    const mesh = buildIsosurfaceMesh(
      request.phi,
      request.temperature,
      request.displayNx,
      request.displayNy,
      request.displayNz,
      {
        iso: request.iso,
        stride: request.stride,
        cellSize: scale,
        originX: -request.displayNx * scale * 0.5,
        originY: -request.displayNy * scale * 0.5,
        originZ: -request.displayNz * scale * 0.5,
        mapIndex: (x, y, z) =>
          index3D(
            sourceFromMirrorIndex(x, request.sourceNx, request.mirrorXY, request.halfCellMirror),
            sourceFromMirrorIndex(y, request.sourceNy, request.mirrorXY, request.halfCellMirror),
            z,
            request.sourceNx,
            request.sourceNy
          )
      }
    );
    const colors = new Float32Array(mesh.temperatures.length * 3);
    for (let i = 0; i < mesh.temperatures.length; i += 1) {
      const [r, g, b] = temperatureToColor(mesh.temperatures[i]);
      colors[i * 3] = Math.max(r / 255, 0.66);
      colors[i * 3 + 1] = Math.max(g / 255, 0.78);
      colors[i * 3 + 2] = Math.max(b / 255, 0.9);
    }

    const response: IsosurfaceBuildResponse = {
      id: request.id,
      type: 'built',
      positions: mesh.positions,
      normals: mesh.normals,
      colors,
      triangleCount: mesh.triangleCount
    };
    workerScope.postMessage(response, [response.positions.buffer, response.normals.buffer, response.colors.buffer]);
  } catch (error: unknown) {
    const response: IsosurfaceErrorResponse = {
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    };
    workerScope.postMessage(response);
  }
};
