import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { bodyOf as surfaceBodyOf } from '@/features/surfaces/surfaces';
import type { SurfaceGeometry, WorkSurface } from '@/features/surfaces/types';
import { useWorkSurfaces } from '@/features/surfaces/useWorkSurfaces';
import { BUNDLES_KEY, requestBundles, ZONES_KEY } from '@/features/zones/api';
import { CommitBlockedError, CommitInFlightError } from '@/features/zones/commitErrors';
import type { Zone, ZoneCommitRequest } from '@/features/zones/types';
import { useZoneCommitMutation, type CommitInput } from '@/features/zones/useZoneCommitMutation';
import { useZones } from '@/features/zones/useZones';
import {
  formOf,
  newZoneBodyOf,
  shapeOfBox,
  bodyOf as zoneBodyOf,
  type ZoneForm,
} from '@/features/zones/zoneForm';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock, PUBLISH_FAILURES, type ZonesMock } from '@/mocks/zones';
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { delay, type JsonBodyType } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ token: 'mock-token.admin' }));
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => auth.token }) };
});

const COMMIT_URL = 'http://api.test/api/zones/commit';
const ADMIN_JSON = { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' };

const server = setupServer();
let zonesMock: ZonesMock;
/** 서버로 간 요청 기록(이 시험의 시작 이후). 시험이 직접 보낸 요청도 들어간다. */
let calls: { method: string; path: string; request: Request }[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  auth.token = 'mock-token.admin';
  const objects = createStaticObjectsMock();
  zonesMock = createZonesMock({ staticObjects: objects.store });
  server.resetHandlers(...zonesMock.handlers, ...objects.handlers);
  calls = [];
  server.events.on('request:start', ({ request }) => {
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      request: request.clone(),
    });
  });
});
afterEach(() => {
  cleanup();
  server.events.removeAllListeners();
});

let client: QueryClient;
async function run(setup?: import('@/features/setup/useSetupLayoutSync').SetupLayoutSync) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // 세 목록을 모두 화면이 보고 있는 것처럼 구독한다(다시 받기가 요청으로 보인다).
  const view = renderHook(
    () => ({
      zones: useZones(),
      surfaces: useWorkSurfaces(),
      bundles: useQuery({
        queryKey: BUNDLES_KEY,
        queryFn: ({ signal }) => requestBundles(api, signal),
        staleTime: Infinity,
      }),
      commit: useZoneCommitMutation(setup),
    }),
    { wrapper },
  );
  await waitFor(() => {
    expect(view.result.current.zones.zones).toHaveLength(2);
    expect(view.result.current.surfaces.surfaces).toHaveLength(2);
    expect(view.result.current.bundles.data).toHaveLength(1);
  });
  calls.length = 0;
  return view;
}
type View = Awaited<ReturnType<typeof run>>;

const zoneIn = (view: View, id: string) =>
  view.result.current.zones.zones.find((z) => z.zoneId === id)!;
const surfaceIn = (view: View, id: string) =>
  view.result.current.surfaces.surfaces.find((s) => s.objectId === id)!;

const commit = (view: View, input: CommitInput) =>
  act(() => view.result.current.commit.mutateAsync(input));
/** 저장이 실패하기를 기다려 그 오류를 돌려준다. */
const failure = async (view: View, input: CommitInput) => {
  let error: unknown;
  await act(async () => {
    error = await view.result.current.commit.mutateAsync(input).catch((e: unknown) => e);
  });
  return error;
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

/** 목록 캐시(서버가 준 원문)와 그 안의 칸 읽기. */
const rows = (key: QueryKey) => client.getQueryData<readonly Record<string, unknown>[]>(key) ?? [];
const idsOf = (key: QueryKey, field: string) => rows(key).map((row) => row[field]);
const rowOf = (key: QueryKey, field: string, id: string) => rows(key).find((r) => r[field] === id);
const zoneIds = () => idsOf(ZONES_KEY, 'zone_id');
const surfaceIds = () => idsOf(STATIC_OBJECTS_KEY, 'object_id');
const bundleVersions = () => idsOf(BUNDLES_KEY, 'config_version');
const snapshot = () => ({
  zones: rows(ZONES_KEY),
  surfaces: rows(STATIC_OBJECTS_KEY),
  bundles: rows(BUNDLES_KEY),
});

/** 서버로 간 요청: "GET /api/zones" 꼴 목록, 방법·경로별 요청, 한 번 저장 본문. */
const trace = () => calls.map((c) => `${c.method} ${c.path}`);
const sent = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);
const gets = () => ({
  zones: sent('GET', '/api/zones').length,
  surfaces: sent('GET', '/api/static-objects').length,
  bundles: sent('GET', '/api/config-bundles').length,
});
const commitBodies = () =>
  Promise.all(sent('POST', '/api/zones/commit').map((c) => c.request.json() as Promise<unknown>));

// 요청 만들기.
const NEW_FORM: ZoneForm = {
  name: '새 구역',
  judgeType: 'VOLUME_3D',
  zoneType: 'OPENING',
  severity: 'HIGH',
};
const NEW_SHAPE = shapeOfBox({ min: [0, 0, 0], max: [2, 2, 2] });
const GEOMETRY: SurfaceGeometry = {
  centerXy: [8, 2],
  sizeXy: [1.2, 0.6],
  yawRad: 0,
  topHeightM: 0.74,
};
const zoneUpdate = (zone: Zone, patch: Partial<ZoneForm> = {}) =>
  ({
    op: 'UPDATE',
    zone_id: zone.zoneId,
    body: zoneBodyOf(zone, { ...formOf(zone), ...patch }, null),
  }) as const;
const zoneUpdateRequest = (zone: Zone, patch?: Partial<ZoneForm>) =>
  ({ zone: zoneUpdate(zone, patch) }) satisfies ZoneCommitRequest;
const keep = (zoneId: string) => ({ op: 'KEEP', zone_id: zoneId }) as const;
const createBoth = () =>
  ({
    zone: { op: 'CREATE', body: newZoneBodyOf(NEW_FORM, NEW_SHAPE) },
    surface: { op: 'CREATE', body: surfaceBodyOf(null, '새 책상', GEOMETRY) },
  }) satisfies ZoneCommitRequest;
const createZoneOnly = () =>
  ({
    zone: { op: 'CREATE', body: newZoneBodyOf(NEW_FORM, NEW_SHAPE) },
  }) satisfies ZoneCommitRequest;
const surfaceUpdate = (surface: WorkSurface, op: 'UPDATE' | 'REPLACE' = 'UPDATE') =>
  ({
    op,
    object_id: surface.objectId,
    body: surfaceBodyOf(surface, `${surface.name ?? ''} 고침`, surface.geometry),
  }) as const;

// 다른 관리자가 먼저 새 버전을 저장한 상황(서버는 고치기 시작한 버전을 보지 않아 그대로 받는다).
const otherAdminSavesZone = (zone: Zone, name: string) =>
  fetch(`http://api.test/api/zones/${zone.zoneId}`, {
    method: 'PUT',
    headers: ADMIN_JSON,
    body: JSON.stringify(zoneBodyOf(zone, { ...formOf(zone), name }, null)),
  });
const otherAdminSavesSurface = (surface: WorkSurface, name: string) =>
  fetch(`http://api.test/api/static-objects/${surface.objectId}`, {
    method: 'PUT',
    headers: ADMIN_JSON,
    body: JSON.stringify(surfaceBodyOf(surface, name, surface.geometry)),
  });

describe('useZoneCommitMutation: 저장 성공', () => {
  it('직접 추가한 세팅 구역은 세션을 전달하고 발행 성공 후 반영한다', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const view = await run({ sessionId: 'session-1', sync, retry: vi.fn() });
    const request = createZoneOnly();
    const done = await commit(view, { request, zone: null, linked: null });
    expect(await commitBodies()).toEqual([
      { ...request, setup_session_id: 'session-1', publish: true },
    ]);
    expect(sync).toHaveBeenCalledExactlyOnceWith(done.result.zone_id, false);
  });

  it('구역만 저장되고 발행에 실패하면 반영하지 않는다', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const view = await run({ sessionId: 'session-1', sync, retry: vi.fn() });
    zonesMock.failNextPublish('CALIBRATION_MISSING');
    const done = await commit(view, { request: createZoneOnly(), zone: null, linked: null });
    expect(done.publishError).not.toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });
  it('구역 새 버전: 지금 버전을 확인하고 요청 한 번(publish: true)으로 저장해 구역·묶음 캐시를 바꾼다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    const surfacesBefore = rows(STATIC_OBJECTS_KEY);
    const request = zoneUpdateRequest(zone, { name: '개구부 위', severity: 'HIGH' });

    const done = await commit(view, { request, zone, linked: null });

    // 확인 GET 하나와 저장 요청 하나뿐이다(구역·작업면·묶음을 따로 PUT·POST 하지 않는다).
    expect(trace()).toEqual(['GET /api/zones', 'POST /api/zones/commit']);
    expect(await commitBodies()).toEqual([{ ...request, publish: true }]);
    expect(done.publishError).toBeNull();
    expect(done.result).toMatchObject({
      zone_id: 'z-04',
      zone: { zone_version: 2, name: '개구부 위', severity: 'HIGH' },
      surface: null,
      archived_surface_id: null,
      bundle: { config_version: 'cfg-13' },
    });
    expect(rowOf(ZONES_KEY, 'zone_id', 'z-04')).toMatchObject({
      zone_version: 2,
      name: '개구부 위',
      severity: 'HIGH',
    });
    expect(zoneIds()).toEqual(['z-04', 'z-02']);
    expect(bundleVersions()).toEqual(['cfg-13', 'cfg-12']);
    expect(rows(STATIC_OBJECTS_KEY)).toEqual(surfacesBefore);
    // 화면이 보는 구역도 새 버전이다.
    await waitFor(() =>
      expect(zoneIn(view, 'z-04')).toMatchObject({
        version: 2,
        name: '개구부 위',
        severity: 'HIGH',
      }),
    );
  });

  it('구역 KEEP + 작업면 UPDATE: 구역은 확인하지 않고 작업면만 확인하며, 구역 캐시는 그대로다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-02');
    const linked = surfaceIn(view, 'ws-0a0c0001');
    const zonesBefore = rows(ZONES_KEY);

    const { result } = await commit(view, {
      request: { zone: keep('z-02'), surface: surfaceUpdate(linked) },
      zone,
      linked,
    });

    expect(trace()).toEqual(['GET /api/static-objects', 'POST /api/zones/commit']);
    expect(result).toMatchObject({ zone: null, surface: { object_version: 2, zone_id: 'z-02' } });
    expect(rowOf(STATIC_OBJECTS_KEY, 'object_id', 'ws-0a0c0001')).toMatchObject({
      object_version: 2,
      name: '단상 작업면 고침',
    });
    expect(rows(ZONES_KEY)).toEqual(zonesBefore);
    expect(bundleVersions()).toEqual(['cfg-13', 'cfg-12']);
  });

  it('구역 UPDATE + 작업면 UPDATE: 둘 다 지금 버전을 확인한 뒤 저장한다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-02');
    const linked = surfaceIn(view, 'ws-0a0c0001');

    await commit(view, {
      request: { zone: zoneUpdate(zone, { name: '단상' }), surface: surfaceUpdate(linked) },
      zone,
      linked,
    });

    expect(trace().slice(0, 2).sort()).toEqual(['GET /api/static-objects', 'GET /api/zones']);
    expect(trace().slice(2)).toEqual(['POST /api/zones/commit']);
    expect(rowOf(ZONES_KEY, 'zone_id', 'z-02')).toMatchObject({ zone_version: 2, name: '단상' });
    expect(rowOf(STATIC_OBJECTS_KEY, 'object_id', 'ws-0a0c0001')).toMatchObject({
      object_version: 2,
    });
  });

  it('구역 UPDATE + 새 작업면: 구역만 확인하고, 새 작업면은 구역에 이어 목록 끝에 더한다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    const request = {
      zone: zoneUpdate(zone),
      surface: { op: 'CREATE', body: surfaceBodyOf(null, '새 책상', GEOMETRY) },
    } satisfies ZoneCommitRequest;

    const { result } = await commit(view, { request, zone, linked: null });

    expect(trace()).toEqual(['GET /api/zones', 'POST /api/zones/commit']);
    expect(result.surface).toMatchObject({ zone_id: 'z-04', object_version: 1 });
    expect(surfaceIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002', result.surface?.object_id]);
  });

  it('구역+작업면 새로 만들기: 버전을 확인하지 않고 세 캐시(구역·작업면·묶음)에 모두 넣는다', async () => {
    const view = await run();
    const request = createBoth();

    const { result, publishError } = await commit(view, { request, zone: null, linked: null });

    expect(trace()).toEqual(['POST /api/zones/commit']);
    expect(await commitBodies()).toEqual([{ ...request, publish: true }]);
    expect(publishError).toBeNull();
    expect(result.zone_id).toMatch(/^z-[0-9a-f]{8}$/);
    expect(result.surface?.object_id).toMatch(/^ws-[0-9a-f]{8}$/);
    expect(result.surface?.zone_id).toBe(result.zone_id);
    expect(zoneIds()).toEqual(['z-04', 'z-02', result.zone_id]);
    expect(surfaceIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002', result.surface?.object_id]);
    expect(bundleVersions()).toEqual(['cfg-13', 'cfg-12']);
    expect(result.bundle?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_type: 'ZONE', item_id: result.zone_id }),
        expect.objectContaining({ item_type: 'STATIC_OBJECT', item_id: result.surface?.object_id }),
      ]),
    );
    await waitFor(() => expect(zoneIn(view, result.zone_id).name).toBe('새 구역'));
  });

  it('앞 저장이 끝나기 전의 두 번째 저장은 보내지 않고 CommitInFlightError 를 던진다(다른 훅 인스턴스여도, S15P31A101-651)', async () => {
    const view = await run();
    // 같은 화면(QueryClient)의 다른 저장 훅(예: 세팅 초안 수락·구역 목록 이름 바꾸기).
    const other = renderHook(() => useZoneCommitMutation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    const input: CommitInput = { request: createBoth(), zone: null, linked: null };
    let second: unknown;
    await act(async () => {
      const first = view.result.current.commit.mutateAsync(input);
      second = await other.result.current.mutateAsync(input).catch((e: unknown) => e);
      await first;
    });
    expect(second).toBeInstanceOf(CommitInFlightError);
    expect(sent('POST', '/api/zones/commit')).toHaveLength(1);
    // 끝난 뒤에는 다시 보낼 수 있다.
    await commit(view, { request: createZoneOnly(), zone: null, linked: null });
    expect(sent('POST', '/api/zones/commit')).toHaveLength(2);
  });

  it('구역 ARCHIVE: 구역과, 응답이 알려 준 보관한 작업면을 목록에서 뺀다(화면의 linked 가 아니라 응답 값)', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-02');

    // 화면은 이은 작업면을 몰라도(linked: null) 서버가 함께 보관한 작업면이 빠진다.
    const { result } = await commit(view, {
      request: { zone: { op: 'ARCHIVE', zone_id: 'z-02' } },
      zone,
      linked: null,
    });

    expect(trace()).toEqual(['GET /api/zones', 'POST /api/zones/commit']);
    expect(result).toMatchObject({
      zone_id: 'z-02',
      zone: null,
      archived_surface_id: 'ws-0a0c0001',
    });
    expect(zoneIds()).toEqual(['z-04']);
    expect(surfaceIds()).toEqual(['ws-0a0c0002']);
    expect(bundleVersions()).toEqual(['cfg-13', 'cfg-12']);
    expect(result.bundle?.items.map((item) => item.item_id)).not.toContain('z-02');
    expect(result.bundle?.items.map((item) => item.item_id)).not.toContain('ws-0a0c0001');
  });

  it('작업면이 없는 구역을 ARCHIVE 하면 구역만 빠지고 작업면 목록은 그대로다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    const surfacesBefore = rows(STATIC_OBJECTS_KEY);

    const { result } = await commit(view, {
      request: { zone: { op: 'ARCHIVE', zone_id: 'z-04' } },
      zone,
      linked: null,
    });

    expect(result.archived_surface_id).toBeNull();
    expect(zoneIds()).toEqual(['z-02']);
    expect(rows(STATIC_OBJECTS_KEY)).toEqual(surfacesBefore);
  });

  it('작업면 REPLACE: 옛 작업면은 빠지고 새 작업면이 그 구역에 이어져 들어간다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-02');
    const linked = surfaceIn(view, 'ws-0a0c0001');
    const zonesBefore = rows(ZONES_KEY);

    const { result } = await commit(view, {
      request: { zone: keep('z-02'), surface: surfaceUpdate(linked, 'REPLACE') },
      zone,
      linked,
    });

    expect(trace()).toEqual(['GET /api/static-objects', 'POST /api/zones/commit']);
    expect(result.archived_surface_id).toBe('ws-0a0c0001');
    expect(result.surface).toMatchObject({ zone_id: 'z-02', object_version: 1 });
    expect(result.surface?.object_id).toMatch(/^ws-[0-9a-f]{8}$/);
    expect(surfaceIds()).toEqual(['ws-0a0c0002', result.surface?.object_id]);
    expect(rows(ZONES_KEY)).toEqual(zonesBefore);
  });

  it('작업면 ARCHIVE(구역 KEEP): 작업면만 목록에서 빠진다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-02');
    const linked = surfaceIn(view, 'ws-0a0c0001');
    const zonesBefore = rows(ZONES_KEY);

    const { result } = await commit(view, {
      request: { zone: keep('z-02'), surface: { op: 'ARCHIVE', object_id: 'ws-0a0c0001' } },
      zone,
      linked,
    });

    expect(trace()).toEqual(['GET /api/static-objects', 'POST /api/zones/commit']);
    expect(result).toMatchObject({ zone: null, surface: null, archived_surface_id: 'ws-0a0c0001' });
    expect(surfaceIds()).toEqual(['ws-0a0c0002']);
    expect(rows(ZONES_KEY)).toEqual(zonesBefore);
  });
});

describe('useZoneCommitMutation: 구성 묶음을 못 만든 저장', () => {
  it.each([
    'CURRENT_CALIBRATION_MISSING',
    'CALIBRATION_MISSING',
    'RULES_MISSING',
    'PUBLIC_URL_NOT_SET',
  ] as const)(
    '%s: publish: false 로 한 번 더 보내 저장만 하고 publishError 에 첫 오류를 담는다',
    async (code) => {
      const view = await run();
      const zone = zoneIn(view, 'z-04');
      const request = zoneUpdateRequest(zone, { name: '묶음 없이' });
      const bundlesBefore = rows(BUNDLES_KEY);
      zonesMock.failNextPublish(code);

      const done = await commit(view, { request, zone, linked: null });

      // 같은 본문을 publish: true 로 한 번, publish: false 로 한 번 보낸다(서버는 첫 시도를 되돌렸다).
      expect(await commitBodies()).toEqual([
        { ...request, publish: true },
        { ...request, publish: false },
      ]);
      expect(done.publishError).toBeInstanceOf(ApiError);
      expect(done.publishError).toMatchObject({
        code,
        status: PUBLISH_FAILURES[code].status,
        kind: 'HTTP',
      });
      expect(done.result.bundle).toBeNull();
      // 저장은 반영된다. 되돌아간 첫 시도가 버전을 쓰지 않아 v2 다.
      expect(done.result.zone).toMatchObject({ zone_version: 2, name: '묶음 없이' });
      expect(rowOf(ZONES_KEY, 'zone_id', 'z-04')).toMatchObject({
        zone_version: 2,
        name: '묶음 없이',
      });
      // 묶음은 없으니 묶음 캐시는 건드리지 않는다.
      expect(rows(BUNDLES_KEY)).toEqual(bundlesBefore);
      expect(bundleVersions()).toEqual(['cfg-12']);
      // 다시 받을 일이 아니다.
      await settle();
      expect(gets()).toEqual({ zones: 1, surfaces: 0, bundles: 0 });
    },
  );

  it('구역+작업면 새로 만들기도 같은 본문으로 다시 보내 둘 다 저장한다', async () => {
    const view = await run();
    const request = createBoth();
    zonesMock.failNextPublish('CALIBRATION_MISSING');

    const { result, publishError } = await commit(view, { request, zone: null, linked: null });

    expect(await commitBodies()).toEqual([
      { ...request, publish: true },
      { ...request, publish: false },
    ]);
    expect(publishError).toMatchObject({ code: 'CALIBRATION_MISSING' });
    expect(zoneIds()).toEqual(['z-04', 'z-02', result.zone_id]);
    expect(surfaceIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002', result.surface?.object_id]);
    expect(bundleVersions()).toEqual(['cfg-12']);
  });

  it('묶음과 상관없는 409(SITE_NOT_SINGLE)는 다시 보내지 않고 오류로 던진다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    const before = snapshot();
    zonesMock.failNextPublish('SITE_NOT_SINGLE');

    const error = await failure(view, {
      request: zoneUpdateRequest(zone, { name: 'x' }),
      zone,
      linked: null,
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'SITE_NOT_SINGLE' });
    expect(sent('POST', '/api/zones/commit')).toHaveLength(1);
    // 서버가 되돌렸고, 다시 받은 목록도 그대로다.
    await waitFor(() => expect(gets()).toEqual({ zones: 2, surfaces: 1, bundles: 1 }));
    expect(snapshot()).toEqual(before);
  });

  it('묶음 없이 다시 보낸 저장도 실패하면 그 오류를 던지고 세 목록을 다시 받는다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    let count = 0;
    server.use(
      http.post(COMMIT_URL, () =>
        ++count === 1
          ? HttpResponse.json({ status: 409, code: 'CALIBRATION_MISSING' }, { status: 409 })
          : HttpResponse.json({ status: 500 }, { status: 500 }),
      ),
    );

    const error = await failure(view, {
      request: zoneUpdateRequest(zone, { name: 'x' }),
      zone,
      linked: null,
    });

    expect(error).toMatchObject({ status: 500, kind: 'HTTP' });
    expect(count).toBe(2);
    await waitFor(() => expect(gets()).toEqual({ zones: 2, surfaces: 1, bundles: 1 }));
  });
});

describe('useZoneCommitMutation: 저장 실패', () => {
  it('409 SURFACE_ZONE_TAKEN: 다시 보내지 않고 던지며 세 목록을 다시 받는다(캐시의 기존 값은 그대로)', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    // z-02 에 이어진 작업면을 z-04 저장으로 가져오려 한다.
    const owned = surfaceIn(view, 'ws-0a0c0001');
    const before = snapshot();

    const error = await failure(view, {
      request: { zone: keep('z-04'), surface: surfaceUpdate(owned) },
      zone,
      linked: owned,
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'SURFACE_ZONE_TAKEN' });
    // 묶음을 못 만든 오류가 아니라서 다시 보내지 않는다(요청 한 번).
    expect(await commitBodies()).toHaveLength(1);
    // 구역은 확인하지 않아 다시 받기 한 번, 작업면은 확인 한 번 + 다시 받기 한 번, 묶음은 다시 받기 한 번.
    await waitFor(() => expect(gets()).toEqual({ zones: 1, surfaces: 2, bundles: 1 }));
    expect(snapshot()).toEqual(before);
  });

  it('404 ZONE_NOT_FOUND: 다른 관리자가 보관한 구역이면 던지고 세 목록을 다시 받는다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    await fetch('http://api.test/api/zones/z-04', { method: 'DELETE', headers: ADMIN_JSON });
    calls.length = 0;

    const error = await failure(view, {
      request: zoneUpdateRequest(zone, { name: 'x' }),
      zone,
      linked: null,
    });

    // 확인 목록에 그 구역이 이미 없으면 버전 비교로 멈추지 않고 서버가 답하게 한다.
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'ZONE_NOT_FOUND' });
    expect(sent('POST', '/api/zones/commit')).toHaveLength(1);
    await waitFor(() => expect(gets()).toEqual({ zones: 2, surfaces: 1, bundles: 1 }));
    expect(zoneIds()).toEqual(['z-02']);
  });

  it.each([
    [
      'INVALID_RESPONSE(200 인데 모양이 틀림)',
      () => HttpResponse.json({ nope: true }),
      'INVALID_RESPONSE',
    ],
    ['서버 오류 500', () => HttpResponse.json({ status: 500 }, { status: 500 }), 'HTTP'],
    ['네트워크 오류', () => HttpResponse.error(), 'NETWORK'],
  ] as const)('%s: 저장됐는지 모르니 세 목록을 다시 받는다', async (_name, respond, kind) => {
    const view = await run();
    const before = snapshot();
    server.use(http.post(COMMIT_URL, respond));

    const error = await failure(view, { request: createZoneOnly(), zone: null, linked: null });

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind });
    // 만들기는 버전을 확인하지 않아 요청이 저장 한 번과 다시 받기 셋뿐이다.
    await waitFor(() => expect(gets()).toEqual({ zones: 1, surfaces: 1, bundles: 1 }));
    expect(sent('POST', '/api/zones/commit')).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });

  it('서버는 저장했는데 응답이 끊기면 던지고, 다시 받은 목록이 저장된 새 버전·묶음을 보인다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    // 안쪽 요청은 원래 mock 이 저장하고, 바깥 응답만 끊는다.
    let forwarded = false;
    server.use(
      http.post(COMMIT_URL, async ({ request }) => {
        if (forwarded) return undefined;
        forwarded = true;
        await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: await request.text(),
        });
        return HttpResponse.error();
      }),
    );

    const error = await failure(view, {
      request: zoneUpdateRequest(zone, { name: '저장됨' }),
      zone,
      linked: null,
    });

    expect(error).toMatchObject({ kind: 'NETWORK' });
    await waitFor(() => expect(zoneIn(view, 'z-04')).toMatchObject({ version: 2, name: '저장됨' }));
    await waitFor(() => expect(bundleVersions()).toEqual(['cfg-13', 'cfg-12']));
  });

  it('400(INVALID_STATIC_OBJECT)은 다시 받지 않는다. 서버가 구역 저장도 되돌렸다', async () => {
    const view = await run();
    const before = snapshot();
    const request = {
      zone: { op: 'CREATE', body: newZoneBodyOf(NEW_FORM, NEW_SHAPE) },
      surface: {
        op: 'CREATE',
        body: { ...surfaceBodyOf(null, '책상', GEOMETRY), top_height_m: 0 },
      },
    } satisfies ZoneCommitRequest;

    const error = await failure(view, { request, zone: null, linked: null });

    expect(error).toMatchObject({ status: 400, code: 'INVALID_STATIC_OBJECT' });
    expect(client.isFetching()).toBe(0);
    await settle();
    expect(trace()).toEqual(['POST /api/zones/commit']);
    expect(snapshot()).toEqual(before);
    // 서버의 구역도 그대로다(새 구역이 남지 않았다).
    const response = await fetch('http://api.test/api/zones', { headers: ADMIN_JSON });
    expect(await response.json()).toHaveLength(2);
  });

  it('관리자가 아니면 403 을 던지고 다시 받지 않으며 목록은 그대로다', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    auth.token = 'mock-token.viewer';

    const error = await failure(view, {
      request: zoneUpdateRequest(zone, { name: 'x' }),
      zone,
      linked: null,
    });

    expect(error).toMatchObject({ status: 403 });
    expect(client.isFetching()).toBe(0);
    await settle();
    expect(trace()).toEqual(['GET /api/zones', 'POST /api/zones/commit']);
    expect(zoneIn(view, 'z-04')).toMatchObject({ version: 1, name: '개구부 구역' });
    expect(bundleVersions()).toEqual(['cfg-12']);
  });

  it('다시 받는 중이던 옛 목록이 늦게 와도 저장한 새 구역·작업면·묶음을 되돌리지 않는다', async () => {
    const view = await run();
    const old = snapshot();
    // 저장 전에 시작한 다시 받기가 옛 목록을 늦게 준다(처음 한 번만).
    const held = new Set<string>();
    const slowOnce = (path: string, body: JsonBodyType) =>
      http.get(`*${path}`, async () => {
        if (held.has(path)) return undefined;
        held.add(path);
        await delay(150);
        return HttpResponse.json(body);
      });
    server.use(
      slowOnce('/api/zones', old.zones),
      slowOnce('/api/static-objects', old.surfaces),
      slowOnce('/api/config-bundles', old.bundles),
    );
    act(() => {
      for (const queryKey of [ZONES_KEY, STATIC_OBJECTS_KEY, BUNDLES_KEY]) {
        void client.invalidateQueries({ queryKey });
      }
    });

    const { result } = await commit(view, { request: createBoth(), zone: null, linked: null });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));

    expect(zoneIds()).toEqual(['z-04', 'z-02', result.zone_id]);
    expect(surfaceIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002', result.surface?.object_id]);
    expect(bundleVersions()).toEqual(['cfg-13', 'cfg-12']);
  });
});

describe('useZoneCommitMutation: 보내기 직전 버전 확인', () => {
  it.each([
    [
      'UPDATE',
      (zone: Zone): ZoneCommitRequest => zoneUpdateRequest(zone, { severity: 'CRITICAL' }),
    ],
    [
      'ARCHIVE',
      (zone: Zone): ZoneCommitRequest => ({ zone: { op: 'ARCHIVE', zone_id: zone.zoneId } }),
    ],
  ])(
    '구역 %s: 서버의 지금 버전이 고치기 시작한 버전과 다르면 보내지 않고 받은 목록을 캐시에 넣는다',
    async (_op, build) => {
      const view = await run();
      const stale = zoneIn(view, 'z-04');
      await otherAdminSavesZone(stale, '다른 사람');
      calls.length = 0;

      const error = await failure(view, { request: build(stale), zone: stale, linked: null });

      expect(error).toBeInstanceOf(CommitBlockedError);
      expect(error).toMatchObject({ target: 'zone', reason: 'CHANGED' });
      // 확인 GET 하나뿐이다(저장 요청도, 다시 받기도 없다).
      await settle();
      expect(trace()).toEqual(['GET /api/zones']);
      expect(rowOf(ZONES_KEY, 'zone_id', 'z-04')).toMatchObject({
        zone_version: 2,
        name: '다른 사람',
      });
      expect(zoneIn(view, 'z-04')).toMatchObject({ version: 2, name: '다른 사람' });
      expect(bundleVersions()).toEqual(['cfg-12']);
    },
  );

  it.each(['UPDATE', 'REPLACE', 'ARCHIVE'] as const)(
    '작업면 %s: 서버의 지금 버전이 다르면 보내지 않고 받은 작업면 목록을 캐시에 넣는다',
    async (op) => {
      const view = await run();
      const zone = zoneIn(view, 'z-04');
      const stale = surfaceIn(view, 'ws-0a0c0002');
      await otherAdminSavesSurface(stale, '다른 사람');
      calls.length = 0;
      const surface =
        op === 'ARCHIVE' ? ({ op, object_id: stale.objectId } as const) : surfaceUpdate(stale, op);

      const error = await failure(view, {
        request: { zone: keep('z-04'), surface },
        zone,
        linked: stale,
      });

      expect(error).toBeInstanceOf(CommitBlockedError);
      expect(error).toMatchObject({ target: 'surface', reason: 'CHANGED' });
      // 구역은 KEEP 이라 구역 목록은 받지 않는다.
      await settle();
      expect(trace()).toEqual(['GET /api/static-objects']);
      expect(rowOf(STATIC_OBJECTS_KEY, 'object_id', 'ws-0a0c0002')).toMatchObject({
        object_version: 2,
        name: '다른 사람',
      });
      expect(surfaceIn(view, 'ws-0a0c0002')).toMatchObject({ version: 2, name: '다른 사람' });
    },
  );

  it.each([
    ['구역', 'zone', '/api/zones'],
    ['작업면', 'surface', '/api/static-objects'],
  ] as const)(
    '%s 의 지금 버전을 확인하지 못하면 보내지 않고 UNCHECKED 로 멈춘다(목록은 그대로)',
    async (_name, target, path) => {
      const view = await run();
      const zone = zoneIn(view, 'z-02');
      const linked = surfaceIn(view, 'ws-0a0c0001');
      const request: ZoneCommitRequest =
        target === 'zone'
          ? zoneUpdateRequest(zone, { name: 'x' })
          : { zone: keep('z-02'), surface: surfaceUpdate(linked) };
      const before = snapshot();
      server.use(http.get(`*${path}`, () => HttpResponse.error()));

      const error = await failure(view, { request, zone, linked });

      expect(error).toBeInstanceOf(CommitBlockedError);
      expect(error).toMatchObject({ target, reason: 'UNCHECKED' });
      expect((error as CommitBlockedError).cause).toBeInstanceOf(ApiError);
      await settle();
      expect(trace()).toEqual([`GET ${path}`]);
      expect(snapshot()).toEqual(before);
    },
  );

  it('KEEP·CREATE 는 덮어쓰지 않아 버전을 보지 않는다(다른 관리자가 새 버전을 저장했어도 보낸다)', async () => {
    const view = await run();
    const zone = zoneIn(view, 'z-04');
    const stale = surfaceIn(view, 'ws-0a0c0002');
    await otherAdminSavesZone(zone, '다른 사람');
    await otherAdminSavesSurface(stale, '다른 사람');
    calls.length = 0;

    // 구역 KEEP + 작업면 CREATE: 구역·작업면 어느 쪽도 확인하지 않는다.
    const { result } = await commit(view, {
      request: {
        zone: keep('z-04'),
        surface: { op: 'CREATE', body: surfaceBodyOf(null, '새 책상', GEOMETRY) },
      },
      zone,
      linked: null,
    });

    expect(trace()).toEqual(['POST /api/zones/commit']);
    expect(result.surface).toMatchObject({ zone_id: 'z-04', object_version: 1 });
  });
});
