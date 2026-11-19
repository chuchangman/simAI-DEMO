import { toWorldPoint, type WorldPoint } from '@/features/viewer3d/worldCoordinates';

// 공통 3D 편집 엔진의 순수 World 계산(S15P31A101-195). 렌더러·React·Store 와 떨어져 있어 시험한다.
// 엔진은 하나이고, 대상 종류마다 허용 조작(EditPolicy)만 다르다.
// - 구역(zone, -47 AABB): X·Y 이동, 6개 면 경계(반대 면 고정), 회전·기울임 없음.
// - 작업면(object, -188 OBB): X·Y 이동, World +Z 축 수평 회전(yaw), 지역 축 4개 면(폭·깊이), 상판 높이(윗면).
//   바닥(Z=0)에 놓인 형상이라 Z 이동·하단 면은 없다. 등록·저장·위험 판정은 FE -165·BE -58·AI 가 한다.
// - 정적 객체(object, -274 OBSTACLE OBB): X·Y·Z 이동, 수평 회전(yaw), 6개 면(폭·깊이·아랫면·윗면). 계약 center 가
//   3D 중심이라 바닥에서 떠 있을 수 있다. 기울임(pitch·roll)은 없다.
// - TBM 가상 객체(PLANNED, -186): 이 파일의 OBB 계산과 정책 매개변수만 시험 Fixture 로 보인다.
//
// 입력 정책(명세에 정해지지 않은 것은 새로 만들지 않는다):
// - 유효한 형상: 모든 값이 유한한 숫자이고 세 축 모두 min < max(크기 > 0). 그 밖은 INVALID_GEOMETRY 로 거부한다.
// - 바닥 아래(Z < 0)는 명세에 규칙이 없어 0 으로 자르거나 거부하지 않는다. 저장 전 검증은 FE·BE(-189·-120)가 한다.
// - 스냅·최소 크기·교실 경계는 정하지 않는다. 결과 값은 반올림하지 않는다.
// - 높이를 바꾸는 조작이 없으면 Z(min·max)는 그대로다. 바닥 구역(min Z = 0)·공중 구역(min Z > 0)의 하단 의미가 유지된다.

/** World 축 정렬 상자. min·max 는 World(m, Z-up) 모서리다. */
export interface WorldBox {
  min: WorldPoint;
  max: WorldPoint;
}

/** 수평 회전 상자(OBB). yaw 는 World +Z 축 기준 반시계 회전(rad), size 는 [폭 X', 깊이 Y', 높이 Z]. */
export interface WorldObb {
  center: WorldPoint;
  size: readonly [number, number, number];
  yaw: number;
}

export type EditShape = ({ kind: 'aabb' } & WorldBox) | ({ kind: 'obb' } & WorldObb);

/** 상자의 면. x-·x+ 는 X 경계, y-·y+ 는 Y 경계, z- 는 하단(z_min), z+ 는 상단(z_max). */
export const EDIT_FACES = ['x-', 'x+', 'y-', 'y+', 'z-', 'z+'] as const;
export type EditFace = (typeof EDIT_FACES)[number];

export type EditOperation =
  /** World 이동(m). */
  | { type: 'translate'; delta: readonly [number, number, number] }
  /** 한 면을 바깥(+)·안쪽(−)이 아니라 World 축 방향으로 delta(m)만큼 옮긴다. 반대 면은 고정이다. */
  | { type: 'face'; face: EditFace; delta: number }
  /** 회전(rad). yaw 는 수평 회전, pitch·roll 은 기울임이다. */
  | { type: 'rotate'; axis: 'yaw' | 'pitch' | 'roll'; radians: number };

export interface EditPolicy {
  /** 정책 이름(진단·시험용). */
  name: string;
  translate: { x: boolean; y: boolean; z: boolean };
  faces: readonly EditFace[];
  rotate: { yaw: boolean; pitch: boolean; roll: boolean };
}

/** -47 AABB 구역. X·Y 이동과 6개 면 경계만 바꾼다. 회전·기울임과 Z 이동(하단·상단을 함께 옮김)은 없다. */
export const ZONE_AABB_POLICY: EditPolicy = {
  name: 'zone-aabb',
  translate: { x: true, y: true, z: false },
  faces: EDIT_FACES,
  rotate: { yaw: false, pitch: false, roll: false },
};

/**
 * -188 등록 작업면 OBB. 바닥(Z=0)에 놓인 상자라 X·Y 이동과 수평 회전(yaw), 지역 축 폭·깊이 면, 상판(z+)만 바꾼다.
 * Z 이동·하단(z-) 면·기울임(pitch·roll)은 없다. 그래서 하단은 늘 바닥이고 상판 높이 = OBB 높이다.
 */
export const WORK_SURFACE_OBB_POLICY: EditPolicy = {
  name: 'work-surface-obb',
  translate: { x: true, y: true, z: false },
  faces: ['x-', 'x+', 'y-', 'y+', 'z+'],
  rotate: { yaw: true, pitch: false, roll: false },
};

/**
 * -274 등록 정적 객체(OBSTACLE) OBB. 계약 obb.center 가 3D 중심이라 바닥에 붙지 않을 수 있어
 * X·Y·Z 이동, 6개 면(지역 축 폭·깊이, 아랫면·윗면), 수평 회전(yaw)을 바꾼다. 기울임(pitch·roll)은 없다.
 */
export const OBSTACLE_OBB_POLICY: EditPolicy = {
  name: 'obstacle-obb',
  translate: { x: true, y: true, z: true },
  faces: EDIT_FACES,
  rotate: { yaw: true, pitch: false, roll: false },
};

/**
 * -186 PLANNED 가상 객체(개구부·비계·장비) OBB. 정적 객체와 같은 조작(X·Y·Z 이동, 6개 면, 수평 회전)이고 기울임은 없다.
 * 정책 이름만 달라 진단·시험에서 LIVE 정적 객체와 구분한다.
 */
export const PLANNED_OBB_POLICY: EditPolicy = {
  name: 'planned-obb',
  translate: { x: true, y: true, z: true },
  faces: EDIT_FACES,
  rotate: { yaw: true, pitch: false, roll: false },
};

export type EditFailureReason = 'NOT_EDITABLE' | 'INVALID_GEOMETRY';

export type EditOutcome =
  { ok: true; shape: EditShape } | { ok: false; reason: EditFailureReason; detail: string };

const fail = (reason: EditFailureReason, detail: string): EditOutcome => ({
  ok: false,
  reason,
  detail,
});

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/** World 상자가 그릴 수 있는 형상인지. 유한한 숫자이고 세 축 모두 min < max. */
export function isValidBox(box: WorldBox): boolean {
  return box.min.every(
    (v, i) => Number.isFinite(v) && Number.isFinite(box.max[i]) && v < box.max[i]!,
  );
}

function isValidObb(obb: WorldObb): boolean {
  return (
    obb.center.every(Number.isFinite) &&
    obb.size.every((v) => Number.isFinite(v) && v > 0) &&
    Number.isFinite(obb.yaw)
  );
}

/** 형상이 유효한지. */
export function isValidShape(shape: EditShape): boolean {
  return shape.kind === 'aabb' ? isValidBox(shape) : isValidObb(shape);
}

const world = (value: readonly number[]): WorldPoint | null => toWorldPoint([...value]);

/** -π~π 로 맞춘다. */
const wrapAngle = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

/**
 * 형상 하나에 조작 하나를 적용한다. 입력은 바꾸지 않고 새 객체를 돌려준다.
 * 정책이 허용하지 않는 조작은 NOT_EDITABLE, 결과가 유효하지 않으면 INVALID_GEOMETRY 로 거부한다(값을 맞춰 고치지 않는다).
 */
export function applyEditOperation(
  shape: EditShape,
  operation: EditOperation,
  policy: EditPolicy,
): EditOutcome {
  if (!isValidShape(shape)) return fail('INVALID_GEOMETRY', '시작 형상이 유효하지 않다');
  switch (operation.type) {
    case 'translate': {
      const { delta } = operation;
      if (!delta.every(Number.isFinite)) return fail('INVALID_GEOMETRY', '이동량이 유한하지 않다');
      const blocked = (['x', 'y', 'z'] as const).find(
        (axis, i) => delta[i] !== 0 && !policy.translate[axis],
      );
      if (blocked) return fail('NOT_EDITABLE', `${blocked} 축 이동은 이 대상에서 허용되지 않는다`);
      return finish(
        shape.kind === 'aabb'
          ? {
              ...shape,
              min: world(shape.min.map((v, i) => v + delta[i]!)),
              max: world(shape.max.map((v, i) => v + delta[i]!)),
            }
          : { ...shape, center: world(shape.center.map((v, i) => v + delta[i]!)) },
      );
    }
    case 'face': {
      const { face, delta } = operation;
      if (!Number.isFinite(delta)) return fail('INVALID_GEOMETRY', '면 이동량이 유한하지 않다');
      if (!policy.faces.includes(face))
        return fail('NOT_EDITABLE', `${face} 면은 이 대상에서 바꿀 수 없다`);
      const axis = AXIS_INDEX[face[0] as 'x' | 'y' | 'z'];
      const upper = face[1] === '+';
      if (shape.kind === 'aabb') {
        // 이 면의 경계만 옮기고 반대 면은 그대로 둔다.
        const bound = (upper ? shape.max : shape.min).map((v, i) => (i === axis ? v + delta : v));
        return finish(upper ? { ...shape, max: world(bound) } : { ...shape, min: world(bound) });
      }
      // OBB: 지역 축 방향으로 한 면만 옮긴다. 크기는 delta 만큼, 중심은 그 절반만큼 같은 방향으로 움직인다.
      const sign = upper ? 1 : -1;
      const size = shape.size.map((v, i) => (i === axis ? v + sign * delta : v)) as [
        number,
        number,
        number,
      ];
      const local = axis === 2 ? [0, 0, 1] : rotateXY(axis === 0 ? [1, 0] : [0, 1], shape.yaw);
      const center = world(shape.center.map((v, i) => v + (local[i]! * delta) / 2));
      return finish({ ...shape, size, center });
    }
    case 'rotate': {
      const { axis, radians } = operation;
      if (!Number.isFinite(radians)) return fail('INVALID_GEOMETRY', '회전량이 유한하지 않다');
      if (radians === 0) return { ok: true, shape };
      // 축 정렬 상자는 정의상 회전할 수 없다. 기울임(pitch·roll)은 어떤 정책에서도 형상으로 표현하지 않는다.
      if (shape.kind === 'aabb' || axis !== 'yaw' || !policy.rotate.yaw) {
        return fail('NOT_EDITABLE', `${axis} 회전은 이 대상에서 허용되지 않는다`);
      }
      return finish({ ...shape, yaw: wrapAngle(shape.yaw + radians) });
    }
  }
}

function rotateXY([x, y]: readonly number[], yaw: number): [number, number, number] {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return [x! * c - y! * s, x! * s + y! * c, 0];
}

type Draft =
  | ({ kind: 'aabb' } & { min: WorldPoint | null; max: WorldPoint | null })
  | ({ kind: 'obb' } & {
      center: WorldPoint | null;
      size: readonly [number, number, number];
      yaw: number;
    });

function finish(draft: Draft): EditOutcome {
  if (draft.kind === 'aabb') {
    if (!draft.min || !draft.max) return fail('INVALID_GEOMETRY', '좌표가 유한하지 않다');
    const box = { kind: 'aabb' as const, min: draft.min, max: draft.max };
    return isValidBox(box)
      ? { ok: true, shape: box }
      : fail('INVALID_GEOMETRY', '경계가 교차하거나 크기가 0 이하다');
  }
  if (!draft.center) return fail('INVALID_GEOMETRY', '좌표가 유한하지 않다');
  const obb = { kind: 'obb' as const, center: draft.center, size: draft.size, yaw: draft.yaw };
  return isValidObb(obb) ? { ok: true, shape: obb } : fail('INVALID_GEOMETRY', '크기가 0 이하다');
}

/** 같은 상자인지(부동소수점 오차 허용). */
export function sameBox(a: WorldBox, b: WorldBox, epsilon = 1e-9): boolean {
  return (
    a.min.every((v, i) => Math.abs(v - b.min[i]!) <= epsilon) &&
    a.max.every((v, i) => Math.abs(v - b.max[i]!) <= epsilon)
  );
}

/** 바깥에 넘길 평범한 배열 사본. */
export const boxJson = (box: WorldBox) => ({
  min: [box.min[0], box.min[1], box.min[2]] as [number, number, number],
  max: [box.max[0], box.max[1], box.max[2]] as [number, number, number],
});

/**
 * 숫자로 고치는 AABB 값(World, m). 화면 입력이 같은 엔진(applyEditOperation)을 거치게 조작으로 바꾼다.
 * - originX·originY: min X·Y 위치. 바꾸면 min·max 를 함께 옮겨 폭·깊이를 지킨다(X·Y 이동).
 * - width·depth: min 경계를 고정하고 max X·Y 를 옮긴다(x+·y+ 면).
 * - zMin·zMax: 그 면만 바꾼다(z-·z+ 면). 다른 값은 그대로다.
 */
export const EDIT_FIELDS = ['originX', 'originY', 'width', 'depth', 'zMin', 'zMax'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

/** 절대값 입력을 조작으로 바꾼다. 값이 유한하지 않으면 null(INVALID_GEOMETRY 로 거부). */
export function fieldOperation(
  box: WorldBox,
  field: EditField,
  value: number,
): EditOperation | null {
  if (!Number.isFinite(value)) return null;
  switch (field) {
    case 'originX':
      return { type: 'translate', delta: [value - box.min[0], 0, 0] };
    case 'originY':
      return { type: 'translate', delta: [0, value - box.min[1], 0] };
    case 'width':
      return { type: 'face', face: 'x+', delta: box.min[0] + value - box.max[0] };
    case 'depth':
      return { type: 'face', face: 'y+', delta: box.min[1] + value - box.max[1] };
    case 'zMin':
      return { type: 'face', face: 'z-', delta: value - box.min[2] };
    case 'zMax':
      return { type: 'face', face: 'z+', delta: value - box.max[2] };
  }
}

/** 직렬화 가능한 World 상자(m, Z-up). */
export interface SerializableEditBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export type BoxEditOutcome =
  | { ok: true; box: { min: [number, number, number]; max: [number, number, number] } }
  | { ok: false; reason: EditFailureReason; detail: string };

/**
 * Canvas 바깥(FE 2D 평면 편집·전역 초안 Store 등)에서 직렬화된 World 상자에
 * 3D Gizmo 와 동일한 연산·정책(ZONE_AABB_POLICY)을 적용한다(S15P31A101-241).
 */
export function applyZoneBoxOperation(
  box: SerializableEditBox,
  operation: EditOperation,
  policy: EditPolicy = ZONE_AABB_POLICY,
): BoxEditOutcome {
  const min = toWorldPoint(box.min);
  const max = toWorldPoint(box.max);
  if (!min || !max) {
    return { ok: false, reason: 'INVALID_GEOMETRY', detail: '좌표가 유한하지 않다' };
  }
  const outcome = applyEditOperation({ kind: 'aabb', min, max }, operation, policy);
  if (!outcome.ok) return outcome;
  if (outcome.shape.kind !== 'aabb') {
    return { ok: false, reason: 'NOT_EDITABLE', detail: 'AABB 구역 형상이 아니다' };
  }
  return { ok: true, box: boxJson(outcome.shape) };
}

/**
 * 외부 Store 에 보관된 초안 상자(target)를 새로 마운트된 Viewer 의 편집 세션(base)에
 * 복원할 때, 중간 단계에서 zMin >= zMax 역전이 나지 않도록 6단계 적용 순서를 계산한다.
 */
export function restoreZoneBoxSteps(
  base: SerializableEditBox,
  target: SerializableEditBox,
): Array<{ field: EditField; value: number }> {
  const zSteps: Array<{ field: EditField; value: number }> =
    target.min[2] >= base.max[2]
      ? [
          { field: 'zMax', value: target.max[2] },
          { field: 'zMin', value: target.min[2] },
        ]
      : [
          { field: 'zMin', value: target.min[2] },
          { field: 'zMax', value: target.max[2] },
        ];
  return [
    { field: 'originX', value: target.min[0] },
    { field: 'originY', value: target.min[1] },
    { field: 'width', value: target.max[0] - target.min[0] },
    { field: 'depth', value: target.max[1] - target.min[1] },
    ...zSteps,
  ];
}

/**
 * 숫자로 고치는 작업면 값(World, m·rad, -188). 계약 필드와 같다.
 * centerX·centerY 중심(center_xy) · width·depth 지역 축 전체 길이(size_xy, 중심 고정) · topHeight 상판 높이(top_height_m, 바닥 고정) ·
 * yaw 수평 회전(yaw_rad, [-π, π]).
 * 정적 객체(-274)는 centerZ 중심 높이(obb.center[2], 크기 유지 이동) · height 높이(obb.size[2], 중심 고정)를 더 쓴다.
 * 대상 정책이 허용하지 않는 값(작업면의 centerZ·height)은 엔진이 NOT_EDITABLE 로 거부한다.
 */
export const OBJECT_EDIT_FIELDS = [
  'centerX',
  'centerY',
  'width',
  'depth',
  'topHeight',
  'yaw',
  'centerZ',
  'height',
] as const;
export type ObjectEditField = (typeof OBJECT_EDIT_FIELDS)[number];

/** 계약 yaw_rad 허용 범위. 도(degree) 값을 숫자 입력으로 넣은 것을 걸러 낸다. */
const YAW_INPUT_LIMIT = 3.1415927;

/**
 * 작업면 절대값 입력을 같은 엔진의 조작 목록으로 바꾼다. 차례로 applyEditOperation 에 넣는다.
 * 폭·깊이는 양쪽 면을 절반씩 옮겨 중심을 지킨다. 값이 유한하지 않거나 yaw 가 [-π, π] 밖이면 null(INVALID_GEOMETRY).
 */
export function objectFieldOperations(
  obb: WorldObb,
  field: ObjectEditField,
  value: number,
): EditOperation[] | null {
  if (!Number.isFinite(value)) return null;
  switch (field) {
    case 'centerX':
      return [{ type: 'translate', delta: [value - obb.center[0], 0, 0] }];
    case 'centerY':
      return [{ type: 'translate', delta: [0, value - obb.center[1], 0] }];
    case 'centerZ':
      return [{ type: 'translate', delta: [0, 0, value - obb.center[2]] }];
    case 'width': {
      const half = (value - obb.size[0]) / 2;
      return [
        { type: 'face', face: 'x+', delta: half },
        { type: 'face', face: 'x-', delta: -half },
      ];
    }
    case 'depth': {
      const half = (value - obb.size[1]) / 2;
      return [
        { type: 'face', face: 'y+', delta: half },
        { type: 'face', face: 'y-', delta: -half },
      ];
    }
    case 'topHeight':
      return [{ type: 'face', face: 'z+', delta: value - (obb.center[2] + obb.size[2] / 2) }];
    case 'height': {
      const half = (value - obb.size[2]) / 2;
      return [
        { type: 'face', face: 'z+', delta: half },
        { type: 'face', face: 'z-', delta: -half },
      ];
    }
    case 'yaw':
      if (Math.abs(value) > YAW_INPUT_LIMIT) return null;
      return [{ type: 'rotate', axis: 'yaw', radians: value - obb.yaw }];
  }
}

/** 조작 목록을 차례로 적용한다. 하나라도 거부되면 그 이유를 돌려주고 중간 결과는 버린다. */
export function applyEditOperations(
  shape: EditShape,
  operations: readonly EditOperation[],
  policy: EditPolicy,
): EditOutcome {
  let current: EditOutcome = isValidShape(shape)
    ? { ok: true, shape }
    : fail('INVALID_GEOMETRY', '시작 형상이 유효하지 않다');
  for (const operation of operations) {
    if (!current.ok) return current;
    current = applyEditOperation(current.shape, operation, policy);
  }
  return current;
}
