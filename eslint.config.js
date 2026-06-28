import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.agents/**',
      'scripts/**',
      '*.config.{js,ts}',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Allow underscore-prefixed unused args/vars (common pattern).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // React hooks rules (covered by tseslint, but the official rules plugin
      // isn't installed yet — add later when phase 3+ adds interactive state).
    },
  },
];