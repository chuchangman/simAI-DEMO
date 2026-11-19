import {
  formatElapsed,
  gpuSummary,
  vlmReadiness,
  type VlmReadiness,
} from '@/features/gpu/gpuStatus';
import { useGpuStatus } from '@/features/gpu/useGpu';
import { useNow } from '@/features/layout/useNow';
import { setupZoneDraftsKey } from '@/features/setup/api';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, H2, NOTE } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

// 구역 단계의 VLM 준비 안내(S15P31A101-706, 사용자 결정 2026-11-14). VLM 가중치(31.5GB)는 GPU 부팅 때 뒤에서 받는다.
// 구역 단계에 들어왔는데 GPU 세션 단계가 VLLM 이면 「AI 모델(VLM) 준비 중입니다」 창을 크게 띄우고, READY 가 되면 저절로 닫고
// AI 구역 초안을 다시 받는다. READY 인데 vLLM 이 시한 안에 안 떴으면 「AI 초안 없이 직접 구역을 만드세요」를 한 번 띄운다.
// 「직접 구역 만들기」(또는 Esc)로 닫으면 이 세팅 세션에서는 다시 띄우지 않는다(기다리지 않고 손으로 그린다).
// 세션이 없거나(손으로 켠 GPU) 관리자가 아니어서 상태를 모르면 아무것도 띄우지 않는다(vlmReadiness UNKNOWN).
// 초안 작업은 서버가 미리보기 맵이 생기면 넣고 워커는 VLM 없이도 기하 후보(AI 의견 없음)를 내므로 화면이 미루거나 다시 넣지 않는다
// (docs/design/S15P31A101-706-vlm-loading-modal.md).

export function VlmZoneNotice({
  active,
  sessionId,
}: {
  /** 구역 단계이고 이 브라우저가 고치는 세팅 세션(완료 전)일 때만 true */
  active: boolean;
  sessionId: string | null;
}) {
  const { status } = useGpuStatus();
  const readiness = vlmReadiness(status);
  const queryClient = useQueryClient();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const previous = useRef<VlmReadiness>(readiness);

  // VLM 이 준비되면 AI 구역 초안을 다시 받는다(창은 LOADING 이 아니게 되어 저절로 닫힌다)
  useEffect(() => {
    const was = previous.current;
    previous.current = readiness;
    if (was === 'LOADING' && readiness === 'READY' && active && sessionId) {
      void queryClient.invalidateQueries({ queryKey: setupZoneDraftsKey(sessionId) });
    }
  }, [readiness, active, sessionId, queryClient]);

  if (!active || !sessionId || dismissedFor === sessionId) return null;
  const dismiss = () => setDismissedFor(sessionId);
  if (readiness === 'LOADING') return <VlmLoadingModal onManual={dismiss} />;
  if (readiness === 'TIMED_OUT') return <VlmTimedOutModal onManual={dismiss} />;
  return null;
}

function VlmLoadingModal({ onManual }: { onManual: () => void }) {
  return (
    <ModalDialog
      label="AI 모델(VLM) 준비 중"
      onClose={onManual}
      className="w-[min(560px,calc(100vw-48px))]"
    >
      <div className="flex flex-col gap-3 px-5 py-[18px]" data-testid="vlm-loading">
        <h2 className={H2}>AI 모델(VLM) 준비 중입니다</h2>
        <p className="text-sm text-foreground">
          AI 구역 초안에 쓰는 VLM 가중치(약 31.5GB)를 GPU 가 받는 중입니다. 준비되면 이 창이 저절로
          닫히고 AI 구역 초안을 보여 드립니다.
        </p>
        <VlmProgressLines />
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <p className={NOTE}>기다리지 않고 손으로 그려도 됩니다.</p>
          <Button onClick={onManual} className={ACTION}>
            직접 구역 만들기
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}

/** 지금 응답에 있는 진행 정보만: 단계 설명(stage_detail)과 GPU 를 켠 뒤 경과. 모르면 줄을 뺀다 */
function VlmProgressLines() {
  const { status, clockOffsetMs } = useGpuStatus();
  const now = useNow();
  const detail = status?.session?.stage_detail;
  const summary = gpuSummary(status, now + clockOffsetMs);
  if (!detail && !summary) return null;
  return (
    <div role="status" className="flex flex-col gap-0.5 text-[13px] text-muted-foreground">
      {detail && <span>{detail}</span>}
      {summary && <span>GPU 켠 뒤 {formatElapsed(summary.elapsedMs)}</span>}
    </div>
  );
}

function VlmTimedOutModal({ onManual }: { onManual: () => void }) {
  return (
    <ModalDialog
      label="AI 초안 없이 진행"
      onClose={onManual}
      className="w-[min(560px,calc(100vw-48px))]"
    >
      <div className="flex flex-col gap-3 px-5 py-[18px]" data-testid="vlm-timed-out">
        <h2 className={H2}>AI 초안 없이 직접 구역을 만드세요</h2>
        <p className="text-sm text-foreground">
          AI 모델(VLM)이 준비 시한 안에 뜨지 않았습니다. 관제는 그대로 되지만 구역 후보에 AI
          의견(이름·등급)이 없고, 경보의 AI 근거·보고서도 나오지 않습니다.
        </p>
        <div className="flex justify-end border-t border-border pt-3">
          <Button onClick={onManual} className={ACTION}>
            직접 구역 만들기
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
