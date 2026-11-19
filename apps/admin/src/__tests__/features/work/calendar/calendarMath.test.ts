import { workDayOf } from '@/__tests__/features/work/workFixture';
import {
  cellAriaLabel,
  dayMarkOf,
  groupByDate,
  monthCells,
  monthOfKey,
  shiftMonth,
  startWeekday,
  summarizeMonth,
  summarizeWorks,
  weeksOfMonth,
} from '@/features/work/calendar/calendarMath';
import { DAY_PROGRESS, type DayProgress } from '@/features/work/types';
import { describe, expect, it } from 'vitest';

describe('weeksOfMonth · startWeekday', () => {
  it('그 달이 걸치는 주 수를 센다(일요일 시작)', () => {
    // 2026-02-01 은 일요일이고 28일이라 꼭 4주다.
    expect(startWeekday({ year: 2026, month: 2 })).toBe(0);
    expect(weeksOfMonth({ year: 2026, month: 2 })).toBe(4);
    // 2026-11-01 은 일요일, 30일 → 5주.
    expect(weeksOfMonth({ year: 2026, month: 11 })).toBe(5);
    // 2026-08-01 은 토요일, 31일 → 6주.
    expect(startWeekday({ year: 2026, month: 8 })).toBe(6);
    expect(weeksOfMonth({ year: 2026, month: 8 })).toBe(6);
  });
});

describe('monthCells', () => {
  it('일요일에 시작하는 달은 그 달 1일부터 시작하고 끝은 다음 달 날짜로 채운다', () => {
    const cells = monthCells({ year: 2026, month: 11 });
    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({ key: '2026-11-01', day: 1, inMonth: true });
    expect(cells[29]).toEqual({ key: '2026-11-30', day: 30, inMonth: true });
    expect(cells[30]).toEqual({ key: '2026-12-01', day: 1, inMonth: false });
    expect(cells[34]).toEqual({ key: '2026-12-05', day: 5, inMonth: false });
  });

  it('토요일에 시작하는 달은 앞 달 날짜 6칸이 앞에 오고 6주(42칸)가 된다', () => {
    const cells = monthCells({ year: 2026, month: 8 });
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ key: '2026-07-26', day: 26, inMonth: false });
    expect(cells[5]).toEqual({ key: '2026-07-31', day: 31, inMonth: false });
    expect(cells[6]).toEqual({ key: '2026-08-01', day: 1, inMonth: true });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells[41]).toEqual({ key: '2026-09-05', day: 5, inMonth: false });
  });

  it('연말·연초 달도 해를 넘겨 맞는 날짜 키를 만든다', () => {
    const cells = monthCells({ year: 2026, month: 12 });
    expect(cells[0]?.key).toBe('2026-11-29');
    expect(cells.at(-1)?.key).toBe('2027-01-02');
  });
});

describe('shiftMonth · monthOfKey', () => {
  it('달을 옮기고 해를 넘는다', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2026, month: 12 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 11 }, 0)).toEqual({ year: 2026, month: 11 });
  });

  it('날짜 키가 든 달을 돌려준다', () => {
    expect(monthOfKey('2026-11-30')).toEqual({ year: 2026, month: 11 });
    expect(monthOfKey('2027-01-01')).toEqual({ year: 2027, month: 1 });
  });
});

describe('groupByDate · summarizeWorks · summarizeMonth', () => {
  it('작업을 날짜 키별로 묶는다', () => {
    const a = workDayOf({ work_id: '1', date: '2026-11-09' });
    const b = workDayOf({ work_id: '2', date: '2026-11-09' });
    const c = workDayOf({ work_id: '3', date: '2026-11-10' });
    const groups = groupByDate([a, b, c]);
    expect(groups.get('2026-11-09')?.map((w) => w.work_id)).toEqual(['1', '2']);
    expect(groups.get('2026-11-10')?.map((w) => w.work_id)).toEqual(['3']);
    expect(groups.get('2026-11-11')).toBeUndefined();
  });

  it('끝난 작업(종료·제출)만 세고, 작업 수와 위험(CRITICAL)·경고(HIGH)를 더한다(없는 칸은 0)', () => {
    expect(
      summarizeWorks([
        workDayOf({ progress: 'SUBMITTED', event_counts: { CRITICAL: 2, HIGH: 1 } }),
        workDayOf({ progress: 'ENDED', event_counts: { CRITICAL: 1 } }),
        workDayOf({ progress: 'SUBMITTED', event_counts: null }),
      ]),
    ).toEqual({ count: 3, critical: 3, high: 1 });
  });

  it('끝난 작업 모두가 관제 카드 기준 사건 수를 알면 사건 수를 함께 싣고, 접근성 이름에 경보 수와 같이 적는다(S15P31A101-751)', () => {
    const summary = summarizeWorks([
      workDayOf({
        progress: 'SUBMITTED',
        event_counts: { CRITICAL: 190, HIGH: 250 },
        incident_counts: { CRITICAL: 12, HIGH: 20 },
      }),
    ]);
    expect(summary).toEqual({
      count: 1,
      critical: 190,
      high: 250,
      incidents: { critical: 12, high: 20 },
    });
    expect(
      cellAriaLabel({ dateKey: '2026-11-15', day: 15, kind: 'past', mark: null, summary }),
    ).toBe('11월 15일, 작업 1건 완료, 위험 사건 12건(경보 190건), 경고 사건 20건(경보 250건)');
    // 하나라도 모르면(이전 서버) 사건 수를 싣지 않는다
    expect(
      summarizeWorks([
        workDayOf({
          progress: 'SUBMITTED',
          event_counts: { CRITICAL: 1 },
          incident_counts: { CRITICAL: 1 },
        }),
        workDayOf({ progress: 'SUBMITTED', event_counts: { CRITICAL: 1 } }),
      ])?.incidents,
    ).toBeUndefined();
  });

  it('끝나지 않은 작업은 건수에도 위험·경고에도 들어가지 않는다', () => {
    expect(
      summarizeWorks([
        workDayOf({ progress: 'SUBMITTED', event_counts: { CRITICAL: 1, HIGH: 2 } }),
        workDayOf({ progress: 'IN_PROGRESS', event_counts: { CRITICAL: 5, HIGH: 5 } }),
        workDayOf({ progress: 'SETUP', event_counts: { CRITICAL: 7 } }),
        workDayOf({ progress: 'REPORT' }),
      ]),
    ).toEqual({ count: 1, critical: 1, high: 2 });
  });

  it('작업 하나 안에서 실행을 여러 번 했으면(S15P31A101-696) 실행 수를 함께 싣고 접근성 이름에 넣는다', () => {
    const run = (no: number) => ({ run_no: no, started_at: no * 1000, ended_at: no * 1000 + 500 });
    const summary = summarizeWorks([
      workDayOf({ progress: 'SUBMITTED', actual_started_at: 1000, runs: [run(1), run(2)] }),
    ]);
    expect(summary).toEqual({ count: 1, critical: 0, high: 0, runs: 2 });
    expect(
      cellAriaLabel({ dateKey: '2026-11-10', day: 10, kind: 'past', mark: null, summary }),
    ).toBe('11월 10일, 작업 1건 완료, 실행 2회, 위험 0건, 경고 0건');
    // 실행이 하나면 싣지 않는다
    expect(
      summarizeWorks([workDayOf({ progress: 'SUBMITTED', runs: [run(1)] })])?.runs,
    ).toBeUndefined();
  });

  it('끝난 작업이 없으면 요약이 없다(빈칸)', () => {
    expect(summarizeWorks([])).toBeNull();
    expect(
      summarizeWorks([workDayOf({ progress: 'IN_PROGRESS' }), workDayOf({ progress: 'REPORT' })]),
    ).toBeNull();
  });

  it('월간 요약은 그 달 안(inMonth)에서 끝난 작업이 있는 날 수와 위험·경고 합계를 구하고 달 밖·예정·미종료는 뺀다', () => {
    // 2026년 10월 달력 칸: 9월 27~30일(달 밖) + 10월 1~31일(그 달)
    const cells = monthCells({ year: 2026, month: 10 });
    const byDate = groupByDate([
      // 달 밖 지난 날: 빼야 함
      workDayOf({
        work_id: 'out',
        date: '2026-09-30',
        progress: 'SUBMITTED',
        event_counts: { CRITICAL: 9, HIGH: 9 },
      }),
      // 같은 날 작업 2건이라도 작업 일수는 1일로 센다
      workDayOf({
        work_id: 'd1a',
        date: '2026-10-05',
        progress: 'SUBMITTED',
        event_counts: { CRITICAL: 2, HIGH: 1 },
      }),
      workDayOf({
        work_id: 'd1b',
        date: '2026-10-05',
        progress: 'ENDED',
        event_counts: { CRITICAL: 1 },
      }),
      // 이벤트 0건인 끝난 날
      workDayOf({
        work_id: 'd2',
        date: '2026-10-08',
        progress: 'SUBMITTED',
        event_counts: { CRITICAL: 0, HIGH: 0 },
      }),
      // 미종료 지난 날: 빼야 함
      workDayOf({
        work_id: 'unfinished',
        date: '2026-10-09',
        progress: 'IN_PROGRESS',
        event_counts: { CRITICAL: 4, HIGH: 4 },
      }),
      // 오늘(10월 15일) 끝난 작업은 포함한다
      workDayOf({
        work_id: 'today-done',
        date: '2026-10-15',
        progress: 'SUBMITTED',
        event_counts: { HIGH: 2 },
      }),
      // 예정인 날: 빼야 함
      workDayOf({
        work_id: 'future',
        date: '2026-10-20',
        progress: 'SUBMITTED',
        event_counts: { CRITICAL: 5, HIGH: 5 },
      }),
    ]);

    expect(summarizeMonth(cells, byDate, '2026-10-15')).toEqual({
      days: 3,
      critical: 3,
      high: 3,
    });
  });

  it('그 달에 끝난 작업이 없으면 월간 요약은 모두 0 이다', () => {
    const cells = monthCells({ year: 2026, month: 11 });
    expect(summarizeMonth(cells, new Map(), '2026-11-11')).toEqual({
      days: 0,
      critical: 0,
      high: 0,
    });
  });
});

describe('dayMarkOf — 지난 날', () => {
  const ENDED = { kind: 'ended' } as const;
  const mark = (progress: DayProgress) => dayMarkOf([workDayOf({ progress })], 'past');

  it('종료(ENDED)와 제출(SUBMITTED)은 둘 다 완료 표시다(종료와 제출을 나누지 않는다)', () => {
    expect(mark('ENDED')).toEqual(ENDED);
    expect(mark('SUBMITTED')).toEqual(ENDED);
  });

  it('끝나지 않은 작업(보고서·세팅·세팅 완료·작업 중)만 있는 지난 날은 빈칸이다', () => {
    for (const progress of ['REPORT', 'SETUP', 'SETUP_DONE', 'IN_PROGRESS'] as const) {
      expect(mark(progress)).toBeNull();
    }
    expect(dayMarkOf([], 'past')).toBeNull();
  });

  it('진행 값을 모르는 옛 응답은 실제로 끝난 작업만 완료 표시이고 아니면 빈칸이다', () => {
    const ended = workDayOf({ work_id: '1', daily: false, progress: null, actual_ended_at: 1_000 });
    const notEnded = workDayOf({
      work_id: '2',
      daily: false,
      progress: null,
      actual_ended_at: null,
    });
    expect(dayMarkOf([ended], 'past')).toEqual(ENDED);
    expect(dayMarkOf([notEnded], 'past')).toBeNull();
    // 끝나지 않은 작업은 건너뛰고 끝난 작업만 본다.
    expect(dayMarkOf([ended, notEnded], 'past')).toEqual(ENDED);
  });

  it('끝난 작업이 하나라도 있으면 제출 여부·순서와 상관없이 완료 표시다', () => {
    const submitted = workDayOf({ work_id: '1', daily: false, progress: 'SUBMITTED' });
    const ended = workDayOf({ work_id: '2', daily: false, progress: 'ENDED' });
    expect(dayMarkOf([submitted, ended], 'past')).toEqual(ENDED);
    expect(dayMarkOf([ended, submitted], 'past')).toEqual(ENDED);
    expect(dayMarkOf([submitted, submitted], 'past')).toEqual(ENDED);
  });

  it('끝나지 않은 작업이 섞여 있어도 표시는 끝난 작업만 따른다', () => {
    const submitted = workDayOf({ work_id: '1', daily: false, progress: 'SUBMITTED' });
    const running = workDayOf({ work_id: '2', daily: true, progress: 'IN_PROGRESS' });
    const report = workDayOf({ work_id: '3', daily: true, progress: 'REPORT' });
    expect(dayMarkOf([submitted, running, report], 'past')).toEqual(ENDED);
  });
});

describe('dayMarkOf — 오늘', () => {
  const action = (label: string) => ({ kind: 'action', label });
  const mark = (progress: DayProgress | null) => dayMarkOf([workDayOf({ progress })], 'today');

  it('진행 값마다 지금 할 일 단추 글이다(제출하면 단추 없이 완료 표시)', () => {
    expect(mark('REPORT')).toEqual(action('오늘 작업 준비'));
    expect(mark('SETUP')).toEqual(action('세팅 이어하기'));
    expect(mark('SETUP_DONE')).toEqual(action('작업 전 확인'));
    expect(mark('IN_PROGRESS')).toEqual(action('관제 중'));
    expect(mark('ENDED')).toEqual(action('보고서 제출'));
    expect(mark('SUBMITTED')).toEqual({ kind: 'ended' });
  });

  it('작업이 없거나 진행 값을 모르는 작업이면 오늘 작업 준비다', () => {
    expect(dayMarkOf([], 'today')).toEqual(action('오늘 작업 준비'));
    expect(mark(null)).toEqual(action('오늘 작업 준비'));
  });

  it('하루 작업(daily)이 있으면 그것을 따르고, 없으면 첫 작업을 따른다', () => {
    const old = workDayOf({ work_id: '1', daily: false, progress: 'SUBMITTED' });
    const daily = workDayOf({ work_id: '2', daily: true, progress: 'SETUP' });
    expect(dayMarkOf([old, daily], 'today')).toEqual(action('세팅 이어하기'));
    expect(dayMarkOf([old], 'today')).toEqual({ kind: 'ended' });
  });
});

describe('dayMarkOf — 예정인 날', () => {
  it('작업이 있든 없든 언제나 비운다', () => {
    expect(dayMarkOf([], 'future')).toBeNull();
    for (const progress of DAY_PROGRESS) {
      expect(dayMarkOf([workDayOf({ progress })], 'future')).toBeNull();
    }
    expect(dayMarkOf([workDayOf({ progress: null })], 'future')).toBeNull();
  });
});

describe('cellAriaLabel', () => {
  it('날짜에 더해 오늘 할 일·지난 날 완료 및 위험·경고 수를 담는다', () => {
    expect(
      cellAriaLabel({
        dateKey: '2026-11-11',
        day: 11,
        kind: 'today',
        mark: { kind: 'action', label: '세팅 이어하기' },
        summary: null,
      }),
    ).toBe('11월 11일, 오늘, 세팅 이어하기');

    expect(
      cellAriaLabel({
        dateKey: '2026-11-11',
        day: 11,
        kind: 'today',
        mark: { kind: 'ended' },
        summary: null,
      }),
    ).toBe('11월 11일, 오늘, 작업 완료');

    expect(
      cellAriaLabel({
        dateKey: '2026-11-09',
        day: 9,
        kind: 'past',
        mark: { kind: 'ended' },
        summary: { count: 2, critical: 3, high: 1 },
      }),
    ).toBe('11월 9일, 작업 2건 완료, 위험 3건, 경고 1건');

    expect(
      cellAriaLabel({
        dateKey: '2026-11-05',
        day: 5,
        kind: 'past',
        mark: null,
        summary: null,
      }),
    ).toBe('11월 5일');

    expect(
      cellAriaLabel({
        dateKey: '2026-11-12',
        day: 12,
        kind: 'future',
        mark: null,
        summary: null,
      }),
    ).toBe('11월 12일');
  });
});
