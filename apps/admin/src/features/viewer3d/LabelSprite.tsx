import { PALETTE, type ViewerTheme } from '@/features/viewer3d/palette';
import { useScenePalette, useSceneTheme } from '@/features/viewer3d/sceneTheme';
import type { ViewerLabelCell, ViewerLabelWatchStatus } from '@/features/viewer3d/types';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Sprite,
} from 'three';

// 장면 안 이름표(스프라이트). DOM 이름표(drei Html)는 StrictMode 이중 마운트에서 첫 이름표가 비는 문제가 있었다.
const LABEL_PX = 48;
const FONT_PX = LABEL_PX * 0.62;
const MONO_FONT = `600 ${FONT_PX}px ui-monospace, Consolas, monospace`;
const MIXED_SANS_FONT = `700 ${FONT_PX}px "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
// 띠를 단 이름표(구역)는 흰 바탕에 굵은 고딕 글자이고, 왼쪽 띠가 심각도 색이다. 테마와 상관없이 같은 모양이다.
const SANS_FONT = `800 ${FONT_PX}px "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
const TAG_BACKGROUND = '#ffffff';
const TAG_INK = PALETTE.light.label.observed;
const TAG_STRIPE_PX = 9;
const RADIUS_PX = 10;
const PADDING_PX = 12;

// 칸 목록 이름표(S15P31A101-658 A안): 3D 에서 작게 봐도 워치 선 아이콘과 한글 이름이 또렷하도록 64px 해상도로 그린다.
const CELL_HEIGHT_PX = 64;
const CELL_RADIUS_PX = 14;
const CELL_FONT = `700 36px "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
const WATCH_CELL_WIDTH_PX = 58;
const TEXT_OUTER_PAD_PX = 18;
const TEXT_AFTER_ICON_PAD_PX = 14;
const TEXT_CELL_GAP_PX = 24;
export const WATCH_DISCONNECTED_DOT_COLOR = '#ef4444';

export const WATCH_CELL_COLORS: Record<
  ViewerTheme,
  {
    connectedBg: string;
    connectedDivider: string;
    connectedStroke: string;
    disconnectedDivider: string;
    disconnectedStroke: string;
    dotRing: string;
    textDivider: string;
  }
> = {
  dark: {
    connectedBg: 'rgba(56, 189, 248, 0.24)',
    connectedDivider: 'rgba(56, 189, 248, 0.34)',
    connectedStroke: '#38bdf8',
    disconnectedDivider: 'rgba(148, 163, 184, 0.24)',
    disconnectedStroke: '#94a3b8',
    dotRing: '#0a1b33',
    textDivider: 'rgba(148, 163, 184, 0.38)',
  },
  light: {
    connectedBg: 'rgba(2, 132, 199, 0.16)',
    connectedDivider: 'rgba(2, 132, 199, 0.28)',
    connectedStroke: '#0284c7',
    disconnectedDivider: 'rgba(100, 116, 139, 0.22)',
    disconnectedStroke: '#64748b',
    dotRing: '#ffffff',
    textDivider: 'rgba(100, 116, 139, 0.32)',
  },
};

interface TextureStyle {
  ink: string;
  background: string;
  /** 왼쪽 띠 색. 있으면 띠를 단 이름표(고딕 글자)다. */
  accent: string | undefined;
}

const NON_ASCII_RE = /[^\x20-\x7E]/;

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | number[],
  color: string,
) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, radii);
  } else {
    context.rect(x, y, w, h);
  }
  context.fillStyle = color;
  context.fill();
}

function strokeRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number,
) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, radii);
  } else {
    context.rect(x, y, w, h);
  }
  context.stroke();
}

function labelTexture(
  text: string,
  style: TextureStyle,
): { texture: CanvasTexture; aspect: number } {
  const { ink, background, accent } = style;
  const stripe = accent === undefined ? 0 : TAG_STRIPE_PX;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font =
    accent !== undefined ? SANS_FONT : NON_ASCII_RE.test(text) ? MIXED_SANS_FONT : MONO_FONT;
  if (context) context.font = font;
  const textWidth = context?.measureText(text).width ?? text.length * LABEL_PX * 0.45;
  const width = Math.max(LABEL_PX, Math.ceil(textWidth + PADDING_PX * 2 + stripe));
  canvas.width = width;
  canvas.height = LABEL_PX;
  if (context) {
    if (accent === undefined) {
      fillRoundedRect(context, 0, 0, width, LABEL_PX, RADIUS_PX, background);
    } else {
      // 띠 색으로 이름표 전체를 칠한 뒤, 띠 너비만 남기고 오른쪽을 바탕색으로 덮는다(왼쪽 모서리는 띠 색이 둥글게 남는다).
      fillRoundedRect(context, 0, 0, width, LABEL_PX, RADIUS_PX, accent);
      fillRoundedRect(
        context,
        stripe,
        0,
        width - stripe,
        LABEL_PX,
        [0, RADIUS_PX, RADIUS_PX, 0],
        background,
      );
    }
    context.font = font;
    context.fillStyle = ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, stripe + (width - stripe) / 2, LABEL_PX / 2 + 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: width / LABEL_PX };
}

/**
 * 둥근 스마트워치(원형 화면 + 위아래 줄 + 시침) 단순 선 아이콘을 그린다(S15P31A101-658 A안).
 * 3D 원거리에서도 알아보게 선 굵기(4.2px)와 대비를 확보하고, 끊김이면 오른쪽 위에 작은 빨간 점을 찍는다.
 */
function drawSmartwatchIcon(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  status: ViewerLabelWatchStatus,
  theme: ViewerTheme,
) {
  const colors = WATCH_CELL_COLORS[theme];
  const stroke = status === 'connected' ? colors.connectedStroke : colors.disconnectedStroke;

  context.save();
  context.strokeStyle = stroke;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 4.2;

  // 위·아래 시계줄(원형 본체 위아래로 뻗은 둥근 사각 밴드)
  strokeRoundedRect(context, cx - 5.5, cy - 19, 11, 8.2, 2.6);
  strokeRoundedRect(context, cx - 5.5, cy + 10.8, 11, 8.2, 2.6);

  // 원형 스마트워치 본체 화면
  context.beginPath();
  context.arc(cx, cy, 10.6, 0, Math.PI * 2);
  context.stroke();

  // 시계 바늘(단순 L자 선)
  context.lineWidth = 3.4;
  context.beginPath();
  context.moveTo(cx, cy - 4.8);
  context.lineTo(cx, cy);
  context.lineTo(cx + 3.8, cy + 2.8);
  context.stroke();

  // 끊김(LOST): 아이콘 회색 + 오른쪽 위 작은 빨간 점(배경 테두리로 대비 유지)
  if (status === 'disconnected') {
    const dotX = cx + 10.5;
    const dotY = cy - 10.5;
    context.beginPath();
    context.arc(dotX, dotY, 6.2, 0, Math.PI * 2);
    context.fillStyle = WATCH_DISCONNECTED_DOT_COLOR;
    context.fill();
    context.lineWidth = 2.4;
    context.strokeStyle = colors.dotRing;
    context.stroke();
  }

  context.restore();
}

export function cellsKeyOf(cells: readonly ViewerLabelCell[] | undefined): string {
  if (!cells || cells.length === 0) return '';
  return cells
    .map((cell) => (cell.kind === 'watch' ? `w:${cell.status}` : `t:${cell.text}`))
    .join('\u0001');
}

/**
 * 칸 목록(워치 아이콘 칸 + 이름 칸 + 선택 PPE 칸)을 2D 캔버스 하나에 그린다(단위 시험에서도 직접 검증 가능).
 */
export function drawLabelCellsOnCanvas(
  canvas: HTMLCanvasElement,
  cells: readonly ViewerLabelCell[],
  options: { ink: string; background: string; theme: ViewerTheme },
): { width: number; height: number } {
  const { ink, background, theme } = options;
  const colors = WATCH_CELL_COLORS[theme];
  const context = canvas.getContext('2d');
  if (context) context.font = CELL_FONT;

  const measureText = (t: string) =>
    context?.measureText(t).width ?? [...t].length * CELL_HEIGHT_PX * 0.52;

  const hasLeadingWatch = cells[0]?.kind === 'watch';
  const textCells = cells.filter(
    (c): c is Extract<ViewerLabelCell, { kind: 'text' }> => c.kind === 'text',
  );
  const textWidths = textCells.map((c) => Math.ceil(measureText(c.text)));

  const leftPad = hasLeadingWatch ? TEXT_AFTER_ICON_PAD_PX : TEXT_OUTER_PAD_PX;
  const watchBlock = hasLeadingWatch ? WATCH_CELL_WIDTH_PX : 0;
  const totalTextWidth =
    textWidths.reduce((sum, w) => sum + w, 0) +
    Math.max(0, textWidths.length - 1) * TEXT_CELL_GAP_PX;
  const width = Math.max(
    CELL_HEIGHT_PX,
    Math.ceil(
      watchBlock + (textWidths.length > 0 ? leftPad + totalTextWidth + TEXT_OUTER_PAD_PX : 0),
    ),
  );

  canvas.width = width;
  canvas.height = CELL_HEIGHT_PX;

  if (context) {
    // 1. 전체 이름표 알약 배경(기존 투명도 규칙 유지)
    fillRoundedRect(context, 0, 0, width, CELL_HEIGHT_PX, CELL_RADIUS_PX, background);

    // 2. 왼쪽 워치 아이콘 칸(있을 때만)
    let cursorX: number;
    const first = cells[0];
    if (first?.kind === 'watch') {
      const onlyCell = textWidths.length === 0;
      const cellRadii = onlyCell ? CELL_RADIUS_PX : [CELL_RADIUS_PX, 0, 0, CELL_RADIUS_PX];
      if (first.status === 'connected') {
        fillRoundedRect(
          context,
          0,
          0,
          WATCH_CELL_WIDTH_PX,
          CELL_HEIGHT_PX,
          cellRadii,
          colors.connectedBg,
        );
      }
      if (!onlyCell) {
        fillRoundedRect(
          context,
          WATCH_CELL_WIDTH_PX - 1.5,
          10,
          1.5,
          CELL_HEIGHT_PX - 20,
          1,
          first.status === 'connected' ? colors.connectedDivider : colors.disconnectedDivider,
        );
      }
      drawSmartwatchIcon(
        context,
        WATCH_CELL_WIDTH_PX / 2 + 1,
        CELL_HEIGHT_PX / 2,
        first.status,
        theme,
      );
      cursorX = WATCH_CELL_WIDTH_PX + leftPad;
    } else {
      cursorX = leftPad;
    }

    // 3. 글자 칸들(사람 이름 칸 + 선택 PPE 칸들). 위험 색(ink) 규칙을 그대로 따른다.
    context.font = CELL_FONT;
    context.textAlign = 'left';
    context.textBaseline = 'middle';

    for (let i = 0; i < textCells.length; i++) {
      if (i > 0) {
        const dividerX = cursorX + TEXT_CELL_GAP_PX / 2 - 1;
        fillRoundedRect(context, dividerX, (CELL_HEIGHT_PX - 26) / 2, 2, 26, 1, colors.textDivider);
        cursorX += TEXT_CELL_GAP_PX;
      }
      context.fillStyle = ink;
      context.fillText(textCells[i]!.text, cursorX, CELL_HEIGHT_PX / 2 + 1.5);
      cursorX += textWidths[i]!;
    }
  }

  return { width, height: CELL_HEIGHT_PX };
}

function cellsTexture(
  cells: readonly ViewerLabelCell[],
  options: { ink: string; background: string; theme: ViewerTheme },
): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  const { width, height } = drawLabelCellsOnCanvas(canvas, cells, options);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: width / height };
}

const noRaycast = () => null;

// 화면 크기 상한·겹침 밀어내기(S15P31A101-757). 이름표는 장면 안 스프라이트라 확대하면 같이 커져 화면을 덮었다.
// 화면에서 높이가 상한(글자 높이 m × 배율 px)을 넘지 않게 줄이고, 먼저 만들어진 이름표와 겹치면 위로 밀어 올린다.
const CAP_PX_PER_M = 150;
const CAP_MIN_PX = 22;
const CAP_MAX_PX = 60;
const OVERLAP_GAP_PX = 3;
const MAX_LIFT_PX = 180;
const LIFT_EASE = 0.35;
const REGISTRY_TTL_MS = 400;

/** 이름표 상한(px). */
export const labelCapPx = (heightM: number) =>
  Math.min(Math.max(heightM * CAP_PX_PER_M, CAP_MIN_PX), CAP_MAX_PX);

/** 화면 안 이름표 자리(중심 x·y, 크기, 마지막 갱신). */
interface ScreenRect {
  seq: number;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
}

const registry = new Map<number, ScreenRect>();
let nextSeq = 1;

/**
 * 이름표를 위로 얼마나(px) 올려야 먼저 온(seq 가 작은) 이름표와 안 겹치는지. 겹침이 없으면 0.
 * 중심 (x, y)·크기 (w, h)는 이미 올린 만큼을 뺀 기준 자리다. y 는 아래로 커진다.
 */
export function liftToClear(
  me: { seq: number; x: number; y: number; w: number; h: number },
  others: readonly ScreenRect[],
): number {
  const earlier = others
    .filter((o) => o.seq < me.seq && Math.abs(o.x - me.x) * 2 < o.w + me.w)
    .sort((a, b) => b.y - a.y);
  let top = me.y - me.h / 2;
  let lift = 0;
  for (const o of earlier) {
    const oTop = o.y - o.h / 2;
    const oBottom = o.y + o.h / 2;
    const bottom = top + me.h;
    if (bottom > oTop - OVERLAP_GAP_PX && top < oBottom + OVERLAP_GAP_PX) {
      const next = oTop - OVERLAP_GAP_PX - me.h;
      lift += top - next;
      top = next;
    }
  }
  return Math.min(lift, MAX_LIFT_PX);
}

const worldAt = new Vector3();
const screenAt = new Vector3();

/** 이 거리(m)에 있는 1 m 가 화면에서 몇 px 인지. 원근은 거리와 시야각, 직교는 확대 배율로 잰다. */
function pixelsPerMeter(camera: Camera, viewportHeight: number, distance: number): number {
  if ((camera as PerspectiveCamera).isPerspectiveCamera) {
    const fov = (camera as PerspectiveCamera).fov;
    return viewportHeight / (2 * Math.max(distance, 0.05) * Math.tan((fov * Math.PI) / 360));
  }
  const ortho = camera as OrthographicCamera;
  return (viewportHeight / Math.max(ortho.top - ortho.bottom, 1e-6)) * ortho.zoom;
}

interface LabelSpriteProps {
  text?: string;
  /** 칸 목록 이름표(S15P31A101-658 A안). 주면 text 대신 칸 배열을 그린다. */
  cells?: readonly ViewerLabelCell[];
  /** 위로 띄울 높이(m, 부모 기준). */
  y: number;
  /** 글자 높이(m). */
  height?: number;
  color?: string;
  /** 왼쪽 띠 색(CSS 색). 주면 흰 바탕·굵은 고딕 글자에 이 색 띠를 단 이름표가 된다. 구역 이름표가 쓴다. */
  accent?: string;
}

/**
 * 늘 카메라를 보는 이름표. 선택을 받지 않고 깊이와 상관없이 위에 그린다. 글자·칸·색·테마가 바뀔 때만 텍스처를 새로 만든다.
 * 색을 주지 않으면 테마의 기본 글자색이고(띠를 단 이름표는 어두운 글자색), 띠 색(accent)을 주면 띠를 단 모양이 된다.
 */
export function LabelSprite({
  text = '',
  cells,
  y,
  height = 0.3,
  color,
  accent,
}: LabelSpriteProps) {
  const theme = useSceneTheme();
  const { label } = useScenePalette();
  const ink = color ?? (accent === undefined ? label.observed : TAG_INK);
  const background = accent === undefined ? label.background : TAG_BACKGROUND;
  const cellsKey = cellsKeyOf(cells);
  const sprite = useRef<Sprite>(null);
  const seq = useRef(0);
  const lift = useRef(0);
  const { texture, aspect } = useMemo(
    () =>
      cells && cells.length > 0
        ? cellsTexture(cells, { ink, background, theme })
        : labelTexture(text, { ink, background, accent }),
    // cells 내용은 cellsKey 원시 문자열로 동치 비교해 불필요한 캔버스 재생성을 막는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellsKey, text, ink, background, accent, theme],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    seq.current = nextSeq++;
    const id = seq.current;
    return () => {
      registry.delete(id);
    };
  }, []);
  useFrame(({ camera, size }) => {
    const el = sprite.current;
    if (!el) return;
    el.position.y = y;
    el.getWorldPosition(worldAt);
    const pxPerM = pixelsPerMeter(camera, size.height, camera.position.distanceTo(worldAt));
    if (!Number.isFinite(pxPerM) || pxPerM <= 0) return;
    const natural = height * pxPerM;
    const k = Math.min(1, labelCapPx(height) / natural);
    el.scale.set(height * aspect * k, height * k, 1);
    const w = height * aspect * k * pxPerM;
    const h = height * k * pxPerM;
    const ndc = screenAt.copy(worldAt).project(camera);
    const x = ((ndc.x + 1) / 2) * size.width;
    const baseY = ((1 - ndc.y) / 2) * size.height;
    const now = performance.now();
    const others = [...registry.values()].filter(
      (o) => o.seq !== seq.current && now - o.at < REGISTRY_TTL_MS,
    );
    const want = liftToClear({ seq: seq.current, x, y: baseY, w, h }, others);
    lift.current += (want - lift.current) * LIFT_EASE;
    if (Math.abs(want - lift.current) < 0.5) lift.current = want;
    el.position.y = y + lift.current / pxPerM;
    registry.set(seq.current, { seq: seq.current, x, y: baseY - lift.current, w, h, at: now });
  });
  return (
    <sprite
      ref={sprite}
      position-y={y}
      scale={[height * aspect, height, 1]}
      renderOrder={10}
      raycast={noRaycast}
    >
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
