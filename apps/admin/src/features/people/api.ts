import type { Http } from '@/lib/http';
import { z } from 'zod';

// 사람·워치 표시 이름 변경 REST API(S15P31A101-658, 관리자 전용).

const watchDisplayNameResponseSchema = z.object({
  device_id: z.string(),
  site_id: z.string(),
  display_name: z.string(),
  changed_by_user_id: z.number(),
  updated_at: z.number(),
});

const worldDisplayNameResponseSchema = z.object({
  world_id: z.string(),
  site_id: z.string(),
  site_date: z.string(),
  display_name: z.string(),
  name_source: z.enum(['WORLD_MANUAL', 'WATCH_DEVICE', 'UNIDENTIFIED']),
  changed_by_user_id: z.number(),
  updated_at: z.number(),
});

export type WatchDisplayNameResponse = z.infer<typeof watchDisplayNameResponseSchema>;
export type WorldDisplayNameResponse = z.infer<typeof worldDisplayNameResponseSchema>;

const emptySchema = z.undefined();

/** (a) 워치 기기 표시 이름 변경(현장 단위 지속, 권장 경로). */
export function putWatchDisplayName(http: Http, deviceId: string, displayName: string) {
  return http(`/api/watches/${encodeURIComponent(deviceId)}/display-name`, {
    method: 'PUT',
    body: { display_name: displayName },
    schema: watchDisplayNameResponseSchema,
  });
}

/** 워치 기기 표시 이름 비우기(이력 CLEAR 추가). */
export function deleteWatchDisplayName(http: Http, deviceId: string) {
  return http(`/api/watches/${encodeURIComponent(deviceId)}/display-name`, {
    method: 'DELETE',
    schema: emptySchema,
  });
}

/** (b) 워치 없는 사람의 현재 World ID 표시 이름 변경(병합 승계, 당일 한정). */
export function putPersonWorldDisplayName(http: Http, worldId: string, displayName: string) {
  return http(`/api/people/${encodeURIComponent(worldId)}/display-name`, {
    method: 'PUT',
    body: { display_name: displayName },
    schema: worldDisplayNameResponseSchema,
  });
}

/** 현재 World ID 당일 표시 이름 비우기(이력 CLEAR 추가). */
export function deletePersonWorldDisplayName(http: Http, worldId: string) {
  return http(`/api/people/${encodeURIComponent(worldId)}/display-name`, {
    method: 'DELETE',
    schema: emptySchema,
  });
}
