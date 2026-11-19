import { geometryErrors, wrapYaw } from '@/features/surfaces/surfaces';
import type { SurfaceGeometry } from '@/features/surfaces/types';
import { nextItemId, normalizeYawRad, polygonToObb2D } from '@/features/tbm/layoutGeometry';
import type { LayoutObbItem } from '@/features/tbm/types';
import type { ViewerEditBox } from '@/features/viewer3d';
import type { ZoneShape } from '@/features/zones/zoneForm';
import {
  openingZoneShape,
  r3,
  SURFACE_ZONE_MARGIN_M,
  surfaceZoneShape,
} from '@/features/zones/zoneShape';
import { isAxisRect } from '@/features/zones/zones';

// 가상 레이아웃 항목 ↔ 작업면·구역 변환(순수 계산). 작업을 시작하면 서버가 이 규칙으로 레이아웃 항목에서 구역을 만들고
// (서버 요청서 '세부 규칙'), 관제는 같은 규칙으로 구역을 레이아웃 항목으로 되돌려 PUT /api/layouts 로 보낸다.
// 고소 작업면 → 작업면 + 둘레 0.3 m 입체 구역, 개구부 → 바깥 0.3 m 구역. 옛 SCAFFOLD 는 고소 작업면으로 읽고 EQUIPMENT 는
// 구역을 만들지 않는다. 구역 등급은 서버가 경고(HIGH)로 정하고 판정 유형은 입체(VOLUME_3D)다(zoneForm 의 surfaceZoneForm 이 판정 유형을 맞춘다).

/** 구역에서 되돌린 개구부 항목의 가로·세로가 이보다 작으면 되돌리지 않는다(3D 손잡이의 최소 크기와 같다, m). */
const MIN_OPENING_SIZE_M = 0.2;
/** 새 항목 ID 앞부분. */
const ITEM_PREFIX = { OPENING: 'open', WORK_SURFACE: 'surf' } as const;
/** 이름 없는 항목의 기본 이름 앞부분(`개구부 1`, `고소 작업면 1`). */
const ITEM_LABEL = { OPENING: '개구부', WORK_SURFACE: '고소 작업면' } as const;

type ItemKind = LayoutObbItem['kind'];
/** 구역을 만들 수 있는 항목 종류. 옛 SCAFFOLD 는 WORK_SURFACE 로 센다. */
export type ZoneItemKind = keyof typeof ITEM_PREFIX;

const isWorkSurfaceKind = (kind: ItemKind) => kind === 'WORK_SURFACE' || kind === 'SCAFFOLD';

/** 항목이 속하는 구역 종류. 구역을 만들지 않는 종류(EQUIPMENT)는 null. */
const zoneKindOf = (kind: ItemKind): ZoneItemKind | null => {
  if (isWorkSurfaceKind(kind)) return 'WORK_SURFACE';
  return kind === 'OPENING' ? 'OPENING' : null;
};

/** 작업 시작 때 구역을 만드는 항목인지: 고소 작업면, 그리고 기존 구역에서 가져오지 않은 개구부. */
export function itemMakesZone(
  item: Pick<LayoutObbItem, 'kind' | 'source_zone_id' | 'source_object_id'>,
): boolean {
  const kind = zoneKindOf(item.kind);
  return (
    (kind === 'WORK_SURFACE' && !item.source_object_id) ||
    (kind === 'OPENING' && !item.source_zone_id)
  );
}

/** 고소 작업면 항목의 작업면 형상. 상판 = 가운데 z + 높이 / 2. 작업면 종류가 아니거나 형상 검사를 못 넘기면 null. */
export function itemSurfaceGeometry(
  item: Pick<LayoutObbItem, 'kind' | 'center' | 'size' | 'yaw_rad'>,
): SurfaceGeometry | null {
  if (!isWorkSurfaceKind(item.kind)) return null;
  const geometry: SurfaceGeometry = {
    centerXy: [item.center[0], item.center[1]],
    sizeXy: [item.size[0], item.size[1]],
    yawRad: wrapYaw(item.yaw_rad),
    topHeightM: r3(item.center[2] + item.size[2] / 2),
  };
  return geometryErrors(geometry) === null ? geometry : null;
}

/** 항목 하나가 만들 구역. surface 는 고소 작업면 항목이 함께 만들 작업면이다. */
export interface LayoutZonePlan {
  itemId: string;
  name: string;
  shape: ZoneShape;
  surface: SurfaceGeometry | null;
}

function shapeOfOpening(item: LayoutObbItem): ZoneShape | null {
  const [sx, sy, sz] = item.size;
  if (![sx, sy, sz].every((v) => Number.isFinite(v) && v > 0)) return null;
  if (!item.center.every(Number.isFinite)) return null;
  return openingZoneShape({
    centerXy: [item.center[0], item.center[1]],
    sizeXy: [sx, sy],
    yawRad: wrapYaw(item.yaw_rad),
    bottomZ: r3(item.center[2] - sz / 2),
    topZ: r3(item.center[2] + sz / 2),
  });
}

/**
 * 레이아웃 항목들이 만들 구역·작업면(항목 순서대로). 이름은 label 이고, 없으면 같은 종류의 레이아웃 안 순번으로 짓는다
 * (`개구부 N`·`고소 작업면 N`, 구역을 만들지 않는 항목도 순번에 센다). 형상이 틀린 항목은 뺀다(서버는 저장 때 막는다).
 */
export function layoutZonePlans(items: readonly LayoutObbItem[]): LayoutZonePlan[] {
  const counts = new Map<ZoneItemKind, number>();
  return items.flatMap((item): LayoutZonePlan[] => {
    const kind = zoneKindOf(item.kind);
    if (kind === null) return [];
    const ordinal = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, ordinal);
    if (!itemMakesZone(item)) return [];
    const name = item.label?.trim() || `${ITEM_LABEL[kind]} ${ordinal}`;
    if (kind === 'WORK_SURFACE') {
      const surface = itemSurfaceGeometry(item);
      return surface
        ? [{ itemId: item.item_id, name, shape: surfaceZoneShape(surface), surface }]
        : [];
    }
    const shape = shapeOfOpening(item);
    return shape ? [{ itemId: item.item_id, name, shape, surface: null }] : [];
  });
}

/** 구역 모양을 감싸는 축 정렬 상자. 회전한 구역이면 윤곽으로 보일 상자가 없어 null 이다(3D 윤곽은 상자만 받는다). */
export function zoneOutlineBox(shape: ZoneShape): ViewerEditBox | null {
  if (shape.z_min_m === null || shape.z_max_m === null || !isAxisRect(shape.polygon_xy)) {
    return null;
  }
  const xs = shape.polygon_xy.map(([x]) => x);
  const ys = shape.polygon_xy.map(([, y]) => y);
  return {
    min: [Math.min(...xs), Math.min(...ys), shape.z_min_m],
    max: [Math.max(...xs), Math.max(...ys), shape.z_max_m],
  };
}

/** 관제 작업면 → 고소 작업면 항목(바닥 0 ~ 상판). */
export function itemOfSurface(
  itemId: string,
  name: string | null,
  geometry: SurfaceGeometry,
): LayoutObbItem {
  const top = r3(geometry.topHeightM);
  return {
    item_id: itemId,
    kind: 'WORK_SURFACE',
    center: [geometry.centerXy[0], geometry.centerXy[1], r3(top / 2)],
    size: [geometry.sizeXy[0], geometry.sizeXy[1], top],
    yaw_rad: normalizeYawRad(geometry.yawRad),
    label: name?.trim() || null,
  };
}

/**
 * 관제 구역 모양 → 개구부 항목. 구역 다각형의 외접 직사각형을 사방 0.3 m 줄인 것이 항목이고(그 항목이 다시 구역이 되면 같은
 * 구역이다), 높이는 구역 높이 그대로다. 높이를 모르거나 줄인 가로·세로가 MIN_OPENING_SIZE_M 보다 작으면 null.
 */
export function itemOfZoneShape(
  itemId: string,
  name: string | null,
  shape: ZoneShape,
): LayoutObbItem | null {
  const { z_min_m: bottom, z_max_m: top } = shape;
  if (bottom === null || top === null || !(top > bottom)) return null;
  const obb = polygonToObb2D(shape.polygon_xy);
  const size: [number, number] = [
    r3(obb.sizeXy[0] - 2 * SURFACE_ZONE_MARGIN_M),
    r3(obb.sizeXy[1] - 2 * SURFACE_ZONE_MARGIN_M),
  ];
  if (size.some((v) => v < MIN_OPENING_SIZE_M)) return null;
  const height = r3(top - bottom);
  return {
    item_id: itemId,
    kind: 'OPENING',
    center: [obb.centerXy[0], obb.centerXy[1], r3(bottom + height / 2)],
    size: [size[0], size[1], height],
    yaw_rad: obb.yaw_rad,
    label: name?.trim() || null,
  };
}

/** 쓰지 않은 새 항목 ID(`open-01`, `surf-01`…). */
export const newLayoutItemId = (
  kind: ZoneItemKind,
  items: readonly Pick<LayoutObbItem, 'item_id'>[],
) =>
  nextItemId(
    ITEM_PREFIX[kind],
    items.map((i) => i.item_id),
  );

/** 관제에서 레이아웃을 고치는 일: 항목을 더하거나 바꾸고(item_id 로 찾는다), 지운다. */
export type LayoutEdit = { op: 'UPSERT'; item: LayoutObbItem } | { op: 'REMOVE'; itemId: string };

/** 항목 목록에 편집을 적용한 새 목록. 바꿀 항목이 없으면 맨 뒤에 더한다. 항목 순서는 유지한다. */
export function applyLayoutEdit(
  items: readonly LayoutObbItem[],
  edit: LayoutEdit,
): LayoutObbItem[] {
  if (edit.op === 'REMOVE') return items.filter((item) => item.item_id !== edit.itemId);
  const exists = items.some((item) => item.item_id === edit.item.item_id);
  return exists
    ? items.map((item) => (item.item_id === edit.item.item_id ? edit.item : item))
    : [...items, edit.item];
}
