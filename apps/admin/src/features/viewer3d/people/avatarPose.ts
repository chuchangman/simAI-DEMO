import type { AvatarPoseView, AxisAngle } from '@/features/viewer3d/people/avatarFrame';
import { Matrix4, Quaternion, Vector3, type Bone, type Object3D } from 'three';

// 아바타 포즈 재생(-65). 관절 회전만 재생 지연(250 ms)만큼 늦게 두 표본 사이를 slerp 하고, 위치는 Tier 0 pelvis 에 맞춘다.
// 식은 docs/design/mhr-skinned-gltf.md '-65' 와 같다: 감싼 그룹 회전 = quat(A)·quat(root_rotation), A = World → Three(Rx(−π/2)).

/** World(Z-up) → Three(Y-up) 회전. worldCoordinates 의 WORLD_TO_THREE_MATRIX 와 같은 Rx(−π/2) 다. */
export const WORLD_TO_THREE_QUATERNION: Readonly<Quaternion> = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  -Math.PI / 2,
);

const axis = new Vector3();

/** 축각(rad) → 쿼터니언. 0 벡터는 단위 회전이다. */
export function axisAngleQuaternion(v: AxisAngle, out = new Quaternion()): Quaternion {
  const angle = Math.hypot(v[0], v[1], v[2]);
  if (angle < 1e-12) return out.identity();
  return out.setFromAxisAngle(axis.set(v[0] / angle, v[1] / angle, v[2] / angle), angle);
}

export interface PoseSample {
  identityRevision: number;
  captureTimeMs: number;
  receivedAt: number;
  root: Quaternion;
  /** null 은 모르는 관절(바인드 회전을 둔다). */
  joints: (Quaternion | null)[];
}

export function poseSample(pose: AvatarPoseView): PoseSample {
  return {
    identityRevision: pose.identityRevision,
    captureTimeMs: pose.captureTimeMs,
    receivedAt: pose.receivedAt,
    root: axisAngleQuaternion(pose.rootRotation),
    joints: pose.jointRotations.map((j) => (j ? axisAngleQuaternion(j) : null)),
  };
}

export interface PoseFrame {
  a: PoseSample;
  b: PoseSample;
  /** 0 = a, 1 = b. */
  t: number;
}

/** 한 사람이 들고 있는 표본 수. 5 Hz 로 약 1.6 s 다. */
export const POSE_BUFFER_SIZE = 8;

/**
 * 한 사람의 재생 버퍼. 재생 시각 = (촬영 시각 기준 시계) − 지연. 촬영 시계와 이 브라우저 시계의 차이는
 * 들고 있는 표본의 (수신 − 촬영) 최솟값으로 잰다. 새 표본이 없으면 마지막 포즈를 유지하고 외삽하지 않는다.
 */
export class PosePlayer {
  private samples: PoseSample[] = [];
  private last: AvatarPoseView | null = null;

  get size() {
    return this.samples.length;
  }

  /** 새 포즈면 넣고 true. 같은 객체·같은 촬영 시각은 무시한다. ID 교정 차수가 바뀌면 이전 표본을 버린다. */
  push(pose: AvatarPoseView): boolean {
    if (pose === this.last) return false;
    this.last = pose;
    if (this.samples.length > 0 && this.samples[0]!.identityRevision !== pose.identityRevision) {
      this.samples = [];
    }
    if (this.samples.some((s) => s.captureTimeMs === pose.captureTimeMs)) return false;
    const sample = poseSample(pose);
    const at = this.samples.findIndex((s) => s.captureTimeMs > sample.captureTimeMs);
    if (at < 0) this.samples.push(sample);
    else this.samples.splice(at, 0, sample);
    if (this.samples.length > POSE_BUFFER_SIZE) this.samples.shift();
    return true;
  }

  reset() {
    this.samples = [];
    this.last = null;
  }

  frame(now: number, delayMs: number): PoseFrame | null {
    const samples = this.samples;
    if (samples.length === 0) return null;
    const offset = Math.min(...samples.map((s) => s.receivedAt - s.captureTimeMs));
    const playback = now - offset - delayMs;
    const first = samples[0]!;
    if (playback <= first.captureTimeMs) return { a: first, b: first, t: 0 };
    for (let i = samples.length - 1; i >= 0; i--) {
      const a = samples[i]!;
      if (a.captureTimeMs > playback) continue;
      const b = samples[i + 1];
      if (!b) return { a, b: a, t: 0 };
      return { a, b, t: (playback - a.captureTimeMs) / (b.captureTimeMs - a.captureTimeMs) };
    }
    return { a: first, b: first, t: 0 };
  }
}

export interface PoseTarget {
  bones: readonly Bone[];
  /** 불러올 때 저장한 바인드(휴지) 회전. null 관절에 둔다. */
  bind: readonly Quaternion[];
  pelvis: Bone;
}

const rootQuaternion = new Quaternion();
const chain = new Matrix4();
const pelvisAt = new Vector3();

/**
 * 관절 회전을 뼈에 넣고, 감싼 그룹(poseGroup)을 돌린 뒤 pelvis 뼈가 target(poseGroup 부모 좌표)에 오도록 옮긴다.
 * 노드 이동·크기(체형)는 glTF 값 그대로 둔다. target 은 Tier 0 pelvis_xyz 를 Three 로 바꾼 값이다.
 */
export function applyPose(
  rig: PoseTarget,
  poseGroup: Object3D,
  frame: PoseFrame,
  target: Vector3,
): void {
  const { a, b, t } = frame;
  rig.bones.forEach((bone, i) => {
    bone.quaternion.slerpQuaternions(a.joints[i] ?? rig.bind[i]!, b.joints[i] ?? rig.bind[i]!, t);
  });
  rootQuaternion.slerpQuaternions(a.root, b.root, t);
  poseGroup.quaternion.multiplyQuaternions(WORLD_TO_THREE_QUATERNION, rootQuaternion);
  chain.identity();
  for (let node: Object3D | null = rig.pelvis; node && node !== poseGroup; node = node.parent) {
    node.updateMatrix();
    chain.premultiply(node.matrix);
  }
  pelvisAt.setFromMatrixPosition(chain).applyQuaternion(poseGroup.quaternion);
  poseGroup.position.copy(target).sub(pelvisAt);
}
