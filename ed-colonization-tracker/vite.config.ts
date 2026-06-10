import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';

// Single version source: package.json (also read by build-exe.mjs for the server banner)
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
