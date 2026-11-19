import {
  boundsDepth,
  boundsWidth,
  planPoints,
  type PlanBackdrop,
  type PlanBounds,
} from '@/features/plan/plan';
import { memo } from 'react';

// 평면의 바탕 층: 방 바닥·평면도 이미지·모눈·대략 외곽·테두리. 방 범위와 바탕이 바뀔 때만 다시 그린다.

const CORNER_RADIUS = 0.08;
const IMAGE_OPACITY = 0.9;
const GRID_STROKE = 0.025;
const OUTLINE_STROKE = 0.04;
const BORDER_STROKE = 0.06;

/** min 과 max 사이(양 끝 제외)의 정수. 모눈은 World 1m 마다 긋는다. */
function innerIntegers(min: number, max: number): number[] {
  const first = Math.floor(min) + 1;
  const last = Math.ceil(max) - 1;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/** 모눈선. 평면도 이미지 위에서는 어지러워서 그리지 않는다. */
function GridLines({ bounds }: { bounds: PlanBounds }) {
  const width = boundsWidth(bounds);
  const depth = boundsDepth(bounds);
  return (
    <g className="stroke-border" strokeWidth={GRID_STROKE}>
      {innerIntegers(bounds.minX, bounds.maxX).map((x) => (
        <line key={`v${x}`} x1={x - bounds.minX} y1={0} x2={x - bounds.minX} y2={depth} />
      ))}
      {innerIntegers(bounds.minY, bounds.maxY).map((y) => (
        <line key={`h${y}`} x1={0} y1={bounds.maxY - y} x2={width} y2={bounds.maxY - y} />
      ))}
    </g>
  );
}

export const PlanRoom = memo(function PlanRoom({
  bounds,
  backdrop,
}: {
  bounds: PlanBounds;
  backdrop?: PlanBackdrop;
}) {
  const width = boundsWidth(bounds);
  const depth = boundsDepth(bounds);
  const image = backdrop?.imageUrl;
  const outline = backdrop?.outline && planPoints(backdrop.outline, bounds);
  return (
    <g>
      <rect width={width} height={depth} rx={CORNER_RADIUS} className="fill-surface-2" />
      {image && (
        <image
          data-floor-plan-image
          href={image}
          width={width}
          height={depth}
          preserveAspectRatio="none"
          opacity={IMAGE_OPACITY}
        />
      )}
      {!image && <GridLines bounds={bounds} />}
      {outline && (
        <polygon
          data-room-outline
          points={outline}
          fill="none"
          strokeWidth={OUTLINE_STROKE}
          className="stroke-foreground/30"
        />
      )}
      <rect
        width={width}
        height={depth}
        rx={CORNER_RADIUS}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={BORDER_STROKE}
      />
    </g>
  );
});
