import type { WorldObb } from '@/features/viewer3d/editing/editGeometry';
import {
  readStaticObjects,
  type InvalidObstacle,
  type ObstacleView,
} from '@/features/viewer3d/surfaces/obstacleGeometry';
import { worldPoint, type WorldPoint } from '@/features/viewer3d/worldCoordinates';

// 등록 작업면(단상·책상 등) Operational Geometry 의 순수 계산(S15P31A101-188). 렌더러·React 와 떨어져 있어 시험한다.
//
// 항목 형식은 contracts/messages/risk_plan_request.schema.json 의 work_surface 와
// AI 구성 묶음 operational_geometry.work_surfaces(ai/src/simai_ai/risk/work_surface.py)를 그대로 따른다.
//   { surface_id, top_height_m, center_xy, size_xy, yaw_rad?, top_height_sigma_m? }
//   - center_xy·size_xy·yaw_rad: OBB 바닥 투영(가운데, 가로·세로 전체 길이 m, World +Z 축 반시계 회전 rad, 없으면 0)
//   - top_height_m: 상판 높이(바닥 Z=0 기준 m, 0 보다 크다). OBB 는 바닥(Z=0)에서 상판까지다.
// 바깥 묶음({ version?, work_surfaces: [...] })을 Viewer 에 넘기는 경로(BE -58 API·구성 묶음 버전)는 아직 정해지지 않았다.
// 그래서 contract 표시는 OPERATIONAL_GEOMETRY_UNCONFIRMED 다.
// 같은 묶음의 static_objects(등록 정적 객체 OBSTACLE, -274)도 함께 읽어 obstacles 에 싣는다(obstacleGeometry.ts).
//
// 이 형상은 안전 판단용 Operational Geometry 다. 3D 보기용 glTF(Visual Geometry)를 여기에 넣거나 대신 쓰지 않는다.
// R2 위험 가장자리(인접 면과의 높이차)는 AI 가 판정한다. 여기서는 등록 OBB 윗면 둘레 전체를 그대로 보인다.

/** 계약 yaw_rad 허용 범위(risk_plan_request schema minimum·maximum). 숫자 입력·새 작업면에서 도(degree) 값을 걸러 낸다. */
export const YAW_LIMIT_RAD = 3.1415927;
/** 바닥 ID. 작업면 ID 로 쓸 수 없다(world_state support_surface_id 의 floor). */
export const FLOOR_SURFACE_ID = 'floor';
/** 작업면 형상(World, m·rad). 계약 필드와 1:1 이다(centerXy=center_xy, sizeXy=size_xy, yawRad=yaw_rad, topHeightM=top_height_m). */
export interface WorkSurfaceGeometry {
  centerXy: [number, number];
  sizeXy: [number, number];
  yawRad: number;
  topHeightM: number;
}

export interface WorkSurfaceView extends WorkSurfaceGeometry {
  surfaceId: string;
  /** 상판 높이 표준편차(m). 항목에 없으면 null(AI 는 0.02 로 읽는다). 편집하지 않는다. */
  topHeightSigmaM: number | null;
  /** 받은 항목 원본(얕은 사본). 이름·종류 같은 다른 키를 결과 항목에 그대로 돌려주려고 보관한다. */
  source: Readonly<Record<string, unknown>>;
}

export interface WorkSurfaceSnapshot {
  status: 'NONE' | 'READY' | 'REJECTED';
  /**
   * 받은 형상의 출처. OPERATIONAL_GEOMETRY_UNCONFIRMED 구성 묶음 모양(전달 경로 미확정) ·
   * BE_STATIC_OBJECTS_V1 BE GET /api/static-objects 응답(-58). 저장·적용(ACK) 상태가 아니다.
   */
  contract: WorkSurfaceContract;
  /** 묶음에 실린 version(구성 묶음 geometry_version). 없으면 null. */
  geometryVersion: string | null;
  surfaces: readonly WorkSurfaceView[];
  /** 형식이 틀려 뺀 항목과 이유. */
  invalid: readonly { surfaceId: string | null; reason: string }[];
  /** 등록 정적 객체(OBSTACLE, -274). 같은 묶음의 static_objects 에서 읽는다. */
  obstacles: readonly ObstacleView[];
  /** 형식이 틀리거나 ID 가 겹쳐 뺀 정적 객체와 이유. */
  invalidObstacles: readonly InvalidObstacle[];
  receivedAt: number | null;
  reason: string | null;
  /** BE 정식 응답이면 그린 객체의 object_version(ID → 버전). 묶음 모양 입력에는 없다. */
  objectVersions?: Readonly<Record<string, number>>;
}

/** 작업면·정적 객체 형상 출처. */
export type WorkSurfaceContract = 'OPERATIONAL_GEOMETRY_UNCONFIRMED' | 'BE_STATIC_OBJECTS_V1';

export const NO_WORK_SURFACES: WorkSurfaceSnapshot = {
  status: 'NONE',
  contract: 'OPERATIONAL_GEOMETRY_UNCONFIRMED',
  geometryVersion: null,
  surfaces: [],
  invalid: [],
  obstacles: [],
  invalidObstacles: [],
  receivedAt: null,
  reason: null,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const pair = (value: unknown): [number, number] | null =>
  Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)
    ? [value[0] as number, value[1] as number]
    : null;

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

/** -π~π 로 감는다. 이미 범위 안이면 값을 그대로 둔다(부동소수점 흔들림 없이). */
const wrapYaw = (yaw: number) =>
  Math.abs(yaw) <= Math.PI ? yaw : Math.atan2(Math.sin(yaw), Math.cos(yaw));

/** 작업면 ID 검사(AI 와 같음): 빈 문자열이 아니고 바닥 ID 와 겹치지 않는다. */
export function surfaceIdProblem(id: unknown): string | null {
  if (typeof id !== 'string' || id === '') return 'surface_id 가 비었다';
  if (id === FLOOR_SURFACE_ID) return '바닥 ID(floor)와 겹친다';
  return null;
}

/** 새로 만들거나 고친 작업면 형상 검사. 유한수, 크기·상판 > 0, yaw 는 [-π, π]. 틀리면 이유. */
export function geometryProblem(geometry: unknown): string | null {
  const top = field(geometry, 'topHeightM');
  if (!isFiniteNumber(top) || top <= 0) return '상판 높이는 0 보다 큰 유한수여야 한다';
  if (!pair(field(geometry, 'centerXy'))) return '중심은 유한수 2개여야 한다';
  const size = pair(field(geometry, 'sizeXy'));
  if (!size || !size.every((v) => v > 0)) return '크기는 양수 2개여야 한다';
  const yaw = field(geometry, 'yawRad');
  if (!isFiniteNumber(yaw) || Math.abs(yaw) > YAW_LIMIT_RAD)
    return 'yaw 는 [-π, π] 라디안이어야 한다';
  return null;
}

/**
 * 항목 하나를 검사한다. AI(risk.work_surface·contact.surfaces)가 받는 항목을 똑같이 받고 똑같이 뺀다(두 쪽이 같은 작업면을 보게).
 * 값을 넓히거나 줄여 맞추지 않는다. yaw_rad 는 AI 처럼 유한하면 받고, 화면·결과에는 같은 방향의 [-π, π] 값으로 쓴다.
 */
export function readWorkSurface(item: unknown): { surface: WorkSurfaceView } | { reason: string } {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return { reason: '항목이 객체가 아니다' };
  }
  const surfaceId = field(item, 'surface_id');
  const idProblem = surfaceIdProblem(surfaceId);
  if (idProblem) return { reason: idProblem };
  const top = field(item, 'top_height_m');
  if (!isFiniteNumber(top) || top <= 0)
    return { reason: 'top_height_m 은 0 보다 큰 유한수여야 한다' };
  const center = pair(field(item, 'center_xy'));
  if (!center) return { reason: 'center_xy 는 유한수 2개여야 한다' };
  const size = pair(field(item, 'size_xy'));
  if (!size || !size.every((v) => v > 0)) return { reason: 'size_xy 는 양수 2개여야 한다' };
  const rawYaw = field(item, 'yaw_rad');
  if (rawYaw !== undefined && !isFiniteNumber(rawYaw)) {
    return { reason: 'yaw_rad 가 유한한 수가 아니다' };
  }
  const sigma = field(item, 'top_height_sigma_m');
  if (sigma !== undefined && (!isFiniteNumber(sigma) || sigma < 0)) {
    return { reason: 'top_height_sigma_m 은 0 이상 유한수여야 한다' };
  }
  return {
    surface: {
      surfaceId: surfaceId as string,
      topHeightM: top,
      centerXy: center,
      sizeXy: size,
      yawRad: rawYaw === undefined ? 0 : wrapYaw(rawYaw),
      topHeightSigmaM: sigma === undefined ? null : sigma,
      source: Object.freeze({ ...(item as Record<string, unknown>) }),
    },
  };
}

/**
 * 작업면 묶음({ version?, work_surfaces?: [...], static_objects?: [...] })을 검사한다.
 * 작업면은 AI work_surfaces_from_operational_geometry 와 같은 규칙이다.
 * - work_surfaces 가 없으면 작업면 0개, 배열이 아니면 묶음 전체 거부.
 * - 형식이 틀린 항목은 빼고 이유를 남긴다. 같은 surface_id 는 앞의 유효 항목만 쓰고 뒤 항목을 뺀다.
 *   (구성 묶음 검증 config.verify 는 중복 ID 묶음 자체를 거부하므로 Tier 0 에는 오지 않는다.)
 * - static_objects 는 readStaticObjects 규칙(배열이 아니면 묶음 전체 거부, 항목은 이유와 함께 뺀다)이다.
 * READY 는 형상을 받아 검사했다는 뜻이다. 구성 묶음이 현장에 적용됐다는 증거가 아니다.
 */
export function adaptWorkSurfaces(raw: unknown, receivedAt: number): WorkSurfaceSnapshot {
  const items = field(raw, 'work_surfaces');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...NO_WORK_SURFACES, status: 'REJECTED', receivedAt, reason: '묶음이 객체가 아니다' };
  }
  if (items !== undefined && !Array.isArray(items)) {
    return {
      ...NO_WORK_SURFACES,
      status: 'REJECTED',
      receivedAt,
      reason: 'work_surfaces 가 배열이 아니다',
    };
  }
  const version = field(raw, 'version');
  const surfaces: WorkSurfaceView[] = [];
  const invalid: { surfaceId: string | null; reason: string }[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const id = field(item, 'surface_id');
    const surfaceId = typeof id === 'string' ? id : null;
    const checked = readWorkSurface(item);
    if ('reason' in checked) invalid.push({ surfaceId, reason: checked.reason });
    else if (seen.has(checked.surface.surfaceId))
      invalid.push({ surfaceId, reason: 'surface_id 가 겹친다(앞 항목 사용)' });
    else {
      seen.add(checked.surface.surfaceId);
      surfaces.push(checked.surface);
    }
  }
  const statics = readStaticObjects(raw, seen);
  if ('reason' in statics) {
    return { ...NO_WORK_SURFACES, status: 'REJECTED', receivedAt, reason: statics.reason };
  }
  return {
    status: 'READY',
    contract: 'OPERATIONAL_GEOMETRY_UNCONFIRMED',
    geometryVersion: typeof version === 'string' && version !== '' ? version : null,
    surfaces,
    invalid,
    obstacles: statics.obstacles,
    invalidObstacles: statics.invalid,
    receivedAt,
    reason: null,
  };
}

/**
 * 계약 work_surface 항목(snake_case)으로 바꾼다. 화면 안 camelCase 와 바깥 계약의 경계는 여기 한 곳이다.
 * source(받은 원본 항목)의 다른 키(top_height_sigma_m·name 등)는 그대로 두고 형상 다섯 필드만 덮어쓴다.
 */
export function workSurfaceItem(
  surfaceId: string,
  geometry: WorkSurfaceGeometry,
  source: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...source,
    surface_id: surfaceId,
    top_height_m: geometry.topHeightM,
    center_xy: [geometry.centerXy[0], geometry.centerXy[1]],
    size_xy: [geometry.sizeXy[0], geometry.sizeXy[1]],
    yaw_rad: geometry.yawRad,
  };
}

/** 작업면 → 공통 편집 엔진의 OBB. 바닥(Z=0)부터 상판까지라 중심 Z 는 상판의 절반, 높이는 상판 높이다. */
export function workSurfaceObb(surface: WorkSurfaceGeometry): WorldObb {
  const [cx, cy] = surface.centerXy;
  const [w, d] = surface.sizeXy;
  return {
    center: worldPoint(cx, cy, surface.topHeightM / 2),
    size: [w, d, surface.topHeightM],
    yaw: surface.yawRad,
  };
}

/** OBB → 작업면 형상(바깥에 넘길 평범한 값). 상판 높이는 OBB 윗면 Z 다. */
export function obbWorkSurface(obb: WorldObb): WorkSurfaceGeometry {
  return {
    centerXy: [obb.center[0], obb.center[1]],
    sizeXy: [obb.size[0], obb.size[1]],
    yawRad: obb.yaw,
    topHeightM: obb.center[2] + obb.size[2] / 2,
  };
}

/** 같은 형상인지(부동소수점 오차 허용). */
export function sameWorkSurface(a: WorkSurfaceGeometry, b: WorkSurfaceGeometry, epsilon = 1e-9) {
  const near = (x: number, y: number) => Math.abs(x - y) <= epsilon;
  return (
    near(a.centerXy[0], b.centerXy[0]) &&
    near(a.centerXy[1], b.centerXy[1]) &&
    near(a.sizeXy[0], b.sizeXy[0]) &&
    near(a.sizeXy[1], b.sizeXy[1]) &&
    near(a.yawRad, b.yawRad) &&
    near(a.topHeightM, b.topHeightM)
  );
}

/** 같은 OBB 인지(부동소수점 오차 허용). */
export function sameObb(a: WorldObb, b: WorldObb, epsilon = 1e-9) {
  const near = (x: number, y: number) => Math.abs(x - y) <= epsilon;
  return (
    a.center.every((v, i) => near(v, b.center[i]!)) &&
    a.size.every((v, i) => near(v, b.size[i]!)) &&
    near(a.yaw, b.yaw)
  );
}

/**
 * 바닥 투영 사각형의 World 꼭짓점 4개를 높이 z 에 둔다. 순서는 AI WorkSurface.footprint 와 같다
 * (지역 (−,−) → (+,−) → (+,+) → (−,+), 반시계). 변 i 는 꼭짓점 i → i+1 이다.
 */
export function surfaceCorners(surface: WorkSurfaceGeometry, z: number): WorldPoint[] {
  const [hx, hy] = [surface.sizeXy[0] / 2, surface.sizeXy[1] / 2];
  const [c, s] = [Math.cos(surface.yawRad), Math.sin(surface.yawRad)];
  const [cx, cy] = surface.centerXy;
  const local: [number, number][] = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ];
  return local.map(([u, v]) => worldPoint(cx + u * c - v * s, cy + u * s + v * c, z));
}

/** 윗면(상판) 가장자리 꼭짓점 4개(World). R2·R3 가 보는 등록 OBB 윗면 둘레다(명세 7.5). */
export const surfaceTopEdge = (surface: WorkSurfaceGeometry) =>
  surfaceCorners(surface, surface.topHeightM);

/** 바깥에 넘길 평범한 배열 사본. */
export const workSurfaceJson = (surface: WorkSurfaceGeometry): WorkSurfaceGeometry => ({
  centerXy: [surface.centerXy[0], surface.centerXy[1]],
  sizeXy: [surface.sizeXy[0], surface.sizeXy[1]],
  yawRad: surface.yawRad,
  topHeightM: surface.topHeightM,
});
