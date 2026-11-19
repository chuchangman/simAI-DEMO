import {
  avoidBox,
  defaultPanelBox,
  defaultPanelHeight,
  fitPanel,
  movePanel,
  PANEL_DEFAULT_MIN_HEIGHT,
  PANEL_DEFAULT_STYLE,
  PANEL_GAP,
  PANEL_MAX_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_TOP,
  resizePanel,
} from '@/features/events/panelBox';
import { describe, expect, it } from 'vitest';

const bounds = { width: 1280, height: 760 };
// 오른쪽 기본 자리(right 14, top 72, bottom 14, 폭 340)와 같은 상자.
const start = { left: 1280 - 14 - 340, top: 72, width: 340, height: 760 - 72 - 14 };

describe('movePanel', () => {
  it('끈 만큼 옮긴다', () => {
    const short = { ...start, height: 300 };
    expect(movePanel(short, -300, 40, bounds)).toEqual({
      ...short,
      left: start.left - 300,
      top: 112,
    });
  });

  it('상단 바 아래·화면 안에 머문다', () => {
    expect(movePanel(start, -5000, -500, bounds)).toMatchObject({
      left: PANEL_GAP,
      top: PANEL_TOP,
    });
    expect(movePanel(start, 500, 5000, bounds)).toEqual({
      left: bounds.width - start.width - PANEL_GAP,
      top: bounds.height - PANEL_MIN_HEIGHT - PANEL_GAP,
      width: start.width,
      height: PANEL_MIN_HEIGHT,
    });
  });

  it('아래로 내려 화면을 넘으면 높이를 줄이고, 같은 끌기에서 다시 올리면 처음 높이로 돌아간다', () => {
    const down = movePanel(start, 0, 300, bounds);
    expect(down.top).toBe(372);
    expect(down.top + down.height).toBe(bounds.height - PANEL_GAP);
    expect(movePanel(start, 0, 0, bounds).height).toBe(start.height);
  });
});

describe('resizePanel', () => {
  it('왼쪽 가장자리를 끌면 오른쪽은 그대로 두고 폭만 바뀐다', () => {
    const wider = resizePanel(start, 'x', -100, 0, bounds);
    expect(wider.width).toBe(440);
    expect(wider.left + wider.width).toBe(start.left + start.width);
    expect(wider.height).toBe(start.height);
  });

  it('폭은 280~720px 이다', () => {
    expect(resizePanel(start, 'x', 500, 0, bounds).width).toBe(PANEL_MIN_WIDTH);
    expect(resizePanel(start, 'x', -900, 0, bounds).width).toBe(PANEL_MAX_WIDTH);
  });

  it('아래 가장자리는 높이만, 모서리는 둘 다 바꾼다. 높이는 화면 아래를 넘지 않는다', () => {
    const shorter = resizePanel(start, 'y', -50, -200, bounds);
    expect(shorter).toEqual({ ...start, height: start.height - 200 });
    expect(resizePanel(start, 'y', 0, -2000, bounds).height).toBe(PANEL_MIN_HEIGHT);
    expect(resizePanel(start, 'y', 0, 2000, bounds).height).toBe(
      bounds.height - start.top - PANEL_GAP,
    );
    const corner = resizePanel(start, 'xy', -60, -100, bounds);
    expect(corner).toMatchObject({ width: 400, height: start.height - 100 });
  });
});

describe('fitPanel', () => {
  it('창이 줄면 화면 안으로 다시 맞춘다', () => {
    const fitted = fitPanel({ ...start, left: 1200 }, { width: 900, height: 600 });
    expect(fitted.left + fitted.width).toBeLessThanOrEqual(900 - PANEL_GAP);
    expect(fitted.top + fitted.height).toBeLessThanOrEqual(600 - PANEL_GAP);
  });
});

describe('defaultPanelBox', () => {
  it('오른쪽 위(위 72, 오른쪽 14)에서 화면 높이의 46%까지다(작은 화면은 최솟값)', () => {
    expect(defaultPanelBox({ width: 1920, height: 1012 }, 340)).toEqual({
      left: 1920 - 14 - 340,
      top: 72,
      width: 340,
      height: 466,
    });
    expect(defaultPanelBox(bounds, 340)).toEqual({
      left: 1280 - 14 - 340,
      top: 72,
      width: 340,
      height: PANEL_DEFAULT_MIN_HEIGHT,
    });
  });
});

describe('defaultPanelHeight', () => {
  it('화면 높이의 46% 이다', () => {
    expect(defaultPanelHeight({ width: 1920, height: 1012 })).toBe(466);
    expect(defaultPanelHeight({ width: 1920, height: 1080 })).toBe(497);
  });

  it('작은 화면에서도 카드 두 장이 들어가는 최솟값 아래로 내려가지 않는다', () => {
    expect(defaultPanelHeight({ width: 1280, height: 600 })).toBe(PANEL_DEFAULT_MIN_HEIGHT);
  });

  it('최솟값이 위·아래 틈을 넘으면 틈 안에 맞춘다', () => {
    expect(defaultPanelHeight({ width: 800, height: 400 })).toBe(400 - PANEL_TOP - PANEL_GAP);
  });

  it('옮기지 않은 패널의 CSS 높이도 같은 비율과 최솟값, 위·아래 틈이다', () => {
    expect(PANEL_DEFAULT_STYLE).toEqual({
      height: `max(${PANEL_DEFAULT_MIN_HEIGHT}px, 46%)`,
      maxHeight: `calc(100% - ${PANEL_TOP + PANEL_GAP}px)`,
    });
  });
});

describe('avoidBox(CCTV 창 비켜 서기)', () => {
  // 패널 아래 끝은 760 - 14 = 746 이다.
  const cctv = (left: number, top: number, width = 480, height = 360) => ({
    left,
    top,
    width,
    height,
  });

  it('창이 패널 아래쪽을 가리면 패널 아래 끝을 창 위로 올린다', () => {
    expect(avoidBox(start, cctv(800, 400))).toEqual({
      ...start,
      height: 400 - PANEL_GAP - PANEL_TOP,
    });
  });

  it('창이 패널 위쪽을 가리면 패널을 창 아래에서 시작한다', () => {
    expect(avoidBox(start, cctv(800, 80, 480, 200))).toEqual({
      ...start,
      top: 280 + PANEL_GAP,
      height: 746 - 280 - PANEL_GAP,
    });
  });

  it('위·아래 빈칸 중 넓은 쪽을 고른다', () => {
    // 위 빈칸 300-14-72=214, 아래 빈칸 746-500-14=232 → 아래.
    expect(avoidBox(start, cctv(800, 300, 480, 200))).toMatchObject({ top: 514, height: 232 });
    // 위 빈칸 350-14-72=264, 아래 빈칸 746-550-14=182 → 위.
    expect(avoidBox(start, cctv(800, 350, 480, 200))).toMatchObject({ top: 72, height: 264 });
  });

  it('가로로 겹치지 않거나 창이 없으면 그대로 둔다(null)', () => {
    expect(avoidBox(start, cctv(96, 128))).toBeNull();
    expect(avoidBox(start, cctv(start.left - 480, 128))).toBeNull();
    expect(avoidBox(start, null)).toBeNull();
  });

  it('넓은 쪽 빈칸도 최소 높이보다 좁으면 그대로 둔다(null)', () => {
    expect(avoidBox(start, cctv(800, 72 + PANEL_MIN_HEIGHT - 1, 480, 600))).toBeNull();
  });

  it('옮긴 패널도 그 자리 기준으로 비켜 선다', () => {
    const moved = { left: 400, top: 200, width: 340, height: 400 };
    expect(avoidBox(moved, cctv(300, 450, 480, 300))).toEqual({
      ...moved,
      height: 450 - PANEL_GAP - 200,
    });
  });
});
