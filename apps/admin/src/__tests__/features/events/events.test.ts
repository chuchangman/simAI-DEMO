import { ACK_HIDE_AFTER_MS } from '@/features/events/constants';
import { entryStatus } from '@/features/events/entries';
import {
  acknowledgedAt,
  bestCamera,
  cardChip,
  cardTitle,
  confirmationText,
  ec2Now,
  elapsedLabel,
  entryEtaLine,
  eventRuleName,
  eventSections,
  eventShortSubject,
  eventSubject,
  firstActiveRaisedAt,
  firstRaisedAt,
  groupIncidents,
  incidentOf,
  incidentTimeline,
  isAlarming,
  isConfirmationPending,
  isCurrent,
  isStale,
  mergeEvent,
  metricLabels,
  needsConfirmation,
  shortPersonId,
  targetFont,
  targetLabel,
  targetShortLabel,
  upsertEvents,
  withoutStaleAcked,
  type EventEntry,
} from '@/features/events/events';
import { statusText } from '@/features/events/format';
import { eventsPageSchema, type EventItem } from '@/features/events/types';
import { zoneNameOf } from '@/features/zones/zoneName';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;
const MIN = 60_000;

const zoneName = zoneNameOf([
  { zoneId: 'z-04', name: '개구부 구역' },
  { zoneId: 'z-02', name: '단상 구역' },
  { zoneId: 'z-05', name: '  ' },
]);

function item(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-1'],
    zone_id: 'z-04',
    metrics: { edge_distance_m: 0.82 },
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const ack = (at: number) => ({
  ack_id: `a-${at}`,
  channel: 'CONTROL_ROOM',
  actor_role: 'ADMIN',
  actor_id: 'admin',
  acked_at: at,
});

const entry = (change: Partial<EventItem> = {}) => mergeEvent(undefined, item(change));

describe('mergeEvent', () => {
  it('event_sequence 가 같거나 작은 전이는 무시한다', () => {
    const first = entry({ event_sequence: 2, lifecycle: 'UPDATED' });
    expect(mergeEvent(first, item({ event_sequence: 2 }))).toBe(first);
    expect(mergeEvent(first, item({ event_sequence: 1 }))).toBe(first);
    expect(mergeEvent(first, item({ event_sequence: 3 })).event.event_sequence).toBe(3);
  });

  it('같은 순번이면 EC2 표시용 칸만 새 값을 받고 Tier 0 전이 칸은 유지한다(S15P31A101-598)', () => {
    const first = entry({ event_sequence: 2, lifecycle: 'UPDATED', severity: 'HIGH' });
    const merged = mergeEvent(
      first,
      item({
        event_sequence: 2,
        lifecycle: 'RESOLVED',
        severity: 'INFO',
        rationale: '근거 문장',
        proposed_severity: 'CRITICAL',
        delivery: 'DELAYED_ACTIVE',
        assessments: [{ assessment_id: 7, proposed_severity: 'CRITICAL', decision: 'NONE' }],
      }),
    );
    expect(merged.event).toMatchObject({
      event_sequence: 2,
      lifecycle: 'UPDATED',
      severity: 'HIGH',
      rationale: '근거 문장',
      proposed_severity: 'CRITICAL',
      delivery: 'DELAYED_ACTIVE',
    });
    expect(merged.event.assessments).toHaveLength(1);
    expect(merged.stageStartedAt).toBe(first.stageStartedAt);
    // 거절은 같은 순번으로 상향 의견을 비운다. 근거는 null 로 지우지 않는다(늦게 온 이전 목록 응답 대비).
    const rejected = mergeEvent(
      merged,
      item({ event_sequence: 2, rationale: null, proposed_severity: null }),
    );
    expect(rejected.event.proposed_severity).toBeNull();
    expect(rejected.event.rationale).toBe('근거 문장');
    // 낮은 순번은 표시용 칸도 받지 않는다.
    expect(mergeEvent(merged, item({ event_sequence: 1, rationale: '이전' }))).toBe(merged);
  });

  it('sequence 가 없으면 시각으로 순서를 본다', () => {
    const first = entry({ event_sequence: undefined, updated_at: T + 10 });
    expect(mergeEvent(first, item({ event_sequence: undefined, updated_at: T + 5 }))).toBe(first);
    expect(
      mergeEvent(first, item({ event_sequence: undefined, updated_at: T + 20 })).event.updated_at,
    ).toBe(T + 20);
  });

  it('등급이 오르거나 재개되면 경보 단계를 새로 연다', () => {
    const high = entry({ severity: 'HIGH', updated_at: T });
    expect(high.stageStartedAt).toBe(T);
    const same = mergeEvent(high, item({ event_sequence: 2, severity: 'HIGH', updated_at: T + 5 }));
    expect(same.stageStartedAt).toBe(T);
    const raised = mergeEvent(same, item({ event_sequence: 3, updated_at: T + 9 }));
    expect(raised.stageStartedAt).toBe(T + 9);
    const resumed = mergeEvent(
      raised,
      item({ event_sequence: 4, lifecycle: 'UPDATED', resume_count: 1, updated_at: T + 30 }),
    );
    expect(resumed.stageStartedAt).toBe(T + 30);
  });

  it('처음 본 이벤트는 재개·상향 기록까지 보고 단계 시작을 정한다', () => {
    expect(entry({ resume_count: 1, updated_at: T + 40 }).stageStartedAt).toBe(T + 40);
    expect(
      entry({ escalations: [{ target_severity: 'CRITICAL', requested_at: T + 15 }] })
        .stageStartedAt,
    ).toBe(T + 15);
  });

  it('같은 순번이어도 늘어난 확인 기록은 합치고, 같은 메시지가 다시 오면 그대로 둔다', () => {
    const first = entry({ event_sequence: 3, severity: 'HIGH' });
    const acked = mergeEvent(first, item({ event_sequence: 3, acks: [ack(T + 10)] }));
    expect(acked.event.acks).toHaveLength(1);
    expect(acked.event.severity).toBe('HIGH');
    expect(isAlarming(acked)).toBe(false);
    expect(mergeEvent(acked, item({ event_sequence: 3, acks: [ack(T + 10)] }))).toBe(acked);
  });

  it('새 상태에 빠진 확인 기록도 이어 간다', () => {
    const acked = entry({ event_sequence: 3, acks: [ack(T + 10)] });
    const next = mergeEvent(acked, item({ event_sequence: 4, updated_at: T + 20 }));
    expect(next.event.acks?.map((a) => a.ack_id)).toEqual([`a-${T + 10}`]);
  });
});

describe('isAlarming', () => {
  it('LIVE·CRITICAL/HIGH·진행 중이고 지금 단계에서 확인 전이면 울린다', () => {
    expect(isAlarming(entry())).toBe(true);
    expect(isAlarming(entry({ severity: 'HIGH' }))).toBe(true);
    expect(isAlarming(entry({ severity: 'CAUTION' }))).toBe(false);
    expect(isAlarming(entry({ lifecycle: 'RESOLVED' }))).toBe(false);
    expect(isAlarming(entry({ source: 'WHAT_IF' }))).toBe(false);
  });

  it('감사 전용(AUDIT_ONLY)은 REST 로 다시 받아도 울리지 않고, 지연 알림(DELAYED_ACTIVE)은 울린다', () => {
    expect(isAlarming(entry({ delivery: 'AUDIT_ONLY' }))).toBe(false);
    expect(isAlarming(entry({ delivery: 'DELAYED_ACTIVE' }))).toBe(true);
    expect(isAlarming(entry({ delivery: 'REALTIME' }))).toBe(true);
  });

  it('확인하면 멈추고, 그 뒤 등급이 오르거나 재개되면 다시 울린다', () => {
    const acked = entry({ severity: 'HIGH', acks: [ack(T + 2)] });
    expect(isAlarming(acked)).toBe(false);
    expect(acknowledgedAt(acked)).toBe(T + 2);

    const raised = mergeEvent(
      acked,
      item({ event_sequence: 2, severity: 'CRITICAL', updated_at: T + 5, acks: [ack(T + 2)] }),
    );
    expect(isAlarming(raised)).toBe(true);
    const ackedAgain = mergeEvent(
      raised,
      item({ event_sequence: 3, updated_at: T + 6, acks: [ack(T + 2), ack(T + 7)] }),
    );
    expect(isAlarming(ackedAgain)).toBe(false);
  });

  it('처음 본 이벤트는 마지막 갱신 뒤의 확인만 인정한다(규칙이 올린 등급은 언제 올랐는지 모른다)', () => {
    // HIGH 로 발생(T) → 확인(T+1000) → 규칙이 CRITICAL 로 올림(T+2000). 그 뒤 로그인해 처음 본다.
    const raisedByRule = entry({ updated_at: T + 2000, acks: [ack(T + 1000)] });
    expect(isAlarming(raisedByRule)).toBe(true);
    // 확인이 마지막 갱신과 같거나 뒤면(확인 전이) 확인된 것으로 본다.
    expect(isAlarming(entry({ updated_at: T + 2000, acks: [ack(T + 2000)] }))).toBe(false);
  });
});

describe('upsertEvents', () => {
  it('LIVE 만 담고, 바뀐 것이 없으면 같은 배열을 돌려준다', () => {
    const list = upsertEvents([], [item(), item({ event_id: 'e-2', source: 'REPLAY' })]);
    expect(list.map((e) => e.event.event_id)).toEqual(['e-1']);
    expect(upsertEvents(list, [item()])).toBe(list);
  });

  it('해소된 이벤트는 최근 50개만 남긴다', () => {
    const resolved = Array.from({ length: 60 }, (_, i) =>
      item({ event_id: `r-${i}`, lifecycle: 'RESOLVED', updated_at: T + i }),
    );
    const list = upsertEvents([], [...resolved, item({ event_id: 'live' })]);
    expect(list).toHaveLength(51);
    expect(list.some((e) => e.event.event_id === 'r-0')).toBe(false);
    expect(list.some((e) => e.event.event_id === 'live')).toBe(true);
  });
});

describe('groupIncidents', () => {
  it('같은 사람의 여러 규칙은 한 묶음이고, 묶음 등급은 진행 중 규칙 중 가장 높다', () => {
    const entries: EventEntry[] = [
      entry({ event_id: 'a', rule_id: 'R1', severity: 'HIGH', world_ids: ['w-1'] }),
      entry({
        event_id: 'b',
        rule_id: 'R2',
        severity: 'CRITICAL',
        world_ids: ['w-1'],
        lifecycle: 'RESOLVED',
      }),
      entry({ event_id: 'c', rule_id: 'R5', severity: 'CAUTION', world_ids: ['w-2'] }),
      entry({ event_id: 'd', rule_id: 'R7', severity: 'CAUTION', world_ids: [], zone_id: 'z-02' }),
    ];
    const incidents = groupIncidents(entries);
    expect(incidents.map((i) => i.key)).toEqual(['person:w-1', 'person:w-2', 'zone:z-02']);
    const [first] = incidents;
    expect(first?.severity).toBe('HIGH');
    expect(first?.entries.map((e) => e.event.event_id)).toEqual(['a', 'b']);
    expect(first?.alarming).toBe(true);
  });

  it('진행 중 묶음이 해소된 묶음보다 앞이다', () => {
    const incidents = groupIncidents([
      entry({ event_id: 'old', world_ids: ['w-9'], lifecycle: 'RESOLVED', updated_at: T + 100 }),
      entry({ event_id: 'new', world_ids: ['w-1'], severity: 'CAUTION' }),
    ]);
    expect(incidents.map((i) => i.active)).toEqual([true, false]);
  });

  it('묶음 안의 해소된 규칙은 최근 두 건만 보인다', () => {
    const resolved = [1, 2, 3, 4].map((n) =>
      entry({ event_id: `r${n}`, lifecycle: 'RESOLVED', updated_at: T + n * 100 }),
    );
    const [incident] = groupIncidents([
      ...resolved,
      entry({ event_id: 'live', severity: 'HIGH', updated_at: T }),
    ]);
    expect(incident?.entries.map((e) => e.event.event_id)).toEqual(['live', 'r4', 'r3']);
    expect(incident?.severity).toBe('HIGH');
  });
});

describe('eventSections', () => {
  const done = (change: Partial<EventItem>) =>
    entry({ lifecycle: 'RESOLVED', resolved_at: T + 1_000, updated_at: T + 1_000, ...change });

  it('진행 중 사건과 해소된 묶음을 두 칸으로 나눈다', () => {
    const { active, resolved } = eventSections([
      entry({ event_id: 'live', world_ids: ['w-1'] }),
      done({ event_id: 'old', world_ids: ['w-2'] }),
    ]);
    expect(active.map((c) => c.incident.key)).toEqual(['person:w-1']);
    expect(resolved.map((g) => g.incident.key)).toEqual(['person:w-2']);
  });

  it('같은 사람이 진행 중이면서 지난 해소도 있으면 두 칸에 모두 나온다', () => {
    const { active, resolved } = eventSections([
      entry({ event_id: 'live', world_ids: ['w-1'] }),
      done({ event_id: 'old', rule_id: 'R1', severity: 'HIGH', world_ids: ['w-1'] }),
    ]);
    expect(active.map((c) => c.incident.key)).toEqual(['person:w-1']);
    expect(resolved.map((g) => g.incident.key)).toEqual(['person:w-1']);
    expect(resolved[0]?.incident.active).toBe(false);
  });

  it('해소 묶음은 같은 사람의 같은 규칙·구역만 한 카드이고, 발생 횟수를 센다', () => {
    const { resolved } = eventSections([
      done({ event_id: 'a', updated_at: T + 100, resolved_at: T + 100 }),
      done({ event_id: 'b', updated_at: T + 200, resolved_at: T + 200 }),
      done({ event_id: 'c', rule_id: 'R1', severity: 'HIGH', zone_id: 'z-02' }),
      done({ event_id: 'd', zone_id: 'z-05', updated_at: T + 50, resolved_at: T + 50 }),
    ]);
    // 규칙이 다르거나 구역이 다르면 같은 사람이어도 다른 카드다.
    expect(resolved).toHaveLength(3);
    expect(new Set(resolved.map((g) => g.id)).size).toBe(3);
    expect(resolved.map((g) => g.occurrences).sort()).toEqual([1, 1, 2]);
  });

  it('발생 횟수는 해소 뒤 곧바로 다시 열린(resume) 횟수를 더한다', () => {
    const { resolved } = eventSections([
      done({ event_id: 'a', resume_count: 2, updated_at: T + 100, resolved_at: T + 100 }),
      done({ event_id: 'b', updated_at: T + 200, resolved_at: T + 200 }),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.occurrences).toBe(4);
  });

  it('해소 칸은 최근에 해소된 묶음부터 네 건만 보인다', () => {
    // 같은 위험·구역이라도 짧은 시간(1분) 밖이면 다른 카드다
    const entries = [1, 2, 3, 4, 5, 6].map((n) =>
      done({
        event_id: `r${n}`,
        world_ids: [`w-${n}`],
        raised_at: T + n * 10 * MIN,
        updated_at: T + n * 10 * MIN,
        resolved_at: T + n * 10 * MIN,
      }),
    );
    const { resolved } = eventSections(entries);
    expect(resolved.map((g) => g.incident.key)).toEqual([
      'person:w-6',
      'person:w-5',
      'person:w-4',
      'person:w-3',
    ]);
  });
});

describe('화면 묶음(S15P31A101-731)', () => {
  const SEC = 1_000;
  const live = (id: string, person: string, at: number, change: Partial<EventItem> = {}) =>
    entry({ event_id: id, world_ids: [person], raised_at: at, updated_at: at, ...change });
  const done = (id: string, person: string, at: number, change: Partial<EventItem> = {}) =>
    entry({
      event_id: id,
      world_ids: [person],
      lifecycle: 'RESOLVED',
      raised_at: at,
      updated_at: at + 2 * SEC,
      resolved_at: at + 2 * SEC,
      ...change,
    });

  it('트랙 번호만 바뀌며 이어진 같은 위험·구역 진행 중 경보는 살아 있는 사람 카드 하나에 N회로 묶인다', () => {
    // 17차: 화면에는 한 사람(w-235)인데 사라진 번호(w-205·w-224)의 같은 경보가 진행 중으로 남았다
    const { active } = eventSections(
      [live('a', 'w-205', T), live('b', 'w-224', T + 40 * SEC), live('c', 'w-235', T + 80 * SEC)],
      { alive: new Set(['w-235']) },
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.incident.target).toEqual({ type: 'person', id: 'w-235' });
    expect(active[0]!.occurrences).toBe(3);
    expect(active[0]!.people).toBe(3);
    // 확인 대기 경보가 카드에서 사라지지 않게 묶인 경보 전부가 카드 칩·점멸에 든다
    expect(active[0]!.incident.alarming).toBe(true);
    expect(firstActiveRaisedAt(active[0]!.incident)).toBe(T);
    expect(active[0]!.incident.entries[0]!.event.event_id).toBe('c');
  });

  it('지금 살아 있는 서로 다른 두 사람은 같은 위험·구역·시각이어도 묶지 않는다', () => {
    const { active } = eventSections(
      [live('a', 'w-1', T), live('b', 'w-2', T + SEC), live('c', 'w-gone', T + 2 * SEC)],
      { alive: new Set(['w-1', 'w-2']) },
    );
    expect(active.map((c) => c.incident.key).sort()).toEqual(['person:w-1', 'person:w-2']);
    // 사라진 번호는 둘 중 한 사람에게만 붙는다(사람 카드는 그대로 둘이다)
    expect(active.reduce((n, c) => n + c.people, 0)).toBe(3);
  });

  it('살아 있는 사람을 모르면(World 수신 전) 서로 다른 사람을 묶지 않는다', () => {
    const { active } = eventSections([live('a', 'w-1', T), live('b', 'w-2', T + SEC)]);
    expect(active).toHaveLength(2);
    expect(active.every((c) => c.people === 1 && c.occurrences === 1)).toBe(true);
  });

  it('위험(규칙)이나 구역이 다르거나 짧은 시간(1분) 밖이면 묶지 않는다', () => {
    const alive = new Set(['w-3']);
    expect(
      eventSections([live('a', 'w-1', T), live('b', 'w-3', T + 10 * SEC, { rule_id: 'R1' })], {
        alive,
      }).active,
    ).toHaveLength(2);
    expect(
      eventSections([live('a', 'w-1', T), live('b', 'w-3', T + 10 * SEC, { zone_id: 'z-02' })], {
        alive,
      }).active,
    ).toHaveLength(2);
    expect(
      eventSections([live('a', 'w-1', T), live('b', 'w-3', T + 2 * MIN)], { alive }).active,
    ).toHaveLength(2);
  });

  it('최근 해소도 같은 위험·구역의 짧은 시간 안 발생을 번호가 달라도 한 카드로 센다', () => {
    const { resolved } = eventSections(
      [done('a', 'w-1', T), done('b', 'w-2', T + 30 * SEC), done('c', 'w-3', T + 5 * MIN)],
      { alive: new Set() },
    );
    expect(resolved.map((g) => g.occurrences)).toEqual([1, 2]);
    expect(resolved[1]!.people).toBe(2);
  });

  it('지금 실행 시각을 주면 최근 해소는 그 뒤 발생만, 실행이 없으면(null) 비운다. 진행 중은 그대로다', () => {
    const entries = [
      live('now', 'w-9', T + 10 * MIN),
      done('old', 'w-1', T),
      done('new', 'w-2', T + 20 * MIN),
    ];
    expect(
      eventSections(entries, { runStartedAt: T + 5 * MIN }).resolved.map(
        (g) => g.incident.entries[0]!.event.event_id,
      ),
    ).toEqual(['new']);
    const standby = eventSections(entries, { runStartedAt: null });
    expect(standby.resolved).toEqual([]);
    expect(standby.active).toHaveLength(1);
    expect(eventSections(entries).resolved).toHaveLength(2);
  });
});

describe('사람 ID 줄이기', () => {
  it('끝번호만 남기고, 구분이 없거나 끝이 비면 그대로 둔다', () => {
    expect(shortPersonId('w-mw8y3hai-0722')).toBe('0722');
    expect(shortPersonId('w-0012')).toBe('0012');
    expect(shortPersonId('0012')).toBe('0012');
    expect(shortPersonId('w-')).toBe('w-');
  });

  it('이벤트 대상은 사람이면 끝번호, 사람이 없으면 구역 이름 그대로다', () => {
    // 이름 목록이 없으면 끝번호를 「작업자 #」로 적는다(S15P31A101-731, 4자리 번호만으로는 뜻을 몰랐다)
    expect(eventShortSubject(item({ world_ids: ['w-mw8y3hai-0722'] }), zoneName)).toBe(
      '작업자 #0722',
    );
    expect(eventShortSubject(item({ world_ids: [], zone_id: 'z-04' }), zoneName)).toBe(
      '개구부 구역',
    );
    // 전체 문구(eventSubject)는 그대로다.
    expect(eventSubject(item({ world_ids: ['w-mw8y3hai-0722'] }), zoneName)).toBe(
      'w-mw8y3hai-0722',
    );
  });

  it('묶음 대상은 사람이면 끝번호이고 targetLabel 은 전체 ID 그대로다', () => {
    const person = groupIncidents([entry({ world_ids: ['w-mw8y3hai-0722'] })])[0]!.target;
    expect(targetShortLabel(person, zoneName)).toBe('작업자 #0722');
    expect(targetLabel(person, zoneName)).toBe('w-mw8y3hai-0722');
    const zone = groupIncidents([entry({ world_ids: [], zone_id: 'z-04' })])[0]!.target;
    expect(targetShortLabel(zone, zoneName)).toBe('개구부 구역');
    expect(targetShortLabel(null, zoneName)).toBe('대상 없음');
  });
});

describe('확인 필요와 오래된 확인', () => {
  const needsCheck = { verification: 'UNVERIFIABLE', needs_check: true } as const;
  const HOUR = 3_600_000;

  it('확인 필요는 운영자가 확인하기 전에만 이어진다', () => {
    expect(isConfirmationPending(entry(needsCheck))).toBe(true);
    expect(isConfirmationPending(entry({ ...needsCheck, acks: [ack(T + 10)] }))).toBe(false);
    // 확인을 요청하지 않는 이벤트는 확인 전에도 아니다.
    expect(isConfirmationPending(entry())).toBe(false);
    // 확인한 뒤 등급이 올라 새 경보 단계가 열리면 다시 확인 필요다.
    const acked = entry({ ...needsCheck, severity: 'HIGH', acks: [ack(T + 2)] });
    const raised = mergeEvent(
      acked,
      item({
        ...needsCheck,
        event_sequence: 2,
        severity: 'CRITICAL',
        updated_at: T + 5,
        acks: [ack(T + 2)],
      }),
    );
    expect(isConfirmationPending(raised)).toBe(true);
  });

  it('확인한 지 24시간이 지난 이벤트만 뺀다', () => {
    const old = entry({ event_id: 'old', acks: [ack(T)], updated_at: T });
    const edge = entry({ event_id: 'edge', acks: [ack(T + 1)], updated_at: T + 1 });
    const recent = entry({
      event_id: 'recent',
      acks: [ack(T + 2 * HOUR)],
      updated_at: T + 2 * HOUR,
    });
    const unacked = entry({ event_id: 'unacked' });
    const now = T + ACK_HIDE_AFTER_MS;

    const shown = withoutStaleAcked([old, edge, recent, unacked], now);
    // 정확히 24시간(old)은 뺀다. 1ms 모자란 것(edge)과 확인하지 않은 오래된 이벤트는 남는다.
    expect(shown.map((e) => e.event.event_id)).toEqual(['edge', 'recent', 'unacked']);
  });

  it('뺄 것이 없으면 받은 배열을 그대로 돌려준다', () => {
    const entries = [
      entry({ event_id: 'a', acks: [ack(T)], updated_at: T }),
      entry({ event_id: 'b' }),
    ];
    expect(withoutStaleAcked(entries, T + 60_000)).toBe(entries);
    expect(withoutStaleAcked([], T + 2 * ACK_HIDE_AFTER_MS)).toEqual([]);
  });

  it('확인한 뒤 새 경보 단계가 열린 이벤트는 이전 확인이 24시간 지나도 남는다', () => {
    const acked = entry({ severity: 'HIGH', acks: [ack(T)] });
    const raised = mergeEvent(
      acked,
      item({
        event_sequence: 2,
        severity: 'CRITICAL',
        updated_at: T + 5,
        raised_at: T,
        acks: [ack(T)],
      }),
    );
    expect(withoutStaleAcked([raised], T + 2 * ACK_HIDE_AFTER_MS)).toEqual([raised]);
  });
});

describe('표시 값', () => {
  it('규칙 이름은 모든 등급에서 공통 사전을 쓴다', () => {
    const name = (rule_id: string, severity: EventItem['severity']) =>
      eventRuleName(item({ rule_id, severity }));
    expect(name('R1', 'CAUTION')).toBe('위험구역 진입');
    expect(name('R1', 'HIGH')).toBe('위험구역 진입');
    expect(name('R1', 'CRITICAL')).toBe('위험구역 진입');
    expect(name('R5', 'CAUTION')).toBe('위험구역 접근');
    expect(name('R99', 'CAUTION')).toBe('R99');
  });

  it('지표는 단위를 붙여 보인다', () => {
    expect(metricLabels({ edge_distance_m: 0.823, height_diff_m: 2.1, dwell_s: 1.44 })).toEqual([
      '가장자리 0.82m',
      '높이 차 2.10m',
      'dwell 1.4초',
    ]);
  });
});

describe('사건 상세', () => {
  const r2 = entry({ event_id: 'r2', rule_id: 'R2', raised_at: T + 5_000, updated_at: T + 5_000 });
  const r1 = entry({
    event_id: 'r1',
    rule_id: 'R1',
    severity: 'HIGH',
    raised_at: T,
    updated_at: T + 9_000,
    lifecycle: 'RESOLVED',
    resolved_at: T + 9_000,
    acks: [ack(T + 2_000)],
  });

  it('카드 머리줄 시각은 묶음에서 가장 먼저 발생한 시각이다', () => {
    const [incident] = groupIncidents([r2, r1]);
    expect(firstRaisedAt(incident!)).toBe(T);
  });

  it('누른 이벤트가 든 묶음을 찾고, 목록에 없으면 없다', () => {
    expect(incidentOf([r2, r1], 'r1')?.key).toBe('person:w-1');
    expect(incidentOf([r2, r1], 'missing')).toBeUndefined();
  });

  it('사람별 묶음에서 잘린 해소 이벤트도 해소 묶음으로 찾는다', () => {
    const resolved = [1, 2, 3].map((n) =>
      entry({
        event_id: `d${n}`,
        rule_id: `R${n}`,
        lifecycle: 'RESOLVED',
        resolved_at: T + n * 100,
        updated_at: T + n * 100,
      }),
    );
    // 사람별 묶음은 최근 해소 두 건(d3·d2)만 담지만, 가장 오래된 d1 카드도 상세를 연다.
    expect(groupIncidents(resolved)[0]?.entries.map((e) => e.event.event_id)).toEqual(['d3', 'd2']);
    const found = incidentOf(resolved, 'd1');
    expect(found?.key).toBe('person:w-1');
    expect(found?.entries.map((e) => e.event.event_id)).toEqual(['d1']);
  });

  it('타임라인은 규칙마다 발생·확인·해소를 시각 순으로 늘어놓는다', () => {
    const [incident] = groupIncidents([r2, r1]);
    expect(incidentTimeline(incident!)).toEqual([
      { at: T, who: '시스템', text: '위험구역 진입 발생' },
      { at: T + 2_000, who: '관제', text: expect.stringMatching(/^위험구역 진입 확인 · /) },
      { at: T + 5_000, who: '시스템', text: '추락 위험(가장자리) 발생' },
      { at: T + 9_000, who: '시스템', text: '위험구역 진입 해소' },
    ]);
  });

  it('R1 주의의 타임라인은 위험구역 진입으로 적는다', () => {
    const [incident] = groupIncidents([entry({ rule_id: 'R1', severity: 'CAUTION' })]);
    expect(incidentTimeline(incident!)[0]).toMatchObject({ text: '위험구역 진입 발생' });
  });

  it('운영자가 끝낸 규칙은 운영자 종료로 적는다', () => {
    const closed = entry({
      lifecycle: 'RESOLVED',
      resolved_at: T + 1_000,
      resolution: { kind: 'OPERATOR_CLOSED', reason: '오탐', requested_at: T },
    });
    const [incident] = groupIncidents([closed]);
    expect(incidentTimeline(incident!).at(-1)).toEqual({
      at: T + 1_000,
      who: '운영자',
      text: '추락 위험(가장자리) 종료',
    });
  });
});

describe('병합 흡수 마감(IDENTITY_MERGED, S15P31A101-657)', () => {
  const merged = {
    kind: 'IDENTITY_MERGED' as const,
    survivor_event_id: '0192a6f0-7c1e-7b3a-9f2d-3c4b5a6d7e92',
    survivor_world_id: 'w-lobby-0059',
    merged_world_id: 'w-lobby-0061',
  };

  it('이벤트 목록 응답에 병합 흡수 resolution 이 있어도 목록 전체를 받는다', () => {
    const closed = item({
      event_id: 'e-2',
      lifecycle: 'RESOLVED',
      resolved_at: T + 1_000,
      resolution: merged,
    });
    expect(eventsPageSchema.safeParse({ content: [closed, item()] }).success).toBe(true);
  });

  it('알 수 없는 resolution 종류는 여전히 거부한다', () => {
    const bad = { ...item(), resolution: { kind: 'SOMETHING_ELSE' } };
    expect(eventsPageSchema.safeParse({ content: [bad] }).success).toBe(false);
  });

  it('병합 흡수는 운영자 종료로도 해소로도 적지 않는다', () => {
    const [incident] = groupIncidents([
      entry({ lifecycle: 'RESOLVED', resolved_at: T + 1_000, resolution: merged }),
    ]);
    expect(incidentTimeline(incident!).at(-1)).toEqual({
      at: T + 1_000,
      who: '시스템',
      text: '추락 위험(가장자리) 같은 사람 ID 병합으로 이어짐',
    });
  });
});

describe('EC2 마감(WORK_ENDED·SESSION_ENDED·NOT_IN_SNAPSHOT, S15P31A101-722)', () => {
  const sessionEnded = {
    kind: 'SESSION_ENDED' as const,
    close_id: '5f0c2a8e-3b1d-4c7a-9e2f-7a1b2c3d4e5f',
    closed_at: T + 2_000,
    reason:
      'GPU 세션이 끝나(END_REPORTED) 이 이벤트를 들고 있던 Tier 0 가 사라졌다. 관측 해소 아님',
    trigger_ref: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    last_event_sequence: 4,
  };
  const closedBySession = (change: Partial<EventItem> = {}) =>
    entry({ lifecycle: 'RESOLVED', resolved_at: T + 2_000, resolution: sessionEnded, ...change });

  it('이벤트 목록 응답에 EC2 마감 resolution 이 있어도 목록 전체를 받는다(trigger_ref 모름 null 포함)', () => {
    const closed = item({
      event_id: 'e-2',
      lifecycle: 'RESOLVED',
      resolved_at: T + 2_000,
      resolution: sessionEnded,
    });
    const unknownTrigger = item({
      event_id: 'e-3',
      lifecycle: 'RESOLVED',
      resolved_at: T + 2_000,
      resolution: {
        ...sessionEnded,
        kind: 'NOT_IN_SNAPSHOT',
        trigger_ref: null,
        last_event_sequence: null,
      },
    });
    expect(eventsPageSchema.safeParse({ content: [closed, unknownTrigger, item()] }).success).toBe(
      true,
    );
  });

  it('최근 해소 칸에 넣지 않고, 관측 해소 묶음은 그대로 남긴다', () => {
    const { active, resolved } = eventSections([
      closedBySession({ event_id: 'gone', world_ids: ['w-9'] }),
      entry({
        event_id: 'seen',
        world_ids: ['w-2'],
        lifecycle: 'RESOLVED',
        resolved_at: T + 1_000,
      }),
    ]);
    expect(active).toEqual([]);
    expect(resolved.map((g) => g.incident.key)).toEqual(['person:w-2']);
  });

  it('상태 문구와 타임라인에 해소·운영자 종료가 아니라 마감 까닭을 적는다', () => {
    const closed = closedBySession();
    expect(statusText(entryStatus(closed))).toMatch(/^GPU 세션 종료로 마감 \d{2}:\d{2}:\d{2}$/);
    const [incident] = groupIncidents([closed]);
    expect(incidentTimeline(incident!).at(-1)).toEqual({
      at: T + 2_000,
      who: '시스템',
      text: '추락 위험(가장자리) GPU 세션 종료로 마감',
    });
    const work = closedBySession({
      resolution: { ...sessionEnded, kind: 'WORK_ENDED', trigger_ref: '42' },
    });
    expect(statusText(entryStatus(work))).toMatch(/^작업 종료로 마감 /);
  });
});

describe('카드 표시 계산', () => {
  const incidentOfEntries = (...entries: EventEntry[]) => groupIncidents(entries)[0]!;
  const HH = /^확인 \d{2}:\d{2}:\d{2}$/;

  it('경과는 초, 1분부터 분과 초, 1시간부터 시간과 분, 하루부터 일과 시간으로 쓰고 음수는 0초다', () => {
    expect(elapsedLabel(0)).toBe('0초');
    expect(elapsedLabel(12_900)).toBe('12초');
    expect(elapsedLabel(60_000)).toBe('1분');
    expect(elapsedLabel(200_000)).toBe('3분 20초');
    expect(elapsedLabel(3_599_000)).toBe('59분 59초');
    expect(elapsedLabel(3_600_000)).toBe('1시간');
    expect(elapsedLabel(7_500_000)).toBe('2시간 5분');
    expect(elapsedLabel(86_399_000)).toBe('23시간 59분');
    expect(elapsedLabel(86_400_000)).toBe('1일');
    // 캡처의 「2386분 53초 전」(약 40시간).
    expect(elapsedLabel((2386 * 60 + 53) * 1000)).toBe('1일 15시간');
    expect(elapsedLabel(-5_000)).toBe('0초');
    expect(ec2Now(T, 250)).toBe(T + 250);
    expect(ec2Now(T, undefined)).toBe(T);
  });

  it('경과 기준은 진행 중인 규칙 중 가장 먼저 발생한 시각이다', () => {
    const incident = incidentOfEntries(
      entry({ event_id: 'a', raised_at: T + 5_000 }),
      entry({ event_id: 'b', rule_id: 'R1', severity: 'HIGH', raised_at: T + 2_000 }),
      entry({ event_id: 'c', rule_id: 'R3', lifecycle: 'RESOLVED', raised_at: T - 9_000 }),
    );
    expect(firstActiveRaisedAt(incident)).toBe(T + 2_000);
    expect(
      firstActiveRaisedAt(incidentOfEntries(entry({ lifecycle: 'RESOLVED', resolved_at: T }))),
    ).toBeNull();
  });

  it('위험구역 접근만 N초 뒤 진입 예상 줄을 만들고, 개구부 수치는 만들지 않는다', () => {
    const r5 = item({ rule_id: 'R5', severity: 'CAUTION', metrics: { time_to_entry_s: 1.64 } });
    expect(entryEtaLine(r5)).toBe('1.6초 뒤 진입 예상');
    expect(entryEtaLine({ ...r5, lifecycle: 'RESOLVED' })).toBeNull();
    expect(entryEtaLine({ ...r5, metrics: {} })).toBeNull();
    expect(
      entryEtaLine(item({ metrics: { edge_distance_m: 0.82, height_diff_m: 2.1 } })),
    ).toBeNull();
  });

  it('처리 상태 칩: 조치 단계 > 확인 시각 > 미확인, 해소되면 해소 시각', () => {
    const open = incidentOfEntries(entry({ updated_at: T }));
    expect(cardChip(open)).toEqual({ kind: 'unacked', label: '미확인' });
    expect(cardChip(open, { ticketStage: '조치 중' })).toEqual({
      kind: 'ticket',
      label: '조치 중',
    });

    const acked = incidentOfEntries(entry({ acks: [ack(T + 3_000)], updated_at: T + 3_000 }));
    expect(cardChip(acked)?.kind).toBe('ack');
    expect(cardChip(acked)?.label).toMatch(HH);

    const done = incidentOfEntries(
      entry({ lifecycle: 'RESOLVED', resolved_at: T + 9_000, updated_at: T + 9_000 }),
    );
    expect(cardChip(done)?.kind).toBe('resolved');
    expect(cardChip(done)?.label).toMatch(/^해소 \d{2}:\d{2}:\d{2}$/);
  });

  it('주의·안내만 있는 묶음은 처리 상태 칩이 없다', () => {
    expect(cardChip(incidentOfEntries(entry({ severity: 'CAUTION' })))).toBeNull();
    expect(cardChip(incidentOfEntries(entry({ severity: 'INFO' })))).toBeNull();
  });

  it('카드 제목: 대표 규칙(가장 높은 등급)의 이름 · 구역 이름', () => {
    const incident = incidentOfEntries(
      entry({ event_id: 'a', zone_id: 'z-04' }),
      entry({ event_id: 'b', rule_id: 'R1', severity: 'HIGH', zone_id: 'z-02' }),
    );
    expect(cardTitle(incident, zoneName)).toBe('추락 위험(가장자리) · 개구부 구역');
  });

  it('R1 주의 묶음의 카드 제목은 위험구역 진입이다', () => {
    const incident = incidentOfEntries(entry({ rule_id: 'R1', severity: 'CAUTION' }));
    expect(cardTitle(incident, zoneName)).toBe('위험구역 진입 · 개구부 구역');
  });

  it('구역이 대상인 묶음은 제목에서 구역을 되풀이하지 않고, 구역이 없거나 이름을 모르면 규칙 이름만이다', () => {
    const title = (change: Partial<EventItem>) =>
      cardTitle(incidentOfEntries(entry(change)), zoneName);
    expect(title({ world_ids: [], zone_id: 'z-04' })).toBe('추락 위험(가장자리)');
    expect(title({ zone_id: undefined })).toBe('추락 위험(가장자리)');
    expect(title({ zone_id: 'z-99' })).toBe('추락 위험(가장자리)');
  });

  it('이름이 빈 구역은 제목에서 빼고, 구역이 대상이거나 주어이면 `구역` 이다', () => {
    const incident = (change: Partial<EventItem>) => incidentOfEntries(entry(change));
    expect(cardTitle(incident({ zone_id: 'z-05' }), zoneName)).toBe('추락 위험(가장자리)');
    expect(targetLabel(incident({ world_ids: [], zone_id: 'z-05' }).target, zoneName)).toBe('구역');
    expect(eventSubject(item({ world_ids: [], zone_id: 'z-05' }), zoneName)).toBe('구역');
  });

  it('대상 글꼴: 사람 ID 만 고정폭이다', () => {
    expect(targetFont({ type: 'person', id: 'w-0015' })).toBe('font-mono');
    expect(targetFont({ type: 'zone', id: 'z-04' })).toBeUndefined();
    expect(targetFont(null)).toBeUndefined();
  });

  it('대상 문구: 사람은 ID, 구역은 이름이고 모르는 구역은 `구역`이다(구역 번호는 보이지 않는다)', () => {
    const label = (change: Partial<EventItem>) =>
      targetLabel(incidentOfEntries(entry(change)).target, zoneName);
    expect(label({ world_ids: ['w-0015'] })).toBe('w-0015');
    expect(label({ world_ids: [], zone_id: 'z-04' })).toBe('개구부 구역');
    expect(label({ world_ids: [], zone_id: 'z-99' })).toBe('구역');
    expect(targetLabel(null, zoneName)).toBe('대상 없음');
  });

  it('이벤트 대상 문구: 사람이 있으면 사람 ID, 없으면 구역 이름(모르면 `구역`), 둘 다 없으면 비어 있다', () => {
    const subject = (change: Partial<EventItem>) => eventSubject(item(change), zoneName);
    expect(subject({ world_ids: ['w-1'], zone_id: 'z-04' })).toBe('w-1');
    expect(subject({ world_ids: [], zone_id: 'z-02' })).toBe('단상 구역');
    expect(subject({ world_ids: [], zone_id: 'z-99' })).toBe('구역');
    expect(subject({ world_ids: [], zone_id: undefined })).toBe('');
  });

  it('카메라는 사람이 지금 담긴 카메라 중 첫 번째이고, 사람이 아니거나 없으면 없다', () => {
    const tracks: Parameters<typeof bestCamera>[0] = [
      { world_id: 'w-1', cameras: ['cam_B', 'cam_A'] },
      { world_id: 'w-2', aliases: ['w-9'], cameras: [] },
      { world_id: 'w-3', aliases: ['w-8'], cameras: ['cam_C'] },
    ];
    expect(bestCamera(tracks, { type: 'person', id: 'w-1' })).toBe('cam_B');
    expect(bestCamera(tracks, { type: 'person', id: 'w-8' })).toBe('cam_C');
    expect(bestCamera(tracks, { type: 'person', id: 'w-2' })).toBeUndefined();
    expect(bestCamera(tracks, { type: 'zone', id: 'z-1' })).toBeUndefined();
    expect(bestCamera(undefined, { type: 'person', id: 'w-1' })).toBeUndefined();
  });

  it('확인 필요: UNVERIFIABLE·needs_check·이유 중 하나면 요청하고, 첫 이유를 붙인다(복원 이벤트)', () => {
    expect(needsConfirmation(item())).toBe(false);
    expect(needsConfirmation(item({ needs_check: true }))).toBe(true);
    expect(needsConfirmation(item({ confidence_reasons: ['PREDICTED'] }))).toBe(true);
    const restored = item({ verification: 'UNVERIFIABLE' });
    expect(needsConfirmation(restored)).toBe(true);
    expect(confirmationText(restored)).toBe('확인 필요');
    expect(
      confirmationText(item({ needs_check: true, confidence_reasons: ['Z_UNKNOWN', 'PREDICTED'] })),
    ).toBe('확인 필요 · 높이 모름');
  });
});

// S15P31A101-595: 꺼진 관제에서 열린 채 남은 사건은 「진행 중」이 아니다.
describe('지금 Tier 0 가 들고 있는지(held_by_tier0)', () => {
  it('해소 전이고 들고 있으면 진행 중, 들고 있지 않으면 지난 관제다. 칸이 없으면(이전 EC2) 진행 중으로 본다', () => {
    expect(isCurrent(item({ held_by_tier0: true }))).toBe(true);
    expect(isCurrent(item())).toBe(true);
    expect(isStale(item({ held_by_tier0: false }))).toBe(true);
    expect(isCurrent(item({ held_by_tier0: false }))).toBe(false);
    // 해소된 것은 어느 쪽도 아니다
    const resolved = item({ lifecycle: 'RESOLVED', held_by_tier0: false });
    expect(isCurrent(resolved)).toBe(false);
    expect(isStale(resolved)).toBe(false);
  });

  it('지난 관제의 확인 전 CRITICAL 은 울리지 않는다', () => {
    expect(isAlarming(entry({ held_by_tier0: false }))).toBe(false);
    expect(isAlarming(entry({ held_by_tier0: true }))).toBe(true);
  });

  it('같은 sequence 를 다시 받으면 들고 있음만 받은 값으로 바꾼다(목록 다시 받기)', () => {
    const held = entry({ held_by_tier0: true });
    const released = mergeEvent(held, item({ held_by_tier0: false }));
    expect(released.event.held_by_tier0).toBe(false);
    expect(released.stageStartedAt).toBe(held.stageStartedAt);
    // 다시 들게 되면(같은 Tier 0 가 다시 붙어 스냅샷) 되돌아온다
    expect(mergeEvent(released, item({ held_by_tier0: true })).event.held_by_tier0).toBe(true);
    // 칸이 없는 것은 바꾸지 않는다
    expect(mergeEvent(released, item())).toBe(released);
  });

  it('늦게 온 낮은 sequence 는 들고 있음을 되돌리지 않는다', () => {
    const now = entry({ event_sequence: 3, held_by_tier0: false });
    expect(
      mergeEvent(now, item({ event_sequence: 2, held_by_tier0: true })).event.held_by_tier0,
    ).toBe(false);
  });

  it('지난 관제는 접힌 칸으로 따로 모이고 같은 World ID 의 진행 중 사건과 섞이지 않는다', () => {
    const sections = eventSections([
      entry({ event_id: 'now', world_ids: ['w-1'], held_by_tier0: true }),
      entry({ event_id: 'old-1', world_ids: ['w-1'], rule_id: 'R1', held_by_tier0: false }),
      entry({ event_id: 'old-2', world_ids: ['w-9'], held_by_tier0: false }),
    ]);
    expect(sections.active.map((c) => c.incident.key)).toEqual(['person:w-1']);
    expect(sections.active[0]?.incident.entries.map((e) => e.event.event_id)).toEqual(['now']);
    expect(sections.stale.map((i) => i.key).sort()).toEqual(['person:w-1', 'person:w-9']);
    expect(sections.stale.every((i) => i.stale && !i.alarming)).toBe(true);
    expect(sections.staleEvents).toBe(2);
    expect(cardChip(sections.stale[0]!)).toEqual({ kind: 'stale', label: '지난 관제' });
  });

  it('지난 관제 이벤트의 상세 묶음도 지난 관제 쪽에서 찾는다', () => {
    const entries = [
      entry({ event_id: 'now', world_ids: ['w-1'], held_by_tier0: true }),
      entry({ event_id: 'old', world_ids: ['w-1'], rule_id: 'R1', held_by_tier0: false }),
    ];
    expect(incidentOf(entries, 'old')?.entries.map((e) => e.event.event_id)).toEqual(['old']);
    expect(incidentOf(entries, 'old')?.stale).toBe(true);
    expect(incidentOf(entries, 'now')?.stale).toBe(false);
  });
});
