import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const layer = (message, paths, patterns) => ({
  'no-restricted-imports': ['error', { paths, patterns: [{ group: patterns, message }] }],
});

export default defineConfig([
  globalIgnores([
    'dist/**',
    'out/**',
    'coverage/**',
    '.vscode-test/**',
    '.superpowers/**',
    'node_modules/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: layer(
      'shared must stay environment-neutral (no vscode, node, react, or other layers).',
      ['vscode', 'react', 'react-dom'],
      ['node:*', '**/core/**', '**/extension/**', '**/webview/**'],
    ),
  },
  {
    files: ['src/core/**/*.ts'],
    rules: layer(
      'core may import only node:*, zod, core and shared.',
      ['vscode', 'react', 'react-dom'],
      ['**/extension/**', '**/webview/**'],
    ),
  },
  {
    files: ['src/extension/**/*.ts'],
    rules: layer('extension must not import the webview.', ['react', 'react-dom'], ['**/webview/**']),
  },
]);
