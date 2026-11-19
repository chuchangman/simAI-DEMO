import { useCamSplitStore } from '@/features/cctv/camSplit.store';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { startZoneEdit, stopZoneEdit } from '@/store/zoneEditMode.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ZONES_RAW = { contract: 'DEMO_UNCONFIRMED', zones: [] };

vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: ZONES_RAW, failed: false }),
}));
vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: () => ({ attach: vi.fn(), resume: vi.fn() }),
}));
vi.mock('@/features/cctv/useCamStream', () => ({
  useCamStream: () => ({
    videoRef: () => {},
    phase: 'playing' as const,
    retry: vi.fn(),
  }),
}));

const api = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>());
const avatarMeshFetch = vi.hoisted(() => vi.fn<(url: string) => Promise<ArrayBuffer>>());
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/avatarMeshFetch', () => ({ avatarMeshFetch }));

const fake = vi.hoisted(() => ({
  props: null as Viewer3DProps | null,
  viewFromCamera: vi.fn<(cameraId: string) => { ok: boolean }>(),
  exitCameraView: vi.fn<() => { ok: boolean }>(),
  resetView: vi.fn<() => { ok: boolean }>(),
}));

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
        viewFromCamera: fake.viewFromCamera,
        exitCameraView: fake.exitCameraView,
        resetView: fake.resetView,
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

const CALIBRATION_V1 = {
  calibration_version: 'cal-1',
  camera_poses: [
    {
      camera_id: 'cam_A',
      position_xyz: [-3.5, -2.8, 2.7],
      forward_xyz: [0.6, 0.5, -0.6245],
      hfov_rad: 1.09,
    },
    {
      camera_id: 'cam_B',
      position_xyz: [3.5, -2.8, 2.7],
      forward_xyz: [-0.6, 0.5, -0.6245],
      hfov_rad: 1.09,
    },
  ],
};

const CALIBRATION_V2 = {
  calibration_version: 'cal-2',
  camera_poses: [
    {
      camera_id: 'cam_C',
      position_xyz: [-3.5, 2.8, 2.7],
      forward_xyz: [0.6, -0.5, -0.6245],
      hfov_rad: 1.12,
    },
  ],
};

function renderHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SpatialViewportHost loadViewer={loadFake} />, { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  useCctvStore.getState().hello(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
  useCamSplitStore.getState().close();
  useRealtimeStore.setState(
    {
      ...useRealtimeStore.getInitialState(),
      source: { id: 's-1', pushZones: vi.fn(), pushWorkSurfaces: vi.fn() } as never,
    },
    true,
  );
  useSessionStore.setState({
    session: { accessToken: 't', user: { id: 'admin', role: 'ADMIN' } },
  });
  fake.props = null;
  fake.viewFromCamera.mockReset().mockImplementation((id) => ({ ok: id !== 'cam_D' }));
  fake.exitCameraView.mockReset().mockReturnValue({ ok: true });
  fake.resetView.mockReset().mockReturnValue({ ok: true });
  api.mockReset().mockImplementation((path: string) => {
    if (String(path).includes('/api/calibrations/current')) {
      return Promise.resolve(CALIBRATION_V1);
    }
    return Promise.reject(new Error('unused endpoint'));
  });
});

afterEach(() => {
  cleanup();
  useCctvStore.getState().reset();
  stopZoneEdit();
  useCamSplitStore.getState().close();
  useSessionStore.setState({ session: undefined });
});

describe('틀의 카메라 마커와 CCTV 창 연동', () => {
  it('현재 보정 상태의 카메라 자세를 3D 에 넘기고 구역 편집 모드에서는 숨긴다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');

    await waitFor(() => {
      expect(fake.props?.cameraPoses).toHaveLength(2);
    });
    expect(fake.props?.cameraPoses?.[0]?.cameraId).toBe('cam_A');
    expect(fake.props?.cameraPoses?.[1]?.cameraId).toBe('cam_B');

    act(() => startZoneEdit());
    expect(fake.props?.cameraPoses).toBeUndefined();

    act(() => stopZoneEdit());
    expect(fake.props?.cameraPoses).toHaveLength(2);
  });

  it('3D 카메라 마커를 클릭하면 떠 있는 CCTV 창을 해당 카메라 하나로 열고, 이미 열려 있으면 그 카메라로 바꾼다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(fake.props?.onCameraClick).toBeTypeOf('function'));

    // 도구 모음에는 CCTV 창 버튼이 없고, 창은 카메라 마커로만 열린다
    expect(screen.queryByRole('button', { name: 'CCTV 창' })).toBeNull();
    expect(screen.queryByLabelText('떠 있는 CCTV')).toBeNull();

    // 마커 클릭 시 떠 있는 CCTV 창이 열리고 클릭한 카메라(cam_B) 하나만 보여준다. 4분할·카메라 버튼 줄은 없다
    act(() => fake.props?.onCameraClick?.('cam_B'));
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    expect(screen.getByLabelText('카메라 2 영상')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '4분할' })).toBeNull();

    // 이미 열려 있는 상태에서 다른 카메라 마커(cam_D)를 클릭하면 그 카메라로 즉시 전환한다
    act(() => fake.props?.onCameraClick?.('cam_D'));
    expect(screen.getByLabelText('카메라 4 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 2 영상')).toBeNull();

    act(() => fake.props?.onCameraClick?.('cam_A'));
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    expect(screen.getByLabelText('카메라 1 영상')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 4 영상')).toBeNull();
  });

  it('실시간 calibration_version 이 바뀌면 다시 조회해 갱신하고 1 Hz health 갱신에는 다시 조회하지 않는다', async () => {
    let currentResponse: unknown = CALIBRATION_V1;
    api.mockImplementation((path: string) => {
      if (String(path).includes('/api/calibrations/current')) {
        return Promise.resolve(currentResponse);
      }
      return Promise.reject(new Error('unused endpoint'));
    });

    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(fake.props?.cameraPoses?.[0]?.cameraId).toBe('cam_A'));

    const callsCountAfterMount = api.mock.calls.filter(([p]) =>
      String(p).includes('/api/calibrations/current'),
    ).length;
    expect(callsCountAfterMount).toBe(1);

    // 1 Hz health 갱신이나 같은 calibration_version 의 world_state 는 재조회를 일으키지 않는다
    act(() => {
      useRealtimeStore.setState({
        health: {
          payload: {} as never,
          receivedAt: 1000,
          clockOffsetMs: 0,
        },
        world: {
          payload: {
            calibration_version: 'cal-1',
            tracks: [],
          } as never,
          receivedAt: 1000,
        },
      });
    });

    expect(
      api.mock.calls.filter(([p]) => String(p).includes('/api/calibrations/current')).length,
    ).toBe(1);

    // calibration_version 이 cal-2 로 바뀌면 재조회하여 새 카메라 마커 목록을 반영한다
    currentResponse = CALIBRATION_V2;
    act(() => {
      useRealtimeStore.setState({
        world: {
          payload: {
            calibration_version: 'cal-2',
            tracks: [],
          } as never,
          receivedAt: 2000,
        },
      });
    });

    await waitFor(() => {
      expect(fake.props?.cameraPoses?.[0]?.cameraId).toBe('cam_C');
    });
  });
});

const VIEW_LABEL = '3D 에서 이 방향으로 보기';

async function openCctv(cameraId: string) {
  renderHost();
  await screen.findByTestId('viewer3d');
  await waitFor(() => expect(fake.props?.onCameraClick).toBeTypeOf('function'));
  // 보정 자세가 뷰어에 넘어간 뒤(버튼이 켜질 조건) 마커를 누른다.
  await waitFor(() => expect(fake.props?.cameraPoses).toHaveLength(2));
  act(() => fake.props?.onCameraClick?.(cameraId));
}

function viewButton() {
  return screen.getByRole('button', { name: VIEW_LABEL }) as HTMLButtonElement;
}

describe('카메라 시점 보기(-590, -626)', () => {
  it('카메라 마커를 누르면 CCTV 창만 열고 3D 시점은 옮기지 않는다', async () => {
    await openCctv('cam_B');
    // 관제 화면은 VDT 를 늘 켜지 않는다(카메라 시점에 맞아 있는 동안만 뷰어가 켠다).
    expect(fake.props?.vdt).toBeUndefined();
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    expect(screen.getByLabelText('카메라 2 영상')).toBeTruthy();
    expect(fake.viewFromCamera).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '3D 전체 보기' })).toBeNull();
    expect(viewButton().disabled).toBe(false);
  });

  it('「3D 에서 이 방향으로 보기」를 누르면 그 카메라 시점으로 옮기고, 「전체 보기」는 CCTV 창을 둔 채 이전 시점으로 돌린다', async () => {
    await openCctv('cam_B');
    act(() => viewButton().click());
    expect(fake.viewFromCamera).toHaveBeenCalledExactlyOnceWith('cam_B');
    act(() => screen.getByRole('button', { name: '3D 전체 보기' }).click());
    expect(fake.exitCameraView).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '3D 전체 보기' })).toBeNull();
  });

  it('CCTV 창을 닫으면 이전 시점으로 돌리고, 시점을 옮기지 않았으면 그대로 둔다', async () => {
    await openCctv('cam_A');
    act(() => viewButton().click());
    act(() => screen.getByRole('button', { name: '떠 있는 CCTV 닫기' }).click());
    expect(fake.exitCameraView).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('떠 있는 CCTV')).toBeNull();

    act(() => fake.props?.onCameraClick?.('cam_A'));
    act(() => screen.getByRole('button', { name: '떠 있는 CCTV 닫기' }).click());
    expect(fake.exitCameraView).toHaveBeenCalledTimes(1);
  });

  it('보정 정보가 없는 카메라면 버튼을 끄고 이유를 보인다', async () => {
    await openCctv('cam_D');
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    const button = viewButton();
    expect(button.disabled).toBe(true);
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
      '이 카메라의 보정 정보가 없어 방향을 알 수 없습니다',
    );
    act(() => button.click());
    expect(fake.viewFromCamera).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '3D 전체 보기' })).toBeNull();
  });

  it('3D 뷰어가 없으면(오류로 2D 보기) 버튼을 끄고 이유를 보인다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(fake.props?.onCameraClick).toBeTypeOf('function'));
    await waitFor(() => expect(fake.props?.cameraPoses).toHaveLength(2));
    // 뷰어가 오류를 알리면 호스트가 2D 보기로 바꾼다. 마커 콜백은 전에 받은 것을 그대로 부른다.
    act(() =>
      fake.props?.onStatusChange?.({
        phase: 'error',
        mode: 'LIVE',
        error: { code: 'WEBGL_CONTEXT_LOST', message: 'x' },
      } as unknown as ViewerStatus),
    );
    act(() => fake.props?.onCameraClick?.('cam_A'));
    const button = viewButton();
    expect(button.disabled).toBe(true);
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
      '2D 보기에서는 3D 시점을 옮길 수 없습니다',
    );
  });

  it('시점 초기화는 카메라 시점 보기를 끝내 「전체 보기」를 거둔다', async () => {
    await openCctv('cam_A');
    act(() => viewButton().click());
    expect(screen.getByRole('button', { name: '3D 전체 보기' })).toBeTruthy();
    act(() => screen.getByRole('button', { name: '시점 초기화' }).click());
    expect(fake.resetView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '3D 전체 보기' })).toBeNull();
  });
});
