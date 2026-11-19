// CCTV 영상 칸의 디지털 확대·이동 계산(순수 함수). 그림 레이어를 translate(x·100%, y·100%) scale(scale) 로 옮기고
// 원점은 왼쪽 위다. x·y 는 칸 폭·높이에 대한 비율이라 칸 크기가 바뀌어도(크게 보기↔4분할) 보던 자리가 같다.

export interface PanZoomView {
  scale: number;
  /** 그림 왼쪽 가장자리가 칸 왼쪽에서 얼마나 떨어졌는지(칸 폭 비율). 확대하면 0 에서 1 - scale 사이다. */
  x: number;
  /** 그림 위쪽 가장자리가 칸 위쪽에서 얼마나 떨어졌는지(칸 높이 비율). */
  y: number;
}

/** 칸 안의 한 점(칸 폭·높이에 대한 비율, 0~1). */
export interface PanZoomPoint {
  x: number;
  y: number;
}

/** 칸 크기(px). */
interface PanZoomSize {
  width: number;
  height: number;
}

export const IDENTITY_VIEW: PanZoomView = { scale: 1, x: 0, y: 0 };

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** 이 값보다 조금 넘는 배율은 확대하지 않은 것으로 본다(확대·축소를 되풀이하며 쌓인 계산 오차). */
const ZOOM_EPSILON = 0.001;
/** 휠 한 칸(deltaY 100)이 곱하는 배율은 exp(100 × 이 값) ≈ 1.16 이다. */
const WHEEL_SENSITIVITY = 0.0015;
/** deltaMode 가 줄·쪽 단위일 때 픽셀로 바꾸는 값. */
const LINE_PX = 16;
const PAGE_PX = 400;
/** 키보드 한 번에 곱하는 배율과 화살표 한 번에 옮기는 거리(px). */
const KEY_ZOOM = 1.25;
const KEY_PAN_PX = 40;

const CENTER: PanZoomPoint = { x: 0.5, y: 0.5 };
/** 화살표가 그림을 옮기는 방향. 왼쪽 화살표는 그림이 오른쪽으로 가서 왼쪽이 보인다. */
const PAN_DIRECTION: Record<string, readonly [number, number]> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const isZoomed = (view: PanZoomView) => view.scale > MIN_SCALE + ZOOM_EPSILON;

/** 배율을 1~8 로 자르고, 그림 가장자리가 칸 안으로 들어오지 않게 이동을 자른다. 1배면 이동은 0 이다. */
function clampView(view: PanZoomView): PanZoomView {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  return {
    scale,
    x: clamp(view.x, 1 - scale, 0),
    y: clamp(view.y, 1 - scale, 0),
  };
}

/** point 밑의 그림 점이 그대로 point 밑에 남도록 factor 배 확대·축소한다. */
export function zoomAt(view: PanZoomView, point: PanZoomPoint, factor: number): PanZoomView {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return clampView({
    scale,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  });
}

/** 그림을 (dx, dy)(칸 폭·높이 비율)만큼 옮긴다. */
export function panBy(view: PanZoomView, dx: number, dy: number): PanZoomView {
  return clampView({ scale: view.scale, x: view.x + dx, y: view.y + dy });
}

/** 휠 이벤트 하나가 곱할 배율. 위로 굴리면(deltaY < 0) 확대다. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  let px = deltaY;
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) px *= LINE_PX;
  else if (deltaMode === WheelEvent.DOM_DELTA_PAGE) px *= PAGE_PX;
  return Math.exp(-px * WHEEL_SENSITIVITY);
}

/**
 * 키 하나가 낳는 다음 보기. + = 확대, - 축소(칸 가운데 기준), 0 은 1배로 되돌린다. 화살표는 확대 중에만 옮긴다.
 * 다루지 않는 키는 undefined 다.
 */
export function viewForKey(
  view: PanZoomView,
  key: string,
  size: PanZoomSize,
): PanZoomView | undefined {
  if (key === '+' || key === '=') return zoomAt(view, CENTER, KEY_ZOOM);
  if (key === '-') return zoomAt(view, CENTER, 1 / KEY_ZOOM);
  if (key === '0') return IDENTITY_VIEW;
  const direction = PAN_DIRECTION[key];
  if (!direction || !isZoomed(view)) return undefined;
  return panBy(
    view,
    (direction[0] * KEY_PAN_PX) / size.width,
    (direction[1] * KEY_PAN_PX) / size.height,
  );
}

/** 지금 칸에 보이는 영역(그림 전체에 대한 비율). */
export function visibleRect(view: PanZoomView) {
  return {
    left: -view.x / view.scale,
    top: -view.y / view.scale,
    width: 1 / view.scale,
    height: 1 / view.scale,
  };
}

/** 그림 레이어의 transform. 확대하지 않았으면 없다. */
export function panZoomTransform(view: PanZoomView): string | undefined {
  if (!isZoomed(view)) return undefined;
  return `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.scale})`;
}
