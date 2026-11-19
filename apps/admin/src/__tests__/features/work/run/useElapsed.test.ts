import { useElapsed } from '@/features/work/run/useElapsed';
import { useRealtimeStore } from '@/store/realtime.store';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const START = new Date(2026, 10, 11, 9, 0, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START + 65_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useRealtimeStore.getState().reset();
});

describe('useElapsed', () => {
  it('시작한 뒤 흐른 시간을 HH:MM:SS 로 보이고 1초마다 올린다', () => {
    const { result } = renderHook(() => useElapsed(START));
    expect(result.current).toBe('00:01:05');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('00:01:06');
  });

  it('시작 기록이 없으면 00:00:00 이다', () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toBe('00:00:00');
  });

  it('EC2 시계와의 차이만큼 맞춘다(EC2 가 10초 앞서면 10초 더 흐른 것)', () => {
    useRealtimeStore.setState({
      health: { payload: {}, receivedAt: 0, clockOffsetMs: 10_000 } as never,
    });
    const { result } = renderHook(() => useElapsed(START));
    expect(result.current).toBe('00:01:15');
  });
});
