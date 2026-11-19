import { useLinkAlive } from '@/hooks/useLinkAlive';
import { useRealtimeStore } from '@/store/realtime.store';

/**
 * Tier 0(GPU)가 EC2 와 이어져 있는지. EC2 와 이어져 있고(health 3초 안) 그 health 의 tier0_link 가 CONNECTED 일 때만 참이다
 * (viewer_health.tier0_link, 명세 12.4). GPU 를 꺼 둔 정상 상태도 거짓이다. 거짓이면 지연·카메라 끊김을 보이지 않는다
 * (S15P31A101-704: GPU 가 꺼져 있을 때 「끊김」이 오류처럼 보였다).
 */
export function useTier0Connected(): boolean {
  const alive = useLinkAlive();
  const connected = useRealtimeStore((s) => s.health?.payload.tier0_link === 'CONNECTED');
  return alive && connected;
}
