import type { RoomBounds } from '@/lib/roomLimit';
import { useHasRoomScan, useRoomBoundsStore, useRoomLimit } from '@/store/roomBounds.store';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const SCAN: RoomBounds = { min: [0, 0, 0], max: [7.2, 5.8, 3] };
const TOO_SMALL: RoomBounds = { min: [0, 0, 0], max: [0.2, 0.2, 3] };

describe('roomBounds.store', () => {
  beforeEach(() => useRoomBoundsStore.setState(useRoomBoundsStore.getInitialState(), true));

  it('처음에는 스캔이 없어 목업 교실 범위를 돌려준다', () => {
    const limit = renderHook(useRoomLimit);
    const hasScan = renderHook(useHasRoomScan);
    expect(useRoomBoundsStore.getState().bounds).toBeNull();
    expect(limit.result.current).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
    expect(hasScan.result.current).toBe(false);
  });

  it('스캔 범위를 넣으면 그 범위를, 비우면 다시 목업 교실 범위를 돌려준다', () => {
    const limit = renderHook(useRoomLimit);
    const hasScan = renderHook(useHasRoomScan);

    act(() => useRoomBoundsStore.getState().set(SCAN));
    expect(limit.result.current).toEqual({ min: [0, 0, 0], max: [7.2, 5.8, 5] });
    expect(hasScan.result.current).toBe(true);

    act(() => useRoomBoundsStore.getState().set(null));
    expect(limit.result.current.max).toEqual([10, 10, 5]);
    expect(hasScan.result.current).toBe(false);
  });

  it('쓸 수 없는 스캔 범위가 들어와도 교실 범위는 목업 교실로 둔다', () => {
    const limit = renderHook(useRoomLimit);
    act(() => useRoomBoundsStore.getState().set(TOO_SMALL));
    expect(limit.result.current).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
  });
});
