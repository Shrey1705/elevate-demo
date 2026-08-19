import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/core': { target: 'http://localhost:4001', changeOrigin: true, rewrite: p => p.replace(/^\/api\/core/, '') },
      '/api/ai':   { target: 'http://localhost:4002', changeOrigin: true, rewrite: p => p.replace(/^\/api\/ai/, '') },
      '/api/edw':  { target: 'http://localhost:4003', changeOrigin: true, rewrite: p => p.replace(/^\/api\/edw/, '') }
    }
  }
});
