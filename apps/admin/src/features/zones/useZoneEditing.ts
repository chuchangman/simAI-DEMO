import { targetOfKey } from '@/features/layout/spatialHost/selectionKey';
import { useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import { geometryErrors, sameGeometry } from '@/features/surfaces/surfaces';
import { useWorkSurfaces } from '@/features/surfaces/useWorkSurfaces';
import { itemOfZoneShape } from '@/features/tbm/layoutZones';
import type { Severity } from '@/features/zones/types';
import { useConfigApply } from '@/features/zones/useConfigApply';
import { useRefreshSurfacesOnOpen } from '@/features/zones/useRefreshSurfacesOnOpen';
import { useZoneCommit } from '@/features/zones/useZoneCommit';
import { useZoneTarget } from '@/features/zones/useZoneTarget';
import { useZoneUndoKey } from '@/features/zones/useZoneUndoKey';
import {
  useBoxChange,
  useBoxEditBridge,
  useClearObjectPickOnClose,
} from '@/features/zones/useZoneViewerBridge';
import {
  boxEditOf,
  boxOfZone,
  currentSurface,
  defaultNewBox,
  editedBox,
  formWithPatch,
  ghostsOf,
  NEW_KEY,
  newSurfaceDraft,
  newZoneForm,
  nextZoneName,
  resizeBox,
  surfaceChanged,
  surfaceZoneForm,
  takenZoneNames,
  targetChanged,
  withoutSurface,
  withoutUnchangedSurface,
  withPatch,
  withSurface,
  withSurfaceBox,
  withZoneBox,
  zoneChanged,
  zoneFollowsSurface,
  type TargetDraft,
  type ZonePatch,
} from '@/features/zones/zoneEditModel';
import { formErrors, formOf, newZoneErrors, shapeOfBox } from '@/features/zones/zoneForm';
import { surfaceZoneShape } from '@/features/zones/zoneShape';
import { useZoneSource } from '@/features/zones/zoneSource';
import { linkSurfaces, pickedSurface } from '@/features/zones/zoneSurfaceLink';
import { useRoomLimit } from '@/store/roomBounds.store';
import {
  recordZoneDraft,
  removeZoneDraft,
  undoZoneDraft,
  updateZoneDraft,
  useZoneEditStore,
} from '@/store/zoneEdit.store';
import { useMemo, useState } from 'react';

/** 이름 글자 입력을 한 단계로 묶는 되돌리기 묶음 이름. */
const NAME_EDIT_GROUP = 'name';

/**
 * 발행 전: 마지막 묶음의 items 에 이 버전이 없는 구역·이은 작업면(보관해 묶음에서 빠질 것도 센다).
 * pendingIds 는 드롭다운에 `발행 전`을 붙일 구역, pendingCount 는 다시 보내기를 띄울지 가르는 수다.
 */
function usePendingPublish(
  apply: ReturnType<typeof useConfigApply>,
  links: ReadonlyMap<string, { objectId: string }>,
  ready: boolean,
) {
  const { unpublished, unpublishedSurfaces, removed } = apply;
  const pendingIds = useMemo(() => {
    const ids = new Set(unpublished ?? []);
    for (const [zoneId, linkedSurface] of links)
      if (unpublishedSurfaces?.has(linkedSurface.objectId)) ids.add(zoneId);
    return ids;
  }, [unpublished, unpublishedSurfaces, links]);
  const pendingCount =
    (unpublished?.size ?? 0) + (unpublishedSurfaces?.size ?? 0) + (ready ? removed : 0);
  return { pendingIds, pendingCount };
}

/**
 * 구역 편집 화면의 상태와 동작. 구역(또는 새 구역) 하나를 고르면 이름·심각도·구역 상자·작업면(하나)을 고치고, 저장하면
 * 구역·작업면·구성 묶음 발행을 요청 하나로 보낸다(useZoneCommit). 고친 것은 구역마다 초안으로 남아 다른 구역으로 옮겨도
 * 잃지 않는다. 새 구역은 작업면 없이 시작하고, 고소 작업면을 체크하면 기본 작업면이 초안에 붙는다. 3D 손잡이는 편집 상자를
 * boxEdit 저장소로 내려 SpatialViewportHost 가 뷰어에 넘긴다. 3D 에서 작업면을 누르면 이은 구역의 작업면 모드로 열고,
 * 어느 구역에도 이어지지 않은 작업면이면 삭제할 수 있게 orphan 으로 알린다.
 * onCommitted 는 저장·추가가 발행까지 끝났을 때 부른다(관제는 넘기지 않아 편집 끝내기를 누를 때까지 편집 모드를 유지한다, -651).
 * addOnDemand 이면 새 구역 양식은 openAdd 를 불러야 열리고(그 전까지 collapsed), cancelAdd 나 추가 성공으로 다시 접힌다.
 * 접힌 동안에는 3D 에도 새 구역 상자를 내리지 않는다.
 */
export function useZoneEditing(
  onCommitted?: () => void,
  workLayoutId?: number | null,
  setupLayoutSync?: import('@/features/setup/useSetupLayoutSync').SetupLayoutSync,
  addOnDemand = false,
) {
  const viewport = useSpatialViewport()!;
  const { zones, zonesRaw, zonesFailed } = viewport;
  const surfaceList = useWorkSurfaces();
  const { surfaces } = surfaceList;
  const apply = useConfigApply(zones, surfaceList.loaded ? surfaces : undefined);
  // 세팅 구역 단계(-615)는 세션 구역 목록에 저장하고 현장 묶음은 세팅 완료 때 보낸다. 그 전에는 「다시 보내기」를 띄우지 않는다
  const setupPlan = useZoneSource() !== null;
  const drafts = useZoneEditStore((s) => s.drafts);
  const links = useMemo(() => linkSurfaces(zones, surfaces), [zones, surfaces]);
  const pickedTarget = targetOfKey(viewport.selectedKey);
  const pickedObjectId = pickedTarget?.type === 'object' ? pickedTarget.id : null;
  const picked = pickedSurface(pickedObjectId, surfaces, links);
  const target = useZoneTarget(viewport, picked.zoneId);
  const { zone, key } = target;
  // 새 구역 양식을 열어 둔 상태(addOnDemand 일 때만 쓴다). 다른 구역으로 옮겨도 그대로다.
  const [adding, setAdding] = useState(false);
  const { orphan } = picked;
  // 고른 기존 구역도 작업면 카드도 열어 둔 새 구역 양식도 없어 패널이 추가 단추 하나만 보이는 상태.
  const collapsed = addOnDemand && !adding && zone === null && orphan === null;
  useRefreshSurfacesOnOpen();
  useClearObjectPickOnClose(pickedObjectId !== null, viewport.clearSelection);

  // ---- 고르고 있는 대상의 값 ----------------------------------------------------------------
  const linked = zone ? (links.get(zone.zoneId) ?? null) : null;
  const draft: TargetDraft | undefined = drafts[key];
  const roomLimit = useRoomLimit();
  // 작업면이 없는 구역의 상자. 새 구역은 방 가운데에서 시작하고, 체크해 붙이는 새 작업면도 이 상자 가운데에 놓인다.
  const draftBox = draft?.box ?? null;
  const zoneBox = useMemo(
    () => draftBox ?? (zone ? boxOfZone(zone) : defaultNewBox(zones, roomLimit)),
    [draftBox, zone, zones, roomLimit],
  );
  // 새 구역은 고소 작업면을 체크해야 작업면이 붙는다(초안에 작업면이 있다). 기존 구역의 작업면은 지우거나 따로 더하지 않으며,
  // 작업면 없이 만든 기존 구역은 작업면이 없다.
  const surface = useMemo(() => currentSurface(draft, linked), [draft, linked]);
  // 작업면이 있으면 구역은 작업면에서 계산한다(모양은 작업면 둘레, 판정 유형은 입체로 고정). 3D 손잡이도 작업면을 고친다.
  const bound = surface !== null;
  const surfaceShape = useMemo(
    () => (surface ? surfaceZoneShape(surface.geometry) : null),
    [surface],
  );
  // 이름을 고치지 않은 새 구역은 `종류 + 구분자`(작업면이 있으면 고소작업면 A, 없으면 위험구역 1)이고 활성 구역과 겹치지 않는다.
  const patchedForm = zone
    ? formWithPatch(zone, draft?.patch ?? {})
    : newZoneForm(draft?.patch ?? {}, nextZoneName(zones, surface ? 'surface' : 'zone'));
  const layoutBound = zone ? zone.layoutItemId != null : workLayoutId != null;
  const form = bound || layoutBound ? surfaceZoneForm(patchedForm) : patchedForm;
  // 저장할 구역 모양: 작업면이 있으면 작업면에서 계산한 모양, 없으면 고친 상자(새 구역은 지금 상자). 기존 구역을 고치지 않았으면
  // null 이고 받은 모양을 그대로 보낸다.
  const savedBox = zone ? editedBox(zone, draft) : zoneBox;
  const shape = surfaceShape ?? (savedBox && shapeOfBox(savedBox));
  // 다른 활성 구역과 같은 이름은 저장하지 않는다(고친 이름만 본다).
  const taken = useMemo(() => takenZoneNames(zones, zone?.zoneId), [zones, zone]);
  const errors = zone
    ? formErrors(form, { saved: formOf(zone), hasHeight: bound || zone.zRange !== null, taken })
    : newZoneErrors(form, taken);
  if (layoutBound && !surface && shape && !itemOfZoneShape('validation', form.name, shape)) {
    errors.judgeType = '구역의 너비와 길이는 각각 0.8m 이상이어야 합니다.';
  }
  const surfaceErrors = surface ? geometryErrors(surface.geometry) : null;
  const surfaceValid = surfaceErrors === null;

  // ---- 저장 조건 ----------------------------------------------------------------------------
  const surfaceDirty = zone ? surfaceChanged(draft?.surface, linked) : false;
  // 작업면이 붙은 구역은 작업면을 고쳐 구역 모양·높이가 달라지면 구역도 새 버전으로 저장한다(받은 구역이 이미 그 모양이면
  // 작업면만 저장한다).
  const surfaceMovesZone =
    bound && surfaceDirty && !(zone && surfaceShape && zoneFollowsSurface(zone, surfaceShape));
  const zoneDirty = zone ? zoneChanged(zone, draft) || surfaceMovesZone : false;
  const dirty = zoneDirty || surfaceDirty;
  const ready = Boolean(zonesRaw) && surfaceList.loaded;
  const valid = Object.keys(errors).length === 0 && surfaceValid;
  const { pendingIds, pendingCount } = usePendingPublish(apply, links, ready);
  // 이 구역이 저장 전(고침)인지 가르는 ID 모음. 드롭다운에 `저장 전`을 붙인다.
  const changedIds = useMemo(
    () =>
      new Set(
        zones
          .filter((z) => targetChanged(z, drafts[z.zoneId], links.get(z.zoneId) ?? null))
          .map((z) => z.zoneId),
      ),
    [zones, drafts, links],
  );

  // ---- 3D 와 주고받기 -----------------------------------------------------------------------
  // 구역 없는 작업면을 골랐을 때는 고치는 상자가 없다(삭제만 한다). 양식이 접혀 있을 때도 없다.
  const boxEdit = useMemo(
    () => (orphan || collapsed ? null : boxEditOf({ key, zone, zoneBox, surface, surfaceValid })),
    [orphan, collapsed, key, zone, zoneBox, surface, surfaceValid],
  );
  const ghosts = useMemo(() => ghostsOf(drafts, key, zones, links), [drafts, key, zones, links]);
  const onBoxChange = useBoxChange({ key, zone, linked, surface, zoneBox });
  useBoxEditBridge({ boxEdit, ghosts, onChange: onBoxChange });

  // ---- 저장·추가·삭제 -----------------------------------------------------------------------
  const commit = useZoneCommit({
    setupLayoutSync,
    zone,
    workLayoutId,
    shape,
    form,
    draft,
    surface,
    linked,
    orphan,
    zoneDirty,
    surfaceDirty,
    saveReady: zone !== null && ready && dirty && valid,
    addReady: zone === null && ready && valid,
    pendingCount,
    publish: () => apply.publish.mutateAsync(),
    target,
    onCommitted,
    onAdded: addOnDemand ? () => setAdding(false) : undefined,
  });

  // ---- 고치기 -------------------------------------------------------------------------------
  // 고칠 때마다 되돌릴 단계를 남긴다. group 이 같은 연속 고침(이름 글자 입력)은 한 단계로 묶는다. 이은 작업면과 같아진
  // 작업면 초안은 남기지 않는다(바뀐 것만 초안이다).
  const edit = (next: (prev: TargetDraft | undefined) => TargetDraft, group?: string) => {
    recordZoneDraft(key, group);
    updateZoneDraft(key, (prev) => withoutUnchangedSurface(next(prev), linked));
  };
  const setPatch = (patch: ZonePatch, group?: string) =>
    edit((prev) => withPatch(prev, zone, patch), group);
  const setName = (name: string) => setPatch({ name }, NAME_EDIT_GROUP);
  const setSeverity = (severity: Severity) => setPatch({ severity });
  // 새 구역의 고소 작업면 체크: 켜면 구역 상자 가운데에 기본 작업면을 붙이고, 끄면 작업면 초안을 뺀다.
  const toggleNewSurface = () =>
    edit((prev) => (surface ? withoutSurface(prev) : withSurface(prev, newSurfaceDraft(zoneBox))));
  const setSurfaceTop = (top: number) => {
    if (!surface) return;
    const geometry = { ...surface.geometry, topHeightM: top };
    // 같은 높이를 다시 받으면(입력 뒤 포커스를 잃을 때) 고친 것이 없으니 되돌릴 단계를 남기지 않는다.
    if (sameGeometry(geometry, surface.geometry)) return;
    edit((prev) => withSurface(prev, { ...surface, geometry }));
  };
  // 손잡이가 고치는 상자(작업면 또는 구역)의 가로·세로·높이를 숫자로 고친다. 가로·세로는 가운데를 두고 늘이고 줄이며, 높이는
  // 바닥을 두고 위를 옮긴다. 손잡이가 없는 대상(회전한 작업면, 형상을 못 고치는 구역)은 칸도 없다.
  const setBoxSize = (axis: 0 | 1 | 2, size: number) => {
    if (!boxEdit) return;
    const box = resizeBox(boxEdit.box, axis, size, roomLimit);
    if (!box) return;
    if (surface) edit((prev) => withSurfaceBox(prev, surface, box));
    else edit((prev) => withZoneBox(prev, zone, box));
  };
  const pick = (value: string) => {
    commit.disarm();
    if (value === NEW_KEY) setAdding(true);
    target.pick(value);
  };
  // 새 구역 양식은 열 때와 취소할 때 처음 값으로 돌린다: 입력하던 초안(고소 작업면 체크 포함)을 버린다.
  const openAdd = () => {
    removeZoneDraft(NEW_KEY);
    setAdding(true);
  };
  const cancelAdd = () => {
    removeZoneDraft(NEW_KEY);
    commit.clearNotice();
    setAdding(false);
  };
  const restore = () => {
    if (!zone) return;
    removeZoneDraft(zone.zoneId);
    commit.clearNotice();
  };
  // 구역 없는 작업면 카드가 양식을 가린 동안에는 숨은 초안을 되돌리지 않는다.
  useZoneUndoKey(!commit.busy && orphan === null, () => undoZoneDraft(key));

  // 형상을 고칠 수 없는 구역(입체 판정이 아니거나, 높이가 없거나, 직사각형이 아님). 작업면이 붙었으면 모양이 작업면에서
  // 정해지므로 해당하지 않는다.
  const shapeLocked = zone !== null && !zone.shapeEditable && !bound;

  return {
    zones,
    zone,
    zoneKey: key,
    zonesFailed,
    form,
    errors,
    surface,
    surfaceErrors,
    layoutBound,
    canToggleNewSurface: zone === null,
    toggleNewSurface,
    shapeLocked,
    orphan,
    collapsed,
    dirty,
    changedIds,
    pendingIds,
    armed: commit.armed,
    orphanArmed: commit.orphanArmed,
    busy: commit.busy,
    canSave: commit.canSave,
    canAdd: commit.canAdd,
    showRetry: commit.showRetry && !setupPlan,
    notice: commit.notice,
    pick,
    openAdd,
    // 취소 단추를 보일지도 이 값으로 가른다(양식이 늘 열려 있는 화면에는 취소가 없다).
    cancelAdd: addOnDemand ? cancelAdd : undefined,
    setName,
    setSeverity,
    setSurfaceTop,
    /** 숫자로 고칠 상자(3D 손잡이와 같은 상자)와 그 종류. 없으면 null. */
    sizeBox: boxEdit ? { kind: boxEdit.kind, box: boxEdit.box } : null,
    setBoxSize,
    save: commit.save,
    add: commit.add,
    restore,
    remove: commit.remove,
    removeOrphan: commit.removeOrphan,
    republish: commit.republish,
  };
}

/** 구역 편집 화면 훅의 반환값. 패널 조각들이 받는다. */
export type ZoneEditing = ReturnType<typeof useZoneEditing>;
