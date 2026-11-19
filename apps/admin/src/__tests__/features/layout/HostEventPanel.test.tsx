import { useEventClearStore } from '@/features/events/eventClear.store';
import { applyEvents, LIVE_EVENTS_KEY, type LiveEvents } from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { HostEventPanel } from '@/features/layout/spatialHost/HostEventPanel';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T = 1_760_342_400_000;

const apiCall = vi.hoisted(() => vi.fn(() => Promise.reject(new Error('no api in test'))));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiCall }));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: undefined, failed: false }),
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

/** 목록을 받은 상태의 캐시. useLiveEvents 는 받은 목록이면 다시 요청하지 않는다. */
function renderHost() {
  const queryClient = new QueryClient();
  applyEvents(queryClient, [
    item(),
    item({ event_id: 'e-2', world_ids: ['w-0021'], severity: 'HIGH' }),
  ]);
  queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => ({ ...old!, loaded: true }));
  render(
    <QueryClientProvider client={queryClient}>
      <HostEventPanel visible selectedKey={null} onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const clearButton = () => screen.getByRole('button', { name: '목록에서 숨기기' });
/** 「목록에서 숨기기」를 누르고, 미확인 경보가 있어 확인 창이 뜨면 「숨기기」로 넘긴다(S15P31A101-731). */
const hideAll = () => {
  fireEvent.click(clearButton());
  const dialog = screen.queryByRole('dialog', { name: '목록에서 숨길까요?' });
  if (dialog) fireEvent.click(within(dialog).getByRole('button', { name: '숨기기' }));
};
const cards = () => screen.queryAllByRole('article');
const cardNames = () => cards().map((card) => card.getAttribute('aria-label'));

beforeEach(() => {
  localStorage.clear();
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role: 'ADMIN' } });
  apiCall.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

describe('HostEventPanel 목록에서 숨기기(옛 모두 지우기)', () => {
  it('누르면 목록이 비고 서버는 부르지 않으며 이벤트 캐시는 그대로다', () => {
    const queryClient = renderHost();
    const before = queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)!;
    expect(cards()).toHaveLength(2);

    hideAll();

    expect(cards()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '목록에서 숨기기' })).toBeNull();
    expect(screen.getByRole('button', { name: '이벤트 펼치기' })).toBeTruthy();
    expect(apiCall).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<LiveEvents>(LIVE_EVENTS_KEY)).toBe(before);
    expect(before.entries).toHaveLength(2);
  });

  it('지운 시각은 목록에서 가장 늦게 시작된 경보의 시각이고 지운 사용자를 함께 남긴다', async () => {
    const queryClient = renderHost();
    act(() =>
      applyEvents(queryClient, [
        item({
          event_id: 'e-3',
          world_ids: ['w-0030'],
          raised_at: T + 7_000,
          updated_at: T + 7_000,
        }),
      ]),
    );
    await waitFor(() => expect(cards()).toHaveLength(3));
    hideAll();
    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: T + 7_000, clearedBy: 'u' });
  });

  it('브라우저 시계가 하루 빨라도 지운 뒤에 생긴 경보는 숨지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T + 86_400_000);
    const queryClient = renderHost();
    hideAll();
    expect(useEventClearStore.getState().clearedAt).toBe(T);

    act(() =>
      applyEvents(queryClient, [
        item({
          event_id: 'e-3',
          world_ids: ['w-0030'],
          raised_at: T + 20_000,
          updated_at: T + 20_000,
        }),
      ]),
    );
    await waitFor(() => expect(cardNames()).toEqual(['w-0030 이벤트']));
  });

  it('시각을 아는 경보가 하나도 없으면 아무것도 지우지 않는다', () => {
    const queryClient = new QueryClient();
    applyEvents(queryClient, [item({ raised_at: undefined, updated_at: undefined })]);
    queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => ({ ...old!, loaded: true }));
    render(
      <QueryClientProvider client={queryClient}>
        <HostEventPanel visible selectedKey={null} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );

    hideAll();

    expect(useEventClearStore.getState()).toMatchObject({ clearedAt: null, clearedBy: null });
    expect(cards()).toHaveLength(1);
  });

  it('지운 뒤에 생긴 이벤트만 다시 보인다', async () => {
    const queryClient = renderHost();
    hideAll();

    act(() =>
      applyEvents(queryClient, [
        item({
          event_id: 'e-3',
          world_ids: ['w-0030'],
          raised_at: T + 20_000,
          updated_at: T + 20_000,
        }),
      ]),
    );

    await waitFor(() => expect(cardNames()).toEqual(['w-0030 이벤트']));
    expect(clearButton()).toBeTruthy();
  });

  it('지운 뒤에 등급이 오른 이벤트는 새 단계로 다시 보인다', async () => {
    const queryClient = renderHost();
    hideAll();

    act(() =>
      applyEvents(queryClient, [
        item({
          event_id: 'e-2',
          event_sequence: 2,
          world_ids: ['w-0021'],
          lifecycle: 'UPDATED',
          severity: 'CRITICAL',
          updated_at: T + 20_000,
        }),
      ]),
    );

    await waitFor(() => expect(cardNames()).toEqual(['w-0021 이벤트']));
  });
});

describe('HostEventPanel 확인한 지 오래된 이벤트', () => {
  const HOUR = 3_600_000;
  const ack = (at: number) => ({
    ack_id: `a-${at}`,
    channel: 'CONTROL_ROOM',
    actor_role: 'ADMIN',
    actor_id: 'admin',
    acked_at: at,
  });
  /** 목록을 받은 상태의 캐시로 이벤트들을 그린다. */
  function renderEvents(events: EventItem[]) {
    const queryClient = new QueryClient();
    applyEvents(queryClient, events);
    queryClient.setQueryData<LiveEvents>(LIVE_EVENTS_KEY, (old) => ({ ...old!, loaded: true }));
    render(
      <QueryClientProvider client={queryClient}>
        <HostEventPanel visible selectedKey={null} onSelect={vi.fn()} />
      </QueryClientProvider>,
    );
  }
  const events = () => [
    // 확인한 지 25시간: 숨김
    item({ event_id: 'old', world_ids: ['w-0001'], acks: [ack(T)], updated_at: T }),
    // 확인한 지 23시간: 남음(1시간 뒤 숨김)
    item({
      event_id: 'recent',
      world_ids: ['w-0002'],
      acks: [ack(T + 2 * HOUR)],
      updated_at: T + 2 * HOUR,
    }),
    // 확인하지 않은 25시간 전 이벤트: 남음
    item({ event_id: 'unacked', world_ids: ['w-0003'], severity: 'HIGH' }),
  ];

  it('확인한 지 24시간이 지난 이벤트는 패널에서 빠지고 사건 수도 줄며, 확인하지 않은 이벤트는 남는다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T + 25 * HOUR);
    renderEvents(events());

    expect(cardNames()).toEqual(['w-0002 이벤트', 'w-0003 이벤트']);
    expect(screen.getByTestId('event-panel-head').textContent).toContain('진행 중 2건');
  });

  it('시간이 흘러 24시간을 넘기는 순간(분 단위) 목록에서 빠진다', () => {
    vi.useFakeTimers();
    // 'recent' 는 T+2h 에 확인했으니 T+26h 에 24시간이 찬다. 그 90초 전에서 시작한다.
    vi.setSystemTime(T + 26 * HOUR - 90_000);
    renderEvents(events());
    expect(cardNames()).toContain('w-0002 이벤트');

    act(() => void vi.advanceTimersByTime(2 * 60_000));

    expect(cardNames()).toEqual(['w-0003 이벤트']);
  });
});
