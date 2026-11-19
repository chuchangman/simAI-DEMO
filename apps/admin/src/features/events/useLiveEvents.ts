import { useIsDemoAccount } from '@/features/demo/demoAccount';
import { demoLiveEntries } from '@/features/demo/demoPpe';
import { requestEvents } from '@/features/events/api';
import { upsertEvents, type EventEntry } from '@/features/events/entries';
import { LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

const NONE: EventEntry[] = [];

/** 목록을 받지 못했을 때 다시 시도하는 간격(ms). */
const RELOAD_MS = 10_000;

/** 열람 계정이 목록을 요청했을 때 서버가 거절하는 상태 코드. */
const HTTP_FORBIDDEN = 403;

const isLoaded = (data: LiveEvents | undefined) => data?.loaded ?? false;

/**
 * REST 목록을 받는다. 열람 계정은 목록 권한이 없어(403) 서버가 거절한다. 그때는 목록에서 받을 것이 없다는 뜻이라
 * 실패로 보지 않고(다시 시도하지도, 오류 띠를 띄우지도 않는다) STOMP 로 받은 것만 쓴다.
 */
async function loadEvents(signal: AbortSignal): Promise<EventItem[]> {
  try {
    return (await requestEvents(api, signal)).content;
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_FORBIDDEN) return [];
    throw error;
  }
}

/**
 * 관제 화면 LIVE 이벤트. 처음은 REST 로 받고, 이후는 /topic/events 가 캐시를 갱신한다(eventsCache).
 * - loaded: 목록을 받아 합쳤는지. false 면 STOMP 로 받은 것만 있어 빠진 경보가 있을 수 있다.
 * - failed: 목록을 아직 못 받았고 마지막 시도가 실패했다. 받을 때까지 RELOAD_MS 마다 다시 시도한다.
 */
export function useLiveEvents() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: LIVE_EVENTS_KEY,
    // 목록을 받는 사이 STOMP 로 먼저 온 새 상태가 있으면 지우지 않고 순서대로 합친다.
    queryFn: async ({ signal }): Promise<LiveEvents> => {
      const content = await loadEvents(signal);
      // 받은 뒤에 읽는다. 여러 쪽을 받는 사이 STOMP 로 온 것(끊겼다 이어진 직후 등)이 지워지지 않는다.
      const old = queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY);
      return { ...old, entries: upsertEvents(old?.entries ?? [], content), loaded: true };
    },
    // 목록을 받은 뒤에는 실시간으로 갱신되므로 저절로 다시 받지 않는다(재연결 때만).
    // STOMP 가 먼저 캐시를 채웠어도 목록을 받기 전이면 오래된 것으로 보고 받는다.
    staleTime: (q) => (isLoaded(q.state.data) ? Infinity : 0),
    refetchInterval: (q) => (isLoaded(q.state.data) ? false : RELOAD_MS),
    // 관제 탭이 뒤에 있어도 목록을 채운다.
    refetchIntervalInBackground: true,
  });
  const loaded = isLoaded(query.data);
  const all = query.data?.entries ?? NONE;
  // 시연 계정은 조끼 이벤트와 보호구 「모름」 이유를 화면에 보이지 않는다(캐시는 그대로, features/demo/demoPpe)
  const demo = useIsDemoAccount();
  const entries = useMemo(() => (demo ? demoLiveEntries(all) : all), [demo, all]);
  return {
    entries,
    loaded,
    // STOMP 가 캐시를 고쳐도 실패 횟수는 남는다. 다음 시도가 시작되면 0 이 된다.
    failed: !loaded && !query.isFetching && query.failureCount > 0,
  };
}
