import { roomLimitFrom, type RoomBounds, type RoomLimit } from '@/lib/roomLimit';
import { useMemo } from 'react';
import { create } from 'zustand';

interface RoomBoundsState {
  /** 지금 보이는, 교실 범위로 쓸 수 있는 스캔의 World 경계. 스캔이 없거나 숨겨졌거나 쓸 수 없으면 null. */
  bounds: RoomBounds | null;
  set: (bounds: RoomBounds | null) => void;
}

// 호스트 쪽 소비자(새 구역 자리·머리글)가 읽는 스캔 범위다. 쓰는 곳은 관제 호스트(SpatialViewportHost) 하나이고,
// 뷰어가 알린 장면 상태(sceneStatus)에서 채운다. 뷰어는 자기 장면 저장소에서 읽어 이 저장소를 쓰거나 읽지 않는다.
// 뷰어를 lazy 로 불러오므로 읽는 쪽이 three.js 를 끌어오지 않게 뷰어 밖에 둔다.
export const useRoomBoundsStore = create<RoomBoundsState>()((set) => ({
  bounds: null,
  set: (bounds) => set({ bounds }),
}));

/** 지금 새 구역을 놓을 수 있는 범위. 스캔이 없으면 목업 교실 범위다. 스캔이 바뀌면 다시 그려진다. */
export const useRoomLimit = (): RoomLimit => {
  const bounds = useRoomBoundsStore((s) => s.bounds);
  return useMemo(() => roomLimitFrom(bounds), [bounds]);
};

/** 스캔이 보이는 중인지. */
export const useHasRoomScan = () => useRoomBoundsStore((s) => s.bounds !== null);
