import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import type { Viewer3DProps, ViewerSceneStatus } from '@/features/viewer3d';
import { IDLE_LOAD, sceneStatusOf } from '@/features/viewer3d/scene/sceneContract';
import { createQueryClient } from '@/lib/queryClient';
import { handlers } from '@/mocks/handlers';
import { useRoomBoundsStore } from '@/store/roomBounds.store';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { useLayoutEffect } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.viewer' }),
  };
});
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));
const ZONES_RAW = { contract: 'DEMO_UNCONFIRMED', zones: [] };
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: ZONES_RAW, failed: false }),
}));

const viewer = { props: null as Viewer3DProps | null };
function FakeViewer(props: Viewer3DProps) {
  const { onStatusChange } = props;
  useLayoutEffect(() => {
    viewer.props = props;
  });
  useLayoutEffect(() => {
    onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null });
  }, [onStatusChange]);
  return <div data-testid="viewer3d" />;
}
const loadViewer = () => Promise.resolve({ default: FakeViewer });
const server = setupServer(...handlers);
const clients: ReturnType<typeof createQueryClient>[] = [];
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  server.resetHandlers();
  viewer.props = null;
  useRoomBoundsStore.setState(useRoomBoundsStore.getInitialState(), true);
});

function renderHost() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SpatialViewportHost loadViewer={loadViewer} eventPanel={false} />
    </QueryClientProvider>,
  );
}

describe('관제 호스트의 Scene 연결', () => {
  it('mock 모드의 인증된 DEFAULT 본문과 데모 자산 주소를 Viewer3D 에 넘긴다', async () => {
    renderHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));
    expect(viewer.props?.scene).toMatchObject({
      ok: true,
      raw: {
        scene_version: 'scene-demo',
        state: 'DEFAULT',
        default: true,
        calibration_version: null,
        gltf_url: expect.stringContaining('scene-demo.gltf'),
        gltf_expires_at_ms: expect.any(Number),
      },
    });
    expect(screen.getByRole('main', { name: '실시간 관제' })).toBeTruthy();
  });

  it.each([401, 503])('Scene 조회 %s 에도 관제 화면과 뷰어를 띄운다', async (status) => {
    let calls = 0;
    server.use(
      http.get('*/api/scenes/current', () => {
        calls++;
        return HttpResponse.json({}, { status });
      }),
    );
    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(calls).toBe(1));
    expect(viewer.props?.scene).toBeNull();
    expect(screen.getByRole('main', { name: '실시간 관제' })).toBeTruthy();
  });

  it('뷰어가 만료를 알리면 재조회한 본문을 다시 넘긴다', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/scenes/current', () =>
        HttpResponse.json({
          scene_version: 'scene-current',
          state: 'DEFAULT',
          default: true,
          calibration_version: null,
          gltf_url: `/scene.glb?signature=${++calls}`,
          gltf_expires_at_ms: Date.now() + 300_000,
        }),
      ),
    );
    renderHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));
    const status = sceneStatusOf(
      viewer.props!.scene!,
      {
        ...IDLE_LOAD,
        phase: 'EXPIRED',
        sceneVersion: 'scene-current',
      },
      {
        worldScene: null,
        worldCalibration: null,
        healthCommitted: null,
        healthLive: null,
        healthMismatch: null,
      },
    );
    act(() => viewer.props?.onSceneStatusChange?.(status));
    await waitFor(() =>
      expect(viewer.props?.scene).toMatchObject({
        ok: true,
        raw: { gltf_url: '/scene.glb?signature=2' },
      }),
    );
    expect(calls).toBe(2);
  });
});

describe('관제 호스트의 카메라 시점 사진(-592)', () => {
  it('확정 Scene 이면 그 버전의 카메라 사진 주소를 Viewer3D vdt.cameraImageUrls 로 넘긴다', async () => {
    const paths: string[] = [];
    server.use(
      http.get('*/api/scenes/current', () =>
        HttpResponse.json({
          scene_version: 'scene-baked',
          state: 'COMMITTED',
          default: false,
          calibration_version: 'cal-1',
          gltf_url: '/scene.glb',
          gltf_expires_at_ms: Date.now() + 300_000,
        }),
      ),
      http.get('*/api/scenes/:sceneVersion/camera-images', ({ request, params }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({
          scene_version: params.sceneVersion,
          bundle_id: 'bundle-3f6c2b1a9d8e4f70a1b2c3d4e5f60718',
          expires_at_ms: Date.now() + 300_000,
          images: [{ camera_id: 'cam_A', url: 'https://s3.test/cam_A.jpg?sig=1' }],
        });
      }),
    );
    renderHost();
    await waitFor(() =>
      expect(viewer.props?.vdt).toEqual({
        cameraImageUrls: { cam_A: 'https://s3.test/cam_A.jpg?sig=1' },
      }),
    );
    expect(paths).toEqual(['/api/scenes/scene-baked/camera-images']);
  });

  it('기본 Scene 이면 사진을 묻지 않고 vdt 를 넘기지 않는다(시점 이동만)', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/scenes/:sceneVersion/camera-images', () => {
        calls++;
        return HttpResponse.json({});
      }),
    );
    renderHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));
    expect(viewer.props?.vdt).toBeUndefined();
    expect(calls).toBe(0);
  });
});

describe('관제 호스트의 교실 범위', () => {
  const SCAN: NonNullable<ViewerSceneStatus['boundsWorld']> = {
    min: [0, 0, 0],
    max: [7.2, 5.8, 3],
  };
  const noVersions = {
    worldScene: null,
    worldCalibration: null,
    healthCommitted: null,
    healthLive: null,
    healthMismatch: null,
  };
  const scanStatus = (patch: Partial<ViewerSceneStatus>): ViewerSceneStatus => ({
    ...sceneStatusOf(null, IDLE_LOAD, noVersions),
    phase: 'LOADED',
    display: 'FULL',
    boundsWorld: SCAN,
    ...patch,
  });
  const report = (status: ViewerSceneStatus) =>
    act(() => viewer.props?.onSceneStatusChange?.(status));
  const bounds = () => useRoomBoundsStore.getState().bounds;

  it('뷰어가 알린 보이는 스캔의 경계를 저장소에 올리고, 숨겨지면 비우며, 호스트가 내려가면 비운다', async () => {
    const view = renderHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));
    expect(bounds()).toBeNull();

    report(scanStatus({ display: 'DIMMED' }));
    expect(bounds()).toBe(SCAN);

    report(scanStatus({ display: 'HIDDEN', verification: 'MISMATCH' }));
    expect(bounds()).toBeNull();

    report(scanStatus({ display: 'FULL' }));
    expect(bounds()).toBe(SCAN);
    view.unmount();
    expect(bounds()).toBeNull();
  });

  it('스캔 경계가 없거나 쓸 수 없으면(한 변 0.2m) 올리지 않는다', async () => {
    renderHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));

    report(scanStatus({ boundsWorld: null }));
    expect(bounds()).toBeNull();
    report(scanStatus({ boundsWorld: { min: [0, 0, 0], max: [0.2, 0.2, 3] } }));
    expect(bounds()).toBeNull();
  });
});

describe('장면 상태 안내', () => {
  const reportStatus = async (patch: Partial<ViewerSceneStatus>) => {
    renderHost();
    await waitFor(() => expect(viewer.props?.scene?.ok).toBe(true));
    const status = sceneStatusOf(null, IDLE_LOAD, {
      worldScene: null,
      worldCalibration: null,
      healthCommitted: null,
      healthLive: null,
      healthMismatch: null,
    });
    act(() => viewer.props?.onSceneStatusChange?.({ ...status, ...patch }));
  };

  it('재생성이 필요하면 관제 호스트에 표시하고, 임시 보정 기준 배경 글자는 붙이지 않는다', async () => {
    await reportStatus({ provisionalBackground: true, regenerationRequired: true });
    expect(screen.getByRole('status').textContent).toBe('재생성 필요');
  });

  it('임시 보정 기준 배경만 있고 재생성이 필요하지 않으면 아무것도 표시하지 않는다', async () => {
    await reportStatus({ provisionalBackground: true, regenerationRequired: false });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
