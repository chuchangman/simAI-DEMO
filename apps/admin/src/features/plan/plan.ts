import { isAlarming, isCurrent, SEVERITY_RANK, type EventEntry } from '@/features/events/events';
import type { Severity } from '@/features/events/types';
import type { Zone, ZoneBox } from '@/features/zones/types';
import type { WorldTrack } from '@simai/contracts';

// 2D 평면(명세 13.6 비상 화면, 4.1 BEV 2D 개요)의 계산. three.js 없이 World 상태만으로 그린다.

/** 교실 테스트베드 크기(m). 평면도(GET /api/floor-plans/current)가 없을 때의 기본 방 크기다. */
export const ROOM = { width: 10, depth: 10 } as const;

/** World (x, y) 한 점(m). */
export type PlanPoint = readonly [number, number];

/** 평면이 그리는 World 범위(m). */
export interface PlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 기본 범위: 교실 테스트베드(원점에서 ROOM 크기). */
export const ROOM_BOUNDS: PlanBounds = { minX: 0, minY: 0, maxX: ROOM.width, maxY: ROOM.depth };

export const boundsWidth = (bounds: PlanBounds) => bounds.maxX - bounds.minX;
export const boundsDepth = (bounds: PlanBounds) => bounds.maxY - bounds.minY;

/** 2D 에 그리는 구역. 서버 구역이면 판정 유형·유형·등급으로 색과 말풍선을 정한다. */
export type PlanZone = ZoneBox &
  Partial<Pick<Zone, 'judgeType' | 'zoneType' | 'severity' | 'polygon'>>;

/** 평면도(BEV) 바탕. 이미지는 bounds 를 덮는다. */
export interface PlanBackdrop {
  /** 이미 받아 둔 평면도 이미지 주소. 아직 받지 못했으면 없다. */
  imageUrl?: string;
  /** 대략 방 외곽(World m, 정확도 주장 없음). */
  outline?: readonly PlanPoint[];
  /** 지금 보정 버전으로 만든 평면도가 아니다. */
  outdated?: boolean;
}

/** 대상 키(이벤트 패널과 같은 규칙): 구역은 zone:{zoneId}, 사람은 person:{worldId}. */
export const ZONE_KEY_PREFIX = 'zone:';
const PERSON_KEY_PREFIX = 'person:';
export const zoneKey = (zoneId: string) => `${ZONE_KEY_PREFIX}${zoneId}`;
export const personKey = (worldId: string) => `${PERSON_KEY_PREFIX}${worldId}`;

/** 방 바깥 여백(m). 방 가장자리의 사람·이름표가 잘리지 않게 한다. */
export const PLAN_MARGIN = 0.9;

/**
 * World(m, +X 오른쪽, +Y 앞) → 평면 SVG 좌표(m, +y 아래). World 와 화면 좌표의 변환은 여기서만 한다.
 * 위에서 내려다본 지도처럼 +Y 가 화면 위쪽이 되게 뒤집고, 범위의 왼쪽 위(min x, max y)를 원점으로 옮긴다.
 */
export const toPlan = (
  x: number,
  y: number,
  bounds: PlanBounds = ROOM_BOUNDS,
): readonly [number, number] => [x - bounds.minX, bounds.maxY - y];

/** World 꼭짓점들 → SVG polygon 의 points 속성(평면 좌표). */
export const planPoints = (points: readonly PlanPoint[], bounds: PlanBounds): string =>
  points.map(([x, y]) => toPlan(x, y, bounds).join(',')).join(' ');

/** 사람 표시 모양(명세 13.2 관측 상태 표시를 따른다). */
export type TrackLook = 'observed' | 'predicted' | 'unknown';

export function trackLook(
  track: Pick<WorldTrack, 'observation_state' | 'track_lifecycle'>,
): TrackLook {
  if (track.track_lifecycle === 'LOST' || track.observation_state === 'UNKNOWN') return 'unknown';
  return track.observation_state === 'PREDICTED' ? 'predicted' : 'observed';
}

/** 이보다 작은 위치 불확실성(m)은 그리지 않는다. 관측 중인 사람마다 원이 생기면 평면이 어지럽다. */
export const SIGMA_MIN_M = 0.3;

/** 불확실 원 반지름(m). 작으면 null. */
export function sigmaRadius(track: Pick<WorldTrack, 'position_xy_sigma'>): number | null {
  const sigma = Math.max(...track.position_xy_sigma);
  return sigma >= SIGMA_MIN_M ? sigma : null;
}

/** 사람·구역 하나에 걸린 진행 중 이벤트 요약. */
export interface PlanMark {
  severity: Severity;
  /** 확인 대기 경보가 있다(소리·점멸 대상). */
  alarming: boolean;
}

/** 두 표시를 합친다: 더 높은 등급, 하나라도 확인 대기면 확인 대기. */
const combine = (a: PlanMark, b: PlanMark): PlanMark => ({
  severity: SEVERITY_RANK[a.severity] >= SEVERITY_RANK[b.severity] ? a.severity : b.severity,
  alarming: a.alarming || b.alarming,
});

const merge = (marks: Map<string, PlanMark>, id: string, mark: PlanMark) => {
  const prev = marks.get(id);
  marks.set(id, prev ? combine(prev, mark) : mark);
};

/**
 * 이 사람으로 볼 ID: 지금 world_id 와 병합(ID 교정)으로 합쳐진 이전 ID(aliases).
 * 이벤트의 world_ids 는 발생 당시 ID 를 그대로 두므로(계약 world_state·risk_event) 이전 ID 로 걸린 경보도 이 사람에게 보인다.
 */
export const trackIds = (track: Pick<WorldTrack, 'world_id' | 'aliases'>): readonly string[] => [
  track.world_id,
  ...(track.aliases ?? []),
];

/** 여러 ID 에 걸린 표시를 하나로 합친다. */
export function markFor(
  marks: Map<string, PlanMark>,
  ids: readonly string[],
): PlanMark | undefined {
  let result: PlanMark | undefined;
  for (const id of ids) {
    const mark = marks.get(id);
    if (mark) result = result ? combine(result, mark) : mark;
  }
  return result;
}

/**
 * 진행 중 이벤트(CAUTION 이상)로 사람·구역마다 가장 높은 등급과 확인 대기 여부를 모은다.
 * 지금 Tier 0 가 들고 있지 않은 「지난 관제」 이벤트는 뺀다(S15P31A101-595).
 */
export function planMarks(entries: readonly EventEntry[]) {
  const people = new Map<string, PlanMark>();
  const zones = new Map<string, PlanMark>();
  for (const entry of entries) {
    const { event } = entry;
    if (!isCurrent(event) || SEVERITY_RANK[event.severity] < SEVERITY_RANK.CAUTION) continue;
    const mark = { severity: event.severity, alarming: isAlarming(entry) };
    for (const id of event.world_ids) merge(people, id, mark);
    if (event.zone_id) merge(zones, event.zone_id, mark);
  }
  return { people, zones };
}

export type PlanMarks = ReturnType<typeof planMarks>;

/** 2D 표시 색 이름: 위험 빨강·경고 주황·주의 노랑(CONVENTION: 빨강·주황·노랑은 위험 등급에만). */
export type PlanTone = 'critical' | 'high' | 'caution';

const SEVERITY_TONE: Record<Severity, PlanTone | undefined> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  CAUTION: 'caution',
  INFO: undefined,
};

/** 등급의 표시 색. 안내는 색이 없다(undefined). */
export const severityTone = (severity: Severity): PlanTone | undefined => SEVERITY_TONE[severity];
