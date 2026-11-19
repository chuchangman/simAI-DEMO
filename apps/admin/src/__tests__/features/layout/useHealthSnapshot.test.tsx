import { useHealthSnapshot } from '@/features/layout/useHealthSnapshot';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import { HEALTH_TIMEOUT_MS, isLinkAlive, useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const T = 1_760_342_400_000;
const MESSAGE = viewerHealthAt(T);

let calls = 0;
/** n 번째 요청의 답. 늦게 답하게 해 경합을 본다. */
let reply: (n: number) => Response | Promise<Response> = () => HttpResponse.json(MESSAGE);
const server = setupServer(
  http.get('http://api.test/api/health', () => {
    calls += 1;
    return reply(calls);
  }),
);
const later = async (ms: number, message: ReturnType<typeof viewerHealthAt>) => {
  await delay(ms);
  return HttpResponse.json(message);
};
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  calls = 0;
  reply = () => HttpResponse.json(MESSAGE);
});
afterEach(() => {
  cleanup();
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

function open(at = Date.now()) {
  useRealtimeStore.setState({ phase: 'OPEN', openedAt: at });
}

function run() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useHealthSnapshot(), { wrapper });
}

const health = () => useRealtimeStore.getState().health;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const settle = () => wait(50);

describe('useHealthSnapshot', () => {
  it('연결이 열리면 GET /api/health 로 지금 상태를 채우고, 받은 시각·시계 차이는 요청 동안의 값이다', async () => {
    const before = Date.now();
    open();
    run();

    await waitFor(() => expect(health()).not.toBeNull());
    const after = Date.now();
    expect(calls).toBe(1);
    expect(health()!.payload).toEqual(MESSAGE.payload);
    // 받은 시각은 요청을 보낸 때, 시계 차이는 sent_at − (요청 시작·끝의 가운데)다.
    expect(health()!.receivedAt).toBeGreaterThanOrEqual(before);
    expect(health()!.receivedAt).toBeLessThanOrEqual(after);
    expect(health()!.clockOffsetMs).toBeGreaterThanOrEqual(MESSAGE.sent_at - after);
    expect(health()!.clockOffsetMs).toBeLessThanOrEqual(MESSAGE.sent_at - before);
  });

  it('응답이 늦어도 연결 판정 시각을 늘리지 않는다(끊긴 연결이 살아 보이지 않는다)', async () => {
    reply = () => later(400, MESSAGE);
    const openedAt = Date.now();
    open(openedAt);
    run();

    await waitFor(() => expect(health()).not.toBeNull(), { timeout: 2_000 });
    // 응답이 400ms 늦었어도 받은 시각은 요청 시작 무렵이라, 연결 뒤 정한 시간이 지나면 끊긴 것으로 본다.
    expect(health()!.receivedAt).toBeLessThan(openedAt + 200);
    const state = useRealtimeStore.getState();
    expect(isLinkAlive(state, openedAt + HEALTH_TIMEOUT_MS + 150)).toBe(false);
  });

  it('다시 연결되기 전에 보낸 늦은 응답은 버린다', async () => {
    // 첫 요청은 늦게, 더 새 값(as_of)으로 답한다. 버리지 않으면 이 값이 남는다.
    reply = (n) => (n === 1 ? later(300, viewerHealthAt(T + 10_000)) : HttpResponse.json(MESSAGE));
    open(1_000);
    run();
    await waitFor(() => expect(calls).toBe(1));

    act(() => open(2_000));
    await waitFor(() => expect(health()).not.toBeNull());
    await wait(400);
    expect(health()!.payload.as_of).toBe(MESSAGE.payload.as_of);
  });

  it('로그아웃(연결 닫힘) 뒤에 온 응답은 채우지 않는다', async () => {
    reply = () => later(300, MESSAGE);
    open();
    run();
    await waitFor(() => expect(calls).toBe(1));

    act(() => useRealtimeStore.getState().reset());
    await wait(400);
    expect(health()).toBeNull();
  });

  it('연결이 열리기 전에는 부르지 않는다', async () => {
    useRealtimeStore.setState({ phase: 'CONNECTING', openedAt: null });
    run();

    await settle();
    expect(calls).toBe(0);
    expect(health()).toBeNull();
  });

  it('그 사이 /topic/health 로 더 새 값을 받았으면 덮지 않는다', async () => {
    const newer = { payload: viewerHealthAt(T + 5_000).payload, receivedAt: T, clockOffsetMs: 0 };
    useRealtimeStore.setState({ health: newer });
    open();
    run();

    await waitFor(() => expect(calls).toBe(1));
    await settle();
    expect(health()).toBe(newer);
  });

  it('다시 연결되면(연결 시각이 바뀌면) 다시 부른다', async () => {
    open(1_000);
    run();
    await waitFor(() => expect(calls).toBe(1));

    act(() => open(2_000));
    await waitFor(() => expect(calls).toBe(2));
  });

  it.each([
    ['서버 오류', () => HttpResponse.json({}, { status: 500 })],
    ['아직 없는 경로', () => HttpResponse.json({}, { status: 404 })],
    ['계약과 다른 응답', () => HttpResponse.json({ ...MESSAGE, msg_type: 'world_state' })],
  ] as const)('%s 이면 조용히 넘어가고 /topic/health 를 기다린다', async (_, response) => {
    reply = response;
    open();
    run();

    await waitFor(() => expect(calls).toBe(1));
    await settle();
    expect(health()).toBeNull();
  });

  // 관리자 전용 지표(useMetrics)와 달리 역할로 막지 않는다(명세 12.6 열람). 막으면 이 시험이 깨진다.
  it('역할과 상관없이(열람 계정도) 부른다', async () => {
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'v', role: 'VIEWER' } });
    open();
    run();

    await waitFor(() => expect(health()).not.toBeNull());
  });
});
