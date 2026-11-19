import { CameraClickContext } from '@/features/viewer3d/cameras/CameraLayer';
import { aliasOwners } from '@/features/viewer3d/data/identityCarry';
import {
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataProvider } from '@/features/viewer3d/data/SpatialDataProvider';
import { BoxEditContext, type BoxEditBinding } from '@/features/viewer3d/editing/BoxEditGizmo';
import {
  createEditStore,
  objectPreviewOf,
  plannedPreviewOf,
  previewOf,
} from '@/features/viewer3d/editing/editSession.store';
import { EditOverlayContext, EditStoreContext } from '@/features/viewer3d/editing/EditStoreContext';
import type {
  ViewerEditPreview,
  ViewerEditResult,
  ViewerObjectEditPreview,
  ViewerObjectEditResult,
  ViewerPlannedEditPreview,
  ViewerPlannedEditResult,
} from '@/features/viewer3d/editing/editTypes';
import {
  AvatarMeshContext,
  fetchAvatarMesh,
  type AvatarMeshConfig,
} from '@/features/viewer3d/people/avatarMesh';
import { PersonModelContext } from '@/features/viewer3d/people/PersonLayer';
import { createPlannedStore, PlannedStoreContext } from '@/features/viewer3d/planned/plannedLayout';
import {
  PostProcessingContext,
  resolvePostProcessing,
} from '@/features/viewer3d/PostProcessingLayer';
import {
  sameSceneStatus,
  sceneStatusOf,
  type ViewerSceneStatus,
} from '@/features/viewer3d/scene/sceneContract';
import {
  createSceneStore,
  DEFAULT_VDT_OPTIONS,
  loadGltfScene,
  loadSceneTexture,
  SceneLoaderContext,
  SceneStoreContext,
  SceneTextureLoaderContext,
  SceneVdtTextureLoaderContext,
  sceneVersionsOf,
  type SceneAssetLoader,
  type SceneTextureLoader,
  type SceneVdtTextureLoader,
} from '@/features/viewer3d/scene/sceneStore';
import { loadVdtCameraTextures } from '@/features/viewer3d/scene/vdtShader';
import type { ViewerVdtOptions } from '@/features/viewer3d/scene/vdtTypes';
import type {
  Viewer3DProps,
  ViewerBoxGhost,
  ViewerSelectRequest,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d/types';
import { createViewerStore, toStatus } from '@/features/viewer3d/viewer3d.store';
import { ViewerCanvas } from '@/features/viewer3d/ViewerCanvas';
import { ViewerErrorBoundary } from '@/features/viewer3d/ViewerErrorBoundary';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import { ZoneApplyContext, type ZoneApplyState } from '@/features/viewer3d/zones/zonePresentation';
import { cn } from '@simai/ui/lib/utils';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';

/** boxGhosts 를 안 넘겼을 때의 빈 목록. 렌더마다 새 배열을 만들면 boxEditBinding 이 매번 바뀐다. */
const NO_GHOSTS: readonly ViewerBoxGhost[] = [];

export interface ViewerShellProps extends Viewer3DProps {
  /** 장면 레이어. viewer3d 안과 시험에서만 넘긴다. */
  children?: ReactNode;
  /** 데이터 Store 를 바깥에서 읽어야 할 때(개발 진단·시험)만 넘긴다. 없으면 인스턴스마다 하나 만든다. */
  dataStore?: SpatialDataStore;
  /**
   * 구역 적용 상태 표시. 적용 증거 계약(BE -120·FE -189)이 없어 기본은 UNVERIFIED 이고, DEMO 값은 개발 화면 시험용이다.
   * 바꿔도 Canvas·장면은 그대로이고 구역 모양만 바뀐다.
   */
  zoneApplyState?: ZoneApplyState;
  /** 배경 glTF 읽기 함수. 시험만 바꿔 끼운다. 없으면 GLTFLoader. */
  sceneLoader?: SceneAssetLoader;
  /** 배경 보조 텍스처(SURFACE_SOURCE_MAP 등) 읽기 함수. 시험만 바꿔 끼운다. */
  sceneTextureLoader?: SceneTextureLoader;
  /** VDT 카메라 사진 텍스처 읽기 함수. 시험만 바꿔 끼운다. */
  sceneVdtTextureLoader?: SceneVdtTextureLoader;
  /** 개발 검수 전용: 정합 근거 없는 배경도 불투명하게 그린다(판정·상태는 그대로). 운영 화면은 넘기지 않는다. */
}

function resolveVdtOptions(vdt: boolean | ViewerVdtOptions | undefined): ViewerVdtOptions {
  if (typeof vdt === 'boolean') {
    return { ...DEFAULT_VDT_OPTIONS, enabled: vdt };
  }
  if (vdt && typeof vdt === 'object') {
    return { ...DEFAULT_VDT_OPTIONS, ...vdt };
  }
  return DEFAULT_VDT_OPTIONS;
}

/** 뷰어 상태·명령·알림과 데이터 입력을 묶는다. 인스턴스가 살아 있는 동안 store 와 Canvas 는 하나다. */
export function ViewerShell({
  ref,
  initialMode = 'LIVE',
  onSelectionChange,
  onTargetDoubleClick,
  onStatusChange,
  onSelectRequestChange,
  onEditPreview,
  onEditResult,
  onObjectEditPreview,
  onObjectEditResult,
  onPlannedEditPreview,
  onPlannedEditResult,
  plannedLayout = null,
  editDraftOverlay = null,
  boxEdit = null,
  onBoxEditChange,
  boxGhosts = NO_GHOSTS,
  layers,
  source,
  className,
  children,
  dataStore,
  personModelUrl = null,
  personLabels,
  personBadges,
  personHighlights,
  personHelmets,
  personVests,
  cameraPoses,
  floorCoverage,
  onCameraClick,
  avatarMesh = 'auto',
  avatarMeshFetch = fetchAvatarMesh,
  zoneApplyState = 'UNVERIFIED',
  scene = null,
  onSceneStatusChange,
  sceneLoader = loadGltfScene,
  sceneTextureLoader = loadSceneTexture,
  sceneVdtTextureLoader = loadVdtCameraTextures,
  postProcessing = false,
  topView = false,
  vdt = false,
  theme = 'dark',
}: ViewerShellProps) {
  // 호스트가 쥔 상자 편집(controlled). 뷰어 안 편집 세션과 따로이며 Canvas 안 BoxEditGizmo 가 읽는다.
  const boxEditBinding = useMemo<BoxEditBinding>(
    () => ({ boxEdit, onBoxEditChange, boxGhosts }),
    [boxEdit, onBoxEditChange, boxGhosts],
  );
  const [store] = useState(() => {
    const created = createViewerStore(initialMode);
    // 첫 장면부터 레이어 값을 따른다(기본값으로 한 번 그렸다가 숨기지 않게).
    created.getState().setLayers(layers);
    created.getState().setPersonLabels(personLabels);
    created.getState().setPersonBadges(personBadges);
    created.getState().setPersonHighlights(personHighlights);
    created.getState().setPersonHelmets(personHelmets);
    created.getState().setPersonVests(personVests);
    created.getState().setCameraPoses(cameraPoses);
    created.getState().setFloorCoverage(floorCoverage);
    created.getState().setTopView(topView);
    return created;
  });
  useEffect(() => store.getState().setTheme(theme), [store, theme]);
  useEffect(() => {
    store.getState().setTopView(topView);
  }, [store, topView]);
  // 처음 받은 dataStore 를 계속 쓴다. 바꿔 넘겨도 장면의 구독을 옮기지 않는다.
  const [data] = useState(() => dataStore ?? createSpatialDataStore());
  const meshConfig = useMemo<AvatarMeshConfig>(
    () => ({ enabled: avatarMesh !== 'off', fetch: avatarMeshFetch }),
    [avatarMesh, avatarMeshFetch],
  );
  const resolvedPostProcessing = useMemo(
    () => resolvePostProcessing(postProcessing),
    [postProcessing],
  );
  // 편집 세션(-195). 뷰어 Store·데이터 Store 를 읽기만 하고 원본을 바꾸지 않는다.
  // PLANNED 가상 배치(-186). LIVE 데이터 Store 와 따로 둔다. 입력은 FE 가 넘긴 배치 그대로다.
  const [planned] = useState(() => {
    const created = createPlannedStore();
    created.getState().setInput(plannedLayout);
    return created;
  });
  const [edit] = useState(() => createEditStore(store, data, planned));
  // 정적 배경 Scene(-59). 입력은 FE 가 받은 /api/scenes/current(또는 /api/scenes/{scene_version}/view) 결과 그대로다.
  const [sceneStore] = useState(() => {
    const created = createSceneStore();
    created.getState().setVdtOptions(resolveVdtOptions(vdt));
    return created;
  });
  const mode = useStore(store, (s) => s.mode);
  const phase = useStore(store, (s) => s.phase);
  const isTopView = useStore(store, (s) => s.topView);
  const alignedCamera = useStore(store, (s) => s.alignedCamera);

  useImperativeHandle(ref, () => {
    const {
      requestSelect,
      clearSelection,
      focusOn,
      setMode,
      resetView,
      setTopView,
      viewFromCamera,
      exitCameraView,
    } = store.getState();
    const {
      begin,
      cancel,
      finish,
      updateField,
      cancelObject,
      finishObject,
      updateObjectField,
      createObject,
      createPlanned,
      cancelPlanned,
      finishPlanned,
    } = edit.store.getState();
    // LIVE object 명령은 가상 객체 세션을 건드리지 않고, 가상 객체 명령은 LIVE object 세션을 건드리지 않는다.
    const objectKind = () => edit.store.getState().objectSession?.objectKind ?? null;
    return {
      select: (target, options) => requestSelect(target, options),
      clearSelection,
      focus: focusOn,
      setMode,
      beginEdit: (target, options) => begin(target, options),
      cancelEdit: () => cancel('USER'),
      finishEdit: finish,
      updateEditField: (change) => updateField(change.field, change.value),
      cancelObjectEdit: () => (objectKind() === 'PLANNED' ? null : cancelObject('USER')),
      finishObjectEdit: () => (objectKind() === 'PLANNED' ? null : finishObject()),
      updateObjectEditField: (change) =>
        objectKind() === 'PLANNED'
          ? { ok: false, reason: 'NOT_EDITABLE' }
          : updateObjectField(change.field, change.value),
      beginObjectCreate: createObject,
      beginPlannedCreate: createPlanned,
      cancelPlannedEdit: () => cancelPlanned('USER'),
      finishPlannedEdit: finishPlanned,
      updatePlannedEditField: (change) =>
        objectKind() === 'PLANNED'
          ? updateObjectField(change.field, change.value)
          : { ok: false, reason: 'NOT_EDITABLE' },
      resetView,
      setTopView,
      viewFromCamera,
      exitCameraView,
    };
  }, [store, edit]);

  const emitSelection = useEffectEvent((target: ViewerTarget | null) =>
    onSelectionChange?.(target),
  );
  const emitTargetDoubleClick = useEffectEvent((target: ViewerTarget) =>
    onTargetDoubleClick?.(target),
  );
  const emitSelectRequest = useEffectEvent((request: ViewerSelectRequest) =>
    onSelectRequestChange?.(request),
  );
  const emitStatus = useEffectEvent((status: ViewerStatus) => onStatusChange?.(status));
  const emitEditPreview = useEffectEvent((preview: ViewerEditPreview) => onEditPreview?.(preview));
  const emitEditResult = useEffectEvent((result: ViewerEditResult) => onEditResult?.(result));
  const emitObjectEditPreview = useEffectEvent((preview: ViewerObjectEditPreview) =>
    onObjectEditPreview?.(preview),
  );
  const emitObjectEditResult = useEffectEvent((result: ViewerObjectEditResult) =>
    onObjectEditResult?.(result),
  );
  const emitPlannedEditPreview = useEffectEvent((preview: ViewerPlannedEditPreview) =>
    onPlannedEditPreview?.(preview),
  );
  const emitPlannedEditResult = useEffectEvent((result: ViewerPlannedEditResult) =>
    onPlannedEditResult?.(result),
  );
  const emitSceneStatus = useEffectEvent((status: ViewerSceneStatus) =>
    onSceneStatusChange?.(status),
  );

  // 레이어 값이 같으면 Store 를 바꾸지 않는다(렌더마다 새 객체를 넘겨도 다시 그리지 않는다).
  useEffect(() => {
    store.getState().setLayers(layers);
  }, [store, layers]);

  useEffect(() => {
    store.getState().setPersonLabels(personLabels);
  }, [store, personLabels]);

  useEffect(() => {
    store.getState().setPersonBadges(personBadges);
  }, [store, personBadges]);

  useEffect(() => {
    store.getState().setPersonHighlights(personHighlights);
  }, [store, personHighlights]);

  useEffect(() => {
    store.getState().setPersonHelmets(personHelmets);
  }, [store, personHelmets]);

  useEffect(() => {
    store.getState().setPersonVests(personVests);
  }, [store, personVests]);

  useEffect(() => {
    store.getState().setCameraPoses(cameraPoses);
  }, [store, cameraPoses]);

  useEffect(() => {
    store.getState().setFloorCoverage(floorCoverage);
  }, [store, floorCoverage]);

  useEffect(() => {
    planned.getState().setInput(plannedLayout);
  }, [planned, plannedLayout]);

  // 기다리던 선택은 뷰어가 내려갈 때 UNMOUNTED 로 끝내고 타이머를 푼다.
  useEffect(() => () => store.getState().dispose(), [store]);

  // ID 병합 승계(-661): World 를 받을 때마다 별칭 → 생존 ID 표를 뷰어 Store 에 넘긴다. 데이터 Store 구독은 같은 set 안에서
  // 바로 불리므로 흡수된 사람의 장면 대상이 React 반영으로 빠지기 전에 표가 먼저 바뀐다.
  useEffect(() => {
    const push = (tracks: Parameters<typeof aliasOwners>[0]) =>
      store.getState().setPersonAliases(aliasOwners(tracks));
    push(data.getState().world?.tracks ?? []);
    return data.subscribe((state, prev) => {
      if (state.world !== prev.world) push(state.world?.tracks ?? []);
    });
  }, [store, data]);

  useEffect(() => {
    sceneStore.getState().setInput(scene);
  }, [sceneStore, scene]);

  useEffect(() => {
    sceneStore.getState().setVdtOptions(resolveVdtOptions(vdt));
  }, [sceneStore, vdt]);

  // 배경 상태는 입력·읽기 단계·World·Health 버전이 바뀔 때만 알린다(10 Hz World 마다 알리지 않는다).
  useEffect(() => {
    let last: ViewerSceneStatus | null = null;
    const update = () => {
      const { input, load } = sceneStore.getState();
      const next = sceneStatusOf(input, load, sceneVersionsOf(data.getState()));
      if (last && sameSceneStatus(last, next)) return;
      last = next;
      emitSceneStatus(next);
    };
    update();
    const offScene = sceneStore.subscribe(update);
    const offData = data.subscribe((state, prev) => {
      if (state.world?.sceneVersion !== prev.world?.sceneVersion) update();
      else if (state.world?.calibrationVersion !== prev.world?.calibrationVersion) update();
      else if (state.health !== prev.health) update();
    });
    return () => {
      offScene();
      offData();
    };
  }, [sceneStore, data]);

  useEffect(() => {
    let last = toStatus(store.getState());
    emitStatus(last);
    return store.subscribe((state, prev) => {
      if (state.selected !== prev.selected) emitSelection(state.selected);
      if (state.selectRequest && state.selectRequest !== prev.selectRequest) {
        emitSelectRequest(state.selectRequest);
      }
      if (state.activated && state.activated !== prev.activated) {
        emitTargetDoubleClick(state.activated.target);
      }
      if (state.phase !== last.phase || state.mode !== last.mode || state.error !== last.error) {
        last = toStatus(state);
        emitStatus(last);
      }
    });
  }, [store]);

  // 편집 세션을 선택·모드·원본 변경에 묶고, 뷰어가 내려가면 진행 중인 편집을 UNMOUNTED 로 취소한다.
  useEffect(() => edit.connect(), [edit]);

  // 초안은 시작·손잡이를 놓을 때만 알린다(끄는 도중 매 움직임마다 FE 를 다시 그리게 하지 않는다).
  useEffect(
    () =>
      edit.store.subscribe((state, prev) => {
        if (state.lastResult && state.lastResult !== prev.lastResult)
          emitEditResult(state.lastResult);
        if (state.lastObjectResult && state.lastObjectResult !== prev.lastObjectResult)
          emitObjectEditResult(state.lastObjectResult);
        if (state.lastPlannedResult && state.lastPlannedResult !== prev.lastPlannedResult)
          emitPlannedEditResult(state.lastPlannedResult);
        const object = state.objectSession;
        const objectBefore = prev.objectSession;
        if (
          object &&
          !object.dragging &&
          (!objectBefore ||
            objectBefore.target !== object.target ||
            objectBefore.draft !== object.draft ||
            objectBefore.dragging)
        ) {
          // 가상 객체 초안은 따로 알린다(LIVE object 콜백에 섞지 않는다).
          if (object.objectKind === 'PLANNED') emitPlannedEditPreview(plannedPreviewOf(object));
          else emitObjectEditPreview(objectPreviewOf(object));
        }
        const now = state.session;
        const before = prev.session;
        if (!now || now.dragging) return;
        if (
          !before ||
          before.target !== now.target ||
          before.draft !== now.draft ||
          before.dragging
        ) {
          emitEditPreview(previewOf(now));
        }
      }),
    [edit],
  );

  const handleRenderError = useCallback(
    (error: Error) => store.getState().markError({ code: 'RENDER_FAILED', message: error.message }),
    [store],
  );

  return (
    <div
      className={cn('relative size-full', className)}
      data-viewer-mode={mode}
      data-viewer-phase={phase}
      data-viewer-top-view={isTopView ? 'on' : 'off'}
      data-viewer-camera-view={alignedCamera ?? 'off'}
      data-viewer-post={resolvedPostProcessing.enabled ? 'on' : 'off'}
    >
      {/* 렌더 오류로 Canvas 가 내려가도 데이터 구독은 이어 간다(뷰어는 경보 경로가 아니지만 상태는 잃지 않는다). */}
      <SpatialDataProvider store={data} source={source}>
        <ViewerErrorBoundary onError={handleRenderError}>
          <ViewerStoreContext value={store}>
            <EditStoreContext value={edit.store}>
              <EditOverlayContext value={editDraftOverlay}>
                <PersonModelContext value={personModelUrl}>
                  <AvatarMeshContext value={meshConfig}>
                    <ZoneApplyContext value={zoneApplyState}>
                      <SceneStoreContext value={sceneStore}>
                        <SceneLoaderContext value={sceneLoader}>
                          <SceneTextureLoaderContext value={sceneTextureLoader}>
                            <SceneVdtTextureLoaderContext value={sceneVdtTextureLoader}>
                              <PlannedStoreContext value={planned}>
                                <BoxEditContext value={boxEditBinding}>
                                  <CameraClickContext value={onCameraClick}>
                                    <PostProcessingContext value={resolvedPostProcessing}>
                                      <ViewerCanvas>{children}</ViewerCanvas>
                                    </PostProcessingContext>
                                  </CameraClickContext>
                                </BoxEditContext>
                              </PlannedStoreContext>
                            </SceneVdtTextureLoaderContext>
                          </SceneTextureLoaderContext>
                        </SceneLoaderContext>
                      </SceneStoreContext>
                    </ZoneApplyContext>
                  </AvatarMeshContext>
                </PersonModelContext>
              </EditOverlayContext>
            </EditStoreContext>
          </ViewerStoreContext>
        </ViewerErrorBoundary>
      </SpatialDataProvider>
    </div>
  );
}
