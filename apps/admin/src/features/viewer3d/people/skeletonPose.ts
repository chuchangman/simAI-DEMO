import {
  trackPlacement,
  type SkeletonView,
  type TrackView,
} from '@/features/viewer3d/data/spatialFrame';
import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';

// -56 Tier 0 골격 아바타의 표시 계산(명세 13.1·13.2). 렌더러와 떨어진 순수 함수라 시험할 수 있다.
// 관절 좌표의 정본은 World 계약 skeleton 이다. 여기서는 표시 모양(막대·관절 구)만 만들고 원본 값을 바꾸거나 채우지 않는다.

/** 관절 하나의 표시. MISSING 은 그리지 않는다(좌표 없음·UNAVAILABLE, 지어내지 않음). */
export type JointLook = 'SOLID' | 'FADED' | 'MISSING';
export type DrawnLook = Exclude<JointLook, 'MISSING'>;

/** COCO17 순서(contracts defs joint_layout). HALPE26 도 앞 17개가 같은 순서다. */
export const COCO = {
  nose: 0,
  lEye: 1,
  rEye: 2,
  lEar: 3,
  rEar: 4,
  lShoulder: 5,
  rShoulder: 6,
  lElbow: 7,
  rElbow: 8,
  lWrist: 9,
  rWrist: 10,
  lHip: 11,
  rHip: 12,
  lKnee: 13,
  rKnee: 14,
  lAnkle: 15,
  rAnkle: 16,
} as const;

const C = COCO;
const FACE = [C.nose, C.lEye, C.rEye, C.lEar, C.rEar] as const;
/** 관절 구를 그리는 몸 관절. 얼굴 관절은 머리 구 하나로 묶는다. */
const BODY_JOINTS = [
  C.lShoulder,
  C.rShoulder,
  C.lElbow,
  C.rElbow,
  C.lWrist,
  C.rWrist,
  C.lHip,
  C.rHip,
  C.lKnee,
  C.rKnee,
  C.lAnkle,
  C.rAnkle,
] as const;
/** 관절 사이 막대(어깨·골반 가로대, 옆구리, 팔, 다리). */
export const COCO_BONES: readonly (readonly [number, number])[] = [
  [C.lShoulder, C.rShoulder],
  [C.lHip, C.rHip],
  [C.lShoulder, C.lHip],
  [C.rShoulder, C.rHip],
  [C.lShoulder, C.lElbow],
  [C.lElbow, C.lWrist],
  [C.rShoulder, C.rElbow],
  [C.rElbow, C.rWrist],
  [C.lHip, C.lKnee],
  [C.lKnee, C.lAnkle],
  [C.rHip, C.rKnee],
  [C.rKnee, C.rAnkle],
];

/** 막대가 이보다 적게 남으면 사람 모양이 되지 않아 골격 대신 기본 캡슐을 그린다. */
export const MIN_SKELETON_BONES = 4;
/** 지원하는 관절 배열. MHR70·MHR_NATIVE 는 -65(HMR) 범위라 골격으로 그리지 않는다. */
const SUPPORTED_LAYOUTS = new Set<SkeletonView['layout']>(['COCO17', 'HALPE26']);

/** 표시 반지름(m). 관절 좌표가 아니라 모양만 정한다. */
export const SKELETON_RADIUS = { limb: 0.045, spine: 0.1, joint: 0.06, head: 0.11 } as const;
/**
 * 발 막대를 그리는 발목-지지면 높이 차의 상한(m). 디딤발(발목 약 0.08 m)은 닿게 보이고, 들어 올린 발·모순된 높이에는 그리지 않는다.
 * 표시 규칙이지 접지 판정이 아니다(판정은 Tier 0 ContactEstimator, 명세 5.2).
 */
export const FOOT_CONTACT_MAX_M = 0.15;

/**
 * 관절 하나를 어떻게 보일지(명세 13.2 관절 가시성이 거짓이면 흐리게).
 * 좌표가 없거나 UNAVAILABLE → 그리지 않는다. UNCERTAIN·안 보임·Tier 1 추정(inferred) → 흐리게. 나머지 → 실선.
 */
export function jointLook(skeleton: SkeletonView, index: number): JointLook {
  const point = skeleton.joints[index];
  const validity = skeleton.validity[index];
  if (!point || validity === undefined || validity === 'UNAVAILABLE') return 'MISSING';
  if (validity === 'UNCERTAIN') return 'FADED';
  if (skeleton.jointVisible[index] !== true || skeleton.jointSource[index] !== 'observed') {
    return 'FADED';
  }
  return 'SOLID';
}

const RANK: Record<JointLook, number> = { SOLID: 0, FADED: 1, MISSING: 2 };
/** 여러 관절로 만든 모양은 가장 나쁜 관절을 따른다. */
const worst = (looks: readonly JointLook[]): JointLook =>
  looks.reduce<JointLook>((a, b) => (RANK[b] > RANK[a] ? b : a), 'SOLID');

/** 배열 길이가 맞고 지원하는 배열인지. 틀린 문서는 고치지 않고 골격을 쓰지 않는다. */
function wellFormed(skeleton: SkeletonView): boolean {
  const n = skeleton.joints.length;
  return (
    SUPPORTED_LAYOUTS.has(skeleton.layout) &&
    n >= 17 &&
    skeleton.jointVisible.length === n &&
    skeleton.validity.length === n &&
    skeleton.jointSource.length === n
  );
}

/** 그릴 수 있는 막대 수(양 끝 관절이 모두 있어야 한다). */
export function drawableBoneCount(skeleton: SkeletonView): number {
  if (!wellFormed(skeleton)) return 0;
  return COCO_BONES.filter(
    ([a, b]) => jointLook(skeleton, a) !== 'MISSING' && jointLook(skeleton, b) !== 'MISSING',
  ).length;
}

/**
 * 이 Track 을 골격으로 그릴지. 이번 표본이 관측(OBSERVED)이고 3D 위치(접지점·골반)가 있으며 막대가 충분할 때만.
 * PREDICTED·UNKNOWN 은 이번 시각의 관측이 없어 관절이 왔더라도 지금 자세로 보이지 않게 기본 캡슐로 둔다
 * (PREDICTED·UNKNOWN 에 skeleton 을 싣는지는 AI-2 계약 확인 전이다. 확인되기 전까지 보수적으로 쓰지 않는다).
 */
export function skeletonUsable(track: TrackView): boolean {
  if (!track.skeleton || track.observationState !== 'OBSERVED') return false;
  if (trackPlacement(track).basis === 'XY_ONLY') return false;
  return drawableBoneCount(track.skeleton) >= MIN_SKELETON_BONES;
}

export interface SkeletonSegment {
  /** 루트(발 위치) 기준 Three 좌표(m). */
  from: ThreePoint;
  to: ThreePoint;
  radius: number;
  look: DrawnLook;
}

export interface SkeletonBall {
  at: ThreePoint;
  radius: number;
  look: DrawnLook;
}

/** 안전모·조끼를 맞출 때 쓰는 기준점. head 는 얼굴 관절 평균(머리 구의 중심)이다. */
export type SkeletonAnchorKey =
  'head' | 'nose' | 'lEar' | 'rEar' | 'lShoulder' | 'rShoulder' | 'lHip' | 'rHip';
/** 루트(발 위치) 기준 Three 좌표. 그릴 수 없는(없거나 UNAVAILABLE) 관절은 없다. */
export type SkeletonAnchors = Readonly<Partial<Record<SkeletonAnchorKey, ThreePoint>>>;

const ANCHOR_JOINTS = {
  nose: C.nose,
  lEar: C.lEar,
  rEar: C.rEar,
  lShoulder: C.lShoulder,
  rShoulder: C.rShoulder,
  lHip: C.lHip,
  rHip: C.rHip,
} as const;

export interface SkeletonFigure {
  segments: readonly SkeletonSegment[];
  balls: readonly SkeletonBall[];
  /** 그리지 않은(없거나 UNAVAILABLE) 관절 수. 모양으로 채우지 않았다는 기록이다. */
  missingJoints: number;
  /** 사람에게 붙이는 장비(안전모·조끼)의 기준점. */
  anchors: SkeletonAnchors;
}

const relative = (point: ThreePoint, root: ThreePoint) =>
  [point[0] - root[0], point[1] - root[1], point[2] - root[2]] as unknown as ThreePoint;
const mid = (a: ThreePoint, b: ThreePoint) =>
  [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as unknown as ThreePoint;

/**
 * 골격 모양을 루트(아바타 발 위치, Three) 기준 좌표로 만든다. 관절은 World 위치 그대로다(접지점에 맞추려 옮기지 않는다:
 * 발목과 접지점의 차이는 Tier 0 발 위치 지표라 화면에서 지우지 않는다). World → Three 는 공통 어댑터만 쓴다.
 * 쓸 수 없는 골격이면 null.
 */
export function skeletonFigure(
  skeleton: SkeletonView,
  root: ThreePoint,
  /** 확인된 지지면 높이(World Z, m). 있으면 실선 발목에서 그 높이까지 흐린 발 막대를 그린다(명세 13.2 발 정렬). */
  supportZ: number | null = null,
): SkeletonFigure | null {
  if (drawableBoneCount(skeleton) < MIN_SKELETON_BONES) return null;
  const looks = skeleton.joints.map((_, i) => jointLook(skeleton, i));
  const at = (i: number) => relative(worldToThree(skeleton.joints[i]!), root);
  const segments: SkeletonSegment[] = [];
  const balls: SkeletonBall[] = [];

  for (const [a, b] of COCO_BONES) {
    const look = worst([looks[a]!, looks[b]!]);
    if (look !== 'MISSING')
      segments.push({ from: at(a), to: at(b), radius: SKELETON_RADIUS.limb, look });
  }

  const shoulders = [C.lShoulder, C.rShoulder];
  const hips = [C.lHip, C.rHip];
  const shoulderLook = worst(shoulders.map((i) => looks[i]!));
  const hipLook = worst(hips.map((i) => looks[i]!));
  const neck = shoulderLook !== 'MISSING' ? mid(at(C.lShoulder), at(C.rShoulder)) : null;
  // 몸통은 어깨 가운데에서 골반 가운데까지의 굵은 막대로 보인다(네 관절이 모두 있을 때만).
  if (neck && hipLook !== 'MISSING') {
    segments.push({
      from: neck,
      to: mid(at(C.lHip), at(C.rHip)),
      radius: SKELETON_RADIUS.spine,
      look: worst([shoulderLook, hipLook]) as DrawnLook,
    });
  }

  for (const i of BODY_JOINTS) {
    const look = looks[i]!;
    if (look !== 'MISSING') balls.push({ at: at(i), radius: SKELETON_RADIUS.joint, look });
  }

  // 발 정렬(명세 13.2)은 관절을 옮기지 않고(5.2 발목은 접지점이 아니다) 확인된 지지면까지 흐린 발 막대로만 잇는다.
  // 막대 길이가 곧 관측 발목과 지지면의 차이라 오차를 가리지 않는다. 실선(VALID·관측) 발목만 쓴다.
  if (supportZ !== null) {
    for (const i of [C.lAnkle, C.rAnkle]) {
      const ankle = skeleton.joints[i];
      if (looks[i] !== 'SOLID' || !ankle) continue;
      const lift = ankle[2] - supportZ;
      if (!(lift > 0 && lift <= FOOT_CONTACT_MAX_M)) continue;
      segments.push({
        from: at(i),
        to: relative(worldToThree(worldPoint(ankle[0], ankle[1], supportZ)), root),
        radius: SKELETON_RADIUS.limb,
        look: 'FADED',
      });
    }
  }

  // 머리는 좌표가 있는 얼굴 관절의 가운데 구 하나. 얼굴 관절이 하나도 없으면 머리를 그리지 않는다.
  const face = FACE.filter((i) => looks[i] !== 'MISSING');
  const anchors: Partial<Record<SkeletonAnchorKey, ThreePoint>> = {};
  for (const [key, joint] of Object.entries(ANCHOR_JOINTS) as [SkeletonAnchorKey, number][]) {
    if (looks[joint] !== 'MISSING') anchors[key] = at(joint);
  }
  if (face.length > 0) {
    const points = face.map(at);
    const head = points
      .reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0])
      .map((v) => v / points.length) as unknown as ThreePoint;
    anchors.head = head;
    const headLook = worst(face.map((i) => looks[i]!)) as DrawnLook;
    balls.push({ at: head, radius: SKELETON_RADIUS.head, look: headLook });
    if (neck) {
      segments.push({
        from: neck,
        to: head,
        radius: SKELETON_RADIUS.limb,
        look: worst([shoulderLook, headLook]) as DrawnLook,
      });
    }
  }

  return {
    segments,
    balls,
    missingJoints: looks.slice(0, 17).filter((look) => look === 'MISSING').length,
    anchors,
  };
}
