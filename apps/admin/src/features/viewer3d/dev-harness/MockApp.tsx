import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { ContractPanel } from '@/features/viewer3d/dev-harness/ContractPanel';
import { DataPanel } from '@/features/viewer3d/dev-harness/DataPanel';
import {
  readSceneOption,
  SCENE_OPTIONS,
  sceneInputOf,
  sceneStatusText,
  withSceneOption,
  type SceneOptionKey,
} from '@/features/viewer3d/dev-harness/devScene';
import {
  devViewOf,
  readDevView,
  readDiagnosticsOpen,
  withDevView,
  type DevViewKey,
} from '@/features/viewer3d/dev-harness/devView';
import { DevViewSwitcher } from '@/features/viewer3d/dev-harness/DevViewSwitcher';
import { EditPanel, EditProbe } from '@/features/viewer3d/dev-harness/EditPanel';
import { readPpeMode, useHarnessPpe } from '@/features/viewer3d/dev-harness/harnessPpe';
import {
  createHarnessSource,
  DEV_XBOT_URL,
  readAvatar,
  readAvatarMesh,
  readDataSource,
  readZoneApply,
  withDataSource,
  withZoneApply,
  type DataSourceKey,
} from '@/features/viewer3d/dev-harness/harnessSource';
import {
  DevCameraPoseApplier,
  DevVdtViewApplier,
  readCamPose,
  readVdtParam,
  readVdtViewParam,
  useDevCameraPose,
  useDevVdtConfig,
  withVdtParam,
  withVdtViewParam,
} from '@/features/viewer3d/dev-harness/lobbyPreview';
import { DebugProbe, SpatialDiagnostics } from '@/features/viewer3d/dev-harness/MockDebug';
import { MockNav } from '@/features/viewer3d/dev-harness/MockNav';
import { MockOverlay, SelectionCard } from '@/features/viewer3d/dev-harness/MockOverlay';
import { MockScene, type SceneColors } from '@/features/viewer3d/dev-harness/MockScene';
import { MockTopBar } from '@/features/viewer3d/dev-harness/MockTopBar';
import type { MenuKey } from '@/features/viewer3d/dev-harness/mockUi';
import type { SpatialMockApi } from '@/features/viewer3d/dev-harness/mswHandlers';
import {
  readGeometryMode,
  withGeometryMode,
  type GeometryMode,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  applyPlannedResult,
  DEMO_PLANNED_LAYOUT,
  PlannedPanel,
} from '@/features/viewer3d/dev-harness/PlannedPanel';
import { useRoster } from '@/features/viewer3d/dev-harness/useRoster';
import type {
  ViewerEditPreview,
  ViewerEditResult,
  ViewerObjectEditPreview,
  ViewerObjectEditResult,
  ViewerPlannedEditPreview,
  ViewerPlannedEditResult,
} from '@/features/viewer3d/editing/editTypes';
import { DEFAULT_LAYERS, type ResolvedLayers } from '@/features/viewer3d/layers';
import {
  readPostProcessingParam,
  withPostProcessingParam,
} from '@/features/viewer3d/PostProcessingLayer';
import { parseReplayLog, type ReplayLog } from '@/features/viewer3d/replay/replayLog';
import type { ViewerSceneStatus } from '@/features/viewer3d/scene/sceneContract';
import type {
  Viewer3DHandle,
  ViewerMode,
  ViewerSelectRequest,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d/types';
import { ViewerShell } from '@/features/viewer3d/ViewerShell';
import { WorldReference } from '@/features/viewer3d/WorldReference';
import type { ZoneApplyState } from '@/features/viewer3d/zones/zonePresentation';
import { useMemo, useRef, useState } from 'react';

// 3D 재질 색도 FE 토큰(packages/ui globals.css)에서 읽어 다크·화이트 모드를 따른다.
function readColors(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    person: token('--muted-foreground', '#9ba7c5'),
    personSelected: token('--primary', '#6886d5'),
    critical: token('--sev-critical', '#ff6b74'),
    caution: token('--sev-caution', '#ffd23f'),
    object: token('--point-soft', '#495e95'),
    camera: token('--faint', '#6b7797'),
  };
}

interface MockAppProps {
  /** Spatial REST Mock(MSW). 개발 서버에서 켰을 때만 있다. */
  mockApi?: SpatialMockApi | null;
  /** REST 기준 주소. MSW 가 켜져 있으면 '', 아니면 null(REST 를 쓰지 않음). */
  restBase?: string | null;
}

/**
 * 공간 상시 유지 + 하단 메뉴 + 업무 오버레이 목업과 Spatial 진단 도구.
 * ViewerShell 은 항상 한 번만 그린다. 개발 보기(devView)는 그 위 FE 목업·진단 레이어와 World 기준점의 표시만 바꾸고,
 * 업무 모드·선택·메뉴·패널·시점은 보기와 따로 보존한다.
 * 데이터 입력(source)은 보기와 따로 고르며, 바꿔도 Canvas·선택·모드는 그대로다.
 */
export function MockApp({ mockApi = null, restBase = null }: MockAppProps) {
  const viewer = useRef<Viewer3DHandle>(null);
  const [view, setView] = useState(() => readDevView(window.location.search));
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(() =>
    readDiagnosticsOpen(window.location.search),
  );
  const [menu, setMenu] = useState<MenuKey>('monitor');
  const [panelOpen, setPanelOpen] = useState(true);
  const [selected, setSelected] = useState<ViewerTarget | null>(null);
  const [status, setStatus] = useState<ViewerStatus | null>(null);
  const [light, setLight] = useState(false);
  const [colors, setColors] = useState(readColors);
  const { mockUi, spatial } = devViewOf(view);
  const [dataStore] = useState(createSpatialDataStore);
  const [sourceKey, setSourceKey] = useState(() => readDataSource(window.location.search));
  const [epoch, setEpoch] = useState(0);
  // -234 계약 시험: 형상 입력 형식·레이어 값·대기 선택 진행.
  const [geometry, setGeometry] = useState<GeometryMode>(() =>
    readGeometryMode(window.location.search),
  );
  const [layers, setLayers] = useState<ResolvedLayers>(DEFAULT_LAYERS);
  const [selectRequest, setSelectRequest] = useState<ViewerSelectRequest | null>(null);
  // -186 PLANNED 가상 배치 소비 예시. FINISHED 결과를 받으면 배치를 바꿔 다시 넘긴다(FE 계획 화면 흉내).
  const [plannedLayout, setPlannedLayout] = useState(DEMO_PLANNED_LAYOUT);
  const [plannedPreview, setPlannedPreview] = useState<ViewerPlannedEditPreview | null>(null);
  const [plannedResult, setPlannedResult] = useState<ViewerPlannedEditResult | null>(null);
  const receivePlannedResult = (result: ViewerPlannedEditResult) => {
    setPlannedResult(result);
    setPlannedPreview(null);
    setPlannedLayout((layout) => applyPlannedResult(layout, result));
  };
  // 개발 화면에서 고른 녹화 기록. null 이면 예시 기록을 재생한다.
  const [replayLog, setReplayLog] = useState<ReplayLog | null>(null);
  // 재생 입력이면 모드는 REPLAY 다. 처음 고른 입력에 맞춰 시작하고, 이후에는 입력·메뉴를 바꾸는 동작에서 정한다.
  const [initialMode] = useState<ViewerMode>(() => (sourceKey === 'replay' ? 'REPLAY' : 'LIVE'));
  const replaying = sourceKey === 'replay';
  const [avatar] = useState(() => readAvatar(window.location.search));
  const [avatarMesh] = useState(() => readAvatarMesh(window.location.search));
  // ?ppe=fixed|cycle: 사람별 안전모·조끼 상태(-552). 미착용이면 경고 표식이 보인다(장비 형상은 그리지 않는다, -783).
  const [ppeMode] = useState(() => readPpeMode(window.location.search));
  const ppe = useHarnessPpe(dataStore, ppeMode);
  const [zoneApply, setZoneApply] = useState(() => readZoneApply(window.location.search));
  const [postProcessing, setPostProcessing] = useState(() =>
    readPostProcessingParam(window.location.search),
  );
  const [vdtEnabled, setVdtEnabled] = useState(() => readVdtParam(window.location.search));
  const [vdtView, setVdtView] = useState(() => readVdtViewParam(window.location.search));
  // 배경 Scene 입력(-59). FE 가 GET /api/scenes/current 로 받는 본문을 흉내 낸다.
  const [sceneKey, setSceneKey] = useState(() => readSceneOption(window.location.search));
  const needsVdtMeta = sceneKey === 'vdt-s12' || sceneKey === 'lobby-preview';
  const vdtConfig = useDevVdtConfig(needsVdtMeta);
  // 실측 로비 프리뷰를 원본 카메라 시점에서 비교(?camPose=cam_A). 처음 한 번만 옮기고 이후 조작은 자유다.
  const [camPoseId] = useState(() => readCamPose(window.location.search));
  const camPose = useDevCameraPose(sceneKey === 'lobby-preview' ? camPoseId : null);
  // 만료 시각은 고른 순간 기준이다(렌더 중에 시각을 읽지 않는다).
  const [sceneInput, setSceneInput] = useState(() => sceneInputOf(sceneKey, Date.now(), null));
  const sceneSwap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sceneStatus, setSceneStatus] = useState<ViewerSceneStatus | null>(null);

  const effectiveSceneInput = useMemo(() => {
    if (!sceneInput) return null;
    if (
      needsVdtMeta &&
      vdtConfig &&
      sceneInput.ok &&
      sceneInput.raw &&
      typeof sceneInput.raw === 'object'
    ) {
      return {
        ...sceneInput,
        raw: { ...(sceneInput.raw as Record<string, unknown>), vdt: vdtConfig },
      };
    }
    return sceneInput;
  }, [sceneInput, needsVdtMeta, vdtConfig]);
  // 3D 편집 소비 예시(-195). 받은 초안·결과를 보여 주기만 한다.
  const [editPreview, setEditPreview] = useState<ViewerEditPreview | null>(null);
  const [editResult, setEditResult] = useState<ViewerEditResult | null>(null);
  const receiveEditResult = (result: ViewerEditResult) => {
    setEditResult(result);
    // 시작하지 못한 이유(REJECTED·다른 대상)는 진행 중인 초안을 지우지 않는다.
    if (result.status !== 'REJECTED' || result.target?.id === editPreview?.target.id) {
      setEditPreview(null);
    }
  };
  // 작업면 OBB 편집 소비 예시(-188). 구역과 같은 규칙으로 받은 값만 보인다.
  const [objectPreview, setObjectPreview] = useState<ViewerObjectEditPreview | null>(null);
  const [objectResult, setObjectResult] = useState<ViewerObjectEditResult | null>(null);
  const receiveObjectResult = (result: ViewerObjectEditResult) => {
    setObjectResult(result);
    if (result.status !== 'REJECTED' || result.target?.id === objectPreview?.target.id) {
      setObjectPreview(null);
    }
  };
  // 입력 없음이면 예전 고정 작업자·구역을, 입력이 있으면 Provider 의 사람·구역을 쓴다(둘을 함께 그리지 않는다).
  // 단, VDT 전용 12회차 장면(scene=vdt-s12)에서 source=off 일 때는 순수 배경 장면만 볼 수 있도록 예전 고정 캡슐·구역을 끈다.
  const legacy = sourceKey === 'off' && !needsVdtMeta;
  const roster = useRoster(dataStore, legacy, status?.mode ?? 'LIVE');
  // 입력을 바꾸거나 처음부터 다시 재생할 때만 새 Source 를 만든다(epoch 는 재시작 표시).
  const harness = useMemo(
    () => createHarnessSource(sourceKey, restBase, mockApi, replayLog, geometry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceKey, restBase, mockApi, epoch, replayLog, geometry],
  );

  const changeGeometry = (next: GeometryMode) => {
    // 새 Source 로 다시 받는다(다른 형식 형상을 섞지 않는다).
    setGeometry(next);
    window.history.replaceState(
      window.history.state,
      '',
      withGeometryMode(window.location.href, next),
    );
  };

  const changeView = (next: DevViewKey) => {
    setView(next);
    // 페이지를 다시 불러오지 않고 주소만 바꾼다. 업무 모드는 건드리지 않는다.
    window.history.replaceState(window.history.state, '', withDevView(window.location.href, next));
  };

  const changeSource = (next: DataSourceKey) => {
    setSourceKey(next);
    // 재생 기록은 REPLAY 로만 보인다. 재생을 떠나면 지금 업무 메뉴의 모드로 돌아간다.
    if (next === 'replay') viewer.current?.setMode('REPLAY');
    else if (replaying) viewer.current?.setMode(menu === 'tbm' ? 'PLANNED' : 'LIVE');
    window.history.replaceState(
      window.history.state,
      '',
      withDataSource(window.location.href, next),
    );
  };

  const changeZoneApply = (next: ZoneApplyState) => {
    setZoneApply(next);
    window.history.replaceState(
      window.history.state,
      '',
      withZoneApply(window.location.href, next),
    );
  };

  const changePostProcessing = (next: boolean) => {
    setPostProcessing(next);
    window.history.replaceState(
      window.history.state,
      '',
      withPostProcessingParam(window.location.href, next),
    );
  };

  const changeVdt = (next: boolean) => {
    setVdtEnabled(next);
    window.history.replaceState(window.history.state, '', withVdtParam(window.location.href, next));
  };

  const changeVdtView = (next: string) => {
    setVdtView(next);
    window.history.replaceState(
      window.history.state,
      '',
      withVdtViewParam(window.location.href, next),
    );
  };

  const changeScene = (next: SceneOptionKey) => {
    setSceneKey(next);
    // 시험 경우 여럿이 같은 scene_version 을 쓴다. 뷰어는 같은 버전이면 읽은 자산을 유지하므로(계약),
    // 입력을 한 번 비워 각 경우를 새로 읽게 한다. 실제 FE 는 이렇게 할 필요가 없다.
    setSceneInput(null);
    if (sceneSwap.current) clearTimeout(sceneSwap.current);
    sceneSwap.current = setTimeout(
      () => setSceneInput(sceneInputOf(next, Date.now(), vdtConfig)),
      0,
    );
    window.history.replaceState(
      window.history.state,
      '',
      withSceneOption(window.location.href, next),
    );
  };

  const selectMenu = (next: MenuKey) => {
    if (next === menu) {
      // 같은 메뉴는 패널만 열고 닫는다. 업무 모드는 그대로다.
      setPanelOpen((open) => !open);
      return;
    }
    setMenu(next);
    setPanelOpen(true);
    // 다른 업무 메뉴를 고른 명시적 동작만 모드를 바꾼다. TBM 계획만 PLANNED 이고 나머지는 LIVE 다.
    // 녹화 재생 중에는 재생 기록을 LIVE·PLANNED 로 보이지 않게 REPLAY 를 둔다.
    viewer.current?.setMode(replaying ? 'REPLAY' : next === 'tbm' ? 'PLANNED' : 'LIVE');
  };

  const toggleTheme = () => {
    const next = !light;
    document.documentElement.classList.toggle('dark', !next);
    setLight(next);
    setColors(readColors());
  };

  const commands = {
    select: (target: ViewerTarget) => viewer.current?.select(target),
    focus: (target: ViewerTarget) => viewer.current?.focus(target),
    clear: () => viewer.current?.clearSelection(),
  };

  return (
    <div className="smk-root" data-view={view} data-mock-ui={mockUi ? '' : undefined}>
      <div className="smk-layer" data-testid="spatial-layer">
        <ViewerShell
          ref={viewer}
          initialMode={initialMode}
          onSelectionChange={setSelected}
          onSelectRequestChange={setSelectRequest}
          onStatusChange={setStatus}
          onEditPreview={setEditPreview}
          onEditResult={receiveEditResult}
          onObjectEditPreview={setObjectPreview}
          onObjectEditResult={receiveObjectResult}
          plannedLayout={plannedLayout}
          onPlannedEditPreview={setPlannedPreview}
          onPlannedEditResult={receivePlannedResult}
          source={harness.source}
          layers={layers}
          dataStore={dataStore}
          personModelUrl={avatar === 'xbot' ? DEV_XBOT_URL : null}
          avatarMesh={avatarMesh}
          personHelmets={ppe?.helmets}
          personVests={ppe?.vests}
          zoneApplyState={zoneApply}
          scene={effectiveSceneInput}
          onSceneStatusChange={setSceneStatus}
          postProcessing={postProcessing}
          vdt={vdtEnabled}
        >
          <MockScene colors={colors} selected={selected} legacy={legacy} />
          {spatial && <WorldReference />}
          <DebugProbe />
          <EditProbe />
          <DevCameraPoseApplier pose={camPose} />
          <DevVdtViewApplier
            vdtConfig={vdtConfig}
            viewKey={vdtView}
            onChangeVdt={changeVdt}
            onChangeViewKey={changeVdtView}
          />
        </ViewerShell>
      </div>

      {mockUi && (
        <div className="smk-ui" data-testid="mock-ui">
          <MockTopBar
            status={status}
            light={light}
            onToggleTheme={toggleTheme}
            store={dataStore}
            replay={harness.replay}
          />
          <SelectionCard selected={selected} focus={commands.focus} clear={commands.clear} />
          {panelOpen && (
            <MockOverlay
              menu={menu}
              selected={selected}
              status={status}
              roster={roster}
              zoneApply={zoneApply}
              onClose={() => setPanelOpen(false)}
              {...commands}
            />
          )}
          <MockNav menu={menu} open={panelOpen} onSelect={selectMenu} />
        </div>
      )}

      {spatial && (
        <SpatialDiagnostics
          open={diagnosticsOpen}
          onToggle={() => setDiagnosticsOpen((open) => !open)}
          status={status}
          selected={selected}
        >
          <div className="smk-data-row">
            <select
              aria-label="배경 Scene"
              value={sceneKey}
              onChange={(e) => changeScene(e.target.value as SceneOptionKey)}
            >
              {SCENE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="smk-check">
              <input
                type="checkbox"
                checked={postProcessing}
                onChange={(e) => changePostProcessing(e.target.checked)}
              />
              후처리(AO·SMAA)
            </label>
            <label className="smk-check">
              <input
                type="checkbox"
                checked={vdtEnabled}
                onChange={(e) => changeVdt(e.target.checked)}
              />
              시점 의존 텍스처(VDT)
            </label>
          </div>
          <p className="smk-data-dim smk-mono" data-testid="scene-status">
            {sceneStatusText(sceneStatus)}
          </p>
          <PlannedPanel
            viewer={viewer}
            layout={plannedLayout}
            mode={status?.mode ?? 'LIVE'}
            selected={selected}
            preview={plannedPreview}
            result={plannedResult}
          />
          <ContractPanel
            viewer={viewer}
            store={dataStore}
            selected={selected}
            geometry={geometry}
            onGeometryChange={changeGeometry}
            layers={layers}
            onLayersChange={setLayers}
            selectRequest={selectRequest}
            external={harness.external ?? null}
          />
          <DataPanel
            store={dataStore}
            sourceKey={sourceKey}
            harness={harness}
            mockApi={mockApi}
            onSourceChange={changeSource}
            zoneApply={zoneApply}
            onZoneApplyChange={changeZoneApply}
            mode={status?.mode ?? 'LIVE'}
            onRestart={() => setEpoch((n) => n + 1)}
            onReplayFiles={(files) => setReplayLog(parseReplayLog(files))}
            onReplayExample={() => {
              setReplayLog(null);
              setEpoch((n) => n + 1);
            }}
          />
          <EditPanel
            viewer={viewer}
            store={dataStore}
            selected={selected}
            preview={editPreview}
            result={editResult}
            objectPreview={objectPreview}
            objectResult={objectResult}
          />
        </SpatialDiagnostics>
      )}

      <DevViewSwitcher view={view} onChange={changeView} />
    </div>
  );
}
