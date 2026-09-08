import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 'src/e2e' is deliberately NOT ignored — it was, and that is part of why two
  // broken Playwright assertions survived the Bento migration unnoticed.
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // The codebase has deliberate, commented single-run effects (WebGL map
      // creation). Those carry an inline disable; everywhere else this is an error.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['vite.config.ts', 'playwright.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
