import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs', 'tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
