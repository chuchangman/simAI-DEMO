import {
  endedRuns,
  lastRun,
  nextRunNo,
  openRun,
  runLabel,
  runsOf,
  workRunsField,
} from '@/lib/workRuns';
import { describe, expect, it } from 'vitest';

// 작업 실행(S15P31A101-696): 서버 runs 를 읽고, 옛 서버(칸 없음)는 작업 시각을 실행 1 로 본다.

const T = 1_760_342_400_000;
const RUNS = [
  { run_no: 2, started_at: T + 10_000, ended_at: null },
  { run_no: 1, started_at: T, ended_at: T + 1_000 },
];

describe('workRunsField', () => {
  it('형식이 틀리거나 칸이 없으면 모름(undefined)이고 작업을 실패시키지 않는다', () => {
    expect(workRunsField.parse(undefined)).toBeUndefined();
    expect(workRunsField.parse([{ run_no: 'x' }])).toBeUndefined();
    expect(workRunsField.parse(RUNS)).toHaveLength(2);
  });
});

describe('runsOf · openRun · lastRun', () => {
  it('서버 runs 를 번호순으로 쓰고 진행 중 실행·마지막 실행·다음 번호를 고른다', () => {
    const source = { runs: RUNS, startedAt: T, endedAt: null };
    expect(runsOf(source).map((r) => r.run_no)).toEqual([1, 2]);
    expect(openRun(source)?.run_no).toBe(2);
    expect(lastRun(source)?.run_no).toBe(2);
    expect(endedRuns(source).map((r) => r.run_no)).toEqual([1]);
    expect(nextRunNo(source)).toBe(3);
    expect(runLabel({ run_no: 2 })).toBe('실행 2');
  });

  it('runs 가 없으면 작업 시작·종료를 실행 1 로, 시작 전이면 실행이 없다', () => {
    expect(runsOf({ startedAt: T, endedAt: T + 5 })).toEqual([
      { run_no: 1, started_at: T, ended_at: T + 5 },
    ]);
    expect(openRun({ startedAt: T, endedAt: T + 5 })).toBeNull();
    expect(openRun({ startedAt: T, endedAt: null })?.started_at).toBe(T);
    expect(runsOf({ startedAt: null, endedAt: null })).toEqual([]);
    expect(nextRunNo({ startedAt: null, endedAt: null })).toBe(1);
  });
});
