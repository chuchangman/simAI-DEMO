import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import {
  createExternalSource,
  type SpatialSourceSink,
} from '@/features/viewer3d/data/spatialSource';
import { createMockSource } from '@/features/viewer3d/dev-harness/mockSource';
import { createSpatialMockApi } from '@/features/viewer3d/dev-harness/mswHandlers';
import {
  DEMO_ZONES_RESPONSE,
  scenarioWorld,
  TICK_MS,
} from '@/features/viewer3d/dev-harness/scenarios';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const T0 = 1_760_342_400_000;

function recorder() {
  const messages: unknown[] = [];
  const states: string[] = [];
  const zones: unknown[] = [];
  const sink: SpatialSourceSink = {
    onMessage: (raw) => messages.push(raw),
    onConnectionChange: (c) => states.push(c.state),
    onZones: (result) => zones.push(result),
  };
  return { sink, messages, states, zones };
}

describe('MockSource', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('10 Hz 로 재생하고, 구독이 모두 풀리면 타이머를 멈춘다', () => {
    vi.useFakeTimers();
    const source = createMockSource({ scenario: 'normal', t0: T0, restBase: null });
    const a = recorder();
    const off = source.subscribe(a.sink);
    expect(a.states).toEqual(['CONNECTING', 'OPEN']);
    expect(source.timerCount).toBe(1);

    vi.advanceTimersByTime(TICK_MS * 3);
    // tick 0 은 World + Health, 1·2 는 World.
    expect(a.messages).toHaveLength(4);
    expect(a.messages[0]).toEqual(scenarioWorld('normal', 0, T0));

    off();
    expect(source.subscriberCount).toBe(0);
    expect(source.timerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('StrictMode 처럼 구독·해제·재구독해도 구독 하나, 타이머 하나다', () => {
    vi.useFakeTimers();
    const source = createMockSource({ scenario: 'normal', t0: T0, restBase: null });
    const first = recorder();
    source.subscribe(first.sink)();
    const second = recorder();
    const off = source.subscribe(second.sink);
    expect([source.subscriberCount, source.timerCount, vi.getTimerCount()]).toEqual([1, 1, 1]);
    vi.advanceTimersByTime(TICK_MS);
    expect(first.messages).toHaveLength(0);
    expect(second.messages).toHaveLength(2);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('일시정지·한 단계 진행·재개', () => {
    vi.useFakeTimers();
    const source = createMockSource({ scenario: 'normal', t0: T0, restBase: null });
    const a = recorder();
    source.subscribe(a.sink);
    source.pause();
    vi.advanceTimersByTime(TICK_MS * 5);
    expect([a.messages.length, source.tick, vi.getTimerCount()]).toEqual([0, 0, 0]);
    source.step(2);
    expect([a.messages.length, source.tick]).toEqual([3, 2]);
    source.resume();
    vi.advanceTimersByTime(TICK_MS);
    expect(source.tick).toBe(3);
  });

  it('JSON 본문으로 넘겨도(외부 Live 와 같은 형태) 같은 View Model 이 된다', () => {
    vi.useFakeTimers();
    const plain = createMockSource({ scenario: 'risk-lifecycle', t0: T0, restBase: null });
    const json = createMockSource({
      scenario: 'risk-lifecycle',
      t0: T0,
      restBase: null,
      serialize: true,
    });
    const [a, b] = [recorder(), recorder()];
    plain.subscribe(a.sink);
    json.subscribe(b.sink);
    vi.advanceTimersByTime(TICK_MS * 12);
    expect(b.messages).toHaveLength(a.messages.length);
    a.messages.forEach((raw, i) => {
      expect(b.messages[i]).not.toBe(raw);
      expect(adaptMessage(b.messages[i], 1)).toEqual(adaptMessage(raw, 1));
    });
  });

  it('통신 장애 시나리오는 끊김·재연결 상태를 알린다', () => {
    vi.useFakeTimers();
    const source = createMockSource({ scenario: 'disconnect', t0: T0, restBase: null });
    const a = recorder();
    source.subscribe(a.sink);
    vi.advanceTimersByTime(TICK_MS * 42);
    expect(a.states).toEqual(['CONNECTING', 'OPEN', 'CLOSED', 'CONNECTING', 'OPEN']);
  });
});

describe('외부 Source', () => {
  it('구독하면 지금 연결 상태를 알리고, 받은 본문을 모든 구독자에게 넘긴다', () => {
    const source = createExternalSource('stomp:test', () => 5);
    source.setConnection('OPEN');
    const [a, b] = [recorder(), recorder()];
    const offA = source.subscribe(a.sink);
    source.subscribe(b.sink);
    expect(a.states).toEqual(['OPEN']);
    source.push({ hello: 1 });
    expect([a.messages, b.messages]).toEqual([[{ hello: 1 }], [{ hello: 1 }]]);
    offA();
    source.push({ hello: 2 });
    expect([a.messages.length, b.messages.length, source.subscriberCount]).toEqual([1, 2, 1]);
  });
});

describe('Spatial MSW REST', () => {
  const api = createSpatialMockApi({ scenario: 'normal', t0: T0, slowMs: 60 });
  const server = setupServer(...api.handlers);
  const base = 'http://localhost';

  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => api.setFailure('none'));
  afterAll(() => server.close());

  it('GET /api/world?at= 는 스트림과 같은 시나리오 World 를 준다', async () => {
    const response = await fetch(`${base}/api/world?at=${T0 + 7 * TICK_MS + 30}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(scenarioWorld('normal', 7, T0));
    expect(adaptMessage(body, 0).kind).toBe('world');
  });

  it('잘못된 at 은 400, 시작 전 시각은 404', async () => {
    expect((await fetch(`${base}/api/world`)).status).toBe(400);
    expect((await fetch(`${base}/api/world?at=abc`)).status).toBe(400);
    expect((await fetch(`${base}/api/world?at=${T0 - 1}`)).status).toBe(404);
  });

  it('GET /api/zones 는 DEMO 구역을 준다', async () => {
    const response = await fetch(`${base}/api/zones`);
    expect(await response.json()).toEqual(DEMO_ZONES_RESPONSE);
  });

  it('오류·지연을 흉내 낸다', async () => {
    api.setFailure('error');
    expect((await fetch(`${base}/api/zones`)).status).toBe(503);
    api.setFailure('slow');
    const start = performance.now();
    expect((await fetch(`${base}/api/zones`)).status).toBe(200);
    expect(performance.now() - start).toBeGreaterThanOrEqual(50);
  });

  it('MockSource 는 연결될 때 REST 로 구역과 World 스냅샷을 받는다', async () => {
    const store = createSpatialDataStore();
    store.getState().reset('rest');
    const source = createMockSource({ scenario: 'normal', t0: T0, restBase: base, now: () => T0 });
    source.subscribe({
      onMessage: (raw, at) => store.getState().ingest(raw, at),
      onConnectionChange: (c) => store.getState().setConnection(c),
      onZones: (r, at) => store.getState().ingestZones(r, at),
    });
    source.pause();
    await vi.waitFor(() => {
      expect(store.getState().zones.status).toBe('READY');
      expect(store.getState().world?.tLatestGlobal).toBe(T0);
    });
    expect(store.getState().zones.zones).toHaveLength(3);
  });

  it('구역 요청이 실패하면 REJECTED 와 이유를 남긴다', async () => {
    api.setFailure('error');
    const store = createSpatialDataStore();
    const source = createMockSource({ scenario: 'normal', t0: T0, restBase: base });
    source.subscribe({
      onMessage: () => {},
      onConnectionChange: () => {},
      onZones: (r, at) => store.getState().ingestZones(r, at),
    });
    source.pause();
    await vi.waitFor(() =>
      expect(store.getState().zones).toMatchObject({ status: 'REJECTED', reason: 'HTTP 503' }),
    );
  });
});
