/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The repo keeps ONE .env at the root; Vite looks next to the app by default, so without
  // this VITE_API_URL was silently ignored and the client fell back to the hardcoded default.
  envDir: resolve(import.meta.dirname, '..', '..'),
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
