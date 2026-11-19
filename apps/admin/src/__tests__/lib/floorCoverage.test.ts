import {
  coverageCounts,
  coverageRuns,
  isCoverageCurrent,
  readFloorCoverage,
  type FloorCoverage,
} from '@/lib/floorCoverage';
import { describe, expect, it } from 'vitest';

const RAW = {
  calibration_version: 'cal-1',
  cell_m: 0.5,
  origin_xy: [1, 2],
  cols: 3,
  rows: 2,
  // 행 0(가장 작은 Y): 사각 하나 + 2대 이상 둘, 행 1: 바닥 모름 + 1대 둘
  cells: '022.11',
  ankle_height_m: 0.1,
  head_height_m: 1.7,
  floor_source: 'MAPANYTHING_FLOOR_POINTS',
  is_upper_bound: true,
};

const scene = (floorCoverage: unknown) => ({ scene_version: 's-1', floor_coverage: floorCoverage });

describe('바닥 감시 범위 읽기', () => {
  it('Scene 응답의 floor_coverage 를 읽는다', () => {
    expect(readFloorCoverage(scene(RAW))).toEqual({
      calibrationVersion: 'cal-1',
      cellM: 0.5,
      originXy: [1, 2],
      cols: 3,
      rows: 2,
      cells: '022.11',
    });
  });

  it('없거나 계약과 다르면 null 이다(Scene 은 거부하지 않는다)', () => {
    expect(readFloorCoverage({ scene_version: 's-1' })).toBeNull();
    expect(readFloorCoverage(null)).toBeNull();
    for (const bad of [
      { ...RAW, cells: '022.1' }, // 길이가 cols × rows 와 다르다
      { ...RAW, cells: '022.13' }, // 모르는 칸 값
      { ...RAW, cell_m: 0 },
      { ...RAW, origin_xy: [1, Number.NaN] },
      { ...RAW, cols: 1.5 },
      { ...RAW, calibration_version: '' },
    ]) {
      expect(readFloorCoverage(scene(bad))).toBeNull();
    }
  });
});

describe('칸 묶음', () => {
  const coverage = readFloorCoverage(scene(RAW)) as FloorCoverage;

  it('행마다 같은 종류를 한 사각형으로 묶고 바닥 모름 칸은 뺀다(행 0 = 가장 작은 Y)', () => {
    expect(coverageRuns(coverage)).toEqual([
      { kind: 'blind', minX: 1, minY: 2, maxX: 1.5, maxY: 2.5 },
      { kind: 'covered', minX: 1.5, minY: 2, maxX: 2.5, maxY: 2.5 },
      { kind: 'single', minX: 1.5, minY: 2.5, maxX: 2.5, maxY: 3 },
    ]);
  });

  it('종류별 칸 수를 센다', () => {
    expect(coverageCounts(coverage)).toEqual({ covered: 2, single: 2, blind: 1 });
  });

  it('칸을 센 보정이 Tier 0 의 지금 보정과 같을 때만 지금 범위다', () => {
    expect(isCoverageCurrent(coverage, 'cal-1')).toBe(true);
    expect(isCoverageCurrent(coverage, 'cal-2')).toBe(false);
    expect(isCoverageCurrent(coverage, null)).toBe(false);
    expect(isCoverageCurrent(null, 'cal-1')).toBe(false);
  });

  it('회전 자동 복구로 보정 버전만 바뀌면 서버가 VERIFIED 로 판정한 동안 지금 범위로 본다', () => {
    const verdict = {
      sceneCalibration: 'cal-1',
      liveCalibration: 'cal-2',
      verification: 'VERIFIED',
    };
    expect(isCoverageCurrent(coverage, 'cal-2', verdict)).toBe(true);
    expect(isCoverageCurrent(coverage, 'cal-2', { ...verdict, verification: 'DIMMED' })).toBe(
      false,
    );
    // 판정이 다른 지금 보정을 비교했거나 다른 Scene 보정이면 쓰지 않는다
    expect(isCoverageCurrent(coverage, 'cal-3', verdict)).toBe(false);
    expect(isCoverageCurrent(coverage, 'cal-2', { ...verdict, sceneCalibration: 'cal-0' })).toBe(
      false,
    );
    expect(isCoverageCurrent(coverage, null, verdict)).toBe(false);
  });
});
