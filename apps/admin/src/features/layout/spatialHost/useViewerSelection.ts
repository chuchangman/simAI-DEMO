import type { Incident } from '@/features/events/events';
import { RESELECT_MS, RESELECT_TRIES } from '@/features/layout/spatialHost/constants';
import { keyOfTarget, targetOfKey } from '@/features/layout/spatialHost/selectionKey';
import type { SpatialViewMode } from '@/features/layout/spatialHost/useViewerMode';
import type { CommandResult, Viewer3DHandle, ViewerTarget } from '@/features/viewer3d';
import type { ViewerZones, Zone } from '@/features/zones/types';
import { useRealtimeStore } from '@/store/realtime.store';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

/**
 * 선택 키(person:…·zone:…·object:…)를 쥐고 3D 의 선택과 맞춘다. 키는 입력 Source 마다 따로 두어 Source 가 바뀌면 비워진다.
 * 3D 가 아직 준비되지 않았거나 대상이 장면에 올라오지 않았으면 선택만 먼저 보이고, 올라오면 맞춰 초점까지 맞춘다.
 */
export function useViewerSelection({
  viewer,
  view,
  viewerReady,
  zones,
  zonesRaw,
}: {
  viewer: RefObject<Viewer3DHandle | null>;
  view: SpatialViewMode;
  viewerReady: boolean;
  zones: Zone[];
  zonesRaw: ViewerZones | undefined;
}) {
  const sourceId = useRealtimeStore((s) => s.source?.id ?? null);
  const [selection, setSelection] = useState<{ sourceId: string | null; key: string | null }>(
    () => ({ sourceId, key: null }),
  );
  // 3D 가 이미 맞춘 선택 키(같은 키를 다시 고르지 않는다).
  const syncedKeyRef = useRef<string | null>(null);
  // 3D 에 대상이 올라오면 초점을 맞출 선택 키.
  const pendingFocusRef = useRef<string | null>(null);

  const selectedKey = selection.sourceId === sourceId ? selection.key : null;

  const selectedZoneId = useMemo(() => {
    const target = targetOfKey(selectedKey);
    return target?.type === 'zone' ? target.id : null;
  }, [selectedKey]);

  const setSelectedKey = useCallback((key: string | null) => {
    if (pendingFocusRef.current !== null && pendingFocusRef.current !== key) {
      pendingFocusRef.current = null;
    }
    setSelection({ sourceId: useRealtimeStore.getState().source?.id ?? null, key });
  }, []);

  // 3D 가 보이지 않거나 준비 전이면 맞춘 선택을 잊는다(다시 뜨면 처음부터 맞춘다). 3D 가 멈춰 2D 로 바뀌면 예약한 초점도 버린다.
  useEffect(() => {
    if (view === '3d' && viewerReady) return;
    syncedKeyRef.current = null;
  }, [view, viewerReady]);
  useEffect(() => {
    if (view === '2d') pendingFocusRef.current = null;
  }, [view]);

  const focusIfPending = useCallback(
    (target: ViewerTarget, key: string) => {
      if (pendingFocusRef.current !== key) return;
      pendingFocusRef.current = null;
      viewer.current?.focus(target);
    },
    [viewer],
  );

  const selectTarget = useCallback(
    (target: ViewerTarget, options?: { focus?: boolean }): CommandResult | undefined => {
      const key = keyOfTarget(target);
      if (key) {
        setSelectedKey(key);
        pendingFocusRef.current = options?.focus ? key : null;
      }
      const reachable =
        view === '3d' &&
        viewerReady &&
        (target.type !== 'zone' || zones.some((z) => z.zoneId === target.id));
      if (!reachable) {
        syncedKeyRef.current = null;
        return undefined;
      }
      const res = viewer.current?.select(target);
      if (res?.ok && key) {
        syncedKeyRef.current = key;
        focusIfPending(target, key);
      } else {
        syncedKeyRef.current = null;
      }
      return res;
    },
    [view, viewerReady, zones, viewer, setSelectedKey, focusIfPending],
  );

  const clearSelection = useCallback(() => {
    syncedKeyRef.current = null;
    pendingFocusRef.current = null;
    setSelectedKey(null);
    viewer.current?.clearSelection();
  }, [viewer, setSelectedKey]);

  // 이벤트 패널에서 묶음을 누르면 선택하고 초점을 맞춘다. 3D 가 못 고르면 올라올 때까지 초점을 미룬다.
  const selectIncident = useCallback(
    (incident: Incident) => {
      setSelectedKey(incident.key);
      if (!incident.target) return;
      const res = viewer.current?.select(incident.target);
      if (res?.ok) {
        syncedKeyRef.current = incident.key;
        viewer.current?.focus(incident.target);
      } else {
        syncedKeyRef.current = null;
        pendingFocusRef.current = incident.key;
      }
    },
    [viewer, setSelectedKey],
  );

  // 3D 에서 사람·구역·작업면을 누르거나 빈 곳을 눌러 선택이 풀렸다.
  const onViewerSelect = useCallback(
    (target: ViewerTarget | null) => {
      const key = target ? keyOfTarget(target) : null;
      syncedKeyRef.current = key;
      setSelectedKey(key);
    },
    [setSelectedKey],
  );

  // 3D 가 준비되거나 늦은 구역 응답이 도착하면 아직 3D 에 반영되지 않은 선택 대상을 단일 루프로 맞춘다.
  useEffect(() => {
    const target = targetOfKey(selectedKey);
    if (view !== '3d' || !viewerReady || !target || !selectedKey) return;
    if (syncedKeyRef.current === selectedKey) return;
    if (target.type === 'zone' && !zonesRaw) return;
    let tries = 0;
    // 맞췄거나 포기하면 true.
    const attempt = () => {
      tries += 1;
      if (viewer.current?.select(target)?.ok === true) {
        syncedKeyRef.current = selectedKey;
        focusIfPending(target, selectedKey);
        return true;
      }
      if (tries < RESELECT_TRIES) return false;
      if (pendingFocusRef.current === selectedKey) pendingFocusRef.current = null;
      return true;
    };
    if (attempt()) return;
    const id = setInterval(() => {
      if (attempt()) clearInterval(id);
    }, RESELECT_MS);
    return () => clearInterval(id);
  }, [view, viewerReady, selectedKey, zonesRaw, viewer, focusIfPending]);

  return {
    selectedKey,
    selectedZoneId,
    setSelectedKey,
    selectTarget,
    clearSelection,
    selectIncident,
    onViewerSelect,
  };
}
