import { createExternalSource, type SourceConnectionChange } from '@/features/viewer3d';
import { bindSession } from '@/lib/bindSession';
import { createRealtime, type Realtime } from '@/lib/stomp';
import { riskEventsBetween, viewerHealthAt, worldStateAt } from '@/mocks/realtimeScenario';
import { createStompBroker, parseFrame, serializeFrame } from '@/mocks/stompBroker';
import { useRealtimeStore } from '@/store/realtime.store';
import type { Session } from '@/store/session.store';
import { ws } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

const URL = 'ws://stomp.test/ws';
const [avatarFrame] = Object.values(
  import.meta.glob('../../../../../../contracts/examples/avatar_frame.json', {
    eager: true,
    import: 'default',
  }),
);
const [ppeView] = Object.values(
  import.meta.glob('../../../../../../contracts/examples/ppe_view.json', {
    eager: true,
    import: 'default',
  }),
);
/** 브로커가 받은 CONNECT 의 Authorization. */
const authorizations: (string | undefined)[] = [];
const broker = createStompBroker({
  url: URL,
  authorize: (a) => {
    authorizations.push(a);
    // t-expired* 는 만료된 토큰이다(서버는 CONNECT 를 ERROR 로 거절한다).
    return !!a?.startsWith('Bearer t-') && !a.startsWith('Bearer t-expired');
  },
});
const server = setupServer(broker.handler);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let realtime: Realtime;
beforeEach(() => {
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  realtime = createRealtime({
    url: URL,
    store: useRealtimeStore,
    healthTimeoutMs: 150,
    reconnectDelayMs: 20,
    watchIntervalMs: 20,
  });
});
afterEach(async () => {
  await realtime.stop();
  server.resetHandlers();
});

/** 재연결을 기다리는 시험의 상한(ms). 조건이 맞으면 바로 넘어가므로 평소 시간은 늘지 않는다 */
const RECONNECT_WAIT_MS = 10_000;

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('시간 안에 조건이 맞지 않았다');
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Source 가 생기면 구독해 뷰어가 받는 것을 모은다. */
async function watchSource() {
  await until(() => useRealtimeStore.getState().source !== null);
  const source = useRealtimeStore.getState().source;
  if (!source) throw new Error('Source 가 없다');
  const messages: unknown[] = [];
  const links: string[] = [];
  source.subscribe({
    onMessage: (raw) => messages.push(raw),
    onConnectionChange: (c: SourceConnectionChange) =>
      links.push(c.reason ? `${c.state}:${c.reason}` : c.state),
  });
  return { source, messages, links };
}

/** 구독이 브로커에 닿을 때까지 health 를 보낸다. 실행 시각과 상관없이 정상(고장 흉내 없음)이다. */
async function untilHealth() {
  await until(() => {
    broker.publish('/topic/health', viewerHealthAt(Date.now(), { faults: false }));
    return useRealtimeStore.getState().health !== null;
  });
}

describe('createRealtime', () => {
  it('/topic/avatar 본문과 수신 시각을 Source 에 넘기고 재연결 때 다시 구독한다', async () => {
    const receivedAt = 1_800_000_000_000;
    await realtime.stop();
    realtime = createRealtime({
      url: URL,
      store: useRealtimeStore,
      now: () => receivedAt,
      reconnectDelayMs: 20,
    });
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const { source } = await watchSource();
    const frames: { raw: unknown; at: number | undefined }[] = [];
    source.subscribe({
      onMessage: (raw, at) => frames.push({ raw, at }),
      onConnectionChange: () => undefined,
    });
    await until(() => {
      broker.publish('/topic/avatar', avatarFrame);
      return frames.length > 0;
    });
    expect(frames[0]).toEqual({ raw: avatarFrame, at: receivedAt });
    expect(useRealtimeStore.getState().world).toBeNull();
    expect(useRealtimeStore.getState().rejected).toBe(0);

    broker.dropAll();
    await until(() => useRealtimeStore.getState().phase === 'CLOSED');
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    frames.length = 0;
    await until(() => {
      broker.publish('/topic/avatar', avatarFrame);
      return frames.length > 0;
    });
    expect(frames[0]?.raw).toEqual(avatarFrame);
    broker.publish('/topic/avatar', { msg_type: 'avatar_frame', payload: {} });
    await until(() => useRealtimeStore.getState().rejected === 1);
  });

  it('다시 연결할 때 가장 새 토큰을 싣는다(토큰 갱신이 연결을 다시 열지 않는다)', async () => {
    let token: string | undefined = 't-1';
    realtime.start({ userId: 'u-1', getToken: () => token });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    authorizations.length = 0;

    token = 't-2';
    broker.dropAll();
    await until(() => authorizations.length > 0 && useRealtimeStore.getState().phase === 'OPEN');
    expect(authorizations).toEqual(['Bearer t-2']);
  });

  it('토큰을 Promise 로 주면 기다렸다가 싣는다(만료 전 갱신)', async () => {
    authorizations.length = 0;
    realtime.start({
      userId: 'u-1',
      getToken: () => new Promise((resolve) => setTimeout(() => resolve('t-fresh'), 30)),
    });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    expect(authorizations).toEqual(['Bearer t-fresh']);
  });

  it('토큰이 없어졌으면 이전 토큰도 Bearer undefined 도 싣지 않는다', async () => {
    let token: string | undefined = 't-1';
    realtime.start({ userId: 'u-1', getToken: () => token });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    authorizations.length = 0;

    token = undefined;
    broker.dropAll();
    await until(() => authorizations.length > 0);
    expect(authorizations.every((a) => a === undefined)).toBe(true);
    expect(useRealtimeStore.getState().phase).not.toBe('OPEN');
  });

  it('토큰으로 연결하고, health 는 저장소에 두고 모든 본문을 뷰어 Source 로 넘긴다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    expect(useRealtimeStore.getState().phase).toBe('CONNECTING');
    const viewer = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');

    await untilHealth();
    broker.publish('/topic/world', worldStateAt(Date.now()));
    await until(() =>
      viewer.messages.some((m) => (m as { msg_type?: string }).msg_type === 'world_state'),
    );

    const { health, world, rejected } = useRealtimeStore.getState();
    expect(health?.payload.system_health).toBe('NOMINAL');
    expect(Math.abs(health?.clockOffsetMs ?? Infinity)).toBeLessThan(1000);
    expect(world?.payload.tracks.length).toBeGreaterThan(0);
    expect(rejected).toBe(0);
    expect(viewer.links).toContain('OPEN');
    expect(viewer.source.id).toBe('live:u-1:1');
  });

  it('계약에 맞지 않는 world 는 버리고, 늦게 온 이전 프레임은 지금 프레임을 바꾸지 않는다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    const t = Date.now();
    await until(() => {
      broker.publish('/topic/world', worldStateAt(t));
      return useRealtimeStore.getState().world !== null;
    });
    const latest = useRealtimeStore.getState().world;

    broker.publish('/topic/world', worldStateAt(t - 5000));
    broker.publish('/topic/world', { msg_type: 'world_state', payload: {} });
    await until(() => useRealtimeStore.getState().rejected === 1);
    expect(useRealtimeStore.getState().world).toBe(latest);
  });

  it('계약을 통과한 risk_event 만 알리고, 연결이 열릴 때마다 open 을 알린다', async () => {
    const events: string[] = [];
    let opens = 0;
    const offEvent = realtime.on('riskEvent', (event) => events.push(event.lifecycle));
    const offOpen = realtime.on('open', () => {
      opens += 1;
    });
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => opens === 1);

    const [raised] = riskEventsBetween(0, 40_000);
    await until(() => {
      broker.publish('/topic/events', raised);
      return events.length > 0;
    });
    const rejected = useRealtimeStore.getState().rejected;
    broker.publish('/topic/events', { msg_type: 'risk_event', payload: {} });
    await until(() => useRealtimeStore.getState().rejected === rejected + 1);
    expect(events.every((e) => e === 'RAISED')).toBe(true);

    broker.dropAll();
    await until(() => opens === 2);
    offEvent();
    offOpen();
  });

  it('/topic/watch 의 watch_escalation 은 계약을 검사해 알리고 3D 뷰어 Source 로 넘기지 않는다(-342)', async () => {
    const escalations: string[] = [];
    const off = realtime.on('watchEscalation', (e) =>
      escalations.push(`${e.device_id}:${e.reason}`),
    );
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const viewer = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    const escalation = {
      schema_version: '1.0.0',
      msg_type: 'watch_escalation',
      msg_id: '0192a6f0-7c1e-7b3a-9f2d-000000000338',
      sent_at: Date.now(),
      source_id: 'ec2',
      payload: {
        event_id: '0192a6f0-7c1e-7b3a-9f2d-00000000e338',
        event_sequence: 2,
        alert_msg_id: '0192a6f0-7c1e-7b3a-9f2d-00000000a338',
        device_id: 'watch-01',
        world_id: 'w-17',
        severity: 'HIGH',
        reason: 'NO_ACK',
        sent_at: 1760342401100,
        escalated_at: 1760342411150,
      },
    };
    await until(() => {
      broker.publish('/topic/watch', escalation);
      return escalations.length > 0;
    });
    expect(escalations[0]).toBe('watch-01:NO_ACK');
    const rejected = useRealtimeStore.getState().rejected;
    broker.publish('/topic/watch', { msg_type: 'watch_escalation', payload: {} });
    await until(() => useRealtimeStore.getState().rejected === rejected + 1);
    expect(
      viewer.messages.some((m) => (m as { msg_type?: string }).msg_type === 'watch_escalation'),
    ).toBe(false);
    off();
  });

  it('/topic/ppe 의 ppe_view 는 계약을 검사해 저장소에 두고 3D 뷰어 Source 로 넘기지 않는다(-531)', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const viewer = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await until(() => {
      broker.publish('/topic/ppe', ppeView);
      return useRealtimeStore.getState().ppe['tier0-01'] !== undefined;
    });
    const stored = useRealtimeStore.getState().ppe['tier0-01']!;
    expect(stored.payload.people.map((p) => p.world_id)).toEqual(['w-0012', 'w-0013']);
    const rejected = useRealtimeStore.getState().rejected;
    broker.publish('/topic/ppe', { msg_type: 'ppe_view', payload: {} });
    await until(() => useRealtimeStore.getState().rejected === rejected + 1);
    expect(viewer.messages.some((m) => (m as { msg_type?: string }).msg_type === 'ppe_view')).toBe(
      false,
    );
  });

  it('3D 뷰어가 받다가 실패해도 앱은 world·health 를 계속 받는다', async () => {
    const rethrown: unknown[] = [];
    const original = globalThis.queueMicrotask;
    // 뷰어 오류는 따로 던져 콘솔에 남긴다. 시험에서는 그 오류를 모은다.
    const later = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((fn) =>
      original(() => {
        try {
          fn();
        } catch (error) {
          rethrown.push(error);
        }
      }),
    );
    try {
      realtime.start({ userId: 'u-1', getToken: () => 't-1' });
      const { source } = await watchSource();
      source.subscribe({
        onMessage: () => {
          throw new Error('viewer broke');
        },
        onConnectionChange: () => undefined,
      });
      await until(() => useRealtimeStore.getState().phase === 'OPEN');
      await untilHealth();
      broker.publish('/topic/world', worldStateAt(Date.now()));
      await until(() => useRealtimeStore.getState().world !== null);
      expect(rethrown.length).toBeGreaterThan(0);
    } finally {
      later.mockRestore();
    }
  });

  it('3D 뷰어가 새로 구독하면(늦게 붙거나 다시 띄움) 마지막 world·health·이벤트를 다시 받는다', async () => {
    const events: string[] = [];
    const off = realtime.on('riskEvent', (event) => events.push(event.event_id));
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await untilHealth();
    const [raised] = riskEventsBetween(0, 40_000);
    await until(() => {
      broker.publish('/topic/events', raised);
      broker.publish('/topic/world', worldStateAt(Date.now()));
      return events.length > 0 && useRealtimeStore.getState().world !== null;
    });
    off();

    // 메시지를 더 보내지 않아도 새로 구독한 뷰어가 받는다.
    const viewer = await watchSource();
    const types = () => viewer.messages.map((m) => (m as { msg_type?: string }).msg_type);
    await until(() =>
      ['world_state', 'viewer_health', 'risk_event'].every((t) => types().includes(t)),
    );
  });

  it('한 번에 뷰어가 바뀌어도(구독 해제 뒤 바로 구독) 새 뷰어가 가장 새 이벤트를 곧바로 받는다', async () => {
    const events: number[] = [];
    const off = realtime.on('riskEvent', (event) => events.push(event.event_sequence ?? 0));
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => useRealtimeStore.getState().source !== null);
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    const [raised, updated] = riskEventsBetween(0, 40_000)
      .filter((m) => m.payload.rule_id === 'R2')
      .map((m, i) => ({ ...m, payload: { ...m.payload, event_sequence: i + 1 } }));
    // 순서가 뒤바뀌어 와도(2 다음 1) 다시 넘길 것은 순번이 큰 쪽이다.
    await until(() => {
      broker.publish('/topic/events', updated);
      return events.includes(2);
    });
    broker.publish('/topic/events', raised);
    await until(() => events.includes(1));
    off();

    const source = useRealtimeStore.getState().source!;
    const first = source.subscribe({
      onMessage: () => undefined,
      onConnectionChange: () => undefined,
    });
    first();
    const received: unknown[] = [];
    source.subscribe({
      onMessage: (raw) => received.push(raw),
      onConnectionChange: () => undefined,
    });
    const replayed = received.filter(
      (m) => (m as { msg_type?: string }).msg_type === 'risk_event',
    ) as { payload: { event_sequence: number } }[];
    expect(replayed.map((m) => m.payload.event_sequence)).toEqual([2]);
  });

  it('다시 연결되면 시계가 뒤로 간 world 도 받는다(서버 재시작·시계 보정)', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    const t = Date.now();
    await until(() => {
      broker.publish('/topic/world', worldStateAt(t));
      return useRealtimeStore.getState().world !== null;
    });

    broker.dropAll();
    // 다시 붙기까지는 재연결 지연·STOMP 연결이 겹쳐 부하가 큰 CI(jsdom 동시 생성)에서 2초를 넘길 수 있다. 기다림만 늘린다
    await until(() => useRealtimeStore.getState().phase !== 'OPEN', RECONNECT_WAIT_MS);
    await until(
      () => useRealtimeStore.getState().phase === 'OPEN' && broker.connections === 1,
      RECONNECT_WAIT_MS,
    );
    const earlier = worldStateAt(t - 60_000);
    await until(() => {
      broker.publish('/topic/world', earlier);
      return (
        useRealtimeStore.getState().world?.payload.t_latest_global ===
        earlier.payload.t_latest_global
      );
    }, RECONNECT_WAIT_MS);
  });

  it('JSON 이 아니거나 계약에 맞지 않는 health 는 버리고 개수만 센다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await untilHealth();
    const before = useRealtimeStore.getState().health;

    broker.publishText('/topic/health', '<html>');
    broker.publish('/topic/health', { msg_type: 'viewer_health', payload: {} });
    await until(() => useRealtimeStore.getState().rejected === 2);
    expect(useRealtimeStore.getState().health).toBe(before);
  });

  it('health 가 정한 시간 넘게 없으면 뷰어에 끊김을 알리고, 다시 오면 열림을 알린다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const viewer = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await untilHealth();

    await until(() => viewer.links.at(-1) === 'CLOSED:상태 메시지 끊김');
    broker.publish('/topic/health', viewerHealthAt(Date.now()));
    await until(() => viewer.links.at(-1) === 'OPEN');
  });

  it('서버가 연결을 끊으면 끊김을 알리고 다시 연결한다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const viewer = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');

    broker.dropAll();
    await until(() => viewer.links.includes('CLOSED:연결 끊김'));
    await until(() => useRealtimeStore.getState().phase === 'OPEN' && broker.connections === 1);
  });

  it('stop 하면 연결을 끊고 저장소를 비운다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const viewer = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await untilHealth();

    await realtime.stop();
    expect(useRealtimeStore.getState()).toMatchObject({
      phase: 'IDLE',
      health: null,
      world: null,
      source: null,
    });
    expect(viewer.links.at(-1)).toBe('CLOSED:연결 종료');
    await until(() => broker.connections === 0);
  });

  it('다른 계정으로 다시 start 하면 새 Source 로 바꾸고 이전 데이터를 비운다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    const first = await watchSource();
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await untilHealth();

    realtime.start({ userId: 'u-2', getToken: () => 't-2' });
    expect(useRealtimeStore.getState()).toMatchObject({ health: null, source: null });
    expect(first.links.at(-1)).toBe('CLOSED:연결 종료');
    await until(() => useRealtimeStore.getState().source?.id === 'live:u-2:2');
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    await until(() => broker.connections === 1);
  });

  it('뷰어 입력을 불러오는 사이 stop 하면 늦게 온 입력을 붙이지 않는다', async () => {
    let finish: () => void = () => {};
    const delayed = createRealtime({
      url: URL,
      store: useRealtimeStore,
      loadSourceFactory: () =>
        new Promise((resolve) => {
          finish = () => resolve(createExternalSource);
        }),
    });
    delayed.start({ userId: 'u-1', getToken: () => 't-1' });
    expect(useRealtimeStore.getState().phase).toBe('CONNECTING');

    await delayed.stop();
    finish();
    await new Promise((r) => setTimeout(r, 100));
    expect(useRealtimeStore.getState()).toMatchObject({ phase: 'IDLE', source: null });
    await until(() => broker.connections === 0);
  });

  it('3D 뷰어 코드를 받지 못해도 연결해 world·health·이벤트를 받고, 다시 불러오면 뷰어 입력을 붙인다', async () => {
    let attempts = 0;
    let release: () => void = () => {};
    const retried = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const flaky = createRealtime({
      url: URL,
      store: useRealtimeStore,
      reconnectDelayMs: 20,
      loadSourceFactory: () =>
        ++attempts === 1
          ? Promise.reject(new Error('chunk load failed'))
          : retried.then(() => createExternalSource),
    });
    const off = flaky.on('riskEvent', (event) => events.push(event.event_id));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      flaky.start({ userId: 'u-1', getToken: () => 't-1' });
      await until(() => useRealtimeStore.getState().phase === 'OPEN');
      await untilHealth();
      await until(() => {
        broker.publish('/topic/world', worldStateAt(Date.now()));
        broker.publish('/topic/events', riskEventsBetween(0, 40_000)[0]);
        return useRealtimeStore.getState().world !== null && events.length > 0;
      });
      expect(useRealtimeStore.getState().source).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);

      release();
      const viewer = await watchSource();
      expect(attempts).toBe(2);
      expect(viewer.links.at(-1)).toBe('OPEN');
      // 늦게 붙은 뷰어도 진행 중 이벤트를 받는다.
      expect(
        viewer.messages.some((m) => (m as { msg_type?: string }).msg_type === 'risk_event'),
      ).toBe(true);
    } finally {
      warn.mockRestore();
      off();
      await flaky.stop();
    }
  });

  it('인증이 거부되면 열리지 않는다', async () => {
    realtime.start({ userId: 'u-1', getToken: () => 'bad' });
    await new Promise((r) => setTimeout(r, 200));
    expect(useRealtimeStore.getState().phase).not.toBe('OPEN');
    expect(broker.connections).toBe(0);
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('STOMP ERROR 프레임', () => {
  /** 단계가 바뀐 순서(같은 단계는 한 번만). */
  function watchPhases() {
    const phases: string[] = [];
    const unsubscribe = useRealtimeStore.subscribe((state) => {
      if (phases.at(-1) !== state.phase) phases.push(state.phase);
    });
    return { phases, unsubscribe };
  }

  it('토큰이 거절되면 갱신하고 새 토큰으로 다시 연결한다(단계가 멈추지 않는다)', async () => {
    let token = 't-expired';
    const refreshed: string[] = [];
    authorizations.length = 0;
    const { phases, unsubscribe } = watchPhases();
    realtime.start({
      userId: 'u-1',
      getToken: () => token,
      refreshToken: async (rejected) => {
        refreshed.push(rejected);
        token = 't-fresh';
        return token;
      },
    });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    unsubscribe();

    expect(refreshed).toEqual(['t-expired']);
    expect(authorizations).toEqual(['Bearer t-expired', 'Bearer t-fresh']);
    // ERROR 뒤 CLOSED 로 내려갔다가 다시 연결하는 중(CONNECTING)을 거쳐 열린다.
    expect(phases.slice(-4)).toEqual(['CONNECTING', 'CLOSED', 'CONNECTING', 'OPEN']);
  });

  it('getToken 이 이미 새 토큰을 주면(만료 전 갱신) ERROR 뒤에 다시 갱신하지 않는다', async () => {
    const refresh = vi.fn(async () => 't-never');
    authorizations.length = 0;
    realtime.start({
      userId: 'u-1',
      // 첫 시도는 만료된 토큰, 거절된 뒤에는 앱이 이미 갱신한 토큰을 준다.
      getToken: () => (authorizations.length === 0 ? 't-expired' : 't-2'),
      refreshToken: refresh,
    });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    expect(authorizations).toEqual(['Bearer t-expired', 'Bearer t-2']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('갱신 함수가 없으면 getToken 이 주는 토큰으로만 다시 붙는다', async () => {
    authorizations.length = 0;
    realtime.start({
      userId: 'u-1',
      getToken: () => (authorizations.length === 0 ? 't-expired' : 't-1'),
    });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    expect(authorizations).toEqual(['Bearer t-expired', 'Bearer t-1']);
  });

  it('갱신이 일시적으로 실패하면(세션은 그대로) 지금 토큰으로 붙어 보고, 거절되면 다음에 다시 갱신한다', async () => {
    let token = 't-expired';
    let attempts = 0;
    authorizations.length = 0;
    realtime.start({
      userId: 'u-1',
      getToken: () => token,
      refreshToken: async () => {
        attempts += 1;
        // 첫 갱신은 서버가 꺼져 실패한다(예외). 다음은 성공한다.
        if (attempts === 1) throw new Error('server down');
        token = 't-fresh';
        return token;
      },
    });
    await until(() => useRealtimeStore.getState().phase === 'OPEN');
    expect(attempts).toBe(2);
    expect(authorizations).toEqual(['Bearer t-expired', 'Bearer t-expired', 'Bearer t-fresh']);
  });

  it('갱신한 토큰도 거절되면 토큰 문제가 아니므로 다시 갱신하지 않고 간격을 두고 다시 붙는다', async () => {
    let token = 't-expired-0';
    let refreshes = 0;
    authorizations.length = 0;
    realtime.start({
      userId: 'u-1',
      getToken: () => token,
      // 갱신해도 서버가 계속 거절한다(앱의 authSession.refresh 처럼 세션의 토큰도 바꾼다).
      refreshToken: async () => {
        refreshes += 1;
        token = `t-expired-${refreshes}`;
        return token;
      },
    });
    await until(() => authorizations.length >= 4);
    expect(refreshes).toBe(1);
    expect(useRealtimeStore.getState().phase).not.toBe('OPEN');
  });

  it('갱신 쿠키가 거부돼 세션이 끝나면(로그아웃) 더 연결하지 않는다', async () => {
    const alice: Session = { accessToken: 't-expired', user: { id: 'u-1', role: 'VIEWER' } };
    const sessionStore = createStore<{ session?: Session }>()(() => ({ session: alice }));
    let refreshes = 0;
    authorizations.length = 0;
    bindSession({
      sessionStore,
      realtime,
      router: { invalidate: async () => undefined, clearCache: () => undefined },
      queryClient: { clear: () => undefined },
      // authSession.refresh 는 갱신 쿠키가 거부(401 INVALID_REFRESH_TOKEN)되면 세션을 끝내고 undefined 를 준다.
      refreshToken: async () => {
        refreshes += 1;
        sessionStore.setState({ session: undefined });
        return undefined;
      },
    });
    await until(() => refreshes === 1);
    await sleep(300);

    expect(authorizations).toEqual(['Bearer t-expired']);
    expect(useRealtimeStore.getState().phase).toBe('IDLE');
    expect(broker.connections).toBe(0);
  });

  it('갱신을 기다리는 사이 stop 하면 연결하지 않는다', async () => {
    let started = false;
    let finish: (token: string) => void = () => {};
    authorizations.length = 0;
    realtime.start({
      userId: 'u-1',
      getToken: () => 't-expired',
      refreshToken: () =>
        new Promise<string>((resolve) => {
          started = true;
          finish = resolve;
        }),
    });
    await until(() => started);
    await realtime.stop();
    finish('t-fresh');
    await sleep(100);

    expect(authorizations).toEqual(['Bearer t-expired']);
    expect(useRealtimeStore.getState().phase).toBe('IDLE');
  });

  it('연결이 열린 직후 ERROR 로 거절돼도 단계가 멈추지 않고 간격을 늘려 다시 붙는다', async () => {
    // 서버가 CONNECTED 를 보낸 뒤 첫 구독을 ERROR 로 거절하고 닫는 흉내.
    const deniedUrl = 'ws://stomp-denied.test/ws';
    let connects = 0;
    const denying = ws.link(deniedUrl);
    server.use(
      denying.addEventListener('connection', ({ client }) => {
        client.addEventListener('message', (event) => {
          const frame = typeof event.data === 'string' ? parseFrame(event.data) : null;
          if (frame?.command === 'CONNECT') {
            connects += 1;
            client.send(serializeFrame('CONNECTED', { version: '1.2', 'heart-beat': '0,0' }));
          }
          if (frame?.command === 'SUBSCRIBE') {
            client.send(serializeFrame('ERROR', { message: 'Access is denied' }));
            setTimeout(() => client.close(1008, 'Access is denied'), 0);
          }
        });
      }),
    );
    await realtime.stop();
    realtime = createRealtime({ url: deniedUrl, store: useRealtimeStore, reconnectDelayMs: 20 });
    const { phases, unsubscribe } = watchPhases();
    realtime.start({ userId: 'u-1', getToken: () => 't-1' });
    await until(() => connects >= 3, RECONNECT_WAIT_MS);
    await sleep(400);
    unsubscribe();

    expect(phases).toContain('CLOSED');
    expect(phases.filter((phase) => phase === 'OPEN').length).toBeGreaterThanOrEqual(2);
    // 연결이 열린 직후 거절돼도 stompjs 의 간격(20ms)으로 계속 붙지 않는다(그러면 0.4초에 20번 넘게 붙는다).
    expect(connects).toBeLessThan(12);
  });
});
