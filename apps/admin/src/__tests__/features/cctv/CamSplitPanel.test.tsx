import { ANY_CAMERA, useCamSplitStore } from '@/features/cctv/camSplit.store';
import { CamSplitPanel } from '@/features/cctv/CamSplitPanel';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { mergeEvent } from '@/features/events/entries';
import { LIVE_EVENTS_KEY } from '@/features/events/eventsCache';
import type { EventItem } from '@/features/events/types';
import { ZONES_KEY } from '@/features/zones/api';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import { MOCK_ZONES } from '@/mocks/zones';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore, type Role } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 현장 노트북 중계(WebSocket·WebCodecs)는 붙이지 않는다. 연결·카메라 단계는 cctv.store 에 직접 넣는다.
vi.mock('@/lib/env', () => ({
  env: { VITE_CCTV_PREVIEW_URL: 'ws://127.0.0.1:47032', VITE_STOMP_URL: 'wss://simai.live/ws' },
}));
vi.mock('@/features/cctv/useCctvPreview', () => ({ useCctvPreview: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

const T = 1_760_342_400_000;
// 실제 중계·Tier 0 health 가 쓰는 카메라 이름이다(관제 데모의 cam_A~cam_D 가 아니다).
const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

const attach = vi.fn();
const connected = vi.fn();
const disconnected = vi.fn();

function signIn(role: Role) {
  useSessionStore.setState({ session: { accessToken: 'token', user: { id: role, role } } });
}

/** 지금 막 받은 health(카메라 ids)와 world 를 넣는다. 둘 다 최근이라 EC2 와 이어져 있고 World 도 들어온다. */
function seedRealtime(ids: string[] = CAMS, tier0: 'CONNECTED' | 'DISCONNECTED' = 'CONNECTED') {
  const now = Date.now();
  useRealtimeStore.setState({
    phase: 'OPEN',
    openedAt: now,
    health: {
      payload: {
        ...viewerHealthAt(T).payload,
        as_of: now,
        tier0_link: tier0,
        tier0_health: { cameras: ids.map((id) => ({ id, status: 'OK', last_capture: now })) },
      } as never,
      receivedAt: now,
      clockOffsetMs: 0,
    },
    world: { payload: { tracks: [] } as never, receivedAt: now },
  });
}

/** 중계가 열려 카메라를 알렸다. */
function openRelay(ids: string[] = CAMS) {
  const store = useCctvStore.getState();
  store.setLink('open');
  store.hello(ids);
}

/** 지금 들어와 있는 이벤트(사건 요약이 읽는다). 구역은 늘 받아 둔 상태다. */
function renderPanel(events: EventItem[] = []) {
  const client = new QueryClient();
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  if (events.length > 0) {
    client.setQueryData(LIVE_EVENTS_KEY, {
      entries: events.map((item) => mergeEvent(undefined, item)),
      loaded: true,
    });
  }
  return render(
    <QueryClientProvider client={client}>
      <CamSplitPanel />
    </QueryClientProvider>,
  );
}

function raised(change: Partial<EventItem> = {}): EventItem {
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
    world_ids: ['w-0012'],
    zone_id: 'z-04',
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  };
}

const openSplit = (cam: string) =>
  act(() => useCamSplitStore.getState().open({ cam, target: { type: 'person', id: 'w-0012' } }));

const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

beforeEach(() => {
  useCctvStore.getState().reset();
  signIn('ADMIN');
  // 연결(마운트)과 끊기(언마운트)를 세어, 탭을 바꿔도 같은 연결을 쓰는지 본다.
  vi.mocked(useCctvPreview).mockImplementation(() => {
    useEffect(() => {
      connected();
      return disconnected;
    }, []);
    return { attach, resume: vi.fn() };
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(useCctvPreview).mockReset();
  attach.mockClear();
  connected.mockClear();
  disconnected.mockClear();
  act(() => useCamSplitStore.getState().close());
  useCctvStore.getState().reset();
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSessionStore.setState({ session: undefined });
});

describe('CamSplitPanel 관리자', () => {
  beforeEach(() => {
    seedRealtime();
    openRelay();
  });

  it('중계가 알린 카메라로 탭을 만들고 누른 카메라의 실영상을 그린다', () => {
    openSplit('cam_B');
    renderPanel();

    expect(tabs()).toEqual(['카메라 1', '카메라 2', '카메라 3', '카메라 4']);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('카메라 2');
    const canvas = screen.getByLabelText('카메라 2 영상');
    expect(canvas.tagName).toBe('CANVAS');
    expect(attach).toHaveBeenCalledWith('cam_B', canvas);
    // 모의 그림은 없다.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('영상 칸에서 휠을 굴리면 영상이 확대되고 작은 지도가 뜬다', () => {
    openSplit('cam_B');
    renderPanel();
    const canvas = screen.getByLabelText('카메라 2 영상');
    expect(canvas.style.transform).toBe('');

    // 패널 칸(영상의 부모)도 jsdom 에는 크기가 없어 800×450 으로 흉내 낸다.
    vi.spyOn(canvas.parentElement!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    } as DOMRect);
    fireEvent.wheel(canvas.parentElement!, { deltaY: -500, clientX: 400, clientY: 225 });

    expect(canvas.style.transform).toMatch(/^translate\(.+\) scale\(.+\)$/);
    expect(screen.getByRole('img', { name: '확대한 자리' })).toBeTruthy();
  });

  it('사건 요약은 사람은 ID, 구역은 이름으로 보이고 구역 번호는 보이지 않는다', () => {
    openSplit('cam_A');
    renderPanel([raised()]);

    expect(screen.getByText('w-0012').className).toContain('font-mono');
    expect(screen.getByText('추락 위험(가장자리) · 개구부 구역')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/z-\d/);
  });

  it('구역이 대상인 사건 요약은 구역 이름이 제목이고 규칙 줄에서 되풀이하지 않는다', () => {
    act(() =>
      useCamSplitStore.getState().open({ cam: 'cam_A', target: { type: 'zone', id: 'z-04' } }),
    );
    renderPanel([raised({ world_ids: [] })]);

    expect(screen.getByText('개구부 구역').className).not.toContain('font-mono');
    expect(screen.getByText('추락 위험(가장자리)')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/z-\d/);
  });

  it('목록에 없는 카메라를 요청하면 첫 카메라를 보인다', () => {
    openSplit('cam_X');
    renderPanel();

    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('카메라 1');
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
  });

  it('어느 카메라인지 모르면(ANY_CAMERA) 중계가 알린 현장 목록의 첫 카메라를 보인다', () => {
    openRelay(['cam_C', 'cam_A', 'cam_D', 'cam_B']);
    openSplit(ANY_CAMERA);
    renderPanel();

    expect(tabs()).toEqual(['카메라 1', '카메라 2', '카메라 3', '카메라 4']);
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('카메라 1');
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
  });

  it('탭을 바꾸면 그 카메라 영상으로 바뀌지만 중계 연결은 그대로다', () => {
    openSplit('cam_A');
    renderPanel();
    const first = screen.getByLabelText('카메라 1 영상');
    expect(connected).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: /카메라 3/ }));

    expect(screen.queryByLabelText('카메라 1 영상')).toBeNull();
    const next = screen.getByLabelText('카메라 3 영상');
    expect(attach).toHaveBeenCalledWith('cam_A', null);
    expect(attach).toHaveBeenCalledWith('cam_C', next);
    expect(first.isConnected).toBe(false);
    expect(connected).toHaveBeenCalledTimes(1);
    expect(disconnected).not.toHaveBeenCalled();
  });

  it('패널을 닫으면 중계를 끊는다', () => {
    openSplit('cam_A');
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /CCTV 닫기/ }));
    expect(useCamSplitStore.getState().split).toBeNull();
    expect(disconnected).toHaveBeenCalledTimes(1);
  });
});

describe('CamSplitPanel 관리자 · 중계가 이어지지 않았을 때', () => {
  it('그림 없이 Tier 0 카메라로 탭을 만들고, 칸 오른쪽 위에 그 카메라의 판정 지연을 보인다', () => {
    seedRealtime();
    useRealtimeStore.setState({ lagSamples: [{ at: 0, lagMs: 150, cameras: { cam_C: 180 } }] });
    useCctvStore.getState().setLink('unavailable');
    openSplit('cam_C');
    renderPanel();

    expect(tabs()).toEqual(['카메라 1', '카메라 2', '카메라 3', '카메라 4']);
    expect(screen.getByLabelText('카메라 3 판정 지연 180 ms').textContent).toBe('판정 180 ms');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('카메라를 하나도 알 수 없으면 안내 한 줄만 보인다', () => {
    seedRealtime(CAMS, 'DISCONNECTED');
    openSplit('cam_A');
    renderPanel();

    expect(screen.getByRole('status').textContent).toBe('카메라 상태를 받지 못했습니다');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(document.querySelector('canvas')).toBeNull();
  });
});

describe.each(['FOREMAN', 'VIEWER'] as const)('CamSplitPanel %s', (role) => {
  beforeEach(() => signIn(role));

  it('영상 없이 카메라 상태만 보이고 중계에 붙지 않는다', () => {
    seedRealtime();
    openRelay();
    openSplit('cam_B');
    renderPanel();

    expect(vi.mocked(useCctvPreview)).not.toHaveBeenCalled();
    expect(document.querySelector('canvas')).toBeNull();
    expect(tabs()).toEqual(['카메라 1', '카메라 2', '카메라 3', '카메라 4']);
    expect(screen.getByRole('group', { name: '카메라 2 상태' }).textContent).toContain('실시간');
  });
});
