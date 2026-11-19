import type { SpatialViewportValue } from '@/features/layout/SpatialViewportHost';
import { useSpatialSnapshots } from '@/features/layout/spatialHost/useSpatialSnapshots';
import {
  useViewerMode,
  type SpatialViewMode,
  type ViewerModule,
} from '@/features/layout/spatialHost/useViewerMode';
import { useViewerSelection } from '@/features/layout/spatialHost/useViewerSelection';
import { useSceneOrCurrent } from '@/features/layout/useSceneView';
import type {
  ExternalSpatialSource,
  Viewer3DHandle,
  ViewerSceneStatus,
  ViewerStatus,
} from '@/features/viewer3d';
import { useZones } from '@/features/zones/useZones';
import { usableScanBounds } from '@/lib/roomLimit';
import { useRoomBoundsStore } from '@/store/roomBounds.store';
import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * 뷰어가 알린 장면 상태에서 보이는 스캔의 경계를 꺼내 호스트 저장소에 올린다(새 구역 자리·머리글이 읽는다).
 * 스캔이 숨겨졌거나 쓸 수 없거나 3D 를 보고 있지 않을 때, 그리고 호스트가 내려갈 때는 비워 목업 교실로 돌아간다.
 */
function usePublishRoomBounds(view: SpatialViewMode, sceneStatus: ViewerSceneStatus | null) {
  const shown =
    view === '3d' && sceneStatus && sceneStatus.display !== 'HIDDEN'
      ? usableScanBounds(sceneStatus.boundsWorld)
      : null;
  useEffect(() => {
    useRoomBoundsStore.getState().set(shown);
  }, [shown]);
  useEffect(() => () => useRoomBoundsStore.getState().set(null), []);
}

/**
 * 3D 장면 틀 하나의 공통 동작. 현재 배경(Scene)을 받고, 3D 코드를 받아 띄우고(못 띄우면 2D), 보이는 스캔 경계를 올리고,
 * 구역·정적 객체 응답을 3D 입력(source)에 넣고, 구역 목록·선택을 3D 와 맞춰 화면 조각(구역 편집 패널·구역 목록)이
 * SpatialViewportContext 로 읽을 값(viewport)을 만든다. 실시간 관제 틀(SpatialViewportHost)과 세팅의 구역 단계가 같이 쓴다.
 * 3D 편집 상자·스캔 경계는 전역 저장소라 한 번에 한 틀만 띄운다(두 화면은 같이 뜨지 않는다).
 * 배경은 sceneVersion 을 주면 그 버전(/api/scenes/{scene_version}/view, 세팅 세션의 확정 전 Scene), 없으면 지금 관제 Scene 이다.
 */
export function useViewportHost({
  source,
  loadViewer,
  planFallbackMs,
  sceneVersion = null,
}: {
  source: ExternalSpatialSource | null;
  loadViewer: () => Promise<ViewerModule>;
  planFallbackMs: number;
  sceneVersion?: string | null;
}) {
  const viewer = useRef<Viewer3DHandle>(null);
  const { zones, raw: zonesRaw, failed: zonesFailed } = useZones();
  const { scene, sceneStatus, onSceneStatusChange } = useSceneOrCurrent(sceneVersion);
  const mode = useViewerMode(loadViewer, planFallbackMs);
  const { view, viewerReady, onViewerReady, onViewerError } = mode;
  usePublishRoomBounds(view, sceneStatus);
  const pushSnapshots = useSpatialSnapshots(source, view, zonesRaw);
  const selection = useViewerSelection({ viewer, view, viewerReady, zones, zonesRaw });
  const { selectedKey, selectedZoneId, selectTarget, clearSelection } = selection;

  const onViewerStatus = useCallback(
    (status: ViewerStatus) => {
      if (status.phase === 'error') {
        onViewerError();
      } else if (status.phase === 'ready') {
        onViewerReady();
        pushSnapshots();
      }
    },
    [onViewerError, onViewerReady, pushSnapshots],
  );

  const viewport = useMemo<SpatialViewportValue>(
    () => ({
      view,
      viewerReady,
      selectedKey,
      selectedZoneId,
      zones,
      zonesRaw,
      zonesFailed,
      selectTarget,
      clearSelection,
    }),
    [
      view,
      viewerReady,
      selectedKey,
      selectedZoneId,
      zones,
      zonesRaw,
      zonesFailed,
      selectTarget,
      clearSelection,
    ],
  );

  return {
    ...mode,
    ...selection,
    viewer,
    scene,
    sceneStatus,
    onSceneStatusChange,
    onViewerStatus,
    viewport,
  };
}
