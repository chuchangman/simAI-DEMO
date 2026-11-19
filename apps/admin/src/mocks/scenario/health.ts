import { defaultHealthPeopleSnapshot, type HealthPeopleSnapshot } from '@/mocks/peopleNames';
import {
  cam3DownAt,
  CAMERAS,
  LATEST_GLOBAL_LAG_MS,
  MOCK_CONFIG,
  nextMsgId,
  PREVIOUS_SCENE,
  r2,
  SOURCE_ID,
  VERSIONS,
  type CameraId,
  type MockConfig,
} from '@/mocks/scenario/shared';
import type { ViewerHealthMessage, ViewerHealthPayload } from '@simai/contracts';

// /topic/health 시나리오: 관제 상태. 계약 예제 contracts/examples/viewer_health.json 모양에 시각마다 조금씩 흔들리는 값을 얹는다.

/** 흉내 내는 장애(명세 06장). tier0: Tier 0 정지, laptop: 노트북 정지, remote: Tier 0 → EC2 단절. */
export type MockOutage = 'tier0' | 'laptop' | 'remote';

/** EC2 가 하트비트 3회(1초 주기) 누락을 장애로 보기까지(ms, 명세 3.2). */
const DETECT_MS = 3_000;
/** health 의 기준 시각(as_of)이 보낸 시각보다 이른 만큼(ms). */
const AS_OF_LAG_MS = 10;
/** 카메라가 마지막으로 찍은 시각이 보낸 시각보다 이른 만큼(ms). */
const CAPTURE_LAG_MS = 120;
/** 노트북 하트비트가 보낸 시각보다 이른 만큼(ms). */
const HEARTBEAT_LAG_MS = 200;
/** 초마다 바뀌는 평소 값 흔들림이 되풀이되는 초 수. */
const WAVE_STEPS = 5;

type CameraDown = 'WAITING_KEYFRAME' | 'NO_SIGNAL';

/** 초마다 0 … 4 를 도는 흔들림. shift 로 카메라마다 엇갈리게 한다. */
const waveAt = (t: number, shift = 0) => Math.floor(t / 1000 + shift) % WAVE_STEPS;

/**
 * 카메라 한 대의 Tier 0 health. 키프레임을 기다리면 처리 FPS 는 0 이고(계약 필수 값),
 * 잴 수 없는 값은 null 이거나 싣지 않는다(예제의 cam_B 와 같다).
 */
function cameraHealth(id: CameraId, index: number, t: number, down: CameraDown | false) {
  if (down) {
    return {
      id,
      fps: 0,
      last_capture: null,
      sync_offset_ms: null,
      sync_valid: null,
      status: down,
    };
  }
  const wave = waveAt(t, index * 3);
  return {
    id,
    fps: r2(14.6 + wave * 0.1),
    last_capture: t - CAPTURE_LAG_MS,
    sync_offset_ms: 4 + index * 2,
    sync_valid: true,
    status: 'OK',
    frame_age_ms: { p50: 120 + wave * 5, p95: 200 + wave * 10 },
    queue_wait_ms: { p50: 8 + index, p95: 36 + wave * 4 },
    frames: {
      received: 25,
      gateway_to_runpod_loss: index === 1 ? wave % 2 : 0,
      skipped_by_policy: 10,
      laptop_skipped: 4,
      unattributed_gap: 0,
      late_dropped: 0,
      camera_to_gateway_gap_max_ms: 70 + wave * 10,
    },
  };
}

function systemHealthOf(
  down: MockOutage | undefined,
  cam3Down: boolean,
): ViewerHealthPayload['system_health'] {
  if (down) return 'UNSAFE_UNKNOWN';
  return cam3Down ? 'DEGRADED' : 'NOMINAL';
}

function remoteStateOf(down: MockOutage | undefined): ViewerHealthPayload['remote_state'] {
  if (down === 'remote') return 'REMOTE_LINK_LOST';
  return down ? 'CONTROL_HALTED' : 'NORMAL';
}

/** 노트북이 멈추면 Tier 0 에 영상이 오지 않는다. */
function cameraDownOf(
  id: CameraId,
  down: MockOutage | undefined,
  cam3Down: boolean,
): CameraDown | false {
  if (down === 'laptop') return 'NO_SIGNAL';
  return id === 'cam_C' && cam3Down ? 'WAITING_KEYFRAME' : false;
}

function laptopOf(
  t: number,
  down: MockOutage | undefined,
  outage: { since: number } | undefined,
): ViewerHealthPayload['laptop'] {
  if (down === 'laptop' && outage) return { link: 'DISCONNECTED', last_heartbeat_at: outage.since };
  return { link: 'CONNECTED', last_heartbeat_at: t - HEARTBEAT_LAG_MS };
}

function sceneOf(sceneMismatch: boolean): ViewerHealthPayload['scene'] {
  return sceneMismatch
    ? { committed_version: VERSIONS.scene, live_version: PREVIOUS_SCENE, mismatch: true }
    : { committed_version: VERSIONS.scene, live_version: VERSIONS.scene, mismatch: false };
}

/** mock 의 held_events_revision(viewer_health 1.4.0, S15P31A101-595). */
export const MOCK_HELD_REVISION = 'mock-0';

/**
 * /topic/health: 시각 t(ms)의 관제 상태. 데이터 연령은 0.2초 안팎이고, 바퀴마다 cam_C 가 잠깐 키프레임을 기다린다.
 * faults 가 false 면 고장 흉내 없이 늘 정상이다(시각과 상관없이 NOMINAL 을 기대하는 시험).
 * outage 를 주면 그 시각부터 데이터가 끊기고, 3초 뒤부터 EC2 가 장애(remote_state)를 알린다.
 * sceneMismatch 면 Tier 0 가 이전 Scene 으로 판정한다고 알린다(명세 FR-12).
 */
export function viewerHealthAt(
  t: number,
  {
    faults = true,
    outage,
    sceneMismatch = false,
    config = MOCK_CONFIG,
    people,
  }: {
    faults?: boolean;
    outage?: { kind: MockOutage; since: number };
    sceneMismatch?: boolean;
    config?: MockConfig;
    people?: HealthPeopleSnapshot;
  } = {},
): ViewerHealthMessage {
  const down = outage && t - outage.since >= DETECT_MS ? outage.kind : undefined;
  const cam3Down = faults && cam3DownAt(t);
  const system = systemHealthOf(down, cam3Down);
  const wave = waveAt(t);
  const asOf = t - AS_OF_LAG_MS;
  // 끊긴 동안은 마지막 world(장애 시작 때)부터 잰다. as_of − t_latest_global 과 같다.
  const latestGlobal = (outage ? Math.min(t, outage.since) : t) - LATEST_GLOBAL_LAG_MS;
  const peopleSnap = people ?? defaultHealthPeopleSnapshot(t);
  return {
    schema_version: '1.5.0',
    msg_type: 'viewer_health',
    msg_id: nextMsgId(),
    sent_at: t,
    source_id: SOURCE_ID,
    payload: {
      as_of: asOf,
      system_health: system,
      remote_state: remoteStateOf(down),
      tier0_link: down === 'tier0' || down === 'remote' ? 'DISCONNECTED' : 'CONNECTED',
      laptop: laptopOf(t, down, outage),
      data_age_ms: outage ? asOf - latestGlobal : 180 + wave * 15,
      calibration_state: 'CALIBRATED',
      config,
      scene: sceneOf(sceneMismatch),
      // Tier 0 가 들고 있는 이벤트 집합의 판(1.4.0). mock 은 집합을 한꺼번에 바꾸지 않아 늘 같다.
      held_events_revision: MOCK_HELD_REVISION,
      watches: peopleSnap.watches,
      watch_names: peopleSnap.watchNames,
      person_names: peopleSnap.personNames,
      tier0_health: {
        system_health: system,
        t_latest_global: latestGlobal,
        cameras: CAMERAS.map((id, index) =>
          cameraHealth(id, index, t, cameraDownOf(id, down, cam3Down)),
        ),
        pipeline_lag_ms: 110 + wave * 5,
        capture_to_risk_ms: { p50: 300 + wave * 5, p95: 460 + wave * 10 },
        calibration_state: 'CALIBRATED',
        calibration_version: VERSIONS.calibration,
        config_version: config.applied_version,
        config_sync: config.sync,
        gateway_link: 'CONNECTED',
        gpu_util: r2(0.68 + wave * 0.01),
        gpu_memory_used_ratio: 0.62,
      },
    },
  };
}
