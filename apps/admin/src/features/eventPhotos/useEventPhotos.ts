import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { requestEventPhotos } from '@/features/eventPhotos/api';
import type { EventItem } from '@/features/events/types';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export const photosKey = (eventId: string) => ['event-photos', eventId] as const;

/** 주소가 이 시간(ms) 안에 만료되면 미리 다시 받는다(EC2 와 이 브라우저의 시계 차이 포함). */
const EXPIRY_MARGIN_MS = 30_000;
/** 사진이 아직 없을 때(근거 작업이 늦게 만들어짐) 다시 받는 간격(ms). */
const EMPTY_RELOAD_MS = 15_000;
const MIN_RELOAD_MS = 5_000;

/** 사진은 LIVE 의 CRITICAL 이벤트에만 있다(Tier 0 가 CRITICAL 이벤트 프레임을 올린다). */
export const hasPhotos = (event: EventItem) =>
  event.source === 'LIVE' && event.severity === 'CRITICAL';

/** 다시 받아도 같은 답이 오는 오류(권한 없음·없는 이벤트·형식 다름)는 다시 열 때까지 받지 않는다. */
const isPermanentError = (error: unknown) =>
  error instanceof ApiError &&
  (error.kind === 'INVALID_RESPONSE' || (error.status >= 400 && error.status < 500));

/**
 * 이벤트 사진. 관리자이고 사진이 생기는 이벤트일 때만 부른다. 서명 주소가 만료되기 전에 새로 받고,
 * 사진이 깨져 보이면 reload 로 곧바로 새 주소를 받는다. 사진이 없거나 못 받으면 photos 는 빈 목록이라 칸을 그리지 않는다.
 */
export function useEventPhotos(event: EventItem) {
  const enabled = useCurrentRole() === 'ADMIN' && hasPhotos(event);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: photosKey(event.event_id),
    queryFn: ({ signal }) => requestEventPhotos(api, event.event_id, signal),
    enabled,
    refetchInterval: (q) => {
      if (isPermanentError(q.state.error)) return false;
      const photos = q.state.data?.frames ?? [];
      if (photos.length === 0) return EMPTY_RELOAD_MS;
      const soonest = Math.min(...photos.map((p) => p.expires_at_ms));
      return Math.max(soonest - Date.now() - EXPIRY_MARGIN_MS, MIN_RELOAD_MS);
    },
    retry: false,
  });
  const reload = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: photosKey(event.event_id) }),
    [queryClient, event.event_id],
  );
  return { photos: enabled ? (query.data?.frames ?? []) : [], reload };
}
