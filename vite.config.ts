import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Keep generated asset URLs relative so the wallet also works from a
  // repository-scoped GitHub Pages URL (for example /eth-wallet/).
  base: './',
  root: resolve('wallet'),
  cacheDir: resolve('node_modules/.vite-wallet'),
  envDir: resolve('.'),
  publicDir: resolve('public'),
  server: { port: 5173, strictPort: true, cors: true },
  build: { outDir: resolve('dist'), emptyOutDir: true, rollupOptions: { input: resolve('wallet/index.html') } },
});
