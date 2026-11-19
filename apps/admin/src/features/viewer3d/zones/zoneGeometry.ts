import type { ZoneView } from '@/features/viewer3d/data/spatialFrame';
import { worldBoxToThree, type ThreeBox } from '@/features/viewer3d/worldCoordinates';

// 구역 형상 계산. 렌더러와 떨어진 순수 함수라 시험할 수 있다.
// World→Three 축 변환은 worldBoxToThree 에서 한 번만 한다. 바닥에 붙이거나 중심을 따로 옮기지 않는다.

type Vec3 = [number, number, number];

/** 구역의 Three 상자(중심·크기). 어느 축이든 폭이 0 이하이면 그리지 않는다(null). */
export function zoneBox(zone: Pick<ZoneView, 'min' | 'max'>): ThreeBox | null {
  const box = worldBoxToThree(zone.min, zone.max);
  return box && box.size.every((length) => length > 0) ? box : null;
}

/** 하단이 바닥(World Z=0)보다 위에 있는 공중 구역인지. */
export const isAerialZone = (zone: Pick<ZoneView, 'min'>) => zone.min[2] > 0;

/** 상자 중심 기준 12개 모서리(Three 로컬). 두 점씩 한 선분이라 drei Line 의 segments 로 넘긴다. */
export function boxEdges([sizeX, sizeY, sizeZ]: readonly number[]): Vec3[] {
  const [hx, hy, hz] = [sizeX! / 2, sizeY! / 2, sizeZ! / 2];
  const points: Vec3[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      points.push([-hx, a * hy, b * hz], [hx, a * hy, b * hz]);
      points.push([a * hx, -hy, b * hz], [a * hx, hy, b * hz]);
      points.push([a * hx, b * hy, -hz], [a * hx, b * hy, hz]);
    }
  }
  return points;
}

/** 바닥 표시를 바닥 격자와 겹치지 않게 띄우는 높이(m). 표시용이며 구역 형상을 바꾸지 않는다. */
export const FLOOR_GUIDE_LIFT = 0.01;

/**
 * 공중 구역의 높이를 읽게 하는 안내선(Three, 상자 중심 기준 로컬).
 * 바닥 투영 사각형 4변과 하단 네 모서리에서 바닥까지 내린 세로선 4개다. 클릭은 받지 않는다.
 * centerY 는 상자 중심의 Three 높이다.
 */
export function aerialGuides([sizeX, sizeY, sizeZ]: readonly number[], centerY: number): Vec3[] {
  const [hx, hy, hz] = [sizeX! / 2, sizeY! / 2, sizeZ! / 2];
  const floor = FLOOR_GUIDE_LIFT - centerY;
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  const points: Vec3[] = [];
  corners.forEach(([x, z], i) => {
    const [nx, nz] = corners[(i + 1) % 4]!;
    points.push([x, floor, z], [nx, floor, nz]);
    points.push([x, -hy, z], [x, floor, z]);
  });
  return points;
}
