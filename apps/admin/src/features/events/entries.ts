import { ACK_HIDE_AFTER_MS, MAX_RESOLVED, SEVERITY_RANK } from '@/features/events/constants';
import {
  SERVER_CLOSE_KINDS,
  type EventEscalation,
  type EventItem,
  type EventSummary,
  type EventSummaryStatus,
  type ServerCloseKind,
  type Severity,
} from '@/features/events/types';

// 이벤트 하나하나의 상태 계산(명세 3.10, 12.4, FR-8). 화면 없이 시험한다.

/** 화면이 들고 있는 이벤트 하나. */
export interface EventEntry {
  event: EventItem;
  /**
   * 지금 경보 단계가 열린 시각(EC2 ms). 경보 단계는 발생·등급 상향·재개가 연다(명세 3.10).
   * 이 시각 뒤의 확인(ACK)만 소리를 멈춘다. acks 에 확인 대상 event_sequence 가 없어 시각으로 판단한다.
   */
  stageStartedAt: number | null;
}

/** 규칙 하나의 표시 상태. */
export type EntryStatus =
  | { kind: 'alarm' }
  | { kind: 'acked'; at: number }
  | { kind: 'notice' }
  | { kind: 'resolved'; at: number | null; closed: boolean; serverClosed?: ServerCloseKind };

export const eventTime = (event: EventItem) => event.updated_at ?? event.raised_at ?? null;

export const isActive = (event: EventItem) => event.lifecycle !== 'RESOLVED';

/**
 * EC2 마감 종류(S15P31A101-722): Tier 0 가 사라져 해소 전이가 오지 않을 이벤트를 EC2 가 닫았으면 그 종류, 아니면 null.
 * 관측 해소가 아니므로 「최근 해소」에 넣지 않고 상태 문구도 해소와 다르게 적는다.
 */
export function serverCloseKind(event: EventItem): ServerCloseKind | null {
  const kind = event.resolution?.kind;
  return (SERVER_CLOSE_KINDS as readonly string[]).includes(kind ?? '')
    ? (kind as ServerCloseKind)
    : null;
}

/**
 * 지금 연결된 Tier 0 가 이 이벤트를 활성으로 들고 있는지(계약 risk_event 2.3.0 held_by_tier0, S15P31A101-595).
 * 칸이 없으면(이전 EC2) 들고 있다고 본다. 모르면 경보를 놓치지 않는 쪽이다.
 */
export const isHeld = (event: EventItem) => event.held_by_tier0 !== false;

/** 「진행 중」: 해소 전이고 지금 Tier 0 가 들고 있다. 경보 배너·소리·2D 평면·패널 머리줄 수가 이것만 쓴다. */
export const isCurrent = (event: EventItem) => isActive(event) && isHeld(event);

/**
 * 「지난 관제 · 확인 필요」: 해소 전인데 지금 Tier 0 가 들고 있지 않다(GPU 를 끈 관제에서 열린 채 남은 것 등).
 * 이벤트는 바꾸지 않고(자동 해소 없음, 명세 3.2) 화면 분류만 내린다. 상세·운영자 종료는 그대로 된다.
 */
export const isStale = (event: EventItem) => isActive(event) && !isHeld(event);

/** 소리·점멸·확인 대상 등급(HIGH 이상). */
export const isAlarmSeverity = (severity: Severity) =>
  SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH;

/** 최근 갱신 순. */
export const byRecent = (a: EventEntry, b: EventEntry) =>
  (eventTime(b.event) ?? 0) - (eventTime(a.event) ?? 0);

/**
 * 처음 본 이벤트(로그인 직후 목록 등)의 경보 단계 시작. 발생·운영자 상향 시각 중 늦은 쪽이다.
 * 재개됐거나 앞선 확인(acks)이 있으면 마지막 갱신 시각까지 본다. 재개 시각과 규칙이 등급을 올린 시각은 기록에 없고,
 * acks 에 확인 대상 event_sequence 가 없어(계약 공백) 앞선 확인이 지금 단계 것인지 알 수 없다.
 * 모르면 다시 울리는 쪽을 택한다(명세 3.10: 확인 대상 뒤에 오른 경보는 그 확인으로 멈추지 않는다).
 */
function firstStageStart(event: EventItem): number | null {
  const unknownStage = (event.resume_count ?? 0) > 0 || (event.acks?.length ?? 0) > 0;
  const candidates = [
    event.raised_at,
    unknownStage ? event.updated_at : undefined,
    ...(event.escalations ?? []).map((e) => e.requested_at),
  ].filter((t): t is number => t !== undefined);
  return candidates.length ? Math.max(...candidates) : null;
}

/** 확인 기록은 지워지지 않는다. 엇갈려 온 메시지에만 있는 확인도 잃지 않게 ack_id 로 합친다. */
function unionAcks(base: EventItem['acks'], other: EventItem['acks']): EventItem['acks'] {
  if (!other?.length) return base;
  if (!base?.length) return other;
  const known = new Set(base.map((a) => a.ack_id));
  const added = other.filter((a) => !known.has(a.ack_id));
  return added.length ? [...base, ...added] : base;
}

function escalationKey(item: EventEscalation): string {
  return (
    item.escalation_id ??
    item.assessment_job_id ??
    `${item.requested_at}:${item.target_severity}:${item.actor_id ?? ''}`
  );
}

/** 재개 전까지는 운영자 상향 기록도 유지한다(명세 5.4). */
function unionEscalations(
  base: EventItem['escalations'],
  other: EventItem['escalations'],
): EventItem['escalations'] {
  if (!other?.length) return base;
  if (!base?.length) return other;
  const known = new Set(base.map(escalationKey));
  const added = other.filter((e) => !known.has(escalationKey(e)));
  return added.length ? [...base, ...added] : base;
}

const SUMMARY_RANK: Record<EventSummaryStatus, number> = {
  QUEUED: 0,
  RUNNING: 1,
  SUCCEEDED: 2,
  FAILED: 2,
  TIMED_OUT: 2,
};

function summaryKey(item: EventSummary): string {
  return `${item.summary_id}:${item.job_id}`;
}

function sameSummary(a: EventSummary, b: EventSummary): boolean {
  return (
    a.summary_id === b.summary_id &&
    a.job_id === b.job_id &&
    a.status === b.status &&
    a.requested_at === b.requested_at &&
    a.finished_at === b.finished_at &&
    a.summary === b.summary &&
    a.window_start_ms === b.window_start_ms &&
    a.window_end_ms === b.window_end_ms &&
    a.error_code === b.error_code &&
    a.evidence_timestamps_ms.length === b.evidence_timestamps_ms.length &&
    a.evidence_timestamps_ms.every((v, i) => v === b.evidence_timestamps_ms[i])
  );
}

function preferSummary(base: EventSummary, incoming: EventSummary): EventSummary {
  if (sameSummary(base, incoming)) return base;
  const rankDiff = SUMMARY_RANK[incoming.status] - SUMMARY_RANK[base.status];
  if (rankDiff !== 0) return rankDiff > 0 ? incoming : base;
  if ((incoming.finished_at ?? 0) !== (base.finished_at ?? 0)) {
    return (incoming.finished_at ?? 0) > (base.finished_at ?? 0) ? incoming : base;
  }
  return incoming;
}

const bySummaryNewest = (a: EventSummary, b: EventSummary) =>
  b.requested_at - a.requested_at || b.summary_id - a.summary_id;

/** 구간 요약 기록(summaries)을 최신순으로 합친다. 같은 요약 건은 더 진행된 상태를 남긴다. */
function unionSummaries(
  base: EventItem['summaries'],
  other: EventItem['summaries'],
): EventItem['summaries'] {
  if (!other?.length) return base;
  if (!base?.length) return other;
  const byId = new Map<string, EventSummary>();
  for (const item of base) byId.set(summaryKey(item), item);
  let changed = false;
  for (const item of other) {
    const key = summaryKey(item);
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, item);
      changed = true;
    } else {
      const chosen = preferSummary(prev, item);
      if (chosen !== prev) {
        byId.set(key, chosen);
        changed = true;
      }
    }
  }
  if (!changed) return base;
  return [...byId.values()].sort(bySummaryNewest);
}

/**
 * 같거나 오래된 상태라도 '들고 있음'(held_by_tier0)은 받은 쪽 값으로 바꾼다. 이 값은 전이 없이 바뀌고(스냅샷·Tier 0 꺼짐)
 * 그때 목록을 다시 받아 알게 되므로, 같은 event_sequence 면 나중에 받은 것이 지금 값이다. 칸이 없는 것은 바꾸지 않는다.
 */
function withHeld(entry: EventEntry, next: EventItem): EventEntry {
  if (next.held_by_tier0 === undefined || next.held_by_tier0 === entry.event.held_by_tier0) {
    return entry;
  }
  return { ...entry, event: { ...entry.event, held_by_tier0: next.held_by_tier0 } };
}

/** next 가 prev 보다 새 상태인지. event_sequence 가 있으면 그것으로, 없으면 시각으로 본다. */
function isNewer(prev: EventItem, next: EventItem): boolean {
  if (prev.event_sequence !== undefined && next.event_sequence !== undefined) {
    return next.event_sequence > prev.event_sequence;
  }
  const a = eventTime(prev);
  const b = eventTime(next);
  return a === null || (b !== null && b > a);
}

/** 같은 상태(event_sequence 가 같음)를 다시 받았는지. sequence 가 없으면 시각이 같은지로 본다. */
function isSameState(prev: EventItem, next: EventItem): boolean {
  if (prev.event_sequence !== undefined && next.event_sequence !== undefined) {
    return next.event_sequence === prev.event_sequence;
  }
  return eventTime(prev) === eventTime(next);
}

const sameSequence = (prev: EventItem, next: EventItem) =>
  prev.event_sequence !== undefined && prev.event_sequence === next.event_sequence;

/**
 * 같은 순번에서도 EC2 가 바꿔 다시 보내는 표시용 칸(VLM 근거·상향 의견·평가 기록·전달 방식, S15P31A101-598).
 * Tier 0 전이(등급·생명주기 등)는 순번 규칙을 그대로 따른다. 근거는 서버가 비우지 않으므로 null 로 지우지 않는다.
 */
function sameSequenceDisplay(prev: EventItem, next: EventItem): Partial<EventItem> {
  const patch: Partial<EventItem> = {};
  if (next.rationale != null && next.rationale !== prev.rationale) patch.rationale = next.rationale;
  if (next.proposed_severity !== undefined && next.proposed_severity !== prev.proposed_severity) {
    patch.proposed_severity = next.proposed_severity;
  }
  for (const key of ['assessment_id', 'assessmentId', 'assessment_job_id', 'delivery'] as const) {
    if (next[key] !== undefined && next[key] !== prev[key]) {
      Object.assign(patch, { [key]: next[key] });
    }
  }
  if (
    next.assessments !== undefined &&
    JSON.stringify(next.assessments) !== JSON.stringify(prev.assessments)
  ) {
    patch.assessments = next.assessments;
  }
  return patch;
}

/** 등급이 오르거나 재개되면 새 경보 단계가 열린다. */
const opensNewStage = (prev: EventItem, next: EventItem) =>
  SEVERITY_RANK[next.severity] > SEVERITY_RANK[prev.severity] ||
  (next.resume_count ?? 0) > (prev.resume_count ?? 0);

/**
 * 받은 이벤트를 반영한다. 같거나 오래된 상태면 prev 를 그대로 돌려준다.
 * 다만 확인·상향·구간 요약 기록은 합치고, 같은 순번이면 EC2 표시용 칸(근거 등)은 새 값을 받는다. 재개(resume_count 증가)된 전이는 이전 상향 기록을 비운다(명세 5.4).
 */
export function mergeEvent(prev: EventEntry | undefined, next: EventItem): EventEntry {
  if (!prev) return { event: next, stageStartedAt: firstStageStart(next) };
  const resumed = (next.resume_count ?? 0) > (prev.event.resume_count ?? 0);
  if (!isNewer(prev.event, next)) {
    const acks = unionAcks(prev.event.acks, next.acks);
    const escalations = resumed
      ? prev.event.escalations
      : unionEscalations(prev.event.escalations, next.escalations);
    const summaries = unionSummaries(prev.event.summaries, next.summaries);
    const display = sameSequence(prev.event, next) ? sameSequenceDisplay(prev.event, next) : {};
    const merged =
      acks === prev.event.acks &&
      escalations === prev.event.escalations &&
      summaries === prev.event.summaries &&
      Object.keys(display).length === 0
        ? prev
        : {
            ...prev,
            event: {
              ...prev.event,
              ...display,
              acks,
              escalations,
              ...(summaries !== undefined ? { summaries } : {}),
            },
          };
    // 늦게 온 낮은 sequence(재연결 전 목록 등)가 '들고 있음'을 되돌리지 않게 같은 sequence 일 때만 바꾼다.
    return isSameState(prev.event, next) ? withHeld(merged, next) : merged;
  }
  const acks = unionAcks(next.acks, prev.event.acks);
  const escalations = resumed
    ? next.escalations
    : unionEscalations(next.escalations, prev.event.escalations);
  const summaries = unionSummaries(next.summaries, prev.event.summaries);
  return {
    event:
      acks === next.acks && escalations === next.escalations && summaries === next.summaries
        ? next
        : {
            ...next,
            acks,
            escalations,
            ...(summaries !== undefined ? { summaries } : {}),
          },
    stageStartedAt: opensNewStage(prev.event, next)
      ? (eventTime(next) ?? prev.stageStartedAt)
      : prev.stageStartedAt,
  };
}

/** 해소된 이벤트는 최근 것(MAX_RESOLVED 건)만 남긴다. */
function dropOldResolved(entries: EventEntry[]): EventEntry[] {
  const resolved = entries.filter((e) => !isActive(e.event));
  if (resolved.length <= MAX_RESOLVED) return entries;
  const dropped = new Set(
    resolved
      .sort(byRecent)
      .slice(MAX_RESOLVED)
      .map((e) => e.event.event_id),
  );
  return entries.filter((e) => !dropped.has(e.event.event_id));
}

/**
 * 목록에 이벤트들을 반영한다. 관제 화면은 LIVE 만 다룬다. 바뀐 것이 없으면 같은 배열을 돌려준다.
 * 해소된 이벤트는 최근 것만 남긴다.
 */
export function upsertEvents(
  entries: readonly EventEntry[],
  items: readonly EventItem[],
): EventEntry[] {
  const byId = new Map(entries.map((entry) => [entry.event.event_id, entry]));
  let changed = false;
  for (const item of items) {
    if (item.source !== 'LIVE') continue;
    const prev = byId.get(item.event_id);
    const next = mergeEvent(prev, item);
    if (next !== prev) {
      byId.set(item.event_id, next);
      changed = true;
    }
  }
  return changed ? dropOldResolved([...byId.values()]) : (entries as EventEntry[]);
}

/** 지금 경보 단계를 연 뒤에 누가 확인했는지(관리자·반장·현장 누구든). */
export function acknowledgedAt(entry: EventEntry): number | null {
  const since = entry.stageStartedAt ?? 0;
  const acks = (entry.event.acks ?? []).map((a) => a.acked_at).filter((t) => t >= since);
  return acks.length ? Math.max(...acks) : null;
}

/** 지금 경보 단계가 시작된 시각(EC2 ms). 기록이 없으면 마지막 갱신 시각으로 본다. 둘 다 없으면 null. */
const stageStart = (entry: EventEntry) => entry.stageStartedAt ?? eventTime(entry.event);

/**
 * 「모두 지우기」가 이 이벤트를 숨길지 가르는 시각. 진행 중이면 지금 경보 단계 시작이다.
 * 해소된 이벤트는 발생 시각이다: 새로고침으로 REST 에서 다시 받으면 확인·재개 기록 때문에 단계 시작이 마지막 갱신
 * 시각으로 잡혀(firstStageStart), 지운 뒤에 해소된 이벤트가 되살아나기 때문이다. 알 수 없으면 null.
 */
const clearBasis = (entry: EventEntry) =>
  isActive(entry.event) ? stageStart(entry) : (entry.event.raised_at ?? stageStart(entry));

/**
 * 목록에서 가장 늦게 시작된 경보 단계의 시작 시각(EC2 ms). 이 시각으로 지우면 지금 목록이 모두 숨는다.
 * 시각을 알 수 없는 이벤트는 무시하고, 아는 것이 없으면 null.
 */
export function latestStageStart(entries: readonly EventEntry[]): number | null {
  const times = entries.map(clearBasis).filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/**
 * 「모두 지우기」 기준 시각(clearedAt)까지 시작된 이벤트를 뺀다. 그 뒤에 생기거나, 등급이 오르거나 재개돼
 * 새 경보 단계가 열린 이벤트는 남는다. 시작 시각을 모르는 이벤트는 숨기지 않는다.
 * 뺄 것이 없으면 받은 배열을 그대로 돌려준다.
 */
export function withoutCleared(entries: EventEntry[], clearedAt: number | null): EventEntry[] {
  if (clearedAt === null) return entries;
  const shown = entries.filter((entry) => {
    const basis = clearBasis(entry);
    return basis === null || basis > clearedAt;
  });
  return shown.length === entries.length ? entries : shown;
}

/**
 * 관제 화면 소리·점멸 대상(명세 12.4): LIVE·CRITICAL/HIGH·RAISED/UPDATED 이고 지금 단계에서 아직 확인 전.
 * 지금 Tier 0 가 들고 있지 않은 「지난 관제」 이벤트는 울리지 않는다(S15P31A101-595).
 * 감사 전용(delivery AUDIT_ONLY: 재동기화 중 저장만 했거나 근거 없이 복원한 것)은 실시간 알림 대상이 아니라 울리지 않는다(명세 3.2,
 * S15P31A101-621). STOMP 는 원래 보내지 않지만 REST 로 다시 받은 목록에는 들어 있다. 지연 알림(DELAYED_ACTIVE)은 울린다.
 */
export function isAlarming(entry: EventEntry): boolean {
  const { event } = entry;
  return (
    event.source === 'LIVE' &&
    event.delivery !== 'AUDIT_ONLY' &&
    isAlarmSeverity(event.severity) &&
    isCurrent(event) &&
    acknowledgedAt(entry) === null
  );
}

export function entryStatus(entry: EventEntry): EntryStatus {
  const { event } = entry;
  if (!isActive(event)) {
    const serverClosed = serverCloseKind(event);
    return {
      kind: 'resolved',
      at: event.resolved_at ?? eventTime(event),
      closed: event.resolution?.kind === 'OPERATOR_CLOSED',
      ...(serverClosed === null ? {} : { serverClosed }),
    };
  }
  if (!isAlarmSeverity(event.severity)) return { kind: 'notice' };
  const at = acknowledgedAt(entry);
  return at === null ? { kind: 'alarm' } : { kind: 'acked', at };
}

/** 확인 필요(명세 7.1): 이유가 있거나 needs_check. */
export const needsCheck = (event: EventItem) =>
  event.needs_check || (event.confidence_reasons?.length ?? 0) > 0;

/**
 * 운영자 확인 요청(FR-4, FR-115: Tier 0 재시작 뒤 복원한 활성 이벤트는 UNVERIFIABLE 로 유지된다).
 * verification=UNVERIFIABLE 이거나 needs_check·confidence_reasons 가 있으면 확인을 요청한다.
 * 복원 전달 방식(delivery)은 지연 알림 꼬리표가 따로 보인다.
 */
export const needsConfirmation = (event: EventItem) =>
  needsCheck(event) || event.verification === 'UNVERIFIABLE';

/**
 * 카드에 「확인 필요」를 보일지: 확인을 요청하는 이벤트(needsConfirmation)를 운영자가 아직 확인하지 않았을 때만이다.
 * 확인한 뒤에는 처리 칩이 확인 시각을 알리므로 되풀이하지 않는다(이유 글은 사건 상세에 남는다).
 */
export const isConfirmationPending = (entry: EventEntry) =>
  needsConfirmation(entry.event) && acknowledgedAt(entry) === null;

/**
 * 운영자가 확인한 지 ACK_HIDE_AFTER_MS 가 지난 이벤트를 뺀다(nowMs 는 확인 시각과 같은 EC2 시계).
 * 지금 경보 단계에서 확인하지 않은 이벤트는 오래돼도 남고, 뺄 것이 없으면 받은 배열을 그대로 돌려준다.
 */
export function withoutStaleAcked(entries: EventEntry[], nowMs: number): EventEntry[] {
  const shown = entries.filter((entry) => {
    const ackedAt = acknowledgedAt(entry);
    return ackedAt === null || nowMs - ackedAt < ACK_HIDE_AFTER_MS;
  });
  return shown.length === entries.length ? entries : shown;
}
