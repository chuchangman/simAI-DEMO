import { adaptZones } from '@/features/viewer3d/data/contractAdapter';
import {
  DEMO_STATIC_OBJECTS_BE_V1,
  DEMO_ZONES_BE_V1,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  DEMO_OPERATIONAL_GEOMETRY,
  DEMO_ZONES_RESPONSE,
} from '@/features/viewer3d/dev-harness/scenarios';
import {
  adaptGeometry,
  adaptOfficialStaticObjects,
} from '@/features/viewer3d/surfaces/officialStaticObjects';
import { adaptWorkSurfaces } from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import {
  adaptOfficialZones,
  MAX_ZONE_VERTICES,
  readOfficialZone,
  readPolygonXy,
} from '@/features/viewer3d/zones/officialZones';
import { describe, expect, it } from 'vitest';

// -234 BE 정식 형상 입력. 받기·빼기 규칙은 BE 저장 검사·Tier 0 Zone.from_json·구성 묶음 변환과 같아야 한다.

const T = 1_760_342_400_000;
const square = [
  [0, 0],
  [2, 0],
  [2, 3],
  [0, 3],
];
const row = (patch: Record<string, unknown> = {}) => ({
  zone_id: 'z-1',
  zone_version: 2,
  name: '구역',
  zone_kind: 'OPENING',
  eval_type: 'VOLUME_3D',
  polygon_xy: square,
  z_min_m: 0.5,
  z_max_m: 2,
  severity: 'HIGH',
  requirements: null,
  has_guardrail: true,
  valid_from: T,
  valid_to: null,
  ...patch,
});
const reasonOf = (raw: unknown) => {
  const read = readOfficialZone(raw);
  return 'reason' in read ? read.reason : null;
};

describe('readPolygonXy', () => {
  it('닫는 점과 이어진 같은 점을 빼고 꼭짓점을 그대로 둔다', () => {
    expect(readPolygonXy([...square, [0, 0]])).toEqual({ points: square });
    expect(
      readPolygonXy([
        [0, 0],
        [0, 0],
        [2, 0],
        [2, 3],
      ]),
    ).toEqual({
      points: [
        [0, 0],
        [2, 0],
        [2, 3],
      ],
    });
  });

  it.each([
    ['배열 아님', null, 'polygon_xy 가 배열이 아니다'],
    ['꼭짓점 모양', [[0, 0], [1], [1, 1]], 'polygon_xy 꼭짓점은 유한수 2개여야 한다'],
    [
      'NaN',
      [
        [0, 0],
        [1, NaN],
        [1, 1],
      ],
      'polygon_xy 꼭짓점은 유한수 2개여야 한다',
    ],
    [
      '점 2개',
      [
        [0, 0],
        [1, 1],
        [0, 0],
      ],
      'polygon_xy 는 서로 다른 꼭짓점이 3개 이상이어야 한다',
    ],
    [
      '한 줄',
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      'polygon_xy 넓이가 0 이다',
    ],
    [
      '나비넥타이',
      [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
      ],
      'polygon_xy 가 꼬였다(변이 서로 닿는다)',
    ],
    [
      '변이 꼭짓점에 닿음',
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 0],
        [0, 2],
      ],
      'polygon_xy 가 꼬였다(변이 서로 닿는다)',
    ],
  ])('%s 이면 거부한다', (_name, value, reason) => {
    expect(readPolygonXy(value)).toEqual({ reason });
  });

  it('꼭짓점 상한(256)을 넘으면 거부한다', () => {
    const ring = (n: number) =>
      Array.from({ length: n }, (_, i) => [
        Math.cos((i / n) * Math.PI * 2),
        Math.sin((i / n) * Math.PI * 2),
      ]);
    expect('points' in readPolygonXy(ring(MAX_ZONE_VERTICES))).toBe(true);
    expect(readPolygonXy(ring(MAX_ZONE_VERTICES + 1))).toEqual({
      reason: 'polygon_xy 꼭짓점은 256개 이하여야 한다',
    });
  });
});

describe('readOfficialZone', () => {
  it('VOLUME_3D 직사각형은 BOX 이고 min·max 가 정확한 구역이다', () => {
    const read = readOfficialZone(row());
    expect(read).toMatchObject({
      zone: {
        zoneId: 'z-1',
        min: [0, 0, 0.5],
        max: [2, 3, 2],
        shape: 'BOX',
        official: {
          zoneVersion: 2,
          evalType: 'VOLUME_3D',
          severity: 'HIGH',
          zoneKind: 'OPENING',
          zRange: [0.5, 2],
          hasGuardrail: true,
          validFrom: T,
        },
      },
    });
  });

  it('직사각형이 아니면 PRISM 이고 꼭짓점을 그대로 보관한다(둘레 상자는 표시 위치용)', () => {
    const l = [
      [0, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ];
    const read = readOfficialZone(row({ polygon_xy: l }));
    expect(read).toMatchObject({
      zone: { shape: 'PRISM', min: [0, 0, 0.5], max: [3, 3, 2], official: { polygonXy: l } },
    });
    // 회전한 직사각형도 축 정렬이 아니라 PRISM 이다.
    const turned = readOfficialZone(
      row({
        polygon_xy: [
          [1, 0],
          [2, 1],
          [1, 2],
          [0, 1],
        ],
      }),
    );
    expect('zone' in turned && turned.zone.shape).toBe('PRISM');
  });

  it('GROUND_FOOTPRINT 는 높이가 없어도 받고 바닥 판정면(Z 0)으로 둔다', () => {
    const read = readOfficialZone(
      row({ eval_type: 'GROUND_FOOTPRINT', z_min_m: null, z_max_m: null }),
    );
    expect(read).toMatchObject({
      zone: { shape: 'FOOTPRINT', min: [0, 0, 0], max: [2, 3, 0], official: { zRange: null } },
    });
    // 높이가 있어도 판정에 쓰이지 않아 바닥면이다. 값은 그대로 보관한다.
    expect(readOfficialZone(row({ eval_type: 'GROUND_FOOTPRINT' }))).toMatchObject({
      zone: { shape: 'FOOTPRINT', official: { zRange: [0.5, 2] } },
    });
  });

  it.each([
    ['zone_id 없음', { zone_id: '' }, 'zone_id 가 비었다'],
    ['버전 0', { zone_version: 0 }, 'zone_version 은 1 이상 정수여야 한다'],
    ['버전 문자', { zone_version: '2' }, 'zone_version 은 1 이상 정수여야 한다'],
    ['판정 유형', { eval_type: 'BOX' }, 'eval_type 은 GROUND_FOOTPRINT 또는 VOLUME_3D 여야 한다'],
    ['등급', { severity: 'LOW' }, 'severity 는 CRITICAL·HIGH·CAUTION·INFO 중 하나여야 한다'],
    ['지난 버전', { valid_to: T }, '지금 유효한 버전이 아니다(valid_to 있음)'],
    ['3D 높이 없음', { z_min_m: null }, 'VOLUME_3D 구역의 높이(z_min_m·z_max_m)를 모른다'],
    ['높이 뒤집힘', { z_min_m: 2, z_max_m: 2 }, 'z_min_m 은 z_max_m 보다 작아야 한다'],
    ['높이 형식', { z_max_m: 'x' }, 'z_max_m 이 유한수가 아니다'],
  ])('%s 이면 이유와 함께 뺀다(높이를 지어내지 않는다)', (_name, patch, reason) => {
    expect(reasonOf(row(patch))).toBe(reason);
  });

  it('이름이 없으면 이름을 비워 두고(구역 ID 로 채우지 않는다) 형상은 그대로 받는다', () => {
    expect(readOfficialZone(row({ name: null }))).toMatchObject({ zone: { name: '' } });
  });
});

describe('adaptOfficialZones·adaptZones', () => {
  it('개발 예시 응답: 정상 4개(BOX·FOOTPRINT·PRISM 2)와 거부 4개', () => {
    const snapshot = adaptOfficialZones(DEMO_ZONES_BE_V1, T);
    expect(snapshot).toMatchObject({ status: 'READY', contract: 'BE_ZONES_V1', receivedAt: T });
    expect(snapshot.zones.map((z) => [z.zoneId, z.shape])).toEqual([
      ['z-01', 'BOX'],
      ['z-02', 'FOOTPRINT'],
      ['z-03', 'PRISM'],
      ['z-04', 'PRISM'],
    ]);
    // z-01 은 DEMO z-01 상자와 같은 자리다.
    expect([...snapshot.zones[0]!.min, ...snapshot.zones[0]!.max]).toEqual([
      1.5, 5.5, 0, 4.5, 8.5, 2,
    ]);
    // z-04 는 닫는 점이 와도 꼭짓점 5개다.
    expect(snapshot.zones[3]!.official!.polygonXy).toHaveLength(5);
    expect(snapshot.invalid).toEqual([
      { zoneId: 'z-bad-height', reason: 'VOLUME_3D 구역의 높이(z_min_m·z_max_m)를 모른다' },
      { zoneId: 'z-bad-bowtie', reason: 'polygon_xy 가 꼬였다(변이 서로 닿는다)' },
      { zoneId: 'z-dup', reason: 'zone_id 중복' },
      { zoneId: 'z-dup', reason: 'zone_id 중복' },
    ]);
  });

  it('배열이 아니면 전체 거부, 빈 배열은 구역 0개 READY 다', () => {
    expect(adaptOfficialZones({ zones: [] }, T)).toMatchObject({
      status: 'REJECTED',
      reason: '구역 응답이 배열이 아니다',
    });
    expect(adaptOfficialZones([], T)).toMatchObject({ status: 'READY', zones: [] });
  });

  it('입구는 본문 모양으로 출처를 가른다: 배열은 정식, DEMO 표시는 기존 DEMO, 그 밖은 거부', () => {
    expect(adaptZones(DEMO_ZONES_BE_V1, T).contract).toBe('BE_ZONES_V1');
    const demo = adaptZones(structuredClone(DEMO_ZONES_RESPONSE), T);
    expect(demo).toMatchObject({ status: 'READY', contract: 'DEMO_UNCONFIRMED' });
    // DEMO 구역은 예전과 같은 값이다(shape·official 키가 붙지 않는다).
    expect(demo.zones[0]).toEqual({
      zoneId: 'z-01',
      name: '예시 구역 A',
      min: [1.5, 5.5, 0],
      max: [4.5, 8.5, 2],
    });
    expect(adaptZones({ zones: [] }, T).status).toBe('REJECTED');
  });
});

describe('adaptOfficialStaticObjects·adaptGeometry', () => {
  it('구성 묶음과 같은 규칙으로 옮겨, DEMO 묶음 경로와 같은 작업면·장애물 형상이 된다', () => {
    const official = adaptOfficialStaticObjects(DEMO_STATIC_OBJECTS_BE_V1, T);
    const bundle = adaptWorkSurfaces(DEMO_OPERATIONAL_GEOMETRY, T);
    expect(official).toMatchObject({ status: 'READY', contract: 'BE_STATIC_OBJECTS_V1' });
    const shape = (s: {
      surfaceId: string;
      centerXy: number[];
      sizeXy: number[];
      yawRad: number;
      topHeightM: number;
    }) => [s.surfaceId, s.centerXy, s.sizeXy, s.yawRad, s.topHeightM];
    expect(official.surfaces.map(shape)).toEqual(bundle.surfaces.map(shape));
    const obstacle = (o: {
      objectId: string;
      center: number[];
      size: number[];
      yawRad: number;
    }) => [o.objectId, o.center, o.size, o.yawRad];
    expect(official.obstacles.map(obstacle)).toEqual(
      bundle.obstacles.filter((o) => o.objectId.startsWith('so-')).map(obstacle),
    );
    expect(official.objectVersions).toEqual({
      'podium-1': 1,
      'desk-1': 2,
      'desk-2': 3,
      'so-cabinet': 1,
      'so-projector': 2,
    });
    expect(official.invalidObstacles).toContainEqual({
      objectId: 'so-unknown',
      reason: 'kind 는 WORK_SURFACE 또는 OBSTACLE 이어야 한다',
    });
    expect(official.invalid).toContainEqual({
      surfaceId: 'ws-no-top',
      reason: 'top_height_m 은 0 보다 큰 유한수여야 한다',
    });
  });

  it('작업면은 obb.center Z·size Z 를 쓰지 않고(바닥~상판), 상판 σ 는 작업면·장애물 각각의 자리로 옮긴다', () => {
    const snapshot = adaptOfficialStaticObjects(
      [
        {
          object_id: 'ws',
          object_version: 4,
          kind: 'WORK_SURFACE',
          name: '단상',
          obb: { center: [1, 2, 9], size: [2, 1, 9], yaw_rad: 0.1 },
          top_height_m: 0.4,
          top_height_sigma_m: 0.03,
          valid_from: T,
          valid_to: null,
        },
        {
          object_id: 'ob',
          object_version: 1,
          kind: 'OBSTACLE',
          name: null,
          obb: { center: [3, 3, 1], size: [1, 1, 2] },
          top_height_m: null,
          top_height_sigma_m: 0.05,
          valid_from: T,
          valid_to: null,
        },
      ],
      T,
    );
    expect(snapshot.surfaces[0]).toMatchObject({
      surfaceId: 'ws',
      centerXy: [1, 2],
      sizeXy: [2, 1],
      yawRad: 0.1,
      topHeightM: 0.4,
      topHeightSigmaM: 0.03,
      source: { name: '단상', object_version: 4 },
    });
    expect(snapshot.obstacles[0]).toMatchObject({ objectId: 'ob', yawRad: 0 });
    expect(snapshot.obstacles[0]!.source).toEqual({
      object_id: 'ob',
      kind: 'OBSTACLE',
      obb: { center: [3, 3, 1], size: [1, 1, 2], top_height_sigma_m: 0.05 },
      object_version: 1,
    });
  });

  it.each([
    ['버전 없음', { object_version: undefined }, 'object_version 은 1 이상 정수여야 한다'],
    ['지난 버전', { valid_to: T }, '지금 유효한 버전이 아니다(valid_to 있음)'],
    ['obb 없음', { obb: null }, 'obb 가 객체가 아니다'],
    [
      'center 모양',
      { obb: { center: [1, 2], size: [1, 1, 1] } },
      'obb.center 는 유한수 3개여야 한다',
    ],
  ])('작업면 %s 이면 이유와 함께 뺀다', (_name, patch, reason) => {
    const snapshot = adaptOfficialStaticObjects(
      [
        {
          object_id: 'ws',
          object_version: 1,
          kind: 'WORK_SURFACE',
          obb: { center: [1, 1, 0.2], size: [1, 1, 0.4], yaw_rad: 0 },
          top_height_m: 0.4,
          valid_to: null,
          ...patch,
        },
      ],
      T,
    );
    expect(snapshot.surfaces).toEqual([]);
    expect(snapshot.invalid).toEqual([{ surfaceId: 'ws', reason }]);
  });

  it('입구는 배열을 정식, 객체를 구성 묶음 모양으로 받는다', () => {
    expect(adaptGeometry(DEMO_STATIC_OBJECTS_BE_V1, T).contract).toBe('BE_STATIC_OBJECTS_V1');
    const bundle = adaptGeometry(DEMO_OPERATIONAL_GEOMETRY, T);
    expect(bundle.contract).toBe('OPERATIONAL_GEOMETRY_UNCONFIRMED');
    expect(bundle.objectVersions).toBeUndefined();
    expect(adaptOfficialStaticObjects({}, T)).toMatchObject({
      status: 'REJECTED',
      reason: '정적 객체 응답이 배열이 아니다',
    });
  });
});

describe('objectVersions 출처(그린 형상과 같은 행)', () => {
  const surfaceRow = (version: number, patch: Record<string, unknown> = {}) => ({
    object_id: 'x',
    object_version: version,
    kind: 'WORK_SURFACE',
    obb: { center: [1, 1, 0.2], size: [1, 1, 0.4], yaw_rad: 0 },
    top_height_m: 0.4,
    valid_to: null,
    ...patch,
  });
  const obstacleRow = (version: number, patch: Record<string, unknown> = {}) => ({
    object_id: 'x',
    object_version: version,
    kind: 'OBSTACLE',
    obb: { center: [5, 5, 1], size: [1, 1, 2], yaw_rad: 0 },
    top_height_m: null,
    valid_to: null,
    ...patch,
  });
  const drawn = (raw: unknown[]) => {
    const s = adaptOfficialStaticObjects(raw, T);
    return {
      surfaces: s.surfaces.map((x) => [x.surfaceId, x.topHeightM, x.source.object_version]),
      obstacles: s.obstacles.map((x) => [x.objectId, x.center, x.source.object_version]),
      versions: s.objectVersions,
    };
  };

  it('같은 ID 가 둘 다 유효하면 앞 행의 형상과 버전을 쓴다', () => {
    expect(drawn([surfaceRow(1), surfaceRow(2, { top_height_m: 0.9 })])).toEqual({
      surfaces: [['x', 0.4, 1]],
      obstacles: [],
      versions: { x: 1 },
    });
  });

  it('앞 행이 묶음 검사에서 빠지고 뒤 행이 그려지면 버전도 뒤 행 것이다', () => {
    expect(
      drawn([surfaceRow(1, { top_height_m: null }), surfaceRow(2, { top_height_m: 0.9 })]),
    ).toEqual({
      surfaces: [['x', 0.9, 2]],
      obstacles: [],
      versions: { x: 2 },
    });
    // 변환 단계에서 빠진 앞 행(obb 없음)도 같다.
    expect(drawn([surfaceRow(1, { obb: null }), surfaceRow(3)]).versions).toEqual({ x: 3 });
  });

  it('작업면·장애물이 같은 ID 면 작업면을 그리고 그 버전을 쓴다(장애물이 앞에 와도)', () => {
    const result = adaptOfficialStaticObjects([obstacleRow(7), surfaceRow(4)], T);
    expect(result.surfaces.map((s) => s.surfaceId)).toEqual(['x']);
    expect(result.obstacles).toEqual([]);
    expect(result.objectVersions).toEqual({ x: 4 });
    expect(result.invalidObstacles).toEqual([
      { objectId: 'x', reason: 'object_id 가 작업면 surface_id 와 겹친다' },
    ]);
  });

  it('작업면이 빠지면 같은 ID 장애물이 그려지고 그 버전을 쓴다', () => {
    expect(drawn([surfaceRow(4, { top_height_m: 0 }), obstacleRow(7)])).toEqual({
      surfaces: [],
      obstacles: [['x', [5, 5, 1], 7]],
      versions: { x: 7 },
    });
  });

  it('모두 빠지면 버전도 없다', () => {
    expect(drawn([surfaceRow(1, { top_height_m: null }), obstacleRow(2, { obb: null })])).toEqual({
      surfaces: [],
      obstacles: [],
      versions: {},
    });
  });
});

describe('확인 전 구역 힌트(needs_review, S15P31A101-629)', () => {
  it('needs_review 가 true 일 때만 needsReview 를 붙이고 형상 검사는 그대로다', () => {
    const marked = readOfficialZone(row({ needs_review: true }));
    const plain = readOfficialZone(row());
    expect('zone' in marked && marked.zone.needsReview).toBe(true);
    expect('zone' in plain && 'needsReview' in plain.zone).toBe(false);
    const footprint = readOfficialZone(
      row({ eval_type: 'GROUND_FOOTPRINT', z_min_m: null, z_max_m: null, needs_review: true }),
    );
    expect('zone' in footprint && footprint.zone.needsReview).toBe(true);
    expect(reasonOf(row({ needs_review: 'yes' }))).toBeNull();
  });
});
