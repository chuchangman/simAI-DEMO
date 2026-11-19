import type { WorkSurface } from '@/features/surfaces/types';
import type { LayoutWriteBody } from '@/features/tbm/api';
import { normalizeYawRad, polygonToObb2D } from '@/features/tbm/layoutGeometry';
import {
  layoutZonePlans,
  newLayoutItemId,
  zoneOutlineBox,
  type ZoneItemKind,
} from '@/features/tbm/layoutZones';
import type { LayoutDetail, LayoutObbItem } from '@/features/tbm/types';
import type {
  PlannedLayoutInput,
  ViewerBoxEdit,
  ViewerBoxGhost,
  ViewerEditBox,
} from '@/features/viewer3d';
import type { Zone } from '@/features/zones/types';
import { NEW_SURFACE_SIZE_M, NEW_SURFACE_TOP_M } from '@/features/zones/zoneEditModel';
import { r3 } from '@/features/zones/zoneShape';
import { DEFAULT_ROOM_LIMIT } from '@/lib/roomLimit';

export { normalizeYawRad, polygonToObb2D };

// 가상 레이아웃 3D 편집 모델(순수 계산).
// 좌표 규약(AGENTS.md 규칙 3): World 는 미터, 오른손, +Z 위, 바닥 Z = 0, 각도 라디안 [-π, π].
// 모르면 비운다(AGENTS.md 규칙 2): 구역에서 가져올 때 높이(z_min_m·z_max_m)가 없으면 기본값(0.1 m·바닥 0)으로 채우지 않고
// null 로 비워 두며, 저장 전에 검증으로 막는다.

export type LayoutItemKind = LayoutObbItem['kind'];

/** 편집기에서 새로 놓을 수 있는 종류. 옛 SCAFFOLD·EQUIPMENT 는 읽기만 한다. */
export type AddableLayoutKind = ZoneItemKind;
export const ADDABLE_LAYOUT_KINDS: readonly AddableLayoutKind[] = ['OPENING', 'WORK_SURFACE'];

export const isAddableLayoutKind = (kind: LayoutItemKind): kind is AddableLayoutKind =>
  kind === 'OPENING' || kind === 'WORK_SURFACE';

/** 옛 비계(SCAFFOLD)는 고소 작업면으로 읽는다. 장비는 데이터만 두고 구역을 만들지 않는다. */
export const LAYOUT_ITEM_KIND_LABELS: Record<LayoutItemKind, string> = {
  OPENING: '개구부',
  WORK_SURFACE: '고소 작업면',
  SCAFFOLD: '고소 작업면',
  EQUIPMENT: '장비',
};

/** 도(°) → 라디안(rad, [-π, π]). */
export function degToYawRad(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return normalizeYawRad((deg * Math.PI) / 180);
}

/** 라디안(rad) → 도(°, 소수 첫째 자리). */
export function yawRadToDeg(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  return Math.round(((rad * 180) / Math.PI) * 10) / 10;
}

/**
 * 레이아웃 편집 초안 항목 하나.
 * bottomZ 또는 height 가 null 이면(예: 높이 없는 바닥 구역에서 가져온 개구부) 사용자가 직접 입력하기 전까지 저장을 막는다.
 */
export interface LayoutDraftItem {
  item_id: string;
  kind: LayoutItemKind;
  label: string;
  centerXy: [number, number];
  sizeXy: [number, number];
  /** 바닥(하단) 높이 Z(m). 미입력 상태면 null. */
  bottomZ: number | null;
  /** 물체 높이 Z 크기(m, > 0). 미입력 상태면 null. */
  height: number | null;
  yaw_rad: number;
  /** 기존 구역에서 가져온 개구부의 구역 ID. 있으면 작업을 시작해도 새 구역을 만들지 않는다. */
  sourceZoneId?: string | null;
  sourceObjectId?: string | null;
}

/** 새 개구부의 가로·세로·높이(m). 새 고소 작업면은 관제 작업면 만들기와 같은 크기·상판 높이를 쓴다. */
const NEW_OPENING_SIZE_M = 1;
const NEW_OPENING_HEIGHT_M = 0.2;

const DEFAULT_SPEC: Record<AddableLayoutKind, { sizeXy: [number, number]; height: number }> = {
  OPENING: { sizeXy: [NEW_OPENING_SIZE_M, NEW_OPENING_SIZE_M], height: NEW_OPENING_HEIGHT_M },
  WORK_SURFACE: { sizeXy: [NEW_SURFACE_SIZE_M, NEW_SURFACE_SIZE_M], height: NEW_SURFACE_TOP_M },
};

/** 방 위에서 새 물체를 놓는 처음 자리(방 가운데). 스캔 범위를 모를 때 쓰는 목업 교실 가운데다. */
const DEFAULT_ROOM_CENTER_XY: readonly [number, number] = [
  (DEFAULT_ROOM_LIMIT.min[0] + DEFAULT_ROOM_LIMIT.max[0]) / 2,
  (DEFAULT_ROOM_LIMIT.min[1] + DEFAULT_ROOM_LIMIT.max[1]) / 2,
];

/** 3D 손잡이를 둘 수 있는 회전 오차(rad). 관제 작업면 손잡이(surfaceBoxEditable)와 같다. */
const HANDLE_YAW_EPS = 1e-6;

/** 서버 LayoutObbItem → 편집 초안 항목. 옛 비계(SCAFFOLD)는 고소 작업면으로 읽는다(저장하면 새 종류로 나간다). */
export function obbToDraftItem(item: LayoutObbItem): LayoutDraftItem {
  const [cx, cy, cz] = item.center;
  const [sx, sy, sz] = item.size;
  const bottomZ = r3(cz - sz / 2);
  return {
    item_id: item.item_id,
    kind: item.kind === 'SCAFFOLD' ? 'WORK_SURFACE' : item.kind,
    label: item.label ?? item.item_id,
    centerXy: [r3(cx), r3(cy)],
    sizeXy: [r3(sx), r3(sy)],
    bottomZ,
    height: r3(sz),
    yaw_rad: normalizeYawRad(item.yaw_rad ?? 0),
    ...(item.source_zone_id ? { sourceZoneId: item.source_zone_id } : {}),
    ...(item.source_object_id ? { sourceObjectId: item.source_object_id } : {}),
  };
}

/** 종류를 바꾼다. 가져온 구역 표시(sourceZoneId)는 개구부에만 뜻이 있어 다른 종류가 되면 뗀다. */
export function changeDraftItemKind(item: LayoutDraftItem, kind: LayoutItemKind): LayoutDraftItem {
  const { sourceZoneId, ...rest } = item;
  delete rest.sourceObjectId;
  return { ...rest, kind, ...(kind === 'OPENING' && sourceZoneId ? { sourceZoneId } : {}) };
}

/** 서버 LayoutDetail → 편집 초안 항목 배열. */
export function layoutDetailToDraftItems(
  layout: LayoutDetail | null | undefined,
): LayoutDraftItem[] {
  if (!layout) return [];
  return layout.items.map(obbToDraftItem);
}

/** 초안 항목의 Z 값(바닥 높이·높이)이 유효하게 채워져 있는지 검사한다. */
export function isDraftItemZComplete(
  item: LayoutDraftItem,
): item is LayoutDraftItem & { bottomZ: number; height: number } {
  return (
    item.bottomZ !== null &&
    Number.isFinite(item.bottomZ) &&
    item.height !== null &&
    Number.isFinite(item.height) &&
    item.height > 0
  );
}

/** 편집 초안 항목 → 서버 LayoutObbItem (Z가 미입력이면 null 반환). */
export function draftItemToObb(item: LayoutDraftItem): LayoutObbItem | null {
  if (!isDraftItemZComplete(item)) return null;
  const [cx, cy] = item.centerXy;
  const [sx, sy] = item.sizeXy;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return null;
  const sz = r3(item.height);
  const cz = r3(item.bottomZ + sz / 2);
  const trimmedLabel = item.label.trim();
  return {
    item_id: item.item_id.trim(),
    kind: item.kind,
    center: [r3(cx), r3(cy), cz],
    size: [r3(sx), r3(sy), sz],
    yaw_rad: normalizeYawRad(item.yaw_rad),
    label: trimmedLabel.length > 0 ? trimmedLabel : null,
    ...(item.sourceZoneId ? { source_zone_id: item.sourceZoneId } : {}),
    ...(item.sourceObjectId ? { source_object_id: item.sourceObjectId } : {}),
  };
}

/** 중복되지 않는 새 item_id 를 만든다. */
export function nextLayoutItemId(
  kind: AddableLayoutKind,
  existingItems: readonly Pick<LayoutDraftItem, 'item_id'>[],
): string {
  return newLayoutItemId(kind, existingItems);
}

/**
 * 새 가상 물체를 만든다. 늘 회전 0 이다(3D 손잡이가 축 정렬 상자라 회전한 물체는 손잡이를 둘 수 없다).
 * surface 를 넘기면 그 등록 작업면의 윗면(topHeightM)과 중심(centerXy) 위에 놓는다(기준면의 회전은 따르지 않는다).
 * 없으면 바닥(Z=0)과 방 가운데(roomCenterXy, 모르면 목업 교실 가운데)에 놓는다.
 */
export function createDraftItem(
  kind: AddableLayoutKind,
  existingItems: readonly LayoutDraftItem[],
  options?: {
    surface?: Pick<WorkSurface, 'name' | 'objectId' | 'geometry'> | null;
    roomCenterXy?: readonly [number, number];
  },
): LayoutDraftItem {
  const spec = DEFAULT_SPEC[kind];
  const countOfKind = existingItems.filter((i) => i.kind === kind).length + 1;
  const surface = options?.surface ?? null;
  const [cx, cy] = surface
    ? surface.geometry.centerXy
    : (options?.roomCenterXy ?? DEFAULT_ROOM_CENTER_XY);

  return {
    item_id: nextLayoutItemId(kind, existingItems),
    kind,
    label: `${LAYOUT_ITEM_KIND_LABELS[kind]} ${countOfKind}`,
    centerXy: [r3(cx), r3(cy)],
    sizeXy: [...spec.sizeXy],
    bottomZ: surface ? r3(surface.geometry.topHeightM) : 0,
    height: spec.height,
    yaw_rad: 0,
  };
}

/**
 * 등록된 위험 구역(/api/zones) 하나를 골라 그 다각형의 외접 방향 상자로 OPENING 하나를 만든다.
 * 높이·바닥 높이는 구역 값(zBounds / zRange)이 있으면 그것을 쓰고,
 * 없으면 기본 0.1 m·바닥 0 대신 비워 두고(null) 사용자에게 입력을 요구한다(규칙 2 모르면 비운다).
 */
export function importOpeningFromZone(
  zone: Pick<Zone, 'zoneId' | 'name' | 'polygon' | 'zBounds' | 'zRange'>,
  existingItems: readonly LayoutDraftItem[],
): LayoutDraftItem {
  const obb2d = polygonToObb2D(zone.polygon);
  const used = new Set(existingItems.map((i) => i.item_id));
  const baseId = `open-${zone.zoneId}`;
  let item_id = baseId;
  let seq = 2;
  while (used.has(item_id)) {
    item_id = `${baseId}-${seq}`;
    seq += 1;
  }

  const [zMin, zMax] = zone.zBounds;
  const hasBottom = zMin !== null && Number.isFinite(zMin);
  const hasHeight =
    zMin !== null && zMax !== null && Number.isFinite(zMin) && Number.isFinite(zMax) && zMax > zMin;

  return {
    item_id,
    kind: 'OPENING',
    label: zone.name ? `${zone.name} (${zone.zoneId})` : zone.zoneId,
    centerXy: obb2d.centerXy,
    sizeXy: obb2d.sizeXy,
    bottomZ: hasBottom ? r3(zMin) : null,
    height: hasHeight ? r3(zMax - zMin) : null,
    yaw_rad: obb2d.yaw_rad,
    sourceZoneId: zone.zoneId,
  };
}

/**
 * 초안 항목을 3D 상자 손잡이(ViewerEditBox)로 바꾼다.
 * 바닥 높이·높이가 아직 비어 있는 항목은 3D 상자 손잡이를 띄울 수 없으므로 null 을 돌려준다.
 */
export function draftItemToEditBox(item: LayoutDraftItem): ViewerEditBox | null {
  if (!isDraftItemZComplete(item)) return null;
  const [cx, cy] = item.centerXy;
  const [sx, sy] = item.sizeXy;
  return {
    min: [r3(cx - sx / 2), r3(cy - sy / 2), r3(item.bottomZ)],
    max: [r3(cx + sx / 2), r3(cy + sy / 2), r3(item.bottomZ + item.height)],
  };
}

/**
 * 3D 상자 손잡이(onBoxEditChange)가 올린 새 상자를 초안 항목에 반영한다.
 * 회전(yaw_rad)·종류·이름은 유지하고 중심·크기·바닥 높이·높이를 갱신한다.
 */
export function applyEditBoxToDraftItem(
  item: LayoutDraftItem,
  box: ViewerEditBox,
): LayoutDraftItem {
  const cx = r3((box.min[0] + box.max[0]) / 2);
  const cy = r3((box.min[1] + box.max[1]) / 2);
  const sx = Math.max(r3(box.max[0] - box.min[0]), 0.1);
  const sy = Math.max(r3(box.max[1] - box.min[1]), 0.1);
  const bottomZ = r3(box.min[2]);
  const height = Math.max(r3(box.max[2] - box.min[2]), 0.1);
  return {
    ...item,
    centerXy: [cx, cy],
    sizeXy: [sx, sy],
    bottomZ,
    height,
  };
}

/**
 * 선택된 초안 항목에 대한 ViewerBoxEdit props 생성.
 * 모든 항목에 `surface` 손잡이를 써서 바닥 화살표를 숨긴다.
 * 회전한 물체는 손잡이를 두지 않는다(null, 관제 작업면과 같다).
 */
export function buildLayoutBoxEdit(selectedItem: LayoutDraftItem | null): ViewerBoxEdit | null {
  if (!selectedItem || Math.abs(selectedItem.yaw_rad) >= HANDLE_YAW_EPS) return null;
  const box = draftItemToEditBox(selectedItem);
  if (!box) return null;
  return {
    id: selectedItem.item_id,
    kind: 'surface',
    box,
  };
}

/** 구역을 만드는 항목마다 그 구역(둘레 0.3 m 포함)의 윤곽 상자. 회전한 항목은 상자가 없어 뺀다. */
function zonePreviewGhosts(items: readonly LayoutDraftItem[]): ViewerBoxGhost[] {
  const obbs = items.flatMap((item) => {
    const obb = draftItemToObb(item);
    return obb ? [obb] : [];
  });
  return layoutZonePlans(obbs).flatMap((plan) => {
    const box = zoneOutlineBox(plan.shape);
    return box ? [{ id: `zone:${plan.itemId}`, box }] : [];
  });
}

/**
 * 3D 에 점선으로 보일 윤곽(ViewerBoxGhost) 목록: 선택되지 않은 나머지 항목의 상자와, 구역을 만드는 모든 항목의 구역 윤곽
 * (`zone:<item_id>`, 선택한 항목 것도 보인다).
 */
export function buildLayoutBoxGhosts(
  items: readonly LayoutDraftItem[],
  selectedItemId: string | null,
): ViewerBoxGhost[] {
  const itemGhosts = items.flatMap((item) => {
    if (item.item_id === selectedItemId) return [];
    const box = draftItemToEditBox(item);
    return box ? [{ id: item.item_id, box }] : [];
  });
  return [...itemGhosts, ...zonePreviewGhosts(items)];
}

/** Viewer3D 의 PLANNED 레이어에 넘길 PlannedLayoutInput 생성(Z가 채워진 항목만 3D 에 그린다). */
export function buildPlannedLayoutInput(
  layoutId: number | null,
  items: readonly LayoutDraftItem[],
): PlannedLayoutInput {
  return {
    layoutId: layoutId !== null ? `layout-${layoutId}` : 'layout-draft',
    objects: items.flatMap((item) => {
      const obb = draftItemToObb(item);
      if (!obb) return [];
      return [
        {
          id: obb.item_id,
          kind: obb.kind,
          label: obb.label,
          geometry: {
            center: obb.center,
            size: obb.size,
            yawRad: obb.yaw_rad,
          },
        },
      ];
    }),
  };
}

/**
 * 저장 전 레이아웃 초안 전체 검증.
 * 문제가 있으면 사용자에게 보여줄 한국어 안내 문구를 돌려주고, 유효하면 null 을 돌려준다.
 */
export function validateLayoutDraft(
  name: string,
  items: readonly LayoutDraftItem[],
): string | null {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return '레이아웃 이름을 입력해 주세요.';
  }
  if (trimmedName.length > 100) {
    return '레이아웃 이름은 100자 이하로 입력해 주세요.';
  }
  if (items.length === 0) {
    return '최소 1개 이상의 가상 물체(개구부·고소 작업면)를 추가해 주세요.';
  }
  if (items.length > 200) {
    return '가상 물체는 최대 200개까지 배치할 수 있습니다.';
  }

  const seenIds = new Set<string>();
  for (const item of items) {
    const id = item.item_id.trim();
    if (!id) {
      return '모든 물체에 ID가 필요합니다.';
    }
    if (seenIds.has(id)) {
      return `중복된 물체 ID가 있습니다: ${id}`;
    }
    seenIds.add(id);

    if (item.bottomZ === null || !Number.isFinite(item.bottomZ)) {
      return `${item.label || id}: 바닥 높이(Z)가 비어 있습니다. 바닥 높이를 입력해 주세요.`;
    }
    if (item.height === null || !Number.isFinite(item.height) || item.height <= 0) {
      return `${item.label || id}: 높이(Z 크기)가 비어 있거나 0 이하입니다. 0보다 큰 높이를 입력해 주세요.`;
    }
    const [sx, sy] = item.sizeXy;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
      return `${item.label || id}: 폭과 깊이는 0보다 커야 합니다.`;
    }
    const [cx, cy] = item.centerXy;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      return `${item.label || id}: 중심 좌표가 올바르지 않습니다.`;
    }
    if (!Number.isFinite(item.yaw_rad) || Math.abs(item.yaw_rad) > 3.1415927) {
      return `${item.label || id}: 회전 각도는 -180°~180° 범위여야 합니다.`;
    }
  }

  return null;
}

/** 검증을 통과한 레이아웃 초안을 서버 요청 본문(LayoutWriteBody)으로 변환한다. */
export function buildLayoutWriteBody(
  name: string,
  items: readonly LayoutDraftItem[],
  revision?: number | null,
): LayoutWriteBody | null {
  if (validateLayoutDraft(name, items) !== null) return null;
  const obbItems: LayoutObbItem[] = [];
  for (const item of items) {
    const obb = draftItemToObb(item);
    if (!obb) return null;
    obbItems.push(obb);
  }
  return {
    name: name.trim(),
    items: obbItems,
    ...(typeof revision === 'number' ? { revision } : {}),
  };
}
