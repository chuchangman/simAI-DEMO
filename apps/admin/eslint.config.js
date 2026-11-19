import config from '@simai/eslint-config/react';

// front/CONVENTION.md 「의존 방향」을 import 규칙으로 막는다.
// no-restricted-imports 는 설정 블록이 겹치면 뒤 것이 앞 것을 덮어쓰므로, 파일 묶음마다 필요한 제한을 한 번에 넘긴다.
const NO_VITEST = { name: 'vitest', message: '테스트 코드는 src/__tests__ 에만 둔다.' };
const NO_OTHER_APP = {
  regex: '^(admin|pwa)(/|$)',
  message: '앱끼리는 import 하지 않는다. 같이 쓰는 것은 packages/ 로 올린다.',
};
const NO_PARENT = { regex: '^\\.\\./', message: '상대 경로 대신 @/ 를 쓴다.' };
const NO_VIEWER3D_INSIDE = {
  regex: '^@/features/viewer3d/',
  message: 'viewer3d 는 입구(@/features/viewer3d)만 import 한다.',
};

const restrict = (paths, patterns) => ({
  'no-restricted-imports': ['error', { paths, patterns }],
});

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ['dist/**', 'public/basis/**', 'src/routeTree.gen.ts'],
  },
  ...config,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/__tests__/**', 'src/features/viewer3d/**'],
    rules: restrict([NO_VITEST], [NO_OTHER_APP, NO_PARENT, NO_VIEWER3D_INSIDE]),
  },
  {
    files: ['src/features/viewer3d/**/*.{ts,tsx}'],
    rules: restrict([NO_VITEST], [NO_OTHER_APP, NO_PARENT]),
  },
  {
    // 테스트는 viewer3d 내부(좌표 어댑터 등)도 직접 시험할 수 있다.
    files: ['src/__tests__/**/*.{ts,tsx}'],
    rules: restrict([], [NO_OTHER_APP, NO_PARENT]),
  },
];
