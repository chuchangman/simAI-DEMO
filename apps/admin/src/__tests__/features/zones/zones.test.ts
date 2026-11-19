import { adaptZones } from '@/features/viewer3d/data/contractAdapter';
import { requestZones } from '@/features/zones/api';
import { boxToPolygon, readZones, toViewerZones } from '@/features/zones/zones';
import { createHttp } from '@/lib/http';
import { createZonesMock, MOCK_ZONES } from '@/mocks/zones';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const zone = (zone_id: string, polygon_xy: unknown, zRange: [number, number] | null = [0, 2]) => ({
  zone_id,
  zone_version: 3,
  name: zone_id,
  zone_kind: 'OPENING',
  eval_type: 'VOLUME_3D',
  polygon_xy,
  z_min_m: zRange?.[0] ?? null,
  z_max_m: zRange?.[1] ?? null,
  severity: 'HIGH',
  requirements: { helmet: true },
  has_guardrail: false,
  valid_from: 100,
  valid_to: null,
});
const read = (...zones: unknown[]) => readZones(zones);

describe('readZones', () => {
  it('서버 구역(BE -120)의 바닥 다각형과 높이를 감싸는 상자로 읽고, 받은 다각형·속성은 그대로 둔다', () => {
    expect(read(zone('z-1', rect(1, 2, 3, 4)))).toEqual([
      {
        zoneId: 'z-1',
        name: 'z-1',
        min: [1, 2, 0],
        max: [3, 4, 2],
        version: 3,
        judgeType: 'VOLUME_3D',
        zoneType: 'OPENING',
        severity: 'HIGH',
        polygon: rect(1, 2, 3, 4),
        zBounds: [0, 2],
        zRange: [0, 2],
        hasGuardrail: false,
        requirements: { helmet: true },
        validFrom: 100,
        workId: null,
        layoutId: null,
        layoutItemId: null,
        shapeEditable: true,
      },
    ]);
  });

  it('높이 범위는 최저·최고가 둘 다 있을 때만 쓰되 받은 한쪽 높이는 그대로 두고, 안전 난간·요구 조건이 없으면 null 로 읽는다', () => {
    const [half] = read({
      ...zone('half', rect(0, 0, 1, 1)),
      eval_type: 'GROUND_FOOTPRINT',
      z_max_m: null,
    });
    expect(half).toMatchObject({ zBounds: [0, null], zRange: null, shapeEditable: false });
    const bare: Record<string, unknown> = { ...zone('bare', rect(0, 0, 1, 1)) };
    delete bare.requirements;
    delete bare.has_guardrail;
    expect(read(bare)[0]).toMatchObject({ requirements: null, hasGuardrail: null });
  });

  it('축에 맞춘 직사각형이 아니거나 높이가 없으면 감싸는 상자로 보이되 형상은 고칠 수 없다', () => {
    const zones = read(
      zone('tri', [
        [0, 0],
        [2, 0],
        [0, 2],
      ]),
      zone('turned', [
        [1, 0],
        [2, 1],
        [1, 2],
        [0, 1],
      ]),
      { ...zone('flat', rect(0, 0, 1, 1), null), eval_type: 'GROUND_FOOTPRINT' },
      zone('box', [
        [1, 1],
        [0, 1],
        [0, 0],
        [1, 0],
      ]),
      // 꼭짓점이 겹쳐 x 두 값·y 두 값이어도 실제로는 삼각형이다.
      zone('folded', [
        [0, 0],
        [1, 0],
        [1, 1],
        [1, 1],
      ]),
      // 끝점이 첫 점과 같은 닫힌 고리(GeoJSON·PostGIS)는 직사각형으로 본다.
      zone('ring', [...rect(0, 0, 1, 1), [0, 0]]),
      zone('open5', [...rect(0, 0, 1, 1), [0.5, 0]]),
    );
    expect(zones.map((z) => [z.zoneId, z.shapeEditable])).toEqual([
      ['tri', false],
      ['turned', false],
      ['flat', false],
      ['box', true],
      ['folded', false],
      ['ring', true],
      ['open5', false],
    ]);
    expect(zones[1]).toMatchObject({ min: [0, 0, 0], max: [2, 2, 2] });
    expect(zones[2]!.max[2]).toBeGreaterThan(0);
  });

  it('형식이 틀렸거나 넓이·높이가 0 이거나 뒤집힌 구역, 같은 ID 가 둘 이상인 구역은 뺀다', () => {
    const zones = read(
      zone('ok', rect(0, 0, 1, 1)),
      zone('line', [
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
      zone('low', rect(0, 0, 1, 1), [2, 2]),
      zone('flip', rect(0, 0, 1, 1), [2, 1]),
      zone('two', [
        [0, 0],
        [1, 1],
      ]),
      { ...zone('bad-severity', rect(0, 0, 1, 1)), severity: 'WARN' },
      { ...zone('no-kind', rect(0, 0, 1, 1)), zone_kind: '' },
      zone('dup', rect(0, 0, 1, 1)),
      zone('dup', rect(2, 2, 3, 3)),
    );
    expect(zones.map((z) => z.zoneId)).toEqual(['ok']);
  });

  it('형식이 틀린 항목도 ID 를 세고(3D 뷰어와 같은 규칙), ID 는 자르지 않는다', () => {
    const zones = read(
      zone('z', rect(0, 0, 1, 1)),
      { zone_id: 'z', name: 5 },
      zone('a ', rect(0, 0, 1, 1)),
      zone('a', rect(2, 2, 3, 3)),
      zone('  ', rect(0, 0, 1, 1)),
    );
    expect(zones.map((z) => z.zoneId)).toEqual(['a ', 'a']);
  });
});

describe('상자 ↔ 다각형', () => {
  it('상자 바닥을 반시계 직사각형으로 바꾸면 다시 읽어도 같은 상자다', () => {
    const box = { min: [5.8, 1.2, 0], max: [8.6, 3.8, 2.4] } as const;
    const polygon = boxToPolygon(box);
    expect(polygon).toEqual(rect(5.8, 1.2, 8.6, 3.8));
    expect(read(zone('z', polygon, [0, 2.4]))[0]).toMatchObject({ ...box, shapeEditable: true });
  });

  it('3D 뷰어에는 서버 응답 형식(정식 구역) 그대로 넘긴다', () => {
    const item = zone('z', rect(1, 2, 3, 4));
    expect(toViewerZones(read(item))).toEqual([item]);
  });

  describe('3D 뷰어가 읽은 모양', () => {
    const shapeOf = (item: unknown) => {
      const [view] = adaptZones(toViewerZones(read(item)), 0).zones;
      return view?.shape;
    };

    it('축에 맞춘 입체 직사각형은 상자로 읽는다(손잡이·이름표·위험 표시가 그대로다)', () => {
      expect(shapeOf(zone('z', rect(1, 2, 3, 4)))).toBe('BOX');
    });

    it('회전한 직사각형은 실제 모양의 기둥으로 읽고, 꼭짓점을 그대로 싣는다', () => {
      const rotated = [
        [5, 1],
        [6, 2],
        [5, 3],
        [4, 2],
      ];
      const [view] = adaptZones(toViewerZones(read(zone('z', rotated))), 0).zones;
      expect(view?.shape).toBe('PRISM');
      expect(view?.official?.polygonXy).toEqual(rotated);
    });

    it('바닥 판정 구역은 바닥 면으로 읽는다', () => {
      expect(shapeOf({ ...zone('z', rect(1, 2, 3, 4)), eval_type: 'GROUND_FOOTPRINT' })).toBe(
        'FOOTPRINT',
      );
    });
  });

  it('입체 판정이 아닌 구역은 상자 편집기로 형상을 고칠 수 없다', () => {
    const footprint = { ...zone('z', rect(1, 2, 3, 4)), eval_type: 'GROUND_FOOTPRINT' };
    expect(read(footprint)[0]?.shapeEditable).toBe(false);
  });
});

const BASE = 'http://api.test';
const server = setupServer(...createZonesMock().handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

describe('requestZones', () => {
  it('mock 구역(이벤트 시나리오의 z-04·z-02)을 받아 검사한다', async () => {
    const response = await requestZones(
      createHttp({ baseUrl: BASE, getToken: () => 'mock-token.viewer' }),
    );
    expect(response).toEqual(MOCK_ZONES);
    expect(readZones(response).map((z) => [z.zoneId, z.shapeEditable])).toEqual([
      ['z-04', true],
      ['z-02', true],
    ]);
  });
});
