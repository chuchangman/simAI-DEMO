import { trackPlacement, type TrackView } from '@/features/viewer3d/data/spatialFrame';
import { toWorldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';

// 사람 표시용 계산. 렌더러와 떨어진 순수 함수라 시험할 수 있다.
// 위치의 정본은 Provider 의 World 값이다. 여기서 만드는 보간·방향·걷기 가중치는 화면 표시용이고 Store 로 되돌리지 않는다.

/** 아바타 골반 높이(m, 발 기준). 골반 기준 배치에서 몸을 놓을 때만 쓴다. 접지를 확정하는 값이 아니다. */
export const AVATAR_PELVIS_HEIGHT_M = 0.95;
/** 이보다 멀리 한 번에 옮겨지면 보간하지 않고 바로 옮긴다(재접속·ID 교정·순간이동). */
export const SNAP_DISTANCE_M = 1.5;
/** 이보다 느리면 걷기 동작을 하지 않는다(m/s). */
export const WALK_SPEED_MIN = 0.15;
/** 마지막 World 표본이 이보다 오래되면 걷기를 멈춘다(ms). 오래됨 판정이 아니라 다리가 헛도는 것을 막는 표시 규칙이다. */
export const WALK_FRESH_MS = 400;
/** 위치·방향·걷기 가중치가 목표로 다가가는 빠르기(1/s). 프레임 간격과 상관없이 같은 곡선이 된다. */
export const POSITION_RATE = 12;
export const YAW_RATE = 8;
export const WALK_RATE = 6;

export type PoseBasis =
  | 'GROUND_ANCHOR'
  | 'GROUND_ANCHOR_UNCERTAIN'
  | 'PELVIS'
  /** 이번에는 3D 위치가 없어 같은 Track 의 마지막 유효 3D 위치에 둔다. 새 관측이 아니다. */
  | 'LAST_VALID'
  /** 3D 위치를 한 번도 받지 못했다. 높이를 지어내지 않고 수평 위치만 표시한다. */
  | 'XY_ONLY';

export interface PersonPose {
  /** BODY 는 아바타, COLUMN 은 높이를 모르는 세로 표식. */
  kind: 'BODY' | 'COLUMN';
  /** BODY 의 발 위치(Three). COLUMN 이면 null. */
  feet: ThreePoint | null;
  /** COLUMN 의 수평 위치(Three x, z). BODY 이면 null. */
  columnXz: readonly [number, number] | null;
  basis: PoseBasis;
  groundConfirmed: boolean;
  /** 이번 표본이 새로 관측한 3D 위치를 담았는지. 마지막 유효 위치를 다시 쓴 경우 false. */
  fresh: boolean;
  /** Three 수평 진행 방향(yaw, rad, +Z 가 0). 계약 velocity 가 있고 관측 중일 때만. */
  heading: number | null;
  /** 계약 velocity 의 수평 속력(m/s). 관측 중이 아니거나 없으면 0. */
  speed: number;
}

/** World 방향 벡터를 Three 수평 yaw 로. 축 변환은 -38 어댑터 한 곳을 그대로 쓴다(선형이라 방향에도 맞다). */
function headingOf(velocity: readonly [number, number, number] | null) {
  const v = velocity ? toWorldPoint([...velocity]) : null;
  if (!v) return { heading: null, speed: 0 };
  const [dx, , dz] = worldToThree(v);
  const speed = Math.hypot(dx, dz);
  return speed > 1e-6 ? { heading: Math.atan2(dx, dz), speed } : { heading: null, speed: 0 };
}

/**
 * 이번 표본으로 사람을 어디에 둘지 정한다(명세 13.2).
 * 접지 확인 → 발을 접지점에, 골반만 → 골반에서 아바타 골반 높이만큼 내린 곳(접지 미확인), 불확실 접지점 → 발을 그 점에.
 * 3D 가 없으면 같은 Track 의 마지막 유효 3D 위치(lastValidFeet)를 쓰고, 그것도 없으면 세로 표식만 둔다. Z 를 0 으로 채우지 않는다.
 */
export function personPose(track: TrackView, lastValidFeet: ThreePoint | null): PersonPose {
  const placement = trackPlacement(track);
  const observing = track.observationState === 'OBSERVED';
  const motion = observing ? headingOf(track.velocity) : { heading: null, speed: 0 };
  const unknown = track.observationState === 'UNKNOWN';

  if (!unknown && placement.basis !== 'XY_ONLY') {
    const three = worldToThree(placement.world);
    const feet =
      placement.basis === 'PELVIS'
        ? ([three[0], three[1] - AVATAR_PELVIS_HEIGHT_M, three[2]] as ThreePoint)
        : three;
    return {
      kind: 'BODY',
      feet,
      columnXz: null,
      basis: placement.basis,
      groundConfirmed: placement.groundConfirmed,
      fresh: true,
      ...motion,
    };
  }
  // UNKNOWN 은 이번 좌표를 새 관측으로 쓰지 않고 마지막 유효 위치에 멈춘다.
  if (lastValidFeet) {
    return {
      kind: 'BODY',
      feet: lastValidFeet,
      columnXz: null,
      basis: 'LAST_VALID',
      groundConfirmed: false,
      fresh: false,
      heading: null,
      speed: 0,
    };
  }
  const [x, y] = track.positionXy;
  // 수평 축만 바꾼다(World +Y → Three -Z). 높이는 쓰지 않는다.
  return {
    kind: 'COLUMN',
    feet: null,
    columnXz: [x, 0 - y],
    basis: 'XY_ONLY',
    groundConfirmed: false,
    fresh: false,
    heading: null,
    speed: 0,
  };
}

/** 계약 velocity 가 없을 때, 연속한 두 관측 발 위치로 표시용 방향·속력을 구한다. 간격이 비정상이면 null. */
export function headingFromSamples(prev: ThreePoint, next: ThreePoint, dtMs: number) {
  if (!(dtMs > 0 && dtMs <= 1000)) return null;
  const dx = next[0] - prev[0];
  const dz = next[2] - prev[2];
  const distance = Math.hypot(dx, dz);
  if (distance < 0.01) return { heading: null, speed: 0 };
  return { heading: Math.atan2(dx, dz), speed: distance / (dtMs / 1000) };
}

/** 보간하지 않고 바로 옮겨야 하는지. 처음 나타남·표시 종류 변경·ID 교정·먼 이동. */
export function needsSnap(
  prev: PersonPose | null,
  next: PersonPose,
  revisionChanged: boolean,
): boolean {
  if (!prev || revisionChanged || prev.kind !== next.kind) return true;
  if (next.kind === 'COLUMN' || !prev.feet || !next.feet) return true;
  const [a, b] = [prev.feet, next.feet];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > SNAP_DISTANCE_M;
}

/** 목표로 지수적으로 다가간다. 넘어가지 않고, 프레임을 나눠 돌려도 결과가 같다. */
export const approachFactor = (dtSec: number, rate: number) =>
  1 - Math.exp(-rate * Math.max(0, dtSec));

export function approach(current: number, target: number, dtSec: number, rate: number) {
  return current + (target - current) * approachFactor(dtSec, rate);
}

/** 각도를 가까운 쪽으로 돌린다. 결과는 -π~π 로 감싼다(값이 끝없이 커지지 않게). */
export function approachAngle(current: number, target: number, dtSec: number, rate: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const next = current + delta * approachFactor(dtSec, rate);
  return Math.atan2(Math.sin(next), Math.cos(next));
}

export interface WalkInput {
  speed: number;
  observationState: TrackView['observationState'];
  connectionOpen: boolean;
  /** 마지막 World 표본을 받은 지 지난 시간(ms). */
  frameAgeMs: number;
  /** 지금 표시가 새 관측인지(마지막 유효 위치에 멈춘 것이면 false). */
  fresh: boolean;
}

/** 걷기 동작을 할지. 관측 중이고, 연결돼 있고, 표본이 최근이고, 실제로 움직일 때만. */
export function isWalking({
  speed,
  observationState,
  connectionOpen,
  frameAgeMs,
  fresh,
}: WalkInput) {
  return (
    fresh &&
    connectionOpen &&
    observationState === 'OBSERVED' &&
    frameAgeMs <= WALK_FRESH_MS &&
    speed >= WALK_SPEED_MIN
  );
}

export type PersonTone = 'observed' | 'predicted' | 'unknown';

export function personTone(track: TrackView): PersonTone {
  if (track.observationState === 'UNKNOWN') return 'unknown';
  return track.observationState === 'PREDICTED' ? 'predicted' : 'observed';
}
