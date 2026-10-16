import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { offlinePlugin } from './tooling/offline-plugin.js';

export default defineConfig({
  plugins: [react(), offlinePlugin()],
  server: {
    host: true,
    port: 5173,
    // El navegador habla siempre con un solo origen. En desarrollo lo resuelve
    // este proxy; en la demostracion lo resuelve el servicio `proxy` de la
    // composicion (plan maestro 4.3).
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '') || '/',
      },
      '/collab': {
        target: process.env['VITE_COLLAB_TARGET'] ?? 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/collab(?=\/|$)/, '') || '/',
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
