import { ROOM_BOUNDS, type PlanBounds, type PlanPoint } from '@/features/plan/plan';
import type { Http } from '@/lib/http';
import { z } from 'zod';

// BEV 평면도 REST(명세 4.1·12.6 GET /api/floor-plans/current, FR-22, 계약 bev_floorplan.schema.json, BE 곽나혁).
// 평면도는 보조 화면이라 좌표·스케일의 기준이 아니고 안전 판단에 쓰지 않는다(purpose OVERVIEW_DISPLAY_ONLY).
// 화면이 쓰는 칸만 검사한다. 칸마다 따로 읽어, 형식이 틀린 칸만 비운다.

const num = z.number().finite();
const vec2 = z.tuple([num, num]);
const text = z.string().nullish().catch(undefined);

const rasterSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  meters_per_pixel: z.number().positive(),
  /** 이미지가 덮는 World 범위(m). 열 = +X, 행 = −Y 라 위쪽 모서리가 max y 다. */
  world_bounds: z.object({ min_xy: vec2, max_xy: vec2 }),
});

const outlineSchema = z.object({
  /** World (x, y) 미터, 반시계. 카메라가 본 바닥의 볼록 껍질이라 정확도를 주장하지 않는다(NOT_CLAIMED). */
  polygon_xy: z.array(vec2).min(3),
});

export const floorPlanSchema = z.object({
  floor_plan_id: z.union([z.number(), z.string()]),
  calibration_version: text,
  current_calibration_version: text,
  /** 지금 보정 버전으로 만든 평면도가 아니다(새로 만드는 중이거나 프레임이 없다). */
  stale: z.boolean().catch(false),
  /** 지금 보정 버전의 평면도를 만드는 중이다. */
  pending: z.boolean().catch(false),
  /** 5분짜리 서명 GET 주소. */
  image_url: z.string().min(1).nullish().catch(undefined),
  image_url_expires_at_ms: z.number().nullish().catch(undefined),
  content_type: text,
  image_sha256: text,
  raster: rasterSchema.nullish().catch(undefined),
  room_outline: outlineSchema.nullish().catch(undefined),
});

export type FloorPlanData = z.infer<typeof floorPlanSchema>;

export const FLOOR_PLAN_KEY = ['floor-plans', 'current'] as const;

// http 를 인자로 받는다. 테스트가 env 없이 createHttp 로 부를 수 있게 한다.

/** 현재 평면도(로그인한 모든 역할). 만들어진 것이 없으면 404 FLOOR_PLAN_NOT_READY. */
export function requestFloorPlan(http: Http, signal?: AbortSignal) {
  return http('/api/floor-plans/current', { schema: floorPlanSchema, signal });
}

/** 평면이 그릴 수 있는 범위(m). 이 밖이면 잘못된 값으로 보고 쓰지 않는다. */
const MIN_EXTENT_M = 1;
const MAX_EXTENT_M = 500;

const inExtent = (extent: number) => extent >= MIN_EXTENT_M && extent <= MAX_EXTENT_M;

function boundsOf(minX: number, minY: number, maxX: number, maxY: number): PlanBounds | undefined {
  return inExtent(maxX - minX) && inExtent(maxY - minY) ? { minX, minY, maxX, maxY } : undefined;
}

/** 폴리곤을 감싸는 바깥 상자. */
function outlineBounds(polygon: readonly PlanPoint[]): PlanBounds | undefined {
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  return boundsOf(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/**
 * 평면이 그릴 방 범위. 이미지가 덮는 world_bounds 를 우선하고, 없으면 방 외곽 폴리곤의 바깥 상자를 쓴다.
 * 둘 다 없거나 쓸 수 없으면(404·값 이상) 기본 10×10m 를 쓴다.
 */
export function floorPlanBounds(plan: FloorPlanData | null | undefined): PlanBounds {
  const wb = plan?.raster?.world_bounds;
  const fromRaster = wb && boundsOf(wb.min_xy[0], wb.min_xy[1], wb.max_xy[0], wb.max_xy[1]);
  if (fromRaster) return fromRaster;
  const polygon = plan?.room_outline?.polygon_xy;
  return (polygon && outlineBounds(polygon)) ?? ROOM_BOUNDS;
}

/** 방 외곽 폴리곤(World m). 없으면 undefined. */
export function floorPlanOutline(
  plan: FloorPlanData | null | undefined,
): readonly PlanPoint[] | undefined {
  return plan?.room_outline?.polygon_xy;
}
