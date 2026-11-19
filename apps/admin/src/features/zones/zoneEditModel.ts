import { sameGeometry, sameName } from '@/features/surfaces/surfaces';
import type { SurfaceGeometry, WorkSurface } from '@/features/surfaces/types';
import type { ViewerBoxEdit, ViewerBoxGhost, ViewerEditBox } from '@/features/viewer3d';
import type { JudgeType, Severity, Zone, ZoneBox } from '@/features/zones/types';
import type { ZoneForm, ZoneShape } from '@/features/zones/zoneForm';
import { r3, surfaceZoneHalf, surfaceZoneTop } from '@/features/zones/zoneShape';
import type { RoomLimit } from '@/lib/roomLimit';

// 구역 편집 화면의 초안 모델(순수 계산). 이름·심각도 고침, 구역 상자, 작업면 하나를 구역(또는 새 구역) 하나의 초안으로 묶는다.

/** 새 구역 양식의 초안 키. */
export const NEW_KEY = '__new__';
/** 화면에서 고르지 않는 칸의 기본값. 새 구역은 이 값으로 만들고, 기존 구역은 받은 값을 그대로 둔다. */
export const NEW_ZONE_KIND = 'OPENING';
export const NEW_EVAL_TYPE = 'VOLUME_3D';
export const NEW_ZONE_SEVERITY: Severity = 'HIGH';
/** 작업면이 붙은 구역의 판정 유형(높이가 있는 입체). 저장할 때 이 값으로 맞춘다. */
export const SURFACE_ZONE_JUDGE_TYPE: JudgeType = NEW_EVAL_TYPE;
/**
 * 자동 이름의 종류(S15P31A101-651). 이름은 `종류 + 구분자`이고, 고소작업면(작업면이 붙은 구역)은 A·B…, 그 밖은 1·2…를 붙인다.
 * AI 구역 초안(ai zone_draft.py DEFAULT_NAME_BY_KIND)도 같은 말을 쓴다.
 */
export type AutoNameKind = 'surface' | 'opening' | 'edge' | 'zone';
export const AUTO_ZONE_NAME: Record<AutoNameKind, string> = {
  surface: '고소작업면',
  opening: '개구부',
  edge: '바닥 단부',
  zone: '위험구역',
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 이름 끝의 구분자(` A`, ` 12`). 겹친 이름을 다시 매길 때 떼어 낸다. */
const SEPARATOR_SUFFIX = /^(.*\S)\s+([A-Z]|\d+)$/;

export { SEVERITY_LABEL } from '@/lib/ruleNames';

const NEW_ZONE_SIZE_M = 2;
const NEW_ZONE_HEIGHT_M = 2;
/** 새 작업면의 크기·상판 높이(m, 관제 데모와 같다). 작업 레이아웃 편집기도 같은 값으로 새 고소 작업면을 놓는다. */
export const NEW_SURFACE_SIZE_M = 1;
export const NEW_SURFACE_TOP_M = 0.4;
/** 좌표(m)·각도(rad)가 이 값보다 덜 다르면 같다고 본다. */
const SAME_EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type LinkedSurface = Pick<WorkSurface, 'objectId' | 'name' | 'geometry'>;

/** 작업면 초안. id 가 null 이면 아직 등록하지 않은 새 작업면이다. */
export interface SurfaceDraft {
  id: string | null;
  name: string | null;
  geometry: SurfaceGeometry;
}

/** 고친 칸. 구역 종류·판정 유형은 화면에서 고르지 않으므로 이름과 심각도만 둔다. */
export interface ZonePatch {
  name?: string;
  severity?: Severity;
}

/**
 * 구역(또는 새 구역) 하나의 저장 전 초안. box 는 고친 구역 상자(안 고쳤으면 null), surface 는 undefined 가 건드리지 않음,
 * 객체가 고친 작업면이다. 새 구역은 고소 작업면을 체크하면 이 칸에 작업면이 들어가고(체크를 끄면 withoutSurface 로 뺀다),
 * 기존 구역의 작업면은 지우지 않는다.
 */
export interface TargetDraft {
  patch: ZonePatch;
  box: ViewerEditBox | null;
  surface?: SurfaceDraft;
}

export function boxOfZone(zone: ZoneBox): ViewerEditBox {
  return {
    min: [zone.min[0], zone.min[1], zone.min[2]],
    max: [zone.max[0], zone.max[1], zone.max[2]],
  };
}

/** 두 상자의 좌표가 모두 같은지(오차 SAME_EPS 안). */
function sameEditBox(a: ViewerEditBox, b: ViewerEditBox): boolean {
  return (
    a.min.every((v, i) => Math.abs(v - b.min[i]!) <= SAME_EPS) &&
    a.max.every((v, i) => Math.abs(v - b.max[i]!) <= SAME_EPS)
  );
}

/**
 * 새 구역의 처음 상자: 기존 구역들을 감싼 상자의 가운데 바닥에 2×2×2 m, 구역이 없으면 방 가운데. 교실 안에 둔다.
 * 교실 범위(limit)는 3D 손잡이의 범위와 같다: 스캔이 보이면 스캔 범위, 아니면 목업 교실(10×10 m).
 */
export function defaultNewBox(zones: readonly ZoneBox[], limit: RoomLimit): ViewerEditBox {
  const mid = (axis: 0 | 1) =>
    zones.length === 0
      ? (limit.min[axis] + limit.max[axis]) / 2
      : (Math.min(...zones.map((z) => z.min[axis])) + Math.max(...zones.map((z) => z.max[axis]))) /
        2;
  const half = NEW_ZONE_SIZE_M / 2;
  const cx = clamp(r3(mid(0)), limit.min[0] + half, limit.max[0] - half);
  const cy = clamp(r3(mid(1)), limit.min[1] + half, limit.max[1] - half);
  return { min: [cx - half, cy - half, 0], max: [cx + half, cy + half, NEW_ZONE_HEIGHT_M] };
}

/** 받은 구역이 이미 작업면 구역의 모양·높이·판정 유형 그대로인지(그러면 작업면만 고쳐도 새 구역 버전이 필요 없다). */
export function zoneFollowsSurface(zone: Zone, shape: ZoneShape): boolean {
  const samePoints =
    zone.polygon.length === shape.polygon_xy.length &&
    zone.polygon.every(
      ([x, y], i) =>
        Math.abs(x - shape.polygon_xy[i]![0]) <= SAME_EPS &&
        Math.abs(y - shape.polygon_xy[i]![1]) <= SAME_EPS,
    );
  return (
    samePoints &&
    zone.zBounds[0] === shape.z_min_m &&
    zone.zBounds[1] === shape.z_max_m &&
    zone.judgeType === SURFACE_ZONE_JUDGE_TYPE
  );
}

/**
 * 작업면이 붙은 구역을 3D 에 윤곽으로 보일 상자. 회전한 작업면은 구역이 직사각형이 아니라 윤곽을 두지 않는다(null).
 */
function surfaceZoneOutline(g: SurfaceGeometry): ViewerEditBox | null {
  if (!surfaceBoxEditable(g)) return null;
  const [cx, cy] = g.centerXy;
  const [halfX, halfY] = surfaceZoneHalf(g);
  return {
    min: [r3(cx - halfX), r3(cy - halfY), 0],
    max: [r3(cx + halfX), r3(cy + halfY), surfaceZoneTop(g)],
  };
}

/** 숫자로 고칠 때의 최소 크기(m): 가로·세로, 높이. 3D 손잡이(viewer3d boxEdit.ts)와 같은 값이다. */
const MIN_SIZE_HORIZONTAL_M = 0.2;
const MIN_SIZE_VERTICAL_M = 0.05;

/**
 * 상자 한 축의 크기를 size(m)로 바꾼 새 상자. 가로(x)·세로(y)는 가운데를 두고 양쪽으로 늘이고 줄이며 교실 범위(limit)를
 * 넘는 쪽은 경계에서 자른다. 높이(z)는 바닥(min)을 두고 위(max)를 옮긴다. 숫자가 아니거나 최소 크기보다 작으면 null 이다.
 * 좌표는 0.001 m 로 맞춘다.
 */
export function resizeBox(
  box: ViewerEditBox,
  axis: 0 | 1 | 2,
  size: number,
  limit: RoomLimit,
): ViewerEditBox | null {
  const minSize = axis === 2 ? MIN_SIZE_VERTICAL_M : MIN_SIZE_HORIZONTAL_M;
  if (!Number.isFinite(size) || size < minSize) return null;
  const min: [number, number, number] = [box.min[0], box.min[1], box.min[2]];
  const max: [number, number, number] = [box.max[0], box.max[1], box.max[2]];
  if (axis === 2) {
    max[2] = r3(Math.min(limit.max[2], min[2] + size));
  } else {
    const center = (box.min[axis] + box.max[axis]) / 2;
    min[axis] = r3(Math.max(limit.min[axis], center - size / 2));
    max[axis] = r3(Math.min(limit.max[axis], center + size / 2));
  }
  return max[axis] - min[axis] >= minSize ? { min, max } : null;
}

/** 작업면 형상 → 3D 편집 상자(바닥 0 ~ 상판). 회전은 상자에 나타나지 않는다. */
export function surfaceBox(g: SurfaceGeometry): ViewerEditBox {
  const [cx, cy] = g.centerXy;
  const [w, d] = g.sizeXy;
  return {
    min: [r3(cx - w / 2), r3(cy - d / 2), 0],
    max: [r3(cx + w / 2), r3(cy + d / 2), r3(g.topHeightM)],
  };
}

/** 편집 상자 → 작업면 형상. 회전은 base 의 값을 그대로 둔다. */
export function surfaceOfBox(box: ViewerEditBox, base: SurfaceGeometry): SurfaceGeometry {
  return {
    centerXy: [r3((box.min[0] + box.max[0]) / 2), r3((box.min[1] + box.max[1]) / 2)],
    sizeXy: [r3(box.max[0] - box.min[0]), r3(box.max[1] - box.min[1])],
    yawRad: base.yawRad,
    topHeightM: r3(box.max[2]),
  };
}

/** 구역 상자 가운데에 1×1 m, 상판 0.4 m 로 놓는 새 작업면 초안. */
export function newSurfaceDraft(zoneBox: ViewerEditBox): SurfaceDraft {
  return {
    id: null,
    name: null,
    geometry: {
      centerXy: [
        r3((zoneBox.min[0] + zoneBox.max[0]) / 2),
        r3((zoneBox.min[1] + zoneBox.max[1]) / 2),
      ],
      sizeXy: [NEW_SURFACE_SIZE_M, NEW_SURFACE_SIZE_M],
      yawRad: 0,
      topHeightM: NEW_SURFACE_TOP_M,
    },
  };
}

export const surfaceDraftOf = (surface: LinkedSurface): SurfaceDraft => ({
  id: surface.objectId,
  name: surface.name,
  geometry: {
    ...surface.geometry,
    centerXy: [...surface.geometry.centerXy],
    sizeXy: [...surface.geometry.sizeXy],
  },
});

/** 회전이 없는 작업면만 상자 손잡이로 고친다(회전한 작업면은 높이 칸만 고친다). */
export const surfaceBoxEditable = (g: SurfaceGeometry) => Math.abs(g.yawRad) < SAME_EPS;

/** 이은 저장 작업면과 다른지. 같은 작업면이면 값이 같을 때 바뀐 것이 아니다. */
export function surfaceChanged(
  draft: SurfaceDraft | undefined,
  linked: LinkedSurface | null,
): boolean {
  if (draft === undefined) return false;
  if (linked === null || linked.objectId !== draft.id) return true;
  return !sameName(draft.name ?? '', linked.name) || !sameGeometry(draft.geometry, linked.geometry);
}

/** 이 구역의 지금 보이는 작업면 초안: 건드렸으면 그 값, 아니면 이은 작업면 그대로(없으면 null). */
export function currentSurface(
  draft: TargetDraft | undefined,
  linked: LinkedSurface | null,
): SurfaceDraft | null {
  if (draft?.surface !== undefined) return draft.surface;
  return linked ? surfaceDraftOf(linked) : null;
}

/** 구역의 저장된 값에 고친 칸을 덮은 양식. */
export function formWithPatch(zone: Zone, patch: ZonePatch): ZoneForm {
  return {
    name: patch.name ?? zone.name,
    judgeType: zone.judgeType,
    zoneType: zone.zoneType,
    severity: patch.severity ?? zone.severity,
  };
}

/** n(1부터)번째 구분자. 고소작업면은 A~Z(넘으면 27·28…), 그 밖은 숫자다. */
const separatorOf = (kind: AutoNameKind, n: number) =>
  kind === 'surface' && n <= LETTERS.length ? LETTERS[n - 1]! : String(n);

/** 구역들이 쓰는 이름(앞뒤 공백을 뗀 것). exceptId 의 구역(지금 고치는 구역)은 뺀다. */
export function takenZoneNames(
  zones: readonly Pick<ZoneBox, 'zoneId' | 'name'>[],
  exceptId?: string,
): Set<string> {
  return new Set(zones.filter((zone) => zone.zoneId !== exceptId).map((zone) => zone.name.trim()));
}

/** base 뒤에 구분자를 붙인 이름 중 taken 에 없는 가장 작은 것. */
function withSeparator(base: string, kind: AutoNameKind, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${base} ${separatorOf(kind, n)}`)) n += 1;
  return `${base} ${separatorOf(kind, n)}`;
}

/**
 * 이름을 정하지 않은 새 구역의 기본 이름: `종류 + 구분자` 중 활성 구역과 겹치지 않는 가장 작은 것(고소작업면 A, 위험구역 1).
 * 빈 구분자도 채운다. 드롭다운·경보에서 구역을 이름만으로 가릴 수 있게 한다.
 */
export function nextZoneName(
  zones: readonly Pick<ZoneBox, 'name'>[],
  kind: AutoNameKind = 'zone',
): string {
  return withSeparator(AUTO_ZONE_NAME[kind], kind, new Set(zones.map((zone) => zone.name.trim())));
}

/**
 * 자동으로 정한 이름(AI 초안 추천 이름)을 활성 구역과 겹치지 않게 한다. 겹치지 않으면 그대로, 겹치면 끝의 구분자를 떼고
 * 비어 있는 가장 작은 구분자를 붙인다(`작업대 상판` → `작업대 상판 1`, `고소작업면 A` → `고소작업면 B`). 사람이 고친 이름에는
 * 쓰지 않는다(그런 이름은 양식 검사가 겹침을 알린다).
 */
export function uniqueZoneName(
  name: string,
  zones: readonly Pick<ZoneBox, 'name'>[],
  kind: AutoNameKind,
): string {
  const trimmed = name.trim();
  const taken = new Set(zones.map((zone) => zone.name.trim()));
  if (!taken.has(trimmed)) return trimmed;
  const base = SEPARATOR_SUFFIX.exec(trimmed)?.[1] ?? trimmed;
  return withSeparator(base, kind, taken);
}

/** 새 구역의 양식. 이름을 고치지 않았으면 defaultName 이고, 화면에서 고르지 않는 칸은 기본값이다. */
export function newZoneForm(patch: ZonePatch, defaultName: string): ZoneForm {
  return {
    name: patch.name ?? defaultName,
    judgeType: NEW_EVAL_TYPE,
    zoneType: NEW_ZONE_KIND,
    severity: patch.severity ?? NEW_ZONE_SEVERITY,
  };
}

/** 작업면이 붙은 구역의 양식: 판정 유형은 고르지 못하고 작업면 구역 값으로 맞춘다(심각도는 고른 값 그대로). */
export const surfaceZoneForm = (form: ZoneForm): ZoneForm => ({
  ...form,
  judgeType: SURFACE_ZONE_JUDGE_TYPE,
});

/** 저장된 값과 같은 칸은 고친 것이 아니다. */
export function changedPatch(zone: Zone, next: ZonePatch): ZonePatch {
  const patch: ZonePatch = {};
  if (next.name !== undefined && next.name !== zone.name) patch.name = next.name;
  if (next.severity !== undefined && next.severity !== zone.severity)
    patch.severity = next.severity;
  return patch;
}

/** 원본과 다르게 고친 구역 상자. 안 고쳤으면 null. */
export function editedBox(zone: Zone, draft: TargetDraft | undefined): ViewerEditBox | null {
  return draft?.box && !sameEditBox(draft.box, boxOfZone(zone)) ? draft.box : null;
}

/** 구역(속성·상자)에서 저장 전에 고친 것이 있는지(작업면은 따로 본다). */
export function zoneChanged(zone: Zone, draft: TargetDraft | undefined): boolean {
  if (!draft) return false;
  return Object.keys(changedPatch(zone, draft.patch)).length > 0 || editedBox(zone, draft) !== null;
}

/** 구역이나 작업면에서 저장 전에 고친 것이 있는지. */
export function targetChanged(
  zone: Zone,
  draft: TargetDraft | undefined,
  linked: LinkedSurface | null,
): boolean {
  return zoneChanged(zone, draft) || surfaceChanged(draft?.surface, linked);
}

// ---- 초안 갱신: 지금 초안(prev)에서 한 곳만 바꾼 새 초안 ------------------------------------------

/** 초안이 비었는지(고친 칸·상자·작업면이 없다). 빈 초안은 저장소에서 지운다. */
export const isEmptyDraft = (draft: TargetDraft): boolean =>
  Object.keys(draft.patch).length === 0 && draft.box === null && draft.surface === undefined;

/** 이름 고침만 뺀 초안(목록에서 이름을 저장해 그 이름이 새 기준이 된 때). */
export function withoutName(draft: TargetDraft): TargetDraft {
  const patch = { ...draft.patch };
  delete patch.name;
  return { ...draft, patch };
}

/** 작업면 칸을 뺀 초안(새 구역이 고소 작업면 체크를 끈 때). 초안이 없던 구역이면 빈 초안이다. */
export const withoutSurface = (prev: TargetDraft | undefined): TargetDraft => ({
  patch: prev?.patch ?? {},
  box: prev?.box ?? null,
});

/** 작업면 칸을 그대로 이어받는 값(건드리지 않았으면 칸을 두지 않는다). */
const keepSurface = (prev: TargetDraft | undefined) =>
  prev?.surface === undefined ? {} : { surface: prev.surface };

/** 이름·심각도를 고친 초안. 기존 구역이면 저장된 값과 같은 칸은 뺀다. */
export function withPatch(
  prev: TargetDraft | undefined,
  zone: Zone | null,
  next: ZonePatch,
): TargetDraft {
  const merged = { ...prev?.patch, ...next };
  return {
    patch: zone ? changedPatch(zone, merged) : merged,
    box: prev?.box ?? null,
    ...keepSurface(prev),
  };
}

/** 작업면을 고친 초안. */
export function withSurface(prev: TargetDraft | undefined, next: SurfaceDraft): TargetDraft {
  return {
    patch: prev?.patch ?? {},
    box: prev?.box ?? null,
    surface: next,
  };
}

/** 3D 에서 작업면 상자를 끈 초안. */
export function withSurfaceBox(
  prev: TargetDraft | undefined,
  surface: SurfaceDraft,
  box: ViewerEditBox,
): TargetDraft {
  return withSurface(prev, { ...surface, geometry: surfaceOfBox(box, surface.geometry) });
}

/** 3D 에서 구역 상자를 끈 초안. 원본(zone)과 같아지면 고친 상자를 지운다. */
export function withZoneBox(
  prev: TargetDraft | undefined,
  zone: Zone | null,
  box: ViewerEditBox,
): TargetDraft {
  return {
    patch: prev?.patch ?? {},
    box: zone && sameEditBox(box, boxOfZone(zone)) ? null : box,
    ...keepSurface(prev),
  };
}

/**
 * 이은 작업면(linked)과 값이 같아진 작업면 초안을 뺀다. 높이를 바꿨다가 되돌린 것처럼 실제로 바뀐 것이 없는 초안이
 * 남으면, 초안이 있다는 이유로 편집을 끌 때 버릴 것이 있는지 묻게 된다(바뀐 것만 초안이다).
 */
export function withoutUnchangedSurface(
  draft: TargetDraft,
  linked: LinkedSurface | null,
): TargetDraft {
  if (draft.surface === undefined || surfaceChanged(draft.surface, linked)) return draft;
  return withoutSurface(draft);
}

// ---- 3D 로 내려 줄 값 ---------------------------------------------------------------------------

/**
 * 3D 손잡이가 고칠 상자. 작업면이 있으면 작업면 상자다(구역은 작업면에서 계산하므로 손잡이가 없다. 회전한 작업면·형상 오류가
 * 있으면 없음). 작업면이 없으면(고소 작업면을 체크하지 않은 새 구역, 작업면 없이 만든 기존 구역) 구역 상자이고, 형상을 못
 * 고치는 구역이면 null 이다.
 */
export function boxEditOf(input: {
  key: string;
  zone: Zone | null;
  zoneBox: ViewerEditBox;
  surface: SurfaceDraft | null;
  surfaceValid: boolean;
}): ViewerBoxEdit | null {
  const { key, zone, zoneBox, surface, surfaceValid } = input;
  if (surface) {
    return surfaceBoxEditable(surface.geometry) && surfaceValid
      ? { id: `surface:${key}`, kind: 'surface', box: surfaceBox(surface.geometry) }
      : null;
  }
  return !zone || zone.shapeEditable ? { id: key, kind: 'zone', box: zoneBox } : null;
}

/**
 * 윤곽만 보이는 보관 초안. 작업면이 붙은 구역은 작업면에서 계산한 구역 윤곽(지금 구역도 손잡이가 작업면이라 구역이 어떻게
 * 따라가는지 보인다), 작업면이 없는 다른 구역은 고친 상자다. 없어진 구역의 초안은 건너뛴다.
 */
export function ghostsOf(
  drafts: Readonly<Record<string, TargetDraft>>,
  key: string,
  zones: readonly ZoneBox[],
  links: ReadonlyMap<string, LinkedSurface>,
): ViewerBoxGhost[] {
  return Object.entries(drafts).flatMap(([id, draft]) => {
    if (id !== NEW_KEY && !zones.some((z) => z.zoneId === id)) return [];
    const surface = currentSurface(draft, links.get(id) ?? null);
    const box = surface ? surfaceZoneOutline(surface.geometry) : id === key ? null : draft.box;
    return box ? [{ id, box }] : [];
  });
}

// ---- 3D 로 내려 줄 값 비교 --------------------------------------------------------------------

/** 두 상자의 좌표가 정확히 같은지. */
export const sameBox = (a: ViewerEditBox, b: ViewerEditBox) =>
  [0, 1, 2].every((axis) => a.min[axis] === b.min[axis] && a.max[axis] === b.max[axis]);

/** 3D 에 내려 줄 편집 상자가 같은지(값 비교). 같으면 저장소를 다시 쓰지 않아 3D 를 다시 그리지 않는다. */
export function sameBoxEdit(a: ViewerBoxEdit | null, b: ViewerBoxEdit | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.kind === b.kind && sameBox(a.box, b.box);
}

/** 보관 초안 윤곽 목록이 같은지(값 비교). */
export function sameGhosts(a: readonly ViewerBoxGhost[], b: readonly ViewerBoxGhost[]): boolean {
  return a.length === b.length && a.every((g, i) => g.id === b[i]!.id && sameBox(g.box, b[i]!.box));
}
