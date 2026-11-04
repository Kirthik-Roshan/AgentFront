import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react()],
  server: {
    port: 3000,
    // AgentFront's API permits WEB_ORIGIN (localhost:3000). Falling through to
    // 3001 creates a convincing but disconnected UI, so fail loudly instead.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
});
