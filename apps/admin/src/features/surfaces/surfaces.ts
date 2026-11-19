import {
  staticObjectItemSchema,
  type StaticObjectBody,
  type StaticObjectItem,
  type SurfaceGeometry,
  type ViewerWorkSurfaces,
  type WorkSurface,
} from '@/features/surfaces/types';

// 작업면 순수 계산. 3D 뷰어 입구는 three.js 를 끌어오므로 값을 import 하지 않고, 같은 규칙을 여기서 계산한다
// (뷰어 surfaces/workSurfaceGeometry.ts·서버 ConfigBundleService.geometry() 와 같은 형식).

/** 계약 yaw_rad 범위(risk_plan_request work_surface). 뷰어도 이 밖의 값은 받지 않는다. */
const YAW_LIMIT_RAD = 3.1415927;
/** 정적 객체 중 작업면의 kind. 장애물(OBSTACLE)은 이 화면이 다루지 않는다. */
const WORK_SURFACE_KIND = 'WORK_SURFACE';
/** 바닥 ID. 작업면 ID 로 쓸 수 없다. */
const FLOOR_ID = 'floor';
/** 서버가 상판 높이를 float4 로 돌려주므로 값 비교는 이만큼 너그럽게 한다(m·rad). */
const SAME_EPS = 1e-6;

/** -π~π 로 감는다. 이미 범위 안이면 그대로 둔다. */
export function wrapYaw(yaw: number): number {
  return Math.abs(yaw) <= Math.PI ? yaw : Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

function toSurface(item: StaticObjectItem): WorkSurface | null {
  if (item.kind !== WORK_SURFACE_KIND || item.object_id === FLOOR_ID) return null;
  const [cx, cy] = item.obb.center;
  const [sx, sy] = item.obb.size;
  const geometry: SurfaceGeometry = {
    centerXy: [cx, cy],
    sizeXy: [sx, sy],
    yawRad: wrapYaw(item.obb.yaw_rad),
    topHeightM: item.top_height_m ?? 0,
  };
  if (geometryErrors(geometry) !== null) return null;
  return {
    objectId: item.object_id,
    version: item.object_version,
    name: item.name,
    geometry,
    sigma: item.top_height_sigma_m ?? null,
    zoneId: item.zone_id ?? null,
    validFrom: item.valid_from,
    workId: item.work_id ?? null,
    layoutId: item.layout_id ?? null,
    layoutItemId: item.layout_item_id ?? null,
  };
}

/**
 * 서버 목록을 작업면으로 읽는다. 배열이 아니면 없는 것으로 본다. 장애물·형식이 틀린 항목·상판이 없는 항목은 뺀다.
 * 형식이 틀린 항목도 ID 는 센다(같은 ID 가 둘이면 어느 쪽이 맞는지 알 수 없어 둘 다 뺀다).
 */
export function readWorkSurfaces(data: unknown): WorkSurface[] {
  if (!Array.isArray(data)) return [];
  const count = new Map<string, number>();
  for (const item of data) {
    const id = typeof item === 'object' && item !== null ? Reflect.get(item, 'object_id') : null;
    if (typeof id === 'string') count.set(id, (count.get(id) ?? 0) + 1);
  }
  return data.flatMap((item) => {
    const parsed = staticObjectItemSchema.safeParse(item);
    if (!parsed.success || count.get(parsed.data.object_id) !== 1) return [];
    const surface = toSurface(parsed.data);
    return surface ? [surface] : [];
  });
}

/** 3D 뷰어 Source 에 넘길 작업면 묶음. 서버 구성 묶음과 같은 항목에 이름을 더한다. */
export function toViewerWorkSurfaces(surfaces: readonly WorkSurface[]): ViewerWorkSurfaces {
  return {
    work_surfaces: surfaces.map((s) => ({
      surface_id: s.objectId,
      top_height_m: s.geometry.topHeightM,
      center_xy: [...s.geometry.centerXy],
      size_xy: [...s.geometry.sizeXy],
      yaw_rad: s.geometry.yawRad,
      ...(s.sigma === null ? {} : { top_height_sigma_m: s.sigma }),
      ...(s.name === null ? {} : { name: s.name }),
    })),
  };
}

export interface SurfaceGeometryErrors {
  topHeightM?: string;
  size?: string;
  center?: string;
  yaw?: string;
}

/** 형상 검사(서버·Tier 0·뷰어가 받는 범위). 문제가 없으면 null. */
export function geometryErrors(geometry: SurfaceGeometry): SurfaceGeometryErrors | null {
  const errors: SurfaceGeometryErrors = {};
  const finite = (v: number) => Number.isFinite(v);
  if (!finite(geometry.topHeightM) || geometry.topHeightM <= 0)
    errors.topHeightM = '상판 높이는 0 보다 커야 합니다.';
  if (!geometry.sizeXy.every((v) => finite(v) && v > 0))
    errors.size = '폭과 깊이는 0 보다 커야 합니다.';
  if (!geometry.centerXy.every(finite)) errors.center = '중심 좌표를 숫자로 입력하세요.';
  if (!finite(geometry.yawRad) || Math.abs(geometry.yawRad) > YAW_LIMIT_RAD)
    errors.yaw = '회전은 -180° ~ 180° 입니다.';
  return Object.keys(errors).length > 0 ? errors : null;
}

/** 두 형상이 같은지. 서버가 높이를 float4 로 돌려주므로 1e-6 안의 차이는 같다고 본다. */
export function sameGeometry(a: SurfaceGeometry, b: SurfaceGeometry): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= SAME_EPS;
  return (
    near(a.centerXy[0], b.centerXy[0]) &&
    near(a.centerXy[1], b.centerXy[1]) &&
    near(a.sizeXy[0], b.sizeXy[0]) &&
    near(a.sizeXy[1], b.sizeXy[1]) &&
    near(a.yawRad, b.yawRad) &&
    near(a.topHeightM, b.topHeightM)
  );
}

/** 이름 초안을 서버에 둘 값으로. 앞뒤 공백을 빼고, 비면 이름 없음(null)이다. */
const nameOrNull = (draft: string) => draft.trim() || null;

/** 이름 초안이 저장된 이름과 같은지. */
export const sameName = (draft: string, name: string | null) => nameOrNull(draft) === name;

/**
 * 만들기·새 버전 본문. OBB 는 바닥(Z=0)부터 상판까지(가운데 z = 상판/2, 높이 = 상판)로 보내 서버 obb 와 상판 높이가
 * 어긋나지 않게 한다. yaw 는 [-π, π] 로 접어 보낸다(서버는 범위를 보지 않는다). 상판 높이 표준편차는 받은 값을 다시 보낸다.
 */
export function bodyOf(
  surface: WorkSurface | null,
  name: string,
  geometry: SurfaceGeometry,
): StaticObjectBody {
  const top = geometry.topHeightM;
  return {
    kind: WORK_SURFACE_KIND,
    name: nameOrNull(name),
    obb: {
      center: [geometry.centerXy[0], geometry.centerXy[1], top / 2],
      size: [geometry.sizeXy[0], geometry.sizeXy[1], top],
      yaw_rad: wrapYaw(geometry.yawRad),
    },
    top_height_m: top,
    top_height_sigma_m: surface?.sigma ?? null,
  };
}
