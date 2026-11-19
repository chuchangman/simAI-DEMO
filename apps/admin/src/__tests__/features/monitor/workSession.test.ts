import type { EventEntry } from '@/features/events/entries';
import type { EventItem } from '@/features/events/types';
import {
  activeWork,
  isOutsideWork,
  outsideWorkKind,
  splitSince,
  workElapsedLabel,
  workStartedAt,
  workZoneLabel,
} from '@/features/monitor/workSession';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { describe, expect, it } from 'vitest';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

function work(patch: Partial<TbmWorkUnit> = {}): TbmWorkUnit {
  return {
    work_id: '1',
    status: 'PLANNED',
    actual_started_at: null,
    actual_ended_at: null,
    active_setup_session_id: null,
    date: '2027-01-15',
    name: '양중 작업',
    from_ms: NOW - 120 * MIN,
    to_ms: NOW + 120 * MIN,
    zone_id: 'z-04',
    place: '개구부 구역',
    planned_people: 3,
    lead: 'B조',
    layout_id: null,
    work_type: null,
    event_counts: null,
    ...patch,
  };
}

const running = (startedMinAgo: number, patch: Partial<TbmWorkUnit> = {}) =>
  work({ status: 'IN_PROGRESS', actual_started_at: NOW - startedMinAgo * MIN, ...patch });

function event(patch: Partial<EventItem> = {}): EventItem {
  return {
    event_id: 'e-1',
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CAUTION',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0015'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: NOW,
    updated_at: NOW,
    ...patch,
  };
}

const entry = (patch: Partial<EventItem> = {}): EventEntry => ({
  event: event(patch),
  stageStartedAt: patch.raised_at ?? NOW,
});

describe('workStartedAt', () => {
  it('숫자·숫자 글자·ISO 글자를 ms 로 읽고, 없거나 읽을 수 없으면 null 이다', () => {
    expect(workStartedAt({ actual_started_at: 1234 })).toBe(1234);
    expect(workStartedAt({ actual_started_at: '1234' })).toBe(1234);
    expect(workStartedAt({ actual_started_at: '2026-11-04T06:00:00Z' })).toBe(
      Date.parse('2026-11-04T06:00:00Z'),
    );
    expect(workStartedAt({ actual_started_at: null })).toBeNull();
    expect(workStartedAt({ actual_started_at: undefined })).toBeNull();
    expect(workStartedAt({ actual_started_at: '언젠가' })).toBeNull();
    expect(workStartedAt({ actual_started_at: '' })).toBeNull();
  });
});

describe('activeWork', () => {
  it('IN_PROGRESS 작업만 진행 중이고, 없으면 null 이다', () => {
    expect(activeWork([])).toBeNull();
    expect(
      activeWork([work(), work({ work_id: '2', status: 'DONE', actual_started_at: NOW - MIN })]),
    ).toBeNull();
    expect(activeWork([work(), running(5, { work_id: '3' })])?.work_id).toBe('3');
  });

  it('둘이 오면 더 늦게 시작한 작업을 쓴다', () => {
    const picked = activeWork([running(60, { work_id: 'old' }), running(5, { work_id: 'new' })]);
    expect(picked?.work_id).toBe('new');
  });
});

describe('splitSince 시작 이전 이벤트 거르기', () => {
  const since = NOW - 30 * MIN;
  const before = entry({ event_id: 'before', raised_at: since - MIN, updated_at: since - MIN });
  const after = entry({ event_id: 'after', raised_at: since + MIN, updated_at: since + MIN });
  const same = entry({ event_id: 'same', raised_at: since, updated_at: since });

  it('시작 시각을 모르면(진행 중 작업이 없거나 시작 기록이 없음) 거르지 않고 같은 배열을 돌려준다', () => {
    const all = [before, after];
    const result = splitSince(all, null);
    expect(result.shown).toBe(all);
    expect(result.hidden).toBe(0);
  });

  it('시작 이전 발생분만 빼고(시작과 같은 시각은 남김) 뺀 수를 센다', () => {
    const result = splitSince([before, after, same], since);
    expect(result.shown.map((e) => e.event.event_id)).toEqual(['after', 'same']);
    expect(result.hidden).toBe(1);
  });

  it('발생 시각을 모르는 이벤트는 숨기지 않는다', () => {
    const unknown = entry({ event_id: 'unknown', raised_at: undefined, updated_at: undefined });
    expect(splitSince([unknown], since).shown).toEqual([unknown]);
  });

  it('시작 이전에 났어도 확인 대기 경보는 숨기지 않는다. 확인된 경보와 해소된 것은 빠진다', () => {
    const alarm = entry({
      event_id: 'alarm',
      severity: 'CRITICAL',
      raised_at: since - 5 * MIN,
      updated_at: since - 5 * MIN,
    });
    const acked: EventEntry = {
      event: {
        ...alarm.event,
        event_id: 'acked',
        acks: [
          {
            ack_id: 'a-1',
            channel: 'WEB',
            actor_role: 'ADMIN',
            actor_id: 'u',
            acked_at: since - MIN,
          },
        ],
      },
      stageStartedAt: since - 5 * MIN,
    };
    const resolved = entry({
      event_id: 'resolved',
      severity: 'CRITICAL',
      lifecycle: 'RESOLVED',
      raised_at: since - 5 * MIN,
      updated_at: since - 4 * MIN,
    });
    const result = splitSince([alarm, acked, resolved], since);
    expect(result.shown.map((e) => e.event.event_id)).toEqual(['alarm']);
    expect(result.hidden).toBe(2);
  });
});

describe('isOutsideWork 작업 외 진입 판정', () => {
  const inZone = event({ zone_id: 'z-04', raised_at: NOW - 5 * MIN });

  it('이유를 가른다: 진행 중인 작업이 없으면 NO_WORK, 작업 구역 밖이면 OUTSIDE_ZONE, 아니면 null(S15P31A101-731)', () => {
    expect(outsideWorkKind(inZone, [], NOW)).toBe('NO_WORK');
    expect(
      outsideWorkKind(event({ zone_id: 'z-09', raised_at: NOW - 5 * MIN }), [running(30)], NOW),
    ).toBe('OUTSIDE_ZONE');
    expect(outsideWorkKind(inZone, [running(30)], NOW)).toBeNull();
  });

  it('진행 중이던 작업의 구역 안에서 난 이벤트는 작업 안이다', () => {
    expect(isOutsideWork(inZone, [running(30)], NOW)).toBe(false);
  });

  it('작업 구역 밖에서 난 이벤트는 작업 외 진입이다', () => {
    expect(
      isOutsideWork(event({ zone_id: 'z-09', raised_at: NOW - 5 * MIN }), [running(30)], NOW),
    ).toBe(true);
  });

  it('진행 중인 작업이 없을 때(시작 전·종료 후) 난 이벤트는 작업 외 진입이다', () => {
    // 작업이 하나도 시작되지 않음
    expect(isOutsideWork(inZone, [work()], NOW)).toBe(true);
    expect(isOutsideWork(inZone, [], NOW)).toBe(true);
    // 이벤트가 작업 시작보다 앞
    expect(isOutsideWork(event({ raised_at: NOW - 40 * MIN }), [running(30)], NOW)).toBe(true);
    // 이벤트가 작업 종료보다 뒤
    const ended = work({
      status: 'DONE',
      actual_started_at: NOW - 60 * MIN,
      actual_ended_at: NOW - 20 * MIN,
    });
    expect(isOutsideWork(inZone, [ended], NOW)).toBe(true);
    // 종료 시각 안이면 작업 안
    expect(isOutsideWork(event({ raised_at: NOW - 30 * MIN }), [ended], NOW)).toBe(false);
  });

  it('난 시각에 돌던 작업으로 판정한다(지금 진행 중인 작업이 아니라)', () => {
    const earlier = work({
      work_id: '1',
      status: 'DONE',
      zone_id: 'z-09',
      actual_started_at: NOW - 200 * MIN,
      actual_ended_at: NOW - 100 * MIN,
    });
    const now = running(30, { work_id: '2', zone_id: 'z-04' });
    const e = event({ zone_id: 'z-09', raised_at: NOW - 150 * MIN });
    expect(isOutsideWork(e, [earlier, now], NOW)).toBe(false);
  });

  it('판정할 수 없으면 꼬리표를 달지 않는다: 구역이 없는 이벤트·구역 밖(현장 전체) 작업·발생 시각 없음·목록 기간보다 오래됨', () => {
    expect(isOutsideWork(event({ zone_id: null, raised_at: NOW - MIN }), [running(30)], NOW)).toBe(
      false,
    );
    const siteWide = running(30, { zone_id: null, place: '교실' });
    expect(isOutsideWork(event({ zone_id: 'z-09', raised_at: NOW - MIN }), [siteWide], NOW)).toBe(
      false,
    );
    expect(isOutsideWork(event({ raised_at: undefined }), [], NOW)).toBe(false);
    expect(isOutsideWork(event({ raised_at: NOW - 8 * 24 * 60 * MIN }), [], NOW)).toBe(false);
  });

  it('등급과 상관없이 같은 규칙으로 판정한다', () => {
    const critical = event({ severity: 'CRITICAL', zone_id: 'z-09', raised_at: NOW - MIN });
    expect(isOutsideWork(critical, [running(30)], NOW)).toBe(true);
  });
});

describe('표시 문구', () => {
  it('작업 구역: 구역 작업은 서버 place(구역 이름, 없으면 구역), 구역 없는 작업은 장소 또는 현장 전체', () => {
    expect(workZoneLabel({ zone_id: 'z-04', place: '개구부 구역' })).toBe('개구부 구역');
    expect(workZoneLabel({ zone_id: 'z-04', place: null })).toBe('구역');
    expect(workZoneLabel({ zone_id: null, place: '교실' })).toBe('교실');
    expect(workZoneLabel({ zone_id: null, place: null })).toBe('현장 전체');
  });

  it('경과: 1분 미만 초, 1시간 미만 분·초, 그 뒤 시간·분', () => {
    expect(workElapsedLabel(5_000)).toBe('5초');
    expect(workElapsedLabel(12 * MIN + 3_000)).toBe('12분 3초');
    expect(workElapsedLabel(65 * MIN + 30_000)).toBe('1시간 5분');
    expect(workElapsedLabel(-1)).toBe('0초');
  });
});

describe('실행(S15P31A101-696)', () => {
  const T = 1_760_342_400_000;
  const runs = [
    { run_no: 1, started_at: T, ended_at: T + 1_000 },
    { run_no: 2, started_at: T + 10_000, ended_at: null },
  ];

  it('진행 중 실행이 있으면 그 시작이 지금 관제 시작이고, 없으면 작업 시작이다', () => {
    expect(workStartedAt({ actual_started_at: T, runs })).toBe(T + 10_000);
    expect(workStartedAt({ actual_started_at: T, runs: [runs[0]!] })).toBe(T);
    expect(workStartedAt({ actual_started_at: T })).toBe(T);
  });

  it('실행 사이(관제·경보 꺼짐)에 난 이벤트는 작업 외로 본다', () => {
    const day = work({
      status: 'IN_PROGRESS',
      zone_id: null,
      actual_started_at: NOW - 60 * MIN,
      runs: [
        { run_no: 1, started_at: NOW - 60 * MIN, ended_at: NOW - 40 * MIN },
        { run_no: 2, started_at: NOW - 10 * MIN, ended_at: null },
      ],
    });
    expect(isOutsideWork(event({ raised_at: NOW - 30 * MIN }), [day], NOW)).toBe(true);
    expect(isOutsideWork(event({ raised_at: NOW - 50 * MIN }), [day], NOW)).toBe(false);
    expect(isOutsideWork(event({ raised_at: NOW - 5 * MIN }), [day], NOW)).toBe(false);
  });
});
