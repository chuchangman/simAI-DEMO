import { worldPoint, worldToThree, type ThreePoint } from '@/features/viewer3d/worldCoordinates';
import type { RoomLimit } from '@/lib/roomLimit';

// 교실 범위에서 정하는 처음 시점의 순수 계산. 좌표는 World 로 계산해 Three 로 한 번만 바꾼다.

/** 처음 시점: 회전 중심과 카메라 자리(Three 좌표). */
export interface RoomView {
  target: ThreePoint;
  home: ThreePoint;
}

/** 카메라가 방 가운데에서 떨어지는 거리(방 긴 변의 배수). 10m 방이면 앞·오른쪽·위로 10m 씩이다. */
const VIEW_DISTANCE_PER_SIZE = 1;
const TOP_VIEW_DISTANCE_PER_SIZE = 1.25;
/** Three 카메라의 기본 위쪽 축(+Y = World +Z)과 시선 벡터가 평행하지 않도록 두는 미세 Y 오프셋(m). */
const TOP_VIEW_Y_OFFSET = 0.01;

/** 범위 가운데 바닥을 보고, 거리는 긴 변에 비례해 앞(−Y)·오른쪽(+X)·위(+Z)에서 내려다보는 시점. */
export function roomViewOf({ min, max }: RoomLimit): RoomView {
  const [cx, cy, floor] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]] as const;
  const distance = Math.max(max[0] - min[0], max[1] - min[1]) * VIEW_DISTANCE_PER_SIZE;
  return {
    target: worldToThree(worldPoint(cx, cy, floor)),
    home: worldToThree(worldPoint(cx + distance, cy - distance, floor + distance)),
  };
}

/** 범위 가운데 바닥을 바로 위(+Z)에서 수직으로 내려다보는 시점(위에서 보기). */
export function topRoomViewOf({ min, max }: RoomLimit): RoomView {
  const [cx, cy, floor] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]] as const;
  const distance = Math.max(max[0] - min[0], max[1] - min[1]) * TOP_VIEW_DISTANCE_PER_SIZE;
  return {
    target: worldToThree(worldPoint(cx, cy, floor)),
    home: worldToThree(worldPoint(cx, cy - TOP_VIEW_Y_OFFSET, floor + distance)),
  };
}
