import type { HealthSnapshot } from '@/store/realtime.store';
import { z } from 'zod';

// 카메라 상태(대시보드 카메라 칸·CCTV)를 health 에서 만든다. 화면 컴포넌트 없이 시험한다.
// tier0_health(I1 health 원문)는 계약이 객체인지까지만 검사하므로 화면이 쓰는 칸만 느슨하게 읽는다.
// 칸마다 따로 읽어, 형식이 틀린 칸만 비우고 나머지는 그린다. 없는 값은 undefined(빈칸)로 돌려준다.
// 0 으로 채우지 않는다.

const num = z.number().nullish().catch(undefined);
const text = z.string().nullish().catch(undefined);
const pair = z.object({ p50: num, p95: num }).nullish().catch(undefined);

const cameraSchema = z.object({
  // 행을 가리킬 수 없으면 뺀다. 나머지 칸은 틀려도 그 칸만 비운다.
  id: z.string(),
  status: text,
  fps: num,
  sync_offset_ms: num,
  queue_wait_ms: pair,
  frames: z
    .object({
      camera_to_gateway_gap_max_ms: num,
      gateway_to_runpod_loss: num,
      skipped_by_policy: num,
    })
    .nullish()
    .catch(undefined),
});

const tier0Schema = z.object({
  // 카메라 하나가 틀려도 나머지는 그린다. 항목은 cameraRows 에서 하나씩 검사한다.
  cameras: z.array(z.unknown()).nullish().catch(undefined),
});

type Tier0 = z.infer<typeof tier0Schema>;

// 같은 health 를 여러 칸이 읽으므로 받은 메시지 하나에 한 번만 검사한다.
const tier0Cache = new WeakMap<HealthSnapshot, Tier0 | undefined>();

/**
 * 지금의 Tier 0 health. tier0_health 는 EC2 가 마지막으로 받은 값이라, EC2 ↔ Tier 0 가 끊기면
 * 지금 값이 아니다. 그때는 비운다.
 */
function tier0(health: HealthSnapshot | null): Tier0 | undefined {
  if (!health || health.payload.tier0_link !== 'CONNECTED') return undefined;
  if (!tier0Cache.has(health)) {
    tier0Cache.set(health, tier0Schema.safeParse(health.payload.tier0_health).data);
  }
  return tier0Cache.get(health);
}

const ms = (value: number | null | undefined) =>
  value === null || value === undefined ? undefined : `${Math.round(value)} ms`;
const count = (value: number | null | undefined) =>
  value === null || value === undefined ? undefined : `${value}`;

const CAMERA_STATUS: Record<string, string> = {
  OK: '정상',
  NO_SIGNAL: '신호 없음',
  WAITING_KEYFRAME: '키프레임 대기',
  SYNC_INVALID: '동기 불가',
};

export interface CameraRow {
  id: string;
  status?: string;
  ok: boolean;
  fps?: string;
  syncOffset?: string;
  /** 카메라 → 게이트웨이 간격 최대(ms). */
  gapMax?: string;
  /** 게이트웨이 → RunPod 전송 손실(장). */
  runpodLoss?: string;
  /** 정책으로 건너뛴 프레임(장). */
  skipped?: string;
  queueWaitP95?: string;
}

/** 카메라별 상태와 프레임 손실 3종(FR-13). id 가 없는 카메라는 뺀다. */
export function cameraRows(health: HealthSnapshot | null): CameraRow[] {
  const cameras = tier0(health)?.cameras ?? [];
  return cameras.flatMap((item) => {
    const camera = cameraSchema.safeParse(item);
    if (!camera.success) return [];
    const { id, status, fps, sync_offset_ms, queue_wait_ms, frames } = camera.data;
    return [
      {
        id,
        status:
          status === null || status === undefined ? undefined : (CAMERA_STATUS[status] ?? status),
        ok: status === 'OK',
        fps: fps === null || fps === undefined ? undefined : fps.toFixed(1),
        syncOffset: ms(sync_offset_ms),
        gapMax: ms(frames?.camera_to_gateway_gap_max_ms),
        runpodLoss: count(frames?.gateway_to_runpod_loss),
        skipped: count(frames?.skipped_by_policy),
        queueWaitP95: ms(queue_wait_ms?.p95),
      },
    ];
  });
}
