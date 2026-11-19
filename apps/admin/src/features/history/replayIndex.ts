import type { Severity } from '@/features/events/types';
import type { Span } from '@/features/history/types';
import type { ReplayLog } from '@/features/viewer3d';
import type { WorldTrack } from '@simai/contracts';

// 재생 엔진이 읽은 기록(ReplayLog)에서 화면 목록(작업자·이벤트·데이터 없음)을 만들고, 재생 시각에 맞는 값을 고른다.

export interface WorkerRow {
  worldId: string;
  firstSeen: number;
  lastSeen: number;
  /** 이 사람이 대상인 이벤트 수. */
  events: number;
}

export interface EventRow {
  eventId: string;
  ruleId: string;
  severity: Severity;
  worldIds: string[];
  zoneId: string | null;
  raisedAt: number;
  /** 해소 시각. 구간 안에서 해소되지 않았으면 null. */
  resolvedAt: number | null;
  /** 해소 뒤 곧바로 다시 열린 횟수(경보 「n회」). 옛 기록은 없다. */
  resumeCount?: number;
}

export interface Frame {
  t: number;
  /** 그때 잡힌 사람. */
  ids: string[];
  /** 그중 위치가 있는 사람(CCTV 목 화면에 그린다). */
  tracks: WorldTrack[];
}

export interface ReplayIndex {
  /** World 기록(시각 오름차순). */
  frames: Frame[];
  workers: WorkerRow[];
  /** 발생 시각순. */
  events: EventRow[];
  /** 서버가 알려 준 기록 없는 구간("데이터 없음"). 나눠 받았으면 이어지는 것은 하나로 합쳤다. */
  gaps: Span[];
  /**
   * 아직 받지 못한 뒷구간(앞 창부터 이어서 받는 중이다). 이 구간의 시각은 "데이터 없음"도 "아무도 없음"도 아니고 모르는 것이다.
   * 전부 받았으면 null 이다.
   */
  pending: Span | null;
}

const SEVERITIES: readonly Severity[] = ['CRITICAL', 'HIGH', 'CAUTION', 'INFO'];
/** 규칙 이름을 모르는 이벤트의 표시. */
const UNKNOWN_RULE = '—';

// ── 기록 읽기 ─────────────────────────────────────────────────────────────────

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const payloadOf = (text: string) => {
  const payload = parse(text)?.payload;
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
};

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

const isXy = (value: unknown) =>
  Array.isArray(value) && value.length === 2 && value.every((v) => num(v) !== null);

/** 기록의 사람. 재생 엔진(parseReplayLog)이 계약을 검사한 World 이고, 위치가 없는 사람은 그림에서만 뺀다. */
function readFrame(t: number, payload: Record<string, unknown> | null): Frame {
  const frame: Frame = { t, ids: [], tracks: [] };
  const tracks = payload?.tracks;
  if (!Array.isArray(tracks)) return frame;
  for (const track of tracks) {
    if (typeof track !== 'object' || track === null) continue;
    const id = str(Reflect.get(track, 'world_id'));
    if (!id) continue;
    frame.ids.push(id);
    if (isXy(Reflect.get(track, 'position_xy'))) frame.tracks.push(track as WorldTrack);
  }
  return frame;
}

/** 이벤트 전이 하나의 payload 에서 이벤트 모습을 읽는다. 앞 전이(before)가 있으면 발생 시각을 이어받는다. 못 읽으면 null. */
function readEventRow(
  entry: ReplayLog['events'][number],
  payload: Record<string, unknown> | null,
  before: EventRow | undefined,
): EventRow | null {
  const id = str(payload?.event_id);
  const severity = payload?.severity;
  if (!payload || !id || !SEVERITIES.includes(severity as Severity)) return null;
  const worldIds = Array.isArray(payload.world_ids)
    ? payload.world_ids.filter((w) => typeof w === 'string')
    : [];
  return {
    eventId: id,
    ruleId: str(payload.rule_id) ?? UNKNOWN_RULE,
    severity: severity as Severity,
    worldIds,
    zoneId: str(payload.zone_id),
    raisedAt: num(payload.raised_at) ?? before?.raisedAt ?? entry.t,
    resolvedAt: payload.lifecycle === 'RESOLVED' ? (num(payload.resolved_at) ?? entry.t) : null,
    ...(num(payload.resume_count) ? { resumeCount: num(payload.resume_count)! } : {}),
  };
}

/** 이벤트마다 마지막 전이의 모습(발생 시각순). */
function readEvents(entries: ReplayLog['events']): EventRow[] {
  const byId = new Map<string, EventRow>();
  for (const entry of entries) {
    const payload = payloadOf(entry.text);
    const next = readEventRow(entry, payload, byId.get(str(payload?.event_id) ?? ''));
    if (next) byId.set(next.eventId, next);
  }
  return [...byId.values()].sort((a, b) => a.raisedAt - b.raisedAt);
}

/** 기록에 한 번이라도 잡힌 사람(World ID 순)과 그 사람이 대상인 이벤트 수. */
function readWorkers(frames: readonly Frame[], events: readonly EventRow[]): WorkerRow[] {
  const workers = new Map<string, WorkerRow>();
  for (const frame of frames) {
    for (const id of frame.ids) {
      const row = workers.get(id);
      if (row) row.lastSeen = frame.t;
      else workers.set(id, { worldId: id, firstSeen: frame.t, lastSeen: frame.t, events: 0 });
    }
  }
  for (const event of events) {
    for (const id of event.worldIds) {
      const row = workers.get(id);
      if (row) row.events += 1;
    }
  }
  return [...workers.values()].sort((a, b) => a.worldId.localeCompare(b.worldId));
}

/**
 * 재생 기록에서 화면 목록을 만든다. gaps 는 서버가 준 기록 없는 구간이다(우리가 간격으로 추정하지 않는다).
 * pending 은 아직 받지 못한 뒷구간이다(다 받았으면 null).
 */
export function indexReplay(
  log: ReplayLog,
  gaps: readonly Span[],
  pending: Span | null = null,
): ReplayIndex {
  const frames = log.worlds.map((entry) => readFrame(entry.t, payloadOf(entry.text)));
  const events = readEvents(log.events);
  return { frames, workers: readWorkers(frames, events), events, gaps: [...gaps], pending };
}

// ── 재생 시각에 맞는 값 ───────────────────────────────────────────────────────

/** t 에 보이는 기록(그 시각 이하 마지막 기록). holdMs 보다 오래됐으면 그 시각의 것이 아니라 없다. */
export function frameAt(index: ReplayIndex, t: number, holdMs: number): Frame | null {
  let lo = 0;
  let hi = index.frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.frames[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const frame = found >= 0 ? index.frames[found] : undefined;
  return frame && t - frame.t <= holdMs ? frame : null;
}

/** 기록이 하나도 없는지(잡힌 사람도 이벤트도 없다). */
export const isEmptyReplay = (index: ReplayIndex) =>
  index.frames.length === 0 && index.events.length === 0;

/** t 가 기록 없는 구간(서버 gaps) 안인지. */
export const inGap = (gaps: readonly Span[], t: number) =>
  gaps.some((gap) => gap.from <= t && t <= gap.to);

/**
 * t 가 "데이터 없음"인지: 보이는 기록이 없고 서버가 기록 없는 구간이라고 한 시각이다.
 * 기록이 없어도 그 구간 밖이면 Tier 0 는 돌고 있었으니 그 시각에 아무도 없던 것이다(데이터 없음이 아니다).
 */
export const noDataAt = (index: ReplayIndex, t: number, holdMs: number) =>
  frameAt(index, t, holdMs) === null && inGap(index.gaps, t);

/** t 가 아직 받지 못한 뒷구간 안인지(그 시각의 기록을 모른다). 앞 구간의 끝 tick 은 받은 쪽이다. */
export const inPending = (index: ReplayIndex, t: number) =>
  index.pending !== null && t > index.pending.from;

/** 작업 구간 전체가 기록 없는 구간인지. */
export const allGap = (gaps: readonly Span[], range: Span) =>
  gaps.some((gap) => gap.from <= range.from && range.to <= gap.to);

/** t 에 활성인 이벤트인지(발생했고 아직 해소되지 않았음). */
export const isActiveAt = (event: EventRow, t: number) =>
  event.raisedAt <= t && (event.resolvedAt === null || event.resolvedAt > t);
