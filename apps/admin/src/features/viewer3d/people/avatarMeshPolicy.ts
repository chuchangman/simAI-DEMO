import type { TrackView, WorldFrame } from '@/features/viewer3d/data/spatialFrame';
import type { AvatarPoseView } from '@/features/viewer3d/people/avatarFrame';

// EXP-02 메시를 그릴지, 기본 캡슐(-44·-56 경로)로 되돌아갈지 정한다(docs/design/avatar-pose-stream.md '뷰어 구동').
// 하나라도 맞으면 되돌아간다. 위치·접지·관측 상태는 늘 Tier 0(world_state)이고 여기서 바꾸지 않는다.

/**
 * 새 포즈가 이만큼 오지 않으면 끊김(뷰어 수신 기준, ms).
 * Tier 0 공유 채널 기록 주기(5 Hz, 200 ms) + 대표 카메라 HMR 추론 + 중계·WS 전달 지터를 감안해 1000 ms 로 둔다(-650).
 * 아바타 포즈 허용 나이를 늘려도 위치·접지·위험 판정은 늘 Tier 0(world_state, 10 Hz)가 정본이다.
 */
export const AVATAR_STALL_MS = 1000;
/**
 * world_state t_latest_global − 포즈 촬영 시각이 이만큼 넘으면 늦음(ms).
 * 5 Hz 공유 채널 표본 간격(200 ms)과 부하 시 아바타 자체 감속(최대 800 ms)을 수용하도록 1000 ms 로 둔다(-650).
 */
export const AVATAR_LATE_MS = 1000;
/** 관절 회전 재생 지연(ms). 5 Hz 표본 간격보다 커서 거의 늘 두 표본 사이를 보간한다. */
export const AVATAR_PLAYBACK_DELAY_MS = 250;
/**
 * identity_revision 이 그대로인 IDENTITY_UNCERTAIN 이 이만큼(World 시각, ms) 안이면 메시를 유지한다(-661).
 * Tier 0 는 불확실 사유가 한 번 생기면 1.0 s(uncertain_hold_ms) 유지하고, 병합 뒤 일관성 확인은 자기 관측 3 프레임
 * (merge_confirm_frames, 10 Hz 0.3 s) + 1.0 s 라 짧은 불확실은 대개 1.3 s 안에 끝난다. 여유를 둬 1.5 s 로 둔다.
 * 그동안 워커는 새 포즈를 보내지 않으므로(외형·포즈 누적 일시정지) 끊김·늦음 기준도 이만큼 늘려 마지막 자세로 둔다.
 * 위치·접지는 늘 Tier 0 값 그대로이고, 넘으면 지금처럼 캡슐로 돌아간다. 차수가 다르면 기다리지 않는다.
 */
export const AVATAR_IDENTITY_HOLD_MS = 1500;

export const AVATAR_MESH_FALLBACKS = [
  'OFF',
  'NO_POSE',
  'IDENTITY',
  'CALIBRATION',
  'STALLED',
  'HMR_LATE',
  'NO_ASSET',
  'JOINT_MISMATCH',
  'NO_PELVIS',
  'ASSET_LOADING',
  'ASSET_ERROR',
] as const;
/**
 * OFF 메시 끔 · NO_POSE 포즈 없음 · IDENTITY ID 불확실(같은 차수로 1.5 s 넘게)이거나 교정 차수가 다름(순수 병합 전 차수는 제외, -743) ·
 * CALIBRATION 보정 버전 다름 ·
 * STALLED 1.0 s 넘게 새 포즈 없음 · HMR_LATE 촬영 시각이 World 보다 1000 ms 넘게 늦음 · NO_ASSET 자산 없음 ·
 * JOINT_MISMATCH 자산 관절 수와 포즈 길이가 다름 · NO_PELVIS Tier 0 pelvis 없음(정렬 불가) ·
 * ASSET_LOADING 자산 읽는 중 · ASSET_ERROR 자산 내려받기·sha256·리그 확인 실패.
 */
export type AvatarMeshFallback = (typeof AVATAR_MESH_FALLBACKS)[number];

export type AvatarAssetState =
  | { status: 'NONE' }
  | { status: 'LOADING' }
  | { status: 'READY' }
  | { status: 'ERROR'; reason: string };

export interface AvatarMeshStatus {
  worldId: string;
  /** true 면 메시로 그린다. */
  use: boolean;
  /** 되돌아간 이유. 메시로 그리면 null. */
  fallback: AvatarMeshFallback | null;
  /** World t_latest_global − 포즈 촬영 시각(ms). HMR 지연 표시용(staleness). 포즈가 없으면 null. */
  hmrLagMs: number | null;
  /** 이 브라우저 기준 마지막 포즈 수신 뒤 지난 시간(ms). 포즈가 없으면 null. */
  poseAgeMs: number | null;
  /** 자산 오류 내용(ASSET_ERROR 일 때). */
  detail: string | null;
}

export interface AvatarMeshInput {
  enabled: boolean;
  track: TrackView;
  world: WorldFrame;
  avatar: AvatarPoseView | undefined;
  asset: AvatarAssetState;
  now: number;
}

export function avatarMeshStatus({
  enabled,
  track,
  world,
  avatar,
  asset,
  now,
}: AvatarMeshInput): AvatarMeshStatus {
  const base = {
    worldId: track.worldId,
    hmrLagMs: avatar ? world.tLatestGlobal - avatar.captureTimeMs : null,
    poseAgeMs: avatar ? now - avatar.receivedAt : null,
    detail: null,
  };
  const fallback = (
    reason: AvatarMeshFallback,
    detail: string | null = null,
  ): AvatarMeshStatus => ({
    ...base,
    use: false,
    fallback: reason,
    detail,
  });
  if (!enabled) return fallback('OFF');
  if (!avatar) return fallback('NO_POSE');
  // 순수 병합 직후에는 병합 전 차수의 포즈가 잠깐 남는다(워커는 불확실이 풀린 뒤 새 차수로 보낸다). 같은 사람의 포즈이므로
  // 끊김·늦음을 AVATAR_IDENTITY_HOLD_MS 만큼 늘려 마지막 자세로 둔다(-743). 분할·그 밖의 차수 상승은 지금처럼 캡슐.
  const mergeBase = world.pureMergeBase?.get(track.worldId);
  const mergeCarried =
    avatar.identityRevision < track.identityRevision &&
    mergeBase !== undefined &&
    avatar.identityRevision >= mergeBase;
  if (avatar.identityRevision !== track.identityRevision && !mergeCarried) {
    return fallback('IDENTITY');
  }
  // 같은 차수의 짧은 ID 불확실은 메시를 유지한다. 이어진 시간을 모르거나 길어지면 캡슐(-661).
  let hold = mergeCarried ? AVATAR_IDENTITY_HOLD_MS : 0;
  if (track.identityConfidence === 'IDENTITY_UNCERTAIN') {
    const since = world.identityUncertainSince?.get(track.worldId);
    if (since === undefined || world.tLatestGlobal - since > AVATAR_IDENTITY_HOLD_MS) {
      return fallback('IDENTITY');
    }
    hold = AVATAR_IDENTITY_HOLD_MS;
  }
  if (avatar.calibrationVersion !== world.calibrationVersion) return fallback('CALIBRATION');
  if (base.poseAgeMs! > AVATAR_STALL_MS + hold) return fallback('STALLED');
  if (base.hmrLagMs! > AVATAR_LATE_MS + hold) return fallback('HMR_LATE');
  if (!avatar.asset) return fallback('NO_ASSET', avatar.assetRejected);
  if (avatar.asset.jointCount !== avatar.jointRotations.length) return fallback('JOINT_MISMATCH');
  if (!track.pelvis) return fallback('NO_PELVIS');
  if (asset.status === 'ERROR') return fallback('ASSET_ERROR', asset.reason);
  if (asset.status !== 'READY') return fallback('ASSET_LOADING');
  return { ...base, use: true, fallback: null };
}
