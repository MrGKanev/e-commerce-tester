import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import js from '@eslint/js';
import globals from 'globals';

export default tseslint.config(
  {
    files: ['tests/**/*.ts', 'config/**/*.ts', 'checks/**/*.ts', '*.ts'],
    extends: [...tseslint.configs.recommended, playwright.configs['flat/recommended']],
    rules: {
      // Playwright-specific
      'playwright/no-networkidle': 'error',
      'playwright/no-wait-for-timeout': 'error',
      'playwright/prefer-web-first-assertions': 'warn',
      'playwright/no-force-option': 'warn',
      'playwright/no-standalone-expect': 'error',

      // Off by design: tests skip/branch when a store lacks an optional feature
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
      'playwright/no-skipped-test': 'off',
      'playwright/expect-expect': 'off',

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['scripts/**/*.js', 'config/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['web/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // Disable formatting rules that conflict with Prettier
  prettierConfig,
);
