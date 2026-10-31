// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.worktrees/**', 'dist/**', 'dist-single/**', 'shots/**', 'test-results/**', 'playwright-report/**', 'eslint.config.js', '.*.mjs'],
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
    files: ['src/**/*.ts'],
    ignores: ['src/dev/**/*.spec.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.config.ts', 'src/dev/**/*.spec.ts', 'server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
