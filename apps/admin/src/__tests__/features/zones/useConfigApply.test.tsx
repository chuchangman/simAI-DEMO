import { BUNDLES_KEY, commitZone, ZONES_KEY } from '@/features/zones/api';
import type { BundleItem, Zone } from '@/features/zones/types';
import {
  publishErrorText,
  readBundles,
  removedItemCount,
  unpublishedSurfaceIds,
  unpublishedZoneIds,
  useConfigApply,
  type PublishableSurface,
} from '@/features/zones/useConfigApply';
import { useZones } from '@/features/zones/useZones';
import { bodyOf, formOf } from '@/features/zones/zoneForm';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock, type ZonesMock } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoneOf } from './zoneFixture';

const auth = vi.hoisted(() => ({ token: 'mock-token.admin' }));
vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => auth.token }) };
});

let mock: ZonesMock;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  auth.token = 'mock-token.admin';
  // Tier 0 ACK 는 발행 0.2초 뒤에 온다.
  mock = createZonesMock({ ackDelayMs: 200 });
  server.resetHandlers(...mock.handlers);
});
afterEach(cleanup);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

async function run() {
  const view = renderHook(
    () => {
      const list = useZones();
      return { list, apply: useConfigApply(list.zones) };
    },
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.list.zones).toHaveLength(2));
  await waitFor(() => expect(view.result.current.apply.unpublished).not.toBeNull());
  return view;
}
type View = Awaited<ReturnType<typeof run>>;
/** 첫 구역의 새 버전을 구성 묶음 없이(publish: false) 저장하고 구역 목록을 다시 받는다(묶음에는 아직 실리지 않은 저장). */
const saveFirstZone = async (view: View) => {
  const zone = view.result.current.list.zones[0]!;
  await act(async () => {
    await commitZone(api, {
      zone: { op: 'UPDATE', zone_id: zone.zoneId, body: bodyOf(zone, formOf(zone), null) },
      publish: false,
    });
    await client.invalidateQueries({ queryKey: ZONES_KEY });
  });
};
const callApi = (method: string, path: string, body?: unknown) =>
  fetch(`http://api.test${path}`, {
    method,
    headers: { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Status = 'PENDING' | 'APPLIED' | 'REJECTED' | 'MISMATCH';
const zoneItem = (id: string, version: number): BundleItem => ({
  item_type: 'ZONE',
  item_id: id,
  item_version: version,
});
const surfaceItem = (id: string, version: number, kind?: string | null): BundleItem => ({
  item_type: 'STATIC_OBJECT',
  item_id: id,
  item_version: version,
  ...(kind === undefined ? {} : { kind }),
});
const ruleItem: BundleItem = { item_type: 'RULE', item_id: 'R2', item_version: 1 };
const bundleOf = (items: BundleItem[], status: Status) => ({
  config_version: 'cfg-12',
  issued_at: 100,
  status,
  applied_at: status === 'APPLIED' ? 150 : null,
  items,
});
const zoneAt = (zoneId: string, version: number): Zone =>
  zoneOf({ zoneId, name: zoneId, min: [0, 0, 0], max: [1, 1, 1] }, { version });
const surfaceAt = (objectId: string, version: number): PublishableSurface => ({
  objectId,
  version,
});

describe('발행 전 판정', () => {
  const latest = readBundles([
    bundleOf(
      [
        zoneItem('z-04', 1),
        zoneItem('z-02', 2),
        ruleItem,
        // 종류가 다르면 같은 ID 라도 다른 항목이다.
        surfaceItem('z-05', 1, 'WORK_SURFACE'),
        surfaceItem('ws-1', 1, 'WORK_SURFACE'),
        surfaceItem('ws-2', 3, null),
        zoneItem('ws-3', 1),
      ],
      'APPLIED',
    ),
  ])[0]!;

  it('마지막 묶음에 같은 ID·같은 버전이 실려 있지 않은 구역만 발행 전이다(없음·옛 버전·새 버전)', () => {
    const zones = [
      zoneAt('z-04', 1), // 실림
      zoneAt('z-02', 1), // 묶음은 v2 이므로 이 버전은 실리지 않았다
      zoneAt('z-05', 1), // 구역으로는 실리지 않았다(같은 ID 의 작업면만 있다)
      zoneAt('z-06', 4), // 묶음에 없다
    ];
    expect([...unpublishedZoneIds(zones, latest)!]).toEqual(['z-02', 'z-05', 'z-06']);
    // 묶음보다 새 버전을 저장했다.
    expect([...unpublishedZoneIds([zoneAt('z-04', 2)], latest)!]).toEqual(['z-04']);
  });

  it('작업면도 같은 규칙이다(종류가 STATIC_OBJECT 인 항목만 본다)', () => {
    const surfaces = [
      surfaceAt('ws-1', 1), // 실림
      surfaceAt('ws-2', 3), // 실림(kind 없음)
      surfaceAt('ws-3', 1), // 같은 ID 의 구역만 실렸다
      surfaceAt('ws-4', 1), // 묶음에 없다
    ];
    expect([...unpublishedSurfaceIds(surfaces, latest)!]).toEqual(['ws-3', 'ws-4']);
    expect([...unpublishedSurfaceIds([surfaceAt('ws-2', 2)], latest)!]).toEqual(['ws-2']);
    expect([...unpublishedSurfaceIds([surfaceAt('ws-1', 2)], latest)!]).toEqual(['ws-1']);
  });

  it('묶음이 없으면(null) 모두 발행 전이고, 묶음 목록을 모르면(undefined) 판정하지 않는다', () => {
    const zones = [zoneAt('z-04', 1), zoneAt('z-02', 1)];
    expect([...unpublishedZoneIds(zones, null)!]).toEqual(['z-04', 'z-02']);
    expect(unpublishedZoneIds(zones, undefined)).toBeNull();
    expect([...unpublishedSurfaceIds([surfaceAt('ws-1', 1)], null)!]).toEqual(['ws-1']);
    expect(unpublishedSurfaceIds([surfaceAt('ws-1', 1)], undefined)).toBeNull();
    expect(unpublishedZoneIds([], null)?.size).toBe(0);
  });

  it('항목이 없는 묶음(옛 형식)도 읽고, 그때는 모두 발행 전이다. 형식이 틀린 묶음은 빼고 읽는다', () => {
    const old = { config_version: 'cfg-10', issued_at: 100, status: 'APPLIED', applied_at: 150 };
    const [read] = readBundles([old]);
    expect(read).toEqual({ ...old, items: [] });
    expect([...unpublishedZoneIds([zoneAt('z-04', 1)], read)!]).toEqual(['z-04']);

    const good = bundleOf([zoneItem('z-04', 1), surfaceItem('ws-1', 2, 'OBSTACLE')], 'APPLIED');
    expect(readBundles([good, { config_version: 'cfg-11', status: 'DONE' }])).toEqual([good]);
    // 규칙·구역 항목은 kind 가 없거나 null 이다.
    expect(readBundles([bundleOf([{ ...ruleItem, kind: null }], 'APPLIED')])).toHaveLength(1);
  });
});

describe('removedItemCount', () => {
  const latest = readBundles([
    bundleOf(
      [
        zoneItem('z-04', 1),
        zoneItem('z-02', 1),
        ruleItem,
        surfaceItem('ws-1', 1, 'WORK_SURFACE'),
        surfaceItem('ws-2', 1),
        surfaceItem('so-1', 1, 'OBSTACLE'),
      ],
      'APPLIED',
    ),
  ])[0]!;

  it('마지막 묶음에는 있지만 지금 목록에 없는 구역·작업면을 센다(규칙·장애물은 세지 않고, kind 가 없으면 작업면이다)', () => {
    expect(removedItemCount([zoneAt('z-04', 2)], [surfaceAt('ws-1', 1)], latest)).toBe(2); // z-02, ws-2
    expect(removedItemCount([zoneAt('z-04', 2)], [], latest)).toBe(3); // z-02, ws-1, ws-2
    expect(removedItemCount([zoneAt('z-04', 1), zoneAt('z-02', 1)], [], latest)).toBe(2);
    // 버전이 바뀌었을 뿐 아직 있는 구역·작업면은 보관한 것이 아니다.
    expect(
      removedItemCount(
        [zoneAt('z-04', 5), zoneAt('z-02', 5)],
        [surfaceAt('ws-1', 9), surfaceAt('ws-2', 9)],
        latest,
      ),
    ).toBe(0);
  });

  it('작업면 목록을 모르면(undefined) 작업면은 세지 않고, 묶음을 모르거나 없으면 0 이다', () => {
    expect(removedItemCount([zoneAt('z-04', 1)], undefined, latest)).toBe(1);
    expect(removedItemCount([], [], undefined)).toBe(0);
    expect(removedItemCount([], [], null)).toBe(0);
  });
});

describe('publishErrorText', () => {
  it('발행 실패 이유를 서버 오류 코드별로 짧게 알린다', () => {
    const text = (status: number, code?: string) =>
      publishErrorText(new ApiError(status, { code }));
    expect(text(403)).toBe('현장에 반영할 권한이 없습니다.');
    expect(text(403, 'FORBIDDEN')).toBe('현장에 반영할 권한이 없습니다.');
    expect(text(409, 'CALIBRATION_MISSING')).toBe('보정 문서가 없어 현장에 반영할 수 없습니다.');
    expect(text(409, 'CURRENT_CALIBRATION_MISSING')).toBe(
      '유효한 보정 문서가 없어 현장에 반영할 수 없습니다.',
    );
    expect(text(409, 'RULES_MISSING')).toBe('유효한 규칙 버전이 없어 현장에 반영할 수 없습니다.');
    expect(text(409, 'SITE_NOT_SINGLE')).toBe(
      '현장이 하나로 정해지지 않아 현장에 반영할 수 없습니다.',
    );
    expect(text(503, 'PUBLIC_URL_NOT_SET')).toBe(
      '서버 공개 주소가 설정되지 않아 현장에 반영할 수 없습니다.',
    );
  });

  it('연결 실패·시간 초과·모르는 오류는 한 문구이고, 서버가 준 문구는 보이지 않는다', () => {
    const generic = '현장에 반영하지 못했습니다. 다시 시도하세요.';
    expect(publishErrorText(new ApiError(500))).toBe(generic);
    expect(publishErrorText(new ApiError(0))).toBe(generic);
    expect(publishErrorText(new ApiError(0, { kind: 'TIMEOUT' }))).toBe(generic);
    expect(publishErrorText(new ApiError(409, { code: 'CONCURRENT_EDIT' }))).toBe(generic);
    expect(
      publishErrorText(new ApiError(409, { code: 'OTHER', serverMessage: 'internal: pg down' })),
    ).toBe(generic);
    expect(publishErrorText(new Error('boom'))).toBe(generic);
    expect(publishErrorText(undefined)).toBe(generic);
  });
});

describe('useConfigApply', () => {
  const zones = [zoneAt('z-04', 1), zoneAt('z-02', 1)];
  const published = [zoneItem('z-04', 1), zoneItem('z-02', 1), ruleItem];

  /** 서버가 주는 묶음 목록을 고정해 훅을 그린다. */
  function renderWith(
    bundles: unknown[],
    initial: { zones: readonly Zone[]; surfaces?: readonly PublishableSurface[] },
  ) {
    server.use(http.get('*/api/config-bundles', () => HttpResponse.json(bundles)));
    return renderHook((props: typeof initial) => useConfigApply(props.zones, props.surfaces), {
      wrapper,
      initialProps: initial,
    });
  }

  it('묶음 목록을 받기 전에는 발행 전을 모르고 발행을 막지 않는다', async () => {
    const view = renderWith([bundleOf(published, 'APPLIED')], { zones });
    expect(view.result.current.latest).toBeUndefined();
    expect(view.result.current.unpublished).toBeNull();
    expect(view.result.current.unpublishedSurfaces).toBeNull();
    expect(view.result.current.removed).toBe(0);
    expect(view.result.current.canPublish).toBe(true);
    await waitFor(() => expect(view.result.current.unpublished).not.toBeNull());
    expect(view.result.current.canPublish).toBe(false);
  });

  const matrix: {
    name: string;
    bundles: () => unknown[];
    zones?: Zone[];
    surfaces?: PublishableSurface[];
    canPublish: boolean;
    unpublished?: string[];
    unpublishedSurfaces?: string[] | null;
    removed?: number;
  }[] = [
    {
      name: '모두 발행했고 현장에 적용됨',
      bundles: () => [bundleOf([...published, surfaceItem('ws-1', 1, 'WORK_SURFACE')], 'APPLIED')],
      surfaces: [surfaceAt('ws-1', 1)],
      canPublish: false,
      unpublished: [],
      unpublishedSurfaces: [],
    },
    {
      name: '작업면 목록을 모르면(undefined) 작업면은 세지 않는다',
      bundles: () => [bundleOf(published, 'APPLIED')],
      canPublish: false,
      unpublished: [],
      unpublishedSurfaces: null,
    },
    {
      name: '모두 발행했고 적용 대기(PENDING)면 막는다',
      bundles: () => [bundleOf(published, 'PENDING')],
      canPublish: false,
    },
    {
      name: '새 버전을 저장한 구역이 있다',
      bundles: () => [bundleOf(published, 'APPLIED')],
      zones: [zoneAt('z-04', 2), zoneAt('z-02', 1)],
      canPublish: true,
      unpublished: ['z-04'],
    },
    {
      name: '새로 만든 구역이 있다',
      bundles: () => [bundleOf(published, 'APPLIED')],
      zones: [...zones, zoneAt('z-new', 1)],
      canPublish: true,
      unpublished: ['z-new'],
    },
    {
      name: '새 버전을 저장한 작업면이 있다',
      bundles: () => [bundleOf([...published, surfaceItem('ws-1', 1, 'WORK_SURFACE')], 'APPLIED')],
      surfaces: [surfaceAt('ws-1', 2)],
      canPublish: true,
      unpublished: [],
      unpublishedSurfaces: ['ws-1'],
    },
    {
      name: '구역을 보관해 묶음에서 빠질 항목만 있다',
      bundles: () => [bundleOf(published, 'APPLIED')],
      zones: [zoneAt('z-04', 1)],
      canPublish: true,
      unpublished: [],
      removed: 1,
    },
    {
      name: '작업면을 보관해 묶음에서 빠질 항목만 있다',
      bundles: () => [bundleOf([...published, surfaceItem('ws-1', 1, 'WORK_SURFACE')], 'APPLIED')],
      surfaces: [],
      canPublish: true,
      unpublishedSurfaces: [],
      removed: 1,
    },
    {
      name: '장애물이 묶음에 있어도 작업면 목록에 없다고 세지 않는다',
      bundles: () => [bundleOf([...published, surfaceItem('so-1', 1, 'OBSTACLE')], 'APPLIED')],
      surfaces: [],
      canPublish: false,
      removed: 0,
    },
    {
      name: '마지막 묶음을 Tier 0 가 거부했다(발행 전이 없어도 다시 발행한다)',
      bundles: () => [bundleOf(published, 'REJECTED')],
      canPublish: true,
      unpublished: [],
    },
    {
      name: '마지막 묶음이 해시 불일치(MISMATCH)다',
      bundles: () => [bundleOf(published, 'MISMATCH')],
      canPublish: true,
      unpublished: [],
    },
    {
      name: '묶음이 하나도 없고 구역이 있다',
      bundles: () => [],
      canPublish: true,
      unpublished: ['z-04', 'z-02'],
    },
    {
      name: '묶음도 구역도 없다',
      bundles: () => [],
      zones: [],
      canPublish: false,
      unpublished: [],
    },
  ];
  it.each(matrix)('canPublish: $name', async (c) => {
    const view = renderWith(c.bundles(), { zones: c.zones ?? zones, surfaces: c.surfaces });
    await waitFor(() => expect(view.result.current.unpublished).not.toBeNull());
    const now = view.result.current;
    expect(now.canPublish).toBe(c.canPublish);
    if (c.unpublished) expect([...now.unpublished!]).toEqual(c.unpublished);
    if (c.unpublishedSurfaces !== undefined) {
      expect(now.unpublishedSurfaces === null ? null : [...now.unpublishedSurfaces]).toEqual(
        c.unpublishedSurfaces,
      );
    }
    expect(now.removed).toBe(c.removed ?? 0);
  });

  it('작업면을 주면 따로 발행 전을 세고(구역 수는 그대로), 작업면을 모르면 0 으로 보아 발행을 막지 않는다', async () => {
    const view = renderHook(
      (props: { surfaces?: PublishableSurface[] }) => {
        const list = useZones();
        return useConfigApply(list.zones, props.surfaces);
      },
      { wrapper, initialProps: {} },
    );
    await waitFor(() => expect(view.result.current.unpublished).not.toBeNull());
    expect(view.result.current.unpublishedSurfaces).toBeNull();
    expect(view.result.current.canPublish).toBe(false);

    // cfg-12 는 작업면 ws-0a0c0001·ws-0a0c0002 v1 을 싣고 있다.
    view.rerender({
      surfaces: [surfaceAt('ws-0a0c0001', 1), surfaceAt('ws-0a0c0002', 2), surfaceAt('ws-new', 1)],
    });
    await waitFor(() =>
      expect([...view.result.current.unpublishedSurfaces!]).toEqual(['ws-0a0c0002', 'ws-new']),
    );
    expect(view.result.current.unpublished?.size).toBe(0);
    expect(view.result.current.canPublish).toBe(true);
    view.rerender({ surfaces: [surfaceAt('ws-0a0c0001', 1), surfaceAt('ws-0a0c0002', 1)] });
    await waitFor(() => expect(view.result.current.unpublishedSurfaces?.size).toBe(0));
    expect(view.result.current.canPublish).toBe(false);
  });

  it('최근 묶음 목록의 첫 묶음으로 적용 상태를 보이고, 저장한 구역은 발행 전이다', async () => {
    const view = await run();
    expect(view.result.current.apply.latest).toMatchObject({
      config_version: 'cfg-12',
      status: 'APPLIED',
    });
    expect(view.result.current.apply.latest?.items).toContainEqual(zoneItem('z-04', 1));
    expect(view.result.current.apply.unpublished?.size).toBe(0);
    expect(view.result.current.apply.removed).toBe(0);

    await saveFirstZone(view);
    await waitFor(() => expect([...view.result.current.apply.unpublished!]).toEqual(['z-04']));
  });

  it('발행하면 응답한 새 묶음을 적용 대기로 보이고 발행 전이 사라지며, 적용 대기 동안 다시 받아 현장 적용됨이 된다', async () => {
    const view = await run();
    await saveFirstZone(view);
    await act(() => view.result.current.apply.publish.mutateAsync());

    await waitFor(() =>
      expect(view.result.current.apply.latest).toMatchObject({
        config_version: 'cfg-13',
        status: 'PENDING',
      }),
    );
    expect(view.result.current.apply.latest?.items).toContainEqual(zoneItem('z-04', 2));
    expect(view.result.current.apply.unpublished?.size).toBe(0);
    await waitFor(
      () => expect(view.result.current.apply.latest).toMatchObject({ status: 'APPLIED' }),
      { timeout: 5_000 },
    );
  });

  it('구역을 보관하면 묶음에서 빠질 항목으로 세고(발행을 열어 둔다), 발행하면 사라진다', async () => {
    const view = await run();
    expect(view.result.current.apply.canPublish).toBe(false);

    expect((await callApi('DELETE', '/api/zones/z-02')).status).toBe(204);
    await act(() => client.invalidateQueries({ queryKey: ZONES_KEY }));
    await waitFor(() => expect(view.result.current.list.zones).toHaveLength(1));
    expect(view.result.current.apply.removed).toBe(1);
    expect(view.result.current.apply.unpublished?.size).toBe(0);
    expect(view.result.current.apply.canPublish).toBe(true);

    await act(() => view.result.current.apply.publish.mutateAsync());
    await waitFor(() => expect(view.result.current.apply.latest?.config_version).toBe('cfg-13'));
    expect(view.result.current.apply.latest?.items).not.toContainEqual(zoneItem('z-02', 1));
    expect(view.result.current.apply.removed).toBe(0);
    await waitFor(() => expect(view.result.current.apply.canPublish).toBe(false));
  });

  it('작업면을 새 버전으로 저장하거나 보관하면 발행 전·보관으로 세고, 발행하면 묶음에 지금 작업면이 실린다', async () => {
    const surfacesMock = createStaticObjectsMock();
    mock = createZonesMock({ ackDelayMs: 200, staticObjects: surfacesMock.store });
    server.resetHandlers(...mock.handlers, ...surfacesMock.handlers);
    const toSurfaces = () =>
      surfacesMock.current().map((o) => ({ objectId: o.object_id, version: o.object_version }));
    const view = renderHook(
      (props: { surfaces: PublishableSurface[] }) => {
        const list = useZones();
        return useConfigApply(list.zones, props.surfaces);
      },
      { wrapper, initialProps: { surfaces: toSurfaces() } },
    );
    await waitFor(() => expect(view.result.current.unpublishedSurfaces?.size).toBe(0));
    expect(view.result.current.canPublish).toBe(false);

    const desk = surfacesMock.current().find((o) => o.object_id === 'ws-0a0c0002')!;
    await callApi('PUT', '/api/static-objects/ws-0a0c0002', {
      kind: 'WORK_SURFACE',
      name: '교탁',
      obb: desk.obb,
      top_height_m: desk.top_height_m,
      top_height_sigma_m: null,
    });
    view.rerender({ surfaces: toSurfaces() });
    await waitFor(() =>
      expect([...view.result.current.unpublishedSurfaces!]).toEqual(['ws-0a0c0002']),
    );
    expect(view.result.current.canPublish).toBe(true);

    expect((await callApi('DELETE', '/api/static-objects/ws-0a0c0001')).status).toBe(204);
    view.rerender({ surfaces: toSurfaces() });
    await waitFor(() => expect(view.result.current.removed).toBe(1));

    await act(() => view.result.current.publish.mutateAsync());
    await waitFor(() =>
      expect(
        view.result.current.latest?.items.filter((i) => i.item_type === 'STATIC_OBJECT'),
      ).toEqual([surfaceItem('ws-0a0c0002', 2, 'WORK_SURFACE')]),
    );
    expect(view.result.current.unpublishedSurfaces?.size).toBe(0);
    expect(view.result.current.removed).toBe(0);
    await waitFor(() => expect(view.result.current.canPublish).toBe(false));
  });

  it('발행이 서버 오류로 거절되면 묶음은 그대로이고 오류 이유를 문구로 알며, 다시 발행하면 된다', async () => {
    const view = await run();
    await saveFirstZone(view);
    await waitFor(() => expect(view.result.current.apply.canPublish).toBe(true));

    for (const code of ['CALIBRATION_MISSING', 'PUBLIC_URL_NOT_SET'] as const) {
      mock.failNextPublish(code);
      let error: unknown = null;
      await act(async () => {
        error = await view.result.current.apply.publish.mutateAsync().then(
          () => null,
          (e: unknown) => e,
        );
      });
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code });
      expect(publishErrorText(error)).toContain('현장에 반영할 수 없습니다.');
      expect(view.result.current.apply.latest?.config_version).toBe('cfg-12');
      expect(view.result.current.apply.canPublish).toBe(true);
    }

    await act(() => view.result.current.apply.publish.mutateAsync());
    await waitFor(() => expect(view.result.current.apply.latest?.config_version).toBe('cfg-13'));
    expect(view.result.current.apply.unpublished?.size).toBe(0);
  });

  it('발행 전 구역이 없으면 발행을 막고, Tier 0 가 거부하면 적용 거부와 계속 쓰는 묶음(이전 묶음)을 주며 다시 발행할 수 있다', async () => {
    const view = await run();
    expect(view.result.current.apply.canPublish).toBe(false);
    await saveFirstZone(view);
    await waitFor(() => expect(view.result.current.apply.canPublish).toBe(true));

    mock.rejectNextBundle();
    await act(() => view.result.current.apply.publish.mutateAsync());
    await waitFor(() => expect(view.result.current.apply.canPublish).toBe(false));
    await waitFor(
      () =>
        expect(view.result.current.apply.latest).toMatchObject({
          config_version: 'cfg-13',
          status: 'REJECTED',
          last_ack: { active_config_version: 'cfg-12' },
        }),
      { timeout: 5_000 },
    );
    expect(view.result.current.apply.unpublished?.size).toBe(0);
    expect(view.result.current.apply.canPublish).toBe(true);
  });

  it('발행하는 동안 받던 옛 목록이 늦게 와도 새 묶음(적용 대기)을 되돌리지 않는다', async () => {
    const view = await run();
    const before = await (await callApi('GET', '/api/config-bundles')).json();
    let held = false;
    server.use(
      http.get('*/api/config-bundles', async () => {
        if (held) return undefined;
        held = true;
        await delay(150);
        return HttpResponse.json(before);
      }),
    );
    act(() => {
      void client.invalidateQueries({ queryKey: BUNDLES_KEY });
    });
    await act(() => view.result.current.apply.publish.mutateAsync());
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(view.result.current.apply.latest).toMatchObject({
      config_version: 'cfg-13',
      status: 'PENDING',
    });
  });

  it('구역 편집 화면에 들어오면 구역을 다시 받아, 그 전에 다른 관리자가 저장한 구역도 발행 전으로 보인다', async () => {
    const list = renderHook(() => useZones(), { wrapper });
    await waitFor(() => expect(list.result.current.zones).toHaveLength(2));
    const z04 = list.result.current.zones[0]!;
    await callApi(
      'PUT',
      '/api/zones/z-04',
      bodyOf(z04, { ...formOf(z04), name: '다른 사람' }, null),
    );

    const page = renderHook(
      () => {
        const { zones: current } = useZones();
        return useConfigApply(current);
      },
      { wrapper },
    );
    await waitFor(() => expect([...(page.result.current.unpublished ?? [])]).toEqual(['z-04']));
    expect(page.result.current.canPublish).toBe(true);
  });
});
