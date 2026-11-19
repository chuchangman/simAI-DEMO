import { bufferConvexPolygon } from '@/features/setup/draftZone';
import type { SurfaceGeometry } from '@/features/surfaces/types';
import { isAxisRect } from '@/features/zones/zones';
import {
  obbCorners,
  openingZoneShape,
  openingZoneZ,
  r3,
  surfaceZoneShape,
} from '@/features/zones/zoneShape';
import { describe, expect, it } from 'vitest';

describe('r3·obbCorners', () => {
  it('좌표를 0.001 m 로 맞춘다', () => {
    expect(r3(1.23456)).toBe(1.235);
    expect(r3(-0.0004)).toBeCloseTo(0, 6);
  });

  it('가운데·크기로 반시계 직사각형 꼭짓점을 만들고 margin 만큼 사방으로 넓힌다', () => {
    expect(obbCorners([5, 4], [2, 1], 0)).toEqual([
      [4, 3.5],
      [6, 3.5],
      [6, 4.5],
      [4, 4.5],
    ]);
    expect(obbCorners([5, 4], [2, 1], 0, 0.3)).toEqual([
      [3.7, 3.2],
      [6.3, 3.2],
      [6.3, 4.8],
      [3.7, 4.8],
    ]);
  });

  it('회전하면 같은 중심 둘레로 돈다', () => {
    expect(obbCorners([5, 4], [2, 1], Math.PI / 2)).toEqual([
      [5.5, 3],
      [5.5, 5],
      [4.5, 5],
      [4.5, 3],
    ]);
  });
});

describe('surfaceZoneShape(작업면이 붙은 구역의 모양)', () => {
  const geometry = (over: Partial<SurfaceGeometry> = {}): SurfaceGeometry => ({
    centerXy: [5, 4],
    sizeXy: [2, 1],
    yawRad: 0,
    topHeightM: 1.2,
    ...over,
  });

  it('작업면 발자국에 0.30 m 여유를 더한 반시계 직사각형이고, 바닥에서 구역 높이(2 m)까지다', () => {
    expect(surfaceZoneShape(geometry())).toEqual({
      polygon_xy: [
        [3.7, 3.2],
        [6.3, 3.2],
        [6.3, 4.8],
        [3.7, 4.8],
      ],
      z_min_m: 0,
      z_max_m: 2,
    });
  });

  it('회전하지 않은 작업면의 구역은 축에 맞춘 직사각형이다(3D 에서 상자로 그려진다)', () => {
    expect(isAxisRect(surfaceZoneShape(geometry()).polygon_xy)).toBe(true);
  });

  it('상판이 구역 높이보다 높으면 상판까지 올린다', () => {
    expect(surfaceZoneShape(geometry({ topHeightM: 2.6 })).z_max_m).toBe(2.6);
  });

  it('회전한 작업면은 같이 회전한 다각형이다(90° 면 가로·세로가 바뀐다)', () => {
    expect(surfaceZoneShape(geometry({ yawRad: Math.PI / 2 })).polygon_xy).toEqual([
      [5.8, 2.7],
      [5.8, 5.3],
      [4.2, 5.3],
      [4.2, 2.7],
    ]);
  });

  it('45° 로 돌린 작업면의 구역은 같은 중심의 회전한 직사각형이고 축에 맞지 않는다', () => {
    const { polygon_xy: polygon } = surfaceZoneShape(geometry({ yawRad: Math.PI / 4 }));
    expect(isAxisRect(polygon)).toBe(false);
    const center = [0, 1].map((axis) => polygon.reduce((sum, p) => sum + p[axis]!, 0) / 4);
    expect(center[0]).toBeCloseTo(5, 2);
    expect(center[1]).toBeCloseTo(4, 2);
    const side = Math.hypot(polygon[1]![0] - polygon[0]![0], polygon[1]![1] - polygon[0]![1]);
    expect(side).toBeCloseTo(2.6, 2);
  });
});

describe('openingZoneZ(개구부 구역의 높이 범위)', () => {
  it('바닥은 0 아래로 내리지 않고, 높이가 충분하면 그대로 쓴다', () => {
    expect(openingZoneZ(0.4, 1.6)).toEqual([0.4, 1.6]);
    expect(openingZoneZ(-0.3, 1)).toEqual([0, 1]);
  });

  it('높이가 0.5 m 보다 낮으면 바닥에서 2 m 까지 올린다', () => {
    expect(openingZoneZ(0, 0.2)).toEqual([0, 2]);
    expect(openingZoneZ(0.3, 0.7)).toEqual([0.3, 2.3]);
  });

  it('값을 모르면(유한하지 않으면) 바닥 0·위쪽은 바닥에서 2 m 로 채운다', () => {
    expect(openingZoneZ(Number.NaN, Number.NaN)).toEqual([0, 2]);
    expect(openingZoneZ(0.5, Number.POSITIVE_INFINITY)).toEqual([0.5, 2.5]);
  });
});

describe('openingZoneShape(개구부가 구역이 될 때의 모양)', () => {
  const opening = (over = {}) => ({
    centerXy: [3, 2] as [number, number],
    sizeXy: [1.2, 0.8] as [number, number],
    yawRad: 0,
    bottomZ: 0,
    topZ: 0.2,
    ...over,
  });

  it('직사각형을 사방 0.30 m 넓히고 높이는 개구부 규칙(낮으면 2 m)을 따른다', () => {
    expect(openingZoneShape(opening())).toEqual({
      polygon_xy: [
        [2.1, 1.3],
        [3.9, 1.3],
        [3.9, 2.7],
        [2.1, 2.7],
      ],
      z_min_m: 0,
      z_max_m: 2,
    });
  });

  it('회전한 개구부도 같은 중심의 회전한 다각형이다', () => {
    const { polygon_xy: polygon } = openingZoneShape(opening({ yawRad: Math.PI / 6 }));
    expect(isAxisRect(polygon)).toBe(false);
    const center = [0, 1].map((axis) => polygon.reduce((sum, p) => sum + p[axis]!, 0) / 4);
    expect(center[0]).toBeCloseTo(3, 2);
    expect(center[1]).toBeCloseTo(2, 2);
  });

  it('세팅 AI 개구부 초안의 볼록 버퍼와 같은 다각형이다(직사각형·회전 모두)', () => {
    const same = (
      a: readonly (readonly [number, number])[],
      b: readonly (readonly [number, number])[],
    ) =>
      a.length === b.length &&
      a.every((p) => b.some((q) => Math.abs(p[0] - q[0]) < 3e-3 && Math.abs(p[1] - q[1]) < 3e-3));
    for (const yawRad of [0, 0.4, Math.PI / 2, -1.1]) {
      const geometry = opening({ yawRad });
      const buffered = bufferConvexPolygon(
        obbCorners(geometry.centerXy, geometry.sizeXy, geometry.yawRad),
        0.3,
      );
      expect(same(openingZoneShape(geometry).polygon_xy, buffered)).toBe(true);
    }
  });
});
