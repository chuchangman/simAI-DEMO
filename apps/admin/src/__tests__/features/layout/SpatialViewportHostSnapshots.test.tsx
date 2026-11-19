import { SpatialViewportHost } from '@/features/layout/SpatialViewportHost';
import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import type { Viewer3DProps } from '@/features/viewer3d';
import { createQueryClient } from '@/lib/queryClient';
import { handlers } from '@/mocks/handlers';
import { createZonesMock } from '@/mocks/zones';
import { useRealtimeStore } from '@/store/realtime.store';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useLayoutEffect } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

// 틀이 3D Source 에 구역·정적 객체(작업면·장애물)를 넘기는 방식을 본다: 응답 원문 그대로, 3D 가 뜨면, 요청 시각(조회를 시작한 때)과
// 필요할 때만 범위를 달아서. 받지 못해도 3D 는 그대로 뜬다. 작업면 등록 화면과 서로 덮어쓰지 않는 쪽은 SurfacesPage.test 가 본다.

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.viewer' }),
  };
});
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: [], loaded: true, failed: false }),
}));

const fake = vi.hoisted(() => ({ props: null as Viewer3DProps | null }));
function FakeViewer(props: Viewer3DProps) {
  const { onStatusChange } = props;
  useLayoutEffect(() => {
    fake.props = props;
  });
  useLayoutEffect(() => {
    onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null });
  }, [onStatusChange]);
  return <div data-testid="viewer3d" />;
}
const loadViewer = () => Promise.resolve({ default: FakeViewer });

const WORK_SURFACE = {
  object_id: 'ws-1',
  object_version: 1,
  kind: 'WORK_SURFACE',
  name: '책상',
  obb: { center: [5, 4.6, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: 0 },
  top_height_m: 0.74,
  valid_from: 1,
  valid_to: null,
};
const OBSTACLE = {
  object_id: 'ob-1',
  object_version: 2,
  kind: 'OBSTACLE',
  name: '기둥',
  obb: { center: [1, 1, 1], size: [0.4, 0.4, 2], yaw_rad: 0 },
  top_height_m: null,
  valid_from: 1,
  valid_to: null,
};
const STATIC_OBJECTS = [WORK_SURFACE, OBSTACLE];
/** 서버가 응답하기까지 걸리는 시간(ms). 요청을 시작한 시각과 응답이 닿은 시각을 가른다. */
const LATENCY_MS = 80;

const server = setupServer(...handlers, ...createZonesMock().handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let pushZones: Mock;
let pushWorkSurfaces: Mock;
const clients: ReturnType<typeof createQueryClient>[] = [];

function useSource(extra: object = {}) {
  pushZones = vi.fn();
  pushWorkSurfaces = vi.fn();
  useRealtimeStore.setState(
    {
      ...useRealtimeStore.getInitialState(),
      source: { id: 's-1', pushZones, pushWorkSurfaces, ...extra } as never,
    },
    true,
  );
}

beforeEach(() => {
  useSource();
  fake.props = null;
  server.use(http.get('*/api/static-objects', () => HttpResponse.json(STATIC_OBJECTS)));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  server.resetHandlers();
});

function renderHost() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SpatialViewportHost loadViewer={loadViewer} />
    </QueryClientProvider>,
  );
  return client;
}

describe('틀의 형상 넘기기: 정적 객체', () => {
  it('3D 가 뜨면 작업면과 장애물을 서버 응답 원문 그대로 넘긴다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(pushWorkSurfaces).toHaveBeenCalled());
    const [result] = pushWorkSurfaces.mock.calls.at(-1)!;
    expect(result).toEqual({ ok: true, raw: STATIC_OBJECTS });
    // 작업면만 추린 묶음이 아니라 장애물을 포함한 BE 배열 그대로다(뷰어가 BE_STATIC_OBJECTS_V1 로 받는다).
    expect(Array.isArray(result.raw)).toBe(true);
    expect(result.raw.map((o: { kind: string }) => o.kind)).toEqual(['WORK_SURFACE', 'OBSTACLE']);
  });

  it('받지 못하면 넘기지 않지만 구역은 넘기고 3D 는 그대로 뜬다. 다시 받으면 넘긴다', async () => {
    server.use(
      http.get('*/api/static-objects', () => HttpResponse.json({ status: 503 }, { status: 503 })),
    );
    const client = renderHost();
    await screen.findByTestId('viewer3d');
    await waitFor(() => expect(pushZones).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryState(STATIC_OBJECTS_KEY)?.status).toBe('error'));
    expect(pushWorkSurfaces).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    // 받을 때까지 다시 시도하는 조회다(작업면 등록 화면과 같은 조회).
    const query = client.getQueryCache().find({ queryKey: STATIC_OBJECTS_KEY })!;
    const interval = query.observers[0]!.options.refetchInterval;
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(10_000);

    server.use(http.get('*/api/static-objects', () => HttpResponse.json(STATIC_OBJECTS)));
    await client.refetchQueries({ queryKey: STATIC_OBJECTS_KEY });
    await waitFor(() => expect(pushWorkSurfaces).toHaveBeenCalled());
    expect(pushWorkSurfaces.mock.calls.at(-1)![0]).toEqual({ ok: true, raw: STATIC_OBJECTS });
  });
});

describe('틀의 형상 넘기기: 요청 시각과 범위', () => {
  it('요청 시각은 조회를 시작한 때다(응답이 닿은 때가 아니다). 범위는 Source 가 정하지 않았으면 달지 않는다', async () => {
    const started = { staticObjects: 0 };
    server.use(
      http.get('*/api/static-objects', async () => {
        started.staticObjects = Date.now();
        await delay(LATENCY_MS);
        return HttpResponse.json(STATIC_OBJECTS);
      }),
    );
    const before = Date.now();
    renderHost();
    await waitFor(() => expect(pushWorkSurfaces).toHaveBeenCalled());
    await waitFor(() => expect(pushZones).toHaveBeenCalled());

    const [, staticReceivedAt, staticOptions] = pushWorkSurfaces.mock.calls.at(-1)!;
    expect(staticReceivedAt).toBeUndefined();
    expect(staticOptions.requestedAt).toBeGreaterThanOrEqual(before);
    expect(staticOptions.requestedAt).toBeLessThanOrEqual(started.staticObjects);
    expect(Date.now() - staticOptions.requestedAt).toBeGreaterThanOrEqual(LATENCY_MS - 20);
    expect(staticOptions).not.toHaveProperty('scope');

    const [, zonesReceivedAt, zonesOptions] = pushZones.mock.calls.at(-1)!;
    expect(zonesReceivedAt).toBeUndefined();
    expect(zonesOptions.requestedAt).toBeGreaterThanOrEqual(before);
    expect(zonesOptions.requestedAt).toBeLessThanOrEqual(Date.now());
    expect(zonesOptions).not.toHaveProperty('scope');
  });

  it('Source 가 범위를 정했으면 구역·정적 객체 모두 같은 범위를 단다', async () => {
    useSource({ scope: 'session-9' });
    renderHost();
    await waitFor(() => expect(pushWorkSurfaces).toHaveBeenCalled());
    await waitFor(() => expect(pushZones).toHaveBeenCalled());
    expect(pushWorkSurfaces.mock.calls.at(-1)![2]).toMatchObject({ scope: 'session-9' });
    expect(pushZones.mock.calls.at(-1)![2]).toMatchObject({ scope: 'session-9' });
  });

  it('범위를 정하지 않은 Source(scope null)의 push 는 범위 없이 요청 시각만 단다', async () => {
    useSource({ scope: null });
    renderHost();
    await waitFor(() => expect(pushWorkSurfaces).toHaveBeenCalled());
    expect(Object.keys(pushWorkSurfaces.mock.calls.at(-1)![2])).toEqual(['requestedAt']);
  });
});
