import { DWELL_MS, useDwell } from '@/features/plan/HoverTip';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 2D 지도 위 글자는 같은 대상에 DWELL_MS(0.3초) 머물 때만 말풍선이 된다.

const at = (x: number, y: number) => ({ clientX: x, clientY: y }) as PointerEvent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDwell', () => {
  it('머무름 시간은 300ms 다', () => {
    expect(DWELL_MS).toBe(300);
  });

  it('같은 대상에 300ms 머물면 그 대상과 포인터 자리를 돌려주고, 그 전에는 돌려주지 않는다', () => {
    const { result } = renderHook(() => useDwell());
    act(() => result.current.on('person:w-1').onPointerEnter(at(10, 20)));
    act(() => void vi.advanceTimersByTime(DWELL_MS - 1));
    expect(result.current.tip).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.tip).toEqual({ key: 'person:w-1', x: 10, y: 20 });
  });

  it('머무는 동안 움직인 포인터 자리를 따라간다', () => {
    const { result } = renderHook(() => useDwell());
    const handlers = result.current.on('person:w-1');
    act(() => handlers.onPointerEnter(at(10, 20)));
    act(() => handlers.onPointerMove(at(40, 50)));
    act(() => void vi.advanceTimersByTime(DWELL_MS));
    expect(result.current.tip).toEqual({ key: 'person:w-1', x: 40, y: 50 });
  });

  it('300ms 전에 나가면 말풍선이 뜨지 않고, 뜬 뒤 나가면 사라진다', () => {
    const { result } = renderHook(() => useDwell());
    const handlers = result.current.on('person:w-1');
    act(() => handlers.onPointerEnter(at(10, 20)));
    act(() => void vi.advanceTimersByTime(DWELL_MS - 50));
    act(() => handlers.onPointerLeave());
    act(() => void vi.advanceTimersByTime(DWELL_MS));
    expect(result.current.tip).toBeNull();

    act(() => handlers.onPointerEnter(at(10, 20)));
    act(() => void vi.advanceTimersByTime(DWELL_MS));
    expect(result.current.tip).not.toBeNull();
    act(() => handlers.onPointerLeave());
    expect(result.current.tip).toBeNull();
  });

  it('다른 대상으로 옮기면 그 대상에서 다시 300ms 를 센다', () => {
    const { result } = renderHook(() => useDwell());
    act(() => result.current.on('person:w-1').onPointerEnter(at(10, 20)));
    act(() => void vi.advanceTimersByTime(DWELL_MS - 100));
    act(() => result.current.on('zone:z-1').onPointerEnter(at(30, 40)));
    act(() => void vi.advanceTimersByTime(DWELL_MS - 1));
    expect(result.current.tip).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.tip).toEqual({ key: 'zone:z-1', x: 30, y: 40 });
  });
});
