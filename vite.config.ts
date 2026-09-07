import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [{
    name: 'local-demo-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/') return next();
        const hostname = req.headers.host?.split(':')[0] === 'localhost' ? 'localhost' : '127.0.0.1';
        res.writeHead(302, { Location: `http://${hostname}:5174/` });
        res.end();
      });
    },
  }],
  root: resolve('wallet'),
  cacheDir: resolve('node_modules/.vite-wallet'),
  envDir: resolve('.'),
  publicDir: resolve('public'),
  server: { port: 5173, strictPort: true, cors: true },
  build: { outDir: resolve('dist'), emptyOutDir: true, rollupOptions: { input: resolve('wallet/wallet.html') } },
});
