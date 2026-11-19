import type { HealthSnapshot } from '@/store/realtime.store';
import { z } from 'zod';

// CCTV 화면이 쓰는 카메라 상태. tier0_health.cameras[](I1 health 원문)에서 칸마다 따로 읽어, 형식이 틀린 칸만 비운다.
// 화면 컴포넌트 없이 시험한다.

const cameraSchema = z.object({
  // 칸을 가리킬 수 없으면 뺀다. 나머지 칸은 틀려도 그 칸만 비운다.
  id: z.string(),
  status: z.string().nullish().catch(undefined),
  last_capture: z.number().nullish().catch(undefined),
});

const tier0Schema = z.object({
  cameras: z.array(z.unknown()).nullish().catch(undefined),
});

export interface HealthCamera {
  id: string;
  /** I1 health 의 cameras[].status 원문(OK, NO_SIGNAL, WAITING_KEYFRAME, SYNC_INVALID). */
  status?: string;
  /** Tier 0 가 마지막으로 받은 프레임의 촬영 시각(UTC ms). */
  lastCaptureMs?: number;
}

/**
 * 지금의 카메라 상태. tier0_health 는 EC2 가 마지막으로 받은 값이라 EC2 ↔ Tier 0 가 끊기면 지금 값이 아니다.
 * 그때는 비운다(알 수 없는 것을 정상으로 보이지 않는다).
 */
export function healthCameras(health: HealthSnapshot | null): HealthCamera[] {
  if (!health || health.payload.tier0_link !== 'CONNECTED') return [];
  const tier0 = tier0Schema.safeParse(health.payload.tier0_health);
  if (!tier0.success) return [];
  return (tier0.data.cameras ?? []).flatMap((item) => {
    const camera = cameraSchema.safeParse(item);
    if (!camera.success) return [];
    const { id, status, last_capture } = camera.data;
    return [{ id, status: status ?? undefined, lastCaptureMs: last_capture ?? undefined }];
  });
}
