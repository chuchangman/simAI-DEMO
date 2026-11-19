import { SpatialViewportHost, useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import { targetOfKey } from '@/features/layout/spatialHost/selectionKey';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore } from '@/store/session.store';
import { startZoneEdit, stopZoneEdit } from '@/store/zoneEditMode.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// 틀이 작업면 선택 키를 화면에 잇는지 본다. 정적 객체(작업면·장애물)를 받아 3D 에 넣는 일은
// 틀이 모든 화면에서 하고(SpatialViewportHostSnapshots.test), 여기서는 받지 못해도 3D 가 뜨는지만 본다. 구역은 관심 밖이다.
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
const api = vi.hoisted(() =>
  vi.fn<(path: string) => Promise<never>>(() => Promise.reject(new Error('no api in test'))),
);
const avatarMeshFetch = vi.hoisted(() => vi.fn<(url: string) => Promise<ArrayBuffer>>());
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/avatarMeshFetch', () => ({ avatarMeshFetch }));

// 3D 뷰어 대역: 마운트마다 준비를 한 번 알리고, 마지막으로 받은 props 를 남긴다.
const fake = vi.hoisted(() => ({
  select: vi.fn(),
  props: null as Viewer3DProps | null,
}));

function FakeViewer(props: Viewer3DProps) {
  const { ref, onStatusChange } = props;
  useImperativeHandle(
    ref,
    () =>
      ({
        select: fake.select,
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

/** 틀이 화면에 주는 선택 키와 선택 명령을 시험에서 쓴다. */
function Probe() {
  const viewport = useSpatialViewport();
  return (
    <>
      <span data-testid="selected">{viewport?.selectedKey ?? ''}</span>
      <button onClick={() => viewport?.selectTarget({ type: 'object', id: 'ws-2' })}>
        작업면 고르기
      </button>
    </>
  );
}

function HostWith(props: { eventPanel?: boolean }) {
  return (
    <SpatialViewportHost loadViewer={loadFake} {...props}>
      <Probe />
    </SpatialViewportHost>
  );
}

function renderHost() {
  // 같은 QueryClient 를 다시 그릴 때도 쓴다(틀이 새로 뜨지 않게 wrapper 로 감싼다).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<HostWith />, { wrapper });
}

let pushWorkSurfaces: Mock;

beforeEach(() => {
  pushWorkSurfaces = vi.fn();
  useRealtimeStore.setState(
    {
      ...useRealtimeStore.getInitialState(),
      source: { id: 's-1', pushZones: vi.fn(), pushWorkSurfaces } as never,
    },
    true,
  );
  api.mockClear();
  fake.props = null;
  fake.select.mockReset().mockImplementation(() => ({ ok: true }));
});
afterEach(() => {
  cleanup();
  stopZoneEdit();
  useSessionStore.setState({ session: undefined });
});

describe('틀의 작업면 연결', () => {
  it('3D 카메라 마커로 CCTV 창을 열고 창의 닫기로 닫으며 편집 중에는 숨긴다', async () => {
    useSessionStore.setState({
      session: { accessToken: 't', user: { id: 'admin', role: 'ADMIN' } },
    });
    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(fake.props?.onCameraClick).toBeTypeOf('function'));
    // 도구 모음에는 CCTV 창 버튼이 없다
    expect(screen.queryByRole('button', { name: 'CCTV 창' })).toBeNull();
    act(() => fake.props?.onCameraClick?.('cam_A'));
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    act(() => startZoneEdit());
    expect(screen.queryByLabelText('떠 있는 CCTV')).toBeNull();
    act(() => stopZoneEdit());
    expect(screen.getByLabelText('떠 있는 CCTV')).toBeTruthy();
    act(() => screen.getByRole('button', { name: '떠 있는 CCTV 닫기' }).click());
    expect(screen.queryByLabelText('떠 있는 CCTV')).toBeNull();
  });
  it('3D 에 앱의 인증된 아바타 fetch 를 넘긴다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    expect(fake.props?.avatarMeshFetch).toBe(avatarMeshFetch);
  });

  it('틀은 정적 객체 목록을 받고, 받지 못하면 3D 에 넣지 않은 채 3D 는 그대로 뜬다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() =>
      expect(api.mock.calls.some(([path]) => String(path).includes('/api/static-objects'))).toBe(
        true,
      ),
    );
    expect(pushWorkSurfaces).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('관제에서는 작업면·장애물을 보이기만 하고(고르지 않고), 이벤트 패널이 없는 화면과 관리자 편집 모드에서 작업면을 고른다', async () => {
    useSessionStore.setState({
      session: { accessToken: 't', user: { id: 'admin', role: 'ADMIN' } },
    });
    const { rerender } = renderHost();
    await screen.findByTestId('viewer3d');
    expect(fake.props?.layers).toEqual({ workSurfaces: 'visible', obstacles: 'visible' });

    rerender(<HostWith eventPanel={false} />);
    expect(fake.props?.layers).toEqual({ workSurfaces: 'interactive', obstacles: 'visible' });

    rerender(<HostWith />);
    expect(fake.props?.layers).toEqual({ workSurfaces: 'visible', obstacles: 'visible' });
    act(() => startZoneEdit());
    expect(fake.props?.layers).toEqual({ workSurfaces: 'interactive', obstacles: 'visible' });
  });

  it('편집 모드는 관리자에게만 켜진다', async () => {
    useSessionStore.setState({
      session: { accessToken: 't', user: { id: 'viewer', role: 'VIEWER' } },
    });
    renderHost();
    await screen.findByTestId('viewer3d');
    act(() => startZoneEdit());
    expect(fake.props?.layers).toEqual({ workSurfaces: 'visible', obstacles: 'visible' });
    expect(screen.queryByTestId('zone-edit-fade')).toBeNull();
  });

  it('3D 에서 고른 작업면은 object 키가 되고, 화면은 작업면을 대상으로 고를 수 있다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    act(() => fake.props?.onSelectionChange?.({ type: 'object', id: 'ws-1' }));
    expect(screen.getByTestId('selected').textContent).toBe('object:ws-1');

    act(() => screen.getByRole('button', { name: '작업면 고르기' }).click());
    expect(fake.select).toHaveBeenLastCalledWith({ type: 'object', id: 'ws-2' });
    expect(screen.getByTestId('selected').textContent).toBe('object:ws-2');
    expect(targetOfKey('object:ws-2')).toEqual({ type: 'object', id: 'ws-2' });
  });
});
