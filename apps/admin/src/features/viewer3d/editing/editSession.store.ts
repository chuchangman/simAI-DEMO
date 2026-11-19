import type { SpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import {
  applyEditOperation,
  applyEditOperations,
  boxJson,
  fieldOperation,
  isValidBox,
  isValidShape,
  objectFieldOperations,
  OBSTACLE_OBB_POLICY,
  PLANNED_OBB_POLICY,
  sameBox,
  WORK_SURFACE_OBB_POLICY,
  ZONE_AABB_POLICY,
  type EditFace,
  type EditField,
  type EditOperation,
  type EditOutcome,
  type EditPolicy,
  type ObjectEditField,
  type WorldBox,
  type WorldObb,
} from '@/features/viewer3d/editing/editGeometry';
import { readEditBox, readEditObb } from '@/features/viewer3d/editing/editRestore';
import type {
  ViewerBeginEditOptions,
  ViewerEditCancelReason,
  ViewerEditCommandResult,
  ViewerEditPreview,
  ViewerEditProvenance,
  ViewerEditRejectReason,
  ViewerEditResult,
  ViewerObjectEditOrigin,
  ViewerObjectEditPreview,
  ViewerObjectEditProvenance,
  ViewerObjectEditResult,
  ViewerObjectKind,
  ViewerPlannedEditPreview,
  ViewerPlannedEditResult,
} from '@/features/viewer3d/editing/editTypes';
import type { ViewerLayerKey } from '@/features/viewer3d/layers';
import {
  createPlannedStore,
  isPlannedKind,
  plannedGeometryProblem,
  plannedIdProblem,
  plannedJson,
  type PlannedGeometry,
  type PlannedKind,
  type PlannedStore,
} from '@/features/viewer3d/planned/plannedLayout';
import {
  obbObstacle,
  obstacleItem,
  obstacleJson,
  obstacleObb,
} from '@/features/viewer3d/surfaces/obstacleGeometry';
import {
  geometryProblem,
  obbWorkSurface,
  sameObb,
  surfaceIdProblem,
  workSurfaceItem,
  workSurfaceJson,
  workSurfaceObb,
  type WorkSurfaceGeometry,
  type WorkSurfaceSnapshot,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { parseTarget, sameTarget, targetKey } from '@/features/viewer3d/target';
import type { ViewerMode, ViewerTarget } from '@/features/viewer3d/types';
import type { ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { createStore, type StoreApi } from 'zustand/vanilla';

// 편집 세션 하나의 수명: 시작(원본 사본·출처 기록) → 미리보기(초안만 바꿈) → 취소(초안 폐기) 또는 완료(World 결과 반환).
// 원본 ZoneSnapshot·선택·위험 이벤트·적용 상태는 읽기만 한다. 저장·ACK 요청은 하지 않는다.
// 원본 구역이 바뀌거나 사라지고, 입력 Source·Scene 버전이 바뀌면 초안을 버리고 STALE_SOURCE 로 끝낸다.
// 작업면 OBB(-188)도 같은 Store·같은 엔진(applyEditOperation)·같은 수명 규칙을 쓴다. 구역 세션(session)과
// 작업면 세션(objectSession)은 동시에 하나만 있고, 결과는 모양이 달라 lastResult·lastObjectResult 로 따로 알린다.
// 등록 정적 객체(OBSTACLE, -274)도 object 대상이라 objectSession 을 쓰고 objectKind 로 정책·결과 모양만 다르다.

/** 마우스로 잡는 손잡이. move 는 X·Y 이동, 나머지는 그 면의 경계다. */
export type EditHandle = 'move' | EditFace;

/** 작업면 OBB 손잡이. move X·Y 이동, x±·y± 지역 축 면, z+ 상판, yaw 수평 회전. */
export const OBJECT_EDIT_HANDLES = ['move', 'x-', 'x+', 'y-', 'y+', 'z+', 'yaw'] as const;
export type WorkSurfaceEditHandle = (typeof OBJECT_EDIT_HANDLES)[number];
/** 정적 객체 OBB 손잡이(-274). 작업면 손잡이에 z- 아랫면, lift Z 이동(크기 유지)을 더한다. */
export const OBSTACLE_EDIT_HANDLES = [...OBJECT_EDIT_HANDLES, 'z-', 'lift'] as const;
export type ObjectEditHandle = (typeof OBSTACLE_EDIT_HANDLES)[number];

/** OBB 세션의 대상 종류. PLANNED 는 -186 가상 배치 객체다(결과는 따로 알린다). */
export type EditObjectKind = ViewerObjectKind | 'PLANNED';

/** 대상 종류마다 띄우는 손잡이. 바닥에 놓인 작업면만 z-·lift 가 없다. */
export const objectEditHandles = (kind: EditObjectKind): readonly ObjectEditHandle[] =>
  kind === 'WORK_SURFACE' ? OBJECT_EDIT_HANDLES : OBSTACLE_EDIT_HANDLES;

/** object 대상의 원본(작업면 또는 정적 객체)을 찾는다. 없으면 null. */
export function findEditableObject(snapshot: WorkSurfaceSnapshot, id: string) {
  const surface = snapshot.surfaces.find((s) => s.surfaceId === id);
  if (surface) {
    return {
      objectKind: 'WORK_SURFACE' as const,
      obb: workSurfaceObb(surface),
      source: surface.source,
    };
  }
  const obstacle = snapshot.obstacles.find((o) => o.objectId === id);
  if (obstacle) {
    return {
      objectKind: 'OBSTACLE' as const,
      obb: obstacleObb(obstacle),
      source: obstacle.source,
    };
  }
  return null;
}

const KIND_POLICY: Record<EditObjectKind, EditPolicy> = {
  WORK_SURFACE: WORK_SURFACE_OBB_POLICY,
  OBSTACLE: OBSTACLE_OBB_POLICY,
  PLANNED: PLANNED_OBB_POLICY,
};
const KIND_LABEL: Record<EditObjectKind, string> = {
  WORK_SURFACE: '작업면',
  OBSTACLE: '정적 객체',
  PLANNED: '가상 객체',
};
/** 주어 꼴(조사 포함). */
const KIND_SUBJECT: Record<EditObjectKind, string> = {
  WORK_SURFACE: '작업면이',
  OBSTACLE: '정적 객체가',
  PLANNED: '가상 객체가',
};
/** 대상 종류마다 그 대상을 그리는 레이어(-234). interactive 가 아니면 편집하지 않는다. */
const KIND_LAYER: Record<ViewerObjectKind, ViewerLayerKey> = {
  WORK_SURFACE: 'workSurfaces',
  OBSTACLE: 'obstacles',
};

export interface EditSession {
  target: ViewerTarget;
  mode: ViewerMode;
  policy: EditPolicy;
  /** 시작할 때의 원본 사본. 세션 동안 바뀌지 않는다. */
  base: WorldBox;
  draft: WorldBox;
  /** 손잡이를 놓았을 때의 초안(끄는 동안은 그대로). 이름표·알림에 쓴다. */
  settled: WorldBox;
  provenance: ViewerEditProvenance;
  /** 지금 끌고 있는 손잡이. */
  dragging: EditHandle | null;
  /** 마지막으로 거부된 미리보기(초안은 그 직전 유효 값에 머문다). */
  refused: { reason: 'NOT_EDITABLE' | 'INVALID_GEOMETRY'; detail: string } | null;
}

/** 작업면·정적 객체 OBB 편집 세션(-188·-274). 원본(base)은 바뀌지 않는다. */
export interface ObjectEditSession {
  target: ViewerTarget;
  mode: ViewerMode;
  /** WORK_SURFACE 등록 작업면 · OBSTACLE 등록 정적 객체(-274) · PLANNED 가상 배치(-186). 정책·결과 모양이 갈린다. */
  objectKind: EditObjectKind;
  /** PLANNED 일 때 가상 객체 종류. 그 밖에는 null. */
  plannedKind: PlannedKind | null;
  /** PLANNED 일 때 시작한 배치의 layoutId. 그 밖에는 null. */
  layoutId: string | null;
  policy: EditPolicy;
  base: WorldObb;
  draft: WorldObb;
  settled: WorldObb;
  provenance: ViewerObjectEditProvenance;
  /** REGISTERED 받은 작업면 편집 · NEW 3D 에서 새로 만듦(임시로 선택 대상에 올렸다가 끝나면 내린다). */
  origin: ViewerObjectEditOrigin;
  /** 받은 원본 항목(얕은 사본). 결과 항목(afterItem)에 다른 키를 그대로 돌려준다. NEW 는 빈 객체. */
  source: Readonly<Record<string, unknown>>;
  dragging: ObjectEditHandle | null;
  refused: { reason: 'NOT_EDITABLE' | 'INVALID_GEOMETRY'; detail: string } | null;
}

export interface EditState {
  session: EditSession | null;
  /** 마지막 결과. 바뀔 때마다 새 객체라 구독자가 알린다. */
  lastResult: ViewerEditResult | null;
  /** 작업면 OBB 편집 세션. 구역 세션과 동시에 열리지 않는다. */
  objectSession: ObjectEditSession | null;
  /** 작업면 편집의 마지막 결과(시작 거부 포함). */
  lastObjectResult: ViewerObjectEditResult | null;
  /** PLANNED 가상 객체 편집의 마지막 결과(시작 거부 포함, -186). */
  lastPlannedResult: ViewerPlannedEditResult | null;
  /** options 로 미저장 초안을 한 번에 다시 연다(-234). 없으면 원본에서 시작한다. */
  begin(input: unknown, options?: ViewerBeginEditOptions): ViewerEditCommandResult;
  /** from(보통 끌기 시작 때 초안)에 조작을 적용해 초안으로 둔다. 거부되면 초안은 그대로다. */
  preview(from: WorldBox, operation: EditOperation): EditOutcome;
  setDragging(handle: EditHandle | null): void;
  /** 끌던 조작을 되돌린다(Esc). 초안을 끌기 전 값으로 둔다. */
  restoreDraft(draft: WorldBox): void;
  /**
   * 초안의 한 값을 World 절대값으로 고친다(숫자 입력). 끌기와 같은 엔진·정책으로 검사하고,
   * 거부되면 초안은 마지막 유효 값에 둔다. 끄는 중에는 받지 않는다.
   */
  updateField(field: EditField, value: number): ViewerEditCommandResult;
  cancel(reason?: ViewerEditCancelReason): ViewerEditResult | null;
  finish(): ViewerEditResult | null;
  /** from(끌기 시작 때 작업면 초안)에 조작을 적용한다. 거부되면 초안은 그대로다. */
  previewObject(from: WorldObb, operation: EditOperation): EditOutcome;
  setObjectDragging(handle: ObjectEditHandle | null): void;
  restoreObjectDraft(draft: WorldObb): void;
  /** 작업면 초안의 한 값을 절대값으로 고친다(숫자 입력). 끌기와 같은 엔진·정책으로 검사한다. */
  updateObjectField(field: ObjectEditField, value: number): ViewerEditCommandResult;
  cancelObject(reason?: ViewerEditCancelReason): ViewerObjectEditResult | null;
  finishObject(): ViewerObjectEditResult | null;
  /** 새 작업면을 3D 에서 만든다(-188). ID·처음 형상을 받아 NEW 편집 세션을 연다. 등록·저장은 하지 않는다. */
  createObject(input: unknown): ViewerEditCommandResult;
  /** 새 가상 객체를 만든다(-186, PLANNED 모드만). ID·종류·처음 형상으로 NEW 편집 세션을 연다. */
  createPlanned(input: unknown): ViewerEditCommandResult;
  /** 가상 객체 편집을 취소한다. 가상 객체 편집 중이 아니면 null. */
  cancelPlanned(reason?: ViewerEditCancelReason): ViewerPlannedEditResult | null;
  /** 가상 객체 편집을 끝내고 World 결과를 돌려준다(저장 아님). 편집 중이 아니면 null. */
  finishPlanned(): ViewerPlannedEditResult | null;
}

export type EditStore = StoreApi<EditState>;

const copyBox = (box: WorldBox): WorldBox =>
  ({ min: [...box.min], max: [...box.max] }) as unknown as WorldBox;

export function previewOf(session: EditSession): ViewerEditPreview {
  return {
    target: session.target,
    mode: session.mode,
    before: boxJson(session.base),
    draft: boxJson(session.draft),
    provenance: session.provenance,
    saved: false,
  };
}

export function objectPreviewOf(session: ObjectEditSession): ViewerObjectEditPreview {
  const common = {
    target: session.target,
    mode: session.mode,
    origin: session.origin,
    provenance: session.provenance,
    saved: false as const,
  };
  return session.objectKind === 'OBSTACLE'
    ? {
        ...common,
        objectKind: 'OBSTACLE',
        before: obstacleJson(obbObstacle(session.base)),
        draft: obstacleJson(obbObstacle(session.draft)),
      }
    : {
        ...common,
        objectKind: 'WORK_SURFACE',
        before: workSurfaceJson(obbWorkSurface(session.base)),
        draft: workSurfaceJson(obbWorkSurface(session.draft)),
      };
}

/** 세션 원본을 그 종류의 계약 형상으로. CANCELLED 결과에 쓴다. */
const objectBefore = (session: ObjectEditSession) =>
  session.objectKind === 'OBSTACLE'
    ? { objectKind: 'OBSTACLE' as const, before: obstacleJson(obbObstacle(session.base)) }
    : {
        objectKind: 'WORK_SURFACE' as const,
        before: workSurfaceJson(obbWorkSurface(session.base)),
      };

/** 초안을 그 종류의 계약 형상·결과 항목으로. FINISHED 결과에 쓴다. */
function objectAfter(session: ObjectEditSession) {
  if (session.objectKind === 'OBSTACLE') {
    const after = obstacleJson(obbObstacle(session.draft));
    return {
      objectKind: 'OBSTACLE' as const,
      before: obstacleJson(obbObstacle(session.base)),
      after,
      afterItem: obstacleItem(session.target.id, after, session.source),
    };
  }
  const after = workSurfaceJson(obbWorkSurface(session.draft));
  return {
    objectKind: 'WORK_SURFACE' as const,
    before: workSurfaceJson(obbWorkSurface(session.base)),
    after,
    afterItem: workSurfaceItem(session.target.id, after, session.source),
  };
}

const copyObb = (obb: WorldObb): WorldObb =>
  ({ center: [...obb.center], size: [...obb.size], yaw: obb.yaw }) as unknown as WorldObb;

/** 새로 만든 작업면(NEW) 세션이 끝나면 임시로 올린 선택 대상을 내린다. */
function releaseCreated(viewer: ViewerStore, session: ObjectEditSession) {
  if (session.origin === 'NEW') viewer.getState().unregisterTarget(session.target);
}

/** 가상 객체 세션의 내부 출처 칸. 바깥에 알리지 않는다(가상 배치 결과는 layoutId 만 싣는다). */
const PLANNED_PROVENANCE: ViewerObjectEditProvenance = Object.freeze({
  sourceId: null,
  geometryContract: 'OPERATIONAL_GEOMETRY_UNCONFIRMED',
  surfacesReceivedAt: null,
  geometryVersion: null,
  sceneVersion: null,
  configVersion: null,
});

/** 가상 객체 세션의 미리보기(-186). 형상은 World OBB(center·size·yawRad)다. */
export function plannedPreviewOf(session: ObjectEditSession): ViewerPlannedEditPreview {
  return {
    target: session.target,
    mode: session.mode,
    origin: session.origin,
    plannedKind: session.plannedKind!,
    layoutId: session.layoutId,
    before: plannedJson(obbObstacle(session.base)),
    draft: plannedJson(obbObstacle(session.draft)),
    saved: false,
  };
}

/**
 * 뷰어 인스턴스마다 하나. 뷰어 선택·모드·데이터를 읽어 세션을 지킨다.
 * connect() 가 돌려준 해제 함수를 뷰어가 내려갈 때 부른다(진행 중인 편집은 UNMOUNTED 로 취소).
 */
export function createEditStore(
  viewer: ViewerStore,
  data: SpatialDataStore,
  planned: PlannedStore = createPlannedStore(),
) {
  const store = createStore<EditState>()((set, get) => {
    const reject = (
      target: ViewerTarget | null,
      reason: ViewerEditRejectReason,
      detail: string,
    ): ViewerEditResult => {
      const result: ViewerEditResult = { status: 'REJECTED', target, reason, detail, saved: false };
      set({ session: null, lastResult: result });
      return result;
    };

    const cancel = (reason: ViewerEditCancelReason = 'USER') => {
      const { session } = get();
      if (!session) return null;
      const result: ViewerEditResult = {
        status: 'CANCELLED',
        target: session.target,
        mode: session.mode,
        before: boxJson(session.base),
        reason,
        provenance: session.provenance,
        saved: false,
      };
      set({ session: null, lastResult: result });
      return result;
    };

    // 시작하지 못한 이유만 알린다. 진행 중인 다른 편집은 그대로 둔다.
    const refuse = (
      target: ViewerTarget | null,
      reason: ViewerEditRejectReason,
      detail: string,
    ): ViewerEditCommandResult => {
      set({ lastResult: { status: 'REJECTED', target, reason, detail, saved: false } });
      return { ok: false, reason };
    };

    /** 작업면 세션을 끝낸다. 새로 만든 작업면(NEW)은 임시로 올린 선택 대상을 내린다. */
    const closeObject = (session: ObjectEditSession, result: ViewerObjectEditResult) => {
      set({ objectSession: null, lastObjectResult: result });
      releaseCreated(viewer, session);
    };

    const cancelObject = (reason: ViewerEditCancelReason = 'USER') => {
      const { objectSession } = get();
      if (!objectSession) return null;
      // 가상 객체 세션은 결과 모양이 달라 따로 끝낸다(LIVE object 결과로 알리지 않는다).
      if (objectSession.objectKind === 'PLANNED') {
        cancelPlanned(reason);
        return null;
      }
      const result: ViewerObjectEditResult = {
        status: 'CANCELLED',
        target: objectSession.target,
        mode: objectSession.mode,
        origin: objectSession.origin,
        ...objectBefore(objectSession),
        reason,
        provenance: objectSession.provenance,
        saved: false,
      };
      closeObject(objectSession, result);
      return result;
    };

    const refuseObject = (
      target: ViewerTarget,
      reason: ViewerEditRejectReason,
      detail: string,
    ): ViewerEditCommandResult => {
      set({ lastObjectResult: { status: 'REJECTED', target, reason, detail, saved: false } });
      return { ok: false, reason };
    };

    // ---- PLANNED 가상 배치(-186). 같은 OBB 세션·손잡이(ObbGizmo)·엔진을 쓰고 결과만 따로 알린다 ----
    // 배치는 planned Store 에서만 읽는다(LIVE 데이터 Store 와 섞지 않는다). PLANNED 모드에서만 연다.
    const plannedCommon = (session: ObjectEditSession) => ({
      target: session.target,
      mode: session.mode,
      origin: session.origin,
      plannedKind: session.plannedKind!,
      layoutId: session.layoutId,
      saved: false as const,
    });
    const plannedOf = (obb: WorldObb): PlannedGeometry => plannedJson(obbObstacle(obb));
    const closePlanned = (session: ObjectEditSession, result: ViewerPlannedEditResult) => {
      set({ objectSession: null, lastPlannedResult: result });
      releaseCreated(viewer, session);
    };
    const refusePlanned = (
      target: ViewerTarget | null,
      reason: ViewerEditRejectReason,
      detail: string,
    ): ViewerEditCommandResult => {
      set({ lastPlannedResult: { status: 'REJECTED', target, reason, detail, saved: false } });
      return { ok: false, reason };
    };
    const cancelPlanned = (reason: ViewerEditCancelReason = 'USER') => {
      const session = get().objectSession;
      if (!session || session.objectKind !== 'PLANNED') return null;
      const result: ViewerPlannedEditResult = {
        ...plannedCommon(session),
        status: 'CANCELLED',
        before: plannedOf(session.base),
        reason,
      };
      closePlanned(session, result);
      return result;
    };
    const finishPlanned = () => {
      const session = get().objectSession;
      if (!session || session.objectKind !== 'PLANNED' || session.dragging) return null;
      const result: ViewerPlannedEditResult = isValidShape({ kind: 'obb', ...session.draft })
        ? {
            ...plannedCommon(session),
            status: 'FINISHED',
            before: plannedOf(session.base),
            after: plannedOf(session.draft),
            changed: !sameObb(session.base, session.draft, 0),
          }
        : {
            status: 'REJECTED',
            target: session.target,
            reason: 'INVALID_GEOMETRY',
            detail: '초안 형상이 유효하지 않다',
            saved: false,
          };
      closePlanned(session, result);
      return result;
    };
    /** 가상 객체 세션을 연다. 진행 중인 다른 편집은 바뀐 것으로 끝낸다. 새 객체는 장면 대상으로 임시로 올린다. */
    const openPlanned = (
      target: ViewerTarget,
      base: WorldObb,
      draft: WorldObb,
      origin: ViewerObjectEditOrigin,
      plannedKind: PlannedKind,
      layoutId: string | null,
    ) => {
      if (get().objectSession) cancelObject('REPLACED');
      if (get().session) cancel('REPLACED');
      if (origin === 'NEW') viewer.getState().registerTarget(target);
      viewer.getState().select(target);
      set({
        objectSession: {
          target,
          mode: 'PLANNED',
          objectKind: 'PLANNED',
          plannedKind,
          layoutId,
          policy: PLANNED_OBB_POLICY,
          base,
          draft: copyObb(draft),
          settled: copyObb(draft),
          provenance: PLANNED_PROVENANCE,
          origin,
          source: {},
          dragging: null,
          refused: null,
        },
      });
    };
    /** 모드·준비 검사. PLANNED 가 아니면 가상 배치를 열지 않는다(LIVE·REPLAY 와 격리). */
    const plannedGate = (target: ViewerTarget | null): ViewerEditCommandResult | null => {
      const { phase, mode } = viewer.getState();
      if (phase !== 'ready') return refusePlanned(target, 'NOT_READY', '뷰어가 준비되지 않았다');
      if (mode !== 'PLANNED') {
        return refusePlanned(target, 'NOT_EDITABLE', '가상 배치는 PLANNED 모드에서만 편집한다');
      }
      return null;
    };
    const beginPlanned = (
      target: ViewerTarget,
      options: ViewerBeginEditOptions = {},
    ): ViewerEditCommandResult => {
      const gated = plannedGate(target);
      if (gated) return gated;
      const { snapshot } = planned.getState();
      const found = snapshot.objects.find((o) => o.id === target.id);
      if (!found) return refusePlanned(target, 'NOT_FOUND', '배치에 그 가상 객체가 없다');
      const base = obstacleObb(found);
      let draft = base;
      if (options.before !== undefined) {
        const before = readEditObb('OBSTACLE', options.before);
        if (!before)
          return refusePlanned(target, 'INVALID_GEOMETRY', 'before 형상이 유효하지 않다');
        if (!sameObb(before, base)) {
          return refusePlanned(target, 'STALE_SOURCE', '초안을 만든 뒤 원본 가상 객체가 바뀌었다');
        }
      }
      if (options.draft !== undefined) {
        const parsed = readEditObb('OBSTACLE', options.draft);
        if (!parsed) return refusePlanned(target, 'INVALID_GEOMETRY', '초안 형상이 유효하지 않다');
        draft = parsed;
      }
      const current = get().objectSession;
      if (current && sameTarget(current.target, target)) {
        if (options.draft !== undefined && !current.dragging) {
          set({ objectSession: { ...current, draft, settled: draft, refused: null } });
        }
        return { ok: true };
      }
      if (!viewer.getState().targets.has(targetKey(target))) {
        return refusePlanned(target, 'NOT_FOUND', '장면에 그 가상 객체가 등록되지 않았다');
      }
      openPlanned(target, base, draft, 'REGISTERED', found.kind, snapshot.layoutId);
      return { ok: true };
    };
    const createPlanned = (input: unknown): ViewerEditCommandResult => {
      const read = (key: string): unknown =>
        typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined;
      const [id, kind, geometry] = [read('id'), read('kind'), read('geometry')];
      const idProblem = plannedIdProblem(id);
      if (idProblem) return refusePlanned(null, 'INVALID_TARGET', idProblem);
      const target: ViewerTarget = { type: 'planned', id: id as string };
      const gated = plannedGate(target);
      if (gated) return gated;
      if (!isPlannedKind(kind)) {
        return refusePlanned(
          target,
          'INVALID_TARGET',
          'kind 는 OPENING·WORK_SURFACE·SCAFFOLD·EQUIPMENT 중 하나여야 한다',
        );
      }
      const { snapshot } = planned.getState();
      if (
        snapshot.objects.some((o) => o.id === target.id) ||
        viewer.getState().targets.has(targetKey(target))
      ) {
        return refusePlanned(target, 'INVALID_TARGET', '이미 배치에 있는 ID 다');
      }
      const problem = plannedGeometryProblem(geometry);
      if (problem) return refusePlanned(target, 'INVALID_GEOMETRY', problem);
      const base = obstacleObb(geometry as PlannedGeometry);
      openPlanned(target, base, base, 'NEW', kind, snapshot.layoutId);
      return { ok: true };
    };

    /** 엔진 결과를 작업면 초안에 반영한다. 거부되면 이유만 남기고 초안은 마지막 유효 값이다. */
    const settleObject = (session: ObjectEditSession, outcome: EditOutcome): EditOutcome => {
      if (!outcome.ok) {
        set({
          objectSession: {
            ...session,
            refused: { reason: outcome.reason, detail: outcome.detail },
          },
        });
        return outcome;
      }
      if (outcome.shape.kind !== 'obb') return outcome;
      const { center, size, yaw } = outcome.shape;
      const draft: WorldObb = { center, size, yaw };
      if (sameObb(draft, session.draft, 0) && session.refused === null) return outcome;
      set({
        objectSession: {
          ...session,
          draft,
          settled: session.dragging ? session.settled : draft,
          refused: null,
        },
      });
      return outcome;
    };

    /** 작업면·정적 객체 OBB 편집 시작(-188·-274). 구역 시작과 같은 순서로 검사한다. */
    const beginObject = (
      target: ViewerTarget,
      options: ViewerBeginEditOptions = {},
    ): ViewerEditCommandResult => {
      const { phase, mode } = viewer.getState();
      if (phase !== 'ready') return refuseObject(target, 'NOT_READY', '뷰어가 준비되지 않았다');
      if (mode === 'REPLAY') {
        return refuseObject(
          target,
          'NOT_EDITABLE',
          '기록 재생(REPLAY)은 과거 입력이라 편집하지 않는다',
        );
      }
      const state = data.getState();
      const found = findEditableObject(state.workSurfaces, target.id);
      if (state.workSurfaces.status !== 'READY' || !found) {
        return refuseObject(target, 'NOT_FOUND', '장면에 그 작업면·정적 객체가 없다');
      }
      const base = found.obb;
      if (!isValidShape({ kind: 'obb', ...base })) {
        return refuseObject(target, 'INVALID_GEOMETRY', '원본 형상이 유효하지 않다');
      }
      if (viewer.getState().layers[KIND_LAYER[found.objectKind]] !== 'interactive') {
        return refuseObject(target, 'NOT_EDITABLE', '이 레이어는 지금 조작할 수 없다(layers)');
      }
      // 미저장 초안으로 다시 열기(-234). 원본이 그새 바뀌었거나 초안이 틀리면 열지 않는다.
      let draft = base;
      if (options.before !== undefined) {
        const before = readEditObb(found.objectKind, options.before);
        if (!before) return refuseObject(target, 'INVALID_GEOMETRY', 'before 형상이 유효하지 않다');
        if (!sameObb(before, base)) {
          return refuseObject(target, 'STALE_SOURCE', '초안을 만든 뒤 원본 형상이 바뀌었다');
        }
      }
      if (options.draft !== undefined) {
        const parsed = readEditObb(found.objectKind, options.draft);
        if (!parsed) return refuseObject(target, 'INVALID_GEOMETRY', '초안 형상이 유효하지 않다');
        draft = parsed;
      }
      const current = get().objectSession;
      if (current && sameTarget(current.target, target)) {
        if (options.draft !== undefined && !current.dragging) {
          set({ objectSession: { ...current, draft, settled: draft, refused: null } });
        }
        return { ok: true };
      }
      if (!viewer.getState().targets.has(targetKey(target))) {
        return refuseObject(
          target,
          'NOT_FOUND',
          `장면에 그 ${KIND_SUBJECT[found.objectKind]} 등록되지 않았다`,
        );
      }
      if (current) cancelObject('REPLACED');
      if (get().session) cancel('REPLACED');
      viewer.getState().select(target);
      set({
        objectSession: {
          target,
          mode,
          objectKind: found.objectKind,
          plannedKind: null,
          layoutId: null,
          policy: KIND_POLICY[found.objectKind],
          base,
          draft: copyObb(draft),
          settled: copyObb(draft),
          provenance: {
            sourceId: state.sourceId,
            geometryContract: state.workSurfaces.contract,
            surfacesReceivedAt: state.workSurfaces.receivedAt,
            geometryVersion: state.workSurfaces.geometryVersion,
            sceneVersion: state.world?.sceneVersion ?? null,
            configVersion: null,
            // BE 정식 응답일 때만 싣는다(묶음 모양 입력의 출처 값은 예전과 같다).
            ...(state.workSurfaces.objectVersions
              ? { objectVersion: state.workSurfaces.objectVersions[target.id] ?? null }
              : {}),
          },
          origin: 'REGISTERED',
          source: found.source,
          dragging: null,
          refused: null,
        },
      });
      return { ok: true };
    };

    /** 새 작업면 만들기(-188). 받은 ID·처음 형상을 검사하고 장면에 임시 선택 대상으로 올린다. */
    const createObject = (input: unknown): ViewerEditCommandResult => {
      const id: unknown =
        typeof input === 'object' && input !== null ? Reflect.get(input, 'id') : undefined;
      const geometry: unknown =
        typeof input === 'object' && input !== null ? Reflect.get(input, 'geometry') : undefined;
      const idProblem = surfaceIdProblem(id);
      if (idProblem) {
        set({
          lastObjectResult: {
            status: 'REJECTED',
            target: null,
            reason: 'INVALID_TARGET',
            detail: idProblem,
            saved: false,
          },
        });
        return { ok: false, reason: 'INVALID_TARGET' };
      }
      const target: ViewerTarget = { type: 'object', id: id as string };
      const { phase, mode } = viewer.getState();
      if (phase !== 'ready') return refuseObject(target, 'NOT_READY', '뷰어가 준비되지 않았다');
      if (mode === 'REPLAY') {
        return refuseObject(target, 'NOT_EDITABLE', '기록 재생(REPLAY)에서는 만들지 않는다');
      }
      const state = data.getState();
      if (
        findEditableObject(state.workSurfaces, target.id) ||
        viewer.getState().targets.has(targetKey(target))
      ) {
        return refuseObject(target, 'INVALID_TARGET', '이미 장면에 있는 ID 다');
      }
      const problem = geometryProblem(geometry);
      if (problem) return refuseObject(target, 'INVALID_GEOMETRY', problem);
      const base = workSurfaceObb(geometry as WorkSurfaceGeometry);
      const current = get().objectSession;
      if (current) cancelObject('REPLACED');
      if (get().session) cancel('REPLACED');
      viewer.getState().registerTarget(target);
      viewer.getState().select(target);
      set({
        objectSession: {
          target,
          mode,
          objectKind: 'WORK_SURFACE',
          plannedKind: null,
          layoutId: null,
          policy: WORK_SURFACE_OBB_POLICY,
          base,
          draft: copyObb(base),
          settled: copyObb(base),
          provenance: {
            sourceId: state.sourceId,
            geometryContract: state.workSurfaces.contract,
            surfacesReceivedAt: state.workSurfaces.receivedAt,
            geometryVersion: state.workSurfaces.geometryVersion,
            sceneVersion: state.world?.sceneVersion ?? null,
            configVersion: null,
          },
          origin: 'NEW',
          source: {},
          dragging: null,
          refused: null,
        },
      });
      return { ok: true };
    };

    return {
      session: null,
      lastResult: null,
      objectSession: null,
      lastObjectResult: null,
      lastPlannedResult: null,

      begin: (input, options = {}) => {
        const target = parseTarget(input);
        if (!target) return refuse(null, 'INVALID_TARGET', '대상 모양이 틀렸다');
        // 사람은 관측 결과라 편집 대상이 아니다. 작업면(object)은 등록 OBB 편집(-188)으로 보낸다.
        if (target.type === 'object') return beginObject(target, options);
        if (target.type === 'planned') return beginPlanned(target, options);
        if (target.type !== 'zone') {
          return refuse(target, 'NOT_EDITABLE', `${target.type} 는 아직 편집 대상이 아니다`);
        }
        const { phase, mode } = viewer.getState();
        if (phase !== 'ready') return refuse(target, 'NOT_READY', '뷰어가 준비되지 않았다');
        if (mode === 'REPLAY') {
          return refuse(
            target,
            'NOT_EDITABLE',
            '기록 재생(REPLAY)은 과거 입력이라 편집하지 않는다',
          );
        }
        const state = data.getState();
        const zone = state.zones.zones.find((z) => z.zoneId === target.id);
        if (state.zones.status !== 'READY' || !zone) {
          return refuse(target, 'NOT_FOUND', '장면에 그 구역이 없다');
        }
        // 다각형(PRISM)·바닥 판정(FOOTPRINT) 구역은 둘레 상자가 구역이 아니라 상자로 편집하지 않는다(2D 편집 몫).
        if (zone.shape === 'PRISM' || zone.shape === 'FOOTPRINT') {
          return refuse(
            target,
            'NOT_EDITABLE',
            zone.shape === 'PRISM'
              ? '직사각형이 아닌 구역은 3D 상자로 편집하지 않는다'
              : '바닥 판정 구역은 높이가 판정에 쓰이지 않아 3D 상자로 편집하지 않는다',
          );
        }
        const base = copyBox(zone);
        if (!isValidBox(base))
          return refuse(target, 'INVALID_GEOMETRY', '원본 형상이 유효하지 않다');
        if (viewer.getState().layers.zones !== 'interactive') {
          return refuse(target, 'NOT_EDITABLE', '이 레이어는 지금 조작할 수 없다(layers)');
        }
        let draft = base;
        if (options.before !== undefined) {
          const before = readEditBox(options.before);
          if (!before) return refuse(target, 'INVALID_GEOMETRY', 'before 형상이 유효하지 않다');
          if (!sameBox(before, base)) {
            return refuse(target, 'STALE_SOURCE', '초안을 만든 뒤 원본 구역 형상이 바뀌었다');
          }
        }
        if (options.draft !== undefined) {
          const parsed = readEditBox(options.draft);
          if (!parsed) return refuse(target, 'INVALID_GEOMETRY', '초안 형상이 유효하지 않다');
          draft = parsed;
        }
        const current = get().session;
        if (current && sameTarget(current.target, target)) {
          if (options.draft !== undefined && !current.dragging) {
            set({ session: { ...current, draft, settled: draft, refused: null } });
          }
          return { ok: true };
        }
        if (!viewer.getState().targets.has(targetKey(target))) {
          return refuse(target, 'NOT_FOUND', '장면에 그 구역이 등록되지 않았다');
        }
        if (current) cancel('REPLACED');
        if (get().objectSession) cancelObject('REPLACED');
        // Gizmo 는 선택된 구역에만 붙는다. 편집 대상을 선택으로 맞춘다(선택 브리지는 뷰어 Store 하나).
        viewer.getState().select(target);
        set({
          session: {
            target,
            mode,
            policy: ZONE_AABB_POLICY,
            base,
            draft: copyBox(draft),
            settled: copyBox(draft),
            provenance: {
              sourceId: state.sourceId,
              zoneContract: state.zones.contract,
              zonesReceivedAt: state.zones.receivedAt,
              sceneVersion: state.world?.sceneVersion ?? null,
              configVersion: null,
              // BE 정식 구역일 때만 싣는다(DEMO 구역의 출처 값은 예전과 같다).
              ...(zone.official ? { zoneVersion: zone.official.zoneVersion } : {}),
            },
            dragging: null,
            refused: null,
          },
        });
        return { ok: true };
      },

      preview: (from, operation) => {
        const session = get().session;
        if (!session) return { ok: false, reason: 'NOT_EDITABLE', detail: '편집 중이 아니다' };
        const outcome = applyEditOperation({ kind: 'aabb', ...from }, operation, session.policy);
        if (!outcome.ok) {
          set({
            session: { ...session, refused: { reason: outcome.reason, detail: outcome.detail } },
          });
          return outcome;
        }
        if (outcome.shape.kind !== 'aabb') return outcome;
        const draft = { min: outcome.shape.min, max: outcome.shape.max };
        if (sameBox(draft, session.draft, 0) && session.refused === null) return outcome;
        set({
          session: {
            ...session,
            draft,
            settled: session.dragging ? session.settled : draft,
            refused: null,
          },
        });
        return outcome;
      },

      setDragging: (handle) => {
        const session = get().session;
        if (!session || session.dragging === handle) return;
        set({
          session: {
            ...session,
            dragging: handle,
            settled: handle === null ? session.draft : session.settled,
          },
        });
      },

      restoreDraft: (draft) => {
        const session = get().session;
        if (!session) return;
        const restored = copyBox(draft);
        set({
          session: {
            ...session,
            draft: restored,
            settled: restored,
            dragging: null,
            refused: null,
          },
        });
      },

      updateField: (field, value) => {
        const session = get().session;
        if (!session) return { ok: false, reason: 'NOT_EDITABLE' };
        if (session.dragging) return { ok: false, reason: 'NOT_READY' };
        const operation = fieldOperation(session.draft, field, value);
        if (!operation) {
          set({
            session: {
              ...session,
              refused: { reason: 'INVALID_GEOMETRY', detail: '숫자가 아니다' },
            },
          });
          return { ok: false, reason: 'INVALID_GEOMETRY' };
        }
        const outcome = get().preview(session.draft, operation);
        return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
      },

      cancel,

      finish: () => {
        const { session } = get();
        if (!session || session.dragging) return null;
        if (!isValidBox(session.draft)) {
          return reject(session.target, 'INVALID_GEOMETRY', '초안 형상이 유효하지 않다');
        }
        const result: ViewerEditResult = {
          status: 'FINISHED',
          target: session.target,
          mode: session.mode,
          before: boxJson(session.base),
          after: boxJson(session.draft),
          changed: !sameBox(session.base, session.draft, 0),
          provenance: session.provenance,
          saved: false,
        };
        set({ session: null, lastResult: result });
        return result;
      },

      previewObject: (from, operation) => {
        const session = get().objectSession;
        if (!session) return { ok: false, reason: 'NOT_EDITABLE', detail: '편집 중이 아니다' };
        const outcome = applyEditOperation({ kind: 'obb', ...from }, operation, session.policy);
        return settleObject(session, outcome);
      },

      setObjectDragging: (handle) => {
        const session = get().objectSession;
        if (!session || session.dragging === handle) return;
        set({
          objectSession: {
            ...session,
            dragging: handle,
            settled: handle === null ? session.draft : session.settled,
          },
        });
      },

      restoreObjectDraft: (draft) => {
        const session = get().objectSession;
        if (!session) return;
        const restored = copyObb(draft);
        set({
          objectSession: {
            ...session,
            draft: restored,
            settled: restored,
            dragging: null,
            refused: null,
          },
        });
      },

      updateObjectField: (field, value) => {
        const session = get().objectSession;
        if (!session) return { ok: false, reason: 'NOT_EDITABLE' };
        if (session.dragging) return { ok: false, reason: 'NOT_READY' };
        const operations = objectFieldOperations(session.draft, field, value);
        if (!operations) {
          set({
            objectSession: {
              ...session,
              refused: { reason: 'INVALID_GEOMETRY', detail: '숫자가 아니거나 범위를 벗어났다' },
            },
          });
          return { ok: false, reason: 'INVALID_GEOMETRY' };
        }
        const outcome = settleObject(
          session,
          applyEditOperations({ kind: 'obb', ...session.draft }, operations, session.policy),
        );
        return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
      },

      cancelObject,

      finishObject: () => {
        const session = get().objectSession;
        if (!session || session.dragging) return null;
        if (session.objectKind === 'PLANNED') {
          finishPlanned();
          return null;
        }
        if (!isValidShape({ kind: 'obb', ...session.draft })) {
          const result: ViewerObjectEditResult = {
            status: 'REJECTED',
            target: session.target,
            reason: 'INVALID_GEOMETRY',
            detail: '초안 형상이 유효하지 않다',
            saved: false,
          };
          closeObject(session, result);
          return result;
        }
        const result: ViewerObjectEditResult = {
          status: 'FINISHED',
          target: session.target,
          mode: session.mode,
          origin: session.origin,
          ...objectAfter(session),
          changed: !sameObb(session.base, session.draft, 0),
          provenance: session.provenance,
          saved: false,
        };
        closeObject(session, result);
        return result;
      },

      createObject,
      createPlanned,
      cancelPlanned,
      finishPlanned,
    };
  });

  /** 원본·선택·모드를 지켜보다가 세션을 끝낸다. 해제 함수를 돌려준다. */
  const connect = () => {
    const end = (reason: ViewerEditRejectReason, detail: string) => {
      const session = store.getState().session;
      if (!session) return;
      const result: ViewerEditResult = {
        status: 'REJECTED',
        target: session.target,
        reason,
        detail,
        saved: false,
      };
      store.setState({ session: null, lastResult: result });
    };
    const endObject = (reason: ViewerEditRejectReason, detail: string) => {
      const session = store.getState().objectSession;
      if (!session) return;
      if (session.objectKind === 'PLANNED') {
        store.setState({
          objectSession: null,
          lastPlannedResult: {
            status: 'REJECTED',
            target: session.target,
            reason,
            detail,
            saved: false,
          },
        });
        releaseCreated(viewer, session);
        return;
      }
      const result: ViewerObjectEditResult = {
        status: 'REJECTED',
        target: session.target,
        reason,
        detail,
        saved: false,
      };
      store.setState({ objectSession: null, lastObjectResult: result });
      releaseCreated(viewer, session);
    };
    const offViewer = viewer.subscribe((state, prev) => {
      const object = store.getState().objectSession;
      if (object) {
        if (state.phase === 'error' && prev.phase !== 'error') {
          endObject('NOT_READY', '뷰어 렌더링 오류');
        } else if (state.mode !== prev.mode) {
          if (state.mode === 'REPLAY') endObject('NOT_EDITABLE', '기록 재생(REPLAY)으로 바뀌었다');
          else store.getState().cancelObject('MODE_CHANGED');
        } else if (state.selected !== prev.selected && !sameTarget(state.selected, object.target)) {
          store.getState().cancelObject('SELECTION_CHANGED');
        }
      }
      const session = store.getState().session;
      if (!session) return;
      if (state.phase === 'error' && prev.phase !== 'error')
        return end('NOT_READY', '뷰어 렌더링 오류');
      if (state.mode !== prev.mode) {
        if (state.mode === 'REPLAY') return end('NOT_EDITABLE', '기록 재생(REPLAY)으로 바뀌었다');
        store.getState().cancel('MODE_CHANGED');
        return;
      }
      if (state.selected !== prev.selected && !sameTarget(state.selected, session.target)) {
        store.getState().cancel('SELECTION_CHANGED');
      }
    });
    const offData = data.subscribe((state, prev) => {
      const object = store.getState().objectSession;
      // 가상 배치는 LIVE 입력(Source·작업면·Scene)과 무관하다. planned Store 쪽에서 따로 지킨다.
      if (object && object.objectKind !== 'PLANNED') {
        const scene = state.world?.sceneVersion ?? null;
        const began = object.provenance.sceneVersion;
        if (state.sourceId !== object.provenance.sourceId) {
          endObject('STALE_SOURCE', '입력 Source 가 바뀌었다');
        } else if (state.workSurfaces !== prev.workSurfaces) {
          const found = findEditableObject(state.workSurfaces, object.target.id);
          if (object.origin === 'NEW') {
            if (found) endObject('STALE_SOURCE', '같은 ID 의 작업면이 들어왔다');
          } else if (!found || found.objectKind !== object.objectKind) {
            endObject('STALE_SOURCE', `원본 ${KIND_SUBJECT[object.objectKind]} 사라졌다`);
          } else if (!sameObb(found.obb, object.base, 0)) {
            endObject('STALE_SOURCE', `원본 ${KIND_LABEL[object.objectKind]} 형상이 바뀌었다`);
          }
        } else if (began !== null && scene !== null && scene !== began) {
          endObject('STALE_SOURCE', `Scene 버전이 바뀌었다(${began} → ${scene})`);
        }
      }
      const session = store.getState().session;
      if (!session) return;
      if (state.sourceId !== session.provenance.sourceId)
        return end('STALE_SOURCE', '입력 Source 가 바뀌었다');
      if (state.zones !== prev.zones) {
        const zone = state.zones.zones.find((z) => z.zoneId === session.target.id);
        if (!zone) return end('STALE_SOURCE', '원본 구역이 사라졌다');
        if (!sameBox(zone, session.base, 0))
          return end('STALE_SOURCE', '원본 구역 형상이 바뀌었다');
        if ((zone.official?.zoneVersion ?? null) !== (session.provenance.zoneVersion ?? null))
          return end('STALE_SOURCE', '원본 구역 버전이 바뀌었다');
      }
      const scene = state.world?.sceneVersion ?? null;
      const began = session.provenance.sceneVersion;
      if (began !== null && scene !== null && scene !== began) {
        end('STALE_SOURCE', `Scene 버전이 바뀌었다(${began} → ${scene})`);
      }
    });
    // 가상 배치(-186)의 원본은 FE 가 넘긴 배치다. 편집 중 그 객체가 사라지거나 바뀌면 STALE_SOURCE 로 끝낸다.
    const offPlanned = planned.subscribe((state, prev) => {
      const object = store.getState().objectSession;
      if (!object || object.objectKind !== 'PLANNED' || state.snapshot === prev.snapshot) return;
      if (state.snapshot.layoutId !== object.layoutId) {
        endObject('STALE_SOURCE', '가상 배치(layoutId)가 바뀌었다');
        return;
      }
      const found = state.snapshot.objects.find((o) => o.id === object.target.id);
      if (object.origin === 'NEW') {
        if (found) endObject('STALE_SOURCE', '같은 ID 의 가상 객체가 배치에 들어왔다');
      } else if (!found) {
        endObject('STALE_SOURCE', '원본 가상 객체가 사라졌다');
      } else if (
        found.kind !== object.plannedKind ||
        !sameObb(obstacleObb(found), object.base, 0)
      ) {
        endObject('STALE_SOURCE', '원본 가상 객체가 바뀌었다');
      }
    });
    return () => {
      offViewer();
      offData();
      offPlanned();
      store.getState().cancel('UNMOUNTED');
      store.getState().cancelObject('UNMOUNTED');
    };
  };

  return { store, connect };
}
