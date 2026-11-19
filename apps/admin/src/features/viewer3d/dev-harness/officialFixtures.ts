import {
  DEMO_OPERATIONAL_GEOMETRY,
  DEMO_WORK_SURFACES,
} from '@/features/viewer3d/dev-harness/scenarios';

// 개발 화면 전용 BE 정식 형식 예시(S15P31A101-234). 실제 GET /api/zones(-120)·/api/static-objects(-58) 응답 모양이고
// 값은 DEMO 교실 치수다(실측 아님). ?geometry=official 일 때 Mock 이 이 값을 넘긴다.
// 정상 구역은 DEMO 상자와 같은 자리에 두되 형상 종류를 나눠 표시 차이를 본다.
//   z-01 VOLUME_3D 직사각형(BOX, DEMO z-01 과 같은 자리) · z-02 GROUND_FOOTPRINT(바닥 판정, 높이 없음)
//   z-03 VOLUME_3D L자 공중 구역(PRISM) · z-04 VOLUME_3D 오각형 바닥 구역(PRISM)
//   거부돼야 하는 예: z-bad-height(VOLUME_3D 높이 없음) · z-bad-bowtie(꼬인 다각형) · z-dup 두 개(zone_id 중복)
// 정적 객체는 DEMO operational_geometry 를 BE 행으로 되돌린 값이라 두 경로가 같은 작업면·장애물을 그려야 한다.

const zone = (patch: Record<string, unknown>) => ({
  zone_version: 1,
  zone_kind: 'DEMO',
  severity: 'HIGH',
  requirements: null,
  has_guardrail: null,
  valid_from: 1_760_000_000_000,
  valid_to: null,
  ...patch,
});

export const DEMO_ZONES_BE_V1 = [
  zone({
    zone_id: 'z-01',
    zone_version: 3,
    name: '예시 구역 A(정식·직사각형)',
    eval_type: 'VOLUME_3D',
    polygon_xy: [
      [1.5, 5.5],
      [4.5, 5.5],
      [4.5, 8.5],
      [1.5, 8.5],
    ],
    z_min_m: 0,
    z_max_m: 2,
  }),
  zone({
    zone_id: 'z-02',
    name: '예시 구역 B(정식·바닥 판정)',
    eval_type: 'GROUND_FOOTPRINT',
    severity: 'CRITICAL',
    polygon_xy: [
      [6.5, 1],
      [9, 1],
      [9, 3.5],
      [6.5, 3.5],
    ],
    z_min_m: null,
    z_max_m: null,
  }),
  zone({
    zone_id: 'z-03',
    name: '예시 구역 C(정식·L자 공중)',
    eval_type: 'VOLUME_3D',
    polygon_xy: [
      [4.5, 7.5],
      [6.5, 7.5],
      [6.5, 9],
      [5.5, 9],
      [5.5, 8.3],
      [4.5, 8.3],
    ],
    z_min_m: 1.2,
    z_max_m: 2.4,
  }),
  zone({
    zone_id: 'z-04',
    name: '예시 구역 D(정식·오각형)',
    eval_type: 'VOLUME_3D',
    severity: 'CAUTION',
    polygon_xy: [
      [0.6, 0.6],
      [2.6, 0.6],
      [3.2, 1.8],
      [1.6, 2.8],
      [0.4, 1.8],
      [0.6, 0.6],
    ],
    z_min_m: 0,
    z_max_m: 1.2,
  }),
  zone({
    zone_id: 'z-bad-height',
    name: '높이 없는 3D 구역',
    eval_type: 'VOLUME_3D',
    polygon_xy: [
      [3, 3],
      [4, 3],
      [4, 4],
    ],
    z_min_m: null,
    z_max_m: null,
  }),
  zone({
    zone_id: 'z-bad-bowtie',
    name: '꼬인 다각형',
    eval_type: 'GROUND_FOOTPRINT',
    polygon_xy: [
      [7, 5],
      [8, 6],
      [8, 5],
      [7, 6],
    ],
  }),
  zone({
    zone_id: 'z-dup',
    name: '중복 1',
    eval_type: 'GROUND_FOOTPRINT',
    polygon_xy: [
      [8, 8],
      [9, 8],
      [9, 9],
    ],
  }),
  zone({
    zone_id: 'z-dup',
    name: '중복 2',
    eval_type: 'GROUND_FOOTPRINT',
    polygon_xy: [
      [8, 8],
      [9.5, 8],
      [9.5, 9.5],
    ],
  }),
];

type SurfaceItem = (typeof DEMO_WORK_SURFACES.work_surfaces)[number];

/** 작업면 묶음 항목 → BE 행(ConfigBundleService.geometry 의 반대). 작업면 OBB 는 바닥~상판이다. */
const surfaceRow = (s: SurfaceItem, version: number) => ({
  object_id: s.surface_id,
  object_version: version,
  kind: 'WORK_SURFACE',
  name: s.surface_id,
  obb: {
    center: [s.center_xy[0], s.center_xy[1], s.top_height_m / 2],
    size: [s.size_xy[0], s.size_xy[1], s.top_height_m],
    yaw_rad: 'yaw_rad' in s ? s.yaw_rad : 0,
  },
  top_height_m: s.top_height_m,
  valid_from: 1_760_000_000_000,
  valid_to: null,
});

export const DEMO_STATIC_OBJECTS_BE_V1 = [
  ...DEMO_WORK_SURFACES.work_surfaces
    .filter((s) => ['podium-1', 'desk-1', 'desk-2'].includes(s.surface_id))
    .map((s, i) => surfaceRow(s, i + 1)),
  ...DEMO_OPERATIONAL_GEOMETRY.static_objects
    .filter((o) => o.object_id === 'so-cabinet' || o.object_id === 'so-projector')
    .map((o, i) => ({
      object_id: o.object_id,
      object_version: i + 1,
      kind: 'OBSTACLE',
      name: o.object_id,
      obb: o.obb,
      top_height_m: null,
      valid_from: 1_760_000_000_000,
      valid_to: null,
    })),
  // 거부돼야 하는 예: 모르는 kind, 상판 없는 작업면.
  {
    object_id: 'so-unknown',
    object_version: 1,
    kind: 'TABLE',
    name: '모르는 종류',
    obb: { center: [9, 9, 0.3], size: [0.5, 0.5, 0.6], yaw_rad: 0 },
    top_height_m: null,
    valid_from: 1_760_000_000_000,
    valid_to: null,
  },
  {
    object_id: 'ws-no-top',
    object_version: 1,
    kind: 'WORK_SURFACE',
    name: '상판 없는 작업면',
    obb: { center: [8.5, 5, 0.4], size: [1, 0.6, 0.8], yaw_rad: 0 },
    top_height_m: null,
    valid_from: 1_760_000_000_000,
    valid_to: null,
  },
];

export type GeometryMode = 'demo' | 'official';
export const GEOMETRY_OPTIONS: { key: GeometryMode; label: string }[] = [
  { key: 'demo', label: '형상 입력 · DEMO(기존)' },
  { key: 'official', label: '형상 입력 · BE 정식(-120·-58)' },
];

/** ?geometry=official 이면 BE 정식 형식, 그 밖에는 DEMO. */
export function readGeometryMode(search: string): GeometryMode {
  return new URLSearchParams(search).get('geometry') === 'official' ? 'official' : 'demo';
}

export function withGeometryMode(href: string, mode: GeometryMode): string {
  const url = new URL(href);
  if (mode === 'demo') url.searchParams.delete('geometry');
  else url.searchParams.set('geometry', mode);
  return url.toString();
}
