import { deleteStaticObject } from '@/features/surfaces/api';
import { staticObjectItemSchema, type StaticObjectItem } from '@/features/surfaces/types';
import { ApiError, createHttp } from '@/lib/http';
import {
  createStaticObjectsMock,
  MOCK_STATIC_OBJECTS,
  type StaticObjectsMock,
} from '@/mocks/staticObjects';
import { SEEDED_AT } from '@/mocks/zones';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const T0 = SEEDED_AT;
let t = T0;
let mock: StaticObjectsMock;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  t = T0;
  mock = createStaticObjectsMock({ now: () => t });
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
const surface = (overrides: Record<string, unknown> = {}) => ({
  kind: 'WORK_SURFACE',
  name: '책상',
  obb: { center: [5, 4.6, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: 0 },
  top_height_m: 0.74,
  top_height_sigma_m: null,
  ...overrides,
});
const code = async (response: Response) => [response.status, (await response.json()).code];

describe('작업면·정적 객체 mock(BE -120 geometry 형식)', () => {
  it('로그인한 계정이면 역할과 상관없이 지금 작업면 배열을 주고, 로그인하지 않았으면 401 이다', async () => {
    for (const account of ['admin', 'foreman', 'viewer']) {
      const response = await call('GET', '/api/static-objects', account);
      expect(await response.json()).toEqual(MOCK_STATIC_OBJECTS);
    }
    expect((await call('GET', '/api/static-objects', null)).status).toBe(401);
  });

  it('처음 작업면 둘의 구역 연결은 단상 작업면이 z-02, 책상이 없음(null)이다', async () => {
    const list: StaticObjectItem[] = await (
      await call('GET', '/api/static-objects', 'viewer')
    ).json();
    expect(list.map((o) => [o.object_id, o.zone_id])).toEqual([
      ['ws-0a0c0001', 'z-02'],
      ['ws-0a0c0002', null],
    ]);
    expect(MOCK_STATIC_OBJECTS.map((o) => [o.object_id, o.zone_id])).toEqual([
      ['ws-0a0c0001', 'z-02'],
      ['ws-0a0c0002', null],
    ]);
    list.forEach((o) => staticObjectItemSchema.parse(o));
  });

  it('만들기·고치기는 관리자만 한다', async () => {
    for (const account of ['foreman', 'viewer']) {
      expect((await call('POST', '/api/static-objects', account, surface())).status).toBe(403);
      expect(
        (await call('PUT', '/api/static-objects/ws-0a0c0002', account, surface())).status,
      ).toBe(403);
    }
  });

  it('새 작업면은 ws-, 장애물은 so- 로 시작하는 8 hex ID 의 v1 이고, 상판 높이는 float4 로 돌려준다', async () => {
    const created = await call('POST', '/api/static-objects', 'admin', surface());
    expect(created.status).toBe(201);
    const item = await created.json();
    expect(item).toMatchObject({ object_version: 1, valid_from: T0, valid_to: null });
    expect(item.object_id).toMatch(/^ws-[0-9a-f]{8}$/);
    expect(item.top_height_m).toBe(Math.fround(0.74));
    const obstacle = await (
      await call('POST', '/api/static-objects', 'admin', surface({ kind: 'OBSTACLE' }))
    ).json();
    expect(obstacle.object_id).toMatch(/^so-[0-9a-f]{8}$/);
  });

  it('고치면 지금 버전을 닫고 다음 버전을 더한다(고치기 시작한 버전은 보지 않는다)', async () => {
    t = T0 + 5_000;
    const saved = await call(
      'PUT',
      '/api/static-objects/ws-0a0c0002',
      'admin',
      surface({ name: '교탁', top_height_sigma_m: 0.03 }),
    );
    expect(await saved.json()).toMatchObject({
      object_id: 'ws-0a0c0002',
      object_version: 2,
      name: '교탁',
      top_height_sigma_m: 0.03,
      valid_from: T0 + 5_000,
    });
    const history: { object_version: number; valid_to: number | null }[] = await (
      await call('GET', '/api/static-objects/ws-0a0c0002/versions', 'viewer')
    ).json();
    expect(history.map((v) => [v.object_version, v.valid_to])).toEqual([
      [1, T0 + 5_000],
      [2, null],
    ]);
  });

  it('서버와 같이 검사한다: 종류·크기·상판·표준편차가 틀리면 INVALID_STATIC_OBJECT, 없는 객체는 404', async () => {
    const post = (value: unknown) => call('POST', '/api/static-objects', 'admin', value);
    expect(await code(await post(surface({ kind: 'TABLE' })))).toEqual([
      400,
      'INVALID_STATIC_OBJECT',
    ]);
    expect(
      await code(
        await post(surface({ obb: { center: [1, 1, 0.2], size: [0, 1, 0.4], yaw_rad: 0 } })),
      ),
    ).toEqual([400, 'INVALID_STATIC_OBJECT']);
    expect(await code(await post(surface({ top_height_m: 0 })))).toEqual([
      400,
      'INVALID_STATIC_OBJECT',
    ]);
    expect(await code(await post(surface({ top_height_m: 1e-46 })))).toEqual([
      400,
      'INVALID_STATIC_OBJECT',
    ]);
    expect(await code(await post(surface({ top_height_sigma_m: -0.1 })))).toEqual([
      400,
      'INVALID_STATIC_OBJECT',
    ]);
    // 장애물은 상판 높이가 없어도 된다.
    expect((await post(surface({ kind: 'OBSTACLE', top_height_m: null }))).status).toBe(201);
    expect(
      await code(await call('PUT', '/api/static-objects/ws-none', 'admin', surface())),
    ).toEqual([404, 'STATIC_OBJECT_NOT_FOUND']);
  });
});

describe('작업면의 구역 연결(zone_id)', () => {
  const put = (objectId: string, value: unknown) =>
    call('PUT', `/api/static-objects/${objectId}`, 'admin', value);
  const post = (value: unknown) => call('POST', '/api/static-objects', 'admin', value);
  const versionsOf = async (objectId: string): Promise<StaticObjectItem[]> =>
    (await call('GET', `/api/static-objects/${objectId}/versions`, 'viewer')).json();

  it('만들기는 zone_id 를 주지 않으면 null 로 돌려주고, 주면 그 값을 이어 돌려준다(목록에도 같다)', async () => {
    const plain = staticObjectItemSchema.parse(await (await post(surface())).json());
    expect(plain.zone_id).toBeNull();
    const linked = staticObjectItemSchema.parse(
      await (await post(surface({ zone_id: 'z-04' }))).json(),
    );
    expect(linked.zone_id).toBe('z-04');
    // 빈 글자는 잇지 않는 것이다.
    const blank = staticObjectItemSchema.parse(await (await post(surface({ zone_id: '' }))).json());
    expect(blank.zone_id).toBeNull();
    expect(mock.current().map((o) => [o.object_id, o.zone_id])).toEqual([
      ['ws-0a0c0001', 'z-02'],
      ['ws-0a0c0002', null],
      [plain.object_id, null],
      [linked.object_id, 'z-04'],
      [blank.object_id, null],
    ]);
  });

  it('고칠 때 zone_id 를 주지 않으면 이전 연결을 그대로 둔다(이은 작업면도 안 이은 작업면도)', async () => {
    t = T0 + 5_000;
    expect(await (await put('ws-0a0c0001', surface({ name: '교탁' }))).json()).toMatchObject({
      object_version: 2,
      name: '교탁',
      zone_id: 'z-02',
    });
    expect(await (await put('ws-0a0c0002', surface({ name: '교탁' }))).json()).toMatchObject({
      object_version: 2,
      zone_id: null,
    });
    // 지난 버전은 그때 연결을 그대로 가진다.
    expect((await versionsOf('ws-0a0c0001')).map((v) => [v.object_version, v.zone_id])).toEqual([
      [1, 'z-02'],
      [2, 'z-02'],
    ]);
  });

  it('빈 글자(zone_id: "")는 연결을 풀고, 값이 있으면 그 구역에 잇는다', async () => {
    t = T0 + 5_000;
    const released = await (await put('ws-0a0c0001', surface({ zone_id: '' }))).json();
    expect(released).toMatchObject({ object_version: 2, zone_id: null });
    expect(mock.store.linkedTo('z-02')).toBeUndefined();
    const relinked = await (await put('ws-0a0c0001', surface({ zone_id: 'z-04' }))).json();
    expect(relinked).toMatchObject({ object_version: 3, zone_id: 'z-04' });
    // 안 이었던 작업면도 값을 주면 이어진다.
    const linked = await (await put('ws-0a0c0002', surface({ zone_id: 'z-02' }))).json();
    expect(linked).toMatchObject({ object_version: 2, zone_id: 'z-02' });
    expect(mock.current().map((o) => [o.object_id, o.zone_id])).toEqual([
      ['ws-0a0c0001', 'z-04'],
      ['ws-0a0c0002', 'z-02'],
    ]);
    expect((await versionsOf('ws-0a0c0001')).map((v) => [v.object_version, v.zone_id])).toEqual([
      [1, 'z-02'],
      [2, null],
      [3, 'z-04'],
    ]);
  });

  it('장애물(OBSTACLE)로 바꾸면 zone_id 를 주지 않아도 연결을 풀고, 되돌려도 다시 잇지 않는다', async () => {
    t = T0 + 5_000;
    const obstacle = await (
      await put('ws-0a0c0001', surface({ kind: 'OBSTACLE', top_height_m: null }))
    ).json();
    expect(obstacle).toMatchObject({ object_version: 2, kind: 'OBSTACLE', zone_id: null });
    expect(mock.store.linkedTo('z-02')).toBeUndefined();
    const back = await (await put('ws-0a0c0001', surface())).json();
    expect(back).toMatchObject({ object_version: 3, kind: 'WORK_SURFACE', zone_id: null });
    // 빈 글자는 장애물이어도 잇지 않는 것이라 통과한다.
    const blank = await put('ws-0a0c0002', surface({ kind: 'OBSTACLE', zone_id: '' }));
    expect(blank.status).toBe(200);
  });

  it('장애물에 구역을 이으려 하면 400 INVALID_SURFACE_ZONE 이고 아무것도 바뀌지 않는다', async () => {
    const obstacle = surface({ kind: 'OBSTACLE', top_height_m: null, zone_id: 'z-04' });
    expect(await code(await post(obstacle))).toEqual([400, 'INVALID_SURFACE_ZONE']);
    expect(await code(await put('ws-0a0c0001', obstacle))).toEqual([400, 'INVALID_SURFACE_ZONE']);
    expect(mock.current()).toEqual(MOCK_STATIC_OBJECTS);
    expect((await versionsOf('ws-0a0c0001')).map((v) => v.object_version)).toEqual([1]);
    // 본문 값 검사가 먼저다: 값이 틀리면 연결 검사까지 가지 않는다.
    expect(await code(await post({ ...obstacle, kind: 'TABLE' }))).toEqual([
      400,
      'INVALID_STATIC_OBJECT',
    ]);
  });

  it('이 mock 은 구역이 있는지·다른 작업면이 이었는지 보지 않는다(구역 한 번 저장 mock 이 검사한다)', async () => {
    const item = await (await post(surface({ zone_id: 'z-02' }))).json();
    expect(item.zone_id).toBe('z-02');
    expect(mock.current().filter((o) => o.zone_id === 'z-02')).toHaveLength(2);
  });
});

describe('작업면 저장소(store)', () => {
  it('mock 마다 시드를 복제해 가져 서로 섞이지 않고 MOCK_STATIC_OBJECTS 도 바뀌지 않는다', async () => {
    const other = createStaticObjectsMock({ now: () => t });
    expect(other.store).not.toBe(mock.store);
    await call('DELETE', '/api/static-objects/ws-0a0c0001', 'admin');
    expect(mock.current().map((o) => o.object_id)).toEqual(['ws-0a0c0002']);
    expect(other.current()).toEqual(MOCK_STATIC_OBJECTS);
    expect(MOCK_STATIC_OBJECTS.map((o) => o.valid_to)).toEqual([null, null]);
  });

  it('snapshot 을 되돌리면 버전과 ID 발급 순서가 그 시점으로 돌아간다', async () => {
    const before = mock.store.snapshot();
    const first = await (await call('POST', '/api/static-objects', 'admin', surface())).json();
    t = T0 + 5_000;
    await call('PUT', '/api/static-objects/ws-0a0c0001', 'admin', surface({ zone_id: '' }));
    await call('DELETE', '/api/static-objects/ws-0a0c0002', 'admin');
    mock.store.restore(before);
    expect(mock.current()).toEqual(MOCK_STATIC_OBJECTS);
    expect(mock.store.versionsOf('ws-0a0c0001')).toHaveLength(1);
    expect(mock.store.versionsOf(first.object_id)).toEqual([]);
    const again = await (await call('POST', '/api/static-objects', 'admin', surface())).json();
    expect(again.object_id).toBe(first.object_id);
  });
});

describe('작업면·정적 객체 보관(삭제) mock', () => {
  const objectIds = async () =>
    (
      (await (await call('GET', '/api/static-objects', 'viewer')).json()) as { object_id: string }[]
    ).map((o) => o.object_id);

  it('보관은 관리자만 한다(로그인하지 않았으면 401, 그 밖의 역할은 403)', async () => {
    expect((await call('DELETE', '/api/static-objects/ws-0a0c0002', null)).status).toBe(401);
    for (const account of ['foreman', 'viewer']) {
      expect((await call('DELETE', '/api/static-objects/ws-0a0c0002', account)).status).toBe(403);
    }
    expect(await objectIds()).toEqual(['ws-0a0c0001', 'ws-0a0c0002']);
  });

  it('보관하면 204(본문 없음)이고 목록과 current() 에서 빠지지만 이력은 남고 지금 버전만 닫힌다', async () => {
    t = T0 + 5_000;
    const response = await call('DELETE', '/api/static-objects/ws-0a0c0002', 'admin');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(await objectIds()).toEqual(['ws-0a0c0001']);
    expect(mock.current().map((o) => o.object_id)).toEqual(['ws-0a0c0001']);
    const history: { object_version: number; valid_to: number | null }[] = await (
      await call('GET', '/api/static-objects/ws-0a0c0002/versions', 'viewer')
    ).json();
    expect(history.map((v) => [v.object_version, v.valid_to])).toEqual([[1, T0 + 5_000]]);
  });

  it('구역에 이은 작업면을 보관하면 구역의 지금 작업면이 없어지지만 이력에는 이은 구역이 남는다', async () => {
    t = T0 + 5_000;
    expect(mock.store.linkedTo('z-02')?.object_id).toBe('ws-0a0c0001');
    expect((await call('DELETE', '/api/static-objects/ws-0a0c0001', 'admin')).status).toBe(204);
    expect(await objectIds()).toEqual(['ws-0a0c0002']);
    expect(mock.store.linkedTo('z-02')).toBeUndefined();
    const history: { zone_id: string | null; valid_to: number | null }[] = await (
      await call('GET', '/api/static-objects/ws-0a0c0001/versions', 'viewer')
    ).json();
    expect(history.map((v) => [v.zone_id, v.valid_to])).toEqual([['z-02', T0 + 5_000]]);
  });

  it('다시 보관해도 204 이고 닫은 시각은 그대로이며, 없는 객체는 404 이다', async () => {
    t = T0 + 5_000;
    await call('DELETE', '/api/static-objects/ws-0a0c0002', 'admin');
    t = T0 + 9_000;
    expect((await call('DELETE', '/api/static-objects/ws-0a0c0002', 'admin')).status).toBe(204);
    const history: { valid_to: number | null }[] = await (
      await call('GET', '/api/static-objects/ws-0a0c0002/versions', 'viewer')
    ).json();
    expect(history.map((v) => v.valid_to)).toEqual([T0 + 5_000]);
    expect(await code(await call('DELETE', '/api/static-objects/ws-none', 'admin'))).toEqual([
      404,
      'STATIC_OBJECT_NOT_FOUND',
    ]);
  });

  it('보관한 객체는 고칠 수 없다(404). 보관한 ID 를 되살리지 않고 새로 만들면 다른 ID 의 v1 이다', async () => {
    await call('DELETE', '/api/static-objects/ws-0a0c0002', 'admin');
    expect(
      await code(await call('PUT', '/api/static-objects/ws-0a0c0002', 'admin', surface())),
    ).toEqual([404, 'STATIC_OBJECT_NOT_FOUND']);
    const created = await (await call('POST', '/api/static-objects', 'admin', surface())).json();
    expect(created.object_id).not.toBe('ws-0a0c0002');
    expect(created.object_version).toBe(1);
  });

  it('current() 는 보관하지 않은 지금 버전만 준다(고치면 새 버전, 만들면 더해진다)', async () => {
    expect(mock.current()).toEqual(MOCK_STATIC_OBJECTS);
    t = T0 + 5_000;
    await call('PUT', '/api/static-objects/ws-0a0c0002', 'admin', surface({ name: '교탁' }));
    const created = await (
      await call('POST', '/api/static-objects', 'admin', surface({ kind: 'OBSTACLE' }))
    ).json();
    expect(mock.current().map((o) => [o.object_id, o.object_version, o.kind])).toEqual([
      ['ws-0a0c0001', 1, 'WORK_SURFACE'],
      ['ws-0a0c0002', 2, 'WORK_SURFACE'],
      [created.object_id, 1, 'OBSTACLE'],
    ]);
    await call('DELETE', '/api/static-objects/ws-0a0c0001', 'admin');
    expect(mock.current().map((o) => o.object_id)).toEqual(['ws-0a0c0002', created.object_id]);
  });
});

describe('deleteStaticObject(REST 도우미)', () => {
  const http = (account: string) =>
    createHttp({ baseUrl: 'http://api.test', getToken: () => `mock-token.${account}` });

  it('본문 없는 204 를 성공으로 읽고 작업면을 보관한다. 다시 불러도 성공이다', async () => {
    await expect(deleteStaticObject(http('admin'), 'ws-0a0c0002')).resolves.toBeUndefined();
    await expect(deleteStaticObject(http('admin'), 'ws-0a0c0002')).resolves.toBeUndefined();
    expect(mock.current().map((o) => o.object_id)).toEqual(['ws-0a0c0001']);
  });

  it('권한이 없으면 403, 없는 객체는 404(code)로 던진다', async () => {
    await expect(deleteStaticObject(http('viewer'), 'ws-0a0c0002')).rejects.toMatchObject({
      status: 403,
    });
    const error: unknown = await deleteStaticObject(http('admin'), 'ws-none').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'STATIC_OBJECT_NOT_FOUND' });
  });
});
