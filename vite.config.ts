import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function captureSavePlugin(): Plugin {
  return {
    name: 'phase-field-capture-save',
    configureServer(server) {
      const root = resolve(server.config.root);
      server.middlewares.use('/capture-save/', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end('method not allowed');
          return;
        }
        const requested = decodeURIComponent((request.url ?? '').replace(/^\/+/, ''));
        const target = resolve(root, requested);
        if (target !== root && !target.startsWith(`${root}${sep}`)) {
          response.statusCode = 400;
          response.end('invalid path');
          return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('error', (error) => {
          response.statusCode = 500;
          response.end(error.message);
        });
        request.on('end', () => {
          void (async () => {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, Buffer.concat(chunks));
            response.statusCode = 204;
            response.end();
          })().catch((error: unknown) => {
            response.statusCode = 500;
            response.end(error instanceof Error ? error.message : String(error));
          });
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [captureSavePlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.ts.net', 'dums2022.local', 'DUMS2022.local']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three']
        }
      }
    }
  },
  test: {
    environment: 'node'
  }
});
