import type { AvatarFrameMessage } from '@simai/contracts';

// /topic/avatar avatar_frame(EXP-02, S15P31A101-65) 을 사람별 포즈 View 로 옮긴다. 스키마 검사는 contractAdapter 가 먼저 한다.
// 여기서는 스키마 밖 계약 규칙(docs/design/avatar-pose-stream.md)만 본다. 위치는 싣지 않는다(존재·위치·접지는 world_state 정본).

export type AxisAngle = readonly [number, number, number];

/** 회전각 상한. 계약은 소수 넷째 자리로 반올림해 π 가 3.1416 으로 올 수 있어 그만큼 여유를 둔다. */
export const MAX_ROTATION_RAD = Math.PI + 1e-3;

export interface AvatarAssetView {
  streamEpoch: number;
  identityRevision: number;
  meshUrl: string;
  /** 'sha256:<hex>'. 내려받은 파일 확인과 캐시 키. */
  meshSha256: string;
  meshFormat: 'GLB_SKINNED' | 'GLTF_SKINNED';
  jointCount: number;
  jointParentsSha256: string;
  pelvisJointIndex: number;
  textureUrl: string | null;
  surfaceSourceUrl: string | null;
  surfaceRatios: {
    OBSERVED: number;
    INTERPOLATED: number;
    UNOBSERVED: number;
  };
  facePolicy: 'OBSERVED' | 'BLURRED' | 'EXCLUDED';
  faceRatios: {
    OBSERVED: number;
    UNOBSERVED: number;
  };
}

export interface AvatarPoseView {
  msgId: string;
  worldId: string;
  identityRevision: number;
  /** 원본 프레임 촬영 시각(송신 측 시계). 보간 기준. */
  captureTimeMs: number;
  /** EC2 가 포즈 묶음을 받은 시각(지연 진단용). */
  relayReceivedAtMs: number;
  /** 이 브라우저가 받은 시각. 끊김 판단 기준. */
  receivedAt: number;
  calibrationVersion: string;
  appearanceVersion: number;
  /** 리그(glTF Y-up) → World 회전, 축각(rad). */
  rootRotation: AxisAngle;
  /** 부모 기준 관절 회전, 축각(rad). null 은 모름(바인드 회전을 둔다). */
  jointRotations: readonly (AxisAngle | null)[];
  /** 쓸 수 있는 자산. 없거나 계약 규칙에 맞지 않으면 null(캡슐). */
  asset: AvatarAssetView | null;
  /** asset 을 쓰지 않는 이유(자산 차수가 포즈 차수보다 큼). 없으면 null. */
  assetRejected: string | null;
}

export interface AvatarFrameView {
  msgId: string;
  receivedAt: number;
  avatars: AvatarPoseView[];
  /** 계약 규칙에 맞지 않아 뺀 사람. */
  dropped: { worldId: string; reason: string }[];
}

type FrameAvatar = AvatarFrameMessage['payload']['avatars'][number];

const norm = ([x, y, z]: AxisAngle) => Math.hypot(x, y, z);
const triple = (v: readonly number[]): AxisAngle => [v[0]!, v[1]!, v[2]!];

/** 회전 규칙(각도·관절 0). 맞지 않으면 이유, 맞으면 null. */
function poseProblem(avatar: FrameAvatar): string | null {
  const { root_rotation: root, joint_rotations: joints } = avatar.pose;
  if (norm(triple(root)) > MAX_ROTATION_RAD) return 'root_rotation 회전각 > π';
  for (const joint of joints) {
    if (joint && norm(triple(joint)) > MAX_ROTATION_RAD) return '관절 회전각 > π';
  }
  // 관절 0(바닥 원점)은 늘 단위 회전이다. 몸 방향은 root_rotation 이 싣는다.
  const first = joints[0];
  if (first && norm(triple(first)) > 1e-6) return '관절 0 회전이 0 이 아님';
  return null;
}

function assetOf(avatar: FrameAvatar): { asset: AvatarAssetView | null; rejected: string | null } {
  const a = avatar.asset;
  if (!a) return { asset: null, rejected: null };
  // 교정 뒤 자산을 교정 전 포즈에 입히면 다른 사람 외형일 수 있다(설계 'ID 교정 뒤 외형').
  if (a.identity_revision > avatar.identity_revision) {
    return { asset: null, rejected: '자산 ID 차수가 포즈보다 큼' };
  }
  return {
    asset: {
      streamEpoch: a.stream_epoch,
      identityRevision: a.identity_revision,
      meshUrl: a.mesh_url,
      meshSha256: a.mesh_sha256,
      meshFormat: a.mesh_format,
      jointCount: a.joint_count,
      jointParentsSha256: a.joint_parents_sha256,
      pelvisJointIndex: a.pelvis_joint_index,
      textureUrl: a.texture_url,
      surfaceSourceUrl: a.surface_source_url,
      surfaceRatios: { ...a.surface_ratios },
      facePolicy: a.face_policy,
      faceRatios: { ...a.face_ratios },
    },
    rejected: null,
  };
}

/** 스키마를 통과한 avatar_frame 을 옮긴다. 같은 world_id 가 둘 이상이면 어느 쪽이 맞는지 몰라 그 사람을 모두 뺀다. */
export function avatarFrameOf(message: AvatarFrameMessage, receivedAt: number): AvatarFrameView {
  const counts = new Map<string, number>();
  for (const a of message.payload.avatars)
    counts.set(a.world_id, (counts.get(a.world_id) ?? 0) + 1);
  const avatars: AvatarPoseView[] = [];
  const dropped: AvatarFrameView['dropped'] = [];
  for (const a of message.payload.avatars) {
    if (counts.get(a.world_id)! > 1) {
      dropped.push({ worldId: a.world_id, reason: 'world_id 중복' });
      continue;
    }
    const problem = poseProblem(a);
    if (problem) {
      dropped.push({ worldId: a.world_id, reason: problem });
      continue;
    }
    const { asset, rejected } = assetOf(a);
    avatars.push({
      msgId: message.msg_id,
      worldId: a.world_id,
      identityRevision: a.identity_revision,
      captureTimeMs: a.capture_time_ms,
      relayReceivedAtMs: a.received_at_ms,
      receivedAt,
      calibrationVersion: a.calibration_version,
      appearanceVersion: a.appearance_version,
      rootRotation: triple(a.pose.root_rotation),
      jointRotations: a.pose.joint_rotations.map((j) => (j ? triple(j) : null)),
      asset,
      assetRejected: rejected,
    });
  }
  return { msgId: message.msg_id, receivedAt, avatars, dropped };
}

/** 같은 사람의 새 포즈를 받을지. ID 교정 차수가 크거나, 같으면 촬영 시각이 늦을 때만 받는다(설계 '순서 역전·중복'). */
export function isNewerPose(prev: AvatarPoseView | undefined, next: AvatarPoseView): boolean {
  if (!prev) return true;
  if (next.identityRevision !== prev.identityRevision) {
    return next.identityRevision > prev.identityRevision;
  }
  return next.captureTimeMs > prev.captureTimeMs;
}
