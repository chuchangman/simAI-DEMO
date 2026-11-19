import { eventPhotosSchema } from '@/features/eventPhotos/types';
import type { Http } from '@/lib/http';

/** 이벤트 사진 목록과 짧게 사는 서명 GET 주소(관리자). 부를 때마다 새 주소다. */
export function requestEventPhotos(http: Http, eventId: string, signal?: AbortSignal) {
  return http(`/api/events/${encodeURIComponent(eventId)}/frames`, {
    schema: eventPhotosSchema,
    signal,
  });
}
