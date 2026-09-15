import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Server-side tests only. The frontend is exercised through the app
    // itself; these cover the pure logic where a silent wrong answer is
    // expensive - CPC parsing, export mapping, password verification and
    // the queue's claim/recovery semantics.
    include: ['server/**/*.test.ts'],
    environment: 'node',
  },
});
