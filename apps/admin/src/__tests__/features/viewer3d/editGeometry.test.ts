import {
  applyEditOperation,
  boxJson,
  EDIT_FACES,
  ZONE_AABB_POLICY,
  type EditPolicy,
  type EditShape,
} from '@/features/viewer3d/editing/editGeometry';
import {
  threeToWorld,
  worldBoxToThree,
  worldPoint,
  worldToThree,
} from '@/features/viewer3d/worldCoordinates';
import { describe, expect, it } from 'vitest';

const box = (min: number[], max: number[]): EditShape => ({
  kind: 'aabb',
  min: worldPoint(min[0]!, min[1]!, min[2]!),
  max: worldPoint(max[0]!, max[1]!, max[2]!),
});
const FLOOR = box([1.5, 5.5, 0], [4.5, 8.5, 2]);
const AERIAL = box([4.5, 7.5, 1.2], [6.5, 9, 2.4]);

function ok(shape: EditShape, ...ops: Parameters<typeof applyEditOperation>[1][]) {
  let current = shape;
  for (const op of ops) {
    const out = applyEditOperation(current, op, ZONE_AABB_POLICY);
    if (!out.ok) throw new Error(out.detail);
    current = out.shape;
  }
  return current.kind === 'aabb' ? boxJson(current) : current;
}

describe('AABB 구역 편집(World)', () => {
  it('X·Y 이동은 min·max 를 같은 거리로 옮기고 폭·깊이·높이(z_min·z_max)는 그대로 둔다', () => {
    expect(ok(FLOOR, { type: 'translate', delta: [0.5, -1.25, 0] })).toEqual({
      min: [2, 4.25, 0],
      max: [5, 7.25, 2],
    });
    expect(ok(AERIAL, { type: 'translate', delta: [-1, 2, 0] })).toEqual({
      min: [3.5, 9.5, 1.2],
      max: [5.5, 11, 2.4],
    });
  });

  it('면 손잡이는 그 면의 경계만 바꾸고 반대 면은 고정한다', () => {
    expect(ok(FLOOR, { type: 'face', face: 'x+', delta: 0.7 })).toEqual({
      min: [1.5, 5.5, 0],
      max: [5.2, 8.5, 2],
    });
    expect(ok(FLOOR, { type: 'face', face: 'x-', delta: -0.5 })).toEqual({
      min: [1, 5.5, 0],
      max: [4.5, 8.5, 2],
    });
    expect(ok(FLOOR, { type: 'face', face: 'y-', delta: 1 })).toEqual({
      min: [1.5, 6.5, 0],
      max: [4.5, 8.5, 2],
    });
    expect(ok(FLOOR, { type: 'face', face: 'y+', delta: -0.5 })).toEqual({
      min: [1.5, 5.5, 0],
      max: [4.5, 8, 2],
    });
  });

  it('상단은 z_max 만, 하단은 z_min 만 바꾼다(바닥·공중 구역의 하단 의미 유지)', () => {
    expect(ok(FLOOR, { type: 'face', face: 'z+', delta: 0.4 })).toEqual({
      min: [1.5, 5.5, 0],
      max: [4.5, 8.5, 2.4],
    });
    expect(ok(AERIAL, { type: 'face', face: 'z-', delta: -0.2 })).toEqual({
      min: [4.5, 7.5, 1],
      max: [6.5, 9, 2.4],
    });
    // 높이를 바꾸지 않는 조작 뒤에도 바닥 구역은 바닥(0), 공중 구역은 공중(1.2)에 남는다.
    const moved = ok(
      AERIAL,
      { type: 'translate', delta: [1, 1, 0] },
      { type: 'face', face: 'x+', delta: 1 },
    );
    expect(moved).toMatchObject({ min: [5.5, 8.5, 1.2], max: [8.5, 10, 2.4] });
    expect(ok(FLOOR, { type: 'face', face: 'y+', delta: 1 })).toMatchObject({ min: [1.5, 5.5, 0] });
  });

  it('바닥 아래(Z<0)는 0 으로 자르지 않고 그대로 둔다(명세 규칙 없음)', () => {
    expect(ok(FLOOR, { type: 'face', face: 'z-', delta: -0.3 })).toEqual({
      min: [1.5, 5.5, -0.3],
      max: [4.5, 8.5, 2],
    });
  });

  it('교차·0 크기·NaN·Infinity 는 INVALID_GEOMETRY 로 거부하고 값을 고쳐 맞추지 않는다', () => {
    const bad = [
      { type: 'face', face: 'x+', delta: -3 },
      { type: 'face', face: 'x-', delta: 3.5 },
      { type: 'face', face: 'z+', delta: -2 },
      { type: 'face', face: 'z-', delta: 2.1 },
      { type: 'face', face: 'y+', delta: Number.NaN },
      { type: 'translate', delta: [Number.POSITIVE_INFINITY, 0, 0] },
      { type: 'translate', delta: [Number.MAX_VALUE, 0, 0] },
    ] as const;
    for (const op of bad) {
      expect(applyEditOperation(FLOOR, op, ZONE_AABB_POLICY)).toMatchObject({
        ok: false,
        reason: 'INVALID_GEOMETRY',
      });
    }
  });

  it('회전·기울임·Z 이동은 NOT_EDITABLE 로 막는다(손잡이도 만들지 않는다)', () => {
    for (const axis of ['yaw', 'pitch', 'roll'] as const) {
      expect(
        applyEditOperation(FLOOR, { type: 'rotate', axis, radians: 0.3 }, ZONE_AABB_POLICY),
      ).toMatchObject({
        ok: false,
        reason: 'NOT_EDITABLE',
      });
    }
    expect(
      applyEditOperation(FLOOR, { type: 'translate', delta: [0, 0, 0.5] }, ZONE_AABB_POLICY),
    ).toMatchObject({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
  });

  it('입력 형상을 바꾸지 않고 새 객체를 돌려준다', () => {
    const input = box([1, 2, 0], [3, 4, 1]);
    const before = JSON.stringify(input);
    for (const face of EDIT_FACES)
      applyEditOperation(input, { type: 'face', face, delta: 0.1 }, ZONE_AABB_POLICY);
    applyEditOperation(input, { type: 'translate', delta: [1, 1, 0] }, ZONE_AABB_POLICY);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('여러 크기·부동소수점에서도 반대 면이 정확히 고정된다', () => {
    for (const size of [0.01, 0.37, 12.5, 250]) {
      const start = box([-size, 0.1, 0.3], [size, 0.1 + size, 0.3 + size]);
      const out = ok(
        start,
        { type: 'face', face: 'x+', delta: 0.1 },
        { type: 'face', face: 'y-', delta: -0.2 },
      );
      if (!('min' in out)) throw new Error('aabb');
      expect(out.min[0]).toBe(-size);
      expect(out.max[1]).toBeCloseTo(0.1 + size, 12);
      expect(out.max[0]).toBeCloseTo(size + 0.1, 12);
      expect(out.min[1]).toBeCloseTo(-0.1, 12);
    }
  });
});

describe('World ↔ Three 단일 변환으로 왕복', () => {
  it('±XYZ·z_min·z_max 가 그대로 돌아온다', () => {
    const points: [number, number, number][] = [
      [1.5, -2.25, 0],
      [-3, 4, 1.2],
      [0.001, 0, -0.4],
    ];
    for (const [x, y, z] of points) {
      expect(threeToWorld(worldToThree(worldPoint(x, y, z)))).toEqual([x, y, z]);
    }
    const three = worldBoxToThree(worldPoint(4.5, 7.5, 1.2), worldPoint(6.5, 9, 2.4))!;
    // 상자 중심 높이(Three Y)는 World z_min·z_max 의 가운데다.
    expect(three.position[1]).toBeCloseTo(1.8, 12);
    expect(three.size.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([2, 1.2, 1.5]);
  });
});

// -188 작업면(OBB)·-186 PLANNED 는 도메인을 만들지 않는다. 같은 엔진이 정책 매개변수만 바꿔 재사용됨을 보이는 Fixture 다.
const OBJECT_FIXTURE: EditPolicy = {
  name: 'fixture-object-obb',
  translate: { x: true, y: true, z: false },
  faces: ['x-', 'x+', 'y-', 'y+', 'z+'],
  rotate: { yaw: true, pitch: false, roll: false },
};
// -195 Jira: PLANNED 가상 객체 = 허용 축별 이동·회전·크기. 기울임은 어느 정책에서도 형상으로 표현하지 않는다.
const PLANNED_FIXTURE: EditPolicy = {
  name: 'fixture-planned',
  translate: { x: true, y: true, z: true },
  faces: EDIT_FACES,
  rotate: { yaw: true, pitch: false, roll: false },
};
const OBB: EditShape = {
  kind: 'obb',
  center: worldPoint(2, 3, 0.4),
  size: [1.2, 0.6, 0.8],
  yaw: Math.PI / 2,
};

describe('같은 엔진의 OBB·PLANNED Fixture(도메인 완료 아님)', () => {
  it('작업면 Fixture: 수평 회전·지역 축 면 경계를 허용하고 기울임·하단은 막는다', () => {
    const rotated = applyEditOperation(
      OBB,
      { type: 'rotate', axis: 'yaw', radians: Math.PI / 2 },
      OBJECT_FIXTURE,
    );
    expect(rotated.ok && rotated.shape.kind === 'obb' && rotated.shape.yaw).toBeCloseTo(
      Math.PI,
      12,
    );
    // yaw 90° 에서 지역 X' 는 World +Y 다. x+ 면을 0.4 늘리면 중심이 World Y 로 0.2 움직이고 X 는 그대로다.
    const wider = applyEditOperation(OBB, { type: 'face', face: 'x+', delta: 0.4 }, OBJECT_FIXTURE);
    if (!wider.ok || wider.shape.kind !== 'obb') throw new Error('obb');
    expect(wider.shape.size[0]).toBeCloseTo(1.6, 12);
    expect(wider.shape.center[0]).toBeCloseTo(2, 12);
    expect(wider.shape.center[1]).toBeCloseTo(3.2, 12);
    expect(
      applyEditOperation(OBB, { type: 'rotate', axis: 'pitch', radians: 0.1 }, OBJECT_FIXTURE),
    ).toMatchObject({ reason: 'NOT_EDITABLE' });
    expect(
      applyEditOperation(OBB, { type: 'face', face: 'z-', delta: 0.1 }, OBJECT_FIXTURE),
    ).toMatchObject({ reason: 'NOT_EDITABLE' });
  });

  it('PLANNED Fixture: 축별 이동·수평 회전·크기(하단 포함)를 허용하고 기울임만 막는다', () => {
    const lifted = applyEditOperation(
      OBB,
      { type: 'translate', delta: [0, 0, 0.5] },
      PLANNED_FIXTURE,
    );
    if (!lifted.ok || lifted.shape.kind !== 'obb') throw new Error('obb');
    expect(lifted.shape.center).toEqual([2, 3, 0.9]);
    const wider = applyEditOperation(
      OBB,
      { type: 'face', face: 'x+', delta: 0.1 },
      PLANNED_FIXTURE,
    );
    if (!wider.ok || wider.shape.kind !== 'obb') throw new Error('obb');
    expect(wider.shape.size[0]).toBeCloseTo(1.3, 12);
    const lower = applyEditOperation(
      OBB,
      { type: 'face', face: 'z-', delta: 0.2 },
      PLANNED_FIXTURE,
    );
    if (!lower.ok || lower.shape.kind !== 'obb') throw new Error('obb');
    // 하단을 0.2 올리면 높이 0.6, 중심 Z 0.5(상단 0.8 고정).
    expect(lower.shape.size[2]).toBeCloseTo(0.6, 12);
    expect(lower.shape.center[2]).toBeCloseTo(0.5, 12);
    expect(
      applyEditOperation(OBB, { type: 'rotate', axis: 'pitch', radians: 0.1 }, PLANNED_FIXTURE),
    ).toMatchObject({ reason: 'NOT_EDITABLE' });
    expect(
      applyEditOperation(OBB, { type: 'rotate', axis: 'roll', radians: 0.1 }, PLANNED_FIXTURE),
    ).toMatchObject({ reason: 'NOT_EDITABLE' });
  });

  it('같은 정책이라도 AABB 는 회전하지 않는다(구역 정책과 독립)', () => {
    expect(
      applyEditOperation(FLOOR, { type: 'rotate', axis: 'yaw', radians: 0.2 }, OBJECT_FIXTURE),
    ).toMatchObject({ reason: 'NOT_EDITABLE' });
  });
});
