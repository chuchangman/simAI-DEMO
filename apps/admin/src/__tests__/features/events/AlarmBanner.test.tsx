import { ANY_CAMERA, useCamSplitStore } from '@/features/cctv/camSplit.store';
import { AlarmBanner } from '@/features/events/AlarmBanner';
import { useEventClearStore } from '@/features/events/eventClear.store';
import type { EventEntry } from '@/features/events/events';
import { useEventsStore } from '@/features/events/events.store';
import { ZONES_KEY } from '@/features/zones/api';
import { MOCK_ZONES } from '@/mocks/zones';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import type { WorldStatePayload } from '@simai/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const T = 1_760_342_400_000;

const live = vi.hoisted(() => ({ entries: [] as EventEntry[] }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: live.entries, loaded: true, failed: false }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const alarm: EventEntry = {
  event: {
    event_id: 'e-1',
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
  },
  stageStartedAt: T,
};

function renderBanner(withPanel: boolean) {
  const client = new QueryClient();
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  render(
    <QueryClientProvider client={client}>
      <AlarmBanner withPanel={withPanel} />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name: '확인 대기 경보' });
}

beforeEach(() => {
  live.entries = [alarm];
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
  navigate.mockReset();
  useCamSplitStore.getState().close();
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role: 'ADMIN' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSessionStore.setState(useSessionStore.getInitialState(), true);
  useEventsStore.setState(useEventsStore.getInitialState(), true);
  useEventClearStore.setState({ clearedAt: null, clearedBy: null });
});

describe('AlarmBanner', () => {
  it('지금 Tier 0 가 들고 있지 않은 지난 관제 경보는 배너에 없다(S15P31A101-595)', () => {
    live.entries = [
      { ...alarm, event: { ...alarm.event, held_by_tier0: false } },
      {
        ...alarm,
        event: { ...alarm.event, event_id: 'e-2', severity: 'HIGH', held_by_tier0: true },
      },
    ];
    const banner = renderBanner(true);
    expect(banner.textContent).not.toContain('+1');
    expect(within(banner).getByText('경고')).toBeTruthy();
  });

  it('깜빡이는 테두리는 배너 전체를 덮지만 클릭을 가로채지 않는다(버튼이 눌린다)', () => {
    const banner = renderBanner(true);
    const blink = [...banner.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find((el) =>
      el.className.includes('animate-alarm-blink'),
    );
    expect(blink?.className).toContain('absolute');
    expect(blink?.className).toContain('pointer-events-none');
  });

  it.each([
    ['CRITICAL', 'ring-sev-critical', 'ring-sev-high'],
    ['HIGH', 'ring-sev-high', 'ring-sev-critical'],
  ] as const)('깜빡이는 테두리는 경보 등급 %s 의 색(%s)이다', (severity, ring, other) => {
    live.entries = [{ ...alarm, event: { ...alarm.event, severity } }];
    const banner = renderBanner(true);
    const blink = [...banner.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find((el) =>
      el.className.includes('animate-alarm-blink'),
    );
    expect(blink?.className).toContain(ring);
    expect(blink?.className).not.toContain(other);
  });

  it('상세를 누르면 그 이벤트를 열고, 이벤트 패널이 없는 화면이면 실시간 관제로 간다', () => {
    const banner = renderBanner(false);
    fireEvent.click(within(banner).getByRole('button', { name: '상세' }));

    expect(useEventsStore.getState().openEventId).toBe('e-1');
    expect(navigate).toHaveBeenCalledWith({ to: '/live' });
  });

  it('이벤트 패널이 있는 화면에서는 그 자리에서 상세를 연다', () => {
    const banner = renderBanner(true);
    fireEvent.click(within(banner).getByRole('button', { name: '상세' }));

    expect(useEventsStore.getState().openEventId).toBe('e-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('등급 배지, 규칙 · 대상 · 구역, 발생 뒤 경과를 이벤트 카드와 같은 규칙으로 보인다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T + 12_000);
    const banner = renderBanner(true);

    expect(within(banner).getByText('위험')).toBeTruthy();
    expect(within(banner).getByRole('alert').textContent).toBe(
      '추락 위험(가장자리) · 작업자 #0015 · 개구부 구역',
    );
    // 사람은 끝번호만 보이고 전체 ID 는 올려 보면 나온다. 고정폭 글꼴도 쓰지 않는다.
    const person = within(banner).getByText('작업자 #0015');
    expect(person.getAttribute('title')).toBe('w-0015');
    expect(person.className).not.toContain('font-mono');
    // 경과는 낭독 영역(role=alert) 밖에 둔다.
    expect(within(banner).getByText('12초 전').closest('[role="alert"]')).toBeNull();
    // 개구부 수치 같은 근거 줄은 배너에 없다.
    expect(banner.textContent).not.toContain('가장자리 0');
  });

  it('사람이 없는 경보는 구역 이름이 대상이고, 이름을 모르는 구역은 `구역`이며 구역 번호는 보이지 않는다', () => {
    live.entries = [{ ...alarm, event: { ...alarm.event, world_ids: [] } }];
    const named = renderBanner(true);
    expect(within(named).getByRole('alert').textContent).toBe('추락 위험(가장자리) · 개구부 구역');
    expect(within(named).getByRole('button', { name: /개구부 구역 확인/ })).toBeTruthy();
    cleanup();

    live.entries = [{ ...alarm, event: { ...alarm.event, world_ids: [], zone_id: 'z-99' } }];
    expect(within(renderBanner(true)).getByRole('alert').textContent).toBe(
      '추락 위험(가장자리) · 구역',
    );
    cleanup();

    live.entries = [{ ...alarm, event: { ...alarm.event, zone_id: 'z-99' } }];
    const person = renderBanner(true);
    expect(within(person).getByRole('alert').textContent).toBe(
      '추락 위험(가장자리) · 작업자 #0015',
    );
    expect(person.textContent).not.toMatch(/z-\d/);
  });

  it('확인 대기 경보가 더 있으면 「확인 대기 외 N건」을 보이고 가장 높은 등급이 먼저다', () => {
    const second: EventEntry = {
      stageStartedAt: T,
      event: {
        ...alarm.event,
        event_id: 'e-2',
        rule_id: 'R1',
        severity: 'HIGH',
        world_ids: ['w-0021'],
      },
    };
    live.entries = [second, alarm];
    const banner = renderBanner(true);

    // 「+N」은 뜻을 몰랐다(S15P31A101-731). 무엇이 더 있는지 글자로 적는다
    expect(within(banner).queryByText('+1')).toBeNull();
    expect(within(banner).getByText('확인 대기 외 1건').getAttribute('title')).toContain('1건 더');
    expect(within(banner).getByRole('alert').textContent).toContain('0015');
  });

  it('확인 버튼은 확인 대기 경보에만 있고, 확인을 누를 수 있다', () => {
    const banner = renderBanner(true);
    // 확인 버튼의 이름은 「규칙 대상 확인」이다. 같은 낱말로 끝나는 카메라 버튼은 거른다.
    const isAck = (name: string) => name.endsWith(' 확인') && !name.startsWith('CCTV');
    expect(within(banner).getByRole('button', { name: isAck })).toBeTruthy();
    expect(within(banner).queryByRole('button', { name: '소리 켜기' })).toBeNull();
  });

  it('CCTV 버튼은 이벤트 패널이 있는 화면에만 있고, 사람을 담은 카메라가 있어도 이름 없이 첫 카메라를 연다', () => {
    useRealtimeStore.setState({
      world: {
        receivedAt: T,
        payload: {
          tracks: [{ world_id: 'w-0015', cameras: ['cam_C'] }],
        } as unknown as WorldStatePayload,
      },
    });
    const withPanel = renderBanner(true);
    fireEvent.click(within(withPanel).getByRole('button', { name: 'CCTV로 확인' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(useCamSplitStore.getState().split?.cam).toBe(ANY_CAMERA);
    cleanup();

    const without = renderBanner(false);
    expect(within(without).queryByRole('button', { name: /로 확인/ })).toBeNull();
  });

  it('해석된 사람 표시 이름이 있으면 배너와 확인 버튼 이름에 표시 이름을 쓴다(-658)', () => {
    useRealtimeStore.setState({
      health: {
        receivedAt: T,
        clockOffsetMs: 0,
        payload: {
          person_names: [
            { world_id: 'w-0015', display_name: '김철수', name_source: 'WATCH_DEVICE' },
          ],
        } as never,
      },
    });
    const banner = renderBanner(true);
    expect(within(banner).getByRole('alert').textContent).toBe(
      '추락 위험(가장자리) · 김철수 · 개구부 구역',
    );
    expect(
      within(banner).getByRole('button', { name: '추락 위험(가장자리) 김철수 (w-0015) 확인' }),
    ).toBeTruthy();
  });
});

describe('AlarmBanner 모두 지우기', () => {
  const bannerOrNull = () => screen.queryByRole('group', { name: '확인 대기 경보' });
  const second: EventEntry = {
    stageStartedAt: T + 5_000,
    event: {
      ...alarm.event,
      event_id: 'e-2',
      rule_id: 'R1',
      severity: 'HIGH',
      world_ids: ['w-0021'],
      raised_at: T + 5_000,
      updated_at: T + 5_000,
    },
  };

  it('지우면 배너가 바로 사라진다', () => {
    renderBanner(true);
    expect(bannerOrNull()).toBeTruthy();

    act(() => useEventClearStore.getState().clearAll(T));
    expect(bannerOrNull()).toBeNull();
  });

  it('이미 지운 경보는 새로 열어도 배너에 없다', () => {
    useEventClearStore.getState().clearAll(T);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AlarmBanner withPanel />
      </QueryClientProvider>,
    );
    expect(bannerOrNull()).toBeNull();
  });

  it('지운 뒤에 생긴 경보는 배너에 뜨고, 지운 경보는 +N 에 세지 않는다', () => {
    useEventClearStore.getState().clearAll(T);
    live.entries = [alarm, second];
    const banner = renderBanner(true);

    expect(within(banner).getByRole('alert').textContent).toContain('0021');
    expect(within(banner).queryByText('+1')).toBeNull();
  });

  it('다른 사용자가 지운 기록은 적용하지 않아 경보가 그대로 뜬다', () => {
    useEventClearStore.getState().clearAll(T);
    useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'other', role: 'ADMIN' } });
    const banner = renderBanner(true);
    expect(within(banner).getByRole('alert').textContent).toContain('0015');
  });

  it('지운 뒤에 새 단계가 열린 경보는 다시 뜬다', () => {
    useEventClearStore.getState().clearAll(T);
    live.entries = [{ ...alarm, stageStartedAt: T + 5_000 }];
    const banner = renderBanner(true);
    expect(within(banner).getByRole('alert').textContent).toContain('0015');
  });
});
