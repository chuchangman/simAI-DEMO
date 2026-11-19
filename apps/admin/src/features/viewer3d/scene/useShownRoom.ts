import { useSceneState, type SceneStoreState } from '@/features/viewer3d/scene/sceneStore';
import { roomLimitFrom, usableScanBounds, type RoomBounds, type RoomLimit } from '@/lib/roomLimit';
import { useMemo } from 'react';

// 뷰어 안 소비자(시점·상자 손잡이)가 자기 장면 상태에서 교실 범위를 읽는다. 호스트 쪽 소비자는 호스트가 sceneStatus 로 채우는 저장소를 읽는다.

/** 보이는 스캔의 경계(교실 범위로 쓸 수 있을 때만). 숨겨졌거나 없거나 쓸 수 없으면 null. 같은 스캔이면 같은 객체다. */
export const shownScanBoundsOf = (state: SceneStoreState): RoomBounds | null =>
  state.display === 'HIDDEN' ? null : usableScanBounds(state.load.boundsWorld);

export const useShownScanBounds = () => useSceneState(shownScanBoundsOf);

/** 시점과 상자 손잡이가 따르는 교실 범위. 스캔이 보이지 않으면 목업 교실 범위다. */
export function useShownRoomLimit(): RoomLimit {
  const bounds = useShownScanBounds();
  return useMemo(() => roomLimitFrom(bounds), [bounds]);
}
