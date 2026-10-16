import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'generated-output/**',
      'output/**',
      'tmp/**',
      'temp/**',
      '.agents/**',
      '.claude/**',
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/reports/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'templates/**',
      'backend/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  prettier,
);
