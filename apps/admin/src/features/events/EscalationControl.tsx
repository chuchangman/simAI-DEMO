import { SEVERITY_LABEL } from '@/features/events/constants';
import { isActive } from '@/features/events/entries';
import { isProposalDecided, useCanEscalate } from '@/features/events/escalation';
import { eventRuleName } from '@/features/events/format';
import { SeverityBadge } from '@/features/events/SeverityBadge';
import type { EscalationDecision, EventItem } from '@/features/events/types';
import { useEscalateEvent } from '@/features/events/useEscalateEvent';
import { Button } from '@simai/ui/components/button';
import { useEffect, useRef, useState } from 'react';

/**
 * VLM 상향 의견 승인·거절 조작부(명세 5.4, 12.6, 13장).
 * 관리자(ADMIN)이고 활성 이벤트에 상향 의견(proposed_severity)이 있을 때만 보인다.
 * 누르면 확인 대화상자를 거쳐 POST /api/events/{id}/escalation 을 호출한다.
 */
export function EscalationControl({ event }: { event: EventItem }) {
  const canEscalate = useCanEscalate();
  const { escalate, pending, error, localItems } = useEscalateEvent(event.event_id);
  const [confirming, setConfirming] = useState<EscalationDecision | null>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      setConfirming(null);
    }
    wasPending.current = pending;
  }, [pending]);

  if (!canEscalate || !event.proposed_severity || !isActive(event)) return null;

  const proposed = event.proposed_severity;
  const decided = isProposalDecided(event, localItems);
  const locked = pending || decided;
  const dialogDecision = decided ? null : confirming;
  const isApprove = dialogDecision === 'APPROVED';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={locked} onClick={() => setConfirming('APPROVED')}>
          {pending && confirming === 'APPROVED' ? '승인 중…' : '승인'}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          disabled={locked}
          onClick={() => setConfirming('REJECTED')}
        >
          {pending && confirming === 'REJECTED' ? '거절 중…' : '거절'}
        </Button>
      </div>

      {dialogDecision && (
        <div
          role="alertdialog"
          aria-label={isApprove ? '상향 의견 승인 확인' : '상향 의견 거절 확인'}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !pending) {
              e.stopPropagation();
              setConfirming(null);
            }
          }}
          className="flex flex-col gap-2 rounded-[10px] bg-background p-3 text-xs ring-1 ring-border"
        >
          <p className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
            <span>{eventRuleName(event)} 상향 의견</span>
            <SeverityBadge severity={proposed} />
            <span>
              {isApprove
                ? `(${SEVERITY_LABEL[proposed]}) 등급 상향을 승인하시겠습니까?`
                : `(${SEVERITY_LABEL[proposed]}) 상향 의견을 거절하시겠습니까?`}
            </span>
          </p>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="secondary"
              size="xs"
              disabled={pending}
              onClick={() => setConfirming(null)}
            >
              취소
            </Button>
            <Button
              variant={isApprove ? 'default' : 'destructive'}
              size="xs"
              disabled={pending}
              onClick={() => escalate(event, dialogDecision)}
            >
              {pending
                ? isApprove
                  ? '승인 중…'
                  : '거절 중…'
                : isApprove
                  ? '승인 확인'
                  : '거절 확인'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <span role="alert" className="text-xs text-sev-critical">
          {error}
        </span>
      )}
    </div>
  );
}
