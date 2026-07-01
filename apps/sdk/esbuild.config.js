const esbuild = require('esbuild');

const builds = [
  // Браузерный bundle — это и есть track.js, отдаётся с CDN
  esbuild.build({
    entryPoints: ['src/browser.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    outfile: 'dist/browser.min.js',
  }),
  // Node.js CommonJS
  esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/index.js',
  }),
  // ESM
  esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/index.esm.js',
  }),
];

Promise.all(builds)
  .then(() => console.log('[sdk] esbuild: built browser.min.js + index.js + index.esm.js'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
