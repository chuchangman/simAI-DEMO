import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { FLOOR_GUIDE_LIFT } from '@/features/viewer3d/zones/zoneGeometry';
import { ShapeUtils, Vector2 } from 'three';

// 다각형 구역(BE 정식 PRISM·FOOTPRINT, -234)의 장면 형상. 렌더러와 떨어진 순수 계산이라 시험할 수 있다.
// 꼭짓점은 World XY(m)이고 축 변환은 worldToThree 한 곳에서만 한다. 다각형을 둘레 상자로 넓히지 않는다.

type XY = readonly [number, number];

export interface PolygonMesh {
  /** Three 좌표(x, y, z) 를 이어 붙인 값. */
  positions: Float32Array;
  /** 삼각형 꼭짓점 번호. */
  indices: number[];
}

const three = ([x, y]: XY, z: number): ThreePoint => worldToThree(worldPoint(x, y, z));

/** 바닥 다각형을 삼각형으로 나눈다(꼭짓점 번호 세 개씩). 시계·반시계 모두 받는다. */
export function triangulate(points: readonly XY[]): number[][] {
  return ShapeUtils.triangulateShape(
    points.map(([x, y]) => new Vector2(x, y)),
    [],
  );
}

/** 다각형 기둥(World Z 최저~최고)의 면. 아랫면·윗면과 옆면 사각형이다. */
export function prismMesh(points: readonly XY[], zMin: number, zMax: number): PolygonMesh {
  const n = points.length;
  const positions = new Float32Array(n * 2 * 3);
  points.forEach((point, i) => {
    positions.set(three(point, zMin), i * 3);
    positions.set(three(point, zMax), (n + i) * 3);
  });
  const indices: number[] = [];
  for (const [a, b, c] of triangulate(points)) {
    indices.push(a!, b!, c!, n + a!, n + b!, n + c!);
  }
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  return { positions, indices };
}

/** 바닥 판정면(GROUND_FOOTPRINT). 바닥 격자와 겹치지 않게 FLOOR_GUIDE_LIFT 만큼 띄운다(표시용). */
export function footprintMesh(points: readonly XY[]): PolygonMesh {
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, i) => positions.set(three(point, FLOOR_GUIDE_LIFT), i * 3));
  return { positions, indices: triangulate(points).flat() };
}

/** 다각형 둘레(두 점씩 한 선분). */
export function ringEdges(points: readonly XY[], z: number): ThreePoint[] {
  return points.flatMap((point, i) => [
    three(point, z),
    three(points[(i + 1) % points.length]!, z),
  ]);
}

/** 다각형 기둥의 모서리: 아랫면·윗면 둘레와 꼭짓점마다 세로선. */
export function prismEdges(points: readonly XY[], zMin: number, zMax: number): ThreePoint[] {
  return [
    ...ringEdges(points, zMin),
    ...ringEdges(points, zMax),
    ...points.flatMap((point) => [three(point, zMin), three(point, zMax)]),
  ];
}

/** 이름표를 둘 꼭짓점: 기본 시점 쪽(World X+Y 가 가장 작은) 꼭짓점. */
export function labelVertex(points: readonly XY[]): XY {
  return points.reduce((best, p) => (p[0] + p[1] < best[0] + best[1] ? p : best), points[0]!);
}
