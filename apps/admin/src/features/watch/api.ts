import type { Http } from '@/lib/http';
import { z } from 'zod';

// 워치 배정 조회 키. 아바타 이름표(useWatchBadges)가 쓴다.
export const WATCH_BINDINGS_KEY = ['watch-bindings'] as const;

/**
 * 워치 ↔ 익명 World ID 배정 하나(서버 WatchBindingController, S15P31A101-338·-340). 사람 이름은 없다(11.4-5).
 * method 는 관리자 수동(MANUAL) 또는 움직임 대조(MOTION_MATCH). channel_state 는 응답 시각의 워치 연결(BOUND)·끊김(LOST).
 */
const watchBindingSchema = z.object({
  binding_id: z.number(),
  device_id: z.string(),
  world_id: z.string(),
  method: z.string(),
  bound_at: z.number(),
  channel_state: z.enum(['BOUND', 'LOST']),
});

export type WatchBinding = z.infer<typeof watchBindingSchema>;

const bindingsSchema = z.array(watchBindingSchema);

// http 를 인자로 받는다. 테스트가 env 없이 createHttp 로 부를 수 있게 한다.
export function requestWatchBindings(http: Http, signal?: AbortSignal) {
  return http('/api/watch-bindings', { schema: bindingsSchema, signal });
}
