import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
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
  },
})
