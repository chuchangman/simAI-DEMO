import { toPlan, type PlanBounds } from '@/features/plan/plan';
import { coverageClass, coverageRuns, type FloorCoverage } from '@/lib/floorCoverage';
import { memo, useMemo } from 'react';

// 평면의 바닥 감시 범위 층(S15P31A101-606). 3D 와 같은 칸 묶음(coverageRuns)을 바닥 위·구역 아래에 깐다.
// World → 평면은 toPlan 한 곳에서만 바꾼다(+Y 가 화면 위). 클릭을 받지 않는다.

export const PlanCoverage = memo(function PlanCoverage({
  coverage,
  bounds,
}: {
  coverage: FloorCoverage;
  bounds: PlanBounds;
}) {
  const rects = useMemo(
    () =>
      coverageRuns(coverage).map((run) => {
        // 평면은 Y 를 뒤집으므로 왼쪽 위 모서리는 (minX, maxY) 다
        const [x, y] = toPlan(run.minX, run.maxY, bounds);
        const cls = coverageClass(run.kind);
        return {
          key: `${run.minX},${run.minY}`,
          x,
          y,
          width: run.maxX - run.minX,
          height: run.maxY - run.minY,
          color: cls.color,
          opacity: cls.opacity,
          kind: run.kind,
        };
      }),
    [coverage, bounds],
  );
  return (
    <g data-plan-coverage pointerEvents="none">
      {rects.map((r) => (
        <rect
          key={r.key}
          data-coverage={r.kind}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={r.color}
          fillOpacity={r.opacity}
        />
      ))}
    </g>
  );
});
