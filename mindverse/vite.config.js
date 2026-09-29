import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // relative asset URLs so the build works from any sub-path
  base: './',
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // the artifact build is a single inlined script
    assetsInlineLimit: mode === 'artifact' ? 100_000_000 : 4096,
    cssCodeSplit: mode !== 'artifact',
  },
  test: {
    include: ['test/**/*.test.js'],
  },
}));
