import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { SUMMARY_ERROR_CODE, SUMMARY_STATUS_LABEL } from '@/features/events/constants';
import type { EventItem, EventSummary, EventSummaryStatus } from '@/features/events/types';
import { ApiError, NETWORK_ERROR } from '@/lib/http';
import type { Role } from '@/store/session.store';

// 사고 구간 요약(incident_summary) 요청 권한, 상태 판정, 최신 요약 선택, 실패 문구(명세 5.4, 12.5, 12.6, FR-88, S15P31A101-368).

const SUMMARY_STATUS_RANK: Record<EventSummaryStatus, number> = {
  QUEUED: 0,
  RUNNING: 1,
  SUCCEEDED: 2,
  FAILED: 2,
  TIMED_OUT: 2,
};

const SUMMARY_ERROR_TEXT: Record<string, string> = {
  [SUMMARY_ERROR_CODE.CLIP_NOT_READY]: '클립이 아직 준비되지 않았습니다',
  [SUMMARY_ERROR_CODE.EVENT_NOT_LIVE]: '실시간(LIVE) 이벤트에서만 구간 요약을 요청할 수 있습니다',
  [SUMMARY_ERROR_CODE.NOT_FOUND]: '이벤트를 찾을 수 없습니다',
  [SUMMARY_ERROR_CODE.CLIP_FETCH_FAILED]: '이벤트 클립을 받지 못해 요약하지 못했습니다',
  [SUMMARY_ERROR_CODE.NO_FACE_SAFE_FRAMES]: '요약할 수 있는 영상 프레임이 없습니다',
  [SUMMARY_ERROR_CODE.VLM_ANSWER_INVALID]: 'AI 요약 결과를 읽지 못했습니다',
  [SUMMARY_ERROR_CODE.VLM_INPUT_INVALID]: '요약 입력 형식이 올바르지 않습니다',
  [SUMMARY_ERROR_CODE.VLM_TIMEOUT]: '구간 요약 시간이 초과되었습니다',
  [SUMMARY_ERROR_CODE.VLM_UNAVAILABLE]: 'AI 요약 서버에 연결할 수 없습니다',
  [SUMMARY_ERROR_CODE.VLM_REQUEST_REJECTED]: 'AI 요약 요청이 거부되었습니다',
  [SUMMARY_ERROR_CODE.VLM_CONFIG]: 'AI 요약 설정이 올바르지 않습니다',
  [SUMMARY_ERROR_CODE.CANCELLED]: '구간 요약 작업이 취소되었습니다',
  [SUMMARY_ERROR_CODE.TIMED_OUT]: '구간 요약 시간이 초과되었습니다',
};

const SUMMARY_REQUEST_FAILED_TEXT = '구간 요약을 요청하지 못했습니다';
const SUMMARY_FAILED_TEXT = '구간 요약에 실패했습니다';
const SUMMARY_TIMED_OUT_TEXT = '구간 요약 시간이 초과되었습니다';

/** POST /api/events/{id}/summary 호출 실패를 화면 문구로 바꾼다. */
export function summaryErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return SUMMARY_REQUEST_FAILED_TEXT;
  if (error.status === NETWORK_ERROR) return '서버에 연결할 수 없습니다';
  const text = error.code === undefined ? undefined : SUMMARY_ERROR_TEXT[error.code];
  if (text) return text;
  if (error.status >= 400 && error.status < 500 && error.serverMessage) return error.serverMessage;
  return SUMMARY_REQUEST_FAILED_TEXT;
}

/** summaries 항목의 FAILED·TIMED_OUT 상태를 오류 코드에 맞는 문구로 바꾼다. */
export function summaryFailureMessage(summary: EventSummary): string {
  if (summary.error_code) {
    const mapped = SUMMARY_ERROR_TEXT[summary.error_code];
    if (mapped) return mapped;
  }
  if (summary.status === 'TIMED_OUT') return SUMMARY_TIMED_OUT_TEXT;
  if (summary.error_code) return `${SUMMARY_FAILED_TEXT} (${summary.error_code})`;
  return SUMMARY_FAILED_TEXT;
}

/** 구간 요약 요청 권한: 관리자(ADMIN)만(명세 12.6). */
export function useCanRequestSummary(): boolean {
  return useCurrentRole() === 'ADMIN';
}

/** 구간 요약 요청 버튼 표시 조건: 관리자(ADMIN)이고 LIVE 이벤트일 때만. */
export function canRequestSummary(event: EventItem, role: Role | null | undefined): boolean {
  return role === 'ADMIN' && event.source === 'LIVE';
}

export function isSummaryInProgress(
  summary: EventSummary | undefined,
): summary is EventSummary & { status: 'QUEUED' | 'RUNNING' } {
  return summary !== undefined && (summary.status === 'QUEUED' || summary.status === 'RUNNING');
}

export function isSummaryFailed(
  summary: EventSummary | undefined,
): summary is EventSummary & { status: 'FAILED' | 'TIMED_OUT' } {
  return summary !== undefined && (summary.status === 'FAILED' || summary.status === 'TIMED_OUT');
}

export const summaryStatusLabel = (status: EventSummaryStatus): string =>
  SUMMARY_STATUS_LABEL[status];

export interface LocalSummaryRecord {
  item: EventSummary;
  /** 요청을 보낼 때 event.summaries 에 이미 있던 summary_id 집합. */
  baseSummaryIds: ReadonlySet<number>;
  /** 요청을 보낼 때의 event.summaries 참조. */
  seenSummariesRef: EventItem['summaries'];
}

const bySummaryNewest = (a: EventSummary, b: EventSummary) =>
  b.requested_at - a.requested_at || b.summary_id - a.summary_id;

/**
 * 이벤트의 summaries(최신순)와 방금 POST 응답으로 받은 대기·실행 상태를 합쳐 최신 요약 한 건을 고른다.
 * STOMP(/topic/events)로 같은 요약 건의 진행·완료·실패 상태나 더 새 요약 건이 도착하면 서버 항목을 따른다.
 */
export function latestSummary(
  event: EventItem,
  local?: LocalSummaryRecord,
): EventSummary | undefined {
  const serverList = event.summaries ?? [];
  const sorted = serverList.length > 1 ? [...serverList].sort(bySummaryNewest) : serverList;
  const serverLatest = sorted[0];
  if (!local) return serverLatest;
  if (!serverLatest) return local.item;

  const matching = sorted.find(
    (s) =>
      s.summary_id === local.item.summary_id ||
      (local.item.job_id !== '' && s.job_id === local.item.job_id),
  );
  if (matching) {
    return SUMMARY_STATUS_RANK[matching.status] >= SUMMARY_STATUS_RANK[local.item.status]
      ? serverLatest
      : local.item;
  }

  const hasNewServerSummary = sorted.some((s) => !local.baseSummaryIds.has(s.summary_id));
  if (hasNewServerSummary && event.summaries !== local.seenSummariesRef) {
    return serverLatest;
  }

  return local.item;
}

function isSummaryStatus(value: unknown): value is EventSummaryStatus {
  return typeof value === 'string' && value in SUMMARY_STATUS_LABEL;
}

/**
 * POST /api/events/{id}/summary 의 202·200 응답({ summary_id, job_id, status })을 대기·실행 상태 기록으로 정규화한다.
 */
export function normalizeSummaryResponse(
  data: unknown,
  fallback: {
    event: EventItem;
    now: number;
  },
): LocalSummaryRecord {
  const raw = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const existing = fallback.event.summaries ?? [];
  const baseIds = new Set(existing.map((s) => s.summary_id));
  const maxExistingId = existing.reduce((max, s) => Math.max(max, s.summary_id), 0);
  const maxExistingTime = existing.reduce((max, s) => Math.max(max, s.requested_at), 0);

  const summaryId =
    typeof raw.summary_id === 'number' && Number.isFinite(raw.summary_id)
      ? raw.summary_id
      : typeof raw.summaryId === 'number' && Number.isFinite(raw.summaryId)
        ? raw.summaryId
        : maxExistingId + 1;
  const jobId =
    typeof raw.job_id === 'string' && raw.job_id !== ''
      ? raw.job_id
      : typeof raw.jobId === 'string' && raw.jobId !== ''
        ? raw.jobId
        : `job-summary-${summaryId}`;
  const status: EventSummaryStatus = isSummaryStatus(raw.status) ? raw.status : 'QUEUED';
  const requestedAt =
    typeof raw.requested_at === 'number' && Number.isFinite(raw.requested_at)
      ? raw.requested_at
      : Math.max(fallback.now, maxExistingTime + 1);

  return {
    item: {
      summary_id: summaryId,
      job_id: jobId,
      status,
      requested_at: requestedAt,
      finished_at: typeof raw.finished_at === 'number' ? raw.finished_at : null,
      summary: typeof raw.summary === 'string' ? raw.summary : null,
      evidence_timestamps_ms: Array.isArray(raw.evidence_timestamps_ms)
        ? raw.evidence_timestamps_ms.filter((t): t is number => typeof t === 'number')
        : [],
      window_start_ms: typeof raw.window_start_ms === 'number' ? raw.window_start_ms : null,
      window_end_ms: typeof raw.window_end_ms === 'number' ? raw.window_end_ms : null,
      error_code: typeof raw.error_code === 'string' ? raw.error_code : null,
    },
    baseSummaryIds: baseIds,
    seenSummariesRef: fallback.event.summaries,
  };
}
