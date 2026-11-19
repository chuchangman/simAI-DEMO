import type { StaticObjectBody, StaticObjectItem } from '@/features/surfaces/types';
import { commitZone, deleteZone } from '@/features/zones/api';
import {
  zoneCommitResultSchema,
  type ZoneCommitResult,
  type ZoneItem,
} from '@/features/zones/types';
import { bodyOf, formOf } from '@/features/zones/zoneForm';
import { readZones } from '@/features/zones/zones';
import { ApiError, createHttp } from '@/lib/http';
import {
  createStaticObjectsMock,
  MOCK_STATIC_OBJECTS,
  type StaticObjectsMock,
} from '@/mocks/staticObjects';
import { createStaticObjectStore } from '@/mocks/staticObjectStore';
import {
  createZonesMock,
  MOCK_ZONES,
  PUBLISH_FAILURES,
  SEEDED_AT,
  type PublishFailureCode,
  type ZonesMock,
} from '@/mocks/zones';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const T0 = SEEDED_AT;
let t = T0;
let mock: ZonesMock;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  t = T0;
  mock = createZonesMock({ now: () => t, ackDelayMs: 3_000 });
  server.resetHandlers(...mock.handlers);
});

const call = (method: string, path: string, account: string | null, body?: unknown) =>
  fetch(`http://api.test${path}`, {
    method,
    headers: {
      ...(account ? { Authorization: `Bearer mock-token.${account}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const z04 = readZones(MOCK_ZONES)[0]!;
const body = (name: string) => bodyOf(z04, { ...formOf(z04), name }, null);

describe('구역 mock(BE -120 형식)', () => {
  it('로그인한 계정이면 역할과 상관없이 지금 구역 배열을 주고, 로그인하지 않았으면 401 이다', async () => {
    for (const account of ['admin', 'foreman', 'viewer']) {
      const response = await call('GET', '/api/zones', account);
      expect(await response.json()).toEqual(MOCK_ZONES);
    }
    expect((await call('GET', '/api/zones', null)).status).toBe(401);
  });

  it('고치기·만들기는 관리자만 한다', async () => {
    for (const account of ['foreman', 'viewer']) {
      expect((await call('PUT', '/api/zones/z-04', account, body('x'))).status).toBe(403);
      expect((await call('POST', '/api/zones', account, body('x'))).status).toBe(403);
    }
  });

  it('고치면 지금 버전을 닫고 다음 버전을 더한다(서버처럼 고치기 시작한 버전은 보지 않는다)', async () => {
    t = T0 + 5_000;
    const first = await call('PUT', '/api/zones/z-04', 'admin', body('A'));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      zone_id: 'z-04',
      zone_version: 2,
      name: 'A',
      valid_from: T0 + 5_000,
      valid_to: null,
    });
    const second = await call('PUT', '/api/zones/z-04', 'admin', body('B'));
    expect((await second.json()).zone_version).toBe(3);

    const list = await (await call('GET', '/api/zones', 'viewer')).json();
    expect(readZones(list).find((z) => z.zoneId === 'z-04')).toMatchObject({
      version: 3,
      name: 'B',
    });
    const history: { zone_version: number; valid_to: number | null }[] = await (
      await call('GET', '/api/zones/z-04/versions', 'viewer')
    ).json();
    expect(history.map((v) => [v.zone_version, v.valid_to])).toEqual([
      [1, T0 + 5_000],
      [2, T0 + 5_000],
      [3, null],
    ]);
  });

  it('새 구역은 서버가 정한 z-<8 hex> ID 의 v1 이다', async () => {
    const created = await call('POST', '/api/zones', 'admin', body('새 구역'));
    expect(created.status).toBe(201);
    const zone = await created.json();
    expect(zone).toMatchObject({ zone_version: 1, valid_to: null });
    expect(zone.zone_id).toMatch(/^z-[0-9a-f]{8}$/);
  });

  it('서버와 같이 검사한다: 이름·유형이 비면 INVALID_ZONE, 높이가 맞지 않으면 INVALID_Z_RANGE, 넓이 없는 다각형은 INVALID_POLYGON, 없는 구역은 404', async () => {
    const code = async (response: Response) => [response.status, (await response.json()).code];
    const post = (value: unknown) => call('POST', '/api/zones', 'admin', value);
    expect(await code(await post({ ...body('x'), zone_kind: ' ' }))).toEqual([400, 'INVALID_ZONE']);
    expect(await code(await post({ ...body('x'), z_max_m: null }))).toEqual([
      400,
      'INVALID_Z_RANGE',
    ]);
    expect(await code(await post({ ...body('x'), z_min_m: 3, z_max_m: 1 }))).toEqual([
      400,
      'INVALID_Z_RANGE',
    ]);
    const line = {
      ...body('x'),
      polygon_xy: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    };
    expect(await code(await post(line))).toEqual([400, 'INVALID_POLYGON']);
    expect(await code(await call('PUT', '/api/zones/z-99', 'admin', body('x')))).toEqual([
      404,
      'ZONE_NOT_FOUND',
    ]);
  });
});

describe('구역 보관(삭제) mock', () => {
  const zoneIds = async () =>
    ((await (await call('GET', '/api/zones', 'viewer')).json()) as { zone_id: string }[]).map(
      (z) => z.zone_id,
    );

  it('보관은 관리자만 한다(로그인하지 않았으면 401, 그 밖의 역할은 403)', async () => {
    expect((await call('DELETE', '/api/zones/z-04', null)).status).toBe(401);
    for (const account of ['foreman', 'viewer']) {
      expect((await call('DELETE', '/api/zones/z-04', account)).status).toBe(403);
    }
    expect(await zoneIds()).toEqual(['z-04', 'z-02']);
  });

  it('보관하면 204(본문 없음)이고 목록에서 빠지지만 이력은 남고 지금 버전만 닫힌다', async () => {
    t = T0 + 5_000;
    const response = await call('DELETE', '/api/zones/z-04', 'admin');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(await zoneIds()).toEqual(['z-02']);
    const history: { zone_version: number; valid_to: number | null }[] = await (
      await call('GET', '/api/zones/z-04/versions', 'viewer')
    ).json();
    expect(history.map((v) => [v.zone_version, v.valid_to])).toEqual([[1, T0 + 5_000]]);
  });

  it('다시 보관해도 204 이고 닫은 시각은 그대로이며, 없는 구역은 404 이다', async () => {
    t = T0 + 5_000;
    await call('DELETE', '/api/zones/z-04', 'admin');
    t = T0 + 9_000;
    expect((await call('DELETE', '/api/zones/z-04', 'admin')).status).toBe(204);
    const history: { valid_to: number | null }[] = await (
      await call('GET', '/api/zones/z-04/versions', 'viewer')
    ).json();
    expect(history.map((v) => v.valid_to)).toEqual([T0 + 5_000]);
    const missing = await call('DELETE', '/api/zones/z-99', 'admin');
    expect([missing.status, (await missing.json()).code]).toEqual([404, 'ZONE_NOT_FOUND']);
  });

  it('보관한 구역은 고칠 수 없다(404). 고쳐 가며 쌓은 버전도 모두 이력에 남고, 같은 구역은 되살리지 않는다', async () => {
    await call('PUT', '/api/zones/z-04', 'admin', body('A'));
    await call('DELETE', '/api/zones/z-04', 'admin');
    const put = await call('PUT', '/api/zones/z-04', 'admin', body('B'));
    expect([put.status, (await put.json()).code]).toEqual([404, 'ZONE_NOT_FOUND']);
    expect(await zoneIds()).toEqual(['z-02']);
    const history: { zone_version: number }[] = await (
      await call('GET', '/api/zones/z-04/versions', 'viewer')
    ).json();
    expect(history.map((v) => v.zone_version)).toEqual([1, 2]);
    // 새로 만들면 다른 ID 의 v1 이다.
    const created = await (await call('POST', '/api/zones', 'admin', body('새'))).json();
    expect(created.zone_id).not.toBe('z-04');
    expect(created.zone_version).toBe(1);
  });

  it('고치기도 서버처럼 검사한다: 넓이 없는 다각형 INVALID_POLYGON, 높이가 없는 VOLUME_3D INVALID_Z_RANGE', async () => {
    const code = async (response: Response) => [response.status, (await response.json()).code];
    const line = {
      ...body('x'),
      polygon_xy: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    };
    expect(await code(await call('PUT', '/api/zones/z-04', 'admin', line))).toEqual([
      400,
      'INVALID_POLYGON',
    ]);
    expect(
      await code(await call('PUT', '/api/zones/z-04', 'admin', { ...body('x'), z_min_m: null })),
    ).toEqual([400, 'INVALID_Z_RANGE']);
  });
});

describe('구성 묶음 mock(BE -120 형식)', () => {
  const latest = async () => (await (await call('GET', '/api/config-bundles', 'viewer')).json())[0];

  it('처음에는 cfg-12 가 현장에 적용되어 있다', async () => {
    expect(await latest()).toMatchObject({ config_version: 'cfg-12', status: 'APPLIED' });
    expect(mock.config()).toEqual({
      published_version: 'cfg-12',
      applied_version: 'cfg-12',
      sync: 'CURRENT',
    });
    expect((await call('GET', '/api/config-bundles/cfg-99', 'viewer')).status).toBe(404);
  });

  it('발행하면 적용 대기(PENDING)인 다음 묶음을 주고, Tier 0 ACK 뒤에는 현장 적용됨(APPLIED)이다', async () => {
    t = T0 + 1_000;
    const published = await call('POST', '/api/config-bundles', 'admin', {});
    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({
      config_version: 'cfg-13',
      previous_config_version: 'cfg-12',
      issued_at: T0 + 1_000,
      status: 'PENDING',
      applied_at: null,
      last_ack: null,
    });
    expect(mock.config()).toMatchObject({
      published_version: 'cfg-13',
      applied_version: 'cfg-12',
      sync: 'PENDING',
    });
    t = T0 + 4_000;
    expect(await latest()).toMatchObject({
      config_version: 'cfg-13',
      status: 'APPLIED',
      applied_at: T0 + 4_000,
      last_ack: { active_config_version: 'cfg-13' },
    });
    expect(mock.config()).toMatchObject({ applied_version: 'cfg-13', sync: 'CURRENT' });
    const [, older] = await (await call('GET', '/api/config-bundles', 'viewer')).json();
    expect(older).toMatchObject({
      config_version: 'cfg-12',
      last_ack: { active_config_version: 'cfg-12' },
    });
  });

  it('Tier 0 가 거부하면 REJECTED 이고 이전 묶음을 계속 쓴다. 다음 발행은 다시 받는다', async () => {
    mock.rejectNextBundle();
    await call('POST', '/api/config-bundles', 'admin', {});
    t = T0 + 3_000;
    expect(await latest()).toMatchObject({
      config_version: 'cfg-13',
      status: 'REJECTED',
      last_ack: { active_config_version: 'cfg-12', reject_reason: 'VALIDATION_FAILED' },
    });
    expect(mock.config()).toEqual({
      published_version: 'cfg-13',
      applied_version: 'cfg-12',
      sync: 'STALE',
    });
    await call('POST', '/api/config-bundles', 'admin', {});
    t = T0 + 6_000;
    expect(await latest()).toMatchObject({ config_version: 'cfg-14', status: 'APPLIED' });
  });

  it('발행은 관리자만 하고, 규칙 프로필이 틀리면 400 이다', async () => {
    for (const account of ['foreman', 'viewer']) {
      expect((await call('POST', '/api/config-bundles', account, {})).status).toBe(403);
    }
    const bad = await call('POST', '/api/config-bundles', 'admin', { rule_profile: 'X' });
    expect([bad.status, (await bad.json()).code]).toEqual([400, 'INVALID_RULE_PROFILE']);
    expect(mock.config().published_version).toBe('cfg-12');
  });
});

describe('구성 묶음 항목(items)', () => {
  interface Item {
    item_type: string;
    item_id: string;
    item_version: number;
    kind?: string;
  }
  const itemsOf = async (version?: string): Promise<Item[]> => {
    const response = await call(
      'GET',
      version ? `/api/config-bundles/${version}` : '/api/config-bundles',
      'viewer',
    );
    const json = await response.json();
    return (version ? json : json[0]).items;
  };
  const publish = async () => (await call('POST', '/api/config-bundles', 'admin', {})).json();

  it('처음 묶음(cfg-12)은 구역 둘·규칙·작업면 둘을 싣고 MOCK_ZONES·MOCK_STATIC_OBJECTS 와 같다', async () => {
    const items = await itemsOf();
    expect(items).toEqual([
      { item_type: 'ZONE', item_id: 'z-04', item_version: 1 },
      { item_type: 'ZONE', item_id: 'z-02', item_version: 1 },
      { item_type: 'RULE', item_id: 'R2', item_version: 1 },
      { item_type: 'STATIC_OBJECT', item_id: 'ws-0a0c0001', item_version: 1, kind: 'WORK_SURFACE' },
      { item_type: 'STATIC_OBJECT', item_id: 'ws-0a0c0002', item_version: 1, kind: 'WORK_SURFACE' },
    ]);
    expect(items.filter((i) => i.item_type === 'ZONE').map((i) => i.item_id)).toEqual(
      MOCK_ZONES.map((z) => z.zone_id),
    );
    expect(
      items
        .filter((i) => i.item_type === 'STATIC_OBJECT')
        .map((i) => [i.item_id, i.item_version, i.kind]),
    ).toEqual(MOCK_STATIC_OBJECTS.map((o) => [o.object_id, o.object_version, o.kind]));
    // 단건 조회에도 같은 항목이 온다.
    expect(await itemsOf('cfg-12')).toEqual(items);
  });

  it('발행 응답·단건·목록 모두에 items 가 있고, 발행하는 묶음은 그때 유효한 구역(새 버전·새 구역·보관 반영)을 싣는다', async () => {
    await call('PUT', '/api/zones/z-04', 'admin', body('A'));
    const created = await (await call('POST', '/api/zones', 'admin', body('새'))).json();
    await call('DELETE', '/api/zones/z-02', 'admin');
    const published = await publish();
    const expected = [
      { item_type: 'ZONE', item_id: 'z-04', item_version: 2 },
      { item_type: 'ZONE', item_id: created.zone_id, item_version: 1 },
      { item_type: 'RULE', item_id: 'R2', item_version: 1 },
    ];
    expect(published.items).toEqual(expected);
    expect(await itemsOf('cfg-13')).toEqual(expected);
    expect(await itemsOf()).toEqual(expected);
  });

  it('이미 발행한 묶음의 항목은 구역을 고치거나 보관해도 바뀌지 않는다', async () => {
    await call('PUT', '/api/zones/z-04', 'admin', body('A'));
    await call('DELETE', '/api/zones/z-02', 'admin');
    const before = await itemsOf('cfg-12');
    expect(before).toContainEqual({ item_type: 'ZONE', item_id: 'z-02', item_version: 1 });
    await publish();
    expect(await itemsOf('cfg-12')).toEqual(before);
    const [, older] = await (await call('GET', '/api/config-bundles', 'viewer')).json();
    expect(older.items).toEqual(before);
  });

  it('작업면은 mock 이 들고 있지 않아 staticObjects 저장소의 지금 작업면을 싣는다(종류와 버전은 그 객체의 것이다). 주지 않으면 싣지 않는다', async () => {
    const obstacle: StaticObjectItem = {
      ...MOCK_STATIC_OBJECTS[0]!,
      object_id: 'so-00000001',
      object_version: 3,
      kind: 'OBSTACLE',
      zone_id: null,
    };
    mock = createZonesMock({
      now: () => t,
      ackDelayMs: 3_000,
      staticObjects: createStaticObjectStore([MOCK_STATIC_OBJECTS[1]!, obstacle]),
    });
    server.resetHandlers(...mock.handlers);
    expect((await publish()).items).toEqual([
      { item_type: 'ZONE', item_id: 'z-04', item_version: 1 },
      { item_type: 'ZONE', item_id: 'z-02', item_version: 1 },
      { item_type: 'RULE', item_id: 'R2', item_version: 1 },
      { item_type: 'STATIC_OBJECT', item_id: 'ws-0a0c0002', item_version: 1, kind: 'WORK_SURFACE' },
      { item_type: 'STATIC_OBJECT', item_id: 'so-00000001', item_version: 3, kind: 'OBSTACLE' },
    ]);

    mock = createZonesMock({ now: () => t, ackDelayMs: 3_000 });
    server.resetHandlers(...mock.handlers);
    const bare = (await publish()).items as Item[];
    expect(bare.filter((i) => i.item_type === 'STATIC_OBJECT')).toEqual([]);
  });
});

describe('발행 실패 흉내(failNextPublish)', () => {
  const publish = (account = 'admin') => call('POST', '/api/config-bundles', account, {});
  const codes = Object.keys(PUBLISH_FAILURES) as PublishFailureCode[];

  it('기본은 다음 발행을 409 CALIBRATION_MISSING 으로 거절하고, 묶음은 만들지 않으며 그 다음 발행은 된다', async () => {
    mock.failNextPublish();
    const failed = await publish();
    expect([failed.status, (await failed.json()).code]).toEqual([409, 'CALIBRATION_MISSING']);
    expect(mock.config().published_version).toBe('cfg-12');
    expect((await publish()).status).toBe(201);
    expect(mock.config().published_version).toBe('cfg-13');
  });

  it.each(codes)('%s 는 서버의 오류 상태와 code 로 거절한다', async (code) => {
    mock.failNextPublish(code);
    const failed = await publish();
    expect(failed.status).toBe(code === 'PUBLIC_URL_NOT_SET' ? 503 : 409);
    expect(await failed.json()).toMatchObject({ status: failed.status, code });
  });

  it('로그인하지 않았거나 권한이 없는 요청은 거절을 쓰지 않는다. 발행 요청 하나만 거절한다', async () => {
    mock.failNextPublish('RULES_MISSING');
    expect((await call('POST', '/api/config-bundles', null, {})).status).toBe(401);
    expect((await publish('viewer')).status).toBe(403);
    const failed = await publish();
    expect([failed.status, (await failed.json()).code]).toEqual([409, 'RULES_MISSING']);
    expect((await publish()).status).toBe(201);
  });
});

describe('구역·작업면 한 번 저장 mock(POST /api/zones/commit)', () => {
  // 작업면 mock 과 저장소를 나눠 쓴다(실제 서버처럼 한 DB 의 구역·작업면이다).
  let surfaces: StaticObjectsMock;
  beforeEach(() => {
    surfaces = createStaticObjectsMock({ now: () => t });
    mock = createZonesMock({ now: () => t, ackDelayMs: 3_000, staticObjects: surfaces.store });
    server.resetHandlers(...mock.handlers, ...surfaces.handlers);
  });

  /** 구역·작업면 mock 이 처음 내주는 ID(서버가 8 hex 를 고르는 것을 일련번호로 흉내 낸다). */
  const FIRST_ZONE_ID = 'z-00000001';
  const FIRST_SURFACE_ID = 'ws-00000001';

  const surfaceBody = (overrides: Record<string, unknown> = {}) => ({
    kind: 'WORK_SURFACE',
    name: '새 작업면',
    obb: { center: [6, 2.4, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: 0 },
    top_height_m: 0.74,
    top_height_sigma_m: null,
    ...overrides,
  });
  const obstacleBody = () => surfaceBody({ kind: 'OBSTACLE', top_height_m: null });
  const newZoneAndSurface = () => ({
    zone: { op: 'CREATE', body: body('새 구역') },
    surface: { op: 'CREATE', body: surfaceBody() },
  });

  const commit = (value: unknown, account: string | null = 'admin') =>
    call('POST', '/api/zones/commit', account, value);
  const succeeded = async (response: Response) => {
    expect(response.status).toBe(200);
    return zoneCommitResultSchema.parse(await response.json());
  };
  const failed = async (response: Response) => [response.status, (await response.json()).code];

  const read = async <T>(path: string): Promise<T> =>
    (await call('GET', path, 'viewer')).json() as Promise<T>;
  const zoneList = () => read<ZoneItem[]>('/api/zones');
  const surfaceList = () => read<StaticObjectItem[]>('/api/static-objects');
  const bundleList = () =>
    read<{ config_version: string; items: unknown[] }[]>('/api/config-bundles');
  // 구역·작업면은 새 버전을 목록 뒤에 더하므로 순서 대신 정렬한 ID 로 비교한다.
  const zoneIds = async () => (await zoneList()).map((z) => z.zone_id).sort();
  const surfaceIds = async () => (await surfaceList()).map((o) => o.object_id).sort();
  const zoneHistory = async (zoneId: string) =>
    (await read<ZoneItem[]>(`/api/zones/${zoneId}/versions`)).map((v) => [
      v.zone_version,
      v.valid_to,
    ]);
  const surfaceHistory = async (objectId: string) =>
    (await read<StaticObjectItem[]>(`/api/static-objects/${objectId}/versions`)).map((v) => [
      v.object_version,
      v.valid_to,
    ]);

  const zoneEntry = (id: string, version: number) => ({
    item_type: 'ZONE',
    item_id: id,
    item_version: version,
  });
  const surfaceEntry = (id: string, version: number, kind = 'WORK_SURFACE') => ({
    item_type: 'STATIC_OBJECT',
    item_id: id,
    item_version: version,
    kind,
  });
  const RULE_ENTRY = { item_type: 'RULE', item_id: 'R2', item_version: 1 };
  const itemsOf = (result: ZoneCommitResult) => {
    expect(result.bundle).not.toBeNull();
    return result.bundle!.items;
  };

  /** 요청이 바꿀 수 있는 모든 것: 지금 구역·작업면, 지난 버전, 구성 묶음, 상단 바 상태. */
  const snapshot = async () => ({
    zones: await zoneList(),
    surfaces: await surfaceList(),
    history: await Promise.all([
      zoneHistory('z-04'),
      zoneHistory('z-02'),
      surfaceHistory('ws-0a0c0001'),
      surfaceHistory('ws-0a0c0002'),
    ]),
    bundles: await bundleList(),
    config: mock.config(),
  });
  /** 거절해야 하는 요청: 오류 상태·code 를 확인하고 요청 전 상태와 똑같은지 본다. */
  const expectRejected = async (value: unknown, status: number, errorCode: string) => {
    const before = await snapshot();
    expect(await failed(await commit(value))).toEqual([status, errorCode]);
    expect(await snapshot()).toEqual(before);
  };

  describe('성공', () => {
    it('새 구역(CREATE)만 저장하면 v1 구역과 적용 대기 묶음을 주고 작업면은 건드리지 않는다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(
        await commit({ zone: { op: 'CREATE', body: body('새 구역') } }),
      );
      expect(result.zone).toMatchObject({
        name: '새 구역',
        zone_version: 1,
        valid_from: T0 + 5_000,
        valid_to: null,
      });
      expect(result.zone?.zone_id).toMatch(/^z-[0-9a-f]{8}$/);
      expect(result).toMatchObject({
        zone_id: result.zone?.zone_id,
        surface: null,
        archived_surface_id: null,
      });
      expect(result.bundle).toMatchObject({
        config_version: 'cfg-13',
        status: 'PENDING',
        issued_at: T0 + 5_000,
      });
      expect(await zoneIds()).toEqual(['z-02', 'z-04', result.zone_id].sort());
      expect(await surfaceList()).toEqual(MOCK_STATIC_OBJECTS);
    });

    it('새 구역 + 새 작업면(CREATE)이면 작업면이 새 구역에 이어지고 목록과 묶음에 둘 다 있다', async () => {
      const result = await succeeded(await commit(newZoneAndSurface()));
      const zoneId = result.zone!.zone_id;
      const surface = result.surface!;
      expect(result.zone_id).toBe(zoneId);
      expect(surface).toMatchObject({
        kind: 'WORK_SURFACE',
        object_version: 1,
        zone_id: zoneId,
        valid_to: null,
      });
      expect(surface.object_id).toMatch(/^ws-[0-9a-f]{8}$/);
      expect(result.archived_surface_id).toBeNull();
      // 작업면 mock 의 GET 에도 같은 작업면이 이어진 구역과 함께 보인다.
      expect((await surfaceList()).find((o) => o.object_id === surface.object_id)).toEqual(surface);
      expect(surfaces.store.linkedTo(zoneId)?.object_id).toBe(surface.object_id);
      const expected = [
        zoneEntry('z-04', 1),
        zoneEntry('z-02', 1),
        zoneEntry(zoneId, 1),
        RULE_ENTRY,
        surfaceEntry('ws-0a0c0001', 1),
        surfaceEntry('ws-0a0c0002', 1),
        surfaceEntry(surface.object_id, 1),
      ];
      expect(itemsOf(result)).toEqual(expected);
      // GET 맨 앞의 묶음이 방금 만든 그 묶음이다.
      expect((await bundleList())[0]).toMatchObject({
        config_version: result.bundle?.config_version,
        items: expected,
      });
    });

    it('구역만 고치면(UPDATE) 새 버전이고 지난 버전은 닫히며 묶음에 새 버전이 실린다. 작업면은 그대로다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(
        await commit({ zone: { op: 'UPDATE', zone_id: 'z-04', body: body('A') } }),
      );
      expect(result).toMatchObject({ zone_id: 'z-04', surface: null, archived_surface_id: null });
      expect(result.zone).toMatchObject({
        zone_id: 'z-04',
        zone_version: 2,
        name: 'A',
        valid_from: T0 + 5_000,
        valid_to: null,
      });
      expect(await zoneHistory('z-04')).toEqual([
        [1, T0 + 5_000],
        [2, null],
      ]);
      expect(itemsOf(result)).toContainEqual(zoneEntry('z-04', 2));
      expect(itemsOf(result)).not.toContainEqual(zoneEntry('z-04', 1));
      expect(await surfaceList()).toEqual(MOCK_STATIC_OBJECTS);
    });

    it('구역 UPDATE + 작업면 UPDATE 는 둘 다 새 버전이고 연결이 이어진다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(
        await commit({
          zone: { op: 'UPDATE', zone_id: 'z-02', body: body('단상 B') },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: surfaceBody({ name: '교탁' }) },
        }),
      );
      expect(result.zone).toMatchObject({ zone_id: 'z-02', zone_version: 2, name: '단상 B' });
      expect(result.surface).toMatchObject({
        object_id: 'ws-0a0c0001',
        object_version: 2,
        name: '교탁',
        zone_id: 'z-02',
      });
      expect(itemsOf(result)).toEqual(
        expect.arrayContaining([zoneEntry('z-02', 2), surfaceEntry('ws-0a0c0001', 2)]),
      );
    });

    it('구역 UPDATE + 작업면 CREATE 는 구역이 새 버전이 되고 새 작업면이 그 구역에 이어진다', async () => {
      const result = await succeeded(
        await commit({
          zone: { op: 'UPDATE', zone_id: 'z-04', body: body('A') },
          surface: { op: 'CREATE', body: surfaceBody() },
        }),
      );
      expect(result.zone).toMatchObject({ zone_id: 'z-04', zone_version: 2 });
      expect(result.surface).toMatchObject({ zone_id: 'z-04', object_version: 1 });
      expect(surfaces.store.linkedTo('z-04')?.object_id).toBe(result.surface?.object_id);
    });

    it('KEEP + 작업면 UPDATE 는 구역을 그대로 두고 작업면만 새 버전으로 고친다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-02' },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: surfaceBody({ name: '교탁' }) },
        }),
      );
      expect(result).toMatchObject({ zone_id: 'z-02', zone: null, archived_surface_id: null });
      expect(result.surface).toMatchObject({
        object_id: 'ws-0a0c0001',
        object_version: 2,
        name: '교탁',
        zone_id: 'z-02',
        valid_from: T0 + 5_000,
        valid_to: null,
      });
      expect(await zoneHistory('z-02')).toEqual([[1, null]]);
      expect(await surfaceHistory('ws-0a0c0001')).toEqual([
        [1, T0 + 5_000],
        [2, null],
      ]);
      expect(itemsOf(result)).toContainEqual(zoneEntry('z-02', 1));
      expect(itemsOf(result)).toContainEqual(surfaceEntry('ws-0a0c0001', 2));
      expect(itemsOf(result)).not.toContainEqual(surfaceEntry('ws-0a0c0001', 1));
    });

    it('KEEP + 작업면 CREATE 는 작업면이 없던 구역(z-04)에 새 작업면을 잇는다', async () => {
      const result = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'CREATE', body: surfaceBody() },
        }),
      );
      expect(result).toMatchObject({ zone_id: 'z-04', zone: null, archived_surface_id: null });
      expect(result.surface).toMatchObject({ zone_id: 'z-04', object_version: 1 });
      expect(await surfaceIds()).toEqual(
        ['ws-0a0c0001', 'ws-0a0c0002', result.surface!.object_id].sort(),
      );
      expect(itemsOf(result)).toContainEqual(surfaceEntry(result.surface!.object_id, 1));
      expect(await zoneHistory('z-04')).toEqual([[1, null]]);
    });

    it('KEEP + 작업면 REPLACE 는 옛 작업면을 보관하고 새 작업면을 같은 구역에 잇는다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-02' },
          surface: {
            op: 'REPLACE',
            object_id: 'ws-0a0c0001',
            body: surfaceBody({ name: '새 교탁' }),
          },
        }),
      );
      const added = result.surface!;
      expect(result).toMatchObject({
        zone_id: 'z-02',
        zone: null,
        archived_surface_id: 'ws-0a0c0001',
      });
      expect(added).toMatchObject({ name: '새 교탁', object_version: 1, zone_id: 'z-02' });
      expect(added.object_id).not.toBe('ws-0a0c0001');
      expect(await surfaceIds()).toEqual(['ws-0a0c0002', added.object_id].sort());
      expect(surfaces.store.linkedTo('z-02')?.object_id).toBe(added.object_id);
      expect(await surfaceHistory('ws-0a0c0001')).toEqual([[1, T0 + 5_000]]);
      expect(itemsOf(result)).toEqual([
        zoneEntry('z-04', 1),
        zoneEntry('z-02', 1),
        RULE_ENTRY,
        surfaceEntry('ws-0a0c0002', 1),
        surfaceEntry(added.object_id, 1),
      ]);
    });

    it('KEEP + 작업면 ARCHIVE 는 구역은 두고 작업면만 보관해 목록과 묶음에서 뺀다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-02' },
          surface: { op: 'ARCHIVE', object_id: 'ws-0a0c0001' },
        }),
      );
      expect(result).toMatchObject({
        zone_id: 'z-02',
        zone: null,
        surface: null,
        archived_surface_id: 'ws-0a0c0001',
      });
      expect(await surfaceIds()).toEqual(['ws-0a0c0002']);
      expect(await zoneIds()).toEqual(['z-02', 'z-04']);
      expect(await surfaceHistory('ws-0a0c0001')).toEqual([[1, T0 + 5_000]]);
      expect(itemsOf(result)).toContainEqual(zoneEntry('z-02', 1));
      expect(itemsOf(result)).not.toContainEqual(surfaceEntry('ws-0a0c0001', 1));
      expect(itemsOf(result)).toContainEqual(surfaceEntry('ws-0a0c0002', 1));
    });

    it('연결 없던 작업면(ws-0a0c0002)은 UPDATE 로 이 구역에 가져오고, ARCHIVE 로 보관할 수도 있다', async () => {
      const taken = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0002', body: surfaceBody() },
        }),
      );
      expect(taken.surface).toMatchObject({
        object_id: 'ws-0a0c0002',
        object_version: 2,
        zone_id: 'z-04',
      });
      const archived = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'ARCHIVE', object_id: 'ws-0a0c0002' },
        }),
      );
      expect(archived.archived_surface_id).toBe('ws-0a0c0002');
      expect(await surfaceIds()).toEqual(['ws-0a0c0001']);
    });

    it('보관한 구역에 걸린 작업면은 다른 구역 저장으로 가져올 수 있다(예전 DELETE /api/zones 는 작업면을 보관하지 않는다)', async () => {
      expect((await call('DELETE', '/api/zones/z-02', 'admin')).status).toBe(204);
      expect(await surfaceIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002']);
      const result = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: surfaceBody() },
        }),
      );
      expect(result.surface).toMatchObject({ object_id: 'ws-0a0c0001', zone_id: 'z-04' });
      expect(surfaces.store.linkedTo('z-04')?.object_id).toBe('ws-0a0c0001');
    });

    it('구역 ARCHIVE 는 이은 작업면도 함께 보관하고(archived_surface_id) 묶음에서 둘 다 뺀다', async () => {
      t = T0 + 5_000;
      const result = await succeeded(await commit({ zone: { op: 'ARCHIVE', zone_id: 'z-02' } }));
      expect(result).toMatchObject({
        zone_id: 'z-02',
        zone: null,
        surface: null,
        archived_surface_id: 'ws-0a0c0001',
      });
      expect(await zoneIds()).toEqual(['z-04']);
      expect(await surfaceIds()).toEqual(['ws-0a0c0002']);
      expect(await zoneHistory('z-02')).toEqual([[1, T0 + 5_000]]);
      expect(await surfaceHistory('ws-0a0c0001')).toEqual([[1, T0 + 5_000]]);
      expect(itemsOf(result)).toEqual([
        zoneEntry('z-04', 1),
        RULE_ENTRY,
        surfaceEntry('ws-0a0c0002', 1),
      ]);
      expect((await bundleList())[0]?.items).toEqual(itemsOf(result));
    });

    it('이은 작업면이 없는 구역을 ARCHIVE 하면 archived_surface_id 는 null 이고, 다시 보관해도 성공이며 닫은 시각은 그대로다', async () => {
      t = T0 + 5_000;
      const first = await succeeded(await commit({ zone: { op: 'ARCHIVE', zone_id: 'z-04' } }));
      expect(first).toMatchObject({ zone_id: 'z-04', zone: null, archived_surface_id: null });
      expect(await surfaceList()).toEqual(MOCK_STATIC_OBJECTS);
      t = T0 + 9_000;
      const again = await succeeded(await commit({ zone: { op: 'ARCHIVE', zone_id: 'z-04' } }));
      expect(again).toMatchObject({ zone_id: 'z-04', archived_surface_id: null });
      expect(await zoneHistory('z-04')).toEqual([[1, T0 + 5_000]]);
    });

    it('구역 ARCHIVE 를 다시 보내도 성공이고 이미 보관한 작업면을 다시 담지 않는다(archived_surface_id null)', async () => {
      await commit({ zone: { op: 'ARCHIVE', zone_id: 'z-02' } });
      const again = await succeeded(await commit({ zone: { op: 'ARCHIVE', zone_id: 'z-02' } }));
      expect(again.archived_surface_id).toBeNull();
    });

    it('앞뒤 공백은 서버처럼 떼고, surface·publish 의 null 과 CREATE 의 빈 zone_id 는 없는 것으로 본다', async () => {
      const trimmed = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: ' z-02 ' },
          surface: { op: 'UPDATE', object_id: ' ws-0a0c0001 ', body: surfaceBody() },
        }),
      );
      expect(trimmed).toMatchObject({ zone_id: 'z-02' });
      expect(trimmed.surface).toMatchObject({ object_id: 'ws-0a0c0001', zone_id: 'z-02' });
      const nulls = await succeeded(
        await commit({
          zone: { op: 'CREATE', zone_id: '  ', body: body('새') },
          surface: null,
          publish: null,
        }),
      );
      expect(nulls.zone).toMatchObject({ zone_version: 1 });
      expect(nulls.surface).toBeNull();
      expect(nulls.bundle).not.toBeNull();
    });

    it('staticObjects 를 주지 않으면 작업면은 이 mock 안의 빈 저장소에만 생기고 시드 작업면은 없다', async () => {
      mock = createZonesMock({ now: () => t, ackDelayMs: 3_000 });
      server.resetHandlers(...mock.handlers);
      const result = await succeeded(await commit(newZoneAndSurface()));
      expect(result.surface).toMatchObject({
        object_id: FIRST_SURFACE_ID,
        zone_id: result.zone_id,
      });
      expect(itemsOf(result)).toEqual(expect.arrayContaining([surfaceEntry(FIRST_SURFACE_ID, 1)]));
      expect(itemsOf(result).filter((i) => i.item_type === 'STATIC_OBJECT')).toHaveLength(1);
      expect(
        await failed(
          await commit({
            zone: { op: 'KEEP', zone_id: 'z-02' },
            surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: surfaceBody() },
          }),
        ),
      ).toEqual([404, 'STATIC_OBJECT_NOT_FOUND']);
    });
  });

  describe('publish', () => {
    it.each([undefined, true])(
      'publish 가 %s 이면 묶음을 만들어 bundle 로 주고 새 구역·작업면 버전이 묶음 항목에 실린다',
      async (publish) => {
        const result = await succeeded(await commit({ ...newZoneAndSurface(), publish }));
        expect(result.bundle).toMatchObject({
          config_version: 'cfg-13',
          status: 'PENDING',
          applied_at: null,
        });
        expect(itemsOf(result)).toContainEqual(zoneEntry(result.zone_id, 1));
        expect(itemsOf(result)).toContainEqual(surfaceEntry(result.surface!.object_id, 1));
        const [latest] = await bundleList();
        expect(latest).toMatchObject({ config_version: 'cfg-13', items: itemsOf(result) });
        expect(mock.config()).toMatchObject({ published_version: 'cfg-13', sync: 'PENDING' });
        // Tier 0 ACK 뒤에는 현장 적용됨이다.
        t = T0 + 4_000;
        expect(mock.config()).toEqual({
          published_version: 'cfg-13',
          applied_version: 'cfg-13',
          sync: 'CURRENT',
        });
      },
    );

    it('publish:false 면 구역·작업면만 저장하고 bundle 은 null 이며 묶음이 늘지 않는다. 다음 발행에 함께 실린다', async () => {
      const result = await succeeded(await commit({ ...newZoneAndSurface(), publish: false }));
      expect(result.bundle).toBeNull();
      expect(result.zone).not.toBeNull();
      expect(result.surface).not.toBeNull();
      expect(await zoneIds()).toContain(result.zone_id);
      expect(await surfaceIds()).toContain(result.surface!.object_id);
      expect(await bundleList()).toHaveLength(1);
      expect((await bundleList())[0]?.config_version).toBe('cfg-12');
      expect(mock.config()).toEqual({
        published_version: 'cfg-12',
        applied_version: 'cfg-12',
        sync: 'CURRENT',
      });
      const next = await (await call('POST', '/api/config-bundles', 'admin', {})).json();
      expect(next.config_version).toBe('cfg-13');
      expect(next.items).toContainEqual(zoneEntry(result.zone_id, 1));
      expect(next.items).toContainEqual(surfaceEntry(result.surface!.object_id, 1));
    });

    it('묶음 항목의 작업면 종류와 버전은 저장 결과를 따른다(REPLACE 뒤 새 ID 의 v1)', async () => {
      const result = await succeeded(
        await commit({
          zone: { op: 'KEEP', zone_id: 'z-02' },
          surface: { op: 'REPLACE', object_id: 'ws-0a0c0001', body: surfaceBody() },
        }),
      );
      const kinds = itemsOf(result)
        .filter((i) => i.item_type === 'STATIC_OBJECT')
        .map((i) => [i.item_id, i.item_version, i.kind]);
      expect(kinds).toEqual([
        ['ws-0a0c0002', 1, 'WORK_SURFACE'],
        [result.surface!.object_id, 1, 'WORK_SURFACE'],
      ]);
    });

    describe('failNextPublish', () => {
      const MUTATIONS = [
        { label: '새 구역 + 새 작업면', request: newZoneAndSurface },
        {
          label: '구역 UPDATE + 작업면 REPLACE',
          request: () => ({
            zone: { op: 'UPDATE', zone_id: 'z-02', body: body('단상 B') },
            surface: { op: 'REPLACE', object_id: 'ws-0a0c0001', body: surfaceBody() },
          }),
        },
        {
          label: '구역 ARCHIVE(이은 작업면도 보관)',
          request: () => ({ zone: { op: 'ARCHIVE', zone_id: 'z-02' } }),
        },
      ];

      it.each(MUTATIONS)(
        '$label: publish:true 는 409 CALIBRATION_MISSING 이고 구역·작업면·묶음이 요청 전 그대로이며, 같은 본문을 publish:false 로 보내면 성공한다',
        async ({ request }) => {
          mock.failNextPublish('CALIBRATION_MISSING');
          await expectRejected({ ...request(), publish: true }, 409, 'CALIBRATION_MISSING');
          const saved = await succeeded(await commit({ ...request(), publish: false }));
          expect(saved.bundle).toBeNull();
        },
      );

      it('실패한 요청은 ID 를 쓰지 않는다: 다시 보내면 처음 ID 가 나온다', async () => {
        mock.failNextPublish();
        await expectRejected({ ...newZoneAndSurface(), publish: true }, 409, 'CALIBRATION_MISSING');
        const saved = await succeeded(await commit({ ...newZoneAndSurface(), publish: false }));
        expect(saved.zone_id).toBe(FIRST_ZONE_ID);
        expect(saved.surface?.object_id).toBe(FIRST_SURFACE_ID);
      });

      it('거절은 요청 하나만 하고 그 다음 publish:true 는 된다', async () => {
        mock.failNextPublish();
        await expectRejected({ ...newZoneAndSurface(), publish: true }, 409, 'CALIBRATION_MISSING');
        const ok = await succeeded(await commit({ ...newZoneAndSurface(), publish: true }));
        expect(ok.bundle?.config_version).toBe('cfg-13');
      });

      it('publish 를 빼도(기본 true) 거절한다', async () => {
        mock.failNextPublish('RULES_MISSING');
        await expectRejected(newZoneAndSurface(), 409, 'RULES_MISSING');
      });

      it('publish:false 요청에는 소모되지 않는다. 다음 publish:true 가 거절을 받는다', async () => {
        mock.failNextPublish('RULES_MISSING');
        await succeeded(await commit({ ...newZoneAndSurface(), publish: false }));
        await succeeded(
          await commit({
            zone: { op: 'UPDATE', zone_id: 'z-04', body: body('A') },
            publish: false,
          }),
        );
        expect(await bundleList()).toHaveLength(1);
        await expectRejected(
          { zone: { op: 'UPDATE', zone_id: 'z-04', body: body('B') } },
          409,
          'RULES_MISSING',
        );
        expect(
          (await commit({ zone: { op: 'UPDATE', zone_id: 'z-04', body: body('C') } })).status,
        ).toBe(200);
      });

      it('값·모양이 틀려 먼저 실패한 요청, 로그인·권한 오류 요청에도 소모되지 않는다', async () => {
        mock.failNextPublish('SITE_NOT_SINGLE');
        const invalid = {
          zone: { op: 'CREATE', body: body('새') },
          surface: { op: 'CREATE', body: surfaceBody({ kind: 'TABLE' }) },
        };
        expect(await failed(await commit(invalid))).toEqual([400, 'INVALID_STATIC_OBJECT']);
        expect(await failed(await commit({}))).toEqual([400, 'INVALID_ZONE_COMMIT']);
        expect((await commit(newZoneAndSurface(), null)).status).toBe(401);
        expect((await commit(newZoneAndSurface(), 'viewer')).status).toBe(403);
        await expectRejected(newZoneAndSurface(), 409, 'SITE_NOT_SINGLE');
      });

      const codes = Object.keys(PUBLISH_FAILURES) as PublishFailureCode[];
      it.each(codes)(
        '%s 는 서버의 오류 상태와 code 로 거절하고 아무것도 저장하지 않는다',
        async (code) => {
          mock.failNextPublish(code);
          await expectRejected(
            newZoneAndSurface(),
            code === 'PUBLIC_URL_NOT_SET' ? 503 : 409,
            code,
          );
        },
      );
    });
  });

  describe('실패하면 구역·작업면을 요청 전 그대로 되돌린다', () => {
    const missingZone = (op: 'UPDATE' | 'KEEP' | 'ARCHIVE', zoneId: string) => {
      if (op === 'UPDATE') return { zone: { op, zone_id: zoneId, body: body('x') } };
      if (op === 'KEEP') {
        return { zone: { op, zone_id: zoneId }, surface: { op: 'CREATE', body: surfaceBody() } };
      }
      return { zone: { op, zone_id: zoneId } };
    };

    it('작업면 본문이 틀리면(400 INVALID_STATIC_OBJECT) 같이 보낸 구역 UPDATE 도 되돌려진다', async () => {
      const invalid = [
        surfaceBody({ kind: 'TABLE' }),
        surfaceBody({ top_height_m: 0 }),
        surfaceBody({ obb: { center: [1, 1, 0.2], size: [0, 1, 0.4], yaw_rad: 0 } }),
      ];
      for (const value of invalid) {
        await expectRejected(
          {
            zone: { op: 'UPDATE', zone_id: 'z-04', body: body('A') },
            surface: { op: 'CREATE', body: value },
          },
          400,
          'INVALID_STATIC_OBJECT',
        );
        await expectRejected(
          {
            zone: { op: 'UPDATE', zone_id: 'z-02', body: body('A') },
            surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: value },
          },
          400,
          'INVALID_STATIC_OBJECT',
        );
      }
      expect(await zoneHistory('z-04')).toEqual([[1, null]]);
      expect((await zoneList()).find((z) => z.zone_id === 'z-04')).toMatchObject({
        zone_version: 1,
        name: '개구부 구역',
      });
    });

    it('새 구역 + 틀린 작업면이면 새 구역이 안 생기고 ID 도 쓰지 않는다', async () => {
      await expectRejected(
        {
          zone: { op: 'CREATE', body: body('새 구역') },
          surface: { op: 'CREATE', body: surfaceBody({ kind: 'TABLE' }) },
        },
        400,
        'INVALID_STATIC_OBJECT',
      );
      expect(await zoneIds()).toEqual(['z-02', 'z-04']);
      const saved = await succeeded(await commit({ ...newZoneAndSurface(), publish: false }));
      expect(saved.zone_id).toBe(FIRST_ZONE_ID);
      expect(saved.surface?.object_id).toBe(FIRST_SURFACE_ID);
    });

    it('작업면 REPLACE 가 새 작업면 검사에서 실패하면 먼저 보관한 옛 작업면도 되살린다', async () => {
      await expectRejected(
        {
          zone: { op: 'UPDATE', zone_id: 'z-02', body: body('단상 B') },
          surface: {
            op: 'REPLACE',
            object_id: 'ws-0a0c0001',
            body: surfaceBody({ kind: 'TABLE' }),
          },
        },
        400,
        'INVALID_STATIC_OBJECT',
      );
      expect(await surfaceIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002']);
      expect(await surfaceHistory('ws-0a0c0001')).toEqual([[1, null]]);
      expect(surfaces.store.linkedTo('z-02')?.object_id).toBe('ws-0a0c0001');
    });

    it.each([
      ['KEEP', { op: 'KEEP', zone_id: 'z-02' }],
      ['UPDATE', { op: 'UPDATE', zone_id: 'z-02', body: body('단상 B') }],
    ])(
      '이미 다른 작업면(ws-0a0c0001)이 이어진 구역에 구역 %s + 작업면 CREATE 하면 409 SURFACE_ZONE_TAKEN 이다',
      async (_, zone) => {
        await expectRejected(
          { zone, surface: { op: 'CREATE', body: surfaceBody() } },
          409,
          'SURFACE_ZONE_TAKEN',
        );
        expect(await zoneHistory('z-02')).toEqual([[1, null]]);
      },
    );

    it.each(['UPDATE', 'REPLACE', 'ARCHIVE'])(
      '다른 구역(z-02)에 이어진 작업면(ws-0a0c0001)을 z-04 의 KEEP + 작업면 %s 로 건드리면 409 SURFACE_ZONE_TAKEN 이다',
      async (op) => {
        const surface =
          op === 'ARCHIVE'
            ? { op, object_id: 'ws-0a0c0001' }
            : { op, object_id: 'ws-0a0c0001', body: surfaceBody() };
        await expectRejected(
          { zone: { op: 'KEEP', zone_id: 'z-04' }, surface },
          409,
          'SURFACE_ZONE_TAKEN',
        );
        expect(surfaces.store.linkedTo('z-02')?.object_id).toBe('ws-0a0c0001');
      },
    );

    it('새 구역에 다른 구역의 작업면을 가져오려 하면 409 SURFACE_ZONE_TAKEN 이고 새 구역도 안 생긴다', async () => {
      await expectRejected(
        {
          zone: { op: 'CREATE', body: body('새 구역') },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0001', body: surfaceBody() },
        },
        409,
        'SURFACE_ZONE_TAKEN',
      );
      expect(await zoneIds()).toEqual(['z-02', 'z-04']);
    });

    it.each([
      {
        label: '새 구역 + 장애물 CREATE',
        request: () => ({
          zone: { op: 'CREATE', body: body('새 구역') },
          surface: { op: 'CREATE', body: obstacleBody() },
        }),
      },
      {
        label: 'KEEP + 장애물 CREATE',
        request: () => ({
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'CREATE', body: obstacleBody() },
        }),
      },
      {
        label: '작업면 UPDATE 를 장애물로(PUT /api/static-objects 와 달리 연결을 풀지 않고 거절)',
        request: () => ({
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0002', body: obstacleBody() },
        }),
      },
      {
        label: '구역 UPDATE + 작업면 REPLACE 를 장애물로',
        request: () => ({
          zone: { op: 'UPDATE', zone_id: 'z-02', body: body('단상 B') },
          surface: { op: 'REPLACE', object_id: 'ws-0a0c0001', body: obstacleBody() },
        }),
      },
    ])('$label 은 400 INVALID_SURFACE_ZONE 이고 모두 되돌려진다', async ({ request }) => {
      await expectRejected(request(), 400, 'INVALID_SURFACE_ZONE');
    });

    it.each(['UPDATE', 'KEEP', 'ARCHIVE'] as const)(
      '없는 구역 %s 는 404 ZONE_NOT_FOUND 이다',
      async (op) => {
        await expectRejected(missingZone(op, 'z-99'), 404, 'ZONE_NOT_FOUND');
      },
    );

    it.each(['UPDATE', 'KEEP'] as const)(
      '이미 보관한 구역 %s 도 404 ZONE_NOT_FOUND 이다(보관한 구역은 되살리지 않는다)',
      async (op) => {
        await call('DELETE', '/api/zones/z-04', 'admin');
        await expectRejected(missingZone(op, 'z-04'), 404, 'ZONE_NOT_FOUND');
      },
    );

    it.each([
      {
        op: 'UPDATE',
        surface: { op: 'UPDATE', object_id: 'ws-none', body: surfaceBody() },
      },
      {
        op: 'REPLACE',
        surface: { op: 'REPLACE', object_id: 'ws-none', body: surfaceBody() },
      },
      { op: 'ARCHIVE', surface: { op: 'ARCHIVE', object_id: 'ws-none' } },
    ])(
      '없는 작업면 $op 는 404 STATIC_OBJECT_NOT_FOUND 이고 같이 보낸 구역 UPDATE 도 되돌려진다',
      async ({ surface }) => {
        await expectRejected(
          { zone: { op: 'UPDATE', zone_id: 'z-04', body: body('A') }, surface },
          404,
          'STATIC_OBJECT_NOT_FOUND',
        );
        expect(await zoneHistory('z-04')).toEqual([[1, null]]);
      },
    );

    it('보관한 작업면 UPDATE 도 404 STATIC_OBJECT_NOT_FOUND 이다', async () => {
      await call('DELETE', '/api/static-objects/ws-0a0c0002', 'admin');
      await expectRejected(
        {
          zone: { op: 'KEEP', zone_id: 'z-04' },
          surface: { op: 'UPDATE', object_id: 'ws-0a0c0002', body: surfaceBody() },
        },
        404,
        'STATIC_OBJECT_NOT_FOUND',
      );
    });
  });

  describe('요청 모양이 틀리면 400 INVALID_ZONE_COMMIT 이고 아무것도 바뀌지 않는다', () => {
    const update = { op: 'UPDATE', zone_id: 'z-04', body: body('A') };
    const keep = { op: 'KEEP', zone_id: 'z-04' };
    const create = { op: 'CREATE', body: surfaceBody() };
    const shapes: [string, unknown][] = [
      ['zone 없음', { publish: false }],
      ['빈 객체', {}],
      ['JSON null', null],
      ['알 수 없는 zone op', { zone: { op: 'DELETE', zone_id: 'z-04' } }],
      ['zone op 없음', { zone: { zone_id: 'z-04', body: body('A') } }],
      ['CREATE 에 zone_id', { zone: { op: 'CREATE', zone_id: 'z-04', body: body('A') } }],
      ['CREATE 에 body 없음', { zone: { op: 'CREATE' } }],
      ['UPDATE 에 body 없음', { zone: { op: 'UPDATE', zone_id: 'z-04' } }],
      ['UPDATE 에 zone_id 없음', { zone: { op: 'UPDATE', body: body('A') } }],
      ['UPDATE 에 빈 zone_id', { zone: { op: 'UPDATE', zone_id: '  ', body: body('A') } }],
      ['ARCHIVE 에 body', { zone: { op: 'ARCHIVE', zone_id: 'z-04', body: body('A') } }],
      ['ARCHIVE 에 zone_id 없음', { zone: { op: 'ARCHIVE' } }],
      ['KEEP 에 body', { zone: { ...keep, body: body('A') }, surface: create }],
      ['KEEP 에 zone_id 없음', { zone: { op: 'KEEP' }, surface: create }],
      ['작업면 없는 KEEP', { zone: keep }],
      ['작업면이 null 인 KEEP', { zone: keep, surface: null }],
      [
        '구역 ARCHIVE 에 surface 를 붙임',
        {
          zone: { op: 'ARCHIVE', zone_id: 'z-02' },
          surface: { op: 'ARCHIVE', object_id: 'ws-0a0c0001' },
        },
      ],
      [
        '알 수 없는 surface op',
        { zone: update, surface: { op: 'DELETE', object_id: 'ws-0a0c0001' } },
      ],
      [
        'surface op 없음',
        { zone: update, surface: { object_id: 'ws-0a0c0001', body: surfaceBody() } },
      ],
      [
        '작업면 CREATE 에 object_id',
        { zone: update, surface: { ...create, object_id: 'ws-0a0c0001' } },
      ],
      ['작업면 CREATE 에 body 없음', { zone: update, surface: { op: 'CREATE' } }],
      [
        '작업면 UPDATE 에 object_id 없음',
        { zone: update, surface: { op: 'UPDATE', body: surfaceBody() } },
      ],
      [
        '작업면 UPDATE 에 body 없음',
        { zone: update, surface: { op: 'UPDATE', object_id: 'ws-0a0c0001' } },
      ],
      [
        '작업면 REPLACE 에 object_id 없음',
        { zone: update, surface: { op: 'REPLACE', body: surfaceBody() } },
      ],
      [
        '작업면 REPLACE 에 body 없음',
        { zone: update, surface: { op: 'REPLACE', object_id: 'ws-0a0c0001' } },
      ],
      [
        '작업면 ARCHIVE 에 body',
        { zone: update, surface: { op: 'ARCHIVE', object_id: 'ws-0a0c0001', body: surfaceBody() } },
      ],
      ['작업면 ARCHIVE 에 object_id 없음', { zone: update, surface: { op: 'ARCHIVE' } }],
      ['publish 가 문자열', { zone: update, publish: 'yes' }],
      ['publish 가 숫자', { zone: update, publish: 1 }],
    ];

    it.each(shapes)('%s', async (_, request) => {
      await expectRejected(request, 400, 'INVALID_ZONE_COMMIT');
    });

    it('본문이 JSON 이 아니어도 400 INVALID_ZONE_COMMIT 이다', async () => {
      const before = await snapshot();
      const response = await fetch('http://api.test/api/zones/commit', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' },
        body: '{"zone": ',
      });
      expect(await failed(response)).toEqual([400, 'INVALID_ZONE_COMMIT']);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('권한', () => {
    it('로그인하지 않으면 401 UNAUTHORIZED, foreman·viewer 는 403 FORBIDDEN 이고 아무것도 바뀌지 않는다. admin 만 된다', async () => {
      const before = await snapshot();
      expect(await failed(await commit(newZoneAndSurface(), null))).toEqual([401, 'UNAUTHORIZED']);
      for (const account of ['foreman', 'viewer']) {
        expect(await failed(await commit(newZoneAndSurface(), account))).toEqual([
          403,
          'FORBIDDEN',
        ]);
      }
      expect(await snapshot()).toEqual(before);
      expect((await commit(newZoneAndSurface(), 'admin')).status).toBe(200);
    });

    it('권한 검사가 모양 검사보다 먼저다', async () => {
      expect((await commit({}, null)).status).toBe(401);
      expect((await commit({}, 'foreman')).status).toBe(403);
    });
  });

  describe('구역 본문 검사는 기존 POST·PUT /api/zones 와 같은 code 를 낸다', () => {
    const line = {
      ...body('x'),
      polygon_xy: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    };
    const invalid = [
      { label: '유형이 비면', code: 'INVALID_ZONE', value: { ...body('x'), zone_kind: ' ' } },
      { label: '이름이 비면', code: 'INVALID_ZONE', value: { ...body('x'), name: ' ' } },
      { label: '필드가 없으면', code: 'INVALID_ZONE', value: {} },
      {
        label: '3D 부피에 높이가 없으면',
        code: 'INVALID_Z_RANGE',
        value: { ...body('x'), z_max_m: null },
      },
      {
        label: '최저가 최고보다 높으면',
        code: 'INVALID_Z_RANGE',
        value: { ...body('x'), z_min_m: 3, z_max_m: 1 },
      },
      { label: '넓이 없는 다각형이면', code: 'INVALID_POLYGON', value: line },
    ];

    it.each(invalid)(
      '$label $code: CREATE·UPDATE 모두 거절하고 저장하지 않는다',
      async ({ code, value }) => {
        expect(await failed(await call('POST', '/api/zones', 'admin', value))).toEqual([400, code]);
        expect(await failed(await call('PUT', '/api/zones/z-04', 'admin', value))).toEqual([
          400,
          code,
        ]);
        await expectRejected({ zone: { op: 'CREATE', body: value } }, 400, code);
        await expectRejected({ zone: { op: 'UPDATE', zone_id: 'z-04', body: value } }, 400, code);
        // 작업면이 멀쩡해도 구역이 틀리면 작업면도 저장하지 않는다.
        await expectRejected(
          {
            zone: { op: 'CREATE', body: value },
            surface: { op: 'CREATE', body: surfaceBody() },
          },
          400,
          code,
        );
      },
    );

    it('닫는 점이 있는 다각형은 POST 와 같이 열린 고리로 저장한다', async () => {
      const closed = {
        ...body('닫힘'),
        polygon_xy: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      };
      const result = await succeeded(await commit({ zone: { op: 'CREATE', body: closed } }));
      expect(result.zone?.polygon_xy).toEqual([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]);
    });
  });
});

describe('commitZone(REST 도우미)', () => {
  const http = (account: string) =>
    createHttp({ baseUrl: 'http://api.test', getToken: () => `mock-token.${account}` });
  const surfaceBody: StaticObjectBody = {
    kind: 'WORK_SURFACE',
    name: '새 작업면',
    obb: { center: [6, 2.4, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: 0 },
    top_height_m: 0.74,
    top_height_sigma_m: null,
  };
  beforeEach(() => {
    const surfaces = createStaticObjectsMock({ now: () => t });
    mock = createZonesMock({ now: () => t, ackDelayMs: 3_000, staticObjects: surfaces.store });
    server.resetHandlers(...mock.handlers, ...surfaces.handlers);
  });

  it('응답을 zoneCommitResultSchema 로 읽는다(저장하지 않은 부분은 null)', async () => {
    const result = await commitZone(http('admin'), {
      zone: { op: 'KEEP', zone_id: 'z-02' },
      surface: { op: 'ARCHIVE', object_id: 'ws-0a0c0001' },
      publish: false,
    });
    expect(result).toEqual({
      zone_id: 'z-02',
      zone: null,
      surface: null,
      archived_surface_id: 'ws-0a0c0001',
      bundle: null,
    });
    const created = await commitZone(http('admin'), {
      zone: { op: 'CREATE', body: body('새 구역') },
      surface: { op: 'CREATE', body: surfaceBody },
    });
    expect(created.surface?.zone_id).toBe(created.zone_id);
    expect(created.bundle?.status).toBe('PENDING');
  });

  it('실패는 ApiError(status·code)로 던진다', async () => {
    const error: unknown = await commitZone(http('admin'), {
      zone: { op: 'UPDATE', zone_id: 'z-99', body: body('x') },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'ZONE_NOT_FOUND' });
    await expect(
      commitZone(http('viewer'), { zone: { op: 'ARCHIVE', zone_id: 'z-04' } }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('deleteZone(REST 도우미)', () => {
  const http = (account: string) =>
    createHttp({ baseUrl: 'http://api.test', getToken: () => `mock-token.${account}` });

  it('본문 없는 204 를 성공으로 읽고 구역을 보관한다. 다시 불러도 성공이다', async () => {
    await expect(deleteZone(http('admin'), 'z-04')).resolves.toBeUndefined();
    await expect(deleteZone(http('admin'), 'z-04')).resolves.toBeUndefined();
    const list = await (await call('GET', '/api/zones', 'viewer')).json();
    expect(readZones(list).map((z) => z.zoneId)).toEqual(['z-02']);
  });

  it('권한이 없으면 403, 없는 구역은 404(code)로 던진다', async () => {
    await expect(deleteZone(http('foreman'), 'z-04')).rejects.toMatchObject({ status: 403 });
    const error: unknown = await deleteZone(http('admin'), 'z-99').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'ZONE_NOT_FOUND' });
  });
});
