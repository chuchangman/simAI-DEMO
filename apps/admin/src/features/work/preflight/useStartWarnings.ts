import { useTier0Link } from '@/features/monitor/useMonitoringPhase';
import { usePpeReceipt } from '@/features/ppe/usePpeReceipt';
import type { StartPpe } from '@/features/work/api';
import { startWarnings } from '@/features/work/preflight/preflight';
import { useLinkAlive } from '@/hooks/useLinkAlive';
import { useRealtimeStore } from '@/store/realtime.store';

/**
 * 작업 전 확인 창의 경고 줄(S15P31A101-730). 서버가 이미 주는 상태만 쓴다: PPE 마지막 수신 시각(GET /api/ppe/current),
 * Tier 0·현장 노트북 연결과 연결된 워치 수(/topic/health). 창이 열려 있을 때만 PPE 수신을 묻는다.
 * health 는 1초마다 새 객체라 숫자·불리언만 구독한다.
 */
export function useStartWarnings(ppe: StartPpe, open: boolean): string[] {
  const ppeReceipt = usePpeReceipt(open);
  const tier0 = useTier0Link();
  const alive = useLinkAlive();
  const watchesConnected = useRealtimeStore((s) =>
    alive ? (s.health?.payload.watches?.connected ?? null) : null,
  );
  const laptopConnected = useRealtimeStore((s) => {
    const link = alive ? s.health?.payload.laptop?.link : undefined; // 일부만 채운 health(시험·이전 EC2)도 견딘다
    return link === undefined ? null : link === 'CONNECTED';
  });
  return startWarnings({ ppe, ppeReceipt, tier0, watchesConnected, laptopConnected });
}
