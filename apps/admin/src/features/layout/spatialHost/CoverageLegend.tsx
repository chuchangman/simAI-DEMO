import { COVERAGE_CLASSES, coverageCounts, type FloorCoverage } from '@/lib/floorCoverage';
import { useMemo } from 'react';

/** 넓이(m²)를 정수로. 1 m² 아래는 소수 한 자리. */
const area = (m2: number) => (m2 >= 1 ? Math.round(m2).toString() : m2.toFixed(1));

/**
 * 바닥 감시 범위 범례(-606). 감시 범위를 켰을 때 3D·2D 위 가운데 위쪽에 뜬다. 지금 보정과 맞지 않으면 색 대신 그 상태를 보인다.
 */
export function CoverageLegend({
  coverage,
  current,
}: {
  coverage: FloorCoverage;
  current: boolean;
}) {
  const counts = useMemo(() => coverageCounts(coverage), [coverage]);
  const cellArea = coverage.cellM * coverage.cellM;
  return (
    <div
      role="status"
      aria-label="감시 범위 범례"
      className="pointer-events-none absolute top-[72px] left-1/2 z-[6] flex -translate-x-1/2 items-center gap-3 rounded-[12px] bg-card/94 px-3 py-2 text-sm shadow-float backdrop-blur-[8px]"
    >
      {current ? (
        COVERAGE_CLASSES.map((cls) => (
          <span key={cls.key} data-coverage-legend={cls.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 rounded-[3px]"
              style={{ backgroundColor: cls.color, opacity: Math.min(1, cls.opacity * 2) }}
            />
            <span>{cls.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {area(counts[cls.key] * cellArea)}㎡
            </span>
          </span>
        ))
      ) : (
        <span data-coverage-legend="stale" className="text-muted-foreground">
          보정이 바뀌어 감시 범위를 표시하지 않습니다
        </span>
      )}
    </div>
  );
}
