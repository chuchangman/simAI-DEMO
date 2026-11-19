import { zoneOf } from '@/__tests__/features/zones/zoneFixture';
import type { SpatialViewportValue } from '@/features/layout/SpatialViewportHost';
import { useZoneTarget } from '@/features/zones/useZoneTarget';
import { NEW_KEY } from '@/features/zones/zoneEditModel';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const zones = [
  zoneOf({ zoneId: 'z-02', name: '단상', min: [0, 0, 0], max: [2, 2, 1] }),
  zoneOf({ zoneId: 'z-04', name: '개구부', min: [5, 1, 0], max: [8, 4, 2] }),
];

const viewportOf = (selectedZoneId: string | null) =>
  ({
    zones,
    selectedZoneId,
    selectTarget: vi.fn(),
    clearSelection: vi.fn(),
  }) as unknown as SpatialViewportValue;

/** 처음 그린 때의 대상 키와, 끝난 뒤의 대상. */
function renderTarget(selectedZoneId: string | null, pickedSurfaceZone: string | null) {
  const first: string[] = [];
  const { result } = renderHook(() => {
    const target = useZoneTarget(viewportOf(selectedZoneId), pickedSurfaceZone);
    first.push(target.key);
    return target;
  });
  return { first: first[0]!, result };
}

describe('useZoneTarget 처음 고른 대상', () => {
  it('아무것도 고르지 않았으면 새 구역이다', () => {
    const { first } = renderTarget(null, null);
    expect(first).toBe(NEW_KEY);
  });

  it('구역이 골라져 있으면 처음 그릴 때부터 그 구역이다', () => {
    const { first } = renderTarget('z-04', null);
    expect(first).toBe('z-04');
  });

  it('이어진 작업면이 골라져 있으면 처음 그릴 때부터 그 구역을 연다', () => {
    const { first } = renderTarget(null, 'z-02');
    expect(first).toBe('z-02');
  });

  it('구역과 작업면이 함께 골라져 있으면 구역이 먼저다', () => {
    const { first, result } = renderTarget('z-04', 'z-02');
    expect(first).toBe('z-04');
    expect(result.current.zone?.zoneId).toBe('z-04');
  });
});
