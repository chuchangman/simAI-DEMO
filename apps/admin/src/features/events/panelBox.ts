import { clamp, FLOAT_MARGIN, type FloatBounds, type FloatBox } from '@/lib/floatSpot';
import type { CSSProperties } from 'react';

// 떠 있는 이벤트 패널을 끌어 옮기고 크기를 바꾸는 계산(관제 데모와 같다). 화면 컴포넌트 없이 시험한다.
// 패널 자리와 부모 크기는 CCTV 창과 같은 타입(FloatBox·FloatBounds)이고, 가장자리 틈도 같이 쓴다.

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_MIN_HEIGHT = 120;
/** 상단 바(60px) 아래와 화면 가장자리에 남기는 틈. */
export const PANEL_TOP = FLOAT_MARGIN.top;
export const PANEL_GAP = FLOAT_MARGIN.side;

/** 머리줄을 끈 만큼 옮긴다. 상단 바 아래·화면 안에 머물고, 아래로 내려 화면을 넘으면 높이를 줄인다. */
export function movePanel(start: FloatBox, dx: number, dy: number, bounds: FloatBounds): FloatBox {
  const top = clamp(start.top + dy, PANEL_TOP, bounds.height - PANEL_MIN_HEIGHT - PANEL_GAP);
  return {
    left: clamp(start.left + dx, PANEL_GAP, bounds.width - start.width - PANEL_GAP),
    top,
    width: start.width,
    height: clamp(start.height, PANEL_MIN_HEIGHT, bounds.height - top - PANEL_GAP),
  };
}

/** 손잡이: x 는 왼쪽 가장자리(폭), y 는 아래 가장자리(높이), xy 는 왼쪽 아래 모서리(둘 다). 오른쪽·위는 그대로다. */
export type PanelEdge = 'x' | 'y' | 'xy';

export function resizePanel(
  start: FloatBox,
  edge: PanelEdge,
  dx: number,
  dy: number,
  bounds: FloatBounds,
): FloatBox {
  const right = start.left + start.width;
  const width =
    edge === 'y'
      ? start.width
      : clamp(start.width - dx, PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, right - PANEL_GAP));
  const height =
    edge === 'x'
      ? start.height
      : clamp(start.height + dy, PANEL_MIN_HEIGHT, bounds.height - start.top - PANEL_GAP);
  return { left: right - width, top: start.top, width, height };
}

/** 펼친 패널의 기본 높이는 화면(부모) 높이의 이 비율(%)이다: 카드 두 장이 스크롤 없이 보이고, 아래에 CCTV 창 자리가 남는다. */
export const PANEL_DEFAULT_HEIGHT_PERCENT = 46;
/** 작은 화면에서도 머리줄과 카드 두 장(제목이 두 줄로 접혀도)이 들어가는 기본 높이의 최솟값(px). */
export const PANEL_DEFAULT_MIN_HEIGHT = 380;

/** 기본 자리 패널의 높이: 비율과 최솟값 중 큰 쪽, 단 위쪽 틈·아래쪽 틈 안에서. */
export function defaultPanelHeight(bounds: FloatBounds): number {
  const room = bounds.height - PANEL_TOP - PANEL_GAP;
  const wanted = Math.round((bounds.height * PANEL_DEFAULT_HEIGHT_PERCENT) / 100);
  return Math.min(room, Math.max(PANEL_DEFAULT_MIN_HEIGHT, wanted));
}

/** `defaultPanelHeight` 와 같은 높이를 CSS 로: 옮기지 않은 패널이 첫 그림부터 이 높이로 선다. */
export const PANEL_DEFAULT_STYLE: CSSProperties = {
  height: `max(${PANEL_DEFAULT_MIN_HEIGHT}px, ${PANEL_DEFAULT_HEIGHT_PERCENT}%)`,
  maxHeight: `calc(100% - ${PANEL_TOP + PANEL_GAP}px)`,
};

/** 기본 자리(오른쪽 위, 기본 높이)의 패널 상자. */
export function defaultPanelBox(bounds: FloatBounds, width: number): FloatBox {
  return {
    left: bounds.width - PANEL_GAP - width,
    top: PANEL_TOP,
    width,
    height: defaultPanelHeight(bounds),
  };
}

/**
 * 패널(panel)이 가리는 상자(cover, 떠 있는 CCTV 창)와 겹치면, 가리는 상자의 위·아래 빈칸 중 넓은 쪽에 맞춘 패널 상자.
 * 가리는 상자와는 PANEL_GAP 만큼 띄운다. 겹치지 않거나 넓은 쪽도 PANEL_MIN_HEIGHT 보다 좁으면 null(그대로 둔다).
 */
export function avoidBox(panel: FloatBox, cover: FloatBox | null): FloatBox | null {
  if (!cover) return null;
  const panelBottom = panel.top + panel.height;
  const coverBottom = cover.top + cover.height;
  const overlaps =
    cover.left < panel.left + panel.width &&
    panel.left < cover.left + cover.width &&
    cover.top < panelBottom &&
    panel.top < coverBottom;
  if (!overlaps) return null;
  const above = cover.top - PANEL_GAP - panel.top;
  const below = panelBottom - coverBottom - PANEL_GAP;
  if (Math.max(above, below) < PANEL_MIN_HEIGHT) return null;
  return above >= below
    ? { ...panel, height: above }
    : { ...panel, top: coverBottom + PANEL_GAP, height: below };
}

/** 창 크기가 바뀌어도 패널이 화면 밖으로 나가지 않게 다시 맞춘다. */
export function fitPanel(box: FloatBox, bounds: FloatBounds): FloatBox {
  const width = Math.min(box.width, Math.max(PANEL_MIN_WIDTH, bounds.width - 2 * PANEL_GAP));
  const top = clamp(box.top, PANEL_TOP, bounds.height - PANEL_MIN_HEIGHT - PANEL_GAP);
  return {
    width,
    top,
    left: clamp(box.left, PANEL_GAP, bounds.width - width - PANEL_GAP),
    height: clamp(box.height, PANEL_MIN_HEIGHT, bounds.height - top - PANEL_GAP),
  };
}
