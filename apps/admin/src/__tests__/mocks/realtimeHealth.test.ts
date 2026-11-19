import { startRealtimeMock } from '@/mocks/realtime';
import { worldStateAt, type MockConfig } from '@/mocks/realtimeScenario';
import type { StompBroker } from '@/mocks/stompBroker';
import { validateMessage, type ViewerHealthPayload } from '@simai/contracts';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;

let t = T0;
// 연결이 없는 broker 라 STOMP 송출은 하지 않는다. GET /api/health 만 본다.
const broker = {
  connections: 0,
  publish: () => undefined,
  dropAll: () => undefined,
} as unknown as StompBroker;
const mock = startRealtimeMock(broker, () => t);
const server = setupServer(...mock.handlers);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  t = T0;
  mock.outage(null);
  mock.sceneMismatch(false);
});
afterAll(() => {
  server.close();
  mock.stop();
});

const get = (authorization: string | null = 'Bearer mock-token.admin') =>
  fetch('http://api.test/api/health', {
    headers: authorization ? { Authorization: authorization } : {},
  });
const payload = async (response: Response) =>
  ((await response.json()) as { payload: ViewerHealthPayload }).payload;

describe('GET /api/health mock', () => {
  it('로그인한 계정이면 역할과 상관없이 viewer_health 메시지를 그대로 준다(계약 통과)', async () => {
    for (const account of ['admin', 'foreman', 'viewer']) {
      const response = await get(`Bearer mock-token.${account}`);
      expect(response.status).toBe(200);
      const checked = validateMessage('viewer_health', await response.json());
      expect(checked.ok ? [] : checked.errors).toEqual([]);
    }
  });

  it('로그인하지 않았거나 실서버 토큰이 만료됐으면 401 이다', async () => {
    expect((await get(null)).status).toBe(401);
    const jwt = (exp: number) =>
      `Bearer h.${btoa(JSON.stringify({ sub: 'u-1', role: 'ADMIN', exp })).replace(/=+$/, '')}.s`;
    expect((await get(jwt(Math.floor(t / 1000) - 1))).status).toBe(401);
    expect((await get(jwt(Math.floor(t / 1000) + 60))).status).toBe(200);
  });

  it('STOMP 흉내와 같은 지금 상태(장애·Scene 불일치)를 준다', async () => {
    mock.outage('tier0');
    t = T0 + 5_000;
    mock.sceneMismatch(true);

    const now = await payload(await get());
    expect(now.remote_state).toBe('CONTROL_HALTED');
    expect(now.scene.mismatch).toBe(true);
  });
});

describe('구성 묶음 상태', () => {
  it('구역 mock 이 정한 구성 상태(발행·ACK)를 health 와 world 에 싣고, 계약을 통과한다', async () => {
    const states: MockConfig[] = [
      { published_version: 'cfg-13', applied_version: 'cfg-12', sync: 'PENDING' },
      { published_version: 'cfg-13', applied_version: 'cfg-12', sync: 'STALE' },
      { published_version: 'cfg-13', applied_version: 'cfg-13', sync: 'CURRENT' },
    ];
    let config = states[0]!;
    const configured = startRealtimeMock(
      broker,
      () => t,
      () => config,
    );
    // 이 시험 동안만 구성 상태를 받는 mock 이 GET /api/health 에 답한다.
    server.use(...configured.handlers);
    try {
      for (const next of states) {
        config = next;
        const message = await (await get()).json();
        const checked = validateMessage('viewer_health', message);
        expect(checked.ok ? [] : checked.errors).toEqual([]);
        expect((message as { payload: ViewerHealthPayload }).payload.config).toEqual(next);
      }
      expect(worldStateAt(t, { configVersion: 'cfg-13' }).payload.config_version).toBe('cfg-13');
      expect(validateMessage('world_state', worldStateAt(t, { configVersion: null })).ok).toBe(
        true,
      );
    } finally {
      server.resetHandlers();
      configured.stop();
    }
  });
});
