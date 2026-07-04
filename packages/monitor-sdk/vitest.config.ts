import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    SDK_VERSION: JSON.stringify('0.1.0'),
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
