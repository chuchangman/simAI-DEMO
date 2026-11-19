import {
  CAMERAS,
  LATEST_GLOBAL_LAG_MS,
  MOCK_CONFIG,
  nextMsgId,
  PREVIOUS_SCENE,
  r2,
  sending,
  SOURCE_ID,
  VERSIONS,
  type CameraId,
} from '@/mocks/scenario/shared';
import type { WorldStateMessage, WorldTrack } from '@simai/contracts';

// /topic/world 시나리오: 교실을 원을 그리며 걷는 작업자 셋. 계약 예제(contracts/examples)를 바탕으로 시각과 위치만 바꾼다.

/** 교실(10×10m) 안을 원을 그리며 걷는 작업자. 주기(ms)마다 한 바퀴 돈다. */
const WORKERS = [
  { id: 'w-0012', cx: 3.0, cy: 5.0, r: 1.6, periodMs: 24_000, phase: 0 },
  { id: 'w-0015', cx: 6.6, cy: 3.0, r: 1.2, periodMs: 18_000, phase: 0.4 },
  { id: 'w-0021', cx: 6.0, cy: 7.2, r: 1.8, periodMs: 30_000, phase: 0.7 },
] as const;

/** 작업자를 관측하는 카메라. */
const TRACK_CAMERAS: readonly CameraId[] = ['cam_A', 'cam_B', 'cam_C'];
/** 마지막 유효 관측이 보낸 시각보다 늦은 만큼(ms). 트랙의 frame_age_ms 와 같다. */
const FRAME_AGE_MS = 140;
/** 골반·머리 높이(m). */
const PELVIS_Z_M = 0.92;
const HEAD_Z_M = 1.68;

function track(worker: (typeof WORKERS)[number], t: number): WorldTrack {
  const turn = (t / worker.periodMs + worker.phase) % 1;
  const angle = 2 * Math.PI * turn;
  const x = r2(worker.cx + worker.r * Math.cos(angle));
  const y = r2(worker.cy + worker.r * Math.sin(angle));
  const speed = (2 * Math.PI * worker.r) / (worker.periodMs / 1000);
  return {
    world_id: worker.id,
    t_last_valid: t - FRAME_AGE_MS,
    observation_state: 'OBSERVED',
    track_lifecycle: 'CONFIRMED',
    identity_confidence: 'HIGH',
    identity_revision: 0,
    frame_age_ms: FRAME_AGE_MS,
    position_xy: [x, y],
    position_xy_sigma: [0.08, 0.08],
    pelvis_xyz: [x, y, PELVIS_Z_M],
    ground_anchor_xyz: [x, y, 0],
    ground_anchor_sigma: [0.06, 0.06, 0.03],
    surface_source: 'observed',
    support_surface_id: 'floor',
    support_surface_validity: 'VALID',
    contact_validity: 'VALID',
    z_validity: 'VALID',
    head_z: HEAD_Z_M,
    head_z_sigma: 0.05,
    head_z_validity: 'VALID',
    velocity: [r2(-speed * Math.sin(angle)), r2(speed * Math.cos(angle)), 0],
    cameras: sending(TRACK_CAMERAS, t),
  };
}

/**
 * /topic/world: 시각 t(ms)의 World 상태. EC2 가 봉투만 새로 쓴다(source_id ec2, 명세 12.4).
 * sceneMismatch 면 Tier 0 가 이전 Scene 으로 판정한다(health 의 scene.live_version 과 같다, 명세 FR-12).
 */
export function worldStateAt(
  t: number,
  {
    sceneMismatch = false,
    configVersion = MOCK_CONFIG.applied_version,
  }: { sceneMismatch?: boolean; configVersion?: string | null } = {},
): WorldStateMessage {
  return {
    schema_version: '2.0.0',
    msg_type: 'world_state',
    msg_id: nextMsgId(),
    sent_at: t,
    source_id: SOURCE_ID,
    payload: {
      t_latest_global: t - LATEST_GLOBAL_LAG_MS,
      calibration_version: VERSIONS.calibration,
      scene_version: sceneMismatch ? PREVIOUS_SCENE : VERSIONS.scene,
      ...(configVersion ? { config_version: configVersion } : {}),
      input_provenance: {
        frames: { source: 'LIVE', camera_ids: sending(CAMERAS, t) },
        calibration: { source: 'G1_AUTO', calibration_version: VERSIONS.calibration },
        tracks: { source: 'TIER0_LIVE', provider_version: 'tier0-0.1.0' },
        is_upper_bound: false,
      },
      tracks: WORKERS.map((worker) => track(worker, t)),
    },
  };
}
