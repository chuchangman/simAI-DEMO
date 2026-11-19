import { DRAG_THRESHOLD_PX, useFloatSpot } from '@/hooks/useFloatSpot';
import { FLOAT_MARGIN, type FloatAnchor } from '@/lib/floatSpot';
import { act, renderHook } from '@testing-library/react';
import type { MouseEvent, PointerEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom 은 배치를 하지 않아 offset·client 크기가 모두 0 이다. 상자와 부모의 크기·자리를 속성으로 심는다.
const bounds = { width: 1000, height: 700 };
const place = { left: 100, top: 200, width: 120, height: 40 };

function stage() {
  const parent = document.createElement('div');
  const box = document.createElement('div');
  parent.append(box);
  document.body.append(parent);
  Object.defineProperties(parent, {
    clientWidth: { get: () => bounds.width, configurable: true },
    clientHeight: { get: () => bounds.height, configurable: true },
  });
  Object.defineProperties(box, {
    offsetParent: { get: () => parent, configurable: true },
    offsetLeft: { get: () => place.left, configurable: true },
    offsetTop: { get: () => place.top, configurable: true },
    offsetWidth: { get: () => place.width, configurable: true },
    offsetHeight: { get: () => place.height, configurable: true },
  });
  return box;
}

// 상자 크기 변화를 지켜보는 브라우저 기능의 대역. 만들어진 감시자의 콜백을 모아 두었다가 시험이 직접 부른다.
const observers: { callback: () => void; observe: ReturnType<typeof vi.fn> }[] = [];
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(callback: () => void) {
    observers.push({ callback, observe: this.observe });
  }
}

const capture = vi.fn();
const pointer = (x: number, y: number, init: Partial<{ button: number; buttons: number }> = {}) =>
  ({
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    pointerId: 7,
    currentTarget: { setPointerCapture: capture },
    ...init,
  }) as unknown as PointerEvent<HTMLElement>;
/** 마우스로 누른 클릭은 detail 이 1 이상, 키보드로 누른 클릭은 0 이다. */
const click = (detail = 1) => {
  const event = { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  return { event: event as unknown as MouseEvent<HTMLElement>, ...event };
};

function setup(anchor: FloatAnchor = 'top') {
  const target = { current: stage() };
  const hook = renderHook(() => useFloatSpot(target, anchor, FLOAT_MARGIN));
  return { ...hook, target, handlers: () => hook.result.current.handlers };
}

/** 누르고 (x, y) 까지 끄는 중에 멈춘다(아직 놓지 않는다). */
function dragTo(handlers: ReturnType<typeof setup>['handlers'], from: number, x: number, y = from) {
  act(() => handlers().onPointerDown(pointer(from, from)));
  act(() => handlers().onPointerMove(pointer(x, y)));
}

afterEach(() => {
  document.body.innerHTML = '';
  capture.mockClear();
  observers.length = 0;
  vi.unstubAllGlobals();
  Object.assign(place, { left: 100, top: 200, width: 120, height: 40 });
  Object.assign(bounds, { width: 1000, height: 700 });
});

describe('useFloatSpot', () => {
  it(`${DRAG_THRESHOLD_PX}px 이하로 움직인 뒤 누른 클릭은 그대로 클릭이다`, () => {
    const { result, handlers } = setup();
    act(() => handlers().onPointerDown(pointer(300, 300)));
    act(() => handlers().onPointerMove(pointer(300 + DRAG_THRESHOLD_PX, 300)));
    act(() => handlers().onPointerUp());

    expect(result.current.style).toBeUndefined();
    expect(result.current.dragging).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    const next = click();
    act(() => handlers().onClickCapture(next.event));
    expect(next.preventDefault).not.toHaveBeenCalled();
    expect(next.stopPropagation).not.toHaveBeenCalled();
  });

  it('임계값을 넘게 끌면 포인터를 잡고 위치가 바뀌며, 놓은 뒤 첫 클릭만 삼킨다', () => {
    const { result, handlers } = setup();
    dragTo(handlers, 300, 400);

    // 시작 자리(left 100, top 200)에서 오른쪽으로 100px.
    expect(result.current.style).toEqual({ left: 200, top: 200 });
    expect(result.current.dragging).toBe(true);
    expect(capture).toHaveBeenCalledWith(7);

    act(() => handlers().onPointerUp());
    act(() => handlers().onLostPointerCapture());
    expect(result.current.dragging).toBe(false);
    expect(result.current.style).toEqual({ left: 200, top: 200 });

    const first = click();
    act(() => handlers().onClickCapture(first.event));
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(first.stopPropagation).toHaveBeenCalledOnce();

    const second = click();
    act(() => handlers().onClickCapture(second.event));
    expect(second.stopPropagation).not.toHaveBeenCalled();
  });

  it('놓지 않고 브라우저가 끌기를 거두면(취소·캡처 잃음) 뒤따르는 클릭이 없으므로 다음 클릭을 삼키지 않는다', () => {
    const { result, handlers } = setup();
    dragTo(handlers, 300, 400);
    act(() => handlers().onPointerCancel());
    expect(result.current.dragging).toBe(false);

    dragTo(handlers, 300, 500);
    act(() => handlers().onLostPointerCapture());
    expect(result.current.dragging).toBe(false);

    const next = click();
    act(() => handlers().onClickCapture(next.event));
    expect(next.preventDefault).not.toHaveBeenCalled();
    expect(next.stopPropagation).not.toHaveBeenCalled();
  });

  it('끌고 난 뒤 키보드로 누른 클릭(detail 0)은 삼키지 않는다', () => {
    const { handlers } = setup();
    dragTo(handlers, 300, 400);
    act(() => handlers().onPointerUp());

    const keyboard = click(0);
    act(() => handlers().onClickCapture(keyboard.event));
    expect(keyboard.preventDefault).not.toHaveBeenCalled();
    expect(keyboard.stopPropagation).not.toHaveBeenCalled();
  });

  it('아래 기준 상자는 left·bottom 으로 자리를 잡는다', () => {
    const { result, handlers } = setup('bottom');
    dragTo(handlers, 300, 400);
    // 아래 offset = 700 − 위 200 − 높이 40
    expect(result.current.style).toEqual({ left: 200, bottom: 460 });
  });

  it('멀리 끌어도 틈을 남기고 화면 안에 고정된다', () => {
    const { result, handlers } = setup();
    dragTo(handlers, 300, -4700, -4700);
    expect(result.current.style).toEqual({ left: FLOAT_MARGIN.side, top: FLOAT_MARGIN.top });
  });

  it('주 버튼이 아니면 끌기를 시작하지 않는다', () => {
    const { result, handlers } = setup();
    act(() => handlers().onPointerDown(pointer(300, 300, { button: 2 })));
    act(() => handlers().onPointerMove(pointer(500, 500)));
    expect(result.current.style).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it('상자 밖에서 버튼을 놓아 pointerup 을 못 받은 뒤에는 움직여도 끌려가지 않는다', () => {
    const { result, handlers } = setup();
    act(() => handlers().onPointerDown(pointer(300, 300)));
    act(() => handlers().onPointerMove(pointer(500, 500, { buttons: 0 })));
    act(() => handlers().onPointerMove(pointer(600, 600)));
    expect(result.current.style).toBeUndefined();
  });

  it('끌고 난 뒤 클릭이 없었어도 다음에 누르면 삼키는 표시를 지운다', () => {
    const { handlers } = setup();
    dragTo(handlers, 300, 400);
    act(() => handlers().onPointerUp());

    act(() => handlers().onPointerDown(pointer(50, 50)));
    act(() => handlers().onPointerUp());
    const next = click();
    act(() => handlers().onClickCapture(next.event));
    expect(next.stopPropagation).not.toHaveBeenCalled();
  });

  it('reset 하면 기본 자리(스타일 없음)로 돌아간다', () => {
    const { result, handlers } = setup();
    dragTo(handlers, 300, 400);
    act(() => result.current.reset());
    expect(result.current.style).toBeUndefined();
  });
});

describe('useFloatSpot 화면 안으로 다시 맞추기', () => {
  it('창이 줄어 상자가 밖으로 나가면 화면 안으로 다시 맞춘다', () => {
    const { result, handlers } = setup();
    dragTo(handlers, 300, 1300);
    act(() => handlers().onPointerUp());
    expect(result.current.style).toEqual({ left: 1000 - 120 - FLOAT_MARGIN.side, top: 200 });

    // 브라우저가 옮긴 자리를 반영한 뒤 창이 줄었다고 본다.
    place.left = 1000 - 120 - FLOAT_MARGIN.side;
    bounds.width = 600;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(result.current.style).toEqual({ left: 600 - 120 - FLOAT_MARGIN.side, top: 200 });
  });

  it('옮긴 뒤 상자 크기가 바뀌어 밖으로 나가면 지켜보다가 안으로 다시 맞춘다', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { result, target, handlers } = setup();
    // 옮기기 전에는 지켜볼 것이 없다.
    expect(observers).toHaveLength(0);

    dragTo(handlers, 300, 1300);
    act(() => handlers().onPointerUp());
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledWith(target.current);

    place.left = 1000 - 120 - FLOAT_MARGIN.side;
    place.width = 300;
    act(() => observers[0]?.callback());
    expect(result.current.style).toEqual({ left: 1000 - 300 - FLOAT_MARGIN.side, top: 200 });
  });

  it('refit 을 부르면 그 자리에서 바로 안으로 다시 맞춘다', () => {
    const { result, handlers } = setup();
    dragTo(handlers, 300, 1300);
    act(() => handlers().onPointerUp());

    place.left = 1000 - 120 - FLOAT_MARGIN.side;
    place.width = 300;
    act(() => result.current.refit());
    expect(result.current.style).toEqual({ left: 1000 - 300 - FLOAT_MARGIN.side, top: 200 });
  });

  it('옮기지 않았으면 창 크기가 바뀌거나 refit 을 불러도 아무것도 하지 않는다', () => {
    const { result } = setup();
    bounds.width = 300;
    act(() => void window.dispatchEvent(new Event('resize')));
    act(() => result.current.refit());
    expect(result.current.style).toBeUndefined();
  });
});
