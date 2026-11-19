import { clipUrlSchema, eventClipsSchema } from '@/features/clips/types';
import type { Http } from '@/lib/http';
import { z } from 'zod';

// http 를 인자로 받는다. 테스트가 env 없이 createHttp 로 부를 수 있게 한다.

/** 이벤트의 카메라별 클립 목록(관리자). 지운 클립도 deleted_at_ms 와 함께 온다. */
export function requestEventClips(http: Http, eventId: string, signal?: AbortSignal) {
  return http(`/api/events/${encodeURIComponent(eventId)}/clips`, {
    schema: eventClipsSchema,
    signal,
  });
}

/** 클립 재생 주소. EC2 가 이 요청마다 조회 기록을 남긴다(명세 14장). 지운 클립은 410 CLIP_DELETED. */
export function requestClipUrl(http: Http, clipId: string) {
  return http(`/api/clips/${encodeURIComponent(clipId)}`, { schema: clipUrlSchema });
}

/** 보존 표시 붙이기·떼기(관리자). 응답은 바뀐 클립이지만 받기만 하고, 화면은 목록을 다시 받아 그린다. 자동 보존 떼기는 409, 지운 클립은 410. */
export function requestClipRetention(http: Http, clipId: string, retentionHold: boolean) {
  return http(`/api/clips/${encodeURIComponent(clipId)}/retention`, {
    method: 'PUT',
    body: { retention_hold: retentionHold },
    schema: z.unknown(),
  });
}
