import {
  isZoneSeverity,
  type OfficialZoneInfo,
  type ZoneEvalType,
  type ZoneSnapshot,
  type ZoneView,
} from '@/features/viewer3d/data/spatialFrame';
import { worldPoint } from '@/features/viewer3d/worldCoordinates';
import { rectangleToAabb } from '@/features/viewer3d/zones/demoRectangle';

// BE 정식 구역(S15P31A101-120) GET /api/zones 응답을 검사해 3D 구역으로 바꾼다(S15P31A101-234).
//
// 응답은 구역마다 최신 버전 하나씩인 배열이다(server ZoneRepository.view):
//   { zone_id, zone_version, name, zone_kind, eval_type, polygon_xy, z_min_m, z_max_m, severity, requirements,
//     has_guardrail, valid_from, valid_to }
//   - polygon_xy: 바닥 XY 꼭짓점(World m). 닫는 점은 빠져 있지만 들어와도 받는다.
//   - eval_type: GROUND_FOOTPRINT(바닥 위치만 판정, 높이 무관) · VOLUME_3D(z_min_m < z_max_m 필수).
// 받기·빼기 규칙은 BE 저장 검사(ZoneRepository.check)와 Tier 0 Zone.from_json(ai risk/zone.py)을 따른다.
// 값을 고쳐 받지 않는다. 틀린 구역은 이유와 함께 빼고, 나머지 구역은 그대로 그린다.
//
// 표시 형상(ZoneView.shape):
//   - BOX: VOLUME_3D 이고 다각형이 축 정렬 직사각형이다. min·max 가 정확한 구역이라 3D 상자 편집(-241)을 쓸 수 있다.
//   - PRISM: VOLUME_3D 이지만 직사각형이 아니다. 다각형 기둥으로 그린다. min·max 는 둘레 상자(초점·이름표용)일 뿐이다.
//   - FOOTPRINT: GROUND_FOOTPRINT. 바닥 판정면으로 그린다. 높이가 판정에 쓰이지 않아 min·max 의 Z 는 0 이다.
// PRISM·FOOTPRINT 는 둘레 상자를 위험구역으로 그리거나 상자로 편집하지 않는다.
//
// READY 는 형상을 받아 검사했다는 뜻이다. 구성 묶음으로 발행돼 Tier 0 에 적용됐다는 증거가 아니다(적용 ACK 는 FE·BE 몫).

export const OFFICIAL_ZONE_CONTRACT = 'BE_ZONES_V1' as const;

const EVAL_TYPES: readonly ZoneEvalType[] = ['GROUND_FOOTPRINT', 'VOLUME_3D'];
/** BE 저장 상한(ZoneRepository.MAX_VERTICES). */
export const MAX_ZONE_VERTICES = 256;

type Point = readonly [number, number];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** 부호 있는 넓이(m²). 반시계면 양수. */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

const orient = (a: Point, b: Point, c: Point) =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const within = (a: Point, b: Point, p: Point) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/** 두 선분이 닿거나 겹치는지(끝점 접촉 포함). */
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const [o1, o2, o3, o4] = [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && within(a, b, c)) ||
    (o2 === 0 && within(a, b, d)) ||
    (o3 === 0 && within(c, d, a)) ||
    (o4 === 0 && within(c, d, b))
  );
}

/** 이웃하지 않은 변끼리 닿으면 꼬인 다각형이다(BE ST_IsValid 와 같은 판단). */
function selfIntersects(points: readonly Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // 이웃한 변(공유 꼭짓점)은 건너뛴다.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsTouch(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 다각형 꼭짓점을 검사한다. 닫는 점과 바로 이어진 같은 점은 빼고, 3~256개·유한수·넓이 > 0·꼬이지 않음이어야 한다.
 * 틀리면 이유. 맞으면 정리한 꼭짓점.
 */
export function readPolygonXy(value: unknown): { points: Point[] } | { reason: string } {
  if (!Array.isArray(value)) return { reason: 'polygon_xy 가 배열이 아니다' };
  const points: Point[] = [];
  for (const vertex of value) {
    if (!Array.isArray(vertex) || vertex.length !== 2 || !vertex.every(isFiniteNumber)) {
      return { reason: 'polygon_xy 꼭짓점은 유한수 2개여야 한다' };
    }
    const point: Point = [vertex[0] as number, vertex[1] as number];
    const last = points.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
  const [first, last] = [points[0], points.at(-1)];
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  if (points.length < 3) return { reason: 'polygon_xy 는 서로 다른 꼭짓점이 3개 이상이어야 한다' };
  if (points.length > MAX_ZONE_VERTICES) {
    return { reason: `polygon_xy 꼭짓점은 ${MAX_ZONE_VERTICES}개 이하여야 한다` };
  }
  if (selfIntersects(points)) return { reason: 'polygon_xy 가 꼬였다(변이 서로 닿는다)' };
  if (polygonArea(points) === 0) return { reason: 'polygon_xy 넓이가 0 이다' };
  return { points };
}

/** 높이 범위. 둘 다 있으면 최저 < 최고, 하나만 있으면 모르는 것으로 본다(BE·Tier 0 는 둘 다 있을 때만 z_range 를 싣는다). */
function readZRange(
  item: Record<string, unknown>,
): { zRange: [number, number] | null } | { reason: string } {
  const [zMin, zMax] = [item.z_min_m, item.z_max_m];
  if (zMin != null && !isFiniteNumber(zMin)) return { reason: 'z_min_m 이 유한수가 아니다' };
  if (zMax != null && !isFiniteNumber(zMax)) return { reason: 'z_max_m 이 유한수가 아니다' };
  if (!isFiniteNumber(zMin) || !isFiniteNumber(zMax)) return { zRange: null };
  if (!(zMin < zMax)) return { reason: 'z_min_m 은 z_max_m 보다 작아야 한다' };
  return { zRange: [zMin, zMax] };
}

/** 정식 구역 하나를 검사한다. */
export function readOfficialZone(item: unknown): { zone: ZoneView } | { reason: string } {
  if (!isRecord(item)) return { reason: '항목이 객체가 아니다' };
  const zoneId = item.zone_id;
  if (!isText(zoneId)) return { reason: 'zone_id 가 비었다' };
  const version = item.zone_version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { reason: 'zone_version 은 1 이상 정수여야 한다' };
  }
  const evalType = item.eval_type;
  if (!EVAL_TYPES.some((t) => t === evalType)) {
    return { reason: 'eval_type 은 GROUND_FOOTPRINT 또는 VOLUME_3D 여야 한다' };
  }
  const severity = item.severity;
  if (!isZoneSeverity(severity)) {
    return { reason: 'severity 는 CRITICAL·HIGH·CAUTION·INFO 중 하나여야 한다' };
  }
  if (item.valid_to != null) return { reason: '지금 유효한 버전이 아니다(valid_to 있음)' };
  const polygon = readPolygonXy(item.polygon_xy);
  if ('reason' in polygon) return polygon;
  const height = readZRange(item);
  if ('reason' in height) return height;
  if (evalType === 'VOLUME_3D' && !height.zRange) {
    return { reason: 'VOLUME_3D 구역의 높이(z_min_m·z_max_m)를 모른다' };
  }

  const official: OfficialZoneInfo = {
    zoneVersion: version as number,
    evalType: evalType as ZoneEvalType,
    severity,
    zoneKind: isText(item.zone_kind) ? item.zone_kind : null,
    polygonXy: polygon.points,
    zRange: height.zRange,
    hasGuardrail: typeof item.has_guardrail === 'boolean' ? item.has_guardrail : null,
    validFrom: isFiniteNumber(item.valid_from) ? item.valid_from : null,
  };
  const name = isText(item.name) ? item.name : '';
  // 세팅 화면이 싣는 표시 힌트(S15P31A101-629). 형상·판정과 무관하고 true 일 때만 붙인다.
  const review = item.needs_review === true ? { needsReview: true } : {};
  const xs = polygon.points.map(([x]) => x);
  const ys = polygon.points.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  if (evalType === 'GROUND_FOOTPRINT') {
    return {
      zone: {
        zoneId,
        name,
        min: worldPoint(x0, y0, 0),
        max: worldPoint(x1, y1, 0),
        shape: 'FOOTPRINT',
        official,
        ...review,
      },
    };
  }
  const [zMin, zMax] = height.zRange!;
  const rectangle = rectangleToAabb(polygon.points, zMin, zMax);
  return {
    zone: rectangle.ok
      ? { zoneId, name, min: rectangle.min, max: rectangle.max, shape: 'BOX', official, ...review }
      : {
          zoneId,
          name,
          min: worldPoint(x0, y0, zMin),
          max: worldPoint(x1, y1, zMax),
          shape: 'PRISM',
          official,
          ...review,
        },
  };
}

/**
 * GET /api/zones 응답(배열)을 검사한다. 배열이 아니면 전체 거부.
 * 같은 zone_id 가 둘 이상이면 어느 쪽이 지금 버전인지 알 수 없어 그 ID 를 모두 뺀다(DEMO 구역과 같은 규칙).
 */
export function adaptOfficialZones(raw: unknown, receivedAt: number): ZoneSnapshot {
  if (!Array.isArray(raw)) {
    return {
      status: 'REJECTED',
      contract: OFFICIAL_ZONE_CONTRACT,
      zones: [],
      invalid: [],
      receivedAt,
      reason: '구역 응답이 배열이 아니다',
    };
  }
  const idOf = (item: unknown) => (isRecord(item) && isText(item.zone_id) ? item.zone_id : null);
  const count = new Map<string, number>();
  for (const item of raw) {
    const id = idOf(item);
    if (id !== null) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const zones: ZoneView[] = [];
  const invalid: { zoneId: string | null; reason: string }[] = [];
  for (const item of raw) {
    const zoneId = idOf(item);
    if (zoneId !== null && count.get(zoneId)! > 1) {
      invalid.push({ zoneId, reason: 'zone_id 중복' });
      continue;
    }
    const checked = readOfficialZone(item);
    if ('reason' in checked) invalid.push({ zoneId, reason: checked.reason });
    else zones.push(checked.zone);
  }
  return {
    status: 'READY',
    contract: OFFICIAL_ZONE_CONTRACT,
    zones,
    invalid,
    receivedAt,
    reason: null,
  };
}
