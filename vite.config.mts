import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const root = import.meta.dirname;

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(root, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome130'
  }
});
