import { requestHealth } from '@/features/layout/api';
import { api } from '@/lib/api';
import { useRealtimeStore } from '@/store/realtime.store';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * 연결이 (다시) 열릴 때마다 지금 System Health 를 한 번 받아 채운다(명세 FR-5, 12.6 GET /api/health).
 * /topic/health 는 1초마다 오므로, 그 전까지 상단 바·시스템 상태가 비지 않게 한다.
 * 그 사이 더 새 health 를 받았으면 덮지 않고(seedHealth), 실패하면 /topic/health 를 기다린다(알리지 않는다).
 */
export function useHealthSnapshot() {
  const openedAt = useRealtimeStore((s) => (s.phase === 'OPEN' ? s.openedAt : null));
  const { data } = useQuery({
    queryKey: ['health', 'snapshot', openedAt],
    queryFn: async ({ signal }) => {
      const startedAt = Date.now();
      const message = await requestHealth(api, signal);
      return { message, startedAt, finishedAt: Date.now() };
    },
    enabled: openedAt !== null,
    // 연결마다 한 번만 받는다. 그 뒤는 /topic/health 가 갱신한다.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!data) return;
    const { message, startedAt, finishedAt } = data;
    useRealtimeStore.getState().seedHealth({
      payload: message.payload,
      // 받은 시각은 요청을 보낸 때로 둔다. 응답이 늦어도 연결 판정(isLinkAlive)을 늘리지 않고,
      // 데이터 연령은 넉넉하게(늦게 받은 만큼 더 오래된 것으로) 잡힌다.
      receivedAt: startedAt,
      // EC2 가 응답을 만든 때(sent_at)는 요청과 응답 사이 어딘가다. 가운데로 잡는다.
      clockOffsetMs: message.sent_at - (startedAt + finishedAt) / 2,
    });
  }, [data]);
}
