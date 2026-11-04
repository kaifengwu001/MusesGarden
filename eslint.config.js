// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.worktrees/**', 'environments/muse-*/**', '.vite-cache/**', 'dist/**', 'dist-environments/**', 'dist-single/**', 'shots/**', 'test-results/**', 'playwright-report/**', 'eslint.config.js', '.*.mjs', 'tools/workflows/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json', './tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['src/**/*.ts', 'environments/**/*.ts'],
    ignores: ['src/dev/**/*.spec.ts', 'src/muse/ui/**/*.e2e.ts', 'environments/**/*.spec.ts', 'environments/*/vite.config.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.config.ts', 'src/dev/**/*.spec.ts', 'src/muse/ui/**/*.e2e.ts', 'server/**/*.ts', 'environments/**/*.spec.ts', 'environments/*/vite.config.ts', 'scripts/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
