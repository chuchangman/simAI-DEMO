import {
  IDENTITY_VIEW,
  isZoomed,
  panBy,
  panZoomTransform,
  viewForKey,
  visibleRect,
  wheelFactor,
  zoomAt,
  type PanZoomView,
} from '@/features/cctv/panZoom';
import { describe, expect, it } from 'vitest';

const SIZE = { width: 800, height: 450 };
const CENTER = { x: 0.5, y: 0.5 };
const ZOOMED: PanZoomView = { scale: 2, x: -0.5, y: -0.25 };

/** 칸 안의 한 점 밑에 있는 그림 위치(그림 전체에 대한 비율). */
const under = (view: PanZoomView, point: { x: number; y: number }) => ({
  x: (point.x - view.x) / view.scale,
  y: (point.y - view.y) / view.scale,
});

describe('zoomAt', () => {
  it('포인터 밑의 그림 점은 확대해도 그 자리에 남는다', () => {
    const point = { x: 0.25, y: 0.75 };
    const after = zoomAt(ZOOMED, point, 1.5);
    expect(after.scale).toBeCloseTo(3);
    expect(under(after, point).x).toBeCloseTo(under(ZOOMED, point).x);
    expect(under(after, point).y).toBeCloseTo(under(ZOOMED, point).y);
  });

  it('배율은 8 을 넘지 않고 1 아래로 내려가지 않는다', () => {
    expect(zoomAt(ZOOMED, CENTER, 100).scale).toBe(8);
    const out = zoomAt(ZOOMED, CENTER, 0.01);
    expect(out.scale).toBe(1);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
  });

  it('가장자리 근처를 확대해도 그림이 칸 밖으로 비지 않는다', () => {
    const corner = zoomAt(IDENTITY_VIEW, { x: 1, y: 1 }, 4);
    expect(corner.x).toBeCloseTo(-3);
    expect(corner.y).toBeCloseTo(-3);
    const origin = zoomAt(IDENTITY_VIEW, { x: 0, y: 0 }, 4);
    expect(origin.x).toBeCloseTo(0);
    expect(origin.y).toBeCloseTo(0);
  });
});

describe('panBy', () => {
  it('그림 가장자리가 칸 안으로 들어오기 전에 멈춘다', () => {
    expect(panBy(ZOOMED, 5, 5)).toMatchObject({ scale: 2, x: 0, y: 0 });
    expect(panBy(ZOOMED, -5, -5)).toMatchObject({ scale: 2, x: -1, y: -1 });
  });

  it('칸 비율만큼 옮긴다', () => {
    expect(panBy(ZOOMED, 0.125, -0.0625)).toMatchObject({ scale: 2, x: -0.375, y: -0.3125 });
  });

  it('확대하지 않았으면 옮겨지지 않는다', () => {
    const view = panBy(IDENTITY_VIEW, 0.3, -0.3);
    expect(view.x).toBeCloseTo(0);
    expect(view.y).toBeCloseTo(0);
  });
});

describe('wheelFactor', () => {
  it('위로 굴리면 확대, 아래로 굴리면 축소다', () => {
    expect(wheelFactor(-100, WheelEvent.DOM_DELTA_PIXEL)).toBeGreaterThan(1);
    expect(wheelFactor(100, WheelEvent.DOM_DELTA_PIXEL)).toBeLessThan(1);
    expect(wheelFactor(0, WheelEvent.DOM_DELTA_PIXEL)).toBe(1);
  });

  it('같은 거리를 반대로 굴리면 제자리로 돌아온다', () => {
    const there = wheelFactor(-100, WheelEvent.DOM_DELTA_PIXEL);
    expect(there * wheelFactor(100, WheelEvent.DOM_DELTA_PIXEL)).toBeCloseTo(1);
  });

  it('줄·쪽 단위는 픽셀로 바꿔 계산한다', () => {
    expect(wheelFactor(-1, WheelEvent.DOM_DELTA_LINE)).toBeGreaterThan(
      wheelFactor(-1, WheelEvent.DOM_DELTA_PIXEL),
    );
    expect(wheelFactor(-1, WheelEvent.DOM_DELTA_PAGE)).toBeGreaterThan(
      wheelFactor(-1, WheelEvent.DOM_DELTA_LINE),
    );
  });
});

describe('isZoomed · panZoomTransform', () => {
  it('1배와 계산 오차 수준의 배율은 확대가 아니라 transform 도 없다', () => {
    expect(isZoomed(IDENTITY_VIEW)).toBe(false);
    expect(isZoomed({ scale: 1.0005, x: 0, y: 0 })).toBe(false);
    expect(panZoomTransform({ scale: 1.0005, x: 0, y: 0 })).toBeUndefined();
  });

  it('확대하면 이동을 칸 비율(%)로, 배율을 그대로 transform 에 준다', () => {
    expect(isZoomed(ZOOMED)).toBe(true);
    expect(panZoomTransform(ZOOMED)).toBe('translate(-50%, -25%) scale(2)');
  });
});

describe('visibleRect', () => {
  it('지금 칸에 보이는 영역을 그림 전체에 대한 비율로 준다', () => {
    expect(visibleRect(ZOOMED)).toEqual({ left: 0.25, top: 0.125, width: 0.5, height: 0.5 });
    const whole = visibleRect(IDENTITY_VIEW);
    expect(whole.left).toBeCloseTo(0);
    expect(whole.top).toBeCloseTo(0);
    expect(whole.width).toBe(1);
    expect(whole.height).toBe(1);
  });
});

describe('viewForKey', () => {
  it('+ 와 = 는 칸 가운데를 기준으로 확대하고 - 는 축소한다', () => {
    const plus = viewForKey(IDENTITY_VIEW, '+', SIZE)!;
    expect(plus.scale).toBeGreaterThan(1);
    expect(viewForKey(IDENTITY_VIEW, '=', SIZE)).toEqual(plus);
    expect(under(plus, CENTER).x).toBeCloseTo(CENTER.x);
    expect(under(plus, CENTER).y).toBeCloseTo(CENTER.y);
    expect(viewForKey(plus, '-', SIZE)!.scale).toBeCloseTo(1);
  });

  it('0 은 1배로 되돌린다', () => {
    expect(viewForKey(ZOOMED, '0', SIZE)).toEqual(IDENTITY_VIEW);
  });

  it('화살표는 확대 중에만 그림을 옮기고, 왼쪽 화살표는 왼쪽이 보이게 한다', () => {
    expect(viewForKey(IDENTITY_VIEW, 'ArrowLeft', SIZE)).toBeUndefined();
    const left = viewForKey(ZOOMED, 'ArrowLeft', SIZE)!;
    expect(left.x).toBeGreaterThan(ZOOMED.x);
    expect(left.y).toBe(ZOOMED.y);
    expect(viewForKey(ZOOMED, 'ArrowDown', SIZE)!.y).toBeLessThan(ZOOMED.y);
  });

  it('다루지 않는 키는 undefined 다', () => {
    expect(viewForKey(ZOOMED, 'a', SIZE)).toBeUndefined();
    expect(viewForKey(ZOOMED, 'Enter', SIZE)).toBeUndefined();
  });
});
