import { defineConfig } from 'vite';

// Sites serves the Vite output as static assets through this minimal Worker
// entrypoint. The game itself remains a standard client-side Phaser app.
const sitesWorker = () => ({
  name: 'sites-worker',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'server/index.js',
      source: `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const url = new URL(request.url);
    if (url.pathname.includes('.')) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  },
};
`,
    });
  },
});

export default defineConfig({
  plugins: [sitesWorker()],
  base: './',
  server: { port: 5173, open: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
});
