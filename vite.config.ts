import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Project page on GitHub Pages: https://<owner>.github.io/3d-editor/
  // The base path is required so Vite prepends /3d-editor/ to all
  // emitted asset URLs. For local dev this is overridden automatically
  // by Vite (assets resolve from /).
  base: '/3d-editor/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@react-three')) return 'r3f';
          return undefined;
        },
      },
    },
  },
});