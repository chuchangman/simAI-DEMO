import { useCurrentRole } from '@/features/auth/useCurrentRole';
import {
  CONTROL_ROOM_CHANNEL,
  ESCALATION_ERROR_CODE,
  ESCALATION_STATUS_LABEL,
  SEVERITY_LABEL,
} from '@/features/events/constants';
import { isActive } from '@/features/events/entries';
import type {
  EscalationDecision,
  EventEscalation,
  EventItem,
  Severity,
} from '@/features/events/types';
import { ApiError, NETWORK_ERROR } from '@/lib/http';

// VLM 상향 의견 승인·거절 권한, 상태 판정, 이력 정렬, 실패 문구(명세 5.4, 12.3, 12.6, FR-116).

export type EscalationStatusKind = keyof typeof ESCALATION_STATUS_LABEL;

const ESCALATION_ERROR_TEXT: Record<string, string> = {
  [ESCALATION_ERROR_CODE.NOT_FOUND]: '이벤트를 찾을 수 없습니다',
  [ESCALATION_ERROR_CODE.ASSESSMENT_NOT_FOUND]: '상향 의견을 찾을 수 없습니다',
  [ESCALATION_ERROR_CODE.RESOLVED]: '이미 해소된 이벤트입니다',
  [ESCALATION_ERROR_CODE.NOT_ACTIVE]: '이미 종료된 이벤트입니다',
  [ESCALATION_ERROR_CODE.NOT_UPWARD]: '이미 같거나 높은 등급이 적용되어 있습니다',
  [ESCALATION_ERROR_CODE.DUPLICATE]: '이미 적용된 상향 의견입니다',
  [ESCALATION_ERROR_CODE.ALREADY_DECIDED]: '이미 처리된 상향 의견입니다',
  [ESCALATION_ERROR_CODE.JOURNAL_UNAVAILABLE]:
    '현장 저널에 기록하지 못했습니다. 잠시 후 다시 시도하세요',
  [ESCALATION_ERROR_CODE.INVALID_DECISION]: '상향 결정 값이 올바르지 않습니다',
  [ESCALATION_ERROR_CODE.INVALID_ASSESSMENT]: '평가 ID가 올바르지 않습니다',
};

const ESCALATION_FAILED_TEXT = '상향 의견을 처리하지 못했습니다';

export function escalationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return ESCALATION_FAILED_TEXT;
  if (error.status === NETWORK_ERROR) return '서버에 연결할 수 없습니다';
  const text = error.code === undefined ? undefined : ESCALATION_ERROR_TEXT[error.code];
  if (text) return text;
  if (error.status >= 400 && error.status < 500 && error.serverMessage) return error.serverMessage;
  return ESCALATION_FAILED_TEXT;
}

/** 서버의 이벤트 상태가 화면과 달라졌음을 뜻하는 실패. 목록을 다시 받게 한다. */
export function isStaleEscalationError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ESCALATION_ERROR_CODE.RESOLVED ||
      error.code === ESCALATION_ERROR_CODE.NOT_ACTIVE ||
      error.code === ESCALATION_ERROR_CODE.NOT_UPWARD ||
      error.code === ESCALATION_ERROR_CODE.DUPLICATE ||
      error.code === ESCALATION_ERROR_CODE.ALREADY_DECIDED)
  );
}

/** 상향 의견 승인·거절 권한: 관리자(ADMIN)만(명세 12.6). */
export function useCanEscalate() {
  return useCurrentRole() === 'ADMIN';
}

/** 이벤트에서 VLM 평가 식별자(assessmentId)를 읽는다. 없으면 이벤트 ID·순번으로 정한다. */
export function resolveAssessmentId(event: EventItem): string | number {
  // 서버(-276)는 이벤트의 assessments[](최신순)에 평가 ID 를 싣는다. 아직 결정 안 된 상향 의견이 있는 가장 최근 것을 쓴다
  const pending = event.assessments?.find(
    (a) => a.proposed_severity != null && (a.decision == null || a.decision === 'NONE'),
  );
  return (
    pending?.assessment_id ??
    event.assessmentId ??
    event.assessment_id ??
    event.assessment_job_id ??
    `vlm-${event.event_id}-${event.event_sequence ?? 1}`
  );
}

function assessmentKeyOf(item: EventEscalation): string | undefined {
  const raw = item.assessment_job_id ?? item.assessmentId ?? item.assessment_id;
  return raw !== undefined && raw !== null && String(raw) !== '' ? String(raw) : undefined;
}

/**
 * 상향 이력 한 건의 처리 상태(승인·거절·적용·이미 적용·이벤트 종료).
 * - risk_event.escalations 에 실려 온 항목(decision·result 없음)은 Tier 0 저널에 기록된 적용 건이다.
 * - POST 응답이나 상세 이력의 result·reject_reason·decision·status 로 나머지 상태를 구분한다.
 */
export function escalationStatus(item: EventEscalation): EscalationStatusKind {
  const status = item.status?.toUpperCase();
  if (
    status === 'EVENT_CLOSED' ||
    status === 'NOT_ACTIVE' ||
    status === 'RESOLVED' ||
    item.status === '이벤트 종료'
  ) {
    return 'event_closed';
  }
  if (
    status === 'ALREADY_APPLIED' ||
    status === 'DUPLICATE' ||
    status === 'NOT_UPWARD' ||
    item.status === '이미 적용'
  ) {
    return 'already_applied';
  }
  if (status === 'REJECTED' || status === 'REJECT' || item.status === '거절') {
    return 'rejected';
  }
  if (status === 'APPLIED' || status === 'ACCEPTED' || item.status === '적용') {
    return 'applied';
  }
  if (
    status === 'APPROVED' ||
    status === 'APPROVE' ||
    status === 'PENDING' ||
    item.status === '승인'
  ) {
    return 'approved';
  }

  const result = item.result?.toUpperCase();
  const reason = item.reject_reason?.toUpperCase();
  if (result === 'ACCEPTED' || result === 'APPLIED') return 'applied';
  if (result === 'DUPLICATE') return 'already_applied';
  if (result === 'REJECTED') {
    if (reason === 'NOT_ACTIVE' || reason === 'EVENT_RESOLVED') return 'event_closed';
    if (reason === 'NOT_UPWARD' || reason === 'DUPLICATE') return 'already_applied';
    return 'rejected';
  }
  if (result === 'PENDING') return 'approved';

  const decision = item.decision?.toUpperCase();
  if (decision === 'REJECTED' || decision === 'REJECT') return 'rejected';
  if (decision === 'APPROVED' || decision === 'APPROVE' || decision === 'PENDING')
    return 'approved';

  return 'applied';
}

export const escalationStatusLabel = (item: EventEscalation): string =>
  ESCALATION_STATUS_LABEL[escalationStatus(item)];

/** 시간순(오래된 것 → 최신) 정렬. */
export function sortEscalations(items: readonly EventEscalation[]): EventEscalation[] {
  return [...items].sort(
    (a, b) =>
      (a.requested_at ?? 0) - (b.requested_at ?? 0) || (a.decided_at ?? 0) - (b.decided_at ?? 0),
  );
}

/**
 * 서버 이벤트의 escalations 와 방금 요청해 받은 응답 이력을 합쳐 시간순으로 돌려준다.
 * STOMP 로 같은 상향 건(escalation_id 또는 같은 assessmentId 의 승인 건)이 들어오면 서버 항목으로 합친다.
 */
export function mergedEscalations(
  event: EventItem,
  localHistory: readonly EventEscalation[] = [],
): EventEscalation[] {
  const serverItems = event.escalations ?? [];
  if (localHistory.length === 0) return sortEscalations(serverItems);
  const serverIds = new Set(
    serverItems.map((s) => s.escalation_id).filter((id): id is string => Boolean(id)),
  );
  const serverAssessments = new Set(
    serverItems.map(assessmentKeyOf).filter((id): id is string => Boolean(id)),
  );
  const remainingLocal = localHistory.filter((local) => {
    if (local.escalation_id && serverIds.has(local.escalation_id)) return false;
    const status = escalationStatus(local);
    if (status === 'approved' || status === 'applied') {
      const key = assessmentKeyOf(local);
      if (key && serverAssessments.has(key)) return false;
      if (
        !local.escalation_id &&
        serverItems.some((s) => s.target_severity === local.target_severity)
      ) {
        return false;
      }
    }
    return true;
  });
  return sortEscalations([...serverItems, ...remainingLocal]);
}

/** 지금 이벤트의 상향 의견이 이미 처리됐는지. 저널 일시 오류(JOURNAL_UNAVAILABLE)는 다시 시도할 수 있다. */
export function isProposalDecided(
  event: EventItem,
  localHistory: readonly EventEscalation[] = [],
): boolean {
  if (!event.proposed_severity || !isActive(event)) return true;
  const currentKey = String(resolveAssessmentId(event));
  if ((event.escalations ?? []).some((e) => assessmentKeyOf(e) === currentKey)) return true;
  return localHistory.some(
    (item) =>
      assessmentKeyOf(item) === currentKey &&
      item.reject_reason?.toUpperCase() !== 'JOURNAL_UNAVAILABLE',
  );
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && value in SEVERITY_LABEL;
}

/**
 * POST /api/events/{id}/escalation 응답을 이력 한 건으로 정규화한다.
 * 서버 응답 형식이 일부 비어 있어도 요청할 때의 정보로 채워 이력에 남긴다.
 */
export function normalizeEscalationResponse(
  data: unknown,
  fallback: {
    event: EventItem;
    assessmentId: string | number;
    decision: EscalationDecision;
    actorId?: string;
    note?: string;
    now: number;
  },
): EventEscalation {
  const raw = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  // 만약 응답에 escalations 배열이 들어 있으면 마지막 항목을 함께 참고한다.
  const nestedList = Array.isArray(raw.escalations) ? raw.escalations : undefined;
  const nestedLast =
    nestedList &&
    nestedList.length > 0 &&
    typeof nestedList.at(-1) === 'object' &&
    nestedList.at(-1) !== null
      ? (nestedList.at(-1) as Record<string, unknown>)
      : {};
  const merged = { ...nestedLast, ...raw };

  const escalationId =
    typeof merged.escalation_id === 'string'
      ? merged.escalation_id
      : typeof merged.escalationId === 'string'
        ? merged.escalationId
        : undefined;
  const targetSeverity = isSeverity(merged.target_severity)
    ? merged.target_severity
    : isSeverity(merged.targetSeverity)
      ? merged.targetSeverity
      : isSeverity(merged.proposed_severity)
        ? merged.proposed_severity
        : (fallback.event.proposed_severity ?? fallback.event.severity);
  const requestedAt =
    typeof merged.requested_at === 'number'
      ? merged.requested_at
      : typeof merged.requestedAt === 'number'
        ? merged.requestedAt
        : typeof merged.decided_at === 'number'
          ? merged.decided_at
          : typeof merged.decidedAt === 'number'
            ? merged.decidedAt
            : fallback.now;
  const decidedAt =
    typeof merged.decided_at === 'number'
      ? merged.decided_at
      : typeof merged.decidedAt === 'number'
        ? merged.decidedAt
        : null;
  const actorId =
    typeof merged.actor_id === 'string'
      ? merged.actor_id
      : typeof merged.actorId === 'string'
        ? merged.actorId
        : fallback.actorId;
  const note = typeof merged.note === 'string' && merged.note !== '' ? merged.note : fallback.note;
  const decision = typeof merged.decision === 'string' ? merged.decision : fallback.decision;
  const result =
    typeof merged.result === 'string'
      ? merged.result
      : nestedList && fallback.decision === 'APPROVED'
        ? 'ACCEPTED'
        : null;
  const rejectReason =
    typeof merged.reject_reason === 'string'
      ? merged.reject_reason
      : typeof merged.rejectReason === 'string'
        ? merged.rejectReason
        : null;
  const status = typeof merged.status === 'string' ? merged.status : undefined;

  return {
    ...(escalationId ? { escalation_id: escalationId } : {}),
    basis: 'VLM_PROPOSAL',
    assessment_job_id: String(fallback.assessmentId),
    assessmentId: fallback.assessmentId,
    target_severity: targetSeverity,
    channel: CONTROL_ROOM_CHANNEL,
    actor_role: 'ADMIN',
    ...(actorId ? { actor_id: actorId } : {}),
    requested_at: requestedAt,
    ...(decidedAt !== null ? { decided_at: decidedAt } : {}),
    ...(note ? { note } : {}),
    decision,
    result,
    reject_reason: rejectReason,
    ...(status ? { status } : {}),
  };
}
