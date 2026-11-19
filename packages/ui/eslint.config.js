import config from '@simai/eslint-config/react';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    // shadcn CLI가 만든 컴포넌트는 손으로 고치지 않는다.
    ignores: ['src/components/**'],
  },
  ...config,
];
