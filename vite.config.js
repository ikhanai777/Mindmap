import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // relative asset URLs so the build works from any path (Render, claude.ai artifact)
  base: './',
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.js'],
  },
}));
