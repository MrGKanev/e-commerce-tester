import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    files: ['tests/**/*.ts', '*.ts'],
    extends: [
      ...tseslint.configs.recommended,
      playwright.configs['flat/recommended'],
    ],
    rules: {
      // Playwright-specific
      'playwright/no-wait-for-timeout': 'warn',
      'playwright/prefer-web-first-assertions': 'warn',
      'playwright/no-force-option': 'warn',
      'playwright/no-standalone-expect': 'error',

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
  // Disable formatting rules that conflict with Prettier
  prettierConfig,
);
