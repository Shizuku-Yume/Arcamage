import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        timeout: 300000, // 5 分钟超时 (浏览器自动化需要时间)
      },
    },
  },
  preview: {
    port: 4173,
  },
});
