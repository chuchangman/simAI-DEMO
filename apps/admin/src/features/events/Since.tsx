import { ec2Now, elapsedLabel } from '@/features/events/format';
import { useSharedNow } from '@/features/events/useSharedNow';
import { useRealtimeStore } from '@/store/realtime.store';

/** 발생 뒤 경과("12초 전"). 매 초 바뀌므로 카드·배너 전체가 아니라 이 칸만 다시 그린다. EC2 시계 기준이다. */
export function Since({ raisedAt, className }: { raisedAt: number; className?: string }) {
  const now = useSharedNow();
  const offset = useRealtimeStore((s) => s.health?.clockOffsetMs);
  return <span className={className}>{elapsedLabel(ec2Now(now, offset) - raisedAt)} 전</span>;
}
