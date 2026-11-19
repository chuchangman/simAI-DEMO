import { workDayOf } from '@/__tests__/features/work/workFixture';
import type { ReplayIndex } from '@/features/history/replayIndex';
import {
  dayWorksOf,
  firstMoment,
  isZeroSpanWork,
  localizeEndingReview,
  pickRun,
  replayRunsOf,
  runChoiceLabel,
  runReplayWork,
  untouched,
  withLocalizedEnding,
  workChoiceLabel,
} from '@/features/work/past/pastDay';
import { DAY_PROGRESS } from '@/features/work/types';
import { describe, expect, it } from 'vitest';

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 10, h, m, s).getTime();

describe('dayWorksOf', () => {
  const endedWork = (overrides: Parameters<typeof workDayOf>[0]) =>
    workDayOf({ date: '2026-11-10', progress: 'SUBMITTED', ...overrides });

  it('그날 작업만 계획 시작 시각순으로 고른다', () => {
    const late = endedWork({ work_id: 'late', from_ms: at(14, 0) });
    const early = endedWork({ work_id: 'early', from_ms: at(9, 0) });
    const other = endedWork({ work_id: 'other', date: '2026-11-09', from_ms: at(8, 0) });
    expect(dayWorksOf([late, other, early], '2026-11-10').map((w) => w.work_id)).toEqual([
      'early',
      'late',
    ]);
    expect(dayWorksOf([other], '2026-11-10')).toEqual([]);
  });

  it('끝난 작업(종료·제출)만 고른다: 보고서·세팅·세팅 완료·작업 중은 기록으로 치지 않는다', () => {
    const works = DAY_PROGRESS.map((progress) => endedWork({ work_id: progress, progress }));
    expect(dayWorksOf(works, '2026-11-10').map((w) => w.work_id)).toEqual(['ENDED', 'SUBMITTED']);
  });

  it('진행 값을 모르는 옛 응답은 실제로 끝난 작업만 고른다', () => {
    const ended = endedWork({ work_id: 'ended', progress: null, actual_ended_at: at(11, 0) });
    const notEnded = endedWork({ work_id: 'not-ended', progress: null, actual_ended_at: null });
    expect(dayWorksOf([notEnded, ended], '2026-11-10').map((w) => w.work_id)).toEqual(['ended']);
  });

  it('끝난 작업이 하나도 없는 날은 빈 목록이다(달력 칸이 빈칸인 날)', () => {
    const report = endedWork({ work_id: 'report', progress: 'REPORT' });
    const running = endedWork({ work_id: 'running', progress: 'IN_PROGRESS' });
    expect(dayWorksOf([report, running], '2026-11-10')).toEqual([]);
  });
});

describe('workChoiceLabel', () => {
  it('이름 · 실제 시간대, 시작하지 않았으면 계획 시간대', () => {
    const started = workDayOf({
      name: '철근 배근',
      actual_started_at: at(9, 2),
      actual_ended_at: at(11, 48),
    });
    expect(workChoiceLabel(started)).toBe('철근 배근 · 09:02–11:48');
    expect(workChoiceLabel({ ...started, actual_ended_at: null })).toBe(
      '철근 배근 · 09:02–진행 중',
    );
    expect(
      workChoiceLabel(
        workDayOf({
          name: '거푸집',
          from_ms: at(10, 0),
          to_ms: at(12, 0),
          actual_started_at: null,
        }),
      ),
    ).toBe('거푸집 · 10:00–12:00');
  });

  it('이름이 비어 있으면 `작업` 이다', () => {
    expect(workChoiceLabel(workDayOf({ name: '', from_ms: at(10, 0), to_ms: at(12, 0) }))).toBe(
      '작업 · 10:00–12:00',
    );
  });
});

describe('firstMoment', () => {
  const event = (eventId: string, raisedAt: number) => ({
    eventId,
    ruleId: 'R2',
    severity: 'HIGH' as const,
    worldIds: [],
    zoneId: null,
    raisedAt,
    resolvedAt: null,
  });
  const index = (events: ReplayIndex['events'], frames: number[] = [at(9, 0, 5)]): ReplayIndex => ({
    frames: frames.map((t) => ({ t, ids: [], tracks: [] })),
    workers: [],
    events,
    gaps: [],
    pending: null,
  });

  it('첫 기록 뒤의 첫 사건 시각이다', () => {
    expect(firstMoment(index([event('a', at(9, 10)), event('b', at(9, 20))]))).toBe(at(9, 10));
  });

  it('첫 기록 전의 사건은 건너뛴다(그때는 CCTV 가 빈다)', () => {
    expect(firstMoment(index([event('a', at(9, 0, 1)), event('b', at(9, 20))]))).toBe(at(9, 20));
  });

  it('사건이 없으면 첫 기록 시각이고, 기록이 없으면 null', () => {
    expect(firstMoment(index([]))).toBe(at(9, 0, 5));
    expect(firstMoment(index([event('a', at(9, 10))], []))).toBeNull();
  });
});

describe('untouched — 우리가 옮겨 둔 자리에 그대로 멈춰 있는지', () => {
  const place = (playhead: number | null, playing = false) => ({
    getStatus: () => ({ playhead, playing }),
  });

  it('옮겨 둔 시각에 멈춰 있으면 true 다', () => {
    expect(untouched(place(at(9, 10)), at(9, 10))).toBe(true);
  });

  it('사용자가 다른 시각으로 옮겼으면 false 다', () => {
    expect(untouched(place(at(9, 11)), at(9, 10))).toBe(false);
    expect(untouched(place(null), at(9, 10))).toBe(false);
  });

  it('같은 시각이어도 재생 중이면 false 다(재생 중에 시각이 같을 수는 없지만 재생을 눌렀다는 뜻이다)', () => {
    expect(untouched(place(at(9, 10), true), at(9, 10))).toBe(false);
  });
});

describe('실행 고르기(S15P31A101-696)', () => {
  const runs = [
    { run_no: 1, started_at: at(9, 0), ended_at: at(9, 20) },
    { run_no: 2, started_at: at(10, 0), ended_at: at(10, 30) },
  ];
  const day = workDayOf({
    progress: 'SUBMITTED',
    actual_started_at: at(9, 0),
    actual_ended_at: at(10, 30),
    runs,
  });

  it('끝난 실행을 번호순으로 주고, 실행 기록이 없는 옛 응답은 작업 구간 하나다', () => {
    expect(replayRunsOf(day).map((r) => r.run_no)).toEqual([1, 2]);
    const old = workDayOf({
      progress: 'SUBMITTED',
      actual_started_at: at(9, 0),
      actual_ended_at: at(11, 0),
    });
    expect(replayRunsOf(old)).toEqual([{ run_no: 1, started_at: at(9, 0), ended_at: at(11, 0) }]);
  });

  it('고른 번호가 없으면 마지막 실행(본 시연)이다', () => {
    expect(pickRun(runs, 1)?.run_no).toBe(1);
    expect(pickRun(runs, undefined)?.run_no).toBe(2);
    expect(pickRun(runs, 9)?.run_no).toBe(2);
    expect(pickRun([], undefined)).toBeUndefined();
  });

  it('다시 보기 구간은 고른 실행 구간이다(실행 사이는 받지 않는다)', () => {
    const replay = runReplayWork(day, runs[0]);
    expect([replay.actual_started_at, replay.actual_ended_at]).toEqual([at(9, 0), at(9, 20)]);
    expect(runReplayWork(day, undefined)).toBe(day);
    expect(runChoiceLabel(runs[1]!)).toBe('실행 2 · 10:00–10:30');
  });
});

describe('0초 작업 및 옛 종료 미팅 enum 한국어화(S15P31A101-735)', () => {
  it('시작과 종료가 같거나 역전된 작업은 0초 작업으로 판별한다', () => {
    expect(isZeroSpanWork(workDayOf({ actual_started_at: 1000, actual_ended_at: 1000 }))).toBe(
      true,
    );
    expect(isZeroSpanWork(workDayOf({ actual_started_at: 1000, actual_ended_at: 1001 }))).toBe(
      false,
    );
    expect(isZeroSpanWork(workDayOf({ actual_started_at: 1000, actual_ended_at: null }))).toBe(
      false,
    );
  });

  it('옛 종료 미팅의 CRITICAL/HIGH/CAUTION/INFO enum 을 한국어로 바꾼다', () => {
    const raw =
      '전체 이벤트 0건. 등급 CRITICAL 0건. 등급 HIGH 0건. 등급 CAUTION 0건. 등급 INFO 0건. 운영자 미확인 CRITICAL 0건, HIGH 0건.';
    expect(localizeEndingReview(raw)).toBe(
      '전체 이벤트 0건. 등급 위험 0건. 등급 경고 0건. 등급 주의 0건. 등급 안내 0건. 운영자 미확인 위험 0건, 경고 0건.',
    );
    const report = { form: { review: { daily: '일일', ending: raw } } };
    expect(withLocalizedEnding(report).form?.review.ending).toContain('등급 위험 0건');
    const clean = { form: { review: { daily: '일일', ending: '작업 종료 · 사건 0건' } } };
    expect(withLocalizedEnding(clean)).toBe(clean);
  });
});
