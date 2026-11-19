import { DEMO_ROOM } from '@/features/viewer3d/WorldScene';
import {
  DEFAULT_ROOM_LIMIT,
  roomLimitFrom,
  usableScanBounds,
  type RoomBounds,
} from '@/lib/roomLimit';
import { describe, expect, it } from 'vitest';

const SCAN: RoomBounds = { min: [-1.5, 0.25, -0.1], max: [6.5, 12, 3.4] };
const withMax = (max: [number, number, number]): RoomBounds => ({ min: [0, 0, 0], max });

describe('교실 범위(roomLimitFrom)', () => {
  it('스캔이 없으면 예전 목업 교실 범위(x 0~10 · y 0~10 · z 0~5)다', () => {
    expect(roomLimitFrom(null)).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
    expect(roomLimitFrom(null)).toBe(DEFAULT_ROOM_LIMIT);
  });

  it('목업 교실 범위는 3D 목업 교실(DEMO_ROOM)과 같은 크기다', () => {
    expect(DEFAULT_ROOM_LIMIT.max.slice(0, 2)).toEqual([DEMO_ROOM.sizeX, DEMO_ROOM.sizeY]);
  });

  it('스캔이 있으면 x·y 는 스캔 min~max 이고 z 는 0~5m 다(스캔 높이를 따르지 않는다)', () => {
    expect(roomLimitFrom(SCAN)).toEqual({ min: [-1.5, 0.25, 0], max: [6.5, 12, 5] });
  });

  it('스캔이 10m 보다 작아도 그 범위를 쓴다', () => {
    const small: RoomBounds = { min: [0, 0, 0], max: [4, 3, 2.6] };
    expect(roomLimitFrom(small)).toEqual({ min: [0, 0, 0], max: [4, 3, 5] });
  });

  it.each([
    ['NaN', withMax([Number.NaN, 5, 3])],
    ['무한대', withMax([5, Number.POSITIVE_INFINITY, 3])],
    ['높이가 NaN', withMax([5, 5, Number.NaN])],
    ['x 가 1m 미만', withMax([0.9, 5, 3])],
    ['y 가 0', withMax([5, 0, 3])],
    ['x 가 뒤집힘(max < min)', { min: [5, 0, 0], max: [1, 5, 3] } as RoomBounds],
    ['x 가 50m 초과', withMax([50.1, 5, 3])],
    ['튀는 점이 y 를 키움', withMax([8, 400, 3])],
  ])('쓸 수 없는 스캔(%s)이면 목업 교실 범위로 돌아간다', (_, bounds) => {
    expect(usableScanBounds(bounds)).toBeNull();
    expect(roomLimitFrom(bounds)).toBe(DEFAULT_ROOM_LIMIT);
  });
});

describe('쓸 수 있는 스캔(usableScanBounds)', () => {
  it('없으면 null 이고, 쓸 수 있으면 같은 객체를 돌려준다', () => {
    expect(usableScanBounds(null)).toBeNull();
    expect(usableScanBounds(SCAN)).toBe(SCAN);
  });

  it('한 변이 정확히 1m 와 50m 인 경계까지 받는다', () => {
    expect(usableScanBounds(withMax([1, 50, 3]))).not.toBeNull();
  });

  it('높이(z)는 길이를 따지지 않는다(유한하면 된다)', () => {
    expect(usableScanBounds({ min: [0, 0, -300], max: [5, 5, 300] })).not.toBeNull();
  });
});
