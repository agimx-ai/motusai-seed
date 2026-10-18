import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const developmentNonce = randomBytes(32).toString('base64');

export default defineConfig(({ command }) => ({
  base: './',
  html: command === 'serve' ? { cspNonce: developmentNonce } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'sdk-license-notices',
      async generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'third-party-notices/liquid-gooey.txt',
          source: await readFile(
            resolve(projectRoot, 'packages/seed-sdk/src/react/vendor/liquid-gooey/LICENSE'),
            'utf8',
          ),
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@motus-ai/seed-sdk/styles.css': resolve(projectRoot, 'packages/seed-sdk/dist/styles.css'),
      '@motus-ai/seed-sdk/react': resolve(projectRoot, 'packages/seed-sdk/src/react/index.ts'),
      '@motus-ai/seed-sdk': resolve(projectRoot, 'packages/seed-sdk/src/index.ts'),
      '@renderer': resolve(projectRoot, 'src/renderer'),
      '@shared': resolve(projectRoot, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(projectRoot, 'index.html'),
        pluginHost: resolve(projectRoot, 'src/renderer/hosts/plugin/index.html'),
        audioCapture: resolve(projectRoot, 'src/renderer/hosts/audio/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: { 'X-Seed-Development-Nonce': developmentNonce },
  },
}));
