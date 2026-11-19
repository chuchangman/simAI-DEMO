import { describe, expect, it } from 'vitest';

// 2D 평면은 3D 가 멈췄을 때 쓰는 비상 화면이라(명세 13.6) three.js·3D 뷰어 코드에 기대면 안 된다.
// import 규칙(eslint.config.js)으로 막는 대신 여기서 소스를 검사한다.
const sources = import.meta.glob<string>('/src/features/plan/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// from '…', import '…'(부작용 import), import('…') 를 모두 잡는다. three-stdlib 같은 three 계열 패키지도 잡는다.
const THREE_IMPORT =
  /(from\s+|import\s*\(?\s*)['"](three(-[\w-]+)?|@react-three\/[^'"]+|@\/features\/viewer3d)(\/[^'"]*)?['"]/;

describe('2D 평면 독립', () => {
  it('features/plan 은 three.js·3D 뷰어를 import 하지 않는다', () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(0);
    for (const [path, code] of files) expect(code, path).not.toMatch(THREE_IMPORT);
  });

  it('검사식은 3D import 를 잡는다', () => {
    expect("import { Viewer3D } from '@/features/viewer3d';").toMatch(THREE_IMPORT);
    expect("import * as THREE from 'three';").toMatch(THREE_IMPORT);
    expect("const m = import('@/features/viewer3d/x');").toMatch(THREE_IMPORT);
    expect("import 'three';").toMatch(THREE_IMPORT);
    expect("import { OrbitControls } from 'three-stdlib';").toMatch(THREE_IMPORT);
    expect("import { planMarks } from '@/features/plan/plan';").not.toMatch(THREE_IMPORT);
  });
});
