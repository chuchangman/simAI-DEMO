import type { ViewerEditBox } from '@/features/viewer3d/editing/editTypes';
import type { ViewerBoxEdit } from '@/features/viewer3d/types';
import type { RoomLimit } from '@/lib/roomLimit';

// 호스트가 상자를 쥐고 있는 제어형 상자 편집 조작기(BoxEditGizmo)의 순수 계산. 관제 데모의 dragBox·snapM 과 같은 규칙이다.
// 좌표는 모두 World(m, +Z 위)다. 광선을 읽는 closestAxisParam 만 Three 장면 좌표를 받는다(축 방향도 Three 로 넘긴다).

/** World 세 값(x, y, z). */
export type Vec3 = readonly [number, number, number];

/** 한 면만 움직이는 화살표. 부호는 움직이는 면(− 최소 면, + 최대 면)이다. */
export type BoxEditArrow = 'x-' | 'x+' | 'y-' | 'y+' | 'z-' | 'z+';
/** move 는 바닥(X·Y) 이동 하나뿐이다. 높이 이동·회전 손잡이는 없다. */
export type BoxEditHandle = 'move' | BoxEditArrow;
type BoxEditKind = ViewerBoxEdit['kind'];

/** 값을 맞추는 단위 0.05 m 의 역수. 곱셈·나눗셈은 20 으로 해야 0.35 가 0.35000000000000003 이 되지 않는다. */
const SNAP_STEPS_PER_M = 20;
/** 부동소수 잡음을 지우는 자릿수(소수 여섯째 자리, m 로 1 µm). */
const NOISE_SCALE = 1e6;
/** 수평(X·Y) 최소 크기(m). */
const MIN_SIZE_HORIZONTAL_M = 0.2;
/** 높이(Z) 최소 크기(m). */
const MIN_SIZE_VERTICAL_M = 0.05;
/** 시선이 축과 거의 나란하면(1 − cos² 가 이 값보다 작으면) 값이 튀므로 그 표본은 건너뛴다. */
export const MIN_AXIS_SPREAD = 0.02;
/** 바닥 위를 옮기는 축(World x·y). */
const FLOOR_AXES = [0, 1] as const;
/** 높이 축(World z). */
const VERTICAL_AXIS = 2;

export const BOX_EDIT_ARROWS: readonly BoxEditArrow[] = ['x-', 'x+', 'y-', 'y+', 'z-', 'z+'];
export const BOX_EDIT_HANDLES: readonly BoxEditHandle[] = ['move', ...BOX_EDIT_ARROWS];

/** 이 종류가 보여 줄 손잡이(move 가 맨 앞). 작업면(surface)은 바닥 위 판이라 아래쪽 끝(z-)을 끌지 못하게 숨긴다. */
const HANDLES_BY_KIND: Record<BoxEditKind, readonly BoxEditHandle[]> = {
  zone: BOX_EDIT_HANDLES,
  surface: BOX_EDIT_HANDLES.filter((handle) => handle !== 'z-'),
};
export const handlesFor = (kind: BoxEditKind): readonly BoxEditHandle[] => HANDLES_BY_KIND[kind];

/** 손잡이가 겹칠 때 먼저 잡히는 순서(작을수록 먼저): 가운데 구 → 화살표. */
export const handleRank = (handle: BoxEditHandle) => (handle === 'move' ? 0 : 1);

/** 0.05 m 단위로 맞춘다. */
export const snap05 = (value: number) => Math.round(value * SNAP_STEPS_PER_M) / SNAP_STEPS_PER_M;

/** 0.35000000000000003 같은 부동소수 잡음을 지운다(−0 도 0 으로). */
export const q6 = (value: number) => Math.round(value * NOISE_SCALE) / NOISE_SCALE + 0;

/** 화살표의 World 축 번호(0 x · 1 y · 2 z). */
export const arrowAxis = (arrow: BoxEditArrow): 0 | 1 | 2 =>
  (({ x: 0, y: 1, z: 2 }) as const)[arrow[0] as 'x' | 'y' | 'z'];

/** 화살표가 가리키는 쪽(+1 최대 면, −1 최소 면). */
export const arrowSign = (arrow: BoxEditArrow): 1 | -1 => (arrow[1] === '+' ? 1 : -1);

/** World 축 하나의 Three 방향(양의 방향). World (x, y, z) → Three (x, z, −y) 이므로 y 는 −Z 다. */
export const AXIS_DIRECTION_THREE: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
];

/** 상자 중심(World). 손잡이는 모두 여기서 바깥으로 그린다. */
export const boxCenter = (box: ViewerEditBox): Vec3 => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
];

/** 두 상자의 여섯 값이 모두 같은지(정확히). 둘 다 q6 로 정리된 값이라 오차 허용이 필요 없다. */
export const sameBoxValues = (a: ViewerEditBox, b: ViewerEditBox) =>
  a.min.every((value, i) => value === b.min[i]) && a.max.every((value, i) => value === b.max[i]);

/** 그릴 수 있는 상자인지: 여섯 값이 유한하고 어느 축이든 max ≥ min. */
export const isDrawableBox = (box: ViewerEditBox) =>
  [...box.min, ...box.max].every(Number.isFinite) &&
  box.max[0] >= box.min[0] &&
  box.max[1] >= box.min[1] &&
  box.max[2] >= box.min[2];

/** 값이 겹치지 않는 새 상자. */
export const copyBox = (box: ViewerEditBox): ViewerEditBox => ({
  min: [box.min[0], box.min[1], box.min[2]],
  max: [box.max[0], box.max[1], box.max[2]],
});

/** 가운데 구: 크기를 그대로 두고 X·Y 만 옮긴다(Z 는 그대로). 최소 모서리를 0.05 m 에 맞추고 교실 안으로 가둔다. */
function moveBox(from: ViewerEditBox, delta: Vec3, limit: RoomLimit): ViewerEditBox {
  const box = copyBox(from);
  for (const i of FLOOR_AXES) {
    const size = from.max[i] - from.min[i];
    const lo = Math.max(
      limit.min[i],
      Math.min(limit.max[i] - size, snap05(from.min[i] + delta[i])),
    );
    box.min[i] = q6(lo);
    box.max[i] = q6(lo + size);
  }
  return box;
}

/** 화살표: 그 면만 움직이고 반대 면은 고정한다. 0.05 m 에 맞추고 최소 크기를 지키며 교실 안(z- 도 바닥 아래 불가)에 둔다. */
function dragFace(
  from: ViewerEditBox,
  arrow: BoxEditArrow,
  delta: Vec3,
  limit: RoomLimit,
): ViewerEditBox {
  const box = copyBox(from);
  const axis = arrowAxis(arrow);
  const minSize = axis === VERTICAL_AXIS ? MIN_SIZE_VERTICAL_M : MIN_SIZE_HORIZONTAL_M;
  if (arrowSign(arrow) < 0) {
    box.min[axis] = q6(
      Math.max(
        limit.min[axis],
        Math.min(from.max[axis] - minSize, snap05(from.min[axis] + delta[axis])),
      ),
    );
  } else {
    box.max[axis] = q6(
      Math.min(
        limit.max[axis],
        Math.max(from.min[axis] + minSize, snap05(from.max[axis] + delta[axis])),
      ),
    );
  }
  return box;
}

/**
 * 손잡이를 delta(World m, 끌기 시작점 대비 전체 이동)만큼 끈 상자. 항상 시작 때 상자(from)에서 계산한다.
 * - move: 크기를 그대로 두고 X·Y 만 움직인다(Z 는 그대로). 최소 모서리를 0.05 m 에 맞추고 교실 안(limit 의 x·y)으로 가둔다.
 * - 화살표: 그 면만 움직이고 반대 면은 고정한다. 0.05 m 에 맞추고, 수평 최소 0.2 m · 높이 최소 0.05 m,
 *   limit 안이다(z- 도 바닥 아래로 내려가지 않는다).
 * 교실 경계가 최소 크기보다 우선한다(경계 가까이서 최소 크기를 지키지 못하면 경계 쪽으로 붙는다).
 * limit 는 호출부가 정한다: 스캔이 보이면 스캔 범위, 아니면 목업 교실(x 0~10 · y 0~10 · z 0~5)이다.
 */
export function dragBox(
  from: ViewerEditBox,
  handle: BoxEditHandle,
  delta: Vec3,
  limit: RoomLimit,
): ViewerEditBox {
  return handle === 'move' ? moveBox(from, delta, limit) : dragFace(from, handle, delta, limit);
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
};

/**
 * 마우스 광선과 축 직선(anchor 를 지나 axisDir 방향)의 최근접점을 축에 사영한 값. anchor 에서 axisDir 쪽으로 잰 부호 있는 길이(m)다.
 * 시선이 축과 거의 나란하면(1 − dot(axis, ray)² < MIN_AXIS_SPREAD) 값이 튀므로 null 을 돌려 그 표본을 건너뛰게 한다.
 * 모든 벡터는 같은 좌표계(Three 장면)다. 방향은 단위 벡터가 아니어도 되고, 0 벡터면 null 이다.
 */
export function closestAxisParam(
  rayOrigin: Vec3,
  rayDir: Vec3,
  anchor: Vec3,
  axisDir: Vec3,
): number | null {
  const d = unit(rayDir);
  const axis = unit(axisDir);
  if (dot(d, d) === 0 || dot(axis, axis) === 0) return null;
  const toAnchor: Vec3 = [
    anchor[0] - rayOrigin[0],
    anchor[1] - rayOrigin[1],
    anchor[2] - rayOrigin[2],
  ];
  const b = dot(axis, d);
  const spread = 1 - b * b;
  if (spread < MIN_AXIS_SPREAD) return null;
  return (b * dot(d, toAnchor) - dot(axis, toAnchor)) / spread;
}
