import type { SurfaceGeometry } from '@/features/surfaces/types';
import type { ZoneShape } from '@/features/zones/zoneForm';

// 구역 모양 계산(순수). 작업면·개구부가 구역이 될 때의 모양을 한 곳에서 정한다. 관제 작업면 편집, 세팅 AI 개구부 초안,
// 작업 레이아웃(작업 시작 때 서버가 만드는 구역)이 같은 값을 내야 하므로 모두 여기서 계산한다.

/** 좌표를 맞추는 배율(0.001 m 단위). */
const ROUND_SCALE = 1000;

/** 좌표(m)를 0.001 m 단위로 맞춘다. */
export const r3 = (v: number) => Math.round(v * ROUND_SCALE) / ROUND_SCALE;

/** 작업면이 붙은 구역의 최소 높이(m). 상판이 이보다 높으면 상판까지 올린다. */
export const SURFACE_ZONE_MIN_HEIGHT_M = 2;
/** 작업면·개구부 둘레에 구역이 남기는 여유(m). AI 개구부·가장자리 초안도 이만큼 바깥으로 민다. */
export const SURFACE_ZONE_MARGIN_M = 0.3;
/** 개구부 구역의 높이가 이보다 낮으면(믿을 수 없는 Z 범위) 바닥에서 FALLBACK 만큼 올린다(m). */
export const OPENING_ZONE_MIN_HEIGHT_M = 0.5;
export const OPENING_ZONE_FALLBACK_HEIGHT_M = 2;

/**
 * 가운데·크기·회전(rad)으로 정한 직사각형의 바닥 네 꼭짓점(반시계). margin 을 주면 사방으로 그만큼 넓힌다. 좌표는
 * 0.001 m 로 맞춘다.
 */
export function obbCorners(
  centerXy: readonly [number, number],
  sizeXy: readonly [number, number],
  yawRad: number,
  margin = 0,
): [number, number][] {
  const [cx, cy] = centerXy;
  const halfX = sizeXy[0] / 2 + margin;
  const halfY = sizeXy[1] / 2 + margin;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  const corners = [
    [-halfX, -halfY],
    [halfX, -halfY],
    [halfX, halfY],
    [-halfX, halfY],
  ] as const;
  return corners.map(([dx, dy]) => [r3(cx + dx * cos - dy * sin), r3(cy + dx * sin + dy * cos)]);
}

/** 작업면이 붙은 구역의 반쪽 크기(가로·세로): 작업면 반쪽 크기에 여유를 더한 값. */
export const surfaceZoneHalf = (g: SurfaceGeometry): [number, number] => [
  g.sizeXy[0] / 2 + SURFACE_ZONE_MARGIN_M,
  g.sizeXy[1] / 2 + SURFACE_ZONE_MARGIN_M,
];

/** 작업면이 붙은 구역의 높이: 바닥에서 최소 높이와 상판 중 큰 값까지. */
export const surfaceZoneTop = (g: SurfaceGeometry) =>
  r3(Math.max(SURFACE_ZONE_MIN_HEIGHT_M, g.topHeightM));

/**
 * 작업면이 붙은 구역의 모양: 작업면 발자국을 사방으로 SURFACE_ZONE_MARGIN_M 넓힌 직사각형(작업면이 회전했으면 같이 회전한
 * 다각형, 반시계)과 바닥(0)부터의 높이. 서버 판정은 이 다각형으로 한다.
 */
export function surfaceZoneShape(g: SurfaceGeometry): ZoneShape {
  return {
    polygon_xy: obbCorners(g.centerXy, g.sizeXy, g.yawRad, SURFACE_ZONE_MARGIN_M),
    z_min_m: 0,
    z_max_m: surfaceZoneTop(g),
  };
}

/**
 * 개구부 구역의 높이 범위. 바닥은 0 아래로 내리지 않고(없으면 0), 높이가 OPENING_ZONE_MIN_HEIGHT_M 보다 낮거나 위쪽을 모르면
 * 바닥에서 OPENING_ZONE_FALLBACK_HEIGHT_M 까지 올린다(세팅 AI 개구부 초안과 같은 규칙).
 */
export function openingZoneZ(zMin: number, zMax: number): [number, number] {
  const bottom = Math.max(0, Number.isFinite(zMin) ? zMin : 0);
  const top = Number.isFinite(zMax) ? zMax : bottom + OPENING_ZONE_FALLBACK_HEIGHT_M;
  return [
    bottom,
    top - bottom >= OPENING_ZONE_MIN_HEIGHT_M ? top : bottom + OPENING_ZONE_FALLBACK_HEIGHT_M,
  ];
}

/** 개구부(직사각형 물체)의 바닥 형상과 아래·위 높이. */
export interface OpeningGeometry {
  centerXy: [number, number];
  sizeXy: [number, number];
  yawRad: number;
  bottomZ: number;
  topZ: number;
}

/**
 * 개구부가 구역이 될 때의 모양: 직사각형을 바깥으로 SURFACE_ZONE_MARGIN_M 넓힌 다각형(반시계)과 openingZoneZ 높이. 직사각형은
 * 모서리마다 여유 안에서 맞닿으므로 세팅 AI 개구부 초안의 볼록 버퍼(bufferConvexPolygon)와 같은 다각형이 된다.
 */
export function openingZoneShape(g: OpeningGeometry): ZoneShape {
  const [zMin, zMax] = openingZoneZ(g.bottomZ, g.topZ);
  return {
    polygon_xy: obbCorners(g.centerXy, g.sizeXy, g.yawRad, SURFACE_ZONE_MARGIN_M),
    z_min_m: r3(zMin),
    z_max_m: r3(zMax),
  };
}
