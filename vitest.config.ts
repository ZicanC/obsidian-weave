import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        runes: true,
        compatibility: {
          componentApi: 4
        }
      },
      hot: false
    }),
    svelteTesting()
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts', './src/tests/vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/demo/**',
        '**/mocks/**'
      ]
    },
    server: {
      deps: {
        inline: ['svelte']
      }
    }
  },
  resolve: {
    alias: {
      '@': '/src',
      'obsidian': '/src/tests/mocks/obsidian.ts'
    }
  },
  define: {
    global: 'globalThis'
  }
});
