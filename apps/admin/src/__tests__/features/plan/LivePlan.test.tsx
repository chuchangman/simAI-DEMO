import { useEventClearStore } from '@/features/events/eventClear.store';
import { applyEvents, LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { LivePlan } from '@/features/plan/LivePlan';
import type { PlanMarks } from '@/features/plan/plan';
import { ROOM_BOUNDS } from '@/features/plan/plan';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T = 1_760_342_400_000;

vi.mock('@/lib/api', () => ({ api: vi.fn(() => Promise.reject(new Error('no api in test'))) }));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: undefined, failed: false }),
}));
vi.mock('@/features/plan/usePlanBackdrop', () => ({
  usePlanBackdrop: () => ({ bounds: ROOM_BOUNDS, backdrop: undefined }),
}));
// 캔버스를 그리지 않고, 평면이 받은 표시(marks)에 든 사람만 적는다.
vi.mock('@/features/plan/FloorPlan', () => ({
  FloorPlan: ({ marks }: { marks: PlanMarks }) => (
    <output aria-label="표시된 사람">{[...marks.people.keys()].join(',')}</output>
  ),
}));

function item(change: Partial<EventItem> = {}): EventItem {
  return {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: ['w-0015'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const shown = () => screen.getByLabelText('표시된 사람').textContent;

beforeEach(() => {
  localStorage.clear();
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role: 'ADMIN' } });
});
afterEach(() => {
  cleanup();
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

describe('LivePlan 모두 지우기', () => {
  it('지운 경보는 평면 표시에서도 빠지고, 지운 뒤에 생긴 경보만 남는다', async () => {
    const queryClient = new QueryClient();
    applyEvents(queryClient, [item()]);
    queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => ({ ...old!, loaded: true }));
    render(
      <QueryClientProvider client={queryClient}>
        <LivePlan selectedKey={null} />
      </QueryClientProvider>,
    );
    expect(shown()).toBe('w-0015');

    act(() => useEventClearStore.getState().clearAll(T));
    expect(shown()).toBe('');

    act(() =>
      applyEvents(queryClient, [
        item({
          event_id: 'e-2',
          world_ids: ['w-0021'],
          raised_at: T + 1_000,
          updated_at: T + 1_000,
        }),
      ]),
    );
    await waitFor(() => expect(shown()).toBe('w-0021'));
  });
});
