import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(here, 'src'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(here, 'dist-electron'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(here, 'src/index.html')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
