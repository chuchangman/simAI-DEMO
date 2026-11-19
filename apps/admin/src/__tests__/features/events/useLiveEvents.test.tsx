import { EVENTS_PAGE_SIZE } from '@/features/events/api';
import {
  applyEvents,
  bindEventsCache,
  LIVE_EVENTS_KEY,
  type LiveEvents,
} from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { useLiveEvents } from '@/features/events/useLiveEvents';
import { riskEventsBetween } from '@/mocks/realtimeScenario';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeRealtime } from './fakeRealtime';

// 앱의 api 인스턴스는 import.meta.env 를 읽는다(CONVENTION 테스트). 같은 createHttp 로 시험 주소를 쓴다.
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const BASE = 'http://api.test';
const payloads = riskEventsBetween(0, 40_000).map((m) => m.payload);
const edgeRaised = payloads.find((e) => e.rule_id === 'R2')!;
const zoneRaised = payloads.find((e) => e.rule_id === 'R1' && e.world_ids[0] === 'w-0015')!;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const dataOf = (queryClient: QueryClient) => queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY);

describe('useLiveEvents', () => {
  it('STOMP 가 먼저 캐시를 채웠어도 목록을 받아 합친다', async () => {
    server.use(http.get(`${BASE}/api/events`, () => HttpResponse.json({ content: [zoneRaised] })));
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [edgeRaised]);

    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.entries.map((e) => e.event.rule_id).sort()).toEqual(['R1', 'R2']);
    expect(result.current.failed).toBe(false);
  });

  it('목록을 못 받으면 failed 이고, 그 뒤 STOMP 가 와도 가려지지 않는다', async () => {
    server.use(
      http.get(`${BASE}/api/events`, () => HttpResponse.json({ message: 'down' }, { status: 503 })),
    );
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => applyEvents(queryClient, [edgeRaised]));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.loaded).toBe(false);
    expect(result.current.failed).toBe(true);
  });

  it('열람 계정(403)은 받을 목록이 없을 뿐이다. 실패가 아니고 다시 시도하지 않으며 STOMP 로 받은 것은 둔다', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/events`, () => {
        calls++;
        return HttpResponse.json(
          { status: 403, detail: '권한이 없습니다', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }),
    );
    const { queryClient, wrapper } = setup();
    applyEvents(queryClient, [edgeRaised]);

    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.failed).toBe(false);
    expect(result.current.entries.map((e) => e.event.rule_id)).toEqual(['R2']);

    // 이후 STOMP 도 그대로 반영되고, 목록을 다시 받으러 가지 않는다.
    act(() => applyEvents(queryClient, [zoneRaised]));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.failed).toBe(false);
    expect(calls).toBe(1);
  });

  it('403 이 아닌 4xx 는 실패로 본다', async () => {
    server.use(
      http.get(`${BASE}/api/events`, () =>
        HttpResponse.json({ status: 400, detail: '잘못된 요청' }, { status: 400 }),
      ),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.loaded).toBe(false);
  });

  it('진행 중 이벤트가 둘째 쪽에 있어도 받아 합친다', async () => {
    const resolved = (i: number): EventItem => ({
      ...zoneRaised,
      event_id: `old-${i}`,
      lifecycle: 'RESOLVED',
    });
    // 첫 쪽: 해소 99건 + 방금 난 진행 중 하나, 둘째 쪽: 진행 중 R2 하나.
    const first = [
      ...Array.from({ length: EVENTS_PAGE_SIZE - 1 }, (_, i) => resolved(i)),
      zoneRaised,
    ];
    server.use(
      http.get(`${BASE}/api/events`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json({
          content: page === 0 ? first : [edgeRaised],
          totalElements: EVENTS_PAGE_SIZE + 1,
          number: page,
          size: EVENTS_PAGE_SIZE,
        });
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.entries.some((e) => e.event.event_id === edgeRaised.event_id)).toBe(true);
  });
});

describe('재연결 뒤 목록 다시 받기', () => {
  it('연결이 다시 열리면 목록을 다시 받고, 받는 사이 STOMP 로 온 이벤트는 지워지지 않는다', async () => {
    let responses: EventItem[][] = [[edgeRaised]];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 첫 목록은 바로 주고, 다시 받는 목록만 풀어 줄 때까지 미룬다.
    let hold = false;
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/events`, async () => {
        calls++;
        if (hold) await gate;
        return HttpResponse.json({ content: responses.shift() ?? [] });
      }),
    );
    const { queryClient, wrapper } = setup();
    const realtime = fakeRealtime();
    bindEventsCache(realtime, queryClient);
    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls).toBe(1);

    // 끊겼다 다시 열렸다. 서버 목록은 응답을 미뤄 둔 채 그 사이 STOMP 로 새 이벤트가 온다.
    const newer: EventItem = {
      ...edgeRaised,
      lifecycle: 'RESOLVED',
      event_sequence: (edgeRaised.event_sequence ?? 0) + 2,
      resolved_at: 1,
    };
    hold = true;
    responses = [[{ ...edgeRaised, event_sequence: (edgeRaised.event_sequence ?? 0) + 1 }]];
    act(() => realtime.emit('open'));
    await waitFor(() => expect(result.current.loaded).toBe(false));
    await waitFor(() => expect(calls).toBe(2));
    act(() => {
      applyEvents(queryClient, [newer, zoneRaised]);
    });
    release();

    await waitFor(() => expect(result.current.loaded).toBe(true));
    const byRule = Object.fromEntries(
      result.current.entries.map((e) => [e.event.rule_id, e.event]),
    );
    // 목록의 오래된 상태가 STOMP 로 먼저 온 더 새 상태를 덮지 않고, 목록에 없던 이벤트도 남는다.
    expect(byRule.R2?.lifecycle).toBe('RESOLVED');
    expect(byRule.R1?.event_id).toBe(zoneRaised.event_id);
    expect(dataOf(queryClient)?.entries).toHaveLength(2);
  });

  it('다시 받은 목록의 새 확인 기록과 상태를 반영한다', async () => {
    const acked: EventItem = {
      ...edgeRaised,
      event_sequence: (edgeRaised.event_sequence ?? 0) + 1,
      acks: [
        {
          ack_id: 'srv-1',
          channel: 'CONTROL_ROOM',
          actor_role: 'ADMIN',
          actor_id: 'admin',
          acked_at: 20_000,
        },
      ],
    };
    const responses = [[edgeRaised], [acked]];
    server.use(
      http.get(`${BASE}/api/events`, () => HttpResponse.json({ content: responses.shift() ?? [] })),
    );
    const { queryClient, wrapper } = setup();
    const realtime = fakeRealtime();
    bindEventsCache(realtime, queryClient);
    const { result } = renderHook(() => useLiveEvents(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.entries[0]?.event.acks).toBeUndefined();

    act(() => realtime.emit('open'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.entries[0]?.event.acks?.map((a) => a.ack_id)).toEqual(['srv-1']);
  });
});
