import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * 3D Source 에 형상 응답을 넘길 때 다는 요청 시각(`requestedAt`)을 구한다. 조회를 시작한 시각을 응답 데이터와 짝지어 둔다.
 *
 * Source 는 채널을 비운(clearSnapshot·setScope) 시각보다 앞서 요청한 응답과, 더 늦게 요청한 응답을 이미 받은 뒤 온 응답을 버린다.
 * 그래서 응답이 도착한 시각(`dataUpdatedAt`)은 쓸 수 없다. 비운 뒤에 도착한 옛 요청의 응답이 새것으로 보인다.
 * 시계는 Source 의 `now()` 와 같은 `Date.now()` 다.
 *
 * 조회는 `useQuery` 가 구독하는 효과(passive)에서 시작하므로, 구독은 그보다 먼저 도는 레이아웃 효과에서 한다(첫 조회의 시작을 놓치지 않는다).
 * 돌려주는 함수는 지금 캐시에 있는 응답의 요청 시각이다. 직접 쓴 값(`setQueryData`)이나 구독 전에 받은 응답은 시작을 모르므로
 * 받은 시각을 쓴다(실제 요청 시각보다 늦은 값이라 늦은 응답을 거르는 쪽으로만 치우친다).
 */
export function useRequestedAt(queryKey: QueryKey): () => number | undefined {
  const queryClient = useQueryClient();
  const tracked = useRef<{ started: number | null; data: unknown; requestedAt: number }>({
    started: null,
    data: undefined,
    requestedAt: 0,
  });

  useLayoutEffect(() => {
    const hash = hashKey(queryKey);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.queryHash !== hash) return;
      const t = tracked.current;
      const { action } = event;
      if (action.type === 'fetch') {
        // 이미 받는 중이면 fetch 액션이 다시 오지 않는다. 새로 시작할 때만 온다.
        t.started = Date.now();
      } else if (action.type === 'success') {
        t.data = event.query.state.data;
        t.requestedAt = action.manual || t.started === null ? Date.now() : t.started;
        t.started = null;
      } else if (action.type === 'error') {
        t.started = null;
      }
    });
  }, [queryClient, queryKey]);

  return useCallback(() => {
    const data = queryClient.getQueryData(queryKey);
    if (data === undefined) return undefined;
    return data === tracked.current.data
      ? tracked.current.requestedAt
      : queryClient.getQueryState(queryKey)?.dataUpdatedAt;
  }, [queryClient, queryKey]);
}
