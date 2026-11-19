import {
  autoStopText,
  disabledFeatureNotices,
  formatElapsed,
  formatRegion,
  formatUsd,
  gpuErrorReason,
  gpuSummary,
  hostCpuWarning,
  PREP_STEPS,
  prepRemainingText,
  prepStep,
} from '@/features/gpu/gpuStatus';
import { useCachedGpuIdleMinutes, useGpuStatus } from '@/features/gpu/useGpu';
import { useNow } from '@/features/layout/useNow';
import { useTier0Connected } from '@/hooks/useTier0Connected';
import { isLagHigh, LAG_OK_MS, LAG_WARN_MS, LAG_WINDOW_MS } from '@/lib/tier0Lag';
import { selectTier0LagMs, useRealtimeStore } from '@/store/realtime.store';
import { cn } from '@simai/ui/lib/utils';

// GPU 정보 줄(S15P31A101-702, -733): 짧은 GPU 이름·지역(나라+코드), 경과·예상 비용·시간당 단가($/h), 자동 정지까지 남은 시간,
// 판정 지연(-704 의 상단바 「판정 지연」을 여기로 옮김, hover 설명은 CCTV 배지와 같음),
// 준비 중이면 단계(켜는 중 → 가중치 → 엔진 → 준비 완료)와 예상 남은 시간, 오류면 까닭. 모르는 줄은 뺀다(지어내지 않음).
// 상단바 점의 마우스 올림 정보창과 켜기·끄기 패널이 함께 쓴다.

/** CCTV 배지 설명(features/cctv/CctvPage.tsx CameraBadge)과 같은 형식의 판정 지연 hover 설명(S15P31A101-733) */
export const TIER0_LAG_TOOLTIP = `판정 지연: 이 카메라가 찍은 뒤 위험 판정(Tier 0)까지 걸린 시간, 최근 ${LAG_WINDOW_MS / 1000}초 평균. ${LAG_OK_MS} ms 미만 초록, ${LAG_WARN_MS} ms 이상 빨강`;

export function GpuInfoLines() {
  const { status, clockOffsetMs } = useGpuStatus();
  const idleMinutes = useCachedGpuIdleMinutes();
  const now = useNow();
  const serverNow = now + clockOffsetMs;
  const summary = gpuSummary(status, serverNow);
  const step = prepStep(status);
  const remaining = prepRemainingText(status);
  const autoStop = autoStopText(status, serverNow, idleMinutes);
  const reason = gpuErrorReason(status);
  const cpuWarning = hostCpuWarning(status);
  const disabled = disabledFeatureNotices(status);
  return (
    <div className="flex flex-col gap-1 text-sm">
      {summary && (
        <>
          <span>
            {summary.gpuType}
            {summary.region ? ` · ${formatRegion(summary.region)}` : ''}
          </span>
          <span className="text-muted-foreground">
            경과 {formatElapsed(summary.elapsedMs)}
            {summary.costUsd !== null && ` · 약 ${formatUsd(summary.costUsd)}`}
            {summary.pricePerHourUsd !== null && ` (${formatUsd(summary.pricePerHourUsd)}/h)`}
          </span>
        </>
      )}
      {autoStop && <span className="text-xs text-muted-foreground">{autoStop}</span>}
      <Tier0LagLine />
      {step !== null && (
        <>
          <ol aria-label="준비 단계" className="flex flex-wrap items-center gap-1 text-xs">
            {PREP_STEPS.map((name, i) => (
              <li
                key={name}
                aria-current={i === step ? 'step' : undefined}
                className={cn(i === step ? 'font-semibold' : 'text-muted-foreground')}
              >
                {i > 0 && <span aria-hidden> → </span>}
                {name}
              </li>
            ))}
          </ol>
          {remaining && <span className="text-xs text-muted-foreground">{remaining}</span>}
        </>
      )}
      {reason && <span>{reason}</span>}
      {cpuWarning && (
        <span role="status" className="text-xs font-semibold text-delay">
          {cpuWarning}
        </span>
      )}
      {disabled.warnings.map((n) => (
        <div key={n.key} role="status" className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-delay">{n.text}</span>
          {n.detail && <NoticeDetail detail={n.detail} />}
        </div>
      ))}
      {disabled.infos.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            참고 {disabled.infos.length}건(의도된 설정·지나간 일)
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {disabled.infos.map((n) => (
              <li key={n.key}>
                {n.text}
                {n.detail && <NoticeDetail detail={n.detail} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** 쉬운 말 항목의 원문(예외 문구·설정 키)을 「자세히」로 접어 둔다(S15P31A101-756) */
function NoticeDetail({ detail }: { detail: string }) {
  return (
    <details className="text-xs font-normal text-muted-foreground">
      <summary className="cursor-pointer">자세히</summary>
      <span className="font-mono break-all">{detail}</span>
    </details>
  );
}

/**
 * 판정 지연(S15P31A101-665, 이름은 -704, 자리는 -702 의 GPU 정보창). Tier 0 가 자기 시계로 잰 T_lag 의 최근 몇 초 평균이다.
 * Tier 0 가 이어지지 않았거나 Tier 0 가 모른다고 하면 줄을 뺀다. 기준(명세 6.1 DEGRADED) 이상이면 지연 색이다.
 */
export function Tier0LagLine() {
  const connected = useTier0Connected();
  const lag = useRealtimeStore(selectTier0LagMs);
  if (!connected || lag === undefined) return null;
  return (
    <span
      title={TIER0_LAG_TOOLTIP}
      className={cn(
        'font-mono',
        isLagHigh(lag) ? 'font-semibold text-delay' : 'text-muted-foreground',
      )}
    >
      판정 지연 {lag} ms
    </span>
  );
}
