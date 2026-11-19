import { EventDetail } from '@/features/events/EventDetail';
import { groupIncidents, mergeEvent, type EventEntry } from '@/features/events/events';
import { bindEventsCache, LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import type { RiskEventMessage } from '@simai/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRealtime } from './fakeRealtime';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const T = 1_760_342_400_000;
const EVENT_ID = '0192a6f0-7c1e-7b3a-9f2d-000000000598';
const RATIONALE = '작업자가 개구부 가장자리에 서 있고 안전난간이 보이지 않는다.';

function makeEvent(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: EVENT_ID,
    event_sequence: 2,
    rule_id: 'R1',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'HIGH',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0015'],
    zone_id: 'z-02',
    metrics: { zone_distance_m: 0 },
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const server = setupServer(
  http.get('http://api.test/api/events/:id/clips', () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  useSessionStore.getState().signIn({
    accessToken: 'mock-token.viewer',
    user: { id: 'viewer', role: 'VIEWER' },
  });
  useRealtimeStore.getState().reset();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});
afterAll(() => server.close());

/** LIVE_EVENTS_KEY 캐시를 STOMP(riskEvent)로 갱신하면 다시 그려지는 상세 화면. */
function renderLiveDetail(initial: EventEntry) {
  const queryClient = new QueryClient();
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, { entries: [initial], loaded: true });
  const realtime = fakeRealtime();
  bindEventsCache(realtime, queryClient);

  function ConnectedDetail() {
    const { data } = useQuery<LiveEvents>({
      queryKey: LIVE_EVENTS_KEY,
      queryFn: () => queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!,
      staleTime: Infinity,
    });
    const incident = groupIncidents(data?.entries ?? [initial])[0]!;
    return <EventDetail incident={incident} openEventId={EVENT_ID} onClose={vi.fn()} />;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedDetail />
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: '사건 상세' });
  const emit = (event: EventItem) =>
    act(() => realtime.emit('riskEvent', event as unknown as RiskEventMessage['payload'], 0));
  return {
    emit,
    ai: within(dialog).getByRole('region', { name: 'AI 설명' }),
    rules: within(dialog).getByRole('region', { name: '규칙과 근거' }),
    cached: () => queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!.entries[0]!.event,
  };
}

describe('같은 순번의 VLM 근거 반영(S15P31A101-598)', () => {
  it('같은 순번에 rationale 만 달라지면 상세 AI 설명에 근거를 그리고 등급은 그대로 둔다', async () => {
    const view = renderLiveDetail(mergeEvent(undefined, makeEvent()));
    expect(within(view.ai).queryByText(RATIONALE)).toBeNull();
    expect(within(view.rules).getByText('경고')).toBeTruthy();

    // 서버는 근거 저장 뒤 같은 event_sequence 로 다시 발행한다. 등급 칸이 달라도 순번 규칙상 받지 않는다.
    view.emit(makeEvent({ rationale: RATIONALE, severity: 'CRITICAL', lifecycle: 'UPDATED' }));

    await waitFor(() => expect(within(view.ai).getByText(RATIONALE)).toBeTruthy());
    expect(within(view.rules).getByText('경고')).toBeTruthy();
    expect(view.cached().severity).toBe('HIGH');
    expect(view.cached().lifecycle).toBe('RAISED');
  });

  it('낮은 순번으로 온 근거는 무시한다', () => {
    const view = renderLiveDetail(mergeEvent(undefined, makeEvent()));
    view.emit(makeEvent({ event_sequence: 1, rationale: RATIONALE }));
    expect(within(view.ai).queryByText(RATIONALE)).toBeNull();
    expect(view.cached().rationale).toBeNull();
  });
});
