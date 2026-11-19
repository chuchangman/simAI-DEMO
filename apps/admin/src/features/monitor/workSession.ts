import type { OutsideWorkKind } from '@/features/events/EventBadges';
import { eventTime, isAlarming, type EventEntry } from '@/features/events/entries';
import type { EventItem } from '@/features/events/types';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { workPlaceLabel } from '@/features/tbm/workPlace';

// 관제 화면의 작업 세션 계산(S15P31A101-457): 진행 중 작업 고르기, 시작 이전 이벤트 거르기, "작업 외 진입" 판정.
// 화면 없이 시험한다. 서버가 준 값만 쓰고, 모르는 것은 지어내지 않는다(판정 불가면 배지를 달지 않는다).

/** 서버 시각 값(epoch ms 숫자, 숫자 글자, ISO 글자)을 ms 로. 읽을 수 없으면 null. */
function toMs(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * 지금 실행이 시작된 시각(EC2 ms). 진행 중 실행이 있으면 그 시작(S15P31A101-696: 한 번 더 실행하면 실행 2 시작부터가 이번 관제다),
 * 없으면 작업 시작(work_unit.actual_started_at = 첫 실행 시작). 시작 기록이 없으면 null.
 */
export function workStartedAt(
  work: Pick<TbmWorkUnit, 'actual_started_at' | 'runs'>,
): number | null {
  const open = work.runs?.find((run) => run.ended_at === null);
  return open ? open.started_at : toMs(work.actual_started_at);
}

/** 작업이 실제로 끝난 시각(EC2 ms, work_unit.actual_ended_at). 끝나지 않았으면 null. */
export const workEndedAt = (work: Pick<TbmWorkUnit, 'actual_ended_at'>): number | null =>
  toMs(work.actual_ended_at);

/**
 * 지금 진행 중(IN_PROGRESS)인 작업. 서버는 한 시점에 하나만 허용하지만(409 WORK_ALREADY_IN_PROGRESS),
 * 둘이 오면 더 늦게 시작한 쪽을 쓴다. 없으면 null.
 */
export function activeWork(works: readonly TbmWorkUnit[]): TbmWorkUnit | null {
  const running = works.filter((work) => work.status === 'IN_PROGRESS');
  if (running.length === 0) return null;
  const startOf = (work: TbmWorkUnit) => workStartedAt(work) ?? Number.NEGATIVE_INFINITY;
  return running.reduce((latest, work) => (startOf(work) > startOf(latest) ? work : latest));
}

/** 이벤트 발생 시각(EC2 ms). 발생 시각을 모르면 마지막 갱신 시각, 둘 다 모르면 null. */
const raisedTime = (event: EventItem): number | null => event.raised_at ?? eventTime(event);

export interface SinceSplit {
  /** 패널에 보이는 이벤트: 시작 이후 발생분, 시각을 모르는 것, 확인 대기 경보. */
  shown: EventEntry[];
  /** 시작 이전에 발생해 기본 목록에서 빠진 이벤트 수(히스토리 링크에 보인다). */
  hidden: number;
}

/**
 * 진행 중 작업이 시작된 뒤의 이벤트만 남긴다. 시작 시각(since)을 모르면 거르지 않는다.
 * 확인 대기 경보(isAlarming)는 시작 이전에 났어도 숨기지 않는다(경보를 가리지 않는다).
 * 거를 것이 없으면 받은 배열을 그대로 돌려준다.
 */
export function splitSince(entries: EventEntry[], since: number | null): SinceSplit {
  if (since === null) return { shown: entries, hidden: 0 };
  const shown = entries.filter((entry) => {
    const at = raisedTime(entry.event);
    return at === null || at >= since || isAlarming(entry);
  });
  return shown.length === entries.length
    ? { shown: entries, hidden: 0 }
    : { shown, hidden: entries.length - shown.length };
}

/** GET /api/work-units 가 주는 작업의 기간(기본 days=7). 이보다 오래된 이벤트의 작업은 목록에 없어 알 수 없다. */
const WORKS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 이벤트가 난 시각에 진행 중이던 작업(시작 ≤ 발생 ≤ 종료, 아직 안 끝났으면 끝 없음). 시작 기록이 있는 작업만 센다.
 * 실행 목록이 있으면 실행 구간 안만 본다(실행 사이는 작업 중이 아니다, S15P31A101-696).
 */
function worksAt(works: readonly TbmWorkUnit[], at: number): TbmWorkUnit[] {
  return works.filter((work) => {
    if (work.status !== 'IN_PROGRESS' && work.status !== 'DONE') return false;
    if (work.runs && work.runs.length > 0) {
      return work.runs.some(
        (run) => run.started_at <= at && (run.ended_at === null || at <= run.ended_at),
      );
    }
    const start = workStartedAt(work) ?? (work.status === 'IN_PROGRESS' ? at : null);
    if (start === null || start > at) return false;
    const end = workEndedAt(work);
    return end === null || at <= end;
  });
}

/**
 * "작업 외 진입" 판정(경보 등급·소리·표시와 무관한 꼬리표용). 아래일 때 true.
 * - 발생 시각에 진행 중이던 작업이 없다(작업 시작 전·종료 후·작업 사이).
 * - 진행 중이던 작업이 모두 특정 구역 작업이고, 이벤트의 구역(zone_id)이 그 구역들 어디에도 없다.
 * 판정할 수 없으면 false 다: 발생 시각을 모르거나, 작업 목록이 다루는 기간(WORKS_WINDOW_MS)보다 오래된 이벤트이거나,
 * 이벤트에 구역이 없거나(예: 카메라 상태), 작업이 구역 밖(현장 전체) 작업이다.
 */
export function isOutsideWork(
  event: EventItem,
  works: readonly TbmWorkUnit[],
  now: number = Date.now(),
): boolean {
  return outsideWorkKind(event, works, now) !== null;
}

/**
 * isOutsideWork 의 이유(S15P31A101-731, 꼬리표 문구를 뜻 있게): 발생 시각에 진행 중인 작업이 없으면 NO_WORK(「작업 시간 외」),
 * 작업 중이었는데 작업 구역 밖이면 OUTSIDE_ZONE(「작업 구역 밖」). 작업 외 진입이 아니거나 판정할 수 없으면 null.
 */
export function outsideWorkKind(
  event: EventItem,
  works: readonly TbmWorkUnit[],
  now: number = Date.now(),
): OutsideWorkKind | null {
  const at = event.raised_at;
  if (at === undefined || at < now - WORKS_WINDOW_MS) return null;
  const during = worksAt(works, at);
  if (during.length === 0) return 'NO_WORK';
  if (event.zone_id === null) return null;
  if (during.some((work) => work.zone_id === null)) return null;
  return during.some((work) => work.zone_id === event.zone_id) ? null : 'OUTSIDE_ZONE';
}

/** 세션 바의 작업 구역: 구역 작업은 구역 이름(서버 place), 구역 없는 작업은 장소 또는 "현장 전체". */
export const workZoneLabel = (work: Pick<TbmWorkUnit, 'zone_id' | 'place'>): string =>
  workPlaceLabel(work);

/** 작업 경과: 1분 미만 "N초", 1시간 미만 "N분 S초", 그 뒤 "H시간 M분". */
export function workElapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}분 ${total % 60}초`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}
