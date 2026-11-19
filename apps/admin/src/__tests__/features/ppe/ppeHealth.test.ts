import { PPE_RECEIPT_STALE_MS, ppeReceipt } from '@/features/ppe/ppeHealth';
import { useSustained } from '@/features/ppe/usePpeReceipt';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// PPE 가 조용히 꺼진 상태 안내(S15P31A101-634).
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const T = 1_760_342_400_000;

function view(snapshotAt: number, lastReceived?: number | null) {
  return {
    tier0_source_id: 'tier0-01',
    snapshot_at_ms: snapshotAt,
    people: [],
    ...(lastReceived === undefined ? {} : { last_received_at_ms: lastReceived }),
  };
}

describe('PPE 상태 수신', () => {
  it('어느 Tier 0 든 10초 안에 받았으면 ok, 넘으면 stale', () => {
    expect(ppeReceipt([view(T, T - PPE_RECEIPT_STALE_MS)])).toBe('ok');
    expect(ppeReceipt([view(T, T - PPE_RECEIPT_STALE_MS - 1)])).toBe('stale');
    expect(ppeReceipt([view(T, T - 60_000), view(T, T - 500)])).toBe('ok');
  });

  it('받은 적 없음(null)·스냅샷 없음은 stale, 응답 전이거나 이전 EC2(칸 없음)는 unknown', () => {
    expect(ppeReceipt([view(T, null)])).toBe('stale');
    expect(ppeReceipt([])).toBe('stale');
    expect(ppeReceipt(undefined)).toBe('unknown');
    expect(ppeReceipt([view(T)])).toBe('unknown');
  });
});

describe('useSustained', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('조건이 정한 시간 동안 이어져야 참이고, 끊기면 처음부터 다시 센다', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ on }) => useSustained(on, 15_000), {
      initialProps: { on: true },
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(result.current).toBe(false);
    rerender({ on: false });
    rerender({ on: true });
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });
});
