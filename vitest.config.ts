import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // scripts/ is covered too - build-sw.ts has logic worth testing, notably
    // the placeholder substitution that a bundler can silently break.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
