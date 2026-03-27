import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/edsm-api': {
        target: 'https://www.edsm.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/edsm-api/, ''),
      },
      '/ardent-api': {
        target: 'https://api.ardent-insight.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ardent-api/, ''),
      },
      '/spansh-api': {
        target: 'https://spansh.co.uk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/spansh-api/, ''),
      },
    },
  },
});
