import { useCamSplitStore } from '@/features/cctv/camSplit.store';
import { CamSplitPanel } from '@/features/cctv/CamSplitPanel';
import { CctvFloat, type CctvCameraRequest } from '@/features/cctv/CctvFloat';
import {
  MONITOR_LAYERS,
  PLAN_FALLBACK_MS,
  ZONE_EDIT_LAYERS,
} from '@/features/layout/spatialHost/constants';
import { CoverageLegend } from '@/features/layout/spatialHost/CoverageLegend';
import { HostEventPanel } from '@/features/layout/spatialHost/HostEventPanel';
import { PlanOverlay } from '@/features/layout/spatialHost/PlanOverlay';
import { ToolPalette } from '@/features/layout/spatialHost/ToolPalette';
import { useBoxEditProps } from '@/features/layout/spatialHost/useBoxEditProps';
import {
  importViewer,
  type SpatialViewMode,
  type ViewerModule,
} from '@/features/layout/spatialHost/useViewerMode';
import { useViewportHost } from '@/features/layout/spatialHost/useViewportHost';
import { ZoneEditFade } from '@/features/layout/spatialHost/ZoneEditFade';
import { useThemeStore } from '@/features/layout/theme.store';
import { useCurrentCalibration } from '@/features/layout/useCurrentCalibration';
import { useFloorCoverage } from '@/features/layout/useFloorCoverage';
import { useSceneCameraImages } from '@/features/layout/useSceneCameraImages';
import { useZoneEditActive } from '@/features/monitor/useZoneEditActive';
import { ViewerLoadBoundary } from '@/features/monitor/ViewerLoadBoundary';
import { buildPersonLabelCells } from '@/features/people/personLabelCells';
import { usePersonDisplayMap } from '@/features/people/usePersonDisplay';
import { PlanMinimap } from '@/features/plan/PlanMinimap';
import { usePpeGearStates, usePpeLabels } from '@/features/ppe/usePpe';
import type { CommandResult, ViewerTarget } from '@/features/viewer3d';
import { useWatchBindDetector } from '@/features/watch/useWatch';
import { useWatchBindEffectStore } from '@/features/watch/watchBindEffect.store';
import type { ViewerZones, Zone } from '@/features/zones/types';
import { avatarMeshFetch } from '@/lib/avatarMeshFetch';
import { useRealtimeStore } from '@/store/realtime.store';
import { cn } from '@simai/ui/lib/utils';
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface SpatialViewportValue {
  view: SpatialViewMode;
  viewerReady: boolean;
  selectedKey: string | null;
  selectedZoneId: string | null;
  zones: Zone[];
  zonesRaw: ViewerZones | undefined;
  zonesFailed: boolean;
  selectTarget: (target: ViewerTarget, options?: { focus?: boolean }) => CommandResult | undefined;
  clearSelection: () => void;
}

export const SpatialViewportContext = createContext<SpatialViewportValue | null>(null);

export const useSpatialViewport = () => useContext(SpatialViewportContext);

function readSceneVersion(scene: unknown): string | null {
  if (typeof scene !== 'object' || scene === null) return null;
  const val: unknown = Reflect.get(scene, 'scene_version');
  return typeof val === 'string' ? val : null;
}

/**
 * 실시간 관제(/)의 3D World · 2D 비상 평면 · 도구 모음 · 우측 이벤트 패널 호스트. 관리자 편집 모드(구역 편집)도
 * 이 화면 위에서 한다. AppLayout 이 fullBleed 인 화면(관제 하나뿐)에서만 마운트하므로 다른 화면으로 가면 내려가고,
 * 돌아오면 3D 를 새로 띄운다.
 */
export function SpatialViewportHost({
  loadViewer = importViewer,
  planFallbackMs = PLAN_FALLBACK_MS,
  eventPanel = true,
  children,
}: {
  loadViewer?: () => Promise<ViewerModule>;
  /** 3D 가 준비되지 않았을 때 2D 를 띄우기까지 기다리는 시간(ms). 시험에서 줄인다. */
  planFallbackMs?: number;
  /** 오른쪽 이벤트 패널과 왼쪽 아래 2D 미니맵을 두는 화면인지(라우트 staticData.eventPanel, 실시간 관제). */
  eventPanel?: boolean;
  children?: ReactNode;
}) {
  const source = useRealtimeStore((s) => s.source);
  const theme = useThemeStore((s) => s.theme);
  const {
    viewer,
    scene,
    sceneStatus,
    onSceneStatusChange,
    view,
    viewerReady,
    showPlan,
    Viewer3D,
    loadAttempt,
    onLoadError,
    show3d,
    selectedKey,
    setSelectedKey,
    selectIncident,
    onViewerSelect,
    onViewerStatus,
    viewport,
  } = useViewportHost({ source, loadViewer, planFallbackMs });
  const boxEditProps = useBoxEditProps();
  const editing = useZoneEditActive();
  const [cctvOpen, setCctvOpen] = useState(false);
  const [requestedCamera, setRequestedCamera] = useState<CctvCameraRequest | null>(null);
  // 3D 가 카메라 시점 보기 중인지(-590). CCTV 창을 닫거나 「전체 보기」를 누르면 「이 방향으로 보기」 전 시점으로 돌아간다.
  const [cameraView, setCameraView] = useState(false);
  const split = useCamSplitStore((s) => s.split);
  const { cameraPoses: calibratedCameraPoses } = useCurrentCalibration();
  // 지금 Scene 을 구운 카메라별 사진(-592). 카메라 시점에 맞아 있는 동안 뷰어가 VDT 로 투영한다. 없으면 시점 이동만 한다.
  const cameraImageUrls = useSceneCameraImages(scene);
  const vdt = useMemo(() => (cameraImageUrls ? { cameraImageUrls } : undefined), [cameraImageUrls]);
  // 바닥 감시 범위(-606). 기본은 꺼 둔다: 관제 화면의 1차 신호는 사람·구역·경보 색이라 바닥 색면을 늘 깔지 않고,
  // 관제자가 사각을 확인할 때 켠다. 지금 보정과 맞을 때만 그리고, 편집 중에는 숨긴다.
  const { coverage, current: coverageCurrent } = useFloorCoverage(scene);
  const [coverageOn, setCoverageOn] = useState(false);
  const showCoverage = coverageOn && coverage !== null && !editing;
  const drawnCoverage = showCoverage && coverageCurrent ? coverage : null;

  // 편집 모드에서는 이벤트 패널·카메라 분할 창·2D 미니맵을 두지 않고 구역 편집에 화면을 준다(맵 재생성은 도구 모음이 숨긴다).
  const showEventPanel = eventPanel && !editing;
  // 작업면은 관리자 편집 모드(이벤트 패널이 없는 호스트도 같다)에서 고르고 고친다. 관제에서는 보이기만 한다.
  const layers = editing || !eventPanel ? ZONE_EDIT_LAYERS : MONITOR_LAYERS;
  // 3D 사람 이름표(A안, S15P31A101-658): 단일 사람 표시 어댑터(워치 상태 + 표시 이름)와 PPE 상태(-656, 명세 13.3)를 칸 목록으로 넘긴다.
  const personDisplayMap = usePersonDisplayMap();
  const ppeLabels = usePpeLabels();
  const personLabels = useMemo(
    () => buildPersonLabelCells(personDisplayMap, ppeLabels),
    [personDisplayMap, ppeLabels],
  );
  // 사람 머리 위 미착용 경고 표식에 쓰는 안전모·조끼 상태(-531·-552·-656·-783, 명세 13.3). 장비 형상은 그리지 않는다
  const { helmets: personHelmets, vests: personVests } = usePpeGearStates();
  // 손 흔들어 워치가 새로 이어진 사람 강조(-509). 편집 모드에서는 숨긴다
  useWatchBindDetector();
  const bindHighlights = useWatchBindEffectStore((s) => s.highlights);
  const personHighlights = editing ? undefined : bindHighlights;
  const cameraPoses = editing ? undefined : calibratedCameraPoses;

  const handleCameraClick = useCallback(
    (cameraId: string) => {
      if (!eventPanel || editing) return;
      if (useCamSplitStore.getState().split) useCamSplitStore.getState().close();
      setRequestedCamera((prev) => ({ cameraId, seq: (prev?.seq ?? 0) + 1 }));
      // CCTV 창만 연다. 3D 시점은 창 제목 줄의 「3D 에서 이 방향으로 보기」로만 옮긴다(-626).
      setCctvOpen(true);
    },
    [eventPanel, editing],
  );

  // 「3D 에서 이 방향으로 보기」(-626). 3D 시점을 그 카메라 자리로 옮긴다. 맞아 있는 동안 뷰어가 VDT 를 켠다(사진이 없으면 시점만 옮긴다).
  const viewFromCamera = useCallback(
    (cameraId: string) => {
      if (viewer.current?.viewFromCamera?.(cameraId)?.ok) setCameraView(true);
    },
    [viewer],
  );

  // 시점을 옮길 수 없는 이유(버튼을 끄고 이름표로 보인다). 3D 가 없거나 그 카메라의 보정 자세가 없으면 방향을 모른다.
  const viewFromCameraBlock = useCallback(
    (cameraId: string): string | null => {
      if (view !== '3d') return '2D 보기에서는 3D 시점을 옮길 수 없습니다';
      if (!viewerReady) return '3D 화면이 아직 준비되지 않았습니다';
      if (!calibratedCameraPoses.some((pose) => pose.cameraId === cameraId)) {
        return '이 카메라의 보정 정보가 없어 방향을 알 수 없습니다';
      }
      return null;
    },
    [view, viewerReady, calibratedCameraPoses],
  );

  const exitCameraView = useCallback(() => {
    viewer.current?.exitCameraView?.();
    setCameraView(false);
  }, [viewer]);

  const closeCctv = useCallback(() => {
    setCctvOpen(false);
    if (cameraView) exitCameraView();
  }, [cameraView, exitCameraView]);

  return (
    <SpatialViewportContext value={viewport}>
      <main aria-label="실시간 관제" className="relative flex-1 bg-background">
        {view === '3d' && sceneStatus?.regenerationRequired && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded bg-card px-3 py-2 text-sm text-muted-foreground shadow-float"
          >
            재생성 필요
          </div>
        )}
        {view === '3d' && (
          <ViewerLoadBoundary key={loadAttempt} onError={onLoadError}>
            <Suspense fallback={null}>
              <Viewer3D
                ref={viewer}
                theme={theme}
                source={source}
                avatarMeshFetch={avatarMeshFetch}
                scene={scene}
                layers={layers}
                personLabels={personLabels}
                personHelmets={personHelmets}
                personVests={personVests}
                personHighlights={personHighlights}
                cameraPoses={cameraPoses}
                floorCoverage={drawnCoverage}
                vdt={vdt}
                onCameraClick={handleCameraClick}
                onSceneStatusChange={onSceneStatusChange}
                onSelectionChange={onViewerSelect}
                onStatusChange={onViewerStatus}
                {...boxEditProps}
                className={cn('absolute inset-0', !viewerReady && 'pointer-events-none')}
              />
            </Suspense>
          </ViewerLoadBoundary>
        )}
        {showPlan && (
          <PlanOverlay
            withEventPanel={showEventPanel}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            coverage={drawnCoverage}
          />
        )}
        {showCoverage && <CoverageLegend coverage={coverage} current={coverageCurrent} />}
        {editing && <ZoneEditFade />}
        <ToolPalette
          view={view}
          onResetView={() => {
            viewer.current?.resetView?.();
            // 시점 초기화는 카메라 시점 보기도 끝낸다(뷰어가 돌아갈 시점을 잊는다).
            setCameraView(false);
          }}
          onRetry3d={show3d}
          // scene 은 { ok, raw } 라 버전은 raw 에서 읽는다(전에는 scene 에서 읽어 늘 null 이었다, -592).
          currentSceneVersion={readSceneVersion(scene?.ok ? scene.raw : null)}
          currentScene={scene?.ok ? scene.raw : undefined}
          onToggleCoverage={coverage && !editing ? () => setCoverageOn((on) => !on) : undefined}
          coverageOn={showCoverage}
        />
        {children}
        {showEventPanel && view === '3d' && (
          <PlanMinimap selectedKey={selectedKey} onSelect={setSelectedKey} />
        )}
        <HostEventPanel
          visible={showEventPanel}
          selectedKey={selectedKey}
          onSelect={selectIncident}
        />
        {showEventPanel && <CamSplitPanel />}
        {showEventPanel && cctvOpen && !split && (
          <CctvFloat
            selectedKey={selectedKey}
            requestedCamera={requestedCamera}
            onClose={closeCctv}
            onFullView={cameraView ? exitCameraView : undefined}
            onViewFromCamera={viewFromCamera}
            viewFromCameraBlock={viewFromCameraBlock}
          />
        )}
      </main>
    </SpatialViewportContext>
  );
}
