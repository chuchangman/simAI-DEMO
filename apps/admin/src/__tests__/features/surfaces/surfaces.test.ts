import {
  bodyOf,
  geometryErrors,
  readWorkSurfaces,
  sameGeometry,
  sameName,
  toViewerWorkSurfaces,
} from '@/features/surfaces/surfaces';
import type { SurfaceGeometry, WorkSurface } from '@/features/surfaces/types';
import { describe, expect, it } from 'vitest';

const item = (object_id: string, overrides: Record<string, unknown> = {}) => ({
  object_id,
  object_version: 2,
  kind: 'WORK_SURFACE',
  name: '책상',
  obb: { center: [5, 4.6, 0.37], size: [1.2, 0.6, 0.74], yaw_rad: -0.26 },
  top_height_m: Math.fround(0.74),
  valid_from: 100,
  valid_to: null,
  ...overrides,
});

const desk: WorkSurface = {
  objectId: 'ws-1',
  version: 2,
  name: '책상',
  geometry: { centerXy: [5, 4.6], sizeXy: [1.2, 0.6], yawRad: -0.26, topHeightM: 0.74 },
  sigma: 0.03,
  zoneId: null,
  validFrom: 100,
  workId: null,
  layoutId: null,
  layoutItemId: null,
};

describe('readWorkSurfaces', () => {
  it('서버 작업면을 바닥 투영·상판 높이로 읽는다', () => {
    expect(readWorkSurfaces([item('ws-1', { top_height_sigma_m: 0.03 })])).toEqual([
      {
        objectId: 'ws-1',
        version: 2,
        name: '책상',
        geometry: {
          centerXy: [5, 4.6],
          sizeXy: [1.2, 0.6],
          yawRad: -0.26,
          topHeightM: Math.fround(0.74),
        },
        sigma: 0.03,
        zoneId: null,
        validFrom: 100,
        workId: null,
        layoutId: null,
        layoutItemId: null,
      },
    ]);
  });

  it('서버가 이은 구역 ID(zone_id)를 읽고, 없거나 null 이면 이은 구역이 없다(null)', () => {
    const read = readWorkSurfaces([
      item('ws-linked', { zone_id: 'z-02' }),
      item('ws-null', { zone_id: null }),
      item('ws-absent'),
    ]);
    expect(read.map((s) => [s.objectId, s.zoneId])).toEqual([
      ['ws-linked', 'z-02'],
      ['ws-null', null],
      ['ws-absent', null],
    ]);
  });

  it('배열이 아니면 없는 것으로 보고, 장애물·형식이 틀린 항목·상판이 없는 항목·바닥 ID 는 뺀다', () => {
    expect(readWorkSurfaces({ objects: [] })).toEqual([]);
    expect(readWorkSurfaces(undefined)).toEqual([]);
    const read = readWorkSurfaces([
      item('ws-ok'),
      item('so-1', { kind: 'OBSTACLE' }),
      item('ws-flat', { top_height_m: null }),
      item('ws-zero', { top_height_m: 0 }),
      item('ws-thin', { obb: { center: [1, 1, 0.1], size: [0, 1, 0.2], yaw_rad: 0 } }),
      item('floor'),
      { object_id: 'ws-bad' },
    ]);
    expect(read.map((s) => s.objectId)).toEqual(['ws-ok']);
  });

  it('같은 ID 가 둘이면(틀린 항목 포함) 어느 쪽이 맞는지 몰라 둘 다 뺀다', () => {
    const read = readWorkSurfaces([item('ws-1'), { object_id: 'ws-1' }, item('ws-2')]);
    expect(read.map((s) => s.objectId)).toEqual(['ws-2']);
  });

  it('범위를 벗어난 회전은 같은 방향의 -π~π 값으로 읽는다', () => {
    const [s] = readWorkSurfaces([
      item('ws-1', { obb: { center: [1, 1, 0.37], size: [1, 1, 0.74], yaw_rad: 1.5 * Math.PI } }),
    ]);
    expect(s!.geometry.yawRad).toBeCloseTo(-0.5 * Math.PI);
  });
});

describe('toViewerWorkSurfaces', () => {
  it('서버 구성 묶음과 같은 항목에 이름을 더하고, 받은 표준편차만 싣는다', () => {
    expect(
      toViewerWorkSurfaces([desk, { ...desk, objectId: 'ws-2', name: null, sigma: null }]),
    ).toEqual({
      work_surfaces: [
        {
          surface_id: 'ws-1',
          top_height_m: 0.74,
          center_xy: [5, 4.6],
          size_xy: [1.2, 0.6],
          yaw_rad: -0.26,
          top_height_sigma_m: 0.03,
          name: '책상',
        },
        {
          surface_id: 'ws-2',
          top_height_m: 0.74,
          center_xy: [5, 4.6],
          size_xy: [1.2, 0.6],
          yaw_rad: -0.26,
        },
      ],
    });
  });
});

describe('bodyOf', () => {
  it('OBB 를 바닥부터 상판까지로 보내고, 회전은 접고, 받은 표준편차를 다시 보내며, 빈 이름은 null 이다', () => {
    const geometry: SurfaceGeometry = {
      centerXy: [2, 3],
      sizeXy: [1.5, 0.8],
      yawRad: 3 * Math.PI,
      topHeightM: 0.9,
    };
    const body = bodyOf(desk, '  ', geometry);
    expect(body).toMatchObject({
      kind: 'WORK_SURFACE',
      name: null,
      obb: { center: [2, 3, 0.45], size: [1.5, 0.8, 0.9] },
      top_height_m: 0.9,
      top_height_sigma_m: 0.03,
    });
    expect(Math.abs(body.obb.yaw_rad)).toBeCloseTo(Math.PI);
    expect(bodyOf(null, ' 단상 ', geometry)).toMatchObject({
      name: '단상',
      top_height_sigma_m: null,
    });
  });
});

describe('형상 검사·비교', () => {
  it('상판·크기는 0 보다 크고 유한해야 하며, 회전은 -180°~180° 다', () => {
    expect(geometryErrors(desk.geometry)).toBeNull();
    expect(geometryErrors({ ...desk.geometry, topHeightM: 0 })).toHaveProperty('topHeightM');
    expect(geometryErrors({ ...desk.geometry, sizeXy: [1, -1] })).toHaveProperty('size');
    expect(geometryErrors({ ...desk.geometry, centerXy: [Number.NaN, 1] })).toHaveProperty(
      'center',
    );
    expect(geometryErrors({ ...desk.geometry, yawRad: 4 })).toHaveProperty('yaw');
  });

  it('서버가 float4 로 돌려준 상판 높이는 같은 값으로 본다', () => {
    const saved = { ...desk.geometry, topHeightM: Math.fround(0.74) };
    expect(sameGeometry(desk.geometry, saved)).toBe(true);
    expect(sameGeometry(desk.geometry, { ...desk.geometry, topHeightM: 0.75 })).toBe(false);
  });

  it('이름은 앞뒤 공백을 빼고 비교하고, 비면 이름 없음과 같다', () => {
    expect(sameName(' 책상 ', '책상')).toBe(true);
    expect(sameName('   ', null)).toBe(true);
    expect(sameName('', '책상')).toBe(false);
    expect(sameName('책상2', '책상')).toBe(false);
  });
});
