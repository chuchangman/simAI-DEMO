import {
  createSpatialDataStore,
  selectActiveEvents,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import {
  DEMO_MAX_TICKS,
  DEMO_ZONES_RESPONSE,
  GEOFENCE_STEPS,
  mockEventId,
  PERIOD,
  scenarioTick,
  TICK_MS,
  type ScenarioKey,
} from '@/features/viewer3d/dev-harness/scenarios';
import { useRoster } from '@/features/viewer3d/dev-harness/useRoster';
import { zoneContainment } from '@/features/viewer3d/dev-harness/zoneContainment';
import { riskPresentation } from '@/features/viewer3d/risk/riskPresentation';
import type { ViewerMode } from '@/features/viewer3d/types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;
const at = (tick: number) => T0 + tick * TICK_MS + 50;

function fresh(key: ScenarioKey) {
  const store = createSpatialDataStore();
  store.getState().reset(`test:${key}`);
  store.getState().setConnection({ state: 'OPEN', at: T0 });
  store.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
  return store;
}

function playTick(store: SpatialDataStore, key: ScenarioKey, tick: number) {
  for (const out of scenarioTick(key, tick, T0)) {
    if (out.type === 'message') store.getState().ingest(out.raw, at(tick));
  }
}

const containmentAt = (store: SpatialDataStore) => {
  const s = store.getState();
  return zoneContainment(selectActiveEvents(s, 'LIVE'), s.world?.tracks ?? [], s.zones.zones);
};

describe('지오펜싱 정합 시연(R25)', () => {
  it('두 주기 내내 활성 이벤트의 대상은 그 tick 에 구역 상자 안에 있고, 구역 밖 사람은 강조되지 않는다', () => {
    const store = fresh('geofence');
    let checked = 0;
    for (let tick = 0; tick < PERIOD.geofence * 2; tick++) {
      playTick(store, 'geofence', tick);
      for (const c of containmentAt(store)) {
        expect(c.outside, `tick ${tick} ${c.eventId}`).toEqual([]);
        expect(c.unknown).toEqual([]);
        expect(c.inside.length).toBeGreaterThan(0);
        checked += 1;
      }
      const risk = riskPresentation({
        events: store.getState().events.values(),
        tracks: store.getState().world!.tracks,
        worldSceneVersion: store.getState().world!.sceneVersion,
        zoneIds: store.getState().zones.zones.map((z) => z.zoneId),
        mode: 'LIVE',
        connectionOpen: true,
      });
      expect(risk.people.has('w-0002')).toBe(false);
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('발생 직전 tick 에는 구역 밖, 발생 tick 에는 안, 해소 tick 에는 다시 밖이다', () => {
    const zones = new Map(DEMO_ZONES_RESPONSE.zones.map((z) => [z.zone_id, z.aabb]));
    const store = fresh('geofence');
    const positions = new Map<number, Map<string, readonly number[]>>();
    for (let tick = 0; tick < PERIOD.geofence; tick++) {
      playTick(store, 'geofence', tick);
      positions.set(
        tick,
        new Map(store.getState().world!.tracks.map((t) => [t.worldId, t.groundAnchor!])),
      );
    }
    const inZone = (tick: number, worldId: string, zoneId: string) => {
      const p = positions.get(tick)!.get(worldId)!;
      const { min_xyz: min, max_xyz: max } = zones.get(zoneId)!;
      return p.every((v, i) => v >= min[i]! && v <= max[i]!);
    };
    const cases = [
      { worldId: 'w-0001', zoneId: 'z-02', raised: 26, resolved: 85 },
      { worldId: 'w-0003', zoneId: 'z-01', raised: 11, resolved: 75 },
    ];
    for (const c of cases) {
      expect(inZone(c.raised - 1, c.worldId, c.zoneId)).toBe(false);
      expect(inZone(c.raised, c.worldId, c.zoneId)).toBe(true);
      expect(inZone(c.resolved - 1, c.worldId, c.zoneId)).toBe(true);
      expect(inZone(c.resolved, c.worldId, c.zoneId)).toBe(false);
    }
    expect(Object.keys(GEOFENCE_STEPS).map(Number)).toEqual([11, 26, 46, 75, 85]);
  });

  it('체류 2초 상향과 이탈 해소가 3D 강조에 그대로 반영된다', () => {
    const store = fresh('geofence');
    const levels: Record<number, string | null> = {};
    for (let tick = 0; tick <= 90; tick++) {
      playTick(store, 'geofence', tick);
      const s = store.getState();
      levels[tick] =
        riskPresentation({
          events: s.events.values(),
          tracks: s.world!.tracks,
          worldSceneVersion: s.world!.sceneVersion,
          zoneIds: s.zones.zones.map((z) => z.zoneId),
          mode: 'LIVE',
          connectionOpen: true,
        }).zones.get('z-02')?.level ?? null;
    }
    expect([levels[25], levels[26], levels[45], levels[46], levels[84], levels[85]]).toEqual([
      null,
      'HIGH',
      'HIGH',
      'CRITICAL',
      'CRITICAL',
      null,
    ]);
  });
});

describe('risk-lifecycle 은 합성 회귀다(R25 기록)', () => {
  it('tick 31 의 R2(z-02)에는 구역 밖 w-0001 이 들어 있다 — 지오펜싱 시연으로 쓰지 않는다', () => {
    const store = fresh('risk-lifecycle');
    for (let tick = 0; tick <= 31; tick++) playTick(store, 'risk-lifecycle', tick);
    const r2 = containmentAt(store).find((c) => c.eventId === mockEventId(0, 2))!;
    expect(r2).toMatchObject({ zoneId: 'z-02', outside: ['w-0001'], inside: ['w-0002'] });
  });
});

describe('개발 시연 누적(R18·장시간)', () => {
  it('주기마다 계획 이벤트도 해소돼 활성 이벤트가 쌓이지 않는다', () => {
    const store = fresh('risk-lifecycle');
    const activeAtCycleEnd: number[] = [];
    for (let tick = 0; tick < PERIOD['risk-lifecycle'] * 10; tick++) {
      playTick(store, 'risk-lifecycle', tick);
      if (tick % PERIOD['risk-lifecycle'] === PERIOD['risk-lifecycle'] - 1) {
        activeAtCycleEnd.push(
          selectActiveEvents(store.getState(), 'LIVE').length +
            selectActiveEvents(store.getState(), 'PLANNED').length,
        );
      }
    }
    expect(activeAtCycleEnd).toEqual(Array(10).fill(0));
    // 해소된 이벤트는 Store 규칙대로 남는다(주기당 3). 시연은 재생 상한으로 묶는다.
    expect(store.getState().events.size).toBe(30);
    expect((DEMO_MAX_TICKS['risk-lifecycle']! / PERIOD['risk-lifecycle']) * 3).toBe(150);
  });
});

describe('업무 목록(useRoster)', () => {
  it('뷰어 모드의 출처만, 계약 등급 그대로, event_id 로 구분한다', () => {
    const store = fresh('risk-lifecycle');
    for (let tick = 0; tick <= 41; tick++) playTick(store, 'risk-lifecycle', tick);
    const { result, rerender } = renderHook(({ mode }) => useRoster(store, false, mode), {
      initialProps: { mode: 'LIVE' as ViewerMode },
    });
    expect(result.current.events.map((e) => [e.id, e.severity, e.title, e.target.id])).toEqual([
      [mockEventId(0, 1), 'CRITICAL', 'R1 · z-01 · UPDATED #2', 'w-0001'],
      [mockEventId(0, 2), 'CRITICAL', 'R2 · z-02 · RAISED #1', 'w-0001'],
    ]);
    rerender({ mode: 'PLANNED' });
    expect(result.current.events.map((e) => [e.id, e.severity])).toEqual([
      [mockEventId(0, 3), 'HIGH'],
    ]);
    rerender({ mode: 'REPLAY' });
    expect(result.current.events).toEqual([]);
  });

  it('하향·해소·AUDIT_ONLY 를 그대로 따르고, 같은 순번 재전송에는 목록 객체를 다시 만들지 않는다', () => {
    const store = fresh('risk-lifecycle');
    for (let tick = 0; tick <= 21; tick++) playTick(store, 'risk-lifecycle', tick);
    const { result } = renderHook(() => useRoster(store, false, 'LIVE'));
    const before = result.current;
    act(() => {
      // 같은 순번 재전송(msg_id 만 다름)은 Store 가 중복으로 버린다.
      const raw = scenarioTick('risk-lifecycle', 20, T0).find(
        (o) => o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event',
      ) as { raw: { msg_id: string; payload: object } };
      store
        .getState()
        .ingest({ ...raw.raw, msg_id: '5e000003-0000-4000-8000-00000000ffff' }, at(22));
    });
    expect(result.current).toBe(before);
    act(() => {
      const raw = scenarioTick('risk-lifecycle', 20, T0).find(
        (o) => o.type === 'message' && (o.raw as { msg_type: string }).msg_type === 'risk_event',
      ) as { raw: { msg_id: string; payload: Record<string, unknown> } };
      store.getState().ingest(
        {
          ...raw.raw,
          msg_id: '5e000003-0000-4000-8000-00000000fffe',
          payload: {
            ...raw.raw.payload,
            event_sequence: 3,
            severity: 'HIGH',
            updated_at: at(23),
            delivery: 'AUDIT_ONLY',
          },
        },
        at(23),
      );
    });
    // AUDIT_ONLY 는 활성 목록에 다시 나오지 않는다.
    expect(result.current.events).toEqual([]);
  });
});
