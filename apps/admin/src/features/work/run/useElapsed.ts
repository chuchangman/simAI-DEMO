import { ec2Now } from '@/features/events/format';
import { useNow } from '@/features/layout/useNow';
import { formatDuration } from '@/features/work/reportForm';
import { workDurationMs } from '@/features/work/run/run';
import { useRealtimeStore } from '@/store/realtime.store';

/**
 * 작업을 시작한 뒤 흐른 시간('HH:MM:SS', 1초마다 바뀐다). 시작 시각(`actual_started_at`)은 EC2 시계라
 * 이 브라우저 시계에 EC2 와의 차이를 더해 잰다. 시작 기록이 없으면 '00:00:00'.
 */
export function useElapsed(startedAt: number | null): string {
  const now = useNow(1000);
  const clockOffsetMs = useRealtimeStore((s) => s.health?.clockOffsetMs);
  if (startedAt === null) return formatDuration(0);
  return formatDuration(workDurationMs(startedAt, null, ec2Now(now, clockOffsetMs)));
}
