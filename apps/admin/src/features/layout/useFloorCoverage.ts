import type { ViewerSceneInput } from '@/features/viewer3d';
import { isCoverageCurrent, readFloorCoverage } from '@/lib/floorCoverage';
import { useRealtimeStore } from '@/store/realtime.store';
import { useMemo } from 'react';

const text = (raw: unknown, key: string): string | null => {
  const value: unknown =
    typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
  return typeof value === 'string' && value !== '' ? value : null;
};

/**
 * 현재 Scene 응답의 바닥 감시 범위(-606)와 그것이 지금 감시에 맞는지(isCoverageCurrent).
 * 범위가 없으면 coverage 가 null 이다(도구 버튼도 숨긴다). 맞지 않으면 current 가 false 다(그리지 않고 오래됐다고 알린다).
 */
export function useFloorCoverage(scene: ViewerSceneInput | null) {
  const raw = scene?.ok ? scene.raw : null;
  const coverage = useMemo(() => readFloorCoverage(raw), [raw]);
  // world(10 Hz)·health(1 Hz)는 문자열 값만 구독해 바뀔 때만 다시 그린다. 일부만 채운 health 에도 견디게 scene 을 확인한다
  const liveCalibration = useRealtimeStore((s) => s.world?.payload.calibration_version ?? null);
  const compatScene = useRealtimeStore(
    (s) => s.health?.payload.scene?.compatibility?.scene_version,
  );
  const compatLive = useRealtimeStore(
    (s) => s.health?.payload.scene?.compatibility?.calibration_version ?? null,
  );
  const verification = useRealtimeStore(
    (s) => s.health?.payload.scene?.compatibility?.verification ?? null,
  );
  const sceneVersion = text(raw, 'scene_version');
  const sceneCalibration = text(raw, 'calibration_version');
  const compatibility =
    verification && compatScene === sceneVersion
      ? { sceneCalibration, liveCalibration: compatLive, verification }
      : null;
  return { coverage, current: isCoverageCurrent(coverage, liveCalibration, compatibility) };
}
