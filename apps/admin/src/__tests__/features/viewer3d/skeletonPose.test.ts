import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import type { SkeletonView, TrackView } from '@/features/viewer3d/data/spatialFrame';
import { trackPlacement } from '@/features/viewer3d/data/spatialFrame';
import {
  CROWD_PARTIAL_ID,
  CROWD_PELVIS_ID,
  crowdTrackId,
  scenarioWorld,
} from '@/features/viewer3d/dev-harness/scenarios';
import { personPose } from '@/features/viewer3d/people/personMotion';
import {
  COCO,
  drawableBoneCount,
  FOOT_CONTACT_MAX_M,
  jointLook,
  MIN_SKELETON_BONES,
  skeletonFigure,
  skeletonUsable,
} from '@/features/viewer3d/people/skeletonPose';
import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;

function crowd(tick = 7) {
  const result = adaptMessage(scenarioWorld('crowd', tick, T0), 0);
  if (result.kind !== 'world') throw new Error(result.kind);
  return result.frame.tracks;
}
const trackOf = (id: string, tick = 7): TrackView => crowd(tick).find((t) => t.worldId === id)!;

/** 한 관절만 바꾼 골격 사본. 원본은 건드리지 않는다. */
function withJoint(
  skeleton: SkeletonView,
  index: number,
  patch: Partial<{
    joint: null;
    visible: boolean;
    validity: SkeletonView['validity'][number];
    source: 'observed' | 'inferred';
  }>,
): SkeletonView {
  const copy = {
    ...skeleton,
    joints: [...skeleton.joints],
    jointVisible: [...skeleton.jointVisible],
    validity: [...skeleton.validity],
    jointSource: [...skeleton.jointSource],
  };
  if ('joint' in patch) copy.joints[index] = null;
  if (patch.visible !== undefined) copy.jointVisible[index] = patch.visible;
  if (patch.validity) copy.validity[index] = patch.validity;
  if (patch.source) copy.jointSource[index] = patch.source;
  return copy;
}

const close = (p: readonly number[]) => p.map((v) => Math.round(v * 1e6) / 1e6 + 0);
const looksOf = (figure: NonNullable<ReturnType<typeof skeletonFigure>>) =>
  figure.segments.map((s) => s.look);

describe('관절 표시 규칙(명세 13.2)', () => {
  const full = trackOf(crowdTrackId(0)).skeleton!;

  it('VALID·보임·Tier 0 관측은 실선, UNCERTAIN·안 보임·Tier 1 추정은 흐림, 좌표 없음·UNAVAILABLE 은 그리지 않는다', () => {
    const knee = COCO.lKnee;
    expect(jointLook(full, knee)).toBe('SOLID');
    expect(jointLook(withJoint(full, knee, { validity: 'UNCERTAIN' }), knee)).toBe('FADED');
    expect(jointLook(withJoint(full, knee, { visible: false }), knee)).toBe('FADED');
    expect(jointLook(withJoint(full, knee, { source: 'inferred' }), knee)).toBe('FADED');
    expect(jointLook(withJoint(full, knee, { joint: null }), knee)).toBe('MISSING');
    // 좌표가 있어도 UNAVAILABLE 이면 쓰지 않는다.
    expect(jointLook(withJoint(full, knee, { validity: 'UNAVAILABLE' }), knee)).toBe('MISSING');
  });

  it('온전한 사람은 막대 14개(팔다리·가로대 12 + 몸통 + 목)와 관절 구 13개(몸 12 + 머리)이고, 가려진 귀는 채우지 않는다', () => {
    const track = trackOf(crowdTrackId(0));
    const pose = personPose(track, null);
    const figure = skeletonFigure(track.skeleton!, pose.feet!)!;
    expect(figure.segments).toHaveLength(14);
    expect(figure.balls).toHaveLength(13);
    expect(figure.missingJoints).toBe(1);
    // 머리는 불확실한 귀가 섞여 흐리게, 팔다리는 실선이다.
    expect(figure.balls.at(-1)!.look).toBe('FADED');
    expect(looksOf(figure).filter((l) => l === 'SOLID')).toHaveLength(13);
  });

  it('관절 결손 사람: 손목이 없으면 아래팔을 그리지 않고, 추정 팔꿈치·안 보이는 무릎·불확실 무릎의 막대는 흐리게 그린다', () => {
    const track = trackOf(CROWD_PARTIAL_ID);
    const sk = track.skeleton!;
    expect(jointLook(sk, COCO.lWrist)).toBe('MISSING');
    expect(jointLook(sk, COCO.rWrist)).toBe('MISSING');
    expect(jointLook(sk, COCO.lElbow)).toBe('FADED');
    expect(jointLook(sk, COCO.lKnee)).toBe('FADED');
    expect(jointLook(sk, COCO.rKnee)).toBe('FADED');
    const figure = skeletonFigure(sk, personPose(track, null).feet!)!;
    // 팔다리·가로대 12개 중 아래팔 2개를 뺀 10 + 몸통 + 목.
    expect(figure.segments).toHaveLength(12);
    expect(figure.balls).toHaveLength(11);
    // 왼 위팔(추정), 다리 4개(무릎) → 흐림 5개, 머리·목 흐림 1개.
    expect(looksOf(figure).filter((l) => l === 'FADED')).toHaveLength(6);
  });
});

describe('장비 기준점(anchors, -552)', () => {
  it('그릴 수 있는 관절의 루트 기준 Three 좌표를 준다: 코·귀·어깨·골반과 머리(얼굴 관절 평균)', () => {
    const track = trackOf(crowdTrackId(0));
    const pose = personPose(track, null);
    const { anchors } = skeletonFigure(track.skeleton!, pose.feet!)!;
    const expected = (joint: number) => {
      const three = worldToThree(track.skeleton!.joints[joint]!);
      return close(three.map((v, i) => v - pose.feet![i]!));
    };
    expect(close(anchors.lShoulder!)).toEqual(expected(COCO.lShoulder));
    expect(close(anchors.rHip!)).toEqual(expected(COCO.rHip));
    expect(close(anchors.nose!)).toEqual(expected(COCO.nose));
    expect(anchors.head).toBeDefined();
  });

  it('가려진 관절(귀)은 기준점에 넣지 않는다', () => {
    const track = trackOf(crowdTrackId(0));
    const { anchors } = skeletonFigure(track.skeleton!, personPose(track, null).feet!)!;
    // crowd 의 왼쪽 귀는 UNAVAILABLE 이다(막대 모양 시험과 같다).
    expect(anchors.lEar).toBeUndefined();
    expect(anchors.rEar).toBeDefined();
  });

  it('좌표가 없는 어깨는 기준점에 없다', () => {
    const track = trackOf(crowdTrackId(0));
    const skeleton = withJoint(track.skeleton!, COCO.lShoulder, { joint: null });
    const { anchors } = skeletonFigure(skeleton, personPose(track, null).feet!)!;
    expect(anchors.lShoulder).toBeUndefined();
    expect(anchors.rShoulder).toBeDefined();
  });
});

describe('접지와 원본 보존(명세 13.2, 5.2)', () => {
  it('접지가 확인되면 루트를 접지점에 두고, 관절은 World 높이 그대로다(발목을 접지점에 붙이지 않는다)', () => {
    const track = trackOf(crowdTrackId(0));
    const before = structuredClone(track);
    const pose = personPose(track, null);
    expect(pose.basis).toBe('GROUND_ANCHOR');
    expect(pose.feet).toEqual(worldToThree(track.groundAnchor!));
    const figure = skeletonFigure(track.skeleton!, pose.feet!)!;
    const ankle = track.skeleton!.joints[COCO.lAnkle]!;
    const ball = figure.balls.find((b) => close(b.at)[1] === 0.08);
    expect(ball).toBeDefined();
    // 루트 + 상대 좌표 = World → Three 그대로.
    const absolute = ball!.at.map((v, i) => v + pose.feet![i]!) as unknown as ThreePoint;
    const candidates = [COCO.lAnkle, COCO.rAnkle].map((i) =>
      close(worldToThree(track.skeleton!.joints[i]!)),
    );
    expect(candidates).toContainEqual(close(absolute));
    expect(ankle[2]).toBe(0.08);
    expect(track).toEqual(before);
  });

  it('골반만 있으면 골격은 그리되 루트는 골반 기준이다. 관절 높이는 바꾸지 않는다', () => {
    const track = trackOf(CROWD_PELVIS_ID);
    expect(track.groundAnchor).toBeNull();
    expect(skeletonUsable(track)).toBe(true);
    const pose = personPose(track, null);
    expect(pose).toMatchObject({ basis: 'PELVIS', groundConfirmed: false });
    const figure = skeletonFigure(track.skeleton!, pose.feet!)!;
    const heights = figure.balls.map((b) => close([b.at[1] + pose.feet![1]])[0]);
    // 무릎 0.5, 발목 0.08 등 World Z 그대로(골반 0.95 기준 루트에서 다시 더하면 원래 값).
    expect(heights).toContain(0.08);
    expect(heights).toContain(0.5);
  });

  it('확인된 접지면 실선 발목에서 지지면 높이까지 흐린 발 막대를 잇고, 발목 좌표는 옮기지 않는다', () => {
    const track = trackOf(crowdTrackId(0));
    const feet = personPose(track, null).feet!;
    const plain = skeletonFigure(track.skeleton!, feet)!;
    const withFeet = skeletonFigure(track.skeleton!, feet, 0)!;
    const added = withFeet.segments.filter(
      (s) => !plain.segments.some((p) => JSON.stringify(p) === JSON.stringify(s)),
    );
    expect(added).toHaveLength(2);
    for (const [n, i] of [COCO.lAnkle, COCO.rAnkle].entries()) {
      const [x, y, z] = track.skeleton!.joints[i]!;
      const abs = (p: ThreePoint) => close(p.map((v, k) => v + feet[k]!));
      expect(added[n]!.look).toBe('FADED');
      expect(abs(added[n]!.from)).toEqual(close(worldToThree(worldPoint(x, y, z))));
      expect(abs(added[n]!.to)).toEqual(close(worldToThree(worldPoint(x, y, 0))));
    }
    // 관절 구는 그대로다.
    expect(withFeet.balls).toEqual(plain.balls);
  });

  it('들어 올린 발·지지면보다 낮은 발목·흐린 발목에는 발 막대를 그리지 않는다', () => {
    const track = trackOf(crowdTrackId(0));
    const feet = personPose(track, null).feet!;
    const lift = (dz: number) => {
      const joints = [...track.skeleton!.joints];
      for (const i of [COCO.lAnkle, COCO.rAnkle]) {
        const [x, y] = joints[i]!;
        joints[i] = worldPoint(x, y, dz);
      }
      return { ...track.skeleton!, joints };
    };
    const count = (sk: typeof track.skeleton) => skeletonFigure(sk!, feet, 0)!.segments.length;
    const base = skeletonFigure(track.skeleton!, feet)!.segments.length;
    expect(count(lift(FOOT_CONTACT_MAX_M + 0.05))).toBe(base);
    expect(count(lift(-0.02))).toBe(base);
    const fadedAnkle = withJoint(
      withJoint(track.skeleton!, COCO.lAnkle, { validity: 'UNCERTAIN' }),
      COCO.rAnkle,
      { visible: false },
    );
    expect(count(fadedAnkle)).toBe(base);
  });

  it('접지 필드가 서로 모순되면 확인된 접지로 보지 않는다(inferred 인데 VALID, 지지면 미확인)', () => {
    const track = trackOf(crowdTrackId(0));
    expect(trackPlacement(track).basis).toBe('GROUND_ANCHOR');
    expect(trackPlacement({ ...track, surfaceSource: 'inferred' }).basis).toBe('PELVIS');
    expect(trackPlacement({ ...track, supportSurfaceValidity: 'UNCERTAIN' }).basis).toBe('PELVIS');
    // 출처를 싣지 않은 이전 송신 측 문서는 다른 필드가 모두 VALID 면 그대로 받는다.
    expect(trackPlacement({ ...track, surfaceSource: null }).basis).toBe('GROUND_ANCHOR');
  });
});

describe('골격을 쓰지 않는 경우(기본 캡슐로 폴백)', () => {
  it('예측·확인 불가로 골격이 없는 사람', () => {
    const tracks = crowd();
    expect(tracks.filter(skeletonUsable)).toHaveLength(10);
    for (const id of [crowdTrackId(10), crowdTrackId(11)]) {
      expect(skeletonUsable(tracks.find((t) => t.worldId === id)!)).toBe(false);
    }
  });

  it('UNKNOWN 이면 골격이 있어도 이번 관절을 새 관측처럼 쓰지 않는다', () => {
    const track = { ...trackOf(crowdTrackId(0)), observationState: 'UNKNOWN' as const };
    expect(skeletonUsable(track)).toBe(false);
  });

  it('PREDICTED 이면 골격이 와도 지금 자세처럼 그리지 않는다(AI-2 계약 확인 전 보수적 폴백)', () => {
    const track = { ...trackOf(crowdTrackId(0)), observationState: 'PREDICTED' as const };
    expect(skeletonUsable(track)).toBe(false);
  });

  it('3D 위치(접지점·골반)가 없으면 골격이 있어도 쓰지 않는다(높이를 지어내지 않음)', () => {
    const track = { ...trackOf(crowdTrackId(0)), groundAnchor: null, pelvis: null };
    expect(skeletonUsable(track)).toBe(false);
  });

  it('지원하지 않는 배열(MHR)·길이가 틀린 배열·막대가 너무 적은 골격', () => {
    const base = trackOf(crowdTrackId(0));
    const sk = base.skeleton!;
    expect(skeletonUsable({ ...base, skeleton: { ...sk, layout: 'MHR70' } })).toBe(false);
    expect(drawableBoneCount({ ...sk, validity: sk.validity.slice(0, 16) })).toBe(0);

    let sparse = sk;
    for (const i of [COCO.lShoulder, COCO.rShoulder, COCO.lHip, COCO.lKnee, COCO.rKnee]) {
      sparse = withJoint(sparse, i, { joint: null });
    }
    expect(drawableBoneCount(sparse)).toBeLessThan(MIN_SKELETON_BONES);
    expect(skeletonUsable({ ...base, skeleton: sparse })).toBe(false);
    expect(skeletonFigure(sparse, personPose(base, null).feet!)).toBeNull();
  });
});
