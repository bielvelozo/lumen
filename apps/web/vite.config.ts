/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/setup-test.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
