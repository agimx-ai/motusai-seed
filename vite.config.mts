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
        this.emitFile({
          type: 'asset',
          fileName: 'third-party-notices/driver.js.txt',
          source: await readFile(resolve(projectRoot, 'node_modules/driver.js/license'), 'utf8'),
        });
      },
    },
  ],
  resolve: {
    alias: [
      { find: '@motus-ai/seed-sdk/styles.css', replacement: resolve(projectRoot, 'packages/seed-sdk/dist/styles.css') },
      { find: '@motus-ai/seed-sdk/react', replacement: resolve(projectRoot, 'packages/seed-sdk/src/react/index.ts') },
      { find: /^@motus-ai\/seed-sdk$/, replacement: resolve(projectRoot, 'packages/seed-sdk/src/browser.ts') },
      { find: '@renderer', replacement: resolve(projectRoot, 'src/renderer') },
      { find: '@shared', replacement: resolve(projectRoot, 'src/shared') },
    ],
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
