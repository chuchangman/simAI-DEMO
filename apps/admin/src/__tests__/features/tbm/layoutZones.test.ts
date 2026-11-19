import {
  applyLayoutEdit,
  itemMakesZone,
  itemOfSurface,
  itemOfZoneShape,
  itemSurfaceGeometry,
  layoutZonePlans,
  newLayoutItemId,
  zoneOutlineBox,
} from '@/features/tbm/layoutZones';
import type { LayoutObbItem } from '@/features/tbm/types';
import { openingZoneShape, surfaceZoneShape } from '@/features/zones/zoneShape';
import { describe, expect, it } from 'vitest';

const item = (patch: Partial<LayoutObbItem> = {}): LayoutObbItem => ({
  item_id: 'open-01',
  kind: 'OPENING',
  center: [3, 2, 0.1],
  size: [1.2, 0.8, 0.2],
  yaw_rad: 0,
  label: null,
  ...patch,
});
const surfaceItem = (patch: Partial<LayoutObbItem> = {}) =>
  item({
    item_id: 'surf-01',
    kind: 'WORK_SURFACE',
    center: [5, 4, 0.6],
    size: [2, 1, 1.2],
    ...patch,
  });

describe('itemMakesZone', () => {
  it('고소 작업면(옛 비계 포함)과 새로 만든 개구부만 구역을 만든다', () => {
    expect(itemMakesZone(item())).toBe(true);
    expect(itemMakesZone(surfaceItem())).toBe(true);
    expect(itemMakesZone(item({ kind: 'SCAFFOLD' }))).toBe(true);
  });

  it('구역에서 가져온 개구부와 장비는 만들지 않는다', () => {
    expect(itemMakesZone(item({ source_zone_id: 'z-04' }))).toBe(false);
    expect(itemMakesZone(item({ kind: 'EQUIPMENT' }))).toBe(false);
    expect(itemMakesZone(surfaceItem({ source_zone_id: 'z-04', source_object_id: 'ws-04' }))).toBe(
      false,
    );
  });
});

describe('itemSurfaceGeometry', () => {
  it('고소 작업면 항목의 상판은 가운데 z + 높이 / 2 이다', () => {
    expect(itemSurfaceGeometry(surfaceItem())).toEqual({
      centerXy: [5, 4],
      sizeXy: [2, 1],
      yawRad: 0,
      topHeightM: 1.2,
    });
    expect(
      itemSurfaceGeometry(item({ kind: 'SCAFFOLD', center: [1, 1, 1], size: [1, 1, 2] })),
    ).toMatchObject({
      topHeightM: 2,
    });
  });

  it('작업면이 아닌 항목이나 형상이 틀린 항목은 null 이다', () => {
    expect(itemSurfaceGeometry(item())).toBeNull();
    expect(itemSurfaceGeometry(surfaceItem({ size: [0, 1, 1.2] }))).toBeNull();
  });
});

describe('layoutZonePlans', () => {
  it('고소 작업면은 작업면 둘레 0.3 m 구역과 작업면 형상이고, 개구부는 바깥 0.3 m 구역이다', () => {
    const [opening, surface] = layoutZonePlans([item(), surfaceItem()]);
    expect(opening).toEqual({
      itemId: 'open-01',
      name: '개구부 1',
      shape: openingZoneShape({
        centerXy: [3, 2],
        sizeXy: [1.2, 0.8],
        yawRad: 0,
        bottomZ: 0,
        topZ: 0.2,
      }),
      surface: null,
    });
    expect(surface!.itemId).toBe('surf-01');
    expect(surface!.name).toBe('고소 작업면 1');
    expect(surface!.surface).toEqual(itemSurfaceGeometry(surfaceItem()));
    expect(surface!.shape).toEqual(surfaceZoneShape(surface!.surface!));
    expect(surface!.shape.z_max_m).toBe(2);
  });

  it('이름은 label 이 있으면 label, 없으면 같은 종류의 순번이다(구역을 만들지 않는 항목도 센다)', () => {
    const plans = layoutZonePlans([
      item({ item_id: 'a', source_zone_id: 'z-1' }),
      item({ item_id: 'b' }),
      item({ item_id: 'c', label: ' 통로 ' }),
      item({ item_id: 'd', kind: 'EQUIPMENT' }),
      surfaceItem({ item_id: 'e' }),
      item({ item_id: 'f', kind: 'SCAFFOLD', center: [8, 8, 1], size: [1, 1, 2] }),
    ]);
    expect(plans.map((p) => [p.itemId, p.name])).toEqual([
      ['b', '개구부 2'],
      ['c', '통로'],
      ['e', '고소 작업면 1'],
      ['f', '고소 작업면 2'],
    ]);
  });

  it('형상이 틀린 항목은 뺀다', () => {
    expect(
      layoutZonePlans([item({ size: [1, 0, 0.2] }), surfaceItem({ size: [0, 1, 1] })]),
    ).toEqual([]);
  });

  it('개구부가 낮으면 구역은 바닥에서 2 m 까지다', () => {
    const [plan] = layoutZonePlans([item({ center: [3, 2, 0.4], size: [1, 1, 0.2] })]);
    expect(plan!.shape).toMatchObject({ z_min_m: 0.3, z_max_m: 2.3 });
  });
});

describe('zoneOutlineBox', () => {
  it('축에 맞춘 직사각형 구역은 감싸는 상자를, 회전한 구역은 null 을 돌려준다', () => {
    const [axis] = layoutZonePlans([surfaceItem()]);
    expect(zoneOutlineBox(axis!.shape)).toEqual({ min: [3.7, 3.2, 0], max: [6.3, 4.8, 2] });
    const [rotated] = layoutZonePlans([surfaceItem({ yaw_rad: 0.5 })]);
    expect(zoneOutlineBox(rotated!.shape)).toBeNull();
  });
});

describe('관제 → 레이아웃 항목', () => {
  const sameShape = (
    a: readonly (readonly [number, number])[],
    b: readonly (readonly [number, number])[],
  ) =>
    a.length === b.length &&
    a.every((p) => b.some((q) => Math.abs(p[0] - q[0]) <= 2e-3 && Math.abs(p[1] - q[1]) <= 2e-3));

  it('작업면은 바닥에서 상판까지의 고소 작업면 항목이 되고 다시 같은 작업면·구역이 된다', () => {
    const geometry = {
      centerXy: [5, 4] as [number, number],
      sizeXy: [2, 1] as [number, number],
      yawRad: 0.4,
      topHeightM: 1.2,
    };
    const made = itemOfSurface('surf-02', ' 단상 ', geometry);
    expect(made).toEqual({
      item_id: 'surf-02',
      kind: 'WORK_SURFACE',
      center: [5, 4, 0.6],
      size: [2, 1, 1.2],
      yaw_rad: 0.4,
      label: '단상',
    });
    const [plan] = layoutZonePlans([made]);
    expect(plan!.surface).toEqual(geometry);
    expect(plan!.shape).toEqual(surfaceZoneShape(geometry));
    expect(itemOfSurface('x', null, geometry).label).toBeNull();
  });

  it('구역 모양은 0.3 m 줄인 개구부 항목이 되고 다시 같은 구역이 된다(축 정렬·회전 모두)', () => {
    for (const yaw of [0, 0.4, -1.2]) {
      const shape = openingZoneShape({
        centerXy: [3, 2],
        sizeXy: [1.2, 0.8],
        yawRad: yaw,
        bottomZ: 0,
        topZ: 1.5,
      });
      const made = itemOfZoneShape('open-02', '새 구역', shape);
      expect(made).not.toBeNull();
      expect(made!.kind).toBe('OPENING');
      expect(made!.size[2]).toBe(1.5);
      const [plan] = layoutZonePlans([made!]);
      expect(plan!.name).toBe('새 구역');
      expect(sameShape(plan!.shape.polygon_xy, shape.polygon_xy)).toBe(true);
      expect(plan!.shape).toMatchObject({ z_min_m: 0, z_max_m: 1.5 });
    }
  });

  it('줄인 가로·세로가 너무 작거나 높이를 모르면 되돌리지 않는다', () => {
    const tiny = {
      polygon_xy: [
        [0, 0],
        [0.7, 0],
        [0.7, 0.7],
        [0, 0.7],
      ] as [number, number][],
      z_min_m: 0,
      z_max_m: 2,
    };
    expect(itemOfZoneShape('x', null, tiny)).toBeNull();
    const ok = {
      polygon_xy: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ] as [number, number][],
      z_min_m: 0,
      z_max_m: 2,
    };
    expect(itemOfZoneShape('x', null, ok)).not.toBeNull();
    expect(itemOfZoneShape('x', null, { ...ok, z_max_m: null })).toBeNull();
    expect(itemOfZoneShape('x', null, { ...ok, z_min_m: 2 })).toBeNull();
  });
});

describe('새 항목 ID·레이아웃 편집', () => {
  it('쓰지 않은 가장 작은 번호의 ID 를 짓는다', () => {
    expect(newLayoutItemId('OPENING', [])).toBe('open-01');
    expect(newLayoutItemId('WORK_SURFACE', [{ item_id: 'surf-01' }, { item_id: 'surf-03' }])).toBe(
      'surf-02',
    );
  });

  it('UPSERT 는 같은 ID 를 바꾸고 없으면 뒤에 더하며, REMOVE 는 뺀다(순서 유지)', () => {
    const a = item({ item_id: 'a' });
    const b = item({ item_id: 'b' });
    const changed = item({ item_id: 'a', label: '바뀜' });
    expect(applyLayoutEdit([a, b], { op: 'UPSERT', item: changed })).toEqual([changed, b]);
    const c = item({ item_id: 'c' });
    expect(applyLayoutEdit([a, b], { op: 'UPSERT', item: c })).toEqual([a, b, c]);
    expect(applyLayoutEdit([a, b], { op: 'REMOVE', itemId: 'a' })).toEqual([b]);
    expect(applyLayoutEdit([a, b], { op: 'REMOVE', itemId: 'zz' })).toEqual([a, b]);
  });
});
