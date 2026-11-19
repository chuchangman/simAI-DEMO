import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createTbmMock } from '@/mocks/tbm';
import { createZonesMock } from '@/mocks/zones';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
const request = (method: string, path: string, body?: unknown) =>
  fetch(`http://api.test${path}`, {
    method,
    headers: { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('작업 레이아웃 구역 목 서버', () => {
  it('시작·진행 중 변경·종료를 구역과 작업면에 반영하고 직접 구역 수정은 막는다', async () => {
    const surfaces = createStaticObjectsMock();
    const zones = createZonesMock({ staticObjects: surfaces.store });
    const tbm = createTbmMock();
    tbm.bindLayoutZones(zones.layoutZones);
    server.resetHandlers(...tbm.handlers, ...zones.handlers, ...surfaces.handlers);
    expect((await request('POST', '/api/work-units/1/start')).status).toBe(200);
    let list = await (await request('GET', '/api/zones')).json();
    const generated = list.find(
      (zone: { layout_item_id?: string }) => zone.layout_item_id === 'pos-01',
    );
    expect(generated).toMatchObject({
      work_id: '1',
      layout_id: 101,
      severity: 'HIGH',
      eval_type: 'VOLUME_3D',
    });
    const objects = await (await request('GET', '/api/static-objects')).json();
    expect(
      objects.find((object: { zone_id?: string }) => object.zone_id === generated.zone_id),
    ).toMatchObject({ layout_item_id: 'pos-01' });
    const denied = await request('POST', '/api/zones/commit', {
      zone: { op: 'ARCHIVE', zone_id: generated.zone_id },
    });
    expect(denied.status).toBe(409);
    expect((await denied.json()).code).toBe('LAYOUT_ZONE_LOCKED');
    const layout = await (await request('GET', '/api/layouts/101')).json();
    layout.items[0].label = '변경된 작업면';
    layout.items.push({
      item_id: 'open-01',
      kind: 'OPENING',
      center: [2, 2, 0.1],
      size: [1, 1, 0.2],
      yaw_rad: 0,
      label: null,
    });
    expect((await request('PUT', '/api/layouts/101', layout)).status).toBe(200);
    list = await (await request('GET', '/api/zones')).json();
    expect(
      list.find((zone: { layout_item_id?: string }) => zone.layout_item_id === 'pos-01'),
    ).toMatchObject({ name: '변경된 작업면' });
    expect(
      list.find((zone: { layout_item_id?: string }) => zone.layout_item_id === 'open-01'),
    ).toMatchObject({ name: '개구부 1', z_min_m: 0, z_max_m: 2 });
    expect((await request('POST', '/api/work-units/1/end')).status).toBe(202);
    list = await (await request('GET', '/api/zones')).json();
    expect(list.some((zone: { work_id?: string }) => zone.work_id === '1')).toBe(false);
    expect(list.some((zone: { zone_id: string }) => zone.zone_id === 'z-04')).toBe(true);
  });
  it('레이아웃이 없는 작업을 시작하면 빈 레이아웃을 연결한다', async () => {
    const surfaces = createStaticObjectsMock();
    const zones = createZonesMock({ staticObjects: surfaces.store });
    const tbm = createTbmMock();
    tbm.works[0]!.layout_id = null;
    tbm.bindLayoutZones(zones.layoutZones);
    server.resetHandlers(...tbm.handlers, ...zones.handlers, ...surfaces.handlers);
    const response = await request('POST', '/api/work-units/1/start');
    expect(response.status).toBe(200);
    const work = await response.json();
    const layout = await (await request('GET', `/api/layouts/${work.layout_id}`)).json();
    expect(layout.items).toEqual([]);
  });
});
