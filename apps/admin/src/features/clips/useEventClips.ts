import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { requestEventClips } from '@/features/clips/api';
import { hasClips } from '@/features/clips/clips';
import type { EventItem } from '@/features/events/types';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useQuery } from '@tanstack/react-query';

export const clipsKey = (eventId: string) => ['clips', 'event', eventId] as const;

/** 클립은 위험 구간이 끝난 뒤(사후 20초 + 업로드) 생긴다. 상세를 보는 동안 다시 받는 간격(ms). */
const RELOAD_MS = 5_000;

/** 다시 받아도 같은 답이 오는 오류(주소 없음·권한 없음·형식 다름)면 상세를 다시 열 때까지 받지 않는다. */
const isPermanentError = (error: unknown) =>
  error instanceof ApiError &&
  (error.kind === 'INVALID_RESPONSE' || (error.status >= 400 && error.status < 500));

/**
 * 이벤트의 카메라별 클립 목록. 명세상 관리자만 볼 수 있어 관리자이고 클립이 생기는 이벤트일 때만 부른다.
 * 다시 받기가 실패해도 받아 둔 목록은 그대로 두고 실패를 따로 알린다. 클립 목록은 늘어나기만 하는 기록이라
 * (보존·삭제 표시만 바뀐다) 이전 목록을 남겨도 오해가 적고, 그래야 보던 영상이 닫히지 않는다.
 */
export function useEventClips(event: EventItem) {
  const enabled = useCurrentRole() === 'ADMIN' && hasClips(event);
  const query = useQuery({
    queryKey: clipsKey(event.event_id),
    queryFn: ({ signal }) => requestEventClips(api, event.event_id, signal),
    enabled,
    refetchInterval: (q) => (isPermanentError(q.state.error) ? false : RELOAD_MS),
    // 실패하면 다음 갱신 때 다시 받는다.
    retry: false,
  });
  return {
    enabled,
    clips: enabled ? query.data?.clips : undefined,
    failed: enabled && query.isError,
  };
}
