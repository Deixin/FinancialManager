import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  envPrefix: [],
  build: {
    outDir: 'frontend-dist',
    target: 'es2023',
    sourcemap: false,
    emptyOutDir: true,
  },
  server: { host: '127.0.0.1', port: 44361, strictPort: true },
});
