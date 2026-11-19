import { r3 } from '@/features/zones/zoneShape';

// 가상 레이아웃 좌표 계산(순수). 편집기 모델(layoutEditorModel)과 항목↔구역 변환(layoutZones)이 같이 쓴다.
// 좌표 규약(AGENTS.md 규칙 3): World 는 미터, 오른손, +Z 위, 바닥 Z = 0, 각도 라디안 [-π, π].

const MAX_YAW_RAD = 3.1415926;

/** 라디안 각도를 [-π, π] 범위로 정규화한다. */
export function normalizeYawRad(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const wrapped = ((((rad + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const rounded = r3(wrapped);
  if (rounded > MAX_YAW_RAD) return 3.141;
  if (rounded < -MAX_YAW_RAD) return -3.141;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** `prefix-01`, `prefix-02`… 중 쓰지 않은 가장 작은 item_id. */
export function nextItemId(prefix: string, usedIds: Iterable<string>): string {
  const used = new Set(usedIds);
  let seq = 1;
  while (used.has(`${prefix}-${String(seq).padStart(2, '0')}`)) seq += 1;
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

/**
 * 2D 다각형 꼭짓점 배열에서 최소 면적 외접 방향 상자(OBB: centerXy, sizeXy, yaw_rad)를 구한다.
 * 축 정렬 직사각형이면 yaw_rad = 0 이 되도록 후보 각도 첫 번째에 0 을 둔다.
 */
export function polygonToObb2D(polygon: readonly (readonly [number, number])[]): {
  centerXy: [number, number];
  sizeXy: [number, number];
  yaw_rad: number;
} {
  if (polygon.length === 0) {
    return { centerXy: [5, 5], sizeXy: [1, 1], yaw_rad: 0 };
  }

  // 닫힌 고리(마지막 점 === 첫 점)면 마지막 점을 뺀다.
  const pts =
    polygon.length > 3 &&
    polygon[0]![0] === polygon[polygon.length - 1]![0] &&
    polygon[0]![1] === polygon[polygon.length - 1]![1]
      ? polygon.slice(0, -1)
      : polygon;

  const candidateAngles: number[] = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.hypot(dx, dy) > 1e-6) {
      candidateAngles.push(Math.atan2(dy, dx));
    }
  }

  let bestArea = Number.POSITIVE_INFINITY;
  let bestAngle = 0;
  let bestMinU = 0;
  let bestMaxU = 1;
  let bestMinV = 0;
  let bestMaxV = 1;

  for (const rawAngle of candidateAngles) {
    // [-π/2, π/2] 범위로 정규화해 불필요한 90°/180° 뒤집힘을 줄인다.
    let angle = normalizeYawRad(rawAngle);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle <= -Math.PI / 2) angle += Math.PI;
    if (Math.abs(angle) < 1e-6) angle = 0;

    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;

    for (const [x, y] of pts) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = Math.max(maxU - minU, 0.05);
    const d = Math.max(maxV - minV, 0.05);
    const area = w * d;
    if (area < bestArea - 1e-7) {
      bestArea = area;
      bestAngle = angle;
      bestMinU = minU;
      bestMaxU = maxU;
      bestMinV = minV;
      bestMaxV = maxV;
    }
  }

  const midU = (bestMinU + bestMaxU) / 2;
  const midV = (bestMinV + bestMaxV) / 2;
  const c = Math.cos(bestAngle);
  const s = Math.sin(bestAngle);
  const cx = midU * c - midV * s;
  const cy = midU * s + midV * c;
  const sx = Math.max(r3(bestMaxU - bestMinU), 0.1);
  const sy = Math.max(r3(bestMaxV - bestMinV), 0.1);

  return {
    centerXy: [r3(cx), r3(cy)],
    sizeXy: [sx, sy],
    yaw_rad: normalizeYawRad(bestAngle),
  };
}
