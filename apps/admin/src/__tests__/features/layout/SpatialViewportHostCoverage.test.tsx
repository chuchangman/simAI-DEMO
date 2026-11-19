import { useCamSplitStore } from '@/features/cctv/camSplit.store';
import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { startZoneEdit, stopZoneEdit } from '@/store/zoneEditMode.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: { contract: 'DEMO_UNCONFIRMED', zones: [] }, failed: false }),
}));

const api = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>());
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/avatarMeshFetch', () => ({ avatarMeshFetch: vi.fn() }));

const fake = vi.hoisted(() => ({ props: null as Viewer3DProps | null }));

function FakeViewer(props: Viewer3DProps) {
  const { ref, onStatusChange } = props;
  useImperativeHandle(
    ref,
    () =>
      ({
        select: () => ({ ok: true }),
        focus: () => ({ ok: true }),
        clearSelection: () => ({ ok: true }),
        setMode: () => ({ ok: true }),
      }) as unknown as Viewer3DHandle,
  );
  const reported = useRef(false);
  useLayoutEffect(() => {
    fake.props = props;
    if (reported.current) return;
    reported.current = true;
    onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus);
  });
  return <div data-testid="viewer3d" />;
}

const loadFake = () => Promise.resolve({ default: FakeViewer });

const COVERAGE = {
  calibration_version: 'cal-1',
  cell_m: 0.5,
  origin_xy: [0, 0],
  cols: 2,
  rows: 2,
  cells: '0122',
  ankle_height_m: 0.1,
  head_height_m: 1.7,
  floor_source: 'MAPANYTHING_FLOOR_POINTS',
  is_upper_bound: true,
};

function sceneResponse(withCoverage: boolean) {
  return {
    scene_version: 'scene-1',
    state: 'COMMITTED',
    default: false,
    calibration_version: 'cal-1',
    committed_at_ms: 1,
    gltf_url: null,
    gltf_expires_at_ms: null,
    ...(withCoverage ? { floor_coverage: COVERAGE } : {}),
  };
}

function liveCalibration(version: string) {
  act(() =>
    useRealtimeStore.setState({
      world: { payload: { calibration_version: version, tracks: [] }, receivedAt: Date.now() },
    } as never),
  );
}

function renderHost(withCoverage = true) {
  api.mockImplementation((path: string) =>
    String(path).includes('/api/scenes/current')
      ? Promise.resolve(sceneResponse(withCoverage))
      : Promise.reject(new Error('unused endpoint')),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SpatialViewportHost loadViewer={loadFake} />, { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  useCamSplitStore.getState().close();
  useRealtimeStore.setState(
    {
      ...useRealtimeStore.getInitialState(),
      source: { id: 's-1', pushZones: vi.fn(), pushWorkSurfaces: vi.fn() } as never,
    },
    true,
  );
  useSessionStore.setState({ session: { accessToken: 't', user: { id: 'admin', role: 'ADMIN' } } });
  fake.props = null;
  api.mockReset();
});

afterEach(() => {
  cleanup();
  stopZoneEdit();
  useSessionStore.setState({ session: undefined });
});

describe('바닥 감시 범위 겹침', () => {
  it('기본은 꺼져 있고, 켜면 지금 보정에 맞는 범위를 3D 에 넘기고 범례를 보인다', async () => {
    liveCalibration('cal-1');
    renderHost();
    const button = await screen.findByRole('button', { name: '감시 범위' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(fake.props?.floorCoverage ?? null).toBeNull();
    expect(screen.queryByRole('status', { name: '감시 범위 범례' })).toBeNull();

    act(() => button.click());
    await waitFor(() => expect(fake.props?.floorCoverage?.cells).toBe('0122'));
    expect(button.getAttribute('aria-pressed')).toBe('true');
    const legend = screen.getByRole('status', { name: '감시 범위 범례' });
    expect(legend.textContent).toContain('감시됨(2대 이상)');
    expect(legend.textContent).toContain('1대만');
    expect(legend.textContent).toContain('사각');

    act(() => button.click());
    expect(fake.props?.floorCoverage ?? null).toBeNull();
    expect(screen.queryByRole('status', { name: '감시 범위 범례' })).toBeNull();
  });

  it('Tier 0 보정이 바뀌면 그리지 않고 오래됐다고 알린다', async () => {
    liveCalibration('cal-1');
    renderHost();
    const button = await screen.findByRole('button', { name: '감시 범위' });
    act(() => button.click());
    await waitFor(() => expect(fake.props?.floorCoverage).toBeTruthy());

    // 회전 자동 복구로 버전만 바뀌고 서버가 VERIFIED 로 판정하면 그대로 그린다
    act(() =>
      useRealtimeStore.setState({
        health: {
          payload: {
            scene: {
              compatibility: {
                scene_version: 'scene-1',
                calibration_version: 'cal-2',
                verification: 'VERIFIED',
              },
            },
          },
          receivedAt: Date.now(),
          clockOffsetMs: 0,
        },
      } as never),
    );
    liveCalibration('cal-2');
    expect(fake.props?.floorCoverage?.cells).toBe('0122');

    liveCalibration('cal-3');
    await waitFor(() => expect(fake.props?.floorCoverage ?? null).toBeNull());
    expect(screen.getByRole('status', { name: '감시 범위 범례' }).textContent).toContain(
      '보정이 바뀌어',
    );
  });

  it('범위 자료가 없거나 구역 편집 중이면 버튼과 겹침을 숨긴다', async () => {
    liveCalibration('cal-1');
    const { unmount } = renderHost(false);
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '감시 범위' })).toBeNull();
    unmount();

    renderHost();
    const button = await screen.findByRole('button', { name: '감시 범위' });
    act(() => button.click());
    await waitFor(() => expect(fake.props?.floorCoverage).toBeTruthy());
    act(() => startZoneEdit());
    expect(fake.props?.floorCoverage ?? null).toBeNull();
    expect(screen.queryByRole('button', { name: '감시 범위' })).toBeNull();
  });
});
