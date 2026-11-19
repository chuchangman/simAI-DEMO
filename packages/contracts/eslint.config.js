import config from '@simai/eslint-config';
import globals from 'globals';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    // contracts/ 에서 생성한 파일은 손으로 고치지 않는다.
    ignores: ['src/generated/**'],
  },
  ...config,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
