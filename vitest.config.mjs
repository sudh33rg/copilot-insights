import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{core,shared,extension}/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'webview',
          environment: 'jsdom',
          include: ['src/webview/**/*.test.{ts,tsx}'],
          setupFiles: ['src/webview/test/setup.ts'],
        },
      },
    ],
  },
});
