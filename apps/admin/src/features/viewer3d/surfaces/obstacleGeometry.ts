import type { WorldObb } from '@/features/viewer3d/editing/editGeometry';
import { worldPoint, type WorldPoint } from '@/features/viewer3d/worldCoordinates';

// 등록 정적 객체(OBSTACLE) Operational Geometry 의 순수 계산(S15P31A101-274). 렌더러·React 와 떨어져 있어 시험한다.
//
// 항목 형식은 BE -58 구성 묶음 operational_geometry.static_objects 를 그대로 따른다
// (server ConfigBundleService.geometry, StaticObjectRequest, StaticObjectRepository.check).
//   { object_id, kind: 'OBSTACLE', obb: { center, size, yaw_rad, top_height_sigma_m? }, top_height_m? }
//   - center: OBB 3D 가운데 [x, y, z](World m). 바닥 기준점이 아니다. 장애물은 바닥에서 떠 있을 수 있다.
//   - size: 지역 X'·Y'·높이 전체 길이(m, 모두 > 0).
//   - yaw_rad: World +Z 축 반시계 회전(rad). BE 는 범위 제한 없이 유한하면 받고 없으면 0 으로 저장한다.
// 작업면(WORK_SURFACE)은 같은 static_object 표에서 오지만 묶음에서는 work_surfaces 로 따로 실린다.
// object_id 는 표 기본 키라 작업면 ID 와 겹치지 않는다. 겹쳐 들어오면 장면 대상이 하나라 정적 객체 쪽을 뺀다.
//
// 이 형상은 안전 판단용 Operational Geometry 다. 보기용 glTF(Visual Geometry)를 대신 쓰지 않는다.
// 충돌·R2·R3·AI 판단은 여기서 만들지 않는다.

export const OBSTACLE_KIND = 'OBSTACLE';

/** 정적 객체 형상(World, m·rad). 계약 obb 와 1:1 이다(center=center, size=size, yawRad=yaw_rad). */
export interface ObstacleGeometry {
  center: [number, number, number];
  size: [number, number, number];
  yawRad: number;
}

export interface ObstacleView extends ObstacleGeometry {
  objectId: string;
  /** 받은 항목의 name(조회 API 에만 있다). 없으면 null. */
  name: string | null;
  /** 받은 항목 원본(얕은 사본). obb 안 다른 키·top_height_m 등을 결과 항목에 그대로 돌려주려고 보관한다. */
  source: Readonly<Record<string, unknown>>;
}

export interface InvalidObstacle {
  objectId: string | null;
  reason: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const triple = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;

/** -π~π 로 감는다. 이미 범위 안이면 값을 그대로 둔다(작업면과 같은 규칙). */
const wrapYaw = (yaw: number) =>
  Math.abs(yaw) <= Math.PI ? yaw : Math.atan2(Math.sin(yaw), Math.cos(yaw));

/**
 * 정적 객체 항목 하나를 검사한다. BE 가 저장할 때 받는 값(StaticObjectRepository.check)과
 * Tier 0 config.verify 가 받는 묶음 항목을 똑같이 받고 뺀다. 값을 넓히거나 줄여 맞추지 않는다.
 * yaw_rad 는 유한하면 받고(없거나 null 이면 0), 화면·결과에는 같은 방향의 [-π, π] 값으로 쓴다.
 */
export function readObstacle(item: unknown): { obstacle: ObstacleView } | { reason: string } {
  if (!isRecord(item)) return { reason: '항목이 객체가 아니다' };
  const objectId = item.object_id;
  if (typeof objectId !== 'string' || objectId === '') return { reason: 'object_id 가 비었다' };
  if (item.kind === 'WORK_SURFACE') return { reason: '작업면은 work_surfaces 로 받는다' };
  if (item.kind !== OBSTACLE_KIND) return { reason: 'kind 는 OBSTACLE 이어야 한다' };
  const obb = item.obb;
  if (!isRecord(obb)) return { reason: 'obb 가 객체가 아니다' };
  const center = triple(obb.center);
  if (!center) return { reason: 'obb.center 는 유한수 3개여야 한다' };
  const size = triple(obb.size);
  if (!size || !size.every((v) => v > 0)) return { reason: 'obb.size 는 양수 3개여야 한다' };
  const rawYaw = obb.yaw_rad;
  if (rawYaw !== undefined && rawYaw !== null && !isFiniteNumber(rawYaw)) {
    return { reason: 'obb.yaw_rad 가 유한한 수가 아니다' };
  }
  const sigma = obb.top_height_sigma_m;
  if (sigma !== undefined && (!isFiniteNumber(sigma) || sigma < 0)) {
    return { reason: 'obb.top_height_sigma_m 은 0 이상 유한수여야 한다' };
  }
  const top = item.top_height_m;
  if (top !== undefined && top !== null && !isFiniteNumber(top)) {
    return { reason: 'top_height_m 은 유한수여야 한다' };
  }
  return {
    obstacle: {
      objectId,
      name: typeof item.name === 'string' && item.name !== '' ? item.name : null,
      center,
      size,
      yawRad: isFiniteNumber(rawYaw) ? wrapYaw(rawYaw) : 0,
      source: Object.freeze({ ...item }),
    },
  };
}

/**
 * 묶음의 static_objects 를 검사한다. 없으면 0개, 배열이 아니면 묶음 전체 거부(config.verify 와 같다).
 * 형식이 틀린 항목은 이유와 함께 빼고, 같은 object_id 는 앞의 유효 항목만 쓴다.
 * 작업면 surface_id 와 겹치는 항목은 뺀다(장면 대상 object:ID 가 하나뿐이다).
 */
export function readStaticObjects(
  raw: unknown,
  surfaceIds: ReadonlySet<string>,
): { obstacles: ObstacleView[]; invalid: InvalidObstacle[] } | { reason: string } {
  const items = isRecord(raw) ? raw.static_objects : undefined;
  if (items === undefined) return { obstacles: [], invalid: [] };
  if (!Array.isArray(items)) return { reason: 'static_objects 가 배열이 아니다' };
  const obstacles: ObstacleView[] = [];
  const invalid: InvalidObstacle[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = isRecord(item) ? item.object_id : undefined;
    const objectId = typeof id === 'string' ? id : null;
    const checked = readObstacle(item);
    if ('reason' in checked) invalid.push({ objectId, reason: checked.reason });
    else if (seen.has(checked.obstacle.objectId))
      invalid.push({ objectId, reason: 'object_id 가 겹친다(앞 항목 사용)' });
    else if (surfaceIds.has(checked.obstacle.objectId))
      invalid.push({ objectId, reason: 'object_id 가 작업면 surface_id 와 겹친다' });
    else {
      seen.add(checked.obstacle.objectId);
      obstacles.push(checked.obstacle);
    }
  }
  return { obstacles, invalid };
}

/** 정적 객체 → 공통 편집 엔진의 OBB. 계약 obb 가 이미 3D 중심·전체 크기라 그대로 옮긴다. */
export function obstacleObb(obstacle: ObstacleGeometry): WorldObb {
  const [x, y, z] = obstacle.center;
  return {
    center: worldPoint(x, y, z),
    size: [obstacle.size[0], obstacle.size[1], obstacle.size[2]],
    yaw: obstacle.yawRad,
  };
}

/** OBB → 정적 객체 형상(바깥에 넘길 평범한 값). */
export function obbObstacle(obb: WorldObb): ObstacleGeometry {
  return {
    center: [obb.center[0], obb.center[1], obb.center[2]],
    size: [obb.size[0], obb.size[1], obb.size[2]],
    yawRad: obb.yaw,
  };
}

/** 바깥에 넘길 평범한 배열 사본. */
export const obstacleJson = (obstacle: ObstacleGeometry): ObstacleGeometry => ({
  center: [obstacle.center[0], obstacle.center[1], obstacle.center[2]],
  size: [obstacle.size[0], obstacle.size[1], obstacle.size[2]],
  yawRad: obstacle.yawRad,
});

/** 아랫면·윗면 높이(World Z, m). */
export const obstacleZRange = (obstacle: ObstacleGeometry): [number, number] => [
  obstacle.center[2] - obstacle.size[2] / 2,
  obstacle.center[2] + obstacle.size[2] / 2,
];

/**
 * World 꼭짓점 8개. 아랫면 4개 → 윗면 4개 순서이고, 각 면은 지역 (−,−) → (+,−) → (+,+) → (−,+)(반시계)다.
 * 작업면 surfaceCorners 와 같은 순서라 i 와 i+4 가 세로 모서리 하나다.
 */
export function obstacleCorners(obstacle: ObstacleGeometry): WorldPoint[] {
  const [hx, hy] = [obstacle.size[0] / 2, obstacle.size[1] / 2];
  const [c, s] = [Math.cos(obstacle.yawRad), Math.sin(obstacle.yawRad)];
  const [cx, cy] = obstacle.center;
  const [bottom, top] = obstacleZRange(obstacle);
  const ring: [number, number][] = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ];
  return [bottom, top].flatMap((z) =>
    ring.map(([u, v]) => worldPoint(cx + u * c - v * s, cy + u * s + v * c, z)),
  );
}

/**
 * 계약 static_objects 항목(snake_case)으로 바꾼다. 화면 안 camelCase 와 바깥 계약의 경계는 여기 한 곳이다.
 * source(받은 원본 항목)의 다른 키(top_height_m·name 등)와 obb 안 다른 키(top_height_sigma_m)는 그대로 두고
 * object_id·kind 와 obb 의 center·size·yaw_rad 만 덮어쓴다.
 */
export function obstacleItem(
  objectId: string,
  geometry: ObstacleGeometry,
  source: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const obb = isRecord(source.obb) ? source.obb : {};
  return {
    ...source,
    object_id: objectId,
    kind: OBSTACLE_KIND,
    obb: {
      ...obb,
      center: [geometry.center[0], geometry.center[1], geometry.center[2]],
      size: [geometry.size[0], geometry.size[1], geometry.size[2]],
      yaw_rad: geometry.yawRad,
    },
  };
}
