import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { harnessPpe, readPpeMode, useHarnessPpe } from '@/features/viewer3d/dev-harness/harnessPpe';
import { scenarioTick } from '@/features/viewer3d/dev-harness/scenarios';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T0 = 1_760_342_400_000;
const ids = ['a', 'b', 'c', 'd', 'e'];

describe('readPpeMode', () => {
  it('?ppe=fixed|cycle 만 켜고 그 밖에는 끈다', () => {
    expect(readPpeMode('?ppe=fixed')).toBe('fixed');
    expect(readPpeMode('?source=crowd&ppe=CYCLE')).toBe('cycle');
    expect(readPpeMode('?ppe=1')).toBe('off');
    expect(readPpeMode('')).toBe('off');
  });
});

describe('harnessPpe', () => {
  it('사람 순서대로 상태가 한 칸씩 어긋나고 안전모·조끼를 따로 준다', () => {
    const { helmets, vests } = harnessPpe(ids, 0);
    expect([helmets.a, vests.a]).toEqual(['WORN', 'WORN']);
    expect([helmets.b, vests.b]).toEqual(['WORN', 'NOT_WORN']);
    expect([helmets.c, vests.c]).toEqual(['NOT_WORN', 'WORN']);
    expect([helmets.d, vests.d]).toEqual(['UNKNOWN', 'UNKNOWN']);
    // 다섯 번째는 다시 처음 상태다.
    expect([helmets.e, vests.e]).toEqual(['WORN', 'WORN']);
  });

  it('단계가 오르면 상태가 한 칸 돈다', () => {
    expect(harnessPpe(ids, 1).vests.a).toBe('NOT_WORN');
  });
});

describe('useHarnessPpe', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  function worldStore() {
    const store = createSpatialDataStore();
    store.getState().reset('mock:normal');
    for (const out of scenarioTick('normal', 3, T0)) {
      if (out.type === 'message') store.getState().ingest(out.raw, Date.now());
    }
    return store;
  }

  it('off 면 상태 없음(undefined)이다', () => {
    const { result } = renderHook(() => useHarnessPpe(worldStore(), 'off'));
    expect(result.current).toBeUndefined();
  });

  it('fixed 는 지금 사람들에게 정해진 상태를 주고 시간이 지나도 그대로다', async () => {
    const store = worldStore();
    const { result } = renderHook(() => useHarnessPpe(store, 'fixed'));
    expect(Object.keys(result.current?.helmets ?? {})).toEqual(['w-0001', 'w-0002', 'w-0003']);
    expect(Object.keys(result.current?.vests ?? {})).toEqual(['w-0001', 'w-0002', 'w-0003']);
    const first = result.current;
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(first);
  });

  it('cycle 은 일정 간격마다 상태가 돈다', async () => {
    const store = worldStore();
    const { result } = renderHook(() => useHarnessPpe(store, 'cycle'));
    expect(result.current?.vests['w-0001']).toBe('WORN');
    await act(async () => void vi.advanceTimersByTime(2500));
    expect(result.current?.vests['w-0001']).toBe('NOT_WORN');
  });
});
