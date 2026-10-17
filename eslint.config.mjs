import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/frontend-dist/**',
      'apps/desktop/src-tauri/smoke.js',
      '**/target/**',
      '**/.turbo/**',
      '**/.tools/**',
      '**/.pnpm-store/**',
      '**/.pnpm-cache/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      '**/.expo/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-duplicate-imports': 'error',
    },
  },
];
