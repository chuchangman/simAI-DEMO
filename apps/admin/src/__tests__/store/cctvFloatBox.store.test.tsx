import {
  CCTV_BOX_SETTLE_MS,
  useCctvFloatBoxStore,
  useReportCctvFloatBox,
} from '@/store/cctvFloatBox.store';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom 은 배치를 하지 않아 offset·client 크기가 모두 0 이다. 창과 부모(관제 장면)의 자리·크기를 속성으로 심는다.
const place = { left: 96, top: 128, width: 480, height: 360 };

function stage() {
  const parent = document.createElement('div');
  const box = document.createElement('section');
  parent.append(box);
  document.body.append(parent);
  Object.defineProperties(parent, {
    clientWidth: { get: () => 1440, configurable: true },
    clientHeight: { get: () => 900, configurable: true },
  });
  Object.defineProperties(box, {
    offsetParent: { get: () => parent, configurable: true },
    offsetLeft: { get: () => place.left, configurable: true },
    offsetTop: { get: () => place.top, configurable: true },
    offsetWidth: { get: () => place.width, configurable: true },
    offsetHeight: { get: () => place.height, configurable: true },
  });
  return { current: box };
}

const reported = () => useCctvFloatBoxStore.getState().box;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  useCctvFloatBoxStore.setState({ box: null });
  Object.assign(place, { left: 96, top: 128, width: 480, height: 360 });
});

describe('useReportCctvFloatBox', () => {
  /** 창 상태를 바꿔 가며 훅을 그린다. */
  const report = (target: ReturnType<typeof stage>, initial: Partial<Layout> = {}) =>
    renderHook((layout: Layout) => useReportCctvFloatBox(target, layout), {
      initialProps: { dragging: false, collapsed: false, layoutKey: 'a', ...initial },
    });
  type Layout = { dragging: boolean; collapsed: boolean; layoutKey: string };
  const settle = (times = 1) => act(() => vi.advanceTimersByTime(CCTV_BOX_SETTLE_MS * times));

  it('자리가 자리 잡은 뒤(SETTLE_MS) 잰 자리를 알리고, 창이 내려가면 비운다', () => {
    const hook = report(stage());
    expect(reported()).toBeNull();
    settle();
    expect(reported()).toEqual(place);

    hook.unmount();
    expect(reported()).toBeNull();
  });

  it('끄는 동안은 알리지 않고, 놓은 뒤 새 자리를 알린다', () => {
    const hook = report(stage(), { layoutKey: '96,128' });
    settle();
    expect(reported()).toMatchObject({ left: 96 });

    place.left = 900;
    hook.rerender({ dragging: true, collapsed: false, layoutKey: '900,128' });
    settle(10);
    expect(reported()).toMatchObject({ left: 96 });

    hook.rerender({ dragging: false, collapsed: false, layoutKey: '900,128' });
    settle();
    expect(reported()).toMatchObject({ left: 900 });
  });

  it('접으면(영상 없음) 비우고, 펼치면 다시 알린다', () => {
    const hook = report(stage());
    settle();
    hook.rerender({ dragging: false, collapsed: true, layoutKey: 'a' });
    settle();
    expect(reported()).toBeNull();

    hook.rerender({ dragging: false, collapsed: false, layoutKey: 'a' });
    settle();
    expect(reported()).toEqual(place);
  });

  it('잇달아 바뀌면(크기 바꾸는 중) 멈춘 뒤 한 번만 알린다', () => {
    const hook = report(stage(), { layoutKey: '480x360' });
    settle();
    const first = reported();

    place.width = 600;
    hook.rerender({ dragging: false, collapsed: false, layoutKey: '600x360' });
    settle(0.5);
    place.width = 700;
    hook.rerender({ dragging: false, collapsed: false, layoutKey: '700x360' });
    settle(0.5);
    expect(reported()).toBe(first);
    settle();
    expect(reported()).toMatchObject({ width: 700 });
  });

  it('같은 자리를 다시 재면 상태를 바꾸지 않는다', () => {
    const hook = report(stage());
    settle();
    const first = reported();
    hook.rerender({ dragging: false, collapsed: false, layoutKey: 'b' });
    settle();
    expect(reported()).toBe(first);
  });
});
