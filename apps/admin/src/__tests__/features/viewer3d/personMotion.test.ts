import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import type { TrackView } from '@/features/viewer3d/data/spatialFrame';
import { scenarioWorld, type ScenarioKey } from '@/features/viewer3d/dev-harness/scenarios';
import {
  approach,
  approachAngle,
  AVATAR_PELVIS_HEIGHT_M,
  headingFromSamples,
  isWalking,
  needsSnap,
  personPose,
  personTone,
  WALK_FRESH_MS,
  type PersonPose,
} from '@/features/viewer3d/people/personMotion';
import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;

function track(key: ScenarioKey, tick: number, id: string): TrackView {
  const result = adaptMessage(scenarioWorld(key, tick, T0), 0);
  if (result.kind !== 'world') throw new Error(result.kind);
  return result.frame.tracks.find((t) => t.worldId === id)!;
}

const close = (values: readonly number[]) => values.map((v) => Math.round(v * 1e9) / 1e9 + 0);

describe('personPose 배치', () => {
  it('접지가 확인되면 발을 접지점에 두고 World → Three 를 한 번만 거친다', () => {
    const t = track('normal', 5, 'w-0001');
    const pose = personPose(t, null);
    expect(pose).toMatchObject({
      kind: 'BODY',
      basis: 'GROUND_ANCHOR',
      groundConfirmed: true,
      fresh: true,
    });
    expect(pose.feet).toEqual(worldToThree(t.groundAnchor!));
    // -5 같은 오프셋 없이 World (x, y, 0) → Three (x, 0, -y).
    expect(close(pose.feet!)).toEqual(close([t.groundAnchor![0], 0, -t.groundAnchor![1]]));
  });

  it('계약 velocity 로 진행 방향을 정한다(World +X → yaw π/2, +Y → yaw ±π)', () => {
    const base = track('normal', 5, 'w-0001');
    expect(personPose({ ...base, velocity: [1, 0, 0] }, null)).toMatchObject({
      heading: Math.PI / 2,
      speed: 1,
    });
    const north = personPose({ ...base, velocity: [0, 2, 0] }, null);
    expect(Math.abs(north.heading!)).toBeCloseTo(Math.PI, 9);
    expect(north.speed).toBe(2);
    expect(personPose({ ...base, velocity: null }, null)).toMatchObject({
      heading: null,
      speed: 0,
    });
  });

  it('골반만 있으면 골반 높이만큼 내려 두고 접지 미확인이다', () => {
    const base = track('normal', 5, 'w-0001');
    const pose = personPose({ ...base, contactValidity: 'UNCERTAIN' }, null);
    expect(pose).toMatchObject({ basis: 'PELVIS', groundConfirmed: false });
    const pelvis = worldToThree(base.pelvis!);
    expect(close(pose.feet!)).toEqual(
      close([pelvis[0], pelvis[1] - AVATAR_PELVIS_HEIGHT_M, pelvis[2]]),
    );
  });

  it('예측 중에는 걷기 방향·속력을 쓰지 않는다', () => {
    const t = track('observation-loss', 25, 'w-0002');
    const pose = personPose(t, null);
    expect(pose).toMatchObject({
      basis: 'GROUND_ANCHOR_UNCERTAIN',
      heading: null,
      speed: 0,
      groundConfirmed: false,
    });
    expect(personTone(t)).toBe('predicted');
  });

  it('높이를 모르면 마지막 유효 3D 위치에 두고, 그것도 없으면 높이 없는 세로 표식만 둔다', () => {
    const t = track('observation-loss', 35, 'w-0002');
    const last = worldToThree(worldPoint(6.1, 3, 0));
    expect(personPose(t, last)).toMatchObject({
      kind: 'BODY',
      basis: 'LAST_VALID',
      feet: last,
      fresh: false,
    });
    const column = personPose(t, null);
    expect(column).toMatchObject({ kind: 'COLUMN', basis: 'XY_ONLY', feet: null, fresh: false });
    expect(column.columnXz).toEqual([t.positionXy[0], -t.positionXy[1]]);
  });

  it('UNKNOWN 은 이번 좌표를 새 관측으로 쓰지 않는다', () => {
    const t = track('observation-loss', 45, 'w-0002');
    const last = [1, 0, -2] as unknown as ThreePoint;
    expect(personPose(t, last)).toMatchObject({ basis: 'LAST_VALID', feet: last });
    // 3D 좌표가 실린 UNKNOWN 이라도 마지막 유효 위치를 쓴다.
    const withPelvis = { ...track('normal', 5, 'w-0001'), observationState: 'UNKNOWN' as const };
    expect(personPose(withPelvis, last)).toMatchObject({ basis: 'LAST_VALID', feet: last });
  });

  it('관측 손실 시나리오 전체: 마지막 유효 위치를 이어받고 높이를 지어내지 않는다', () => {
    let last: ThreePoint | null = null;
    const kinds: string[] = [];
    for (let tick = 0; tick < 60; tick++) {
      const pose = personPose(track('observation-loss', tick, 'w-0002'), last);
      if (pose.fresh && pose.feet) last = pose.feet;
      const label = `${pose.kind}:${pose.basis}`;
      if (kinds.at(-1) !== label) kinds.push(label);
      if (tick >= 30) expect(pose.feet).toBe(last);
    }
    expect(kinds).toEqual([
      'BODY:GROUND_ANCHOR',
      'BODY:GROUND_ANCHOR_UNCERTAIN',
      'BODY:LAST_VALID',
    ]);
  });

  it('처음부터 높이를 모르는 사람은 끝까지 세로 표식이다', () => {
    let last: ThreePoint | null = null;
    for (let tick = 0; tick < 20; tick++) {
      const pose = personPose(track('invalid-input', tick, 'w-0003'), last);
      if (pose.fresh && pose.feet) last = pose.feet;
      expect(pose.kind).toBe('COLUMN');
    }
    expect(last).toBeNull();
  });
});

describe('표시용 보간', () => {
  it('지수 보간은 목표를 넘지 않고, 프레임을 나눠도 같은 곡선이다', () => {
    const once = approach(0, 1, 0.1, 12);
    const twice = approach(approach(0, 1, 0.05, 12), 1, 0.05, 12);
    expect(twice).toBeCloseTo(once, 12);
    expect(approach(0, 1, 10, 12)).toBeLessThanOrEqual(1);
    expect(approach(0, 1, 0, 12)).toBe(0);
  });

  it('각도는 가까운 쪽으로 돌고 -π~π 로 감싼다', () => {
    // π-0.1 에서 -π+0.1 로: 한 바퀴 돌지 않고 ±π 를 넘어 0.2 rad 만 돈다.
    const half = approachAngle(Math.PI - 0.1, -Math.PI + 0.1, Math.log(2) / 8, 8);
    expect(Math.abs(half)).toBeCloseTo(Math.PI, 6);
    expect(approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 10, 8)).toBeCloseTo(-Math.PI + 0.1, 6);
    let yaw = 0;
    for (let i = 0; i < 200; i++) yaw = approachAngle(yaw, yaw + 1, 1, 8);
    expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('처음·종류 변경·ID 교정·먼 이동이면 바로 옮긴다', () => {
    const body = (x: number): PersonPose => ({
      kind: 'BODY',
      feet: [x, 0, 0] as unknown as ThreePoint,
      columnXz: null,
      basis: 'GROUND_ANCHOR',
      groundConfirmed: true,
      fresh: true,
      heading: null,
      speed: 0,
    });
    expect(needsSnap(null, body(0), false)).toBe(true);
    expect(needsSnap(body(0), body(0.1), false)).toBe(false);
    expect(needsSnap(body(0), body(0.1), true)).toBe(true);
    expect(needsSnap(body(0), body(2), false)).toBe(true);
    expect(
      needsSnap(body(0), { ...body(0), kind: 'COLUMN', feet: null, columnXz: [0, 0] }, false),
    ).toBe(true);
  });

  it('표본 두 개로 방향을 구하되 간격이 비정상이면 쓰지 않는다', () => {
    const a = [0, 0, 0] as unknown as ThreePoint;
    const b = [0.1, 0, 0] as unknown as ThreePoint;
    expect(headingFromSamples(a, b, 100)).toEqual({ heading: Math.PI / 2, speed: 1 });
    expect(headingFromSamples(a, b, 0)).toBeNull();
    expect(headingFromSamples(a, b, 5000)).toBeNull();
    expect(headingFromSamples(a, a, 100)).toEqual({ heading: null, speed: 0 });
  });

  it('걷기는 관측 중·연결·최근 표본·실제 이동일 때만', () => {
    const base = {
      speed: 0.9,
      observationState: 'OBSERVED' as const,
      connectionOpen: true,
      frameAgeMs: 100,
      fresh: true,
    };
    expect(isWalking(base)).toBe(true);
    expect(isWalking({ ...base, speed: 0.05 })).toBe(false);
    expect(isWalking({ ...base, observationState: 'PREDICTED' })).toBe(false);
    expect(isWalking({ ...base, connectionOpen: false })).toBe(false);
    expect(isWalking({ ...base, frameAgeMs: WALK_FRESH_MS + 1 })).toBe(false);
    expect(isWalking({ ...base, fresh: false })).toBe(false);
  });
});
