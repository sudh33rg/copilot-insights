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
    ],
  },
});
