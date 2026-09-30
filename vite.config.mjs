import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the webview into fixed names the extension references: dist/webview/main.js and main.css.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rolldownOptions: {
      input: fileURLToPath(new URL('./src/webview/main.tsx', import.meta.url)),
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: (asset) =>
          (asset.names ?? []).some((name) => name.endsWith('.css'))
            ? 'main.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
