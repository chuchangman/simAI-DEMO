import {
  adaptWorkSurfaces,
  NO_WORK_SURFACES,
  type WorkSurfaceSnapshot,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';

// BE 정식 정적 객체(S15P31A101-58) GET /api/static-objects 응답을 3D 작업면·장애물로 바꾼다(S15P31A101-234).
//
// 응답은 객체마다 최신 버전 하나씩인 배열이다(server StaticObjectRepository.view):
//   { object_id, object_version, kind: WORK_SURFACE|OBSTACLE, name, obb: { center, size, yaw_rad },
//     top_height_m, top_height_sigma_m?, valid_from, valid_to }
// Tier 0 가 받는 구성 묶음 operational_geometry 는 같은 행을 다음처럼 옮긴다(server ConfigBundleService.geometry).
// 여기서도 똑같이 옮겨 기존 묶음 검사기(adaptWorkSurfaces)에 넘긴다. 그래서 Viewer·Tier 0 가 같은 작업면을 본다.
//   - WORK_SURFACE → work_surfaces: surface_id, top_height_m, center_xy = obb.center[0..1], size_xy = obb.size[0..1],
//     yaw_rad, top_height_sigma_m. 작업면 OBB 는 바닥(Z=0)~상판이고 obb.center Z·size Z 는 쓰지 않는다.
//   - OBSTACLE → static_objects: object_id, kind, obb(top_height_sigma_m 은 obb 안), top_height_m(있을 때만).
// 형식이 틀린 행은 이유와 함께 빼고(값을 고치지 않는다), 나머지는 그대로 그린다.
// READY 는 형상을 받아 검사했다는 뜻이다. 구성 묶음 발행·Tier 0 적용(ACK)과는 별개다.

export const OFFICIAL_STATIC_OBJECT_CONTRACT = 'BE_STATIC_OBJECTS_V1' as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const numbers = (value: unknown, length: number): number[] | null =>
  Array.isArray(value) && value.length === length && value.every(isFiniteNumber)
    ? (value as number[])
    : null;

type Converted =
  | { kind: 'WORK_SURFACE'; item: Record<string, unknown> }
  | { kind: 'OBSTACLE'; item: Record<string, unknown> }
  | { kind: 'INVALID'; surface: boolean; reason: string };

/** 한 행을 구성 묶음 항목으로 옮긴다. 묶음 검사기가 다시 검사하므로 여기서는 옮길 수 있는지만 본다. */
function convert(row: unknown): Converted {
  if (!isRecord(row)) return { kind: 'INVALID', surface: false, reason: '항목이 객체가 아니다' };
  const surface = row.kind === 'WORK_SURFACE';
  const invalid = (reason: string): Converted => ({ kind: 'INVALID', surface, reason });
  if (row.kind !== 'WORK_SURFACE' && row.kind !== 'OBSTACLE') {
    return invalid('kind 는 WORK_SURFACE 또는 OBSTACLE 이어야 한다');
  }
  const version = row.object_version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    return invalid('object_version 은 1 이상 정수여야 한다');
  }
  if (row.valid_to != null) return invalid('지금 유효한 버전이 아니다(valid_to 있음)');
  const obb = row.obb;
  if (!isRecord(obb)) return invalid('obb 가 객체가 아니다');
  const sigma = row.top_height_sigma_m;
  const name = typeof row.name === 'string' && row.name !== '' ? row.name : undefined;
  // 이름·버전은 묶음 검사기가 원본 항목(source)으로 보관해 결과 항목에 그대로 돌려준다.
  const extra = { ...(name ? { name } : {}), object_version: version };
  if (surface) {
    const center = numbers(obb.center, 3);
    const size = numbers(obb.size, 3);
    if (!center) return invalid('obb.center 는 유한수 3개여야 한다');
    if (!size) return invalid('obb.size 는 유한수 3개여야 한다');
    return {
      kind: 'WORK_SURFACE',
      item: {
        surface_id: row.object_id,
        top_height_m: row.top_height_m,
        center_xy: [center[0], center[1]],
        size_xy: [size[0], size[1]],
        yaw_rad: obb.yaw_rad ?? 0,
        ...(sigma === undefined ? {} : { top_height_sigma_m: sigma }),
        ...extra,
      },
    };
  }
  return {
    kind: 'OBSTACLE',
    item: {
      object_id: row.object_id,
      kind: 'OBSTACLE',
      obb: { ...obb, ...(sigma === undefined ? {} : { top_height_sigma_m: sigma }) },
      ...(row.top_height_m == null ? {} : { top_height_m: row.top_height_m }),
      ...extra,
    },
  };
}

/**
 * GET /api/static-objects 응답(배열)을 검사한다. 배열이 아니면 전체 거부.
 * 같은 ID 규칙·작업면 우선 규칙은 묶음 검사기와 같다(앞의 유효 항목 사용, 작업면 ID 와 겹치는 장애물 제외).
 */
export function adaptOfficialStaticObjects(raw: unknown, receivedAt: number): WorkSurfaceSnapshot {
  if (!Array.isArray(raw)) {
    return {
      ...NO_WORK_SURFACES,
      status: 'REJECTED',
      contract: OFFICIAL_STATIC_OBJECT_CONTRACT,
      receivedAt,
      reason: '정적 객체 응답이 배열이 아니다',
    };
  }
  const surfaceItems: Record<string, unknown>[] = [];
  const obstacleItems: Record<string, unknown>[] = [];
  const invalidSurfaces: { surfaceId: string | null; reason: string }[] = [];
  const invalidObstacles: { objectId: string | null; reason: string }[] = [];
  for (const row of raw) {
    const id = isRecord(row) && typeof row.object_id === 'string' ? row.object_id : null;
    const converted = convert(row);
    if (converted.kind === 'INVALID') {
      if (converted.surface) invalidSurfaces.push({ surfaceId: id, reason: converted.reason });
      else invalidObstacles.push({ objectId: id, reason: converted.reason });
      continue;
    }
    (converted.kind === 'WORK_SURFACE' ? surfaceItems : obstacleItems).push(converted.item);
  }
  const snapshot = adaptWorkSurfaces(
    { work_surfaces: surfaceItems, static_objects: obstacleItems },
    receivedAt,
  );
  // 버전은 실제로 그리는 항목(묶음 검사기가 받은 항목)의 원본에서 읽는다. 같은 ID 가 겹치거나 앞 항목이 형식 오류로
  // 빠지거나 작업면·장애물이 같은 ID 를 쓰더라도, 그린 형상과 버전이 늘 같은 행에서 나온다.
  const versions: Record<string, number> = {};
  for (const { surfaceId, source } of snapshot.surfaces) {
    versions[surfaceId] = source.object_version as number;
  }
  for (const { objectId, source } of snapshot.obstacles) {
    versions[objectId] = source.object_version as number;
  }
  return {
    ...snapshot,
    contract: OFFICIAL_STATIC_OBJECT_CONTRACT,
    geometryVersion: null,
    invalid: [...invalidSurfaces, ...snapshot.invalid],
    invalidObstacles: [...invalidObstacles, ...snapshot.invalidObstacles],
    objectVersions: Object.freeze(versions),
  };
}

/**
 * 작업면·정적 객체 결과 본문을 받는 입구. 본문 모양으로 출처를 가른다.
 * - 배열: BE 정식 GET /api/static-objects 응답(-58) → adaptOfficialStaticObjects
 * - 객체 { version?, work_surfaces?, static_objects? }: 구성 묶음 operational_geometry 모양(기존 FE·개발 경로) → adaptWorkSurfaces
 */
export function adaptGeometry(raw: unknown, receivedAt: number): WorkSurfaceSnapshot {
  return Array.isArray(raw)
    ? adaptOfficialStaticObjects(raw, receivedAt)
    : adaptWorkSurfaces(raw, receivedAt);
}
