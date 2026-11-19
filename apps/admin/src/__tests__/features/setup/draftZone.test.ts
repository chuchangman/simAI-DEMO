import {
  acceptedByZones,
  bufferConvexPolygon,
  convexHull,
  draftCreateRequest,
  draftSurfaceGeometry,
} from '@/features/setup/draftZone';
import {
  zoneDraftItemSchema,
  type ZoneDraftItem,
  type ZoneDraftItemInput,
} from '@/features/setup/types';
import { bodyOf as surfaceBodyOf } from '@/features/surfaces/surfaces';
import type { SurfaceGeometry } from '@/features/surfaces/types';
import type { ZoneBody, ZoneCommitRequest } from '@/features/zones/types';
import { SURFACE_ZONE_MARGIN_M, surfaceZoneShape } from '@/features/zones/zoneShape';
import { buildDefaultZoneDraftItems } from '@/mocks/setup';
import { describe, expect, it } from 'vitest';

type Point = readonly [number, number];

const [OPENING_INPUT, SURFACE_INPUT] = buildDefaultZoneDraftItems() as [
  ZoneDraftItemInput,
  ZoneDraftItemInput,
];
const draftOf = (base: ZoneDraftItemInput, patch: Partial<ZoneDraftItemInput> = {}) =>
  zoneDraftItemSchema.parse({ ...base, ...patch });
const OPENING = draftOf(OPENING_INPUT);
const SURFACE = draftOf(SURFACE_INPUT);

/** 단상 초안의 obb(가운데 5·0.8, 3×0.6, 상판 0.9) 그대로의 작업면. */
const SURFACE_GEOMETRY: SurfaceGeometry = {
  centerXy: [5, 0.8],
  sizeXy: [3, 0.6],
  yawRad: 0,
  topHeightM: 0.9,
};

/** 단상 초안 obb 를 yaw·크기만 바꾼 것. */
const obbOf = (yaw: number, size: [number, number, number] = [3, 0.6, 0.9]) => ({
  center: [5, 0.8, 0.45] as [number, number, number],
  size,
  yaw_rad: yaw,
});

/** 구역 만들기 요청의 구역 본문. */
function zoneBodyOf(request: ZoneCommitRequest): ZoneBody {
  if (request.zone.op !== 'CREATE') throw new Error('구역 만들기 요청이 아니다');
  return request.zone.body;
}

/** 점 p 에서 선분 a-b 까지 거리. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 점 p 에서 다각형 둘레까지 가장 가까운 거리. */
const outlineDistance = (p: Point, polygon: readonly Point[]) =>
  Math.min(...polygon.map((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]!)));

/** 가운데가 (cx, cy), 가로·세로 w·d, yaw 만큼 돈 직사각형의 꼭짓점(반시계). */
function rotatedRect(
  cx: number,
  cy: number,
  w: number,
  d: number,
  yaw: number,
): [number, number][] {
  const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => [cx + x! * cos - y! * sin, cy + x! * sin + y! * cos]);
}

describe('draftSurfaceGeometry', () => {
  it('고소 작업면 초안이면 obb 그대로의 작업면이고, 그 밖의 초안은 null 이다', () => {
    expect(draftSurfaceGeometry(SURFACE)).toEqual(SURFACE_GEOMETRY);
    expect(draftSurfaceGeometry(OPENING)).toBeNull();
    expect(
      draftSurfaceGeometry(draftOf(OPENING_INPUT, { candidate_kind: 'FLOOR_EDGE' })),
    ).toBeNull();
  });

  it('상판 높이가 없으면 obb 높이를 쓰고, 0.2~3 m 밖이면(깨진 Z 범위 포함) 만들지 않는다', () => {
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { top_height_m: null }))?.topHeightM).toBe(
      0.9,
    );
    for (const top of [-11.8, 0.1, 3.5]) {
      expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { top_height_m: top }))).toBeNull();
    }
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { top_height_m: 0.2 }))?.topHeightM).toBe(
      0.2,
    );
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { top_height_m: 3 }))?.topHeightM).toBe(3);
  });

  it('obb 가 없거나 크기가 0 이면 만들지 않는다', () => {
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: null }))).toBeNull();
    const flat = obbOf(0, [3, 0, 0.9]);
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: flat }))).toBeNull();
  });

  it('기운 작업면은 회전을 그대로 두고, ±π 밖의 yaw 는 같은 방향으로 접는다', () => {
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: obbOf(0.4) }))?.yawRad).toBe(0.4);
    const wrapped = obbOf(0.4 + 2 * Math.PI);
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: wrapped }))?.yawRad).toBeCloseTo(0.4);
  });
});

describe('draftCreateRequest', () => {
  it('고소 작업면 초안은 작업면을 함께 만들고, 구역은 관제와 같은 작업면 둘레 0.3 m 경고 구역이다', () => {
    const request = draftCreateRequest(SURFACE);
    expect(request.surface).toEqual({
      op: 'CREATE',
      body: surfaceBodyOf(null, '', SURFACE_GEOMETRY),
    });
    const body = zoneBodyOf(request);
    expect(body).toMatchObject({
      name: '전면 단상 작업면 후보',
      eval_type: 'VOLUME_3D',
      severity: 'HIGH',
      ...surfaceZoneShape(SURFACE_GEOMETRY),
    });
    expect(body.polygon_xy).toEqual([
      [3.2, 0.2],
      [6.8, 0.2],
      [6.8, 1.4],
      [3.2, 1.4],
    ]);
  });

  it('기운 작업면 초안의 구역은 작업면과 같이 돈 다각형이다', () => {
    const body = zoneBodyOf(draftCreateRequest(draftOf(SURFACE_INPUT, { obb: obbOf(0.4) })));
    expect(body.polygon_xy).toEqual(
      surfaceZoneShape({ ...SURFACE_GEOMETRY, yawRad: 0.4 }).polygon_xy,
    );
  });

  it('상판 높이가 이상한 작업면 초안은 작업면 없이 AI 윤곽을 0.3 m 민 일반 구역이다', () => {
    const request = draftCreateRequest(draftOf(SURFACE_INPUT, { top_height_m: -11.8 }));
    expect(request.surface).toBeUndefined();
    expect(zoneBodyOf(request)).toMatchObject({
      severity: 'HIGH',
      polygon_xy: [
        [2.9, 0],
        [7.1, 0],
        [7.1, 1.6],
        [2.9, 1.6],
      ],
      z_min_m: 0,
      z_max_m: 2.2,
    });
  });

  it('개구부·바닥 가장자리 초안은 AI 윤곽을 사방 0.3 m 민 구역이고 AI 심각도를 따른다', () => {
    const expected = {
      name: '창가 개구부 추락 주의',
      severity: 'CRITICAL',
      polygon_xy: [
        [6.7, 7.7],
        [8.9, 7.7],
        [8.9, 9.1],
        [6.7, 9.1],
      ],
      z_min_m: 0,
      z_max_m: 2,
    };
    for (const kind of ['OPENING', 'FLOOR_EDGE'] as const) {
      const request = draftCreateRequest(draftOf(OPENING_INPUT, { candidate_kind: kind }));
      expect(request.surface).toBeUndefined();
      expect(zoneBodyOf(request)).toMatchObject(expected);
    }
  });

  it('같은 초안을 몇 번 계산해도 한 번만 넓혀지고 초안을 바꾸지 않는다', () => {
    const before = structuredClone(OPENING);
    const first = draftCreateRequest(OPENING);
    expect(draftCreateRequest(OPENING)).toEqual(first);
    expect(OPENING).toEqual(before);
  });

  it('바닥 아래로 깨진 Z 범위는 바닥에서 자르고 너무 낮으면 2 m 로 둔다', () => {
    const body = zoneBodyOf(
      draftCreateRequest(draftOf(OPENING_INPUT, { z_min_m: -11.8, z_max_m: 0.2 })),
    );
    expect([body.z_min_m, body.z_max_m]).toEqual([0, 2]);
  });
});

describe('bufferConvexPolygon', () => {
  it('돈 직사각형도 각 변이 0.3 m 밖으로 나가 가로·세로가 0.6 m 늘고 가운데는 그대로다', () => {
    const rect = rotatedRect(2, 3, 2, 1, Math.PI / 6);
    const out = bufferConvexPolygon(convexHull(rect), SURFACE_ZONE_MARGIN_M);
    expect(out).toHaveLength(4);
    const side = (i: number) =>
      Math.hypot(out[(i + 1) % 4]![0] - out[i]![0], out[(i + 1) % 4]![1] - out[i]![1]);
    expect([side(0), side(1)].sort((a, b) => a - b)).toEqual([
      expect.closeTo(1.6, 2),
      expect.closeTo(2.6, 2),
    ]);
    const center = out.reduce((acc, [x, y]) => [acc[0] + x / 4, acc[1] + y / 4], [0, 0]);
    expect(center[0]).toBeCloseTo(2, 2);
    expect(center[1]).toBeCloseTo(3, 2);
    for (const p of out) expect(outlineDistance(p, rect)).toBeCloseTo(0.3 * Math.SQRT2, 2);
  });

  it('뾰족한 모서리는 잘라 두 점으로 두고(교점이면 4.8 m 튄다), 어느 점도 원래 다각형에 0.3 m 보다 가깝지 않다', () => {
    const sliver: Point[] = [
      [0, 0],
      [4, 0],
      [0, 0.5],
    ];
    const out = bufferConvexPolygon(convexHull(sliver), SURFACE_ZONE_MARGIN_M);
    // 직각·둔각 두 모서리는 교점 하나씩, 약 7° 모서리는 두 점.
    expect(out).toHaveLength(4);
    for (const p of out) {
      expect(outlineDistance(p, sliver)).toBeGreaterThanOrEqual(0.3 - 1e-3);
      const nearest = Math.min(...sliver.map((v) => Math.hypot(p[0] - v[0], p[1] - v[1])));
      expect(nearest).toBeLessThan(0.7);
    }
  });
});

describe('convexHull', () => {
  it('오목한 점과 한 직선 위의 점을 빼고 반시계로 둔다', () => {
    const lShape: Point[] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
      [1, 0],
    ];
    expect(convexHull(lShape)).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 2],
      [0, 2],
    ]);
  });

  it('점이 한 직선 위에만 있으면 3개보다 적어 초안 상자 바닥으로 대신 민다', () => {
    const line = draftOf(OPENING_INPUT, {
      polygon_xy: [
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    });
    expect(convexHull(line.polygon_xy).length).toBeLessThan(3);
    const body = zoneBodyOf(draftCreateRequest(line));
    // 초안 상자는 너비가 0.5 m 보다 좁으면 1.2 m 로 둔다(boxOfDraftItem).
    expect(body.polygon_xy).toEqual([
      [0.7, 0.7],
      [3.3, 0.7],
      [3.3, 2.5],
      [0.7, 2.5],
    ]);
  });
});

describe('acceptedByZones', () => {
  it('초안에서 계산한 다각형과 같은 구역이 있으면(시작점이 달라도) 이미 만든 초안이다', () => {
    const polygon = zoneBodyOf(draftCreateRequest(OPENING)).polygon_xy;
    const rotated = [...polygon.slice(2), ...polygon.slice(0, 2)];
    const drafts: ZoneDraftItem[] = [OPENING, SURFACE];
    expect(acceptedByZones(drafts, [{ polygon: rotated }])).toEqual(['cand-opening-1']);
    expect(acceptedByZones(drafts, [{ polygon: OPENING.polygon_xy }])).toEqual([]);
    expect(acceptedByZones(drafts, [])).toEqual([]);
  });
});

describe('방 축에 거의 나란한 초안의 축 정렬(S15P31A101-651)', () => {
  it('10° 안으로 기운 작업면은 yaw 0 이고 기운 상판을 덮는 축 정렬 크기다', () => {
    const yaw = 0.1;
    const geometry = draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: obbOf(yaw) }))!;
    expect(geometry.yawRad).toBe(0);
    expect(geometry.centerXy).toEqual([5, 0.8]);
    expect(geometry.sizeXy[0]).toBeCloseTo(3 * Math.cos(yaw) + 0.6 * Math.sin(yaw), 3);
    expect(geometry.sizeXy[1]).toBeCloseTo(3 * Math.sin(yaw) + 0.6 * Math.cos(yaw), 3);
  });

  it('세로축(±90°)에서 10° 안이면 가로·세로가 바뀐 축 정렬이다(14차 작업대 81.9°)', () => {
    const yaw = 1.4289;
    const geometry = draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: obbOf(yaw) }))!;
    expect(geometry.yawRad).toBe(0);
    expect(geometry.sizeXy[0]).toBeLessThan(geometry.sizeXy[1]);
    // 축 정렬 작업면 구역은 직사각형이다(편집기 손잡이가 뜬다).
    const body = zoneBodyOf(draftCreateRequest(draftOf(SURFACE_INPUT, { obb: obbOf(yaw) })));
    expect(new Set(body.polygon_xy.map(([x]) => x)).size).toBe(2);
    expect(new Set(body.polygon_xy.map(([, y]) => y)).size).toBe(2);
  });

  it('10° 보다 많이 기운 작업면은 회전을 그대로 둔다', () => {
    expect(draftSurfaceGeometry(draftOf(SURFACE_INPUT, { obb: obbOf(0.2) }))?.yawRad).toBe(0.2);
  });

  it('작업면이 없는 초안도 네 변이 축에 거의 나란하면 경계 상자를 0.3 m 민 직사각형이다', () => {
    const tilted = rotatedRect(7.8, 8.4, 1.6, 0.8, 0.08);
    const body = zoneBodyOf(draftCreateRequest(draftOf(OPENING_INPUT, { polygon_xy: tilted })));
    const xs = tilted.map(([x]) => x);
    const ys = tilted.map(([, y]) => y);
    expect(body.polygon_xy).toHaveLength(4);
    expect(Math.min(...body.polygon_xy.map(([x]) => x))).toBeCloseTo(Math.min(...xs) - 0.3, 2);
    expect(Math.max(...body.polygon_xy.map(([, y]) => y))).toBeCloseTo(Math.max(...ys) + 0.3, 2);
    expect(new Set(body.polygon_xy.map(([x]) => x)).size).toBe(2);
    // 많이 기운 윤곽은 그대로 돈 다각형이다.
    const rotated = rotatedRect(7.8, 8.4, 1.6, 0.8, 0.5);
    const kept = zoneBodyOf(draftCreateRequest(draftOf(OPENING_INPUT, { polygon_xy: rotated })));
    expect(new Set(kept.polygon_xy.map(([x]) => x)).size).toBe(4);
  });

  it('축 정렬 전에 수락한(기운 모양 그대로의) 구역도 이미 만든 초안으로 본다', () => {
    const item = draftOf(SURFACE_INPUT, { obb: obbOf(0.1) });
    const oldPolygon = surfaceZoneShape({ ...SURFACE_GEOMETRY, yawRad: 0.1 }).polygon_xy;
    expect(acceptedByZones([item], [{ polygon: oldPolygon }])).toEqual(['cand-surface-2']);
  });
});

describe('초안 이름(S15P31A101-651)', () => {
  it('활성 구역과 겹치지 않으면 AI 추천 이름 그대로다', () => {
    expect(zoneBodyOf(draftCreateRequest(SURFACE, [{ name: '단상' }])).name).toBe(
      '전면 단상 작업면 후보',
    );
  });

  it('겹치면 구분자를 붙인다: 작업면은 A·B, 개구부는 1·2', () => {
    const surfaceName = (zones: { name: string }[]) =>
      zoneBodyOf(
        draftCreateRequest(draftOf(SURFACE_INPUT, { recommended_name: '작업대 상판' }), zones),
      ).name;
    expect(surfaceName([{ name: '작업대 상판' }])).toBe('작업대 상판 A');
    expect(surfaceName([{ name: '작업대 상판' }, { name: '작업대 상판 A' }])).toBe('작업대 상판 B');
    const opening = draftOf(OPENING_INPUT, { recommended_name: '개구부 1' });
    expect(zoneBodyOf(draftCreateRequest(opening, [{ name: '개구부 1' }])).name).toBe('개구부 2');
  });
});
