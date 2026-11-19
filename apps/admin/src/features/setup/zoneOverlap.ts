import { convexHull, draftZoneFootprint } from '@/features/setup/draftZone';
import { SETUP_NEW_ZONE_PREFIX } from '@/features/setup/setupZonePlan';
import type { ZoneDraftItem } from '@/features/setup/types';
import type { Zone } from '@/features/zones/types';

// 이어 온 구역과 AI 초안이 "같은 자리"인지(S15P31A101-758, docs/design/S15P31A101-758-new-map-opening-only.md). 서버
// SetupZoneOverlap(이전 구역 불러오기가 AI 초안 구역과 같은 자리인 구역을 뺀다)과 같은 기준이다:
// - 높이 범위가 겹치고(한쪽이라도 높이가 없으면 겹친다고 본다),
// - 바닥 다각형 교집합이 작은 쪽 면적의 MIN_SHARED_RATIO 이상이고,
// - 작은 쪽 면적이 큰 쪽의 MIN_SIZE_RATIO 이상이다(넓은 구역 안에 든 작은 구역은 다른 구역이다).
// 교집합은 AI 다각형의 볼록 껍질로 이어 온 다각형을 자른다(Sutherland–Hodgman). AI 초안 구역은 볼록 다각형을 바깥으로 민 볼록 다각형이다.

type Point = readonly [number, number];

export const MIN_SHARED_RATIO = 0.5;
export const MIN_SIZE_RATIO = 0.25;
const EPS = 1e-9;

/** 바닥 다각형과 높이 범위(없으면 null). */
export interface ZoneFootprint {
  polygon: readonly Point[];
  zMin: number | null;
  zMax: number | null;
}

/** 단순 다각형 면적(신발끈 공식, 방향 무관). */
export function polygonArea(polygon: readonly Point[]): number {
  let sum = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(sum) / 2;
}

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function intersection(p: Point, q: Point, a: Point, b: Point): Point {
  const dp = cross(a, b, p);
  const dq = cross(a, b, q);
  const t = dp / (dp - dq);
  return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
}

/** subject 를 볼록 다각형 clip(반시계) 안으로 자른다. */
export function clipToConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output: Point[] = [...subject];
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const input = output;
    output = [];
    input.forEach((current, j) => {
      const previous = input[(j + input.length - 1) % input.length]!;
      const currentIn = cross(a, b, current) >= 0;
      const previousIn = cross(a, b, previous) >= 0;
      if (currentIn) {
        if (!previousIn) output.push(intersection(previous, current, a, b));
        output.push(current);
      } else if (previousIn) {
        output.push(intersection(previous, current, a, b));
      }
    });
  }
  return output;
}

function heightsOverlap(a: ZoneFootprint, b: ZoneFootprint): boolean {
  const low = Math.max(a.zMin ?? -Infinity, b.zMin ?? -Infinity);
  const high = Math.min(a.zMax ?? Infinity, b.zMax ?? Infinity);
  return high > low;
}

/** 같은 자리 정도: 교집합 / 작은 쪽 면적. 기준(높이·크기 비)을 못 넘으면 0. */
export function sameSpotRatio(carried: ZoneFootprint, draft: ZoneFootprint): number {
  if (!heightsOverlap(carried, draft)) return 0;
  const a = polygonArea(carried.polygon);
  const b = polygonArea(draft.polygon);
  const small = Math.min(a, b);
  if (small <= EPS || small < MIN_SIZE_RATIO * Math.max(a, b)) return 0;
  const hull = convexHull(draft.polygon);
  if (hull.length < 3) return 0;
  return polygonArea(clipToConvex(carried.polygon, hull)) / small;
}

/** carried(이어 온 구역)와 draft(AI 초안 구역)가 같은 자리인지. */
export function sameZoneSpot(carried: ZoneFootprint, draft: ZoneFootprint): boolean {
  return sameSpotRatio(carried, draft) >= MIN_SHARED_RATIO;
}

/** 화면 구역의 바닥 다각형·높이. */
export function zoneFootprint(zone: Pick<Zone, 'polygon' | 'zBounds'>): ZoneFootprint {
  return { polygon: zone.polygon, zMin: zone.zBounds[0], zMax: zone.zBounds[1] };
}

/** 세팅 목록에서 지금 관제 구역을 이어 온 구역인지(새로 그리거나 수락한 구역은 임시 ID 다). */
export const isCarriedZone = (zoneId: string) => !zoneId.startsWith(SETUP_NEW_ZONE_PREFIX);

/**
 * 아직 수락·버리기 전인 AI 초안과 같은 자리인 이어 온 구역을 짝짓는다(구역 ID → 초안). 초안 하나는 가장 많이 겹친 구역 하나와,
 * 구역 하나는 초안 하나와만 짝짓는다. 짝지은 둘은 화면에서 한 항목으로 묶어 둘 중 하나만 남긴다.
 */
export function pairDraftsWithCarried(
  drafts: readonly ZoneDraftItem[],
  zones: readonly Zone[],
): Map<string, ZoneDraftItem> {
  const carried = zones.filter((zone) => isCarriedZone(zone.zoneId));
  const candidates: { zoneId: string; draft: ZoneDraftItem; ratio: number }[] = [];
  for (const draft of drafts) {
    const footprint = draftZoneFootprint(draft);
    for (const zone of carried) {
      const ratio = sameSpotRatio(zoneFootprint(zone), footprint);
      if (ratio >= MIN_SHARED_RATIO) candidates.push({ zoneId: zone.zoneId, draft, ratio });
    }
  }
  candidates.sort((x, y) => y.ratio - x.ratio);
  const pairs = new Map<string, ZoneDraftItem>();
  const used = new Set<string>();
  for (const { zoneId, draft } of candidates) {
    if (pairs.has(zoneId) || used.has(draft.candidate_id)) continue;
    pairs.set(zoneId, draft);
    used.add(draft.candidate_id);
  }
  return pairs;
}
