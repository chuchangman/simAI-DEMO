import { useSceneState } from '@/features/viewer3d/scene/sceneStore';
import { shownScanBoundsOf } from '@/features/viewer3d/scene/useShownRoom';

/**
 * 정적 배경(스캔)이 목업 교실을 대신해 보이는지(흐려도 보임). 목업 바탕(격자·바닥·벽 경계)은 이때만 숨긴다.
 * 시점·구역 손잡이 범위·머리글과 같은 판정(shownScanBoundsOf)이라, 스캔이 보여도 범위로 쓸 수 없으면 모두 목업 교실로 같이 돌아간다.
 */
export function useBackgroundShown(): boolean {
  return useSceneState((s) => shownScanBoundsOf(s) !== null);
}
