import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5173', changeOrigin: false },
      '/media': { target: 'http://127.0.0.1:5173', changeOrigin: false },
      '/resources': { target: 'http://127.0.0.1:5173', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});
