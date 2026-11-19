import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import { MonitorPage } from '@/features/monitor/MonitorPage';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import { worldStateAt } from '@/mocks/realtimeScenario';
import { useRealtimeStore } from '@/store/realtime.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ZONES_RAW = { contract: 'DEMO_UNCONFIRMED', zones: [] };

// 목록·구역은 이 시험의 관심 밖이다(앱 api 인스턴스는 import.meta.env 를 읽는다).
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: ZONES_RAW, failed: false }),
}));
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

type Phase = 'initializing' | 'ready' | 'error';

// 3D 뷰어 대역: 마운트마다 상태를 한 번 알린다(실제 뷰어처럼 콜백이 바뀌어도 다시 알리지 않는다).
// report 로 마지막에 뜬 뷰어가 나중에 상태를 알리게 한다(늦게 준비되는 3D). 화면에 뜨는 커밋 안에서 연결해
// 시험이 뷰어를 찾은 뒤 report 를 부르면 늘 그 뷰어에 닿는다.
const fake = vi.hoisted(() => ({
  phase: 'ready' as Phase,
  select: vi.fn(),
  resetView: vi.fn(),
  report: (() => undefined) as (phase: Phase) => void,
}));

function FakeViewer({ ref, onStatusChange }: Viewer3DProps) {
  useImperativeHandle(
    ref,
    () =>
      ({
        select: fake.select,
        resetView: fake.resetView,
        focus: () => ({ ok: true }),
        clearSelection: () => ({ ok: true }),
        setMode: () => ({ ok: true }),
      }) as unknown as Viewer3DHandle,
  );
  const reported = useRef(false);
  useLayoutEffect(() => {
    fake.report = (phase) =>
      onStatusChange?.({
        phase,
        mode: 'LIVE',
        error: phase === 'error' ? { code: 'RENDER_FAILED', message: 'x' } : null,
      } as ViewerStatus);
    if (reported.current) return;
    reported.current = true;
    fake.report(fake.phase);
  });
  return <div data-testid="viewer3d" />;
}

const loadFake = () => Promise.resolve({ default: FakeViewer });

function renderPage(loadViewer = loadFake, planFallbackMs?: number) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <SpatialViewportHost loadViewer={loadViewer} planFallbackMs={planFallbackMs}>
      <MonitorPage />
    </SpatialViewportHost>,
    { wrapper },
  );
}

const plan = () => screen.queryByRole('group', { name: '2D 평면' });
const button = (name: string) => screen.getByRole('button', { name });

describe('MonitorPage 3D·2D 전환', () => {
  beforeEach(() => {
    useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
    fake.phase = 'ready';
    fake.select.mockReset().mockImplementation(() => ({ ok: true }));
  });
  afterEach(cleanup);

  it('3D 가 정한 시간 안에 첫 화면을 그리지 못하면 준비될 때까지 2D 평면을 보이고, 빨리 준비되면 2D 를 비추지 않는다', async () => {
    fake.phase = 'initializing';
    renderPage(loadFake, 50);
    // 3D 를 띄우자마자 2D 를 비추지 않는다.
    expect(plan()).toBeNull();
    expect(await screen.findByTestId('viewer3d')).toBeTruthy();
    await vi.waitFor(() => expect(plan()).toBeTruthy());
    // 3D 는 아직 띄우는 중이라 다시 시도가 아니라 시점 초기화다.
    expect(button('시점 초기화')).toBeTruthy();
    act(() => fake.report('ready'));
    expect(plan()).toBeNull();
    cleanup();

    fake.phase = 'ready';
    renderPage(loadFake, 300);
    expect(plan()).toBeNull();
    expect(await screen.findByTestId('viewer3d')).toBeTruthy();
    // 정한 시간이 지나도 그 전에 준비됐으므로 2D 를 띄우지 않는다.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(plan()).toBeNull();
  });

  it('2D 미니맵을 누르면 3D 는 그대로 두고 큰 2D 창을 연다. 바깥을 누르면 닫힌다', async () => {
    renderPage();
    await screen.findByTestId('viewer3d');
    // 미니맵 그림은 버튼 안에 있어 2D 평면으로 따로 읽히지 않는다.
    expect(plan()).toBeNull();

    act(() => button('2D 평면 크게 보기').click());
    const dialog = screen.getByRole('dialog', { name: '2D 평면' });
    expect(within(dialog).getByRole('group', { name: '2D 평면' })).toBeTruthy();
    expect(screen.getByTestId('viewer3d')).toBeTruthy();

    act(() => screen.getByTestId('plan-modal').click());
    expect(screen.queryByRole('dialog', { name: '2D 평면' })).toBeNull();
  });

  it('왼쪽에는 도구 아이콘 줄과 2D 미니맵이 있고 워치 패널은 없다', async () => {
    renderPage();
    await screen.findByTestId('viewer3d');
    expect(screen.getByRole('group', { name: '도구' })).toBeTruthy();
    expect(screen.getByTestId('plan-minimap')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '워치' })).toBeNull();
  });

  it('시점 초기화는 3D 에 처음 시점을 요청하고 2D 로 덮지 않는다', async () => {
    renderPage();
    await screen.findByTestId('viewer3d');
    await vi.waitFor(() => expect(plan()).toBeNull());

    act(() => button('시점 초기화').click());
    expect(fake.resetView).toHaveBeenCalledTimes(1);
    expect(plan()).toBeNull();
    expect(screen.getByTestId('viewer3d')).toBeTruthy();
  });

  it('3D 가 렌더에 실패하면(RENDER_FAILED) 2D 로 바꾸고 3D 다시 시도를 보인다', async () => {
    fake.phase = 'error';
    renderPage();
    await vi.waitFor(() => expect(button('3D 다시 시도')).toBeTruthy());
    expect(plan()).toBeTruthy();
    expect(screen.queryByTestId('viewer3d')).toBeNull();
    // 2D 를 크게 보고 있으면 미니맵은 두지 않는다.
    expect(screen.queryByTestId('plan-minimap')).toBeNull();
  });

  it('3D 코드를 받지 못하면 2D 로 바꾸고, 3D 로 다시 바꾸면 새로 불러온다', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let calls = 0;
      const flaky = () =>
        ++calls === 1 ? Promise.reject(new Error('chunk load failed')) : loadFake();
      renderPage(flaky);
      await vi.waitFor(() => expect(button('3D 다시 시도')).toBeTruthy());
      expect(screen.queryByTestId('viewer3d')).toBeNull();

      act(() => button('3D 다시 시도').click());
      expect(await screen.findByTestId('viewer3d')).toBeTruthy();
      expect(calls).toBe(2);
    } finally {
      quiet.mockRestore();
    }
  });

  it('3D 가 준비되면 구역을 넘기고, 2D 창에서 고른 사람이 장면에 올라오면 3D 에서도 고른다', async () => {
    // 준비 직후에는 사람이 아직 장면에 없다(NOT_FOUND). 올라올 때까지 다시 시도해야 한다.
    let calls = 0;
    fake.select.mockImplementation(() =>
      ++calls < 3 ? { ok: false, reason: 'NOT_FOUND' } : { ok: true },
    );
    const pushZones = vi.fn();
    useRealtimeStore.setState({
      source: { pushZones } as unknown as ReturnType<typeof useRealtimeStore.getState>['source'],
      world: { payload: worldStateAt(Date.now()).payload, receivedAt: Date.now() },
    });
    renderPage();
    await screen.findByTestId('viewer3d');
    expect(pushZones).toHaveBeenLastCalledWith({ ok: true, raw: ZONES_RAW });

    act(() => button('2D 평면 크게 보기').click());
    const dialog = screen.getByRole('dialog', { name: '2D 평면' });
    const person = within(dialog).getByRole('button', { name: /^w-0012/ });
    act(() => person.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(person.getAttribute('aria-pressed')).toBe('true');

    await vi.waitFor(() => expect(calls).toBe(3));
    expect(fake.select).toHaveBeenLastCalledWith({ type: 'person', id: 'w-0012' });
    // 고르고 나면 더 시도하지 않는다.
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toBe(3);
  });
});
