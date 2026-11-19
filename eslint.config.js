import config from '@simai/eslint-config';
import globals from 'globals';

// 루트 수준 설정 파일(이 파일, .prettierrc.mjs, 설정 패키지)만 검사한다. 앱과 packages/ui는 각자 eslint.config.js를 둔다.
/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ['apps/**', 'packages/ui/**', '**/dist/**', '**/.turbo/**'],
  },
  ...config,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
