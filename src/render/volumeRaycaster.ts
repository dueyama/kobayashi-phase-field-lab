import * as THREE from 'three';

import type { SliceStack } from './volumeRenderer';

export function createVolumeRaycaster(
  phi: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  steps = Math.min(192, Math.max(96, Math.ceil(Math.max(nx, ny, nz) * 0.85)))
): SliceStack {
  const group = new THREE.Group();
  const scale = 1 / Math.max(nx, ny, nz);
  const width = nx * scale;
  const height = ny * scale;
  const depth = nz * scale;
  const texture = createPhiTexture(phi, nx, ny, nz);
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uVolume: { value: texture },
      uBoxSize: { value: new THREE.Vector3(width, height, depth) },
      uSteps: { value: steps },
      uOpacity: { value: 1.65 }
    },
    vertexShader: /* glsl */ `
      out vec3 vRayOrigin;
      out vec3 vRayDirection;

      void main() {
        vRayOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vRayDirection = position - vRayOrigin;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform sampler3D uVolume;
      uniform vec3 uBoxSize;
      uniform float uSteps;
      uniform float uOpacity;

      in vec3 vRayOrigin;
      in vec3 vRayDirection;
      out vec4 outColor;

      vec2 intersectBox(vec3 origin, vec3 direction, vec3 boxMin, vec3 boxMax) {
        vec3 invDirection = 1.0 / direction;
        vec3 t0 = (boxMin - origin) * invDirection;
        vec3 t1 = (boxMax - origin) * invDirection;
        vec3 tsmaller = min(t0, t1);
        vec3 tbigger = max(t0, t1);
        float tNear = max(max(tsmaller.x, tsmaller.y), tsmaller.z);
        float tFar = min(min(tbigger.x, tbigger.y), tbigger.z);
        return vec2(tNear, tFar);
      }

      vec4 sampleColor(float phi) {
        float solid = smoothstep(0.14, 0.95, phi);
        float interfaceBand = 1.0 - smoothstep(0.025, 0.17, abs(phi - 0.5));
        vec3 liquid = vec3(0.03, 0.18, 0.34);
        vec3 gold = vec3(1.0, 0.78, 0.18);
        vec3 color = mix(liquid, gold, solid);
        color += vec3(0.85, 1.0, 0.85) * interfaceBand * 0.35;
        float alpha = max(interfaceBand * 0.105, solid * 0.022) * uOpacity;
        return vec4(color, alpha);
      }

      void main() {
        vec3 rayDirection = normalize(vRayDirection);
        vec3 boxHalf = uBoxSize * 0.5;
        vec2 hit = intersectBox(vRayOrigin, rayDirection, -boxHalf, boxHalf);
        if (hit.x > hit.y) discard;

        float tStart = max(hit.x, 0.0);
        float tEnd = hit.y;
        float dt = (tEnd - tStart) / uSteps;
        vec4 accumulated = vec4(0.0);

        for (int i = 0; i < 256; i++) {
          if (float(i) >= uSteps || accumulated.a > 0.96) break;
          float t = tStart + (float(i) + 0.5) * dt;
          vec3 samplePosition = vRayOrigin + rayDirection * t;
          vec3 texCoord = samplePosition / uBoxSize + 0.5;
          float phi = texture(uVolume, texCoord).r;
          vec4 sampleValue = sampleColor(phi);
          sampleValue.a *= smoothstep(0.0, 0.02, texCoord.x) * (1.0 - smoothstep(0.98, 1.0, texCoord.x));
          sampleValue.a *= smoothstep(0.0, 0.02, texCoord.y) * (1.0 - smoothstep(0.98, 1.0, texCoord.y));
          sampleValue.a *= smoothstep(0.0, 0.02, texCoord.z) * (1.0 - smoothstep(0.98, 1.0, texCoord.z));
          accumulated.rgb += (1.0 - accumulated.a) * sampleValue.a * sampleValue.rgb;
          accumulated.a += (1.0 - accumulated.a) * sampleValue.a;
        }

        if (accumulated.a <= 0.01) discard;
        outColor = accumulated;
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);

  return {
    group,
    dispose: () => {
      texture.dispose();
      geometry.dispose();
      material.dispose();
    }
  };
}

function createPhiTexture(phi: Float32Array, nx: number, ny: number, nz: number): THREE.Data3DTexture {
  const data = new Uint8Array(nx * ny * nz);
  for (let i = 0; i < phi.length; i += 1) {
    data[i] = Math.round(Math.max(0, Math.min(1, phi[i])) * 255);
  }
  const texture = new THREE.Data3DTexture(data, nx, ny, nz);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
