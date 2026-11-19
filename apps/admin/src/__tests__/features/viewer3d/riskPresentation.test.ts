import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import {
  createSpatialDataStore,
  type SpatialDataState,
} from '@/features/viewer3d/data/spatialData.store';
import type { RiskEventView } from '@/features/viewer3d/data/spatialFrame';
import {
  DEMO_ZONES_RESPONSE,
  mockEventId,
  mockMsgId,
  scenarioTick,
  TICK_MS,
} from '@/features/viewer3d/dev-harness/scenarios';
import {
  membershipKey,
  parseMembership,
  riskPresentation,
  riskStyle,
  type RiskInput,
} from '@/features/viewer3d/risk/riskPresentation';
import type { ViewerMode } from '@/features/viewer3d/types';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;
const at = (tick: number) => T0 + tick * TICK_MS + 50;
const E = (n: number, cycle = 0) => mockEventId(cycle, n);

/** risk-lifecycle 을 tick 0 부터 ticks 개 재생한 Store. 구역은 DEMO 응답. */
function play(ticks: number, store = createSpatialDataStore()) {
  if (store.getState().sourceId === null) {
    store.getState().reset('test:risk');
    store.getState().setConnection({ state: 'OPEN', at: T0 });
    store.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
  }
  for (let tick = 0; tick < ticks; tick++) {
    for (const out of scenarioTick('risk-lifecycle', tick, T0)) {
      if (out.type === 'message') store.getState().ingest(out.raw, at(tick));
    }
  }
  return store;
}

function present(state: SpatialDataState, mode: ViewerMode = 'LIVE') {
  return riskPresentation({
    events: state.events.values(),
    tracks: state.world?.tracks ?? [],
    worldSceneVersion: state.world?.sceneVersion ?? null,
    zoneIds: state.zones.zones.map((z) => z.zoneId),
    mode,
    connectionOpen: state.connection?.state === 'OPEN',
  });
}

/** 비교하기 쉽게 [id, 등급, 이벤트 ID] 로 줄인다. */
const flat = (map: ReadonlyMap<string, { level: string; eventIds: readonly string[] }>) =>
  [...map].map(([id, r]) => [id, r.level, r.eventIds]).sort();

describe('risk-lifecycle 전이 → 3D 강조', () => {
  it('발생 전에는 강조가 없다', () => {
    const risk = present(play(10).getState());
    expect([risk.people.size, risk.zones.size, risk.unlinked, risk.skipped]).toEqual([
      0,
      0,
      [],
      [],
    ]);
  });

  it('tick 10 E1 HIGH: w-0001 과 z-01', () => {
    const risk = present(play(11).getState());
    expect(flat(risk.people)).toEqual([['w-0001', 'HIGH', [E(1)]]]);
    expect(flat(risk.zones)).toEqual([['z-01', 'HIGH', [E(1)]]]);
  });

  it('tick 20 E1 CRITICAL 상향', () => {
    const risk = present(play(21).getState());
    expect(flat(risk.people)).toEqual([['w-0001', 'CRITICAL', [E(1)]]]);
    expect(flat(risk.zones)).toEqual([['z-01', 'CRITICAL', [E(1)]]]);
  });

  it('tick 30 E2 중첩: 같은 사람은 강조 하나에 두 이벤트, 확인 필요를 함께 묶는다', () => {
    const risk = present(play(31).getState());
    expect(flat(risk.people)).toEqual([
      ['w-0001', 'CRITICAL', [E(1), E(2)].sort()],
      ['w-0002', 'CRITICAL', [E(2)]],
    ]);
    expect(flat(risk.zones)).toEqual([
      ['z-01', 'CRITICAL', [E(1)]],
      ['z-02', 'CRITICAL', [E(2)]],
    ]);
    expect(risk.people.get('w-0001')!.needsCheck).toBe(true);
    expect(risk.zones.get('z-01')!.needsCheck).toBe(false);
  });

  it('tick 35 같은 순번 재전송은 바뀌는 것이 없다', () => {
    expect(flat(present(play(36).getState()).people)).toEqual(
      flat(present(play(31).getState()).people),
    );
  });

  it('tick 40 PLANNED 이벤트는 LIVE 모드에 없고, PLANNED 모드에서는 계획 이벤트만 보인다', () => {
    const state = play(41).getState();
    expect(flat(present(state).people).map(([id]) => id)).toEqual(['w-0001', 'w-0002']);
    const planned = present(state, 'PLANNED');
    expect(planned.source).toBe('PLANNED');
    expect(flat(planned.people)).toEqual([['w-0003', 'HIGH', [E(3)]]]);
    expect(flat(planned.zones)).toEqual([['z-01', 'HIGH', [E(3)]]]);
    expect(planned.people.get('w-0003')!.source).toBe('PLANNED');
    expect(present(state, 'REPLAY').people.size).toBe(0);
  });

  it('tick 50 E1 만 해소: w-0001 은 E2 로 남고 z-01 강조는 사라진다', () => {
    const risk = present(play(51).getState());
    expect(flat(risk.people)).toEqual([
      ['w-0001', 'CRITICAL', [E(2)]],
      ['w-0002', 'CRITICAL', [E(2)]],
    ]);
    expect(flat(risk.zones)).toEqual([['z-02', 'CRITICAL', [E(2)]]]);
  });

  it('tick 56 해소 뒤 늦게 온 전이는 E1 을 다시 켜지 않는다', () => {
    const store = play(57);
    expect(store.getState().counts.outOfOrder).toBe(1);
    expect(flat(present(store.getState()).zones)).toEqual([['z-02', 'CRITICAL', [E(2)]]]);
  });

  it('tick 65 E2 해소: LIVE 강조가 모두 사라진다(PLANNED 는 따로 남는다)', () => {
    const state = play(66).getState();
    expect([present(state).people.size, present(state).zones.size]).toEqual([0, 0]);
    expect(present(state, 'PLANNED').people.size).toBe(1);
  });

  it('다음 주기에는 새 이벤트로 다시 시작한다', () => {
    const risk = present(play(91).getState());
    expect(flat(risk.people)).toEqual([['w-0001', 'HIGH', [E(1, 1)]]]);
  });

  it('Source 를 바꾸면(reset) 강조가 남지 않는다', () => {
    const store = play(31);
    store.getState().reset('other');
    expect(present(store.getState()).people.size).toBe(0);
  });
});

// ---- 경계 사례: 계약 메시지를 고쳐 Store 를 거치지 않고 View Model 로 시험한다 ----

const base: RiskEventView = (() => {
  const raw = scenarioTick('risk-lifecycle', 10, T0).find(
    (o) => o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event',
  )!;
  const result = adaptMessage((raw as { raw: unknown }).raw, 1);
  if (result.kind !== 'event') throw new Error('기준 이벤트를 읽지 못했다');
  return result.event;
})();

let seq = 0;
const ev = (patch: Partial<RiskEventView>): RiskEventView => ({
  ...base,
  eventId: `e-${String(++seq).padStart(3, '0')}`,
  ...patch,
});

const TRACKS = [
  { worldId: 'w-0001', aliases: [] },
  { worldId: 'w-0002', aliases: [] },
  { worldId: 'w-0003', aliases: ['w-0009'] },
];

function run(events: RiskEventView[], patch: Partial<RiskInput> = {}) {
  return riskPresentation({
    events,
    tracks: TRACKS,
    worldSceneVersion: base.sceneVersion,
    zoneIds: ['z-01', 'z-02', 'z-03'],
    mode: 'LIVE',
    connectionOpen: true,
    ...patch,
  });
}

describe('출처·등급 필터', () => {
  it('INFO 는 강조하지 않고 이유를 남긴다', () => {
    const i = ev({ severity: 'INFO' });
    const risk = run([i]);
    expect(risk.people.size + risk.zones.size).toBe(0);
    expect(risk.skipped).toEqual([{ eventId: i.eventId, reason: 'LOW_SEVERITY' }]);
  });

  it('CAUTION 은 사람 발밑 강조만 하고 구역은 강조하지 않는다', () => {
    const c = ev({ severity: 'CAUTION' });
    const risk = run([c]);
    expect(flat(risk.people)).toEqual([['w-0001', 'CAUTION', [c.eventId]]]);
    expect(risk.zones.size).toBe(0);
    expect(risk.skipped).toEqual([]);
  });

  it('CAUTION 의 구역이 장면에 없거나 Scene 이 달라도 구역을 unlinked 로 남기지 않는다', () => {
    const missing = run([ev({ severity: 'CAUTION', zoneId: 'z-99' })]);
    expect(missing.unlinked).toEqual([]);
    const mismatch = run([ev({ severity: 'CAUTION', sceneVersion: 'other-scene' })]);
    expect(mismatch.unlinked.map((u) => u.target)).toEqual(['w-0001']);
  });

  it('가리킬 사람이 없는 CAUTION 은 강조하지 않고 이유를 남긴다', () => {
    const c = ev({ severity: 'CAUTION', worldIds: [], zoneId: 'z-01' });
    const risk = run([c]);
    expect(risk.people.size + risk.zones.size).toBe(0);
    expect(risk.skipped).toEqual([{ eventId: c.eventId, reason: 'LOW_SEVERITY' }]);
  });

  it('같은 사람에게 경고와 주의가 함께 걸리면 경고로 묶고, 구역은 경고만 강조한다', () => {
    const [high, caution] = [ev({ severity: 'HIGH' }), ev({ severity: 'CAUTION', zoneId: 'z-02' })];
    const risk = run([high, caution]);
    expect(flat(risk.people)).toEqual([['w-0001', 'HIGH', [high.eventId, caution.eventId].sort()]]);
    expect(flat(risk.zones)).toEqual([['z-01', 'HIGH', [high.eventId]]]);
  });

  it('proposed_severity(VLM 의견)로 등급을 올리지 않는다', () => {
    const risk = run([ev({ severity: 'HIGH', proposedSeverity: 'CRITICAL' })]);
    expect(risk.people.get('w-0001')!.level).toBe('HIGH');
  });

  it('WHAT_IF 는 어느 모드에도 섞이지 않고, REPLAY 모드는 REPLAY 만 보인다', () => {
    const events = [
      ev({ source: 'WHAT_IF' }),
      ev({ source: 'LIVE', worldIds: ['w-0002'] }),
      ev({ source: 'REPLAY', worldIds: ['w-0003'], delivery: null }),
    ];
    for (const mode of ['LIVE', 'PLANNED', 'REPLAY'] as const) {
      const ids = [...run(events, { mode }).people.keys()];
      expect(ids).toEqual({ LIVE: ['w-0002'], PLANNED: [], REPLAY: ['w-0003'] }[mode]);
    }
  });

  it('감사 기록으로만 복원된 LIVE 이벤트(AUDIT_ONLY)는 강조하지 않는다', () => {
    const a = ev({ delivery: 'AUDIT_ONLY' });
    expect(run([a]).skipped).toEqual([{ eventId: a.eventId, reason: 'AUDIT_ONLY' }]);
    expect(run([ev({ delivery: 'DELAYED_ACTIVE' })]).people.size).toBe(1);
  });
});

describe('대상 연결', () => {
  it('world_ids 가 여럿이면 모두, 병합 별칭으로도 잇고 원본 ID 는 바꾸지 않는다', () => {
    const e = ev({ worldIds: ['w-0002', 'w-0009'], zoneId: null });
    const risk = run([e]);
    expect([...risk.people.keys()]).toEqual(['w-0002', 'w-0003']);
    expect(risk.zones.size).toBe(0);
    expect(e.worldIds).toEqual(['w-0002', 'w-0009']);
  });

  it('분할로 생긴 새 ID 에는 옮기지 않고, 없는 대상은 만들지 않고 미연결로 남긴다', () => {
    const tracks = [{ worldId: 'w-0010', aliases: [] }];
    // z- 뒤에 숫자만 오는 ID 는 Tailwind 가 z-index 유틸리티로 읽어 운영 CSS 에 섞이므로 쓰지 않는다.
    const e = ev({ worldIds: ['w-0003'], zoneId: 'z-missing' });
    const risk = run([e], { tracks });
    expect([risk.people.size, risk.zones.size]).toEqual([0, 0]);
    expect(risk.unlinked).toEqual([
      { eventId: e.eventId, target: 'w-0003', reason: 'WORLD_ID_NOT_IN_SCENE' },
      { eventId: e.eventId, target: 'z-missing', reason: 'ZONE_NOT_IN_SCENE' },
    ]);
  });

  it('사람이 World 에서 빠지면 강조도 빠지고, 다시 나타나면 다시 잇는다', () => {
    const e = ev({ worldIds: ['w-0002'] });
    expect(run([e], { tracks: [TRACKS[0]!] }).people.size).toBe(0);
    expect([...run([e]).people.keys()]).toEqual(['w-0002']);
  });

  it('scene_version 이 다르면 3D 대상에 잇지 않고, 모르면 Scene 미상으로 표시한다', () => {
    const e = ev({ sceneVersion: 'scene-other' });
    const risk = run([e]);
    expect(risk.people.size + risk.zones.size).toBe(0);
    expect(risk.unlinked.map((u) => [u.target, u.reason])).toEqual([
      ['w-0001', 'SCENE_MISMATCH'],
      ['z-01', 'SCENE_MISMATCH'],
    ]);
    expect(run([ev({ sceneVersion: null })]).people.get('w-0001')!.sceneUnknown).toBe(true);
    expect(run([ev({})], { worldSceneVersion: null }).zones.get('z-01')!.sceneUnknown).toBe(true);
    expect(run([ev({})]).people.get('w-0001')!.sceneUnknown).toBe(false);
  });
});

describe('다중·해소 규칙', () => {
  it('같은 대상은 강조 하나, 가장 높은 등급, 이벤트 ID 는 중복 없이', () => {
    const [h, c] = [ev({ severity: 'HIGH' }), ev({ severity: 'CRITICAL', zoneId: 'z-02' })];
    const risk = run([h, c, h]);
    expect(risk.people.get('w-0001')).toMatchObject({
      level: 'CRITICAL',
      eventIds: [h.eventId, c.eventId].sort(),
    });
    expect(flat(risk.zones)).toEqual([
      ['z-01', 'HIGH', [h.eventId]],
      ['z-02', 'CRITICAL', [c.eventId]],
    ]);
  });

  it('CRITICAL 이 해소되면 남은 HIGH 로 내려가고, 실제 하향 전이는 그대로 따른다', () => {
    const c = ev({ severity: 'CRITICAL' });
    const h = ev({ severity: 'HIGH' });
    expect(run([{ ...c, lifecycle: 'RESOLVED' }, h]).people.get('w-0001')!.level).toBe('HIGH');
    expect(
      run([{ ...c, severity: 'HIGH', lifecycle: 'UPDATED' }]).people.get('w-0001')!.level,
    ).toBe('HIGH');
  });

  it('ACK 는 해소가 아니라 강조를 지우지 않고, 운영자 종료는 RESOLVED 일 때만 반영된다', () => {
    expect(run([ev({ ackCount: 2 })]).people.size).toBe(1);
    expect(run([ev({ escalationCount: 3, severity: 'HIGH' })]).people.get('w-0001')!.level).toBe(
      'HIGH',
    );
    expect(run([ev({ lifecycle: 'RESOLVED', operatorClosed: true })]).people.size).toBe(0);
  });

  it('연결이 끊겨도 해소로 보지 않고 마지막 수신으로 표시한다', () => {
    const risk = run([ev({})], { connectionOpen: false });
    expect(risk.people.get('w-0001')).toMatchObject({ lastReceived: true, level: 'HIGH' });
  });

  it('입력을 바꾸지 않는다', () => {
    const events = [Object.freeze(ev({ worldIds: Object.freeze(['w-0001']) as string[] }))];
    expect(() => run(events)).not.toThrow();
  });
});

describe('Store 를 거친 재개·하향', () => {
  const riskRaw = (tick: number) =>
    scenarioTick('risk-lifecycle', tick, T0).flatMap((o) =>
      o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event'
        ? [o.raw as { msg_id: string; payload: Record<string, unknown> }]
        : [],
    )[0]!;

  it('해소 뒤 더 높은 순번의 재개 전이는 다시 강조한다', () => {
    const store = play(51);
    const resolved = riskRaw(50);
    const resumed = {
      ...resolved,
      msg_id: mockMsgId('risk-lifecycle', 900, 1),
      payload: {
        ...resolved.payload,
        event_sequence: 4,
        lifecycle: 'UPDATED',
        resume_count: 1,
        resolved_at: null,
        updated_at: at(52),
      },
    };
    expect(store.getState().ingest(resumed, at(52))).toBe('event');
    expect(flat(present(store.getState()).zones)).toEqual([
      ['z-01', 'CRITICAL', [E(1)]],
      ['z-02', 'CRITICAL', [E(2)]],
    ]);
  });

  it('실제 하향 전이(UPDATED, 더 높은 순번)는 등급을 내린다', () => {
    const store = play(21);
    const up = riskRaw(20);
    const down = {
      ...up,
      msg_id: mockMsgId('risk-lifecycle', 901, 1),
      payload: { ...up.payload, event_sequence: 3, severity: 'HIGH', updated_at: at(22) },
    };
    expect(store.getState().ingest(down, at(22))).toBe('event');
    expect(flat(present(store.getState()).people)).toEqual([['w-0001', 'HIGH', [E(1)]]]);
  });
});

describe('표시 모양', () => {
  const h = (patch: object = {}) => ({
    level: 'HIGH' as const,
    eventIds: ['a'],
    source: 'LIVE' as const,
    needsCheck: false,
    lastReceived: false,
    sceneUnknown: false,
    ...patch,
  });

  it('CRITICAL 은 이중선, 실시간 관측이 아니면 점선, 색은 등급별로 다르다', () => {
    expect(riskStyle(h({ level: 'CRITICAL' }))).toMatchObject({ double: true, dashed: false });
    expect(riskStyle(h({ source: 'PLANNED' })).dashed).toBe(true);
    expect(riskStyle(h({ lastReceived: true })).dashed).toBe(true);
    expect(riskStyle(h()).color).not.toBe(riskStyle(h({ level: 'CRITICAL' })).color);
  });

  it('사람 목록 키는 좌표와 무관하고 별칭까지 되읽힌다', () => {
    expect(parseMembership(membershipKey(TRACKS))).toEqual(TRACKS);
    expect(parseMembership('')).toEqual([]);
  });
});

describe('계약 Adapter', () => {
  it('delivery 를 옮기고, 싣지 않으면 null 이다', () => {
    expect(base.delivery).toBe('REALTIME');
    const raw = scenarioTick('risk-lifecycle', 40, T0).find(
      (o) => o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event',
    ) as { raw: unknown };
    const planned = adaptMessage(raw.raw, 1);
    expect(planned.kind === 'event' && planned.event.delivery).toBe(null);
  });
});
