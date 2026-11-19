import {
  createSpatialDataStore,
  isStale,
  selectActiveEvents,
  selectEvents,
  selectStatus,
} from '@/features/viewer3d/data/spatialData.store';
import { trackPlacement } from '@/features/viewer3d/data/spatialFrame';
import {
  mockEventId,
  mockMsgId,
  scenarioTick,
  scenarioWorld,
  TICK_MS,
  type ScenarioKey,
} from '@/features/viewer3d/dev-harness/scenarios';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;
const at = (tick: number) => T0 + tick * TICK_MS + 50;

function play(key: ScenarioKey, ticks: number, store = createSpatialDataStore()) {
  if (store.getState().sourceId === null) {
    store.getState().reset(`test:${key}`);
    store.getState().setConnection({ state: 'OPEN', at: T0 });
  }
  for (let tick = 0; tick < ticks; tick++) {
    for (const out of scenarioTick(key, tick, T0)) {
      if (out.type === 'connection')
        store.getState().setConnection({ state: out.state, at: at(tick), reason: out.reason });
      else store.getState().ingest(out.raw, at(tick));
    }
  }
  return store;
}

const withTime = (raw: ReturnType<typeof scenarioWorld>, t: number, msgId: string) => ({
  ...raw,
  msg_id: msgId,
  payload: { ...raw.payload, t_latest_global: t },
});

describe('World 순서', () => {
  it('최신 World 만 반영하고 같은 msg_id·이전 시각은 반영하지 않는다', () => {
    const store = createSpatialDataStore();
    const s = () => store.getState();
    expect(s().ingest(scenarioWorld('normal', 5, T0), 1)).toBe('world');
    expect(s().ingest(scenarioWorld('normal', 5, T0), 2)).toBe('duplicate');
    expect(s().ingest(scenarioWorld('normal', 3, T0), 3)).toBe('out_of_order');
    // 같은 시각, 다른 msg_id 도 새 상태가 아니다.
    expect(
      s().ingest(withTime(scenarioWorld('normal', 5, T0), T0 + 500, mockMsgId('normal', 99, 0)), 4),
    ).toBe('out_of_order');
    expect(s().ingest(scenarioWorld('normal', 6, T0), 5)).toBe('world');
    expect(s().world?.tLatestGlobal).toBe(T0 + 6 * TICK_MS);
    expect(s().counts).toMatchObject({ world: 2, duplicate: 1, outOfOrder: 2 });
  });

  it('거부한 메시지는 이유를 남기고 상태를 바꾸지 않는다', () => {
    const store = createSpatialDataStore();
    store.getState().ingest(scenarioWorld('normal', 1, T0), 1);
    const before = store.getState().world;
    expect(store.getState().ingest({ msg_type: 'world_state', payload: {} }, 9)).toBe('rejected');
    expect(store.getState().world).toBe(before);
    expect(store.getState().lastRejected).toMatchObject({
      reason: 'SCHEMA',
      msgType: 'world_state',
      at: 9,
    });
  });
});

describe('관측 손실 시나리오', () => {
  it('OBSERVED → PREDICTED → UNKNOWN 을 그대로 보이고 위치·시각을 새 관측처럼 바꾸지 않는다', () => {
    const states: string[] = [];
    const store = createSpatialDataStore();
    store.getState().reset('loss');
    for (let tick = 0; tick < 60; tick++) {
      play('observation-loss', 0, store);
      for (const out of scenarioTick('observation-loss', tick, T0)) {
        if (out.type === 'message') store.getState().ingest(out.raw, at(tick));
      }
      const track = store.getState().world!.tracks.find((t) => t.worldId === 'w-0002')!;
      if (states.at(-1) !== track.observationState) states.push(track.observationState);
      if (tick >= 20) {
        // 마지막 관측 시각·위치를 유지한다. 시간이 흐른 만큼 불확실성만 커진다.
        expect(track.tLastValid).toBe(T0 + 19 * TICK_MS);
        expect(track.pelvis).toBeNull();
        expect(track.positionXySigma[0]).toBeGreaterThan(0.08);
      }
      if (tick >= 20 && tick < 30) {
        expect(trackPlacement(track)).toMatchObject({
          basis: 'GROUND_ANCHOR_UNCERTAIN',
          groundConfirmed: false,
        });
        expect(track.surfaceSource).toBe('inferred');
      }
      if (tick >= 30) {
        expect(track.groundAnchor).toBeNull();
        expect(track.zValidity).toBe('UNAVAILABLE');
        expect(trackPlacement(track).basis).toBe('XY_ONLY');
      }
    }
    expect(states).toEqual(['OBSERVED', 'PREDICTED', 'UNKNOWN']);
  });
});

describe('위험 이벤트', () => {
  it('발생·갱신·중첩·해소를 순번대로 반영하고 늦은 전이·재전송은 반영하지 않는다', () => {
    const store = createSpatialDataStore();
    const live = () => selectEvents(store.getState(), 'LIVE');
    play('risk-lifecycle', 31, store);
    // E1 UPDATED·E2 RAISED 가 같은 사람(w-0001)에 겹친다.
    expect(live().map((e) => [e.eventId, e.lifecycle, e.eventSequence])).toEqual([
      [mockEventId(0, 1), 'UPDATED', 2],
      [mockEventId(0, 2), 'RAISED', 1],
    ]);
    expect(live().filter((e) => e.worldIds.includes('w-0001'))).toHaveLength(2);

    play('risk-lifecycle', 0, store);
    const store2 = play('risk-lifecycle', 80);
    const events = selectEvents(store2.getState(), 'LIVE');
    expect(events.map((e) => [e.lifecycle, e.eventSequence])).toEqual([
      ['RESOLVED', 3],
      ['RESOLVED', 2],
    ]);
    // 해소된 이벤트도 지우지 않는다. 활성 목록에서만 빠진다.
    expect(selectActiveEvents(store2.getState(), 'LIVE')).toEqual([]);
    // p35 같은 순번 재전송은 중복, p56 해소 뒤 늦게 온 순번 2 는 역전이다.
    expect(store2.getState().counts.duplicate).toBe(1);
    expect(store2.getState().counts.outOfOrder).toBe(1);
  });

  it('PLANNED 이벤트는 LIVE 목록과 섞이지 않는다', () => {
    const store = play('risk-lifecycle', 45);
    expect(selectEvents(store.getState(), 'PLANNED').map((e) => e.worldIds)).toEqual([['w-0003']]);
    expect(selectEvents(store.getState(), 'LIVE').every((e) => e.source === 'LIVE')).toBe(true);
  });

  it('같은 event_id 라도 출처가 다르면 따로 둔다', () => {
    const store = play('risk-lifecycle', 11);
    const [raw] = scenarioTick('risk-lifecycle', 10, T0).flatMap((o) =>
      o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event'
        ? [o.raw as { payload: object; msg_id: string }]
        : [],
    );
    const replay = {
      ...raw!,
      msg_id: mockMsgId('risk-lifecycle', 500, 7),
      payload: { ...raw!.payload, source: 'REPLAY', event_sequence: 1 },
    };
    // REPLAY 에는 delivery·gateway_id 를 싣지 않는다.
    delete (replay.payload as Record<string, unknown>).delivery;
    expect(store.getState().ingest(replay, 1)).toBe('event');
    expect(selectEvents(store.getState(), 'LIVE')).toHaveLength(1);
    expect(selectEvents(store.getState(), 'REPLAY')).toHaveLength(1);
  });
});

describe('통신 장애', () => {
  it('끊긴 동안 마지막 World 를 지우지 않고, 재연결 뒤 늦은·중복 메시지를 거른다', () => {
    const store = play('disconnect', 30);
    const s = () => store.getState();
    expect(s().connection?.state).toBe('CLOSED');
    expect(s().world?.tLatestGlobal).toBe(T0 + 19 * TICK_MS);
    const status = selectStatus(s(), at(29));
    expect(status.receiveAgeMs).toBe(1000);
    expect(isStale(status, 5000)).toBe(true);

    play('disconnect', 0, store);
    const full = play('disconnect', 45);
    expect(full.getState().connection?.state).toBe('OPEN');
    expect(full.getState().reconnects).toBe(1);
    expect(full.getState().counts.outOfOrder).toBeGreaterThanOrEqual(1);
    expect(full.getState().counts.duplicate).toBeGreaterThanOrEqual(1);
    expect(full.getState().world?.tLatestGlobal).toBe(T0 + 44 * TICK_MS);
  });

  it('Scene 불일치는 Health 보고와 World 비교를 따로 보인다', () => {
    const store = play('disconnect', 45);
    const status = selectStatus(store.getState(), at(44));
    expect(status).toMatchObject({
      systemHealth: 'DEGRADED',
      healthDataAgeMs: 2200,
      sceneMismatchReported: true,
      sceneMismatchObserved: true,
    });
    const recovered = selectStatus(play('disconnect', 52).getState(), at(51));
    expect(recovered).toMatchObject({
      systemHealth: 'NOMINAL',
      sceneMismatchReported: false,
      sceneMismatchObserved: false,
    });
  });

  it('오래됨 기준은 쓰는 쪽이 정한다. 연결이 OPEN 이 아니거나 World 가 없으면 오래된 것이다', () => {
    const store = play('normal', 3);
    const status = selectStatus(store.getState(), at(2) + 300);
    expect(status.receiveAgeMs).toBe(300);
    expect(isStale(status, 500)).toBe(false);
    expect(isStale(status, 200)).toBe(true);
    expect(isStale(selectStatus(createSpatialDataStore().getState(), 0), 1e9)).toBe(true);
  });
});

describe('잘못된 입력 시나리오', () => {
  it('계약 오류는 거부만 하고 정상 World 는 계속 받는다. 미상 Z 는 그대로 미상이다', () => {
    const store = play('invalid-input', 20);
    expect(store.getState().counts.rejected).toBe(10);
    expect(store.getState().counts.world).toBe(20);
    const unknownZ = store.getState().world!.tracks.find((t) => t.worldId === 'w-0003')!;
    expect(unknownZ).toMatchObject({
      pelvis: null,
      groundAnchor: null,
      zValidity: 'UNAVAILABLE',
      headZ: null,
    });
    expect(trackPlacement(unknownZ).basis).toBe('XY_ONLY');
  });
});

describe('reset', () => {
  it('다른 Source 로 바꾸면 데이터와 중복 기억을 모두 비운다', () => {
    const store = play('risk-lifecycle', 25);
    store.getState().reset('other');
    expect(store.getState()).toMatchObject({
      sourceId: 'other',
      world: null,
      health: null,
      connection: null,
      reconnects: 0,
      lastRejected: null,
    });
    expect(store.getState().events.size).toBe(0);
    // 같은 메시지를 다시 받을 수 있다.
    expect(store.getState().ingest(scenarioWorld('risk-lifecycle', 1, T0), 1)).toBe('world');
  });
});

describe('ID 불확실 지속 시각(-661)', () => {
  const uncertainWorld = (tick: number) => {
    const raw = scenarioWorld('normal', tick, T0);
    const [first] = raw.payload.tracks as { identity_confidence: string }[];
    first!.identity_confidence = 'IDENTITY_UNCERTAIN';
    return raw;
  };

  it('같은 차수로 이어진 IDENTITY_UNCERTAIN 의 시작 World 시각을 World 에 붙이고, 풀리면 뺀다', () => {
    const store = createSpatialDataStore();
    const s = () => store.getState();
    s().ingest(uncertainWorld(1), 1);
    const id = s().world!.tracks[0]!.worldId;
    expect(s().world?.identityUncertainSince?.get(id)).toBe(T0 + TICK_MS);
    s().ingest(uncertainWorld(3), 2);
    expect(s().world?.identityUncertainSince?.get(id)).toBe(T0 + TICK_MS);
    s().ingest(scenarioWorld('normal', 4, T0), 3);
    expect(s().world?.identityUncertainSince).toBeUndefined();
  });
});
