// World 좌표(docs/spec/04-coordinates.md)와 Three.js 장면 좌표가 만나는 유일한 경계다.
// 장면 코드는 축을 직접 바꾸지 않고 여기 함수만 쓴다. 변환은 한 번만 적용한다.
//
// World   : 미터, 오른손, +Z 위, 바닥 Z=0. 원점은 첫 CALIBRATED 때 정한 교실 모서리 바닥이고,
//           X·Y 는 그 모서리에서 만나는 두 벽 방향이다.
// Three.js: 미터, 오른손, +Y 위.
// 식은 AI-2 정본(ai/src/simai_ai/geometry/coordinates.py, S15P31A101-97)과 같다.
//   World (x, y, z) → Three (x, z, -y)   +X→+X, +Y→-Z, +Z→+Y
//   Three (x, y, z) → World (x, -z, y)
//
// 사용 예(사람·구역·OBB·Provider):
//   const feet = toWorldPoint(payload.position);       // 바깥 값은 검사부터 한다. 불량이면 null
//   if (feet) mesh.position.set(...worldToThree(feet));  // null 이면 그리지 않는다(0 으로 채우지 않는다)
//   const box = worldBoxToThree(min, max);               // 축 정렬 상자 → position + boxGeometry args

declare const SPACE: unique symbol;
type Vec3 = [number, number, number];

/** World 좌표(m, Z-up). toWorldPoint·worldPoint 로만 만든다. */
export type WorldPoint = Vec3 & { readonly [SPACE]: 'world' };
/** Three.js 장면 좌표(m, Y-up). worldToThree·toThreePoint 로만 만든다. */
export type ThreePoint = Vec3 & { readonly [SPACE]: 'three' };

export type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** 열벡터 기준. Three = M · World. 행렬식 +1(회전)이라 오른손 좌표계를 지킨다. */
export const WORLD_TO_THREE_MATRIX: Matrix3 = [
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
];

/** WORLD_TO_THREE_MATRIX 의 역(전치). World = M · Three. */
export const THREE_TO_WORLD_MATRIX: Matrix3 = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// 길이 3 배열이고 세 값이 모두 유한한 숫자일 때만 통과한다. 빈 칸·null·NaN·Infinity 를 0 으로 바꾸지 않는다.
function finiteTriple(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value as unknown[];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  return [x, y, z];
}

/** 바깥에서 온 값을 World 좌표로 받는다. 모양이 틀리거나 유한하지 않으면 null. */
export function toWorldPoint(value: unknown): WorldPoint | null {
  return finiteTriple(value) as WorldPoint | null;
}

/** 바깥에서 온 값을 Three 좌표로 받는다. 모양이 틀리거나 유한하지 않으면 null. */
export function toThreePoint(value: unknown): ThreePoint | null {
  return finiteTriple(value) as ThreePoint | null;
}

/** 코드 안의 상수 World 좌표. 유한하지 않으면 프로그램 오류라 예외를 던진다. */
export function worldPoint(x: number, y: number, z: number): WorldPoint {
  const point = toWorldPoint([x, y, z]);
  if (!point) throw new RangeError(`World 좌표가 유한한 숫자가 아니다: (${x}, ${y}, ${z})`);
  return point;
}

// 0 - v 로 부호를 바꿔 0 이 -0 이 되지 않게 한다.
export function worldToThree([x, y, z]: WorldPoint): ThreePoint {
  return [x, z, 0 - y] as ThreePoint;
}

export function threeToWorld([x, y, z]: ThreePoint): WorldPoint {
  return [x, 0 - z, y] as WorldPoint;
}

/**
 * 바깥에서 온 방향 벡터를 World 단위 벡터로 받는다. 모양이 틀리거나 영벡터에 가까우면 null.
 * 길이가 1 에서 조금 벗어나도 정규화하고, 너무 벗어난 값(< 0.9 또는 > 1.1)은 거부한다.
 */
export function toWorldUnitVector(value: unknown): WorldPoint | null {
  const raw = finiteTriple(value);
  if (!raw) return null;
  const [dx, dy, dz] = raw;
  const norm = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(norm) || norm < 0.9 || norm > 1.1) return null;
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return [clean(dx / norm), clean(dy / norm), clean(dz / norm)] as WorldPoint;
}

/** World 방향 벡터(단위 벡터)를 Three.js 방향 벡터로 옮긴다. 회전 변환(행렬식 +1)이라 길이는 그대로다. */
export function worldDirectionToThree(direction: WorldPoint): ThreePoint {
  return worldToThree(direction);
}

export interface ThreeBox {
  /** 상자 중심(Three). */
  position: ThreePoint;
  /** boxGeometry args(Three X·Y·Z 길이). */
  size: Vec3;
}

/** World 축 정렬 상자(min·max 모서리)를 Three 상자로 옮긴다. 어느 축이든 max < min 이면 null. */
export function worldBoxToThree(min: WorldPoint, max: WorldPoint): ThreeBox | null {
  const [dx, dy, dz] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (dx < 0 || dy < 0 || dz < 0) return null;
  const center = worldPoint(min[0] + dx / 2, min[1] + dy / 2, min[2] + dz / 2);
  return { position: worldToThree(center), size: [dx, dz, dy] };
}
