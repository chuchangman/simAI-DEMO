import {
  eventTargetsTrack,
  isActiveEvent,
  type EventSource,
  type RiskEventView,
  type TrackView,
} from '@/features/viewer3d/data/spatialFrame';
import { cssHex, PALETTE, type ScenePalette } from '@/features/viewer3d/palette';
import type { ViewerMode } from '@/features/viewer3d/types';

// -185 위험 강조 계산. 렌더러와 떨어진 순수 함수라 시험할 수 있다.
// 위험 판정·등급 결정·전이 생성은 하지 않는다. -194 Store 가 순서·중복을 걸러 보관한 RiskEvent 의 최신 상태를 3D 대상에 잇기만 한다.
// 입력(이벤트·World·구역)은 바꾸지 않고 렌더용 가벼운 모델을 새로 만든다.

/** 뷰어 모드마다 보여 줄 이벤트 출처. WHAT_IF 는 모드가 없어 기본 3D 에 섞지 않는다(명세 13.4). */
export const MODE_EVENT_SOURCE: Record<ViewerMode, EventSource> = {
  LIVE: 'LIVE',
  PLANNED: 'PLANNED',
  REPLAY: 'REPLAY',
};

/**
 * 3D 강조 등급. 위험·경고(관제 경보 대상, 명세 12.4 /topic/events)는 사람과 구역에, 주의(-497 사다리 1단계)는 사람 발밑 노란 링에만 보인다.
 * 소리·배너가 없는 주의가 경보 등급처럼 보이지 않게 구역은 위험·경고만 강조한다.
 */
export type RiskLevel = 'CRITICAL' | 'HIGH' | 'CAUTION';

const LEVEL_RANK: Record<RiskLevel, number> = { CRITICAL: 3, HIGH: 2, CAUTION: 1 };

export interface RiskHighlight {
  /** 이 대상에 걸린 활성 이벤트 중 가장 높은 등급(severity). proposed_severity(VLM 의견)는 쓰지 않는다. */
  level: RiskLevel;
  /** 이 대상을 가리키는 활성 이벤트 ID(중복 없음, 정렬). 같은 사람의 여러 규칙은 한 묶음으로 보인다(명세 13.1). */
  eventIds: readonly string[];
  source: EventSource;
  /** 묶음 안에 확인 필요(needs_check) 이벤트가 있다. */
  needsCheck: boolean;
  /** 입력 연결이 OPEN 이 아니다. 마지막으로 받은 상태이며 해소된 것으로 보지 않는다. */
  lastReceived: boolean;
  /** 이벤트나 World 의 scene_version 을 몰라 같은 Scene 인지 확인하지 못했다. */
  sceneUnknown: boolean;
}

export type UnlinkedReason =
  /** 이벤트의 world_id 가 지금 World 에 없다(지금 ID·병합 별칭 모두). 유령 아바타를 만들지 않는다. */
  | 'WORLD_ID_NOT_IN_SCENE'
  /** 이벤트의 zone_id 가 받은 구역에 없다. 상자를 지어내지 않는다. */
  | 'ZONE_NOT_IN_SCENE'
  /** 이벤트와 World 의 scene_version 이 달라 3D 대상에 잇지 않는다. */
  | 'SCENE_MISMATCH';

export interface UnlinkedTarget {
  eventId: string;
  target: string;
  reason: UnlinkedReason;
}

export type SkipReason =
  /** INFO, 또는 가리킬 사람이 없는 CAUTION(주의는 사람 링으로만 보인다). 관제 경보 등급으로 위장하지 않는다. */
  | 'LOW_SEVERITY'
  /** 재동기화 중 해소돼 감사 기록으로만 복원된 LIVE 이벤트. */
  | 'AUDIT_ONLY';

export interface RiskPresentation {
  /** 지금 모드에서 보여 주는 이벤트 출처. */
  source: EventSource;
  people: ReadonlyMap<string, RiskHighlight>;
  zones: ReadonlyMap<string, RiskHighlight>;
  unlinked: readonly UnlinkedTarget[];
  /** 출처는 맞고 활성이지만 강조하지 않은 이벤트. */
  skipped: readonly { eventId: string; reason: SkipReason }[];
}

export interface RiskInput {
  events: Iterable<RiskEventView>;
  tracks: readonly Pick<TrackView, 'worldId' | 'aliases'>[];
  /** 지금 World 의 scene_version. World 가 없으면 null. */
  worldSceneVersion: string | null;
  zoneIds: readonly string[];
  mode: ViewerMode;
  connectionOpen: boolean;
}

export const NO_RISK: RiskPresentation = {
  source: 'LIVE',
  people: new Map(),
  zones: new Map(),
  unlinked: [],
  skipped: [],
};

const isRiskLevel = (severity: RiskEventView['severity']): severity is RiskLevel =>
  severity === 'CRITICAL' || severity === 'HIGH' || severity === 'CAUTION';

/** 구역에 강조를 얹는 등급. 주의는 구역을 강조하지 않는다. */
const ZONE_LEVELS: ReadonlySet<RiskLevel> = new Set<RiskLevel>(['CRITICAL', 'HIGH']);
const isZoneLevel = (level: RiskLevel) => ZONE_LEVELS.has(level);

function merge(
  map: Map<string, RiskHighlight>,
  key: string,
  event: RiskEventView,
  level: RiskLevel,
  flags: Pick<RiskHighlight, 'lastReceived' | 'sceneUnknown'>,
) {
  const prev = map.get(key);
  if (!prev) {
    map.set(key, {
      level,
      eventIds: [event.eventId],
      source: event.source,
      needsCheck: event.needsCheck,
      ...flags,
    });
    return;
  }
  map.set(key, {
    level: LEVEL_RANK[level] > LEVEL_RANK[prev.level] ? level : prev.level,
    eventIds: prev.eventIds.includes(event.eventId)
      ? prev.eventIds
      : [...prev.eventIds, event.eventId].sort(),
    source: prev.source,
    needsCheck: prev.needsCheck || event.needsCheck,
    lastReceived: prev.lastReceived,
    sceneUnknown: prev.sceneUnknown || flags.sceneUnknown,
  });
}

/**
 * 활성 이벤트를 사람(world_id)·구역(zone_id) 강조로 묶는다.
 * - 출처: 모드의 출처만(LIVE 모드에 PLANNED·REPLAY·WHAT_IF 를 섞지 않는다).
 * - 활성: lifecycle 이 RESOLVED 가 아닌 것. ACK 는 해소가 아니라 강조를 지우지 않는다. 시간으로 지우지도 않는다.
 * - 대상: eventTargetsTrack(지금 ID·병합 별칭). 분할된 새 ID 로 옮기지 않는다. 없는 대상은 unlinked 로 남긴다.
 * - 같은 대상의 여러 이벤트는 강조 하나로 묶고 가장 높은 등급을 쓴다.
 */
export function riskPresentation(input: RiskInput): RiskPresentation {
  const source = MODE_EVENT_SOURCE[input.mode];
  const people = new Map<string, RiskHighlight>();
  const zones = new Map<string, RiskHighlight>();
  const unlinked: UnlinkedTarget[] = [];
  const skipped: { eventId: string; reason: SkipReason }[] = [];
  const zoneIds = new Set(input.zoneIds);

  for (const event of input.events) {
    if (event.source !== source || !isActiveEvent(event)) continue;
    if (event.delivery === 'AUDIT_ONLY') {
      skipped.push({ eventId: event.eventId, reason: 'AUDIT_ONLY' });
      continue;
    }
    const level = event.severity;
    // 주의는 사람 링으로만 보이므로, 가리킬 사람이 없는 주의는 강조할 곳이 없다.
    if (!isRiskLevel(level) || (!isZoneLevel(level) && event.worldIds.length === 0)) {
      skipped.push({ eventId: event.eventId, reason: 'LOW_SEVERITY' });
      continue;
    }
    const zoneTarget = event.zoneId !== null && isZoneLevel(level) ? event.zoneId : null;
    const targets = [...event.worldIds, ...(zoneTarget === null ? [] : [zoneTarget])];
    const scene = event.sceneVersion;
    const world = input.worldSceneVersion;
    if (scene !== null && world !== null && scene !== world) {
      for (const target of targets) {
        unlinked.push({ eventId: event.eventId, target, reason: 'SCENE_MISMATCH' });
      }
      continue;
    }
    const flags = {
      lastReceived: !input.connectionOpen,
      sceneUnknown: scene === null || world === null,
    };

    for (const worldId of event.worldIds) {
      const matched = input.tracks.filter(
        (track) => track.worldId === worldId || track.aliases.includes(worldId),
      );
      if (matched.length === 0) {
        unlinked.push({ eventId: event.eventId, target: worldId, reason: 'WORLD_ID_NOT_IN_SCENE' });
      }
    }
    for (const track of input.tracks) {
      if (eventTargetsTrack(event, track)) merge(people, track.worldId, event, level, flags);
    }
    if (zoneTarget !== null) {
      if (zoneIds.has(zoneTarget)) merge(zones, zoneTarget, event, level, flags);
      else
        unlinked.push({ eventId: event.eventId, target: zoneTarget, reason: 'ZONE_NOT_IN_SCENE' });
    }
  }
  return { source, people, zones, unlinked, skipped };
}

/** 표시 모양. CRITICAL 빨강 이중선·HIGH 주황·CAUTION 노랑 한 줄, 실시간 관측이 아니면(계획·재생·마지막 수신) 점선. */
export interface RiskStyle {
  color: number;
  labelColor: string;
  double: boolean;
  dashed: boolean;
}

// 색은 장면 색표(palette)를 따른다. 구역 윤곽선과 같은 등급 색이라, 위험이 걸린 구역은 이중선·바깥 상자·이름표로
// 윤곽선보다 두드러지게 한다. 미리보기 보라와는 겹치지 않는다.
export function riskStyle(risk: RiskHighlight, palette: ScenePalette = PALETTE.dark): RiskStyle {
  const { color } = palette.risk[risk.level];
  return {
    color,
    labelColor: cssHex(color),
    double: risk.level === 'CRITICAL',
    dashed: risk.source !== 'LIVE' || risk.lastReceived,
  };
}

/** World 의 사람 목록과 병합 별칭만 묶은 문자열. 10 Hz 좌표 갱신에는 바뀌지 않아 선택자 결과로 쓴다. */
export function membershipKey(tracks: readonly Pick<TrackView, 'worldId' | 'aliases'>[]): string {
  return tracks.map((track) => [track.worldId, ...track.aliases].join(' ')).join('\n');
}

export function parseMembership(key: string): Pick<TrackView, 'worldId' | 'aliases'>[] {
  if (!key) return [];
  return key.split('\n').map((line) => {
    const [worldId, ...aliases] = line.split(' ');
    return { worldId: worldId!, aliases };
  });
}
