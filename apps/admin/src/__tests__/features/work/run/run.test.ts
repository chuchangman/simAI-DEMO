import type { EventEntry } from '@/features/events/entries';
import type { EventItem } from '@/features/events/types';
import {
  alarmCountsOf,
  appliedStatusLines,
  submitBlockReason,
  workDurationMs,
  workEventsOf,
} from '@/features/work/run/run';
import type { WorkReport } from '@/features/work/types';
import { describe, expect, it } from 'vitest';

const START = new Date(2026, 10, 11, 9, 0).getTime();
const MIN = 60_000;

function entry(overrides: Partial<EventItem> & { event_id: string }): EventEntry {
  return {
    event: {
      rule_id: 'R2',
      source: 'LIVE',
      lifecycle: 'RAISED',
      verification: 'VERIFIED',
      severity: 'CRITICAL',
      confidence: 'HIGH',
      needs_check: false,
      world_ids: [],
      zone_id: 'z-04',
      metrics: {},
      rationale: null,
      proposed_severity: null,
      raised_at: START + MIN,
      ...overrides,
    },
    stageStartedAt: null,
  };
}

describe('workDurationMs', () => {
  it('끝난 시각이 있으면 시작~끝, 없으면 시작~지금이고 음수는 0 이다', () => {
    expect(workDurationMs(START, START + 90 * MIN, START + 999 * MIN)).toBe(90 * MIN);
    expect(workDurationMs(START, null, START + 5 * MIN)).toBe(5 * MIN);
    expect(workDurationMs(START, null, START - MIN)).toBe(0);
  });
});

describe('workEventsOf', () => {
  const entries = [
    entry({ event_id: 'before', raised_at: START - MIN }),
    entry({ event_id: 'first', raised_at: START + MIN }),
    entry({ event_id: 'later', raised_at: START + 10 * MIN, severity: 'HIGH' }),
    entry({ event_id: 'caution', raised_at: START + 2 * MIN, severity: 'CAUTION' }),
    entry({ event_id: 'planned', raised_at: START + 3 * MIN, source: 'PLANNED' }),
    entry({ event_id: 'no-time', raised_at: undefined }),
  ];

  it('작업을 시작한 뒤의 실제 위험·경고만 최근 것부터 고른다', () => {
    expect(workEventsOf(entries, START).map((e) => e.event_id)).toEqual(['later', 'first']);
  });

  it('끝난 시각이 있으면 그때까지만 본다', () => {
    expect(workEventsOf(entries, START, START + 5 * MIN).map((e) => e.event_id)).toEqual(['first']);
  });

  it('시작 기록이 없으면 비어 있다', () => {
    expect(workEventsOf(entries, null)).toEqual([]);
  });
});

describe('appliedStatusLines', () => {
  const on = { stage: 'on', problem: null } as const;
  const lines = (input: Parameters<typeof appliedStatusLines>[0]) =>
    appliedStatusLines(input).map((line) => `${line.tone}:${line.text}`);

  it('이번 작업 묶음이 적용되면 경보 켜짐·구역 수에 체크하고, 카메라는 모두 이어졌을 때만 체크한다', () => {
    expect(
      lines({ phase: on, sceneReady: true, appliedZoneCount: 3, cameras: { total: 4, live: 4 } }),
    ).toEqual([
      'ok:이번 작업 설정 현장 적용됨 · 경보 켜짐',
      'ok:3D 모델 적용됨',
      'ok:구역 3개 적용됨',
      'ok:카메라 4/4 연결',
    ]);
    // 카메라 0/4 는 체크가 아니라 경고다(-692)
    expect(
      lines({ phase: on, sceneReady: false, appliedZoneCount: 0, cameras: { total: 4, live: 0 } }),
    ).toEqual([
      'ok:이번 작업 설정 현장 적용됨 · 경보 켜짐',
      'ok:구역 0개 적용됨',
      'bad:카메라 0/4 연결',
    ]);
  });

  it('적용 전에는 대기·지연·거부·끊김을 가르고 구역 수 줄(이전 묶음 값)을 만들지 않는다', () => {
    const base = { sceneReady: false, appliedZoneCount: 5, cameras: { total: 0, live: 0 } };
    expect(lines({ ...base, phase: { stage: 'starting', problem: null } })).toEqual([
      'wait:현장 적용 대기 · 경보 꺼짐',
    ]);
    expect(lines({ ...base, phase: { stage: 'starting', problem: 'delayed' } })).toEqual([
      'bad:현장 적용 지연 · 경보 꺼짐',
    ]);
    expect(lines({ ...base, phase: { stage: 'starting', problem: 'rejected' } })).toEqual([
      'bad:현장 적용 거부 · 경보 꺼짐',
    ]);
    expect(lines({ ...base, phase: { stage: 'starting', problem: 'link_lost' } })).toEqual([
      'bad:현장 연결 끊김 · 경보 확인 불가',
    ]);
    expect(lines({ ...base, phase: { stage: 'on', problem: 'link_lost' } })).toEqual([
      'bad:현장 연결 끊김 · 경보 확인 불가',
      'ok:구역 5개 적용됨',
    ]);
  });

  it('녹화 재생(시험 입력) 중이면 「경보 켜짐」 대신 「녹화 재생 중 · 실제 알림 꺼짐」이다(S15P31A101-731)', () => {
    const cameras = { total: 4, live: 4 };
    expect(
      lines({ phase: on, sceneReady: false, appliedZoneCount: 2, cameras, testInput: true }),
    ).toEqual(['wait:녹화 재생 중 · 실제 알림 꺼짐', 'ok:구역 2개 적용됨', 'ok:카메라 4/4 연결']);
    // 적용 전 상태 줄은 그대로 두고 재생 줄을 앞에 더한다
    expect(
      lines({
        phase: { stage: 'starting', problem: null },
        sceneReady: false,
        appliedZoneCount: null,
        cameras: { total: 0, live: 0 },
        testInput: true,
      }),
    ).toEqual(['wait:녹화 재생 중 · 실제 알림 꺼짐', 'wait:현장 적용 대기 · 경보 꺼짐']);
  });

  it('재생 시험 알림 스위치가 켜져 있으면 재생 줄이 「재생 시험 · 실제 알림 켜짐」(경고)이다(S15P31A101-736)', () => {
    const cameras = { total: 4, live: 4 };
    expect(
      lines({
        phase: on,
        sceneReady: false,
        appliedZoneCount: 2,
        cameras,
        testInput: true,
        replayTestAlerts: true,
      }),
    ).toEqual(['bad:재생 시험 · 실제 알림 켜짐', 'ok:구역 2개 적용됨', 'ok:카메라 4/4 연결']);
    // 실제 카메라(재생 아님)면 스위치와 무관하게 지금 그대로다
    expect(
      lines({
        phase: on,
        sceneReady: false,
        appliedZoneCount: 2,
        cameras,
        testInput: false,
        replayTestAlerts: true,
      }),
    ).toEqual([
      'ok:이번 작업 설정 현장 적용됨 · 경보 켜짐',
      'ok:구역 2개 적용됨',
      'ok:카메라 4/4 연결',
    ]);
  });

  it('모르는 값은 줄을 만들지 않는다', () => {
    expect(
      lines({
        phase: { stage: 'unknown', problem: null },
        sceneReady: false,
        appliedZoneCount: null,
        cameras: { total: 0, live: 0 },
      }),
    ).toEqual([]);
  });
});

const ack = (at: number) => ({
  ack_id: `a-${at}`,
  channel: 'CONTROL_ROOM',
  actor_role: 'ADMIN',
  actor_id: 'u1',
  acked_at: at,
});

describe('alarmCountsOf(-734)', () => {
  const entries = [
    // 진행 중 + 확인 없음 → 미확인(열림)
    entry({ event_id: 'open-1', raised_at: START + MIN }),
    entry({ event_id: 'open-2', raised_at: START + 2 * MIN, severity: 'HIGH' }),
    // 진행 중 + 확인함
    entry({ event_id: 'open-acked', raised_at: START + 3 * MIN, acks: [ack(START + 4 * MIN)] }),
    // 해소 + 확인 없음 → 미확인(닫힘). 해소된 경보는 확인을 받지 않으므로 열린 수에는 넣지 않는다
    entry({ event_id: 'done-1', raised_at: START + 5 * MIN, lifecycle: 'RESOLVED' }),
    // 해소 + 확인함
    entry({
      event_id: 'done-acked',
      raised_at: START + 6 * MIN,
      lifecycle: 'RESOLVED',
      acks: [ack(START + 7 * MIN)],
    }),
    // 세지 않는 것: 작업 전, 경고 등급, 실제 알림이 아님, 감사 전용, 시각 없음
    entry({ event_id: 'before', raised_at: START - MIN }),
    entry({ event_id: 'caution', raised_at: START + MIN, severity: 'CAUTION' }),
    entry({ event_id: 'planned', raised_at: START + MIN, source: 'PLANNED' }),
    entry({ event_id: 'audit', raised_at: START + MIN, delivery: 'AUDIT_ONLY' }),
    entry({ event_id: 'no-time', raised_at: undefined }),
  ];

  it('이번 실행의 위험 경보 전체·미확인·열려 있는 미확인을 센다', () => {
    expect(alarmCountsOf(entries, START)).toEqual({ total: 5, unconfirmed: 3, open: 2 });
  });

  it('끝난 시각이 있으면 그때까지만 센다', () => {
    expect(alarmCountsOf(entries, START, START + 2 * MIN)).toEqual({
      total: 2,
      unconfirmed: 2,
      open: 2,
    });
  });

  it('등급이 오르거나 재개돼 새 경보 단계가 열리면 앞선 확인은 지금 단계의 확인이 아니다', () => {
    const reopened: EventEntry = {
      ...entry({ event_id: 'reopened', raised_at: START + MIN, acks: [ack(START + 2 * MIN)] }),
      stageStartedAt: START + 3 * MIN,
    };
    expect(alarmCountsOf([reopened], START)).toEqual({ total: 1, unconfirmed: 1, open: 1 });
  });

  it('시작 기록이 없으면 0건이다', () => {
    expect(alarmCountsOf(entries, null)).toEqual({ total: 0, unconfirmed: 0, open: 0 });
  });
});

describe('submitBlockReason(-734)', () => {
  const report = (over: Partial<WorkReport>) => ({ status: 'SUCCEEDED', ...over }) as WorkReport;

  it('받는 중·받기 실패·보고서 없음은 각각 다른 이유다', () => {
    expect(submitBlockReason(undefined, false)).toBe('보고서를 불러오는 중이에요');
    expect(submitBlockReason(undefined, true)).toBe(
      '보고서를 불러오지 못했어요. 새로고침해 주세요',
    );
    expect(submitBlockReason(null, false)).toBe('보고서가 없어요');
  });

  it('서버가 종료 미팅이나 AI 초안을 쓰는 중이면 그 이유를 말한다(종료 미팅이 먼저)', () => {
    expect(submitBlockReason(report({ wrap_up_status: 'GENERATING' }), false)).toBe(
      '종료 미팅 작성 중이에요',
    );
    expect(submitBlockReason(report({ status: 'GENERATING' }), false)).toBe(
      'AI 초안 작성 중이에요',
    );
    expect(
      submitBlockReason(report({ status: 'GENERATING', wrap_up_status: 'GENERATING' }), false),
    ).toBe('종료 미팅 작성 중이에요');
  });

  it('쓰는 중이 아니면 이유가 없다(켜져도 된다)', () => {
    expect(submitBlockReason(report({ wrap_up_status: 'SKIPPED' }), false)).toBeNull();
    expect(submitBlockReason(report({ wrap_up_status: 'SUCCEEDED' }), false)).toBeNull();
  });
});
