import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { formatTime } from '@/features/events/format';
import {
  canRequestSummary,
  isSummaryFailed,
  isSummaryInProgress,
  latestSummary,
  summaryFailureMessage,
  summaryStatusLabel,
} from '@/features/events/summary';
import type { EventItem } from '@/features/events/types';
import { useIncidentSummary } from '@/features/events/useIncidentSummary';
import { Badge } from '@simai/ui/components/badge';
import { Button } from '@simai/ui/components/button';

export interface IncidentSummaryControlProps {
  event: EventItem;
  /** 근거 시각을 눌렀을 때 그 시각으로 이동하는 콜백. 없으면 표시만 한다. */
  onSeekTimestamp?: (timestampMs: number) => void;
}

/**
 * 사고 구간 요약(incident_summary) 요청·상태·결과 표시부(명세 5.4, 12.6, FR-88, S15P31A101-368).
 * - 요청·다시 요청 버튼은 관리자(ADMIN)이고 LIVE 이벤트일 때만 보인다.
 * - 진행 중(QUEUED·RUNNING)이면 버튼 대신 상태(대기·실행 중)를 보인다.
 * - 완료(SUCCEEDED)되면 최신 요약 문장과 근거 시각 목록, AI 설명 표시를 보인다.
 * - 실패·시간 초과(FAILED·TIMED_OUT)는 오류 코드에 맞는 문구와 다시 요청 버튼을 보인다.
 * - 요약은 AI 설명일 뿐 이벤트 등급 배지·경보에는 영향을 주지 않는다(AGENTS 규칙 4).
 */
export function IncidentSummaryControl({ event, onSeekTimestamp }: IncidentSummaryControlProps) {
  const role = useCurrentRole();
  const canRequest = canRequestSummary(event, role);
  const { requestSummary, pending, error, errorSummariesRef, localRecord } = useIncidentSummary(
    event.event_id,
  );
  const latest = latestSummary(event, localRecord);
  const activeError = error && errorSummariesRef === event.summaries ? error : undefined;

  if (isSummaryInProgress(latest)) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline">AI 설명</Badge>
        <span role="status" className="text-muted-foreground">
          {summaryStatusLabel(latest.status)}
        </span>
      </div>
    );
  }

  if (latest?.status === 'SUCCEEDED') {
    return (
      <div role="group" aria-label="사고 구간 요약" className="flex flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-muted-foreground">구간 요약</span>
          <Badge variant="outline">AI 설명</Badge>
          {latest.window_start_ms !== null && latest.window_end_ms !== null && (
            <span className="font-mono text-faint">
              {formatTime(latest.window_start_ms)} ~ {formatTime(latest.window_end_ms)}
            </span>
          )}
        </div>
        {latest.summary && <p>{latest.summary}</p>}
        {latest.evidence_timestamps_ms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">근거 시각</span>
            <ul aria-label="근거 시각" className="flex flex-wrap items-center gap-1">
              {latest.evidence_timestamps_ms.map((ts) => (
                <li key={ts}>
                  {onSeekTimestamp ? (
                    <button
                      type="button"
                      onClick={() => onSeekTimestamp(ts)}
                      className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs hover:bg-surface-3/70"
                    >
                      {formatTime(ts)}
                    </button>
                  ) : (
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs">
                      {formatTime(ts)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (isSummaryFailed(latest)) {
    const failureText = activeError ?? summaryFailureMessage(latest);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span role="alert" className="text-xs text-sev-critical">
            {failureText}
          </span>
          {canRequest && (
            <Button
              size="xs"
              variant="secondary"
              disabled={pending}
              onClick={() => requestSummary(event)}
            >
              {pending ? '요청 중…' : '다시 요청'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!canRequest) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="xs"
          variant="secondary"
          disabled={pending}
          onClick={() => requestSummary(event)}
        >
          {pending ? '요청 중…' : '구간 요약 요청'}
        </Button>
      </div>
      {activeError && (
        <span role="alert" className="text-xs text-sev-critical">
          {activeError}
        </span>
      )}
    </div>
  );
}
