// Bundles extension-host code. The React webview is built separately by Vite (vite.config.mjs).
import { globSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const integration = process.argv.includes('--integration');

/** @type {import('esbuild').BuildOptions} */
const node = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  external: ['vscode'],
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...node,
    entryPoints: { extension: 'src/extension/extension.ts', scanWorker: 'src/core/ingest/scanWorker.ts' },
    outdir: 'dist',
  },
];

if (integration) {
  builds.push({
    ...node,
    entryPoints: globSync('test/integration/**/*.test.ts'),
    outdir: 'out/integration',
    external: ['vscode', 'mocha'],
  });
}

const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
