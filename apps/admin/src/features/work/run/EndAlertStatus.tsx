import { ENDED_LABEL } from '@/features/monitor/monitoringPhase';
import { MonitoringBadge, MonitoringStatus } from '@/features/monitor/MonitoringStatus';
import { useWorkEndPhase } from '@/features/monitor/useMonitoringPhase';

// 작업 종료 뒤 현장 경보가 실제로 꺼졌는지(S15P31A101-692). 종료 API 성공(DB DONE)과 Tier 0 의 종료 묶음 적용(config_ack APPLIED,
// 열린 이벤트 해소·현장 경보 끔) 사이 시간차를 구분해 보인다: 「종료 요청됨 · 현장 경보 끄는 중」 → 「현장 경보 종료 확인」.

export function EndAlertStatus({ workId, endedAt }: { workId: string; endedAt: number | null }) {
  const phase = useWorkEndPhase({ work_id: workId, endedAt });
  if (phase.stage === 'unknown') return null;
  return (
    <section
      aria-label="현장 경보 종료"
      className="rounded-[12px] bg-card px-4 py-3 ring-1 ring-border ring-inset"
    >
      {phase.stage === 'ending' ? (
        <MonitoringStatus phase={phase} />
      ) : (
        <MonitoringBadge
          text={{ label: ENDED_LABEL, tone: 'ok', what: null, how: null, retry: false }}
        />
      )}
    </section>
  );
}
