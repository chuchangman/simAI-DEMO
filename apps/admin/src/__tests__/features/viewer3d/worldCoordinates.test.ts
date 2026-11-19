import {
  THREE_TO_WORLD_MATRIX,
  threeToWorld,
  toThreePoint,
  toWorldPoint,
  toWorldUnitVector,
  WORLD_TO_THREE_MATRIX,
  worldBoxToThree,
  worldDirectionToThree,
  worldPoint,
  worldToThree,
  type Matrix3,
} from '@/features/viewer3d/worldCoordinates';
import { describe, expect, it } from 'vitest';

// AI-2 정본(ai/tests/geometry/test_coordinates.py, S15P31A101-97)과 같은 격자·기준값으로 독립 검증한다.
const GRID_X = [-1.25, 0, 0.5, 1, 3.3, 7.77, 10];
const GRID_Y = [-0.4, 0, 1, 2.5, 6.1, 8];
const GRID_Z = [0, 0.05, 1, 1.7, 3];
const TOLERANCE_M = 1e-9;

type Vec3 = readonly [number, number, number];

const multiply = (m: Matrix3, [x, y, z]: Vec3): number[] =>
  m.map((r) => r[0] * x + r[1] * y + r[2] * z);
// + 0 으로 -0 을 0 으로 맞춘다.
const cross = (a: Vec3, b: Vec3): number[] => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
];
const det = (m: Matrix3) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const maxDiff = (a: Vec3, b: Vec3) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

function* grid() {
  for (const x of GRID_X) for (const y of GRID_Y) for (const z of GRID_Z) yield [x, y, z] as const;
}

describe('World → Three 기준점', () => {
  it.each([
    ['원점', [0, 0, 0], [0, 0, 0]],
    ['+X 1m', [1, 0, 0], [1, 0, 0]],
    ['-X 1m', [-1, 0, 0], [-1, 0, 0]],
    ['+Y 1m', [0, 1, 0], [0, 0, -1]],
    ['-Y 1m', [0, -1, 0], [0, 0, 1]],
    ['+Z 1m', [0, 0, 1], [0, 1, 0]],
    ['-Z 1m', [0, 0, -1], [0, -1, 0]],
  ] as const)('%s', (_, world, three) => {
    expect(worldToThree(toWorldPoint([...world])!)).toEqual(three);
    expect(threeToWorld(toThreePoint([...three])!)).toEqual(world);
  });

  it('0 을 -0 으로 바꾸지 않는다', () => {
    expect(Object.is(worldToThree(worldPoint(0, 0, 0))[2], 0)).toBe(true);
    expect(Object.is(threeToWorld(toThreePoint([0, 0, 0])!)[1], 0)).toBe(true);
  });

  it('World 축 단위벡터를 옮겨도 오른손 좌표계다(X × Y = Z)', () => {
    const ex = worldToThree(worldPoint(1, 0, 0));
    const ey = worldToThree(worldPoint(0, 1, 0));
    const ez = worldToThree(worldPoint(0, 0, 1));
    expect(cross(ex, ey)).toEqual(ez);
  });
});

describe('변환 행렬', () => {
  it('-97 정본 행렬과 같고 행렬식이 +1 이다', () => {
    expect(WORLD_TO_THREE_MATRIX).toEqual([
      [1, 0, 0],
      [0, 0, 1],
      [0, -1, 0],
    ]);
    expect(THREE_TO_WORLD_MATRIX).toEqual([
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ]);
    expect(det(WORLD_TO_THREE_MATRIX)).toBe(1);
    expect(det(THREE_TO_WORLD_MATRIX)).toBe(1);
  });

  it('두 행렬은 서로의 역이다', () => {
    for (const e of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const) {
      expect(
        multiply(THREE_TO_WORLD_MATRIX, multiply(WORLD_TO_THREE_MATRIX, e) as unknown as Vec3),
      ).toEqual(e);
    }
  });

  it('격자 전체에서 함수와 행렬 곱이 같다', () => {
    for (const p of grid()) {
      expect(
        maxDiff(
          worldToThree(worldPoint(...p)),
          multiply(WORLD_TO_THREE_MATRIX, p) as unknown as Vec3,
        ),
      ).toBe(0);
      const three = toThreePoint([...p])!;
      expect(
        maxDiff(threeToWorld(three), multiply(THREE_TO_WORLD_MATRIX, p) as unknown as Vec3),
      ).toBe(0);
    }
  });
});

describe('왕복 오차', () => {
  it('격자·소수·음수 좌표를 양방향으로 왕복해도 1e-9m 이내다', () => {
    let worst = 0;
    let count = 0;
    for (const p of grid()) {
      worst = Math.max(worst, maxDiff(threeToWorld(worldToThree(worldPoint(...p))), p));
      worst = Math.max(worst, maxDiff(worldToThree(threeToWorld(toThreePoint([...p])!)), p));
      count += 2;
    }
    expect(count).toBe(GRID_X.length * GRID_Y.length * GRID_Z.length * 2);
    expect(worst).toBeLessThanOrEqual(TOLERANCE_M);
  });
});

describe('불량 좌표', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', [1, Number.NaN, 0]],
    ['Infinity', [Number.POSITIVE_INFINITY, 0, 0]],
    ['-Infinity', [0, 0, Number.NEGATIVE_INFINITY]],
    ['값 2개', [1, 2]],
    ['값 4개', [1, 2, 3, 4]],
    ['빈 칸', Object.assign(new Array<number>(3), { 0: 1, 2: 3 })],
    ['null 포함', [1, null, 3]],
    ['문자열 숫자', ['1', 2, 3]],
    ['객체', { x: 1, y: 2, z: 3 }],
    ['빈 배열', []],
  ])('%s 는 좌표가 되지 않는다', (_, value) => {
    expect(toWorldPoint(value)).toBeNull();
    expect(toThreePoint(value)).toBeNull();
  });

  it('상수 좌표가 유한하지 않으면 0 으로 채우지 않고 예외를 던진다', () => {
    expect(() => worldPoint(Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => worldPoint(0, Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
  });

  it('바깥 값을 그대로 쓰지 않고 새 배열로 받는다', () => {
    const raw = [1, 2, 3];
    const point = toWorldPoint(raw)!;
    raw[0] = 99;
    expect(point).toEqual([1, 2, 3]);
  });
});

describe('worldBoxToThree', () => {
  it('World 축 정렬 상자의 중심과 Three 길이를 돌려준다', () => {
    const box = worldBoxToThree(worldPoint(0.5, 6.8, 0), worldPoint(3.5, 9.2, 2))!;
    expect(box.position[0]).toBeCloseTo(2, 12);
    expect(box.position[1]).toBeCloseTo(1, 12);
    expect(box.position[2]).toBeCloseTo(-8, 12);
    expect(box.size[0]).toBeCloseTo(3, 12);
    expect(box.size[1]).toBeCloseTo(2, 12);
    expect(box.size[2]).toBeCloseTo(2.4, 12);
  });

  it('min 이 max 보다 크면 null', () => {
    expect(worldBoxToThree(worldPoint(1, 0, 0), worldPoint(0, 1, 1))).toBeNull();
    expect(worldBoxToThree(worldPoint(0, 0, 1), worldPoint(1, 1, 0))).toBeNull();
  });
});

describe('World 단위 방향 벡터 변환(toWorldUnitVector · worldDirectionToThree)', () => {
  it('유효한 단위 방향 벡터를 정규화하고 Three.js 방향 (dx, dz, -dy) 로 변환한다', () => {
    const dir = toWorldUnitVector([0.7574, 0.5581, -0.3388])!;
    expect(dir).not.toBeNull();
    expect(Math.hypot(dir[0], dir[1], dir[2])).toBeCloseTo(1, 6);

    const threeDir = worldDirectionToThree(dir);
    expect(threeDir[0]).toBeCloseTo(dir[0], 12);
    expect(threeDir[1]).toBeCloseTo(dir[2], 12);
    expect(threeDir[2]).toBeCloseTo(-dir[1], 12);
    expect(Math.hypot(threeDir[0], threeDir[1], threeDir[2])).toBeCloseTo(1, 6);
  });

  it('영벡터나 길이가 1 에서 크게 벗어난 벡터·비유한 값은 null 로 거부한다', () => {
    expect(toWorldUnitVector([0, 0, 0])).toBeNull();
    expect(toWorldUnitVector([0.2, 0, 0])).toBeNull();
    expect(toWorldUnitVector([2, 0, 0])).toBeNull();
    expect(toWorldUnitVector([1, Number.NaN, 0])).toBeNull();
  });
});
