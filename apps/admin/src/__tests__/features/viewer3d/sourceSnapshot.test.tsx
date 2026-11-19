import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataProvider } from '@/features/viewer3d/data/SpatialDataProvider';
import {
  createExternalSource,
  type SpatialSourceSink,
  type ZonesResult,
} from '@/features/viewer3d/data/spatialSource';
import { DEMO_ZONES_BE_V1 } from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  DEMO_OPERATIONAL_GEOMETRY,
  DEMO_ZONES_RESPONSE,
  scenarioWorld,
} from '@/features/viewer3d/dev-harness/scenarios';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

// -234 Source 수명. 구역·정적 객체는 마지막 응답을 보관해 늦게 구독한 Viewer 에도 보내고, World·이벤트는 보관하지 않는다.

const T = 1_760_342_400_000;
const ok = (raw: unknown): ZonesResult => ({ ok: true, raw });

function recorder() {
  const log: string[] = [];
  const sink: SpatialSourceSink = {
    onMessage: () => log.push('message'),
    onConnectionChange: (c) => log.push(`connection:${c.state}`),
    onZones: (r, at) => log.push(`zones:${r.ok ? 'ok' : 'fail'}@${at}`),
    onWorkSurfaces: (r, at) => log.push(`surfaces:${r.ok ? 'ok' : 'fail'}@${at}`),
    onSnapshotClear: (channel) => log.push(`clear:${channel}`),
  };
  return { log, sink };
}

afterEach(cleanup);

describe('ExternalSpatialSource 형상 보관', () => {
  it('구독 전에 받은 구역·작업면을 구독할 때 다시 보내고, World 는 보관하지 않는다', () => {
    const source = createExternalSource('s', () => T);
    source.push(scenarioWorld('normal', 0, T), T);
    expect(source.pushZones(ok([]), 10)).toBe('ACCEPTED');
    expect(source.pushWorkSurfaces(ok({}), 11)).toBe('ACCEPTED');
    const a = recorder();
    source.subscribe(a.sink);
    expect(a.log).toEqual(['connection:CONNECTING', 'zones:ok@10', 'surfaces:ok@11']);
    // StrictMode 처럼 다시 구독해도 같은 값을 다시 받는다.
    const b = recorder();
    source.subscribe(b.sink)();
    expect(b.log).toEqual(a.log);
  });

  it('늦게 붙은 쪽도 지금 구독 중인 쪽과 같은 상태다: 실패 뒤에는 이전 정상 형상을 다시 보내지 않는다', () => {
    const source = createExternalSource('s', () => T);
    const live = recorder();
    source.subscribe(live.sink);
    source.pushZones(ok([]), 1);
    source.pushZones({ ok: false, reason: 'HTTP 503' }, 2);
    expect(live.log.slice(1)).toEqual(['zones:ok@1', 'zones:fail@2']);
    const late = recorder();
    source.subscribe(late.sink);
    expect(late.log).toEqual(['connection:CONNECTING', 'zones:fail@2']);
    // 마지막 정상 시각은 진단용으로 남는다.
    expect(source.snapshotInfo('zones')).toEqual({
      ok: false,
      receivedAt: 2,
      requestedAt: null,
      scope: null,
      lastOkReceivedAt: 1,
    });
    // 다시 정상이 오면 그 값이 다시 보낼 값이다.
    source.pushZones(ok([]), 3);
    const again = recorder();
    source.subscribe(again.sink);
    expect(again.log).toEqual(['connection:CONNECTING', 'zones:ok@3']);
    expect(source.snapshotInfo('zones')).toMatchObject({ ok: true, lastOkReceivedAt: 3 });
  });

  it('먼저 요청한 응답이 늦게 오면 버린다(requestedAt)', () => {
    const source = createExternalSource('s', () => T);
    const live = recorder();
    source.subscribe(live.sink);
    expect(source.pushZones(ok(['new']), 20, { requestedAt: 200 })).toBe('ACCEPTED');
    expect(source.pushZones(ok(['old']), 21, { requestedAt: 100 })).toBe('STALE_REQUEST');
    expect(live.log.filter((l) => l.startsWith('zones'))).toEqual(['zones:ok@20']);
    // 늦게 요청한 실패도 같은 규칙이다. 먼저 요청한 실패는 정상 형상을 덮지 못한다.
    expect(source.pushZones({ ok: false, reason: 'HTTP 503' }, 23, { requestedAt: 150 })).toBe(
      'STALE_REQUEST',
    );
    // 요청 시각이 없는 응답은 예전처럼 받는다.
    expect(source.pushZones(ok([]), 22)).toBe('ACCEPTED');
  });

  it('비운 시각보다 앞서 요청한 응답은 비운 뒤에 와도 받지 않는다(로그아웃 직전 요청 등)', () => {
    let clock = 1000;
    const source = createExternalSource('s', () => clock);
    source.pushZones(ok([]), 1000, { requestedAt: 900 });
    clock = 2000;
    source.clearSnapshot('zones');
    expect(source.pushZones(ok(['late']), 2100, { requestedAt: 1500 })).toBe('STALE_REQUEST');
    expect(source.snapshotInfo('zones')).toBeNull();
    expect(source.pushZones(ok(['fresh']), 2200, { requestedAt: 2050 })).toBe('ACCEPTED');
    // 다른 채널은 막지 않는다.
    clock = 3000;
    source.clearSnapshot('workSurfaces');
    expect(source.pushZones(ok([]), 3100, { requestedAt: 2100 })).toBe('ACCEPTED');
  });

  it('범위가 바뀌면 보관한 형상을 버리고 비우기를 알리며, 다른 범위의 늦은 응답을 받지 않는다', () => {
    const source = createExternalSource('s', () => T);
    const live = recorder();
    source.subscribe(live.sink);
    source.setScope('user-a');
    source.pushZones(ok([]), 1, { scope: 'user-a' });
    source.pushWorkSurfaces(ok({}), 2, { scope: 'user-a' });
    source.setScope('user-b');
    expect(live.log.slice(-2)).toEqual(['clear:zones', 'clear:workSurfaces']);
    expect(source.snapshotInfo('zones')).toBeNull();
    expect(source.pushZones(ok([]), 3, { scope: 'user-a' })).toBe('SCOPE_MISMATCH');
    // 범위를 정한 뒤 범위 없는 응답은 어느 사용자의 것인지 몰라 받지 않는다.
    expect(source.pushZones(ok([]), 3, undefined)).toBe('SCOPE_MISMATCH');
    expect(source.pushZones(ok([]), 4, { scope: 'user-b' })).toBe('ACCEPTED');
    expect(source.scope).toBe('user-b');
    // 같은 범위를 다시 정하면 아무것도 버리지 않는다.
    source.setScope('user-b');
    expect(source.snapshotInfo('zones')).not.toBeNull();
    // 범위를 풀면(로그아웃) 형상을 버리고, 범위를 단 응답은 받지 않는다.
    source.setScope(null);
    expect(source.snapshotInfo('zones')).toBeNull();
    expect(source.pushZones(ok([]), 5, { scope: 'user-b' })).toBe('SCOPE_MISMATCH');
  });

  it('clearSnapshot 은 그 채널만 버리고, 비울 것이 없으면 알리지 않는다', () => {
    const source = createExternalSource('s', () => T);
    const live = recorder();
    source.subscribe(live.sink);
    source.pushZones(ok([]), 1);
    source.clearSnapshot('workSurfaces');
    source.clearSnapshot('zones');
    source.clearSnapshot();
    expect(live.log.filter((l) => l.startsWith('clear'))).toEqual(['clear:zones']);
    const late = recorder();
    source.subscribe(late.sink);
    expect(late.log).toEqual(['connection:CONNECTING']);
  });
});

describe('SpatialDataProvider 와 형상 보관', () => {
  it('Viewer 가 늦게 붙어도(StrictMode 포함) 보관한 정식 구역·묶음을 받고, 비우면 그 채널만 비운다', () => {
    const source = createExternalSource('s', () => T);
    source.pushZones(ok(DEMO_ZONES_BE_V1), 5);
    source.pushWorkSurfaces(ok(structuredClone(DEMO_OPERATIONAL_GEOMETRY)), 6);
    const store = createSpatialDataStore();
    render(
      <StrictMode>
        <SpatialDataProvider store={store} source={source}>
          {null}
        </SpatialDataProvider>
      </StrictMode>,
    );
    expect(source.subscriberCount).toBe(1);
    expect(store.getState().zones).toMatchObject({
      status: 'READY',
      contract: 'BE_ZONES_V1',
      receivedAt: 5,
    });
    expect(store.getState().workSurfaces.status).toBe('READY');
    act(() => source.clearSnapshot('zones'));
    expect(store.getState().zones.status).toBe('NONE');
    expect(store.getState().workSurfaces.status).toBe('READY');
  });

  it('다른 Source 로 바꾸면 이전 Source 의 형상이 남지 않는다(사용자 간 누출 없음)', () => {
    const a = createExternalSource('a', () => T);
    a.pushZones(ok(structuredClone(DEMO_ZONES_RESPONSE)), 1);
    const b = createExternalSource('b', () => T);
    const store = createSpatialDataStore();
    const { rerender } = render(
      <SpatialDataProvider store={store} source={a}>
        {null}
      </SpatialDataProvider>,
    );
    expect(store.getState().zones.status).toBe('READY');
    rerender(
      <SpatialDataProvider store={store} source={b}>
        {null}
      </SpatialDataProvider>,
    );
    expect(store.getState()).toMatchObject({ sourceId: 'b', zones: { status: 'NONE' } });
    expect(a.subscriberCount).toBe(0);
    // 이전 Source 에 늦게 들어온 응답은 새 Viewer 에 닿지 않는다.
    act(() => {
      a.pushZones(ok(structuredClone(DEMO_ZONES_RESPONSE)), 2);
    });
    expect(store.getState().zones.status).toBe('NONE');
  });
});
