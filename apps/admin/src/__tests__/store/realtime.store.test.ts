import { viewerHealthAt, worldStateAt } from '@/mocks/realtimeScenario';
import {
  HEALTH_TIMEOUT_MS,
  isLinkAlive,
  isWorldFresh,
  selectCameraLagMs,
  selectTier0LagMs,
  selectTrackedCount,
  useRealtimeStore,
  WORLD_STALE_MS,
} from '@/store/realtime.store';
import type { WorldStatePayload } from '@simai/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;
const health = (receivedAt: number) => ({
  payload: viewerHealthAt(receivedAt).payload,
  receivedAt,
  clockOffsetMs: 0,
});

describe('realtime.store', () => {
  beforeEach(() => useRealtimeStore.setState(useRealtimeStore.getInitialState(), true));

  it('begin 은 이전 세션 값을 모두 비우고 연결 중으로 둔다', () => {
    const store = useRealtimeStore.getState();
    store.opened(T);
    store.receiveHealth(health(T));
    store.reject();

    useRealtimeStore.getState().begin();
    expect(useRealtimeStore.getState()).toMatchObject({
      phase: 'CONNECTING',
      openedAt: null,
      health: null,
      rejected: 0,
      source: null,
    });
  });

  it('GET /api/health 로 받은 값은 더 새 health 를 아직 받지 않았을 때만 채운다', () => {
    const store = useRealtimeStore.getState();
    store.seedHealth(health(T));
    expect(useRealtimeStore.getState().health?.payload.as_of).toBe(health(T).payload.as_of);

    // /topic/health 로 더 새 값을 받은 뒤 늦게 온 조회 값은 버린다.
    store.receiveHealth(health(T + 2000));
    store.seedHealth(health(T + 1000));
    expect(useRealtimeStore.getState().health?.payload.as_of).toBe(health(T + 2000).payload.as_of);

    // 더 새 조회 값은 받는다(재연결 직후 등).
    store.seedHealth(health(T + 3000));
    expect(useRealtimeStore.getState().health?.payload.as_of).toBe(health(T + 3000).payload.as_of);
  });

  it('health 를 받을 때마다 Tier 0 지연 표본을 쌓아 평균을 내고, Tier 0 와 끊긴 health 가 오면 비운다', () => {
    const store = useRealtimeStore.getState();
    const withLag = (at: number, lag: number) => {
      const h = health(at);
      const tier0 = h.payload.tier0_health as Record<string, unknown>;
      return { ...h, payload: { ...h.payload, tier0_health: { ...tier0, pipeline_lag_ms: lag } } };
    };
    store.receiveHealth(withLag(T, 100));
    store.seedHealth(withLag(T - 1000, 900)); // 더 오래된 조회 값은 버리므로 표본도 쌓지 않는다.
    store.receiveHealth(withLag(T + 1000, 200));
    expect(selectTier0LagMs(useRealtimeStore.getState())).toBe(150);
    expect(selectCameraLagMs(useRealtimeStore.getState(), 'cam_A')).toBeTypeOf('number');

    const lost = health(T + 2000);
    store.receiveHealth({ ...lost, payload: { ...lost.payload, tier0_link: 'DISCONNECTED' } });
    expect(selectTier0LagMs(useRealtimeStore.getState())).toBeUndefined();
    expect(selectCameraLagMs(useRealtimeStore.getState(), 'cam_A')).toBeUndefined();
  });

  it('reset 하면 로그인 전 상태로 돌아간다', () => {
    useRealtimeStore.getState().opened(T);
    useRealtimeStore.getState().receiveWorld({ payload: worldStateAt(T).payload, receivedAt: T });
    useRealtimeStore.getState().reset();
    expect(useRealtimeStore.getState()).toMatchObject({ phase: 'IDLE', world: null });
  });

  it('연결이 다시 열린 뒤 첫 world 는 순서와 상관없이 받고, 그다음부터 다시 새 것만 받는다', () => {
    const store = useRealtimeStore.getState();
    store.receiveWorld({ payload: worldStateAt(T).payload, receivedAt: T });
    store.opened(T + 1);
    store.receiveWorld({ payload: worldStateAt(T - 5000).payload, receivedAt: T + 2 });
    expect(useRealtimeStore.getState().world?.receivedAt).toBe(T + 2);
    store.receiveWorld({ payload: worldStateAt(T - 9000).payload, receivedAt: T + 3 });
    expect(useRealtimeStore.getState().world?.receivedAt).toBe(T + 2);
  });

  it('연결이 그대로여도 한동안 world 를 못 받았으면 시계가 뒤로 간 프레임도 받는다', () => {
    const store = useRealtimeStore.getState();
    store.receiveWorld({ payload: worldStateAt(T).payload, receivedAt: T });
    store.receiveWorld({ payload: worldStateAt(T - 5000).payload, receivedAt: T + 100 });
    expect(useRealtimeStore.getState().world?.receivedAt).toBe(T);
    store.receiveWorld({
      payload: worldStateAt(T - 5000).payload,
      receivedAt: T + WORLD_STALE_MS + 1,
    });
    expect(useRealtimeStore.getState().world?.receivedAt).toBe(T + WORLD_STALE_MS + 1);
  });

  it('world 를 정한 시간 안에 받았으면 새 것이다', () => {
    expect(isWorldFresh({ world: null }, T)).toBe(false);
    const world = { payload: worldStateAt(T).payload, receivedAt: T };
    expect(isWorldFresh({ world }, T + WORLD_STALE_MS)).toBe(true);
    expect(isWorldFresh({ world }, T + WORLD_STALE_MS + 1)).toBe(false);
  });

  it('world 는 더 새 프레임만 받는다(t_latest_global 기준)', () => {
    const store = useRealtimeStore.getState();
    store.receiveWorld({ payload: worldStateAt(T).payload, receivedAt: T });
    const first = useRealtimeStore.getState().world;
    store.receiveWorld({ payload: worldStateAt(T - 100).payload, receivedAt: T + 10 });
    expect(useRealtimeStore.getState().world).toBe(first);
    store.receiveWorld({ payload: worldStateAt(T + 100).payload, receivedAt: T + 20 });
    expect(useRealtimeStore.getState().world?.receivedAt).toBe(T + 20);
  });

  it('받은 world 만 World ID 기록(trackLife)에 더하고, 워치 배정은 새 ID 가 있을 때만 바꾼다(S15P31A101-785)', () => {
    const store = useRealtimeStore.getState();
    const frame = worldStateAt(T).payload;
    store.receiveWorld({ payload: frame, receivedAt: T });
    const life = useRealtimeStore.getState().trackLife;
    expect(life.lastFrameAt).toBe(frame.t_latest_global);
    expect(Object.keys(life.lives).length).toBeGreaterThan(0);
    // 늦게 온 이전 프레임은 버리므로 기록도 그대로다
    store.receiveWorld({ payload: worldStateAt(T - 100).payload, receivedAt: T + 10 });
    expect(useRealtimeStore.getState().trackLife).toBe(life);

    store.noteWatchedIds(['w-1']);
    const watched = useRealtimeStore.getState().trackLife.watched;
    expect(watched).toEqual({ 'w-1': true });
    store.noteWatchedIds(['w-1']);
    expect(useRealtimeStore.getState().trackLife.watched).toBe(watched);
  });
});

describe('isLinkAlive', () => {
  it('열려 있고 마지막 health(없으면 연결 시각)로부터 정한 시간 안이면 이어져 있다', () => {
    const opened = { phase: 'OPEN' as const, openedAt: T, health: null };
    expect(isLinkAlive(opened, T + HEALTH_TIMEOUT_MS)).toBe(true);
    expect(isLinkAlive(opened, T + HEALTH_TIMEOUT_MS + 1)).toBe(false);

    const withHealth = { ...opened, health: health(T + 10_000) };
    expect(isLinkAlive(withHealth, T + 12_000)).toBe(true);
    expect(isLinkAlive(withHealth, T + 13_001)).toBe(false);
  });

  it('열려 있지 않으면 끊긴 것이다', () => {
    for (const phase of ['IDLE', 'CONNECTING', 'CLOSED'] as const) {
      expect(isLinkAlive({ phase, openedAt: T, health: health(T) }, T)).toBe(false);
    }
  });
});

describe('selectTrackedCount', () => {
  it('확정(CONFIRMED)·가림(OCCLUDED)만 세고 확정 전(TENTATIVE)·놓친(LOST) 트랙은 세지 않는다', () => {
    const tracks = ['CONFIRMED', 'OCCLUDED', 'TENTATIVE', 'LOST', 'CONFIRMED'].map(
      (track_lifecycle, i) => ({ world_id: `w-${i}`, track_lifecycle }),
    );
    const world = { receivedAt: T, payload: { tracks } as unknown as WorldStatePayload };
    expect(selectTrackedCount({ world })).toBe(3);
    expect(selectTrackedCount({ world: null })).toBe(0);
  });
});
