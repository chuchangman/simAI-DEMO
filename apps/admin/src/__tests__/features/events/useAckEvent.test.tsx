import {
  applyEvents,
  isLocalAck,
  LIVE_EVENTS_KEY,
  type LiveEvents,
} from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { useAckEvent } from '@/features/events/useAckEvent';
import { riskEventsBetween } from '@/mocks/realtimeScenario';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 앱의 api 인스턴스는 import.meta.env 를 읽는다(CONVENTION 테스트). 같은 createHttp 로 시험 주소를 쓴다.
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const BASE = 'http://api.test';
const RESOLVED = '이미 해소된 이벤트입니다';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  useSessionStore.setState({ session: undefined });
  useRealtimeStore.getState().reset();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** 풀어 줄 때까지 응답을 미루고 409 를 돌려준다. */
function holdAck() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post(`${BASE}/api/events/:id/ack`, async () => {
      await gate;
      return HttpResponse.json({ message: RESOLVED }, { status: 409 });
    }),
  );
  return () => release();
}

describe('useAckEvent', () => {
  it('같은 이벤트의 버튼들은 보내는 중 상태를 같이 본다', async () => {
    const release = holdAck();
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ banner: useAckEvent('e-1'), card: useAckEvent('e-1'), other: useAckEvent('e-2') }),
      { wrapper },
    );

    act(() => result.current.banner.ack(3));
    await waitFor(() => expect(result.current.card.pending).toBe(true));
    expect(result.current.banner.pending).toBe(true);
    expect(result.current.other.pending).toBe(false);

    release();
    await waitFor(() => expect(result.current.card.pending).toBe(false));
  });

  it('실패 문구는 보낸 이벤트에만 보인다(배너가 다음 경보로 바뀌면 지운다)', async () => {
    const release = holdAck();
    release();
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ id }) => useAckEvent(id), {
      wrapper,
      initialProps: { id: 'e-1' },
    });

    act(() => result.current.ack(3));
    await waitFor(() => expect(result.current.error).toBe(RESOLVED));
    rerender({ id: 'e-2' });
    expect(result.current.error).toBeUndefined();
  });
});

// 시나리오의 R2(개구부 근접, CRITICAL) 발생.
const raised: EventItem = riskEventsBetween(0, 40_000)
  .map((m) => m.payload)
  .find((e) => e.rule_id === 'R2')!;
const EVENT = raised.event_id;

/** 서버가 확인을 받아 돌려주는 이벤트(진짜 ack 한 건). */
const acked: EventItem = {
  ...raised,
  event_sequence: (raised.event_sequence ?? 0) + 1,
  acks: [
    {
      ack_id: 'srv-1',
      channel: 'CONTROL_ROOM',
      actor_role: 'ADMIN',
      actor_id: 'admin',
      acked_at: Date.now(),
    },
  ],
};

const problem = (status: number, code: string) =>
  HttpResponse.json({ status, detail: '서버 문구', code }, { status });

const ackReplies = (response: () => Response) =>
  server.use(http.post(`${BASE}/api/events/:id/ack`, response));

/** EC2 와 이어진 상태(연결이 열린 직후)와 끊긴 상태. */
const linkUp = () => useRealtimeStore.setState({ phase: 'OPEN', openedAt: Date.now() });
const linkDown = () => useRealtimeStore.setState({ phase: 'CLOSED' });

const signInAs = (id: string, role: 'ADMIN' | 'FOREMAN' | 'VIEWER') =>
  useSessionStore.getState().signIn({ accessToken: 't', user: { id, role } });

const eventsOf = (queryClient: QueryClient) =>
  queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.entries ?? [];

describe('useAckEvent: 서버 오류 문구와 목록 갱신', () => {
  beforeEach(() => signInAs('admin', 'ADMIN'));

  it('code 별 문구를 보인다', async () => {
    const cases: [number, string, string][] = [
      [404, 'EVENT_NOT_FOUND', '이벤트를 찾을 수 없습니다'],
      [409, 'EVENT_RESOLVED', '이미 해소된 이벤트입니다'],
      [
        400,
        'INVALID_EVENT_SEQUENCE',
        '이벤트 상태가 바뀌었습니다. 새 상태를 받은 뒤 다시 확인하세요',
      ],
      [400, 'INVALID_ACK_CHANNEL', '확인 경로가 올바르지 않습니다'],
    ];
    for (const [status, code, text] of cases) {
      const { wrapper } = setup();
      ackReplies(() => problem(status, code));
      const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });
      act(() => result.current.ack(1));
      await waitFor(() => expect(result.current.error).toBe(text));
      cleanup();
    }
  });

  it('해소됨·순번 불일치는 목록을 다시 받게 하고, 그 밖의 실패는 그대로 둔다', async () => {
    const cases: [number, string, boolean][] = [
      [409, 'EVENT_RESOLVED', true],
      [400, 'INVALID_EVENT_SEQUENCE', true],
      [404, 'EVENT_NOT_FOUND', false],
      [400, 'INVALID_ACK_CHANNEL', false],
    ];
    for (const [status, code, stale] of cases) {
      const { queryClient, wrapper } = setup();
      applyEvents(queryClient, [raised]);
      ackReplies(() => problem(status, code));
      const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });
      act(() => result.current.ack(1));
      await waitFor(() => expect(result.current.error).toBeDefined());
      expect(queryClient.getQueryState(LIVE_EVENTS_KEY)?.isInvalidated).toBe(stale);
      cleanup();
    }
  });

  it('성공하면 돌려준 이벤트를 캐시에 반영한다(낙관적 갱신 없이 응답이 온 뒤)', async () => {
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [raised]);
    let body: unknown;
    server.use(
      http.post(`${BASE}/api/events/:id/ack`, async ({ request }) => {
        body = await request.json();
        // 응답이 오기 전에는 확인이 반영되지 않았다.
        expect(eventsOf(queryClient)[0]?.event.acks ?? []).toEqual([]);
        return HttpResponse.json(acked);
      }),
    );
    const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });

    act(() => result.current.ack(3));
    await waitFor(() => expect(eventsOf(queryClient)[0]?.event.acks).toHaveLength(1));
    expect(body).toEqual({ event_sequence: 3, channel: 'CONTROL_ROOM' });
    expect(result.current.error).toBeUndefined();
  });
});

describe('useAckEvent: 끊긴 화면에서의 확인', () => {
  beforeEach(() => signInAs('admin', 'ADMIN'));

  it.each([
    ['연결 실패', () => HttpResponse.error()],
    ['5xx', () => problem(503, 'UNAVAILABLE')],
  ])('끊긴 사이 %s 로 실패하면 화면 상태에 확인을 쓰고 오류 없이 끝난다', async (_, reply) => {
    linkDown();
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [raised]);
    ackReplies(reply);
    const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });

    act(() => result.current.ack(raised.event_sequence));
    await waitFor(() => expect(eventsOf(queryClient)[0]?.event.acks).toHaveLength(1));

    const [ack] = eventsOf(queryClient)[0]!.event.acks!;
    expect(isLocalAck(ack!)).toBe(true);
    expect(ack).toMatchObject({ channel: 'CONTROL_ROOM', actor_role: 'ADMIN', actor_id: 'admin' });
    expect(result.current.error).toBeUndefined();
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.pendingAcks).toEqual([
      expect.objectContaining({ eventId: EVENT, eventSequence: raised.event_sequence }),
    ]);
  });

  it('이어져 있을 때의 연결 실패·5xx 는 확인을 쓰지 않고 실패 문구를 보인다', async () => {
    linkUp();
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [raised]);
    ackReplies(() => HttpResponse.error());
    const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });

    act(() => result.current.ack(1));
    await waitFor(() => expect(result.current.error).toBe('서버에 연결할 수 없습니다'));
    expect(eventsOf(queryClient)[0]?.event.acks).toBeUndefined();

    ackReplies(() => problem(500, 'INTERNAL'));
    act(() => result.current.ack(1));
    await waitFor(() => expect(result.current.error).toBe('확인하지 못했습니다'));
    expect(eventsOf(queryClient)[0]?.event.acks).toBeUndefined();
  });

  it('끊겨 있어도 서버가 4xx 로 거절하면 확인을 쓰지 않는다', async () => {
    linkDown();
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [raised]);
    ackReplies(() => problem(409, 'EVENT_RESOLVED'));
    const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });

    act(() => result.current.ack(1));
    await waitFor(() => expect(result.current.error).toBe('이미 해소된 이벤트입니다'));
    expect(eventsOf(queryClient)[0]?.event.acks).toBeUndefined();
  });

  it('끊겨 있어도 REST 가 성공하면 응답을 그대로 반영한다(임시 확인을 쓰지 않는다)', async () => {
    linkDown();
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [raised]);
    ackReplies(() => HttpResponse.json(acked));
    const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });

    act(() => result.current.ack(1));
    await waitFor(() => expect(eventsOf(queryClient)[0]?.event.acks).toHaveLength(1));
    expect(eventsOf(queryClient)[0]?.event.acks?.[0]?.ack_id).toBe('srv-1');
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)?.pendingAcks).toBeUndefined();
  });

  it('열람 계정이면 끊겨 있어도 확인을 쓰지 않는다', async () => {
    linkDown();
    signInAs('viewer', 'VIEWER');
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [raised]);
    ackReplies(() => HttpResponse.error());
    const { result } = renderHook(() => useAckEvent(EVENT), { wrapper });

    act(() => result.current.ack(1));
    await waitFor(() => expect(result.current.error).toBe('서버에 연결할 수 없습니다'));
    expect(eventsOf(queryClient)[0]?.event.acks).toBeUndefined();
  });
});
