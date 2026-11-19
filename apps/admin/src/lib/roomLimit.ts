// 교실 범위의 순수 계산. 스캔(배경 glTF)이 보이면 스캔 범위를, 없으면 목업 교실을 쓴다. 좌표는 모두 World(m)다.
// three.js 를 끌어오지 않아 첫 화면 모듈(상단 바 등)도 값으로 import 한다(front/CONVENTION.md 「의존 방향」).

type Vec3 = readonly [number, number, number];

/** 읽은 스캔의 World 경계(viewer3d 가 알리는 boundsWorld 와 같은 모양). */
export interface RoomBounds {
  min: Vec3;
  max: Vec3;
}

/** 구역·작업면 상자를 움직일 수 있는 범위(m). */
export interface RoomLimit {
  min: Vec3;
  max: Vec3;
}

/** 스캔이 있어도 상자 높이는 바닥 0 에서 이만큼까지만 쓴다(스캔의 천장 높이를 믿지 않는다). */
const ROOM_HEIGHT_LIMIT_M = 5;

/**
 * 스캔 한 변(x·y)으로 받는 길이(m). 경계는 메시 전체의 상자라 튀는 점 하나에도 커진다.
 * 1m 보다 짧으면 시점 거리가 0 에 가까워 카메라가 중심에 붙고, 50m(교실 테스트베드 10m 의 5배)를 넘으면 튀는 점이 경계를 키운 것으로 본다.
 */
const MIN_SCAN_SIDE_M = 1;
const MAX_SCAN_SIDE_M = 50;

/** 스캔이 없을 때의 범위: 목업 교실 x 0~10 · y 0~10 · z 0~5(viewer3d DEMO_ROOM 과 같은 10×10m). */
export const DEFAULT_ROOM_LIMIT: RoomLimit = { min: [0, 0, 0], max: [10, 10, ROOM_HEIGHT_LIMIT_M] };

/** 교실 범위로 쓸 수 있는 스캔 경계면 그대로, 아니면 null. 값이 모두 유한하고 x·y 한 변이 상식 범위 안이어야 한다. */
export function usableScanBounds(bounds: RoomBounds | null): RoomBounds | null {
  if (!bounds || ![...bounds.min, ...bounds.max].every(Number.isFinite)) return null;
  const sidesInRange = ([0, 1] as const).every((axis) => {
    const side = bounds.max[axis] - bounds.min[axis];
    return side >= MIN_SCAN_SIDE_M && side <= MAX_SCAN_SIDE_M;
  });
  return sidesInRange ? bounds : null;
}

/** 쓸 수 있는 스캔이면 x·y 는 스캔 min~max, z 는 0~5m. 스캔이 없거나 쓸 수 없으면 목업 교실 범위다. */
export function roomLimitFrom(bounds: RoomBounds | null): RoomLimit {
  const scan = usableScanBounds(bounds);
  if (!scan) return DEFAULT_ROOM_LIMIT;
  return {
    min: [scan.min[0], scan.min[1], 0],
    max: [scan.max[0], scan.max[1], ROOM_HEIGHT_LIMIT_M],
  };
}
