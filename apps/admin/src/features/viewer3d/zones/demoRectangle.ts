import { worldPoint, type WorldPoint } from '@/features/viewer3d/worldCoordinates';

// 공식 구역 형상(명세 13: 다각형 + 높이 범위)을 AABB 로 옮길 수 있는지 판정하는 DEMO 전용 순수 함수.
// 다각형 구역의 실제 수신 계약(필드 이름·API)은 아직 없다(BE -120·FE -189 협의). 그래서 어떤 입력 경로에도 연결하지 않고,
// 계약이 정해지면 그 Adapter 가 이 판정을 그대로 쓰도록 규칙과 시험만 먼저 둔다.

export type RectangleRejectReason =
  /** 꼭짓점이 정확히 4개가 아니다. */
  | 'NOT_FOUR_VERTICES'
  /** 좌표·높이가 유한한 숫자가 아니거나 모양이 틀렸다. */
  | 'INVALID_NUMBER'
  /** 높이 범위를 모른다. 0 으로 채우지 않는다. */
  | 'HEIGHT_UNKNOWN'
  /** z_max 가 z_min 보다 크지 않다. */
  | 'EMPTY_HEIGHT'
  /** 넓이가 0 이다(한 줄로 늘어선 꼭짓점). */
  | 'EMPTY_AREA'
  /** 회전했거나 비정형, 꼬인 순서, 중복 꼭짓점. AABB 로 넓히거나 줄여 맞추지 않는다. */
  | 'NOT_AXIS_ALIGNED_RECTANGLE';

export type RectangleResult =
  { ok: true; min: WorldPoint; max: WorldPoint } | { ok: false; reason: RectangleRejectReason };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * 꼭짓점 4개(World XY, m)와 높이 범위(World Z, m)가 축 정렬 직사각형임을 정확히 보일 수 있을 때만 AABB 로 바꾼다.
 * 허용 오차를 두지 않는다. X 값 2개·Y 값 2개가 네 조합으로 한 번씩 나오고, 이웃한 꼭짓점이 한 축만 공유해야 한다.
 */
export function rectangleToAabb(vertices: unknown, zMin: unknown, zMax: unknown): RectangleResult {
  if (!Array.isArray(vertices) || vertices.length !== 4) {
    return { ok: false, reason: 'NOT_FOUR_VERTICES' };
  }
  const points: [number, number][] = [];
  for (const vertex of vertices as unknown[]) {
    if (!Array.isArray(vertex) || vertex.length !== 2)
      return { ok: false, reason: 'INVALID_NUMBER' };
    const [x, y] = vertex as unknown[];
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false, reason: 'INVALID_NUMBER' };
    points.push([x, y]);
  }
  if (zMin == null || zMax == null) return { ok: false, reason: 'HEIGHT_UNKNOWN' };
  if (!isFiniteNumber(zMin) || !isFiniteNumber(zMax))
    return { ok: false, reason: 'INVALID_NUMBER' };
  if (!(zMax > zMin)) return { ok: false, reason: 'EMPTY_HEIGHT' };

  const xs = [...new Set(points.map(([x]) => x))];
  const ys = [...new Set(points.map(([, y]) => y))];
  if (xs.length === 1 || ys.length === 1) return { ok: false, reason: 'EMPTY_AREA' };
  const corners = new Set(points.map(([x, y]) => `${x},${y}`));
  if (xs.length !== 2 || ys.length !== 2 || corners.size !== 4) {
    return { ok: false, reason: 'NOT_AXIS_ALIGNED_RECTANGLE' };
  }
  // 이웃한 두 꼭짓점은 X 나 Y 중 하나만 같아야 한다. 대각선으로 건너뛰면 꼬인 사각형이다.
  const ordered = points.every(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % 4]!;
    return (x === nx) !== (y === ny);
  });
  if (!ordered) return { ok: false, reason: 'NOT_AXIS_ALIGNED_RECTANGLE' };

  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  return { ok: true, min: worldPoint(x0, y0, zMin), max: worldPoint(x1, y1, zMax) };
}
