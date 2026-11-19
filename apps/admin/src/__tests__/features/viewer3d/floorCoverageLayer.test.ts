import {
  coverageTriangles,
  FLOOR_COVERAGE_LIFT_M,
} from '@/features/viewer3d/scene/FloorCoverageLayer';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import type { CoverageRun, FloorCoverage } from '@/lib/floorCoverage';
import { describe, expect, it } from 'vitest';

const RUNS: CoverageRun[] = [
  { kind: 'blind', minX: 1, minY: 2, maxX: 1.5, maxY: 2.5 },
  { kind: 'covered', minX: 1.5, minY: 2, maxX: 2.5, maxY: 2.5 },
];

describe('바닥 감시 범위 3D 겹침', () => {
  it('칸 묶음을 바닥 위 삼각형 둘로 만들고 World (x, y, z) 를 Three (x, z, −y) 로 바꾼다', () => {
    const tri = coverageTriangles(RUNS, 'covered');
    expect(tri).toHaveLength(18);
    const points = Array.from({ length: 6 }, (_, i) => Array.from(tri.slice(i * 3, i * 3 + 3)));
    for (const p of points) expect(p[1]).toBeCloseTo(FLOOR_COVERAGE_LIFT_M);
    expect(points[0]?.[0]).toBeCloseTo(1.5);
    expect(points[0]?.[2]).toBeCloseTo(-2);
    expect(points[2]?.[0]).toBeCloseTo(2.5);
    expect(points[2]?.[2]).toBeCloseTo(-2.5);
    expect(coverageTriangles(RUNS, 'single')).toHaveLength(0);
  });

  it('Store 는 같은 객체면 바꾸지 않고 없으면 지운다', () => {
    const store = createViewerStore('LIVE');
    const coverage: FloorCoverage = {
      calibrationVersion: 'cal-1',
      cellM: 0.3,
      originXy: [0, 0],
      cols: 1,
      rows: 1,
      cells: '2',
    };
    expect(store.getState().floorCoverage).toBeNull();
    store.getState().setFloorCoverage(coverage);
    const before = store.getState();
    store.getState().setFloorCoverage(coverage);
    expect(store.getState()).toBe(before);
    store.getState().setFloorCoverage(undefined);
    expect(store.getState().floorCoverage).toBeNull();
  });
});
