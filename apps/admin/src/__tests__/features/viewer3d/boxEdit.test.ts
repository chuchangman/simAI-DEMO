import {
  arrowAxis,
  arrowSign,
  AXIS_DIRECTION_THREE,
  BOX_EDIT_ARROWS,
  BOX_EDIT_HANDLES,
  boxCenter,
  closestAxisParam,
  dragBox,
  handleRank,
  handlesFor,
  isDrawableBox,
  MIN_AXIS_SPREAD,
  q6,
  sameBoxValues,
  snap05,
  type BoxEditHandle,
  type Vec3,
} from '@/features/viewer3d/editing/boxEdit';
import type { ViewerEditBox } from '@/features/viewer3d/editing/editTypes';
import { DEFAULT_ROOM_LIMIT, roomLimitFrom, type RoomBounds } from '@/lib/roomLimit';
import { describe, expect, it } from 'vitest';

// 스캔이 없을 때의 목업 교실 범위(x 0~10 · y 0~10 · z 0~5).
const ROOM = DEFAULT_ROOM_LIMIT;
// 스캔이 보이는 중의 범위. 원점에서 떨어져 있고 10 m 보다 작다(x 1~7 · y 2~9).
const SCAN: RoomBounds = { min: [1, 2, -0.1], max: [7, 9, 3.2] };
const SCAN_ROOM = roomLimitFrom(SCAN);

const BOX: ViewerEditBox = { min: [2, 3, 0], max: [4, 6, 2] };
const AIR: ViewerEditBox = { min: [2, 3, 1.2], max: [4, 6, 2] };
const at = (axis: 0 | 1 | 2, value: number): Vec3 => {
  const v: [number, number, number] = [0, 0, 0];
  v[axis] = value;
  return v;
};

describe('snap05·q6', () => {
  it('0.05 m 단위로 맞추고 부동소수 잡음이 없다', () => {
    expect(snap05(0.37)).toBe(0.35);
    expect(snap05(0.38)).toBe(0.4);
    expect(snap05(7 * 0.05)).toBe(0.35);
    expect(q6(0.35000000000000003)).toBe(0.35);
    expect(Object.is(q6(-0), 0)).toBe(true);
  });
});

describe('dragBox 화살표', () => {
  // z- 는 바닥(0) 아래로 못 내려가므로 공중 상자(AIR)로 확장을 본다.
  it.each([
    ['x-', BOX, at(0, -0.5), { min: [1.5, 3, 0], max: [4, 6, 2] }],
    ['x+', BOX, at(0, 0.5), { min: [2, 3, 0], max: [4.5, 6, 2] }],
    ['y-', BOX, at(1, -0.5), { min: [2, 2.5, 0], max: [4, 6, 2] }],
    ['y+', BOX, at(1, 0.5), { min: [2, 3, 0], max: [4, 6.5, 2] }],
    ['z-', AIR, at(2, -0.5), { min: [2, 3, 0.7], max: [4, 6, 2] }],
    ['z+', BOX, at(2, 0.5), { min: [2, 3, 0], max: [4, 6, 2.5] }],
  ] as const)('%s: 그 면만 움직이고 반대 면은 고정한다(확장)', (handle, from, delta, expected) => {
    expect(dragBox(from, handle, delta, ROOM)).toEqual(expected);
  });

  it.each([
    ['x-', at(0, 0.5), { min: [2.5, 3, 0], max: [4, 6, 2] }],
    ['x+', at(0, -0.5), { min: [2, 3, 0], max: [3.5, 6, 2] }],
    ['y-', at(1, 1), { min: [2, 4, 0], max: [4, 6, 2] }],
    ['y+', at(1, -1), { min: [2, 3, 0], max: [4, 5, 2] }],
    ['z-', at(2, 0.5), { min: [2, 3, 0.5], max: [4, 6, 2] }],
    ['z+', at(2, -0.5), { min: [2, 3, 0], max: [4, 6, 1.5] }],
  ] as const)('%s: 줄이면 반대 면이 그대로다', (handle, delta, expected) => {
    expect(dragBox(BOX, handle, delta, ROOM)).toEqual(expected);
  });

  it('값은 0.05 m 에 맞고 부동소수 잡음이 없다', () => {
    expect(dragBox(BOX, 'x+', at(0, 0.37), ROOM).max[0]).toBe(4.35);
    expect(dragBox(BOX, 'x+', at(0, 0.38), ROOM).max[0]).toBe(4.4);
    expect(dragBox(BOX, 'y-', at(1, -0.12), ROOM).min[1]).toBe(2.9);
    expect(dragBox({ min: [0, 0, 0], max: [1, 1, 1] }, 'z+', at(2, 0.35), ROOM).max[2]).toBe(1.35);
  });

  it('수평은 최소 0.2 m, 높이는 최소 0.05 m 를 지킨다', () => {
    expect(dragBox(BOX, 'x+', at(0, -10), ROOM).max[0]).toBe(2.2);
    expect(dragBox(BOX, 'x-', at(0, 10), ROOM).min[0]).toBe(3.8);
    expect(dragBox(BOX, 'y+', at(1, -10), ROOM).max[1]).toBe(3.2);
    expect(dragBox(BOX, 'y-', at(1, 10), ROOM).min[1]).toBe(5.8);
    expect(dragBox(BOX, 'z+', at(2, -10), ROOM).max[2]).toBe(0.05);
    expect(dragBox(BOX, 'z-', at(2, 10), ROOM).min[2]).toBe(1.95);
  });

  it('스캔이 없으면 교실 범위(x 10 · y 10 · z 5, 아래쪽 0)를 넘지 않는다', () => {
    expect(dragBox(BOX, 'x+', at(0, 99), ROOM).max[0]).toBe(10);
    expect(dragBox(BOX, 'y+', at(1, 99), ROOM).max[1]).toBe(10);
    expect(dragBox(BOX, 'z+', at(2, 99), ROOM).max[2]).toBe(5);
    expect(dragBox(BOX, 'x-', at(0, -99), ROOM).min[0]).toBe(0);
    expect(dragBox(BOX, 'y-', at(1, -99), ROOM).min[1]).toBe(0);
    expect(dragBox(AIR, 'z-', at(2, -99), ROOM).min[2]).toBe(0);
  });

  it('다른 두 축의 값은 delta 에 영향받지 않는다', () => {
    expect(dragBox(BOX, 'x+', [0.5, 9, 9], ROOM)).toEqual({ min: [2, 3, 0], max: [4.5, 6, 2] });
    expect(dragBox(BOX, 'z+', [9, 9, 0.5], ROOM)).toEqual({ min: [2, 3, 0], max: [4, 6, 2.5] });
  });

  it('시작 상자를 바꾸지 않고 새 객체를 돌려준다', () => {
    const from = { min: [2, 3, 0], max: [4, 6, 2] } as ViewerEditBox;
    const out = dragBox(from, 'x+', at(0, 1), ROOM);
    expect(from).toEqual({ min: [2, 3, 0], max: [4, 6, 2] });
    expect(out.min).not.toBe(from.min);
    expect(out.max).not.toBe(from.max);
  });
});

describe('dragBox move', () => {
  it('X·Y 만 옮기고 크기를 그대로 둔다', () => {
    expect(dragBox(BOX, 'move', [1, -1, 0], ROOM)).toEqual({ min: [3, 2, 0], max: [5, 5, 2] });
  });

  it('Z 는 delta 가 있어도 절대 바뀌지 않는다', () => {
    const out = dragBox(AIR, 'move', [0.5, 0.5, 3], ROOM);
    expect([out.min[2], out.max[2]]).toEqual([1.2, 2]);
    expect(dragBox(AIR, 'move', [0.5, 0.5, -3], ROOM)).toEqual(out);
  });

  it('최소 모서리를 0.05 m 에 맞추고 부동소수 잡음이 없다', () => {
    const out = dragBox({ min: [1, 1, 0], max: [1.3, 2.1, 1] }, 'move', [0.37, 0.12, 0], ROOM);
    expect(out.min).toEqual([1.35, 1.1, 0]);
    expect(out.max).toEqual([1.65, 2.2, 1]);
  });

  it('교실 안으로 가둔다(크기는 그대로)', () => {
    expect(dragBox(BOX, 'move', [99, 99, 0], ROOM)).toEqual({ min: [8, 7, 0], max: [10, 10, 2] });
    expect(dragBox(BOX, 'move', [-99, -99, 0], ROOM)).toEqual({ min: [0, 0, 0], max: [2, 3, 2] });
  });

  it('교실보다 큰 상자는 0 에서 시작한다', () => {
    const out = dragBox({ min: [1, 1, 0], max: [12, 3, 1] }, 'move', [5, 0, 0], ROOM);
    expect(out.min[0]).toBe(0);
    expect(out.max[0]).toBe(11);
  });
});

describe('스캔이 보이는 동안의 범위', () => {
  it('화살표는 스캔 x·y 경계(1~7 · 2~9)와 z 0~5 를 넘지 않는다', () => {
    expect(dragBox(BOX, 'x+', at(0, 99), SCAN_ROOM).max[0]).toBe(7);
    expect(dragBox(BOX, 'x-', at(0, -99), SCAN_ROOM).min[0]).toBe(1);
    expect(dragBox(BOX, 'y+', at(1, 99), SCAN_ROOM).max[1]).toBe(9);
    expect(dragBox(BOX, 'y-', at(1, -99), SCAN_ROOM).min[1]).toBe(2);
    expect(dragBox(BOX, 'z+', at(2, 99), SCAN_ROOM).max[2]).toBe(5);
    expect(dragBox(AIR, 'z-', at(2, -99), SCAN_ROOM).min[2]).toBe(0);
  });

  it('가운데 구는 크기를 지키며 스캔 경계 안으로 가둔다', () => {
    expect(dragBox(BOX, 'move', [99, 99, 0], SCAN_ROOM)).toEqual({
      min: [5, 6, 0],
      max: [7, 9, 2],
    });
    expect(dragBox(BOX, 'move', [-99, -99, 0], SCAN_ROOM)).toEqual({
      min: [1, 2, 0],
      max: [3, 5, 2],
    });
  });

  it('넘긴 범위를 그대로 쓴다', () => {
    expect(dragBox(BOX, 'x+', at(0, 99), { min: [0, 0, 0], max: [6, 6, 3] }).max[0]).toBe(6);
  });
});

describe('손잡이 목록', () => {
  it('zone 은 일곱 개(move + 여섯 화살표), surface 는 z- 를 뺀 여섯 개', () => {
    expect(BOX_EDIT_HANDLES).toEqual(['move', 'x-', 'x+', 'y-', 'y+', 'z-', 'z+']);
    expect(handlesFor('zone')).toEqual(BOX_EDIT_HANDLES);
    expect(handlesFor('surface')).toEqual(['move', 'x-', 'x+', 'y-', 'y+', 'z+']);
    expect(handlesFor('surface')).not.toContain('z-');
  });

  it('겹치면 가운데 구가 화살표보다 먼저 잡힌다', () => {
    for (const arrow of BOX_EDIT_ARROWS) expect(handleRank('move')).toBeLessThan(handleRank(arrow));
  });

  it('화살표의 축·부호', () => {
    const table = BOX_EDIT_ARROWS.map((a) => [a, arrowAxis(a), arrowSign(a)]);
    expect(table).toEqual([
      ['x-', 0, -1],
      ['x+', 0, 1],
      ['y-', 1, -1],
      ['y+', 1, 1],
      ['z-', 2, -1],
      ['z+', 2, 1],
    ]);
  });

  it('Three 축 방향은 World y 가 −Z, z 가 +Y 다', () => {
    expect(AXIS_DIRECTION_THREE).toEqual([
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ]);
  });
});

describe('상자 도우미', () => {
  it('중심·같음·그릴 수 있음', () => {
    expect(boxCenter(BOX)).toEqual([3, 4.5, 1]);
    expect(sameBoxValues(BOX, { min: [2, 3, 0], max: [4, 6, 2] })).toBe(true);
    expect(sameBoxValues(BOX, { min: [2, 3, 0], max: [4, 6, 2.05] })).toBe(false);
    expect(isDrawableBox(BOX)).toBe(true);
    expect(isDrawableBox({ min: [2, 3, 0], max: [1, 6, 2] })).toBe(false);
    expect(isDrawableBox({ min: [2, 3, 0], max: [4, Number.NaN, 2] })).toBe(false);
  });
});

describe('closestAxisParam', () => {
  const anchor: Vec3 = [1, 2, 3];
  const xAxis: Vec3 = [1, 0, 0];

  it('축 위의 점을 겨누면 그 점의 축 좌표(anchor 기준)를 돌려준다', () => {
    // 카메라는 (0, 2, 13), 축 위 점 (4, 2, 3) 을 겨눈다.
    const origin: Vec3 = [0, 2, 13];
    const dir: Vec3 = [4, 0, -10];
    expect(closestAxisParam(origin, dir, anchor, xAxis)).toBeCloseTo(3, 9);
  });

  it('축을 가로지르는 광선은 최근접점으로 사영한다', () => {
    // 위에서 아래로 (6, 5, 3) 을 지나는 광선. 축(y=2,z=3)과 x=6 에서 가장 가깝다.
    expect(closestAxisParam([6, 5, 8], [0, -1, -1], anchor, xAxis)).toBeCloseTo(5, 9);
  });

  it('부호는 축 방향을 따른다(반대 방향이면 음수)', () => {
    const origin: Vec3 = [0, 2, 13];
    expect(closestAxisParam(origin, [-1, 0, -10], anchor, xAxis)).toBeCloseTo(-2, 9);
    expect(closestAxisParam(origin, [-1, 0, -10], anchor, [-1, 0, 0])).toBeCloseTo(2, 9);
  });

  it('방향이 단위 벡터가 아니어도 같은 값이다', () => {
    const a = closestAxisParam([0, 2, 13], [4, 0, -10], anchor, xAxis);
    const b = closestAxisParam([0, 2, 13], [40, 0, -100], anchor, [3, 0, 0]);
    expect(b).toBeCloseTo(a!, 9);
  });

  it('시선이 축과 거의 나란하면 null 이다(1 − cos² < 0.02)', () => {
    expect(MIN_AXIS_SPREAD).toBe(0.02);
    // 축과 같은 방향.
    expect(closestAxisParam([-5, 2, 3], [1, 0, 0], anchor, xAxis)).toBeNull();
    // cos² = 0.99 → 1 − cos² = 0.01 < 0.02 → null. 0.97 → 0.03 ≥ 0.02 → 값.
    const dirFor = (cos2: number): Vec3 => [Math.sqrt(cos2), Math.sqrt(1 - cos2), 0];
    expect(closestAxisParam([-5, 0, 3], dirFor(0.99), anchor, xAxis)).toBeNull();
    expect(closestAxisParam([-5, 0, 3], dirFor(0.97), anchor, xAxis)).not.toBeNull();
  });

  it('0 방향은 null 이다', () => {
    expect(closestAxisParam([0, 0, 0], [0, 0, 0], anchor, xAxis)).toBeNull();
    expect(closestAxisParam([0, 0, 0], [0, 1, 0], anchor, [0, 0, 0])).toBeNull();
  });

  it('World y 축(Three −Z)에서도 끈 길이를 World 값으로 읽는다', () => {
    const y = AXIS_DIRECTION_THREE[1];
    // 카메라는 위(0, 12, 0)에서 Three (1, 0, −4) 를 겨눈다. 앵커 Three (1, 0, −1) 에서 Three −Z 로 3 m = World y +3.
    const length = closestAxisParam([1, 12, -4], [0, -1, 0], [1, 0, -1], y);
    expect(length).toBeCloseTo(3, 9);
  });
});

describe('끌어서 얻은 값을 그대로 dragBox 에 넣는 흐름', () => {
  it('화살표를 끈 길이(광선 최근접)만큼 그 면이 움직인다', () => {
    const from = BOX;
    const [cx, cy, cz] = boxCenter(from);
    // World x 축 위에서 시작점과 현재점을 같은 카메라로 겨눠 0.5 m 차이를 만든다.
    const anchor: Vec3 = [cx, cz, -cy];
    const camera: Vec3 = [cx, cz + 6, -cy + 8];
    const to = (x: number): Vec3 => [x - camera[0], anchor[1] - camera[1], anchor[2] - camera[2]];
    const start = closestAxisParam(camera, to(cx + 1), anchor, AXIS_DIRECTION_THREE[0])!;
    const now = closestAxisParam(camera, to(cx + 1.5), anchor, AXIS_DIRECTION_THREE[0])!;
    const handle: BoxEditHandle = 'x+';
    expect(dragBox(from, handle, [now - start, 0, 0], ROOM).max[0]).toBe(4.5);
  });
});
